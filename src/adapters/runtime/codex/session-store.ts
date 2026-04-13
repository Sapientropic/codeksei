import {
  createEmptySessionState,
  normalizePendingApprovalRecord,
  normalizeSessionBinding,
  normalizeSessionState,
  sessionStoreStateSchema,
  type PendingApprovalRecord,
  type SessionBinding,
  type SessionState,
} from "../../../contracts/session-state";
import {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} from "../../../state/json-state";
import * as modelCatalogModule from "./model-catalog";
import {
  createEmptySessionBinding,
  getCodexParamsMap,
  getThreadMap,
  getWorkspaceBootstrapThreadMap,
  isRecord,
  normalizeValue,
  type BindingRef,
  type CodexWorkspaceParams,
  type SessionBindingUpdate,
} from "./session-store-bindings";
import {
  getApprovalAllowlistByWorkspaceRoot,
  isSameTokenList,
  normalizeCommandTokens,
  type PendingApprovalUpdate,
} from "./session-store-approvals";
import { withSessionStoreLock } from "./session-store-lock";

const { normalizeModelCatalog } = modelCatalogModule as {
  normalizeModelCatalog: (models: unknown) => NormalizedModelCatalogEntry[];
};

interface SessionStoreConfig {
  filePath: string;
}

interface NormalizedModelCatalogEntry {
  id: string;
  model: string;
  displayName: string;
  supportedReasoningEfforts: string[];
  defaultReasoningEffort: string;
  isDefault: boolean;
}

interface AvailableModelCatalogView {
  models: NormalizedModelCatalogEntry[];
  updatedAt: string;
}

export class SessionStore {
  readonly filePath: string;
  readonly lockFilePath: string;
  state: SessionState;

  constructor({ filePath }: SessionStoreConfig) {
    this.filePath = filePath;
    this.lockFilePath = `${filePath}.lock`;
    this.state = createEmptySessionState();
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory(): void {
    ensureParentDirectory(this.filePath);
    ensureParentDirectory(this.lockFilePath);
  }

  load(): void {
    this.state = this.readLatestState();
  }

  private readLatestState(): SessionState {
    // sessionStoreStateSchema already canonicalizes persisted session JSON.
    // Keep compatibility logic at that ingress so reads do not silently apply
    // a second round of shape repair in every store call site.
    const loadedState = readManagedJsonStateFile({
      filePath: this.filePath,
      fallback: createEmptySessionState(),
      label: "session store",
      schema: sessionStoreStateSchema,
    }) as SessionState;
    return normalizeSessionState(loadedState);
  }

  private refresh(): SessionState {
    this.state = this.readLatestState();
    return this.state;
  }

  private writeCurrentState(): void {
    this.state = normalizeSessionState(this.state);
    writeManagedJsonStateFile(this.filePath, this.state);
  }

  private withFileLock<T>(work: () => T): T {
    return withSessionStoreLock(this.lockFilePath, work);
  }

  private mutateState<T>(mutator: (state: SessionState) => T): T {
    return this.withFileLock(() => {
      this.state = this.readLatestState();
      const result = mutator(this.state);
      this.writeCurrentState();
      return result;
    });
  }

  getBinding(bindingKey: unknown): SessionBinding | null {
    const binding = this.refresh().bindings[normalizeValue(bindingKey)];
    return binding ? normalizeSessionBinding(binding) : null;
  }

  listBindings(): Array<SessionBinding & { bindingKey: string }> {
    return Object.entries(this.refresh().bindings || {}).map(([bindingKey, binding]) => ({
      bindingKey,
      ...(binding || {}),
    }));
  }

  getActiveWorkspaceRoot(bindingKey: unknown): string {
    const activeWorkspaceRoot = this.refresh().bindings[normalizeValue(bindingKey)]?.activeWorkspaceRoot;
    return typeof activeWorkspaceRoot === "string" ? activeWorkspaceRoot : "";
  }

  updateBinding(bindingKey: unknown, nextBinding: SessionBindingUpdate): SessionBinding | null {
    const normalizedBindingKey = normalizeValue(bindingKey);
    if (!normalizedBindingKey) {
      return null;
    }
    return this.mutateState((state) => {
      const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
      const normalizedBinding = normalizeSessionBinding({
        ...current,
        ...nextBinding,
        updatedAt: new Date().toISOString(),
      });
      state.bindings = {
        ...(state.bindings || {}),
        [normalizedBindingKey]: normalizedBinding,
      };
      return normalizeSessionBinding(state.bindings[normalizedBindingKey]);
    });
  }

  getThreadIdForWorkspace(bindingKey: unknown, workspaceRoot: unknown): string {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return "";
    }
    const threadId = this.refresh().bindings[normalizeValue(bindingKey)]?.threadIdByWorkspaceRoot?.[normalizedWorkspaceRoot];
    return typeof threadId === "string" ? threadId : "";
  }

