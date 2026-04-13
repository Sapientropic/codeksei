import { normalizeText } from "../core/text-normalization";
import { loadPersistedContextTokens } from "../adapters/channel/weixin/context-token-store";
import type { SessionBinding } from "../contracts/session-state";

interface ConfigLike extends Record<string, unknown> {
  allowedUserIds?: unknown;
  workspaceId?: unknown;
  workspaceRoot?: unknown;
}

interface BindingKeyArgs {
  workspaceId: string;
  accountId: string;
  senderId: string;
}

type SessionBindingLike = Partial<SessionBinding> & Record<string, unknown>;

interface SenderResolutionSessionStoreLike {
  state?: {
    bindings?: Record<string, SessionBindingLike>;
  };
  getBinding(bindingKey: string): SessionBindingLike | null;
}

interface WorkspaceResolutionSessionStoreLike extends SenderResolutionSessionStoreLike {
  buildBindingKey(args: BindingKeyArgs): string;
  getActiveWorkspaceRoot(bindingKey: string): string;
}

interface ResolvePreferredSenderIdArgs {
  config: ConfigLike;
  accountId: string;
  explicitUser?: string;
  sessionStore?: SenderResolutionSessionStoreLike | null;
}

interface ResolvePreferredWorkspaceRootArgs {
  config: ConfigLike;
  accountId: string;
  senderId?: string;
  explicitWorkspace?: string;
  sessionStore?: WorkspaceResolutionSessionStoreLike | null;
}

export interface PreferredTargetResolution {
  ambiguous: boolean;
  candidates: string[];
  reason: string;
  source: string;
  value: string;
}

export function resolvePreferredSenderId({
  config,
  accountId,
  explicitUser = "",
  sessionStore = null,
}: ResolvePreferredSenderIdArgs): string {
  return inspectPreferredSenderId({
    config,
    accountId,
    explicitUser,
    sessionStore,
  }).value;
}

export function resolvePreferredWorkspaceRoot({
  config,
  accountId,
  senderId = "",
  explicitWorkspace = "",
  sessionStore = null,
}: ResolvePreferredWorkspaceRootArgs): string {
  return inspectPreferredWorkspaceRoot({
    config,
    accountId,
    senderId,
    explicitWorkspace,
    sessionStore,
  }).value;
}

export function inspectPreferredSenderId({
  config,
  accountId,
  explicitUser = "",
  sessionStore = null,
}: ResolvePreferredSenderIdArgs): PreferredTargetResolution {
  const normalizedExplicitUser = normalizeText(explicitUser);
  if (normalizedExplicitUser) {
    return {
      ambiguous: false,
      candidates: [normalizedExplicitUser],
      reason: "explicit_user",
      source: "explicit_user",
      value: normalizedExplicitUser,
    };
  }

  const configuredUsers = Array.isArray(config?.allowedUserIds)
    ? config.allowedUserIds.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  if (configuredUsers.length === 1) {
    return {
      ambiguous: false,
      candidates: configuredUsers,
      reason: "unique_config_allowed_user",
      source: "config.allowedUserIds",
      value: configuredUsers[0] || "",
    };
  }
  if (configuredUsers.length > 1) {
    return {
      ambiguous: true,
      candidates: configuredUsers,
      reason: "multiple_config_allowed_users",
      source: "config.allowedUserIds",
      value: "",
    };
  }

  const bindingCandidates = collectBindingSenderIds({ config, accountId, sessionStore });
  if (bindingCandidates.length === 1) {
    return {
      ambiguous: false,
      candidates: bindingCandidates,
      reason: "unique_session_binding",
      source: "session.bindings",
      value: bindingCandidates[0] || "",
    };
  }
  if (bindingCandidates.length > 1) {
    return {
      ambiguous: true,
      candidates: bindingCandidates,
      reason: "multiple_session_bindings",
      source: "session.bindings",
      value: "",
    };
  }

  const persistedUserIds = Object.keys(loadPersistedContextTokens(config, accountId) || {})
    .map((value) => normalizeText(value))
    .filter(Boolean);
  if (persistedUserIds.length === 1) {
    return {
      ambiguous: false,
      candidates: persistedUserIds,
      reason: "unique_context_token",
      source: "context_tokens",
      value: persistedUserIds[0] || "",
    };
  }
  if (persistedUserIds.length > 1) {
    return {
      ambiguous: true,
      candidates: persistedUserIds,
      reason: "multiple_context_tokens",
      source: "context_tokens",
      value: "",
    };
  }

  return {
    ambiguous: false,
    candidates: [],
    reason: "missing_sender",
    source: "",
    value: "",
  };
}

