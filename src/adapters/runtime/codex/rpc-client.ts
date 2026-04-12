const { spawn } = require("child_process");
const WebSocket = require("ws");
const { PRIMARY_RPC_CLIENT_INFO } = require("../../../core/branding");
const { readPrefixedEnv } = require("../../../core/branding");
const { buildSpawnInvocation } = require("../../../core/codex-spawn");

const DEFAULT_CODEX_COMMAND = "codex";
const CODEX_CLIENT_INFO = PRIMARY_RPC_CLIENT_INFO;
const TRANSPORT_STDERR_MAX_CHARS = 4000;

class CodexRpcClient {
  child: any;
  codexCommand: any;
  endpoint: any;
  env: any;
  extraWritableRoots: any;
  isReady: boolean;
  messageListeners: Set<any>;
  mode: any;
  pending: Map<any, any>;
  socket: any;
  spawnImpl: any;
  stderrBuffer: string;
  stdoutBuffer: string;

  constructor({
    endpoint = "",
    env = process.env,
    codexCommand = "",
    extraWritableRoots = [],
    spawnImpl = spawn,
  }: any) {
    this.endpoint = endpoint;
    this.env = env;
    this.codexCommand = codexCommand || resolveDefaultCodexCommand(env);
    this.extraWritableRoots = normalizeWritableRoots(extraWritableRoots);
    this.spawnImpl = spawnImpl;
    this.mode = endpoint ? "websocket" : "spawn";
    this.socket = null;
    this.child = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.pending = new Map();
    this.isReady = false;
    this.messageListeners = new Set();
  }

  async connect() {
    if (this.isConnected()) {
      return;
    }
    if (this.mode === "websocket") {
      await this.connectWebSocket();
      return;
    }
    await this.connectSpawn();
  }

  async connectSpawn() {
    const spawnSpec = buildSpawnInvocation(this.codexCommand, ["app-server"]);
    let child = null;
    try {
      child = this.spawnImpl(spawnSpec.command, spawnSpec.args, {
        env: { ...this.env },
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      throw createSpawnFailureError(spawnSpec, error);
    }

    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.child = child;
    child.on("error", (error: any) => {
      this.handleTransportClosed(buildSpawnRuntimeErrorMessage(error, this.stderrBuffer), { child });
    });
    child.stdout.on("data", (chunk: any) => {
      this.stdoutBuffer += chunk.toString("utf8");
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          this.handleIncoming(trimmed);
        }
      }
    });
    child.stderr.on("data", (chunk: any) => {
      this.stderrBuffer = appendTransportOutput(this.stderrBuffer, chunk.toString("utf8"));
    });
    if (child.stdin && typeof child.stdin.on === "function") {
      child.stdin.on("error", (error: any) => {
        this.handleTransportClosed(buildSpawnRuntimeErrorMessage(error, this.stderrBuffer), { child });
      });
    }
    child.on("close", (code: any, signal: any) => {
      this.handleTransportClosed(buildSpawnCloseMessage({
        code,
        signal,
        stderrBuffer: this.stderrBuffer,
      }), { child });
    });

    try {
      await waitForSpawnReady(child);
    } catch (error) {
      throw createSpawnFailureError(spawnSpec, error);
    }
  }

