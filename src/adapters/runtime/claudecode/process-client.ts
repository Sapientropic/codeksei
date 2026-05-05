import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type UnknownRecord = Record<string, unknown>;
type ClaudeCodeProcessEventListener = (event: ClaudeCodeProcessEvent, raw?: unknown) => void;

export interface ClaudeCodeProcessEvent extends UnknownRecord {
  type: string;
  sessionId?: string;
  turnId?: string;
}

export interface ClaudeCodeProcessClientConfig {
  command?: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  model?: string;
  permissionMode?: string;
  disableVerbose?: boolean;
  extraArgs?: string[];
  mcpConfigPaths?: string[];
  strictMcpConfig?: boolean;
  workspaceRoot?: string;
  modelContextWindow?: number;
}

export interface ClaudeCodeArgsConfig {
  model?: unknown;
  permissionMode?: unknown;
  disableVerbose?: unknown;
  extraArgs?: unknown;
  mcpConfigPaths?: unknown;
  strictMcpConfig?: unknown;
  resumeSessionId?: unknown;
}

interface SessionWaiter {
  resolve(sessionId: string): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class ClaudeCodeProcessClient {
  readonly command: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly model: string;
  readonly permissionMode: string;
  readonly disableVerbose: boolean;
  readonly extraArgs: string[];
  readonly mcpConfigPaths: string[];
  readonly strictMcpConfig: boolean;
  readonly workspaceRoot: string;
  readonly modelContextWindow: number;
  child: ChildProcessWithoutNullStreams | null = null;
  stdoutBuffer = "";
  listeners = new Set<ClaudeCodeProcessEventListener>();
  pendingTurnId = "";
  sessionId = "";
  resumeSessionId = "";
  activeThreadId = "";
  alive = false;
  private sessionWaiters = new Set<SessionWaiter>();

  constructor({
    command = "claude",
    cwd,
    env = process.env,
    model = "",
    permissionMode = "default",
    disableVerbose = false,
    extraArgs = [],
    mcpConfigPaths = [],
    strictMcpConfig = false,
    workspaceRoot = "",
    modelContextWindow = 0,
  }: ClaudeCodeProcessClientConfig) {
    this.command = normalizeString(command) || "claude";
    this.cwd = cwd;
    this.env = filterClaudeCodeEnv(env);
    this.model = normalizeString(model);
    this.permissionMode = normalizeString(permissionMode) || "default";
    this.disableVerbose = Boolean(disableVerbose);
    this.extraArgs = Array.isArray(extraArgs) ? extraArgs.map(normalizeString).filter(Boolean) : [];
    this.mcpConfigPaths = Array.isArray(mcpConfigPaths) ? mcpConfigPaths.map(normalizeString).filter(Boolean) : [];
    this.strictMcpConfig = Boolean(strictMcpConfig);
    this.workspaceRoot = normalizeString(workspaceRoot);
    this.modelContextWindow = Number.isFinite(Number(modelContextWindow)) ? Number(modelContextWindow) : 0;
  }

  onMessage(listener: ClaudeCodeProcessEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: ClaudeCodeProcessEvent, raw: unknown = null): void {
    for (const listener of this.listeners) {
      try {
        listener(event, raw);
      } catch {
        // Listener failures should not destabilize the runtime process owner.
      }
    }
  }

  async connect(resumeSessionId: unknown = ""): Promise<void> {
    if (this.child) {
      return;
    }
    this.sessionId = "";
    this.resumeSessionId = isValidClaudeSessionId(resumeSessionId) ? normalizeString(resumeSessionId) : "";
    this.activeThreadId = "";
    const child = spawn(this.command, buildClaudeCodeArgs({
      model: this.model,
      permissionMode: this.permissionMode,
      disableVerbose: this.disableVerbose,
      extraArgs: this.extraArgs,
      mcpConfigPaths: this.mcpConfigPaths,
      strictMcpConfig: this.strictMcpConfig,
      resumeSessionId: this.resumeSessionId,
    }), {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    this.child = child;
    this.alive = true;

    child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString("utf8");
      const lines = this.stdoutBuffer.split("\n");
      this.stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        this.handleLine(line.trim());
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text && !isPotentiallySensitiveClaudeCodeText(text)) {
        this.emit({ type: "stderr", text }, null);
      }
    });

    child.on("error", (error: Error) => {
      this.rejectSessionWaiters(error);
      this.alive = false;
      this.child = null;
      this.emit({
        type: "process.error",
        error: error.message,
        sessionId: this.activeThreadId || this.sessionId,
        turnId: this.pendingTurnId,
      }, null);
    });

    child.on("close", (code: number | null) => {
      this.rejectSessionWaiters(new Error(`claudecode process closed with code ${code ?? "unknown"}`));
      this.alive = false;
      this.child = null;
      this.emit({
        type: "process.close",
        code: code ?? -1,
        sessionId: this.activeThreadId || this.sessionId,
        turnId: this.pendingTurnId,
      }, null);
    });
  }

