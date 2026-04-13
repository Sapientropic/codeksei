import { spawn } from "node:child_process";
import { WebSocket, type RawData } from "ws";
import { buildSpawnInvocation } from "../../../core/codex-spawn";
import { appendCodexCapabilityHint } from "./capability-probe";

const TRANSPORT_STDERR_MAX_CHARS = 4000;

export type TransportMode = "websocket" | "spawn";

export interface SpawnChildLike {
  stdin: {
    writable: boolean;
    write(chunk: string): void;
    on?(event: "error", listener: (error: Error) => void): unknown;
  } | null;
  stdout: {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  };
  stderr: {
    on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  };
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: "spawn", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  off?(event: "spawn", listener: () => void): unknown;
  off?(event: "error", listener: (error: Error) => void): unknown;
  removeListener(event: "spawn", listener: () => void): unknown;
  removeListener(event: "error", listener: (error: Error) => void): unknown;
  kill(): void;
}

export type SpawnLike = (command: string, args: string[], options: Record<string, unknown>) => SpawnChildLike;

export interface RpcTransportState {
  child: SpawnChildLike | null;
  endpoint: string;
  stderrBuffer: string;
  stdoutBuffer: string;
  socket: WebSocket | null;
  mode: TransportMode;
}

export interface RpcTransport {
  readonly state: RpcTransportState;
  connect(): Promise<void>;
  isConnected(): boolean;
  close(): Promise<void>;
  sendRaw(payload: string): void;
}

export function createRpcTransport({
  endpoint = "",
  env = process.env,
  codexCommand,
  spawnImpl = spawn,
  onIncoming,
  onClosed,
}: {
  endpoint?: string;
  env?: NodeJS.ProcessEnv;
  codexCommand: string;
  spawnImpl?: SpawnLike;
  onIncoming(rawMessage: string): void;
  onClosed(message: string): void;
}): RpcTransport {
  const state: RpcTransportState = {
    child: null,
    endpoint,
    stderrBuffer: "",
    stdoutBuffer: "",
    socket: null,
    mode: endpoint ? "websocket" : "spawn",
  };

  function handleTransportClosed(message: string, {
    socket = null,
    child = null,
  }: {
    socket?: WebSocket | null;
    child?: SpawnChildLike | null;
  } = {}): void {
    if (socket && state.socket !== socket) {
      return;
    }
    if (child && state.child !== child) {
      return;
    }
    if (!socket && !child && !state.socket && !state.child) {
      return;
    }
    state.socket = null;
    state.child = null;
    state.stdoutBuffer = "";
    state.stderrBuffer = "";
    onClosed(message);
  }

  async function connectSpawn(): Promise<void> {
    const spawnSpec = buildSpawnInvocation(codexCommand, ["app-server"]);
    let child: SpawnChildLike | null = null;
    try {
      child = spawnImpl(spawnSpec.command, spawnSpec.args, {
        env: { ...env },
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      throw createSpawnFailureError(spawnSpec, error);
    }

    state.stdoutBuffer = "";
    state.stderrBuffer = "";
    state.child = child;
    child.on("error", (error) => {
      handleTransportClosed(buildSpawnRuntimeErrorMessage(error, state.stderrBuffer), { child });
    });
    child.stdout.on("data", (chunk) => {
      state.stdoutBuffer += chunk.toString("utf8");
      const lines = state.stdoutBuffer.split("\n");
      state.stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          onIncoming(trimmed);
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      state.stderrBuffer = appendTransportOutput(state.stderrBuffer, chunk.toString("utf8"));
    });
    if (child.stdin && typeof child.stdin.on === "function") {
      child.stdin.on("error", (error) => {
        handleTransportClosed(buildSpawnRuntimeErrorMessage(error, state.stderrBuffer), { child });
      });
    }
    child.on("close", (code, signal) => {
      handleTransportClosed(buildSpawnCloseMessage({
        code,
        signal,
        stderrBuffer: state.stderrBuffer,
      }), { child });
    });

    try {
      await waitForSpawnReady(child);
    } catch (error) {
      throw createSpawnFailureError(spawnSpec, error);
    }
  }

  async function connectWebSocket(): Promise<void> {
    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
      return;
    }
    if (state.socket) {
      try {
        state.socket.terminate();
      } catch {
        // best effort
      }
      state.socket = null;
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(endpoint);
      state.socket = socket;
      socket.on("open", () => {
        settled = true;
        resolve();
      });
      socket.on("error", (error) => {
        if (!settled) {
          if (state.socket === socket) {
            state.socket = null;
          }
          reject(error);
          return;
        }
        handleTransportClosed("Codex websocket errored", { socket });
      });
      socket.on("message", (chunk: RawData) => {
        const message = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (message.trim()) {
          onIncoming(message);
        }
      });
      socket.on("close", () => {
        if (!settled) {
          if (state.socket === socket) {
            state.socket = null;
          }
          reject(new Error("Codex websocket closed before connection completed"));
          return;
        }
        handleTransportClosed("Codex websocket closed", { socket });
      });
    });
  }

  return {
    state,
    async connect(): Promise<void> {
      if (this.isConnected()) {
        return;
      }
      if (state.mode === "websocket") {
        await connectWebSocket();
        return;
      }
      await connectSpawn();
    },
    isConnected(): boolean {
      if (state.mode === "websocket") {
        return Boolean(state.socket && state.socket.readyState === WebSocket.OPEN);
      }
      return Boolean(state.child && state.child.stdin && state.child.stdin.writable);
    },
    async close(): Promise<void> {
      const socket = state.socket;
      const child = state.child;
      state.socket = null;
      state.child = null;
      state.stdoutBuffer = "";
      state.stderrBuffer = "";
      if (socket) {
        try {
          socket.close();
        } catch {
          // best effort
        }
      }
      if (child) {
        try {
          child.kill();
        } catch {
          // best effort
        }
      }
    },
    sendRaw(payload: string): void {
      if (state.mode === "websocket") {
        if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
          throw new Error("Codex websocket is not connected");
        }
        state.socket.send(payload);
        return;
      }
      const child = state.child;
      if (!child || !child.stdin || !child.stdin.writable) {
        handleTransportClosed(buildSpawnStdinClosedMessage(state.stderrBuffer), { child });
        throw new Error("Codex process stdin is not writable");
      }
      try {
        child.stdin.write(`${payload}\n`);
      } catch (error) {
        handleTransportClosed(buildSpawnRuntimeErrorMessage(error, state.stderrBuffer), { child });
        throw error;
      }
    },
  };
}

