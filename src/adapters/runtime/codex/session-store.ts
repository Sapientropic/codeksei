import {
  createEmptySessionState,
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
import {
  buildBindingKey,
  clearThreadIdForWorkspaceInState,
  findBindingForThreadIdInState,
  getActiveWorkspaceRootFromState,
  getBindingFromState,
  getRuntimeParamsForWorkspaceFromState,
  getThreadIdForWorkspaceFromState,
  hasWorkspaceBootstrapForThreadInState,
  listBindingsFromState,
  listWorkspaceRootsFromState,
  rememberWorkspaceBootstrapForThreadInState,
  setActiveWorkspaceRootInState,
  setRuntimeParamsForWorkspaceInState,
  setThreadIdForWorkspaceInState,
  updateBindingInState,
  type BindingRef,
  type RuntimeWorkspaceParams,
  type SessionBindingUpdate,
} from "./session-store-binding-state";
import {
  clearPendingApprovalForThreadInState,
  getApprovalCommandAllowlistForWorkspaceFromState,
  getPendingApprovalForThreadFromState,
  isRecord,
  listPendingApprovalsFromState,
  rememberApprovalPrefixForWorkspaceInState,
  rememberPendingApprovalForThreadInState,
  type PendingApprovalUpdate,
} from "./session-store-approval-state";
import {
  getAvailableModelCatalogFromState,
  setAvailableModelCatalogInState,
  type AvailableModelCatalogView,
} from "./session-store-model-catalog";
import { normalizeValue } from "./session-store-bindings";
import { withSessionStoreLock } from "./session-store-lock";

interface SessionStoreConfig {
  filePath: string;
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

  private async withFileLock<T>(work: () => Promise<T> | T): Promise<T> {
    return withSessionStoreLock(this.lockFilePath, work);
  }

  private async mutateState<T>(mutator: (state: SessionState) => T | Promise<T>): Promise<T> {
    return this.withFileLock(async () => {
      this.state = this.readLatestState();
      const result = await mutator(this.state);
      this.writeCurrentState();
      return result;
    });
  }

  getBinding(bindingKey: unknown): SessionBinding | null {
    return getBindingFromState(this.refresh(), bindingKey);
  }

  listBindings(): Array<SessionBinding & { bindingKey: string }> {
    return listBindingsFromState(this.refresh());
  }

  getActiveWorkspaceRoot(bindingKey: unknown): string {
    return getActiveWorkspaceRootFromState(this.refresh(), bindingKey);
  }

  async updateBinding(bindingKey: unknown, nextBinding: SessionBindingUpdate): Promise<SessionBinding | null> {
    return this.mutateState((state) => updateBindingInState(state, bindingKey, nextBinding));
  }

  getThreadIdForWorkspace(bindingKey: unknown, workspaceRoot: unknown): string {
    return getThreadIdForWorkspaceFromState(this.refresh(), bindingKey, workspaceRoot);
  }

  async setThreadIdForWorkspace(
    bindingKey: unknown,
    workspaceRoot: unknown,
    threadId: unknown,
    extra: Record<string, unknown> = {},
  ): Promise<SessionBinding | null> {
    return this.mutateState((state) => setThreadIdForWorkspaceInState(state, bindingKey, workspaceRoot, threadId, extra));
  }

  getRuntimeParamsForWorkspace(bindingKey: unknown, workspaceRoot: unknown): RuntimeWorkspaceParams {
    return getRuntimeParamsForWorkspaceFromState(this.refresh(), bindingKey, workspaceRoot);
  }

  async setRuntimeParamsForWorkspace(
    bindingKey: unknown,
    workspaceRoot: unknown,
    { model = "", effort = "" }: { model?: unknown; effort?: unknown },
  ): Promise<SessionBinding | null> {
    return this.mutateState((state) => setRuntimeParamsForWorkspaceInState(state, bindingKey, workspaceRoot, {
      model,
      effort,
    }));
  }

  getCodexParamsForWorkspace(bindingKey: unknown, workspaceRoot: unknown): RuntimeWorkspaceParams {
    return this.getRuntimeParamsForWorkspace(bindingKey, workspaceRoot);
  }

  async setCodexParamsForWorkspace(
    bindingKey: unknown,
    workspaceRoot: unknown,
    params: { model?: unknown; effort?: unknown },
  ): Promise<SessionBinding | null> {
    return this.setRuntimeParamsForWorkspace(bindingKey, workspaceRoot, params);
  }

  async clearThreadIdForWorkspace(bindingKey: unknown, workspaceRoot: unknown): Promise<SessionBinding | null> {
    return this.mutateState((state) => clearThreadIdForWorkspaceInState(state, bindingKey, workspaceRoot));
  }

  async setActiveWorkspaceRoot(bindingKey: unknown, workspaceRoot: unknown): Promise<SessionBinding | null> {
    return this.mutateState((state) => setActiveWorkspaceRootInState(state, bindingKey, workspaceRoot));
  }

  listWorkspaceRoots(bindingKey: unknown): string[] {
    return listWorkspaceRootsFromState(this.refresh(), bindingKey);
  }

  findBindingForThreadId(threadId: unknown): BindingRef | null {
    return findBindingForThreadIdInState(this.refresh(), threadId);
  }

  hasWorkspaceBootstrapForThread(bindingKey: unknown, workspaceRoot: unknown, threadId: unknown): boolean {
    return hasWorkspaceBootstrapForThreadInState(this.refresh(), bindingKey, workspaceRoot, threadId);
  }

  async rememberWorkspaceBootstrapForThread(
    bindingKey: unknown,
    workspaceRoot: unknown,
    threadId: unknown,
  ): Promise<SessionBinding | null> {
    return this.mutateState((state) => rememberWorkspaceBootstrapForThreadInState(state, bindingKey, workspaceRoot, threadId));
  }

  getApprovalCommandAllowlistForWorkspace(workspaceRoot: unknown): string[][] {
    return getApprovalCommandAllowlistForWorkspaceFromState(this.refresh(), workspaceRoot);
  }

  async rememberApprovalPrefixForWorkspace(workspaceRoot: unknown, commandTokens: unknown): Promise<string[][]> {
    return this.mutateState((state) => rememberApprovalPrefixForWorkspaceInState(state, workspaceRoot, commandTokens));
  }

  getPendingApprovalForThread(threadId: unknown): PendingApprovalRecord | null {
    return getPendingApprovalForThreadFromState(this.refresh(), threadId);
  }

  listPendingApprovals(): Array<{ threadId: string; approval: PendingApprovalRecord }> {
    return listPendingApprovalsFromState(this.refresh());
  }

  async rememberPendingApprovalForThread(
    threadId: unknown,
    approval: PendingApprovalUpdate | null | undefined,
    {
      signature = "",
      promptedAt = "",
    }: { signature?: unknown; promptedAt?: unknown } = {},
  ): Promise<PendingApprovalRecord | null> {
    return this.mutateState((state) => rememberPendingApprovalForThreadInState(state, threadId, approval, {
      signature,
      promptedAt,
    }));
  }

  getApprovalPromptState(threadId: unknown): PendingApprovalRecord | null {
    return this.getPendingApprovalForThread(threadId);
  }

  async rememberApprovalPrompt(
    threadId: unknown,
    requestIdOrApproval: unknown,
    signature = "",
  ): Promise<PendingApprovalRecord | null> {
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

  async clearPendingApprovalForThread(threadId: unknown): Promise<void> {
    await this.mutateState((state) => {
      clearPendingApprovalForThreadInState(state, threadId);
      return null;
    });
  }

  async clearApprovalPrompt(threadId: unknown): Promise<void> {
    await this.clearPendingApprovalForThread(threadId);
  }

  getAvailableModelCatalog(): AvailableModelCatalogView | null {
    return getAvailableModelCatalogFromState(this.refresh());
  }

  async setAvailableModelCatalog(models: unknown): Promise<AvailableModelCatalogView | null> {
    return this.mutateState((state) => setAvailableModelCatalogInState(state, models));
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
    return buildBindingKey({ workspaceId, accountId, senderId });
  }
}