  setThreadIdForWorkspace(
    bindingKey: unknown,
    workspaceRoot: unknown,
    threadId: unknown,
    extra: Record<string, unknown> = {},
  ): SessionBinding | null {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    const normalizedBindingKey = normalizeValue(bindingKey);
    if (!normalizedBindingKey) {
      return null;
    }

    return this.mutateState((state) => {
      const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
      const existingWorkspaceBootstrapMap = getWorkspaceBootstrapThreadMap(current);
      const threadIdByWorkspaceRoot = {
        ...getThreadMap(current),
        [normalizedWorkspaceRoot]: normalizedThreadId,
      };
      const workspaceBootstrapThreadIdByWorkspaceRoot = {
        ...existingWorkspaceBootstrapMap,
        [normalizedWorkspaceRoot]:
          existingWorkspaceBootstrapMap[normalizedWorkspaceRoot] === normalizedThreadId
            ? normalizedThreadId
            : "",
      };

      const normalizedBinding = normalizeSessionBinding({
        ...current,
        ...extra,
        activeWorkspaceRoot: normalizedWorkspaceRoot,
        threadIdByWorkspaceRoot,
        workspaceBootstrapThreadIdByWorkspaceRoot,
        updatedAt: new Date().toISOString(),
      });
      state.bindings = {
        ...(state.bindings || {}),
        [normalizedBindingKey]: normalizedBinding,
      };
      return normalizeSessionBinding(state.bindings[normalizedBindingKey]);
    });
  }