  async connectWebSocket() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.socket) {
      try {
        this.socket.terminate();
      } catch {
        // best effort
      }
      this.socket = null;
    }
    await new Promise((resolve: any, reject: any) => {
      let settled = false;
      const socket = new WebSocket(this.endpoint);
      this.socket = socket;
      socket.on("open", () => {
        settled = true;
        resolve();
      });
      socket.on("error", (error: any) => {
        if (!settled) {
          if (this.socket === socket) {
            this.socket = null;
          }
          reject(error);
          return;
        }
        this.handleTransportClosed("Codex websocket errored", { socket });
      });
      socket.on("message", (chunk: any) => {
        const message = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (message.trim()) {
          this.handleIncoming(message);
        }
      });
      socket.on("close", () => {
        if (!settled) {
          if (this.socket === socket) {
            this.socket = null;
          }
          reject(new Error("Codex websocket closed before connection completed"));
          return;
        }
        this.handleTransportClosed("Codex websocket closed", { socket });
      });
    });
  }

  isConnected() {
    if (this.mode === "websocket") {
      return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN);
    }
    return Boolean(this.child && this.child.stdin && this.child.stdin.writable);
  }

  onMessage(listener: any) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  async initialize() {
    if (this.isReady) {
      return;
    }
    await this.sendRequest("initialize", {
      clientInfo: CODEX_CLIENT_INFO,
      capabilities: {
        experimentalApi: true,
      },
    });
    await this.sendNotification("initialized", null);
    this.isReady = true;
  }

  async sendUserMessage({ threadId, text, model = null, effort = null, accessMode = null, workspaceRoot = "" }: any) {
    const input = buildTurnInputPayload(text);
    return threadId
      ? this.sendRequest("turn/start", buildTurnStartParams({
        threadId,
        input,
        model,
        effort,
        accessMode,
        workspaceRoot,
        extraWritableRoots: this.extraWritableRoots,
      }))
      : this.sendRequest("thread/start", { input });
  }

  async startThread({ cwd }: any) {
    return this.sendRequest("thread/start", buildStartThreadParams(cwd));
  }

  async resumeThread({ threadId }: any) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("thread/resume requires a non-empty threadId");
    }
    return this.sendRequest("thread/resume", { threadId: normalizedThreadId });
  }

  async listThreads({ cursor = null, limit = 100, sortKey = "updated_at" }: any = {}) {
    return this.sendRequest("thread/list", buildListThreadsParams({
      cursor,
      limit,
      sortKey,
    }));
  }

  async listModels() {
    return this.sendRequest("model/list", {});
  }

  async cancelTurn({ threadId, turnId }: any) {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    const normalizedTurnId = normalizeNonEmptyString(turnId);
    if (!normalizedThreadId || !normalizedTurnId) {
      throw new Error("turn/cancel requires threadId and turnId");
    }
    return this.sendRequest("turn/cancel", {
      threadId: normalizedThreadId,
      turnId: normalizedTurnId,
    });
  }

  async close() {
    this.rejectPending(new Error("Codex RPC client closed"));
    const socket = this.socket;
    const child = this.child;
    this.socket = null;
    this.child = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.isReady = false;
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
  }

  async sendRequest(method: any, params: any) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = JSON.stringify({ id, method, params });
    const responsePromise = new Promise((resolve: any, reject: any) => {
      this.pending.set(id, { resolve, reject });
    });
    this.sendRaw(payload);
    return responsePromise;
  }

  async sendNotification(method: any, params: any) {
    this.sendRaw(JSON.stringify({ method, params }));
  }

  async sendResponse(id: any, result: any) {
    if (id == null || id === "") {
      throw new Error("Codex RPC response requires a non-empty id");
    }
    this.sendRaw(JSON.stringify({ id, result }));
  }

  sendRaw(payload: any) {
    if (this.mode === "websocket") {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        throw new Error("Codex websocket is not connected");
      }
      this.socket.send(payload);
      return;
    }
    const child = this.child;
    if (!child || !child.stdin || !child.stdin.writable) {
      this.handleTransportClosed(buildSpawnStdinClosedMessage(this.stderrBuffer), { child });
      throw new Error("Codex process stdin is not writable");
    }
    try {
      child.stdin.write(`${payload}\n`);
    } catch (error) {
      this.handleTransportClosed(buildSpawnRuntimeErrorMessage(error, this.stderrBuffer), { child });
      throw error;
    }
  }

  handleTransportClosed(message: any, { socket = null, child = null }: any = {}) {
    if (socket && this.socket !== socket) {
      return;
    }
    if (child && this.child !== child) {
      return;
    }
    if (!socket && !child && !this.socket && !this.child) {
      return;
    }
    this.socket = null;
    this.child = null;
    this.isReady = false;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.rejectPending(new Error(message));
  }

  rejectPending(error: any) {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
  }

  handleIncoming(rawMessage: any) {
    let parsed = null;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      return;
    }

    if (parsed && parsed.id != null && this.pending.has(String(parsed.id))) {
      const { resolve, reject } = this.pending.get(String(parsed.id));
      this.pending.delete(String(parsed.id));
      if (parsed.error) {
        reject(new Error(parsed.error.message || "Codex RPC request failed"));
        return;
      }
      resolve(parsed);
      return;
    }

    for (const listener of this.messageListeners) {
      listener(parsed);
    }
  }
}

function resolveDefaultCodexCommand(env: any = process.env) {
  return normalizeNonEmptyString(readPrefixedEnv(env, "CODEX_COMMAND")) || DEFAULT_CODEX_COMMAND;
}

function normalizeNonEmptyString(value: any) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function buildStartThreadParams(cwd: any) {
  const normalizedCwd = normalizeNonEmptyString(cwd);
  return normalizedCwd ? { cwd: normalizedCwd } : {};
}