  handleLine(line: string): void {
    if (!line) {
      return;
    }
    const raw = parseJsonLine(line);
    if (!raw) {
      return;
    }
    switch (normalizeString(raw.type)) {
      case "system":
        this.handleSystem(raw);
        break;
      case "assistant":
        this.handleAssistant(raw);
        break;
      case "user":
        this.handleUser(raw);
        break;
      case "result":
        this.handleResult(raw);
        break;
      case "control_request":
        this.handleControlRequest(raw);
        break;
      default:
        break;
    }
  }

  async sendUserMessage({ text, threadId = "" }: { text: string; threadId?: string }): Promise<void> {
    if (!this.alive || !this.child?.stdin) {
      throw new Error("claudecode process not running");
    }
    this.pendingTurnId = `turn-${Date.now()}`;
    this.activeThreadId = normalizeString(threadId) || this.sessionId;
    this.child.stdin.write(`${JSON.stringify({
      type: "user",
      message: { role: "user", content: text },
    })}\n`);
    this.emit({
      type: "turn.started",
      turnId: this.pendingTurnId,
      sessionId: this.activeThreadId,
    }, null);
  }

  async sendResponse(requestId: unknown, { decision }: { decision: unknown }): Promise<void> {
    if (!this.alive || !this.child?.stdin) {
      throw new Error("claudecode process not running");
    }
    const behavior = decision === "accept" ? "allow" : "deny";
    const response = behavior === "allow"
      ? { behavior: "allow", updatedInput: {} }
      : { behavior: "deny", message: "The user denied this tool use. Stop and wait for the user's instructions." };
    this.child.stdin.write(`${JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestId,
        response,
      },
    })}\n`);
  }

  async waitForSessionId({ timeoutMs = 5000 }: { timeoutMs?: unknown } = {}): Promise<string> {
    if (this.sessionId) {
      return this.sessionId;
    }
    if (!this.alive) {
      throw new Error("claudecode process not running");
    }
    const timeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 5000;
    return new Promise((resolve, reject) => {
      const waiter: SessionWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.sessionWaiters.delete(waiter);
          reject(new Error("timed out waiting for claudecode session id"));
        }, timeout),
      };
      this.sessionWaiters.add(waiter);
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }
    if (!child.stdin.destroyed) {
      child.stdin.end();
    }
    await waitForProcessClose(child, 2000);
    if (!child.killed) {
      child.kill("SIGTERM");
      await waitForProcessClose(child, 3000);
    }
    if (!child.killed) {
      child.kill("SIGKILL");
      await waitForProcessClose(child, 1000);
    }
    this.alive = false;
    this.child = null;
    this.sessionId = "";
    this.resumeSessionId = "";
    this.activeThreadId = "";
    this.pendingTurnId = "";
    this.rejectSessionWaiters(new Error("claudecode process closed"));
  }

  private handleSystem(raw: UnknownRecord): void {
    const sessionId = normalizeString(raw.session_id);
    if (!sessionId) {
      return;
    }
    if (isPendingThreadId(this.activeThreadId)) {
      this.activeThreadId = sessionId;
    }
    this.sessionId = sessionId;
    this.resumeSessionId = "";
    this.resolveSessionWaiters(sessionId);
    this.emit({ type: "session.id", sessionId }, raw);
  }

  private handleAssistant(raw: UnknownRecord): void {
    const message = asRecord(raw.message);
    const usage = asRecord(message.usage);
    if (Object.keys(usage).length) {
      this.emit({
        type: "context.updated",
        usage,
        modelContextWindow: this.modelContextWindow,
        turnId: this.pendingTurnId,
        sessionId: this.activeThreadId || this.sessionId,
      }, raw);
    }
    const content = message.content;
    if (!Array.isArray(content)) {
      return;
    }
    for (const item of content) {
      const record = asRecord(item);
      const itemType = normalizeString(record.type);
      if (itemType === "text" && typeof record.text === "string" && record.text) {
        this.emit({
          type: "reply.completed",
          text: record.text,
          turnId: this.pendingTurnId,
          sessionId: this.activeThreadId || this.sessionId,
        }, raw);
      } else if (itemType === "tool_use") {
        const toolName = normalizeString(record.name);
        if (toolName === "AskUserQuestion") {
          continue;
        }
        this.emit({
          type: "tool.use",
          toolName,
          input: asRecord(record.input),
          turnId: this.pendingTurnId,
          sessionId: this.activeThreadId || this.sessionId,
        }, raw);
      }
    }
  }

  private handleUser(raw: UnknownRecord): void {
    const message = asRecord(raw.message);
    const content = message.content;
    if (!Array.isArray(content)) {
      return;
    }
    for (const item of content) {
      const record = asRecord(item);
      if (record.type === "tool_result") {
        this.emit({
          type: "tool.result",
          toolResult: normalizeString(record.content),
          isError: Boolean(record.is_error),
          turnId: this.pendingTurnId,
          sessionId: this.activeThreadId || this.sessionId,
        }, raw);
      }
    }
  }

  private handleResult(raw: UnknownRecord): void {
    const sessionId = normalizeString(raw.session_id);
    if (sessionId) {
      this.sessionId = sessionId;
      this.resumeSessionId = "";
    }
    this.emit({
      type: "turn.completed",
      turnId: this.pendingTurnId,
      sessionId: this.activeThreadId || this.sessionId,
      text: typeof raw.result === "string" ? raw.result : "",
    }, raw);
    this.pendingTurnId = "";
    this.activeThreadId = "";
  }

  private handleControlRequest(raw: UnknownRecord): void {
    const request = asRecord(raw.request);
    if (request.subtype !== "can_use_tool") {
      return;
    }
    this.emit({
      type: "approval.requested",
      requestId: normalizeString(raw.request_id) || String(raw.request_id || ""),
      toolName: normalizeString(request.tool_name),
      input: asRecord(request.input),
      sessionId: this.activeThreadId || this.sessionId,
      turnId: this.pendingTurnId,
    }, raw);
  }

  private resolveSessionWaiters(sessionId: string): void {
    for (const entry of this.sessionWaiters) {
      clearTimeout(entry.timer);
      entry.resolve(sessionId);
    }
    this.sessionWaiters.clear();
  }

  private rejectSessionWaiters(error: Error): void {
    for (const entry of this.sessionWaiters) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.sessionWaiters.clear();
  }
}