export function inspectPreferredWorkspaceRoot({
  config,
  accountId,
  senderId = "",
  explicitWorkspace = "",
  sessionStore = null,
}: ResolvePreferredWorkspaceRootArgs): PreferredTargetResolution {
  const normalizedExplicitWorkspace = normalizeText(explicitWorkspace);
  if (normalizedExplicitWorkspace) {
    return {
      ambiguous: false,
      candidates: [normalizedExplicitWorkspace],
      reason: "explicit_workspace",
      source: "explicit_workspace",
      value: normalizedExplicitWorkspace,
    };
  }

  const normalizedSenderId = normalizeText(senderId);
  const normalizedAccountId = normalizeText(accountId);
  const store = sessionStore && typeof sessionStore.getBinding === "function"
    ? sessionStore
    : null;

  if (store && normalizedSenderId && normalizedAccountId) {
    const bindingKey = store.buildBindingKey({
      workspaceId: normalizeText(config.workspaceId),
      accountId: normalizedAccountId,
      senderId: normalizedSenderId,
    });
    const activeWorkspaceRoot = normalizeText(store.getActiveWorkspaceRoot(bindingKey));
    if (activeWorkspaceRoot) {
      return {
        ambiguous: false,
        candidates: [activeWorkspaceRoot],
        reason: "active_binding_workspace",
        source: "session.activeWorkspaceRoot",
        value: activeWorkspaceRoot,
      };
    }

    const binding = store.getBinding(bindingKey);
    const boundWorkspaceRoots = collectWorkspaceRoots(binding);
    if (boundWorkspaceRoots.length === 1) {
      return {
        ambiguous: false,
        candidates: boundWorkspaceRoots,
        reason: "unique_binding_workspace",
        source: "session.bindingWorkspaceRoots",
        value: boundWorkspaceRoots[0] || "",
      };
    }
    if (boundWorkspaceRoots.length > 1) {
      return {
        ambiguous: true,
        candidates: boundWorkspaceRoots,
        reason: "multiple_binding_workspaces",
        source: "session.bindingWorkspaceRoots",
        value: "",
      };
    }
  }

  const globalWorkspaceCandidates = collectBindingWorkspaceRoots({ config, accountId, sessionStore: store });
  if (globalWorkspaceCandidates.length === 1) {
    return {
      ambiguous: false,
      candidates: globalWorkspaceCandidates,
      reason: "unique_workspace_binding",
      source: "session.workspaceBindings",
      value: globalWorkspaceCandidates[0] || "",
    };
  }
  if (globalWorkspaceCandidates.length > 1) {
    return {
      ambiguous: true,
      candidates: globalWorkspaceCandidates,
      reason: "multiple_workspace_bindings",
      source: "session.workspaceBindings",
      value: "",
    };
  }

  const configuredWorkspaceRoot = normalizeText(config?.workspaceRoot);
  if (configuredWorkspaceRoot) {
    return {
      ambiguous: false,
      candidates: [configuredWorkspaceRoot],
      reason: "config_workspace_root",
      source: "config.workspaceRoot",
      value: configuredWorkspaceRoot,
    };
  }

  return {
    ambiguous: false,
    candidates: [],
    reason: "missing_workspace",
    source: "",
    value: "",
  };
}

function collectBindingSenderIds({
  config,
  accountId,
  sessionStore,
}: {
  config: ConfigLike;
  accountId: string;
  sessionStore?: SenderResolutionSessionStoreLike | null;
}): string[] {
  const store = sessionStore && typeof sessionStore.getBinding === "function"
    ? sessionStore
    : null;
  if (!store) {
    return [];
  }
  const normalizedAccountId = normalizeText(accountId);
  if (!normalizedAccountId) {
    return [];
  }

  const senderIds = new Set<string>();
  for (const binding of Object.values(store.state?.bindings || {})) {
    const bindingAccountId = normalizeText(binding?.accountId);
    const bindingWorkspaceId = normalizeText(binding?.workspaceId);
    const senderId = normalizeText(binding?.senderId);
    if (!senderId || bindingAccountId !== normalizedAccountId) {
      continue;
    }
    if (bindingWorkspaceId && bindingWorkspaceId !== normalizeText(config?.workspaceId)) {
      continue;
    }
    senderIds.add(senderId);
  }
  return Array.from(senderIds).sort((left, right) => left.localeCompare(right));
}

function collectBindingWorkspaceRoots({
  config,
  accountId,
  sessionStore,
}: {
  config: ConfigLike;
  accountId: string;
  sessionStore?: SenderResolutionSessionStoreLike | null;
}): string[] {
  const store = sessionStore && typeof sessionStore.getBinding === "function"
    ? sessionStore
    : null;
  if (!store) {
    return [];
  }
  const normalizedAccountId = normalizeText(accountId);
  const workspaceRoots = new Set<string>();

  for (const binding of Object.values(store.state?.bindings || {})) {
    const bindingAccountId = normalizeText(binding?.accountId);
    const bindingWorkspaceId = normalizeText(binding?.workspaceId);
    if (bindingAccountId !== normalizedAccountId) {
      continue;
    }
    if (bindingWorkspaceId && bindingWorkspaceId !== normalizeText(config?.workspaceId)) {
      continue;
    }
    for (const workspaceRoot of collectWorkspaceRoots(binding)) {
      workspaceRoots.add(workspaceRoot);
    }
  }

  return Array.from(workspaceRoots).sort((left, right) => left.localeCompare(right));
}

function collectWorkspaceRoots(binding: SessionBindingLike | null | undefined): string[] {
  const workspaceRoots = new Set<string>();
  const activeWorkspaceRoot = normalizeText(binding?.activeWorkspaceRoot);
  if (activeWorkspaceRoot) {
    workspaceRoots.add(activeWorkspaceRoot);
  }
  for (const workspaceRoot of Object.keys(binding?.threadIdByWorkspaceRoot || {})) {
    const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
    if (normalizedWorkspaceRoot) {
      workspaceRoots.add(normalizedWorkspaceRoot);
    }
  }
  for (const workspaceRoot of Object.keys(binding?.codexParamsByWorkspaceRoot || {})) {
    const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
    if (normalizedWorkspaceRoot) {
      workspaceRoots.add(normalizedWorkspaceRoot);
    }
  }
  return Array.from(workspaceRoots).sort((left, right) => left.localeCompare(right));
}