function buildListThreadsParams({ cursor, limit, sortKey }: any) {
  const params: any = { limit, sortKey };
  const normalizedCursor = normalizeNonEmptyString(cursor);
  if (normalizedCursor) {
    params.cursor = normalizedCursor;
  } else if (cursor != null) {
    params.cursor = cursor;
  }
  return params;
}

function buildTurnInputPayload(text: any) {
  const normalizedText = normalizeNonEmptyString(text);
  return normalizedText ? [{ type: "text", text: normalizedText }] : [];
}

function buildTurnStartParams({ threadId, input, model, effort, accessMode, workspaceRoot, extraWritableRoots = [] }: any) {
  const params: any = { threadId, input };
  const normalizedWorkspaceRoot = normalizeNonEmptyString(workspaceRoot);
  const normalizedModel = normalizeNonEmptyString(model);
  const normalizedEffort = normalizeNonEmptyString(effort);
  const normalizedAccessMode = normalizeAccessMode(accessMode);
  const executionPolicies = buildExecutionPolicies(normalizedAccessMode, workspaceRoot, extraWritableRoots);
  if (normalizedWorkspaceRoot) {
    params.cwd = normalizedWorkspaceRoot;
  }
  if (normalizedModel) {
    params.model = normalizedModel;
  }
  if (normalizedEffort) {
    params.effort = normalizedEffort;
  }
  if (normalizedAccessMode) {
    params.accessMode = normalizedAccessMode;
  }
  params.approvalPolicy = executionPolicies.approvalPolicy;
  params.sandboxPolicy = executionPolicies.sandboxPolicy;
  return params;
}

function normalizeAccessMode(value: any) {
  const normalized = normalizeNonEmptyString(value).toLowerCase();
  if (normalized === "default") {
    return "current";
  }
  return normalized === "full-access" ? normalized : "";
}

function buildExecutionPolicies(accessMode: any, workspaceRoot: any, extraWritableRoots: any[] = []) {
  if (accessMode === "full-access") {
    return {
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    };
  }
  const normalizedWorkspaceRoot = normalizeNonEmptyString(workspaceRoot);
  const writableRoots = normalizeWritableRoots([
    normalizedWorkspaceRoot,
    ...extraWritableRoots,
  ]);
  const sandboxPolicy = writableRoots.length
    ? { type: "workspaceWrite", writableRoots, networkAccess: true }
    : { type: "workspaceWrite", networkAccess: true };
  return {
    approvalPolicy: "on-request",
    sandboxPolicy,
  };
}

function normalizeWritableRoots(values: any) {
  const roots = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeNonEmptyString(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    roots.push(normalized);
  }
  return roots;
}

function waitForSpawnReady(child: any) {
  return new Promise((resolve: any, reject: any) => {
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
    const handleError = (error: any) => {
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

function createSpawnFailureError(spawnSpec: any, error: any) {
  const attempted = [spawnSpec.command, ...(spawnSpec.args || [])].filter(Boolean).join(" ");
  const detail = error?.message ? `: ${error.message}` : "";
  return new Error(`Unable to spawn Codex app-server via ${attempted}${detail}.`);
}

function buildSpawnRuntimeErrorMessage(error: any, stderrBuffer: any) {
  const detail = error?.message ? `: ${error.message}` : "";
  return appendTransportDiagnostic(`Codex process transport errored${detail}`, stderrBuffer);
}

function buildSpawnCloseMessage({ code, signal, stderrBuffer }: any) {
  const codeLabel = code == null ? "unknown" : String(code);
  const signalLabel = signal ? ` signal=${signal}` : "";
  return appendTransportDiagnostic(`Codex process closed (code=${codeLabel}${signalLabel})`, stderrBuffer);
}

function buildSpawnStdinClosedMessage(stderrBuffer: any) {
  return appendTransportDiagnostic("Codex process stdin is not writable", stderrBuffer);
}

function appendTransportDiagnostic(message: any, stderrBuffer: any) {
  const summary = summarizeTransportStderr(stderrBuffer);
  return summary ? `${message}; stderr tail: ${summary}` : message;
}

function summarizeTransportStderr(stderrBuffer: any) {
  const tail = String(stderrBuffer || "")
    .split(/\r?\n/)
    .map((line: any) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" | ");
  if (!tail) {
    return "";
  }
  return tail.length > 240 ? `${tail.slice(0, 237)}...` : tail;
}

function appendTransportOutput(buffer: any, chunk: any) {
  const next = `${buffer}${chunk}`;
  if (next.length <= TRANSPORT_STDERR_MAX_CHARS) {
    return next;
  }
  return next.slice(-TRANSPORT_STDERR_MAX_CHARS);
}

module.exports = { CodexRpcClient };

export {};
