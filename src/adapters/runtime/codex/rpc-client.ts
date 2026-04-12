import { spawn } from "node:child_process";
import WebSocket = require("ws");
import type { RawData } from "ws";
import * as brandingModule from "../../../core/branding";
import * as codexSpawnModule from "../../../core/codex-spawn";

const { PRIMARY_RPC_CLIENT_INFO, readPrefixedEnv } = brandingModule as {
  PRIMARY_RPC_CLIENT_INFO: Record<string, unknown>;
  readPrefixedEnv: (env: NodeJS.ProcessEnv, key: string) => string;
};
const { buildSpawnInvocation } = codexSpawnModule as {
  buildSpawnInvocation: (command: string, args: string[]) => { command: string; args: string[] };
};

const DEFAULT_CODEX_COMMAND = "codex";
const CODEX_CLIENT_INFO = PRIMARY_RPC_CLIENT_INFO;
const TRANSPORT_STDERR_MAX_CHARS = 4000;

type TransportMode = "websocket" | "spawn";
type MessageListener = (message: unknown) => void;
interface SpawnChildLike {
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

type SpawnLike = (command: string, args: string[], options: Record<string, unknown>) => SpawnChildLike;

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface CodexRpcClientOptions {
  endpoint?: string;
  env?: NodeJS.ProcessEnv;
  codexCommand?: string;
  extraWritableRoots?: unknown[];
  spawnImpl?: SpawnLike;
}

interface CloseTransportArgs {
  socket?: WebSocket | null;
  child?: SpawnChildLike | null;
}

interface StartThreadArgs {
  cwd?: string;
}

interface ResumeThreadArgs {
  threadId?: string;
}

interface ListThreadsArgs {
  cursor?: string | null;
  limit?: number;
  sortKey?: string;
}

interface CancelTurnArgs {
  threadId?: string;
  turnId?: string;
}

interface SendUserMessageArgs {
  threadId?: string | null;
  text?: string | null;
  model?: string | null;
  effort?: string | null;
  accessMode?: string | null;
  workspaceRoot?: string | null;
}

export class CodexRpcClient {
  child: SpawnChildLike | null;
  codexCommand: string;
  endpoint: string;
  env: NodeJS.ProcessEnv;
  extraWritableRoots: string[];
  isReady: boolean;
  messageListeners: Set<MessageListener>;
  mode: TransportMode;
  pending: Map<string, PendingEntry>;
  socket: WebSocket | null;
  spawnImpl: SpawnLike;
  stderrBuffer: string;
  stdoutBuffer: string;

  constructor({
    endpoint = "",
    env = process.env,
    codexCommand = "",
    extraWritableRoots = [],
    spawnImpl = spawn,
  }: CodexRpcClientOptions = {}) {
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

  async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }
    if (this.mode === "websocket") {
      await this.connectWebSocket();
      return;
    }
    await this.connectSpawn();
  }

