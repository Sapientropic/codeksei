import type {
  AppRuntimeConfig,
  ChannelAdapterLike,
  RuntimeAdapterLike,
  SessionStoreLike,
  SessionStoreWriterLike,
} from "./app-service-contract";
import { formatBridgeOnlyCommandMessage, resolveHostMode, type HostModeResolution } from "./host-mode";
import type { RuntimeEvent } from "../contracts/runtime-events";
import type { PendingApprovalState, ThreadBindingRef, UnknownRecord } from "./runtime-types";
import { getHostProfileMatrixEntry } from "./host-profile-matrix";

const EMPTY_SESSION_STORE: SessionStoreLike = {
  state: { bindings: {} },
  buildBindingKey() {
    return "";
  },
  findBindingForThreadId(): ThreadBindingRef | null {
    return null;
  },
  getActiveWorkspaceRoot() {
    return "";
  },
  getApprovalCommandAllowlistForWorkspace() {
    return [];
  },
  getAvailableModelCatalog() {
    return null;
  },
  getBinding() {
    return null;
  },
  getRuntimeParamsForWorkspace() {
    return { model: "", effort: "" };
  },
  getPendingApprovalForThread(threadId: string): PendingApprovalState | null {
    void threadId;
    return null;
  },
  getThreadIdForWorkspace() {
    return "";
  },
  listBindings() {
    return [];
  },
  listPendingApprovals() {
    return [];
  },
};

const EMPTY_SESSION_WRITER: SessionStoreWriterLike = {
  async clearApprovalPrompt() {},
  async clearPendingApprovalForThread() {},
  async rememberApprovalPrefixForWorkspace() {
    return [];
  },
  async rememberPendingApprovalForThread() {
    return null;
  },
  async rememberWorkspaceBootstrapForThread() {
    return null;
  },
  async setActiveWorkspaceRoot() {
    return null;
  },
  async setAvailableModelCatalog() {
    return null;
  },
  async setRuntimeParamsForWorkspace() {
    return null;
  },
  async setThreadIdForWorkspace() {
    return null;
  },
  async clearThreadIdForWorkspace() {
    return null;
  },
};

type HostedModeConfig = Pick<
  AppRuntimeConfig,
  | "channel"
  | "channelProvider"
  | "hermesCommand"
  | "hermesHome"
  | "reviewSemanticHost"
  | "runtime"
  | "workspaceRoot"
>;

function createModeError(resolved: HostModeResolution, commandLabel: string): Error {
  return new Error(formatBridgeOnlyCommandMessage(resolved, commandLabel));
}

export function createHostedChannelAdapter(config: HostedModeConfig): ChannelAdapterLike {
  const resolved = resolveHostMode(config);
  const matrixEntry = getHostProfileMatrixEntry(resolved.profile);
  return {
    describe() {
      return {
        id: "hermes-weixin",
        kind: "channel",
        provider: "hermes",
        operations: { ...matrixEntry.channelOperations },
        profile: resolved.profile,
        mode: resolved.mode,
        supported: resolved.supported,
        channel: resolved.channel,
        capabilities: resolved.capabilities,
      };
    },
    getKnownContextTokens() {
      return {};
    },
    getUpdates() {
      return Promise.reject(createModeError(resolved, "codeksei start"));
    },
    loadSyncBuffer() {
      return "";
    },
    login() {
      return Promise.reject(createModeError(resolved, "codeksei login"));
    },
    normalizeIncomingMessage() {
      return null;
    },
    printAccounts() {
      throw createModeError(resolved, "codeksei accounts");
    },
    resolveAccount() {
      throw createModeError(resolved, "codeksei start");
    },
    sendFile() {
      return Promise.reject(createModeError(resolved, "Codeksei hosted bridge file delivery"));
    },
    sendText() {
      return Promise.reject(createModeError(resolved, "Codeksei hosted bridge text delivery"));
    },
    sendTyping() {
      return Promise.reject(createModeError(resolved, "Codeksei hosted bridge typing delivery"));
    },
  };
}

export interface HostedRuntimeAdapter extends RuntimeAdapterLike {
  getSessionStore(): SessionStoreLike;
  getSessionWriter(): SessionStoreWriterLike;
}

export function createHostedRuntimeAdapter(config: HostedModeConfig): HostedRuntimeAdapter {
  const resolved = resolveHostMode(config);
  const matrixEntry = getHostProfileMatrixEntry(resolved.profile);
  return {
    describe() {
      return {
        id: resolved.runtime === "hermes" ? "hermes" : "unsupported-runtime",
        kind: "runtime",
        provider: resolved.runtime,
        operations: { ...matrixEntry.runtimeOperations },
        profile: resolved.profile,
        mode: resolved.mode,
        supported: resolved.supported,
        channelProvider: resolved.channelProvider,
        capabilities: resolved.capabilities,
      };
    },
    getSessionStore() {
      return EMPTY_SESSION_STORE;
    },
    getSessionWriter() {
      return EMPTY_SESSION_WRITER;
    },
    initialize() {
      return Promise.reject(createModeError(resolved, "codeksei start"));
    },
    async close() {},
    onEvent(_listener: (event: RuntimeEvent<UnknownRecord>) => void) {
      return () => {};
    },
    probeRuntimeCapabilities() {
      return null;
    },
    refreshThreadInstructions() {
      return Promise.reject(createModeError(resolved, "Codeksei bridge runtime refresh"));
    },
    respondApproval() {
      return Promise.reject(createModeError(resolved, "Codeksei bridge approval"));
    },
    resumeThread() {
      return Promise.reject(createModeError(resolved, "Codeksei bridge runtime resume"));
    },
    cancelTurn() {
      return Promise.reject(createModeError(resolved, "Codeksei bridge runtime cancel"));
    },
    sendTextTurn() {
      return Promise.reject(createModeError(resolved, "Codeksei bridge runtime send"));
    },
  };
}