  getCodexParamsForWorkspace(bindingKey: unknown, workspaceRoot: unknown): CodexWorkspaceParams {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return { model: "" };
    }
    const current = this.getBinding(bindingKey) || createEmptySessionBinding();
    const codexParamsByWorkspaceRoot = getCodexParamsMap(current);
    const entry = codexParamsByWorkspaceRoot[normalizedWorkspaceRoot];
    return {
      model: typeof entry?.model === "string" ? entry.model : "",
    };
  }

  setCodexParamsForWorkspace(
    bindingKey: unknown,
    workspaceRoot: unknown,
    { model = "" }: { model?: unknown },
  ): SessionBinding | null {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    const normalizedBindingKey = normalizeValue(bindingKey);
    if (!normalizedBindingKey) {
      return null;
    }
    return this.mutateState((state) => {
      const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
      const codexParamsByWorkspaceRoot = {
        ...getCodexParamsMap(current),
        [normalizedWorkspaceRoot]: {
          model: normalizeValue(model),
        },
      };
      const normalizedBinding = normalizeSessionBinding({
        ...current,
        codexParamsByWorkspaceRoot,
        updatedAt: new Date().toISOString(),
      });
      state.bindings = {
        ...(state.bindings || {}),
        [normalizedBindingKey]: normalizedBinding,
      };
      return normalizeSessionBinding(state.bindings[normalizedBindingKey]);
    });
  }

  clearThreadIdForWorkspace(bindingKey: unknown, workspaceRoot: unknown): SessionBinding | null {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    const normalizedBindingKey = normalizeValue(bindingKey);
    if (!normalizedBindingKey) {
      return null;
    }
    return this.mutateState((state) => {
      const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
      const threadIdByWorkspaceRoot = {
        ...getThreadMap(current),
        [normalizedWorkspaceRoot]: "",
      };
      const workspaceBootstrapThreadIdByWorkspaceRoot = {
        ...getWorkspaceBootstrapThreadMap(current),
        [normalizedWorkspaceRoot]: "",
      };
      const normalizedBinding = normalizeSessionBinding({
        ...current,
        threadIdByWorkspaceRoot,
        workspaceBootstrapThreadIdByWorkspaceRoot,
        updatedAt: new Date().toISOString(),
      });
      state.bindings = {
        ...(state.bindings || {}),
        [normalizedBindingKey]: normalizedBinding,
      };
      return normalizeSessionBinding(state.bindings[normalizedBindingKey]);
    });
  }

  setActiveWorkspaceRoot(bindingKey: unknown, workspaceRoot: unknown): SessionBinding | null {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    const normalizedBindingKey = normalizeValue(bindingKey);
    if (!normalizedBindingKey) {
      return null;
    }
    return this.mutateState((state) => {
      const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
      const normalizedBinding = normalizeSessionBinding({
        ...current,
        activeWorkspaceRoot: normalizedWorkspaceRoot,
        updatedAt: new Date().toISOString(),
      });
      state.bindings = {
        ...(state.bindings || {}),
        [normalizedBindingKey]: normalizedBinding,
      };
      return normalizeSessionBinding(state.bindings[normalizedBindingKey]);
    });
  }

  listWorkspaceRoots(bindingKey: unknown): string[] {
    const current = this.getBinding(bindingKey) || createEmptySessionBinding();
    return Object.keys(getThreadMap(current));
  }

  findBindingForThreadId(threadId: unknown): BindingRef | null {
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedThreadId) {
      return null;
    }
    for (const [bindingKey, binding] of Object.entries(this.refresh().bindings || {})) {
      for (const [workspaceRoot, candidateThreadId] of Object.entries(getThreadMap(binding))) {
        if (candidateThreadId === normalizedThreadId) {
          return {
            bindingKey,
            workspaceRoot,
          };
        }
      }
    }
    return null;
  }

  hasWorkspaceBootstrapForThread(bindingKey: unknown, workspaceRoot: unknown, threadId: unknown): boolean {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedWorkspaceRoot || !normalizedThreadId) {
      return false;
    }
    const current = this.getBinding(bindingKey) || createEmptySessionBinding();
    return getWorkspaceBootstrapThreadMap(current)[normalizedWorkspaceRoot] === normalizedThreadId;
  }

  rememberWorkspaceBootstrapForThread(bindingKey: unknown, workspaceRoot: unknown, threadId: unknown): SessionBinding | null {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedWorkspaceRoot || !normalizedThreadId) {
      return this.getBinding(bindingKey);
    }
    const normalizedBindingKey = normalizeValue(bindingKey);
    if (!normalizedBindingKey) {
      return null;
    }
    return this.mutateState((state) => {
      const current = state.bindings[normalizedBindingKey] || createEmptySessionBinding();
      const workspaceBootstrapThreadIdByWorkspaceRoot = {
        ...getWorkspaceBootstrapThreadMap(current),
        [normalizedWorkspaceRoot]: normalizedThreadId,
      };
      const normalizedBinding = normalizeSessionBinding({
        ...current,
        workspaceBootstrapThreadIdByWorkspaceRoot,
        updatedAt: new Date().toISOString(),
      });
      state.bindings = {
        ...(state.bindings || {}),
        [normalizedBindingKey]: normalizedBinding,
      };
      return normalizeSessionBinding(state.bindings[normalizedBindingKey]);
    });
  }

  getApprovalCommandAllowlistForWorkspace(workspaceRoot: unknown): string[][] {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return [];
    }
    const raw = this.refresh().approvalCommandAllowlistByWorkspaceRoot?.[normalizedWorkspaceRoot];
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter((entry): entry is string[] => Array.isArray(entry) && entry.every((part) => typeof part === "string" && Boolean(part)))
      .map((entry) => entry.slice())
      .filter((entry) => entry.length > 0);
  }

  rememberApprovalPrefixForWorkspace(workspaceRoot: unknown, commandTokens: unknown): string[][] {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    const normalizedTokens = normalizeCommandTokens(commandTokens);
    if (!normalizedWorkspaceRoot || !normalizedTokens.length) {
      return this.getApprovalCommandAllowlistForWorkspace(workspaceRoot);
    }
    return this.mutateState((state) => {
      const current = getApprovalAllowlistByWorkspaceRoot(state)[normalizedWorkspaceRoot] || [];
      if (!current.some((entry) => isSameTokenList(entry, normalizedTokens))) {
        current.push(normalizedTokens);
      }
      state.approvalCommandAllowlistByWorkspaceRoot = {
        ...(state.approvalCommandAllowlistByWorkspaceRoot || {}),
        [normalizedWorkspaceRoot]: current.map((entry) => entry.slice()),
      };
      return current.map((entry) => entry.slice());
    });
  }

  getPendingApprovalForThread(threadId: unknown): PendingApprovalRecord | null {
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedThreadId) {
      return null;
    }
    const approval = this.refresh().approvalPromptStateByThreadId?.[normalizedThreadId];
    if (!approval || typeof approval !== "object") {
      return null;
    }
    return { ...approval };
  }

  listPendingApprovals(): Array<{ threadId: string; approval: PendingApprovalRecord }> {
    return Object.entries(this.refresh().approvalPromptStateByThreadId || {}).map(([threadId, approval]) => ({
      threadId,
      approval: { ...approval },
    }));
  }

  rememberPendingApprovalForThread(
    threadId: unknown,
    approval: PendingApprovalUpdate | null | undefined,
    {
      signature = "",
      promptedAt = "",
    }: { signature?: unknown; promptedAt?: unknown } = {},
  ): PendingApprovalRecord | null {
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedThreadId) {
      return null;
    }
    return this.mutateState((state) => {
      const existing = state.approvalPromptStateByThreadId?.[normalizedThreadId] || null;
      const normalizedApproval = normalizePendingApprovalRecord({
        ...(existing || {}),
        ...(approval || {}),
        signature: normalizeValue(signature)
          || normalizeValue(approval?.signature)
          || normalizeValue(existing?.signature)
          || "",
        promptedAt: normalizeValue(promptedAt) || normalizeValue(approval?.promptedAt) || new Date().toISOString(),
      });
      if (!normalizedApproval) {
        return null;
      }
      state.approvalPromptStateByThreadId = {
        ...(state.approvalPromptStateByThreadId || {}),
        [normalizedThreadId]: normalizedApproval,
      };
      return normalizePendingApprovalRecord(state.approvalPromptStateByThreadId[normalizedThreadId]);
    });
  }

  getApprovalPromptState(threadId: unknown): PendingApprovalRecord | null {
    return this.getPendingApprovalForThread(threadId);
  }

  rememberApprovalPrompt(threadId: unknown, requestIdOrApproval: unknown, signature = ""): PendingApprovalRecord | null {
    if (isRecord(requestIdOrApproval)) {
      return this.rememberPendingApprovalForThread(threadId, requestIdOrApproval, { signature });
    }
    const existing = this.getPendingApprovalForThread(threadId) || null;
    return this.rememberPendingApprovalForThread(threadId, {
      ...(existing || {}),
      requestId: normalizeValue(requestIdOrApproval),
    }, {
      signature,
      promptedAt: new Date().toISOString(),
    });
  }

  clearPendingApprovalForThread(threadId: unknown): void {
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedThreadId) {
      return;
    }
    this.mutateState((state) => {
      if (!state.approvalPromptStateByThreadId?.[normalizedThreadId]) {
        return null;
      }
      const next = {
        ...(state.approvalPromptStateByThreadId || {}),
      };
      delete next[normalizedThreadId];
      state.approvalPromptStateByThreadId = next;
      return null;
    });
  }

  clearApprovalPrompt(threadId: unknown): void {
    this.clearPendingApprovalForThread(threadId);
  }

  getAvailableModelCatalog(): AvailableModelCatalogView | null {
    const raw = this.refresh().availableModelCatalog;
    if (!isRecord(raw)) {
      return null;
    }
    const models = normalizeModelCatalog(raw.models) as NormalizedModelCatalogEntry[];
    if (!models.length) {
      return null;
    }
    const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : "";
    return { models, updatedAt };
  }

  setAvailableModelCatalog(models: unknown): AvailableModelCatalogView | null {
    const normalizedModels = normalizeModelCatalog(models) as NormalizedModelCatalogEntry[];
    if (!normalizedModels.length) {
      return null;
    }
    return this.mutateState((state) => {
      state.availableModelCatalog = {
        models: normalizedModels,
        updatedAt: new Date().toISOString(),
      };
      const raw = state.availableModelCatalog;
      return isRecord(raw)
        ? {
          models: normalizeModelCatalog(raw.models) as NormalizedModelCatalogEntry[],
          updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
        }
        : null;
    });
  }

  buildBindingKey({
    workspaceId,
    accountId,
    senderId,
  }: {
    workspaceId: unknown;
    accountId: unknown;
    senderId: unknown;
  }): string {
    return `${normalizeValue(workspaceId)}:${normalizeValue(accountId)}:${normalizeValue(senderId)}`;
  }
}