  async connectSpawn(): Promise<void> {
    const spawnSpec = buildSpawnInvocation(this.codexCommand, ["app-server"]);
    let child: SpawnChildLike | null = null;
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
    child.on("error", (error) => {
      this.handleTransportClosed(buildSpawnRuntimeErrorMessage(error, this.stderrBuffer), { child });
    });
    child.stdout.on("data", (chunk) => {
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
    child.stderr.on("data", (chunk) => {
      this.stderrBuffer = appendTransportOutput(this.stderrBuffer, chunk.toString("utf8"));
    });
    if (child.stdin && typeof child.stdin.on === "function") {
      child.stdin.on("error", (error) => {
        this.handleTransportClosed(buildSpawnRuntimeErrorMessage(error, this.stderrBuffer), { child });
      });
    }
    child.on("close", (code, signal) => {
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

  async connectWebSocket(): Promise<void> {
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
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(this.endpoint);
      this.socket = socket;
      socket.on("open", () => {
        settled = true;
        resolve();
      });
      socket.on("error", (error) => {
        if (!settled) {
          if (this.socket === socket) {
            this.socket = null;
          }
          reject(error);
          return;
        }
        this.handleTransportClosed("Codex websocket errored", { socket });
      });
      socket.on("message", (chunk: RawData) => {
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

  isConnected(): boolean {
    if (this.mode === "websocket") {
      return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN);
    }
    return Boolean(this.child && this.child.stdin && this.child.stdin.writable);
  }

  onMessage(listener: MessageListener): () => boolean {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  async initialize(): Promise<void> {
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

  async sendUserMessage({
    threadId = null,
    text = null,
    model = null,
    effort = null,
    accessMode = null,
    workspaceRoot = "",
  }: SendUserMessageArgs): Promise<unknown> {
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

  async startThread({ cwd }: StartThreadArgs): Promise<unknown> {
    return this.sendRequest("thread/start", buildStartThreadParams(cwd));
  }

  async resumeThread({ threadId }: ResumeThreadArgs): Promise<unknown> {
    const normalizedThreadId = normalizeNonEmptyString(threadId);
    if (!normalizedThreadId) {
      throw new Error("thread/resume requires a non-empty threadId");
    }
    return this.sendRequest("thread/resume", { threadId: normalizedThreadId });
  }

  async listThreads({
    cursor = null,
    limit = 100,
    sortKey = "updated_at",
  }: ListThreadsArgs = {}): Promise<unknown> {
    return this.sendRequest("thread/list", buildListThreadsParams({
      cursor,
      limit,
      sortKey,
    }));
  }

  async listModels(): Promise<unknown> {
    return this.sendRequest("model/list", {});
  }

  async cancelTurn({ threadId, turnId }: CancelTurnArgs): Promise<unknown> {
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

  async close(): Promise<void> {
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

  async sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = JSON.stringify({ id, method, params });
    const responsePromise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.sendRaw(payload);
    return responsePromise;
  }

  async sendNotification(method: string, params: unknown): Promise<void> {
    this.sendRaw(JSON.stringify({ method, params }));
  }

  async sendResponse(id: unknown, result: unknown): Promise<void> {
    if (id == null || id === "") {
      throw new Error("Codex RPC response requires a non-empty id");
    }
    this.sendRaw(JSON.stringify({ id, result }));
  }

  sendRaw(payload: string): void {
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

  handleTransportClosed(message: string, { socket = null, child = null }: CloseTransportArgs = {}): void {
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

  rejectPending(error: Error): void {
    for (const { reject } of this.pending.values()) {
      reject(error);
    }
    this.pending.clear();
  }

  handleIncoming(rawMessage: string): void {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(rawMessage);
    } catch {
      return;
    }

    const envelope = asRecord(parsed);
    if (envelope.id != null && this.pending.has(String(envelope.id))) {
      const pending = this.pending.get(String(envelope.id));
      this.pending.delete(String(envelope.id));
      if (!pending) {
        return;
      }
      const errorPayload = asRecord(envelope.error);
      if (Object.keys(errorPayload).length) {
        pending.reject(new Error(String(errorPayload.message || "Codex RPC request failed")));
        return;
      }
      pending.resolve(parsed);
      return;
    }

    for (const listener of this.messageListeners) {
      listener(parsed);
    }
  }
}

function resolveDefaultCodexCommand(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeNonEmptyString(readPrefixedEnv(env, "CODEX_COMMAND")) || DEFAULT_CODEX_COMMAND;
}

function normalizeNonEmptyString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function buildStartThreadParams(cwd: unknown): Record<string, string> {
  const normalizedCwd = normalizeNonEmptyString(cwd);
  return normalizedCwd ? { cwd: normalizedCwd } : {};
}

function buildListThreadsParams({
  cursor,
  limit,
  sortKey,
}: {
  cursor?: string | null;
  limit: number;
  sortKey: string;
}): { limit: number; sortKey: string; cursor?: string | null } {
  const params: { limit: number; sortKey: string; cursor?: string | null } = { limit, sortKey };
  const normalizedCursor = normalizeNonEmptyString(cursor);
  if (normalizedCursor) {
    params.cursor = normalizedCursor;
  } else if (cursor != null) {
    params.cursor = cursor;
  }
  return params;
}

function buildTurnInputPayload(text: unknown): Array<{ type: "text"; text: string }> {
  const normalizedText = normalizeNonEmptyString(text);
  return normalizedText ? [{ type: "text", text: normalizedText }] : [];
}

function buildTurnStartParams({
  threadId,
  input,
  model,
  effort,
  accessMode,
  workspaceRoot,
  extraWritableRoots = [],
}: {
  threadId?: unknown;
  input: Array<{ type: "text"; text: string }>;
  model?: unknown;
  effort?: unknown;
  accessMode?: unknown;
  workspaceRoot?: unknown;
  extraWritableRoots?: string[];
}): Record<string, unknown> {
  const params: Record<string, unknown> = { threadId, input };
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

function normalizeAccessMode(value: unknown): "current" | "full-access" | "" {
  const normalized = normalizeNonEmptyString(value).toLowerCase();
  if (normalized === "default") {
    return "current";
  }
  return normalized === "full-access" ? normalized : "";
}

function buildExecutionPolicies(
  accessMode: "current" | "full-access" | "",
  workspaceRoot: unknown,
  extraWritableRoots: string[] = [],
): {
  approvalPolicy: "never" | "on-request";
  sandboxPolicy:
    | { type: "dangerFullAccess" }
    | { type: "workspaceWrite"; writableRoots?: string[]; networkAccess: true };
} {
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
    ? { type: "workspaceWrite" as const, writableRoots, networkAccess: true as const }
    : { type: "workspaceWrite" as const, networkAccess: true as const };
  return {
    approvalPolicy: "on-request",
    sandboxPolicy,
  };
}

function normalizeWritableRoots(values: unknown[]): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
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

function waitForSpawnReady(child: SpawnChildLike): Promise<void> {
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

function createSpawnFailureError(
  spawnSpec: { command: string; args?: string[] },
  error: unknown,
): Error {
  const attempted = [spawnSpec.command, ...(spawnSpec.args || [])].filter(Boolean).join(" ");
  const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
  return new Error(`Unable to spawn Codex app-server via ${attempted}${detail}.`);
}

function buildSpawnRuntimeErrorMessage(error: unknown, stderrBuffer: string): string {
  const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
  return appendTransportDiagnostic(`Codex process transport errored${detail}`, stderrBuffer);
}

function buildSpawnCloseMessage({
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
  return appendTransportDiagnostic(`Codex process closed (code=${codeLabel}${signalLabel})`, stderrBuffer);
}

function buildSpawnStdinClosedMessage(stderrBuffer: string): string {
  return appendTransportDiagnostic("Codex process stdin is not writable", stderrBuffer);
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
