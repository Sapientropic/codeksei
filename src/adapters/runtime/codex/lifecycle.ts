import { normalizeText } from "../../../core/text-normalization";
import { CodexRpcClient } from "./rpc-client";
import type { RuntimeClientLike } from "./diagnostics";


interface CodexRuntimeConfig extends Record<string, unknown> {
  stateDir: string;
  codexEndpoint?: string;
  codexCommand?: string;
  sessionsFile: string;
}

interface SessionStoreLike {
  setAvailableModelCatalog(models: unknown): Promise<unknown>;
}

interface ReadyState {
  endpoint: string;
  models: unknown[];
}

interface RpcModelListResponse extends Record<string, unknown> {
  result?: {
    data?: unknown[];
  };
}

export function createRuntimeLifecycle({
  config,
  sessionWriter,
}: {
  config: CodexRuntimeConfig;
  sessionWriter: SessionStoreLike;
}) {
  let client: RuntimeClientLike | null = null;
  let readyState: ReadyState | null = null;

  function ensureClient(): RuntimeClientLike {
    if (!client) {
      client = new CodexRpcClient({
        endpoint: normalizeText(config.codexEndpoint),
        codexCommand: normalizeText(config.codexCommand),
        env: process.env,
        extraWritableRoots: [config.stateDir],
      }) as RuntimeClientLike;
    }
    return client;
  }

  async function refreshReadyState(runtimeClient: RuntimeClientLike): Promise<ReadyState> {
    const modelResponse = await runtimeClient.listModels().catch(() => null) as RpcModelListResponse | null;
    const models = Array.isArray(modelResponse?.result?.data)
      ? modelResponse.result.data
      : [];
    if (models.length) {
      await sessionWriter.setAvailableModelCatalog(models);
    }
    readyState = {
      endpoint: normalizeText(config.codexEndpoint) || "(spawn)",
      models,
    };
    return readyState;
  }

  async function ensureInitialized({
    forceReconnect = false,
  }: { forceReconnect?: boolean } = {}): Promise<ReadyState> {
    const runtimeClient = ensureClient();
    if (forceReconnect) {
      readyState = null;
      await runtimeClient.close();
    }
    if (readyState && runtimeClient.isConnected()) {
      return readyState;
    }
    await runtimeClient.connect();
    await runtimeClient.initialize();
    return refreshReadyState(runtimeClient);
  }

  async function withRuntimeReconnect<T>(
    action: (runtimeClient: RuntimeClientLike) => Promise<T>,
  ): Promise<T> {
    const runtimeClient = ensureClient();
    try {
      await ensureInitialized();
      return await action(runtimeClient);
    } catch (error) {
      if (!isReconnectableRuntimeError(error)) {
        throw error;
      }
      await ensureInitialized({ forceReconnect: true });
      return action(runtimeClient);
    }
  }

  async function close(): Promise<void> {
    if (client) {
      await client.close();
    }
    readyState = null;
    client = null;
  }

  function describe() {
    return {
      id: "codex" as const,
      kind: "runtime" as const,
      endpoint: normalizeText(config.codexEndpoint) || "(spawn)",
      sessionsFile: config.sessionsFile,
    };
  }

  return {
    createClient: ensureClient,
    ensureInitialized,
    withRuntimeReconnect,
    close,
    describe,
  };
}

function isReconnectableRuntimeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("Codex websocket is not connected")
    || message.includes("Codex websocket closed")
    || message.includes("Codex websocket errored")
    || message.includes("Codex process stdin is not writable")
    || message.includes("Codex RPC client closed");
}

