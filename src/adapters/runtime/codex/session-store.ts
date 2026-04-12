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

const { normalizeModelCatalog } = modelCatalogModule as {
  normalizeModelCatalog: (models: unknown) => NormalizedModelCatalogEntry[];
};

interface SessionStoreConfig {
  filePath: string;
}

interface CodexWorkspaceParams {
  model: string;
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

interface BindingRef {
  bindingKey: string;
  workspaceRoot: string;
}

type SessionBindingUpdate = Partial<SessionBinding> & Record<string, unknown>;
type PendingApprovalUpdate = Partial<PendingApprovalRecord> & Record<string, unknown>;

export class SessionStore {
  readonly filePath: string;
  state: SessionState;

  constructor({ filePath }: SessionStoreConfig) {
    this.filePath = filePath;
    this.state = createEmptySessionState();
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory(): void {
    ensureParentDirectory(this.filePath);
  }

  load(): void {
    // sessionStoreStateSchema already canonicalizes persisted session JSON.
    // Keep compatibility logic at that ingress so reads do not silently apply
    // a second round of shape repair in every store call site.
    const loadedState = readManagedJsonStateFile({
      filePath: this.filePath,
      fallback: createEmptySessionState(),
      label: "session store",
      schema: sessionStoreStateSchema,
    }) as SessionState;
    this.state = normalizeSessionState(loadedState);
  }

  save(): void {
    this.state = normalizeSessionState(this.state);
    writeManagedJsonStateFile(this.filePath, this.state);
  }

  getBinding(bindingKey: unknown): SessionBinding | null {
    return this.state.bindings[normalizeValue(bindingKey)] || null;
  }

  listBindings(): Array<SessionBinding & { bindingKey: string }> {
    return Object.entries(this.state.bindings || {}).map(([bindingKey, binding]) => ({
      bindingKey,
      ...(binding || {}),
    }));
  }

  getActiveWorkspaceRoot(bindingKey: unknown): string {
    const activeWorkspaceRoot = this.state.bindings[normalizeValue(bindingKey)]?.activeWorkspaceRoot;
    return typeof activeWorkspaceRoot === "string" ? activeWorkspaceRoot : "";
  }

  updateBinding(bindingKey: unknown, nextBinding: SessionBindingUpdate): SessionBinding | null {
    const normalizedBindingKey = normalizeValue(bindingKey);
    if (!normalizedBindingKey) {
      return null;
    }
    const current = this.getBinding(normalizedBindingKey) || createEmptySessionBinding();
    const normalizedBinding = normalizeSessionBinding({
      ...current,
      ...nextBinding,
      updatedAt: new Date().toISOString(),
    });
    this.state.bindings = {
      ...(this.state.bindings || {}),
      [normalizedBindingKey]: normalizedBinding,
    };
    this.save();
    return this.state.bindings[normalizedBindingKey];
  }

  getThreadIdForWorkspace(bindingKey: unknown, workspaceRoot: unknown): string {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return "";
    }
    const threadId = this.state.bindings[normalizeValue(bindingKey)]?.threadIdByWorkspaceRoot?.[normalizedWorkspaceRoot];
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

    const current = this.getBinding(bindingKey) || createEmptySessionBinding();
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

    return this.updateBinding(bindingKey, {
      ...extra,
      activeWorkspaceRoot: normalizedWorkspaceRoot,
      threadIdByWorkspaceRoot,
      workspaceBootstrapThreadIdByWorkspaceRoot,
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
    const current = this.getBinding(bindingKey) || createEmptySessionBinding();
    const codexParamsByWorkspaceRoot = {
      ...getCodexParamsMap(current),
      [normalizedWorkspaceRoot]: {
        model: normalizeValue(model),
      },
    };
    return this.updateBinding(bindingKey, {
      codexParamsByWorkspaceRoot,
    });
  }

  clearThreadIdForWorkspace(bindingKey: unknown, workspaceRoot: unknown): SessionBinding | null {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    const current = this.getBinding(bindingKey) || createEmptySessionBinding();
    const threadIdByWorkspaceRoot = {
      ...getThreadMap(current),
      [normalizedWorkspaceRoot]: "",
    };
    const workspaceBootstrapThreadIdByWorkspaceRoot = {
      ...getWorkspaceBootstrapThreadMap(current),
      [normalizedWorkspaceRoot]: "",
    };
    return this.updateBinding(bindingKey, {
      threadIdByWorkspaceRoot,
      workspaceBootstrapThreadIdByWorkspaceRoot,
    });
  }

  setActiveWorkspaceRoot(bindingKey: unknown, workspaceRoot: unknown): SessionBinding | null {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    return this.updateBinding(bindingKey, {
      activeWorkspaceRoot: normalizedWorkspaceRoot,
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
    for (const [bindingKey, binding] of Object.entries(this.state.bindings || {})) {
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
    const current = this.getBinding(bindingKey) || createEmptySessionBinding();
    const workspaceBootstrapThreadIdByWorkspaceRoot = {
      ...getWorkspaceBootstrapThreadMap(current),
      [normalizedWorkspaceRoot]: normalizedThreadId,
    };
    return this.updateBinding(bindingKey, {
      workspaceBootstrapThreadIdByWorkspaceRoot,
    });
  }

  getApprovalCommandAllowlistForWorkspace(workspaceRoot: unknown): string[][] {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return [];
    }
    const raw = this.state.approvalCommandAllowlistByWorkspaceRoot?.[normalizedWorkspaceRoot];
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
    const current = this.getApprovalCommandAllowlistForWorkspace(normalizedWorkspaceRoot);
    if (!current.some((entry) => isSameTokenList(entry, normalizedTokens))) {
      current.push(normalizedTokens);
      this.state.approvalCommandAllowlistByWorkspaceRoot = {
        ...(this.state.approvalCommandAllowlistByWorkspaceRoot || {}),
        [normalizedWorkspaceRoot]: current,
      };
      this.save();
    }
    return current;
  }

  getPendingApprovalForThread(threadId: unknown): PendingApprovalRecord | null {
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedThreadId) {
      return null;
    }
    const approval = this.state.approvalPromptStateByThreadId?.[normalizedThreadId];
    if (!approval || typeof approval !== "object") {
      return null;
    }
    return { ...approval };
  }

  listPendingApprovals(): Array<{ threadId: string; approval: PendingApprovalRecord }> {
    return Object.entries(this.state.approvalPromptStateByThreadId || {}).map(([threadId, approval]) => ({
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
    const existing = this.getPendingApprovalForThread(normalizedThreadId);
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
    this.state.approvalPromptStateByThreadId = {
      ...(this.state.approvalPromptStateByThreadId || {}),
      [normalizedThreadId]: normalizedApproval,
    };
    this.save();
    return this.getPendingApprovalForThread(normalizedThreadId);
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
    if (!normalizedThreadId || !this.state.approvalPromptStateByThreadId?.[normalizedThreadId]) {
      return;
    }
    const next = {
      ...(this.state.approvalPromptStateByThreadId || {}),
    };
    delete next[normalizedThreadId];
    this.state.approvalPromptStateByThreadId = next;
    this.save();
  }

  clearApprovalPrompt(threadId: unknown): void {
    this.clearPendingApprovalForThread(threadId);
  }

  getAvailableModelCatalog(): AvailableModelCatalogView | null {
    const raw = this.state.availableModelCatalog;
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
    this.state.availableModelCatalog = {
      models: normalizedModels,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.getAvailableModelCatalog();
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

function createEmptySessionBinding(): SessionBinding {
  return normalizeSessionBinding({});
}

function normalizeValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function getThreadMap(binding: SessionBinding | null | undefined): Record<string, string> {
  return binding?.threadIdByWorkspaceRoot && typeof binding.threadIdByWorkspaceRoot === "object"
    ? binding.threadIdByWorkspaceRoot
    : {};
}

function getCodexParamsMap(binding: SessionBinding | null | undefined): Record<string, CodexWorkspaceParams> {
  return binding?.codexParamsByWorkspaceRoot && typeof binding.codexParamsByWorkspaceRoot === "object"
    ? binding.codexParamsByWorkspaceRoot
    : {};
}

function getWorkspaceBootstrapThreadMap(binding: SessionBinding | null | undefined): Record<string, string> {
  return binding?.workspaceBootstrapThreadIdByWorkspaceRoot
    && typeof binding.workspaceBootstrapThreadIdByWorkspaceRoot === "object"
    ? binding.workspaceBootstrapThreadIdByWorkspaceRoot
    : {};
}

function normalizeCommandTokens(tokens: unknown): string[] {
  return Array.isArray(tokens)
    ? tokens.map((part) => normalizeValue(part)).filter(Boolean)
    : [];
}

function isSameTokenList(left: readonly string[] | unknown, right: readonly string[] | unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