export function waitForSpawnReady(child: SpawnChildLike): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (typeof child.off === "function") {
        child.off("spawn", handleSpawn);
        child.off("error", handleError);
      } else {
        child.removeListener("spawn", handleSpawn);
        child.removeListener("error", handleError);
      }
    };
    const handleSpawn = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    const handleError = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    child.once("spawn", handleSpawn);
    child.once("error", handleError);
  });
}

export function createSpawnFailureError(
  spawnSpec: { command: string; args?: string[] },
  error: unknown,
): Error {
  const attempted = [spawnSpec.command, ...(spawnSpec.args || [])].filter(Boolean).join(" ");
  const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
  return new Error(appendCodexCapabilityHint(`Unable to spawn Codex app-server via ${attempted}${detail}.`, error));
}

export function buildSpawnRuntimeErrorMessage(error: unknown, stderrBuffer: string): string {
  const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
  return appendTransportDiagnostic(appendCodexCapabilityHint(`Codex process transport errored${detail}`, `${detail}\n${stderrBuffer}`), stderrBuffer);
}

export function buildSpawnCloseMessage({
  code,
  signal,
  stderrBuffer,
}: {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderrBuffer: string;
}): string {
  const codeLabel = code == null ? "unknown" : String(code);
  const signalLabel = signal ? ` signal=${signal}` : "";
  return appendTransportDiagnostic(
    appendCodexCapabilityHint(`Codex process closed (code=${codeLabel}${signalLabel})`, stderrBuffer),
    stderrBuffer,
  );
}

export function buildSpawnStdinClosedMessage(stderrBuffer: string): string {
  return appendTransportDiagnostic(
    appendCodexCapabilityHint("Codex process stdin is not writable", stderrBuffer),
    stderrBuffer,
  );
}

function appendTransportDiagnostic(message: string, stderrBuffer: string): string {
  const summary = summarizeTransportStderr(stderrBuffer);
  return summary ? `${message}; stderr tail: ${summary}` : message;
}

function summarizeTransportStderr(stderrBuffer: string): string {
  const tail = String(stderrBuffer || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" | ");
  if (!tail) {
    return "";
  }
  return tail.length > 240 ? `${tail.slice(0, 237)}...` : tail;
}

function appendTransportOutput(buffer: string, chunk: string): string {
  const next = `${buffer}${chunk}`;
  if (next.length <= TRANSPORT_STDERR_MAX_CHARS) {
    return next;
  }
  return next.slice(-TRANSPORT_STDERR_MAX_CHARS);
}