export function buildClaudeCodeArgs({
  model = "",
  permissionMode = "default",
  disableVerbose = false,
  extraArgs = [],
  mcpConfigPaths = [],
  strictMcpConfig = false,
  resumeSessionId = "",
}: ClaudeCodeArgsConfig): string[] {
  const args = [
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--permission-prompt-tool", "stdio",
  ];
  if (!disableVerbose) {
    args.push("--verbose");
  }
  const normalizedPermissionMode = normalizeString(permissionMode);
  if (normalizedPermissionMode && normalizedPermissionMode !== "default") {
    args.push("--permission-mode", normalizedPermissionMode);
  }
  if (isValidClaudeSessionId(resumeSessionId)) {
    args.push("--resume", normalizeString(resumeSessionId));
  }
  const normalizedModel = normalizeString(model);
  if (normalizedModel) {
    args.push("--model", normalizedModel);
  }
  if (Array.isArray(mcpConfigPaths)) {
    for (const configPath of mcpConfigPaths) {
      const normalizedConfigPath = normalizeString(configPath);
      if (normalizedConfigPath) {
        args.push("--mcp-config", normalizedConfigPath);
      }
    }
  }
  if (strictMcpConfig) {
    args.push("--strict-mcp-config");
  }
  args.push(...filterSafeExtraArgs(extraArgs));
  return args;
}

export function filterClaudeCodeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (key !== "CLAUDECODE") {
      nextEnv[key] = value;
    }
  }
  return nextEnv;
}

export function isPotentiallySensitiveClaudeCodeText(text: unknown): boolean {
  const normalized = normalizeString(text);
  return SENSITIVE_KEYWORDS.test(normalized) || SENSITIVE_PATTERNS.test(normalized);
}

export function isValidClaudeSessionId(value: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(normalizeString(value));
}

function filterSafeExtraArgs(extraArgs: unknown): string[] {
  if (!Array.isArray(extraArgs)) {
    return [];
  }
  const safeArgs: string[] = [];
  let skipNext = false;
  for (const arg of extraArgs) {
    const normalized = normalizeString(arg);
    if (!normalized) {
      continue;
    }
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (/^-[ce]$/iu.test(normalized)) {
      skipNext = true;
      continue;
    }
    if (/^-[ce]=/iu.test(normalized)) {
      continue;
    }
    safeArgs.push(normalized);
  }
  return safeArgs;
}

function parseJsonLine(line: string): UnknownRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPendingThreadId(threadId: unknown): boolean {
  return /^pending-\d+$/u.test(normalizeString(threadId));
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function waitForProcessClose(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return Promise.race([
    new Promise<void>((resolve) => {
      child.once("close", () => resolve());
    }),
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

const SENSITIVE_KEYWORDS = /\b(?:key|token|secret|password|credential|api[_-]?key|auth[_-]?token|access[_-]?token|private[_-]?key)\b/iu;
const SENSITIVE_PATTERNS = /\b(?:sk-[a-zA-Z0-9]{20,}|Bearer\s+[a-zA-Z0-9_\-]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36})\b/iu;
