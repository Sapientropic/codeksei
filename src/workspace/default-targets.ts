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

export function resolvePreferredSenderId({
  config,
  accountId,
  explicitUser = "",
  sessionStore = null,
}: ResolvePreferredSenderIdArgs): string {
  const normalizedExplicitUser = normalizeText(explicitUser);
  if (normalizedExplicitUser) {
    return normalizedExplicitUser;
  }

  const configuredUsers = Array.isArray(config?.allowedUserIds)
    ? config.allowedUserIds.map((value) => normalizeText(value)).filter(Boolean)
    : [];
  if (configuredUsers.length) {
    return configuredUsers[0] || "";
  }

  const bindingCandidates = collectBindingSenderIds({ config, accountId, sessionStore });
  if (bindingCandidates.length === 1) {
    return bindingCandidates[0] || "";
  }

  // This stays as a read-only fallback: default-target inference needs the
  // persisted sender/context-token map, but should not own any adapter write
  // path or transport behavior.
  const persistedUserIds = Object.keys(loadPersistedContextTokens(config, accountId) || {})
    .map((value) => normalizeText(value))
    .filter(Boolean);
  if (persistedUserIds.length === 1) {
    return persistedUserIds[0] || "";
  }

  return "";
}

export function resolvePreferredWorkspaceRoot({
  config,
  accountId,
  senderId = "",
  explicitWorkspace = "",
  sessionStore = null,
}: ResolvePreferredWorkspaceRootArgs): string {
  const normalizedExplicitWorkspace = normalizeText(explicitWorkspace);
  if (normalizedExplicitWorkspace) {
    return normalizedExplicitWorkspace;
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
      return activeWorkspaceRoot;
    }

    const binding = store.getBinding(bindingKey);
    const boundWorkspaceRoots = collectWorkspaceRoots(binding);
    if (boundWorkspaceRoots.length === 1) {
      return boundWorkspaceRoots[0] || "";
    }
  }

  const globalWorkspaceCandidates = collectBindingWorkspaceRoots({ config, accountId, sessionStore: store });
  if (globalWorkspaceCandidates.length === 1) {
    return globalWorkspaceCandidates[0] || "";
  }

  return normalizeText(config?.workspaceRoot);
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

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
