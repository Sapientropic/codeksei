import { spawn } from "node:child_process";
import { PRIMARY_RPC_CLIENT_INFO } from "../../../core/branding";
import {
  createRpcEnvelopeRouter,
  type PendingEntry,
  type RpcEnvelopeRouter,
  type RpcMessageListener,
} from "./rpc-envelope-router";
import {
  buildListThreadsParams,
  buildStartThreadParams,
  buildTurnInputPayload,
  buildTurnStartParams,
  normalizeNonEmptyString,
  normalizeWritableRoots,
  resolveDefaultCodexCommand,
} from "./rpc-request-builders";
import {
  createRpcTransport,
  type RpcTransport,
  type SpawnChildLike,
  type SpawnLike,
  type TransportMode,
} from "./rpc-transport";


const CODEX_CLIENT_INFO = PRIMARY_RPC_CLIENT_INFO;

interface CodexRpcClientOptions {
  endpoint?: string;
  env?: NodeJS.ProcessEnv;
  codexCommand?: string;
  extraWritableRoots?: unknown[];
  spawnImpl?: SpawnLike;
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
  codexCommand: string;
  endpoint: string;
  envelopeRouter: RpcEnvelopeRouter;
  env: NodeJS.ProcessEnv;
  extraWritableRoots: string[];
  isReady: boolean;
  spawnImpl: SpawnLike;
  transport: RpcTransport;

  constructor({
    endpoint = "",
    env = process.env,
    codexCommand = "",
    extraWritableRoots = [],
    spawnImpl,
  }: CodexRpcClientOptions = {}) {
    this.endpoint = endpoint;
    this.env = env;
    this.codexCommand = codexCommand || resolveDefaultCodexCommand(env);
    this.extraWritableRoots = normalizeWritableRoots(extraWritableRoots);
    this.spawnImpl = spawnImpl || spawn;
    this.isReady = false;

    this.transport = createRpcTransport({
      endpoint,
      env,
      codexCommand: this.codexCommand,
      spawnImpl: this.spawnImpl,
      onIncoming: (rawMessage) => {
        this.envelopeRouter.handleIncoming(rawMessage);
      },
      onClosed: (message) => {
        this.isReady = false;
        this.envelopeRouter.rejectPending(new Error(message));
      },
    });
    this.envelopeRouter = createRpcEnvelopeRouter({
      sendRaw: (payload) => this.transport.sendRaw(payload),
    });
  }

  async connect(): Promise<void> {
    await this.transport.connect();
  }

  isConnected(): boolean {
    return this.transport.isConnected();
  }

  onMessage(listener: RpcMessageListener): () => boolean {
    return this.envelopeRouter.onMessage(listener);
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
    this.envelopeRouter.rejectPending(new Error("Codex RPC client closed"));
    this.isReady = false;
    await this.transport.close();
  }

  async sendRequest(method: string, params: unknown): Promise<unknown> {
    return this.envelopeRouter.sendRequest(method, params);
  }

  async sendNotification(method: string, params: unknown): Promise<void> {
    await this.envelopeRouter.sendNotification(method, params);
  }

  async sendResponse(id: unknown, result: unknown): Promise<void> {
    await this.envelopeRouter.sendResponse(id, result);
  }

  sendRaw(payload: string): void {
    this.transport.sendRaw(payload);
  }

  handleIncoming(rawMessage: string): void {
    this.envelopeRouter.handleIncoming(rawMessage);
  }

  get child(): SpawnChildLike | null {
    return this.transport.state.child;
  }

  get messageListeners(): Set<RpcMessageListener> {
    return this.envelopeRouter.messageListeners;
  }

  get mode(): TransportMode {
    return this.transport.state.mode;
  }

  get pending(): Map<string, PendingEntry> {
    return this.envelopeRouter.pending;
  }

  get socket() {
    return this.transport.state.socket;
  }

  get stderrBuffer(): string {
    return this.transport.state.stderrBuffer;
  }

  get stdoutBuffer(): string {
    return this.transport.state.stdoutBuffer;
  }
}
