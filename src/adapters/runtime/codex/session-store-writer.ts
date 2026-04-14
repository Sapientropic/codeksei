import type { SessionStoreWriterLike } from "../../../core/app-service-contract";
import { SessionStore } from "./session-store";

// Keep every persisted session mutation behind one async owner so callers do
// not accidentally reintroduce event-loop-blocking writes or bypass the lock.
export class SessionStoreWriter implements SessionStoreWriterLike {
  readonly store: SessionStore;

  constructor(store: SessionStore) {
    this.store = store;
  }

  async clearApprovalPrompt(threadId: unknown): Promise<void> {
    await this.store.clearApprovalPrompt(threadId);
  }

  async clearPendingApprovalForThread(threadId: unknown): Promise<void> {
    await this.store.clearPendingApprovalForThread(threadId);
  }

  async rememberApprovalPrefixForWorkspace(workspaceRoot: string, commandTokens: string[]): Promise<string[][]> {
    return this.store.rememberApprovalPrefixForWorkspace(workspaceRoot, commandTokens);
  }

  async rememberPendingApprovalForThread(
    threadId: unknown,
    approval: unknown,
    options?: { signature?: unknown; promptedAt?: unknown },
  ): Promise<unknown> {
    return this.store.rememberPendingApprovalForThread(
      threadId,
      approval as Parameters<SessionStore["rememberPendingApprovalForThread"]>[1],
      options,
    );
  }

  async rememberWorkspaceBootstrapForThread(
    bindingKey: string,
    workspaceRoot: string,
    threadId: string,
  ): Promise<unknown> {
    return this.store.rememberWorkspaceBootstrapForThread(bindingKey, workspaceRoot, threadId);
  }

  async setActiveWorkspaceRoot(bindingKey: string, workspaceRoot: string): Promise<unknown> {
    return this.store.setActiveWorkspaceRoot(bindingKey, workspaceRoot);
  }

  async setAvailableModelCatalog(models: unknown): Promise<unknown> {
    return this.store.setAvailableModelCatalog(models);
  }

  async setRuntimeParamsForWorkspace(
    bindingKey: string,
    workspaceRoot: string,
    params: { model?: string; effort?: string },
  ): Promise<unknown> {
    return this.store.setRuntimeParamsForWorkspace(bindingKey, workspaceRoot, params);
  }

  async setCodexParamsForWorkspace(
    bindingKey: string,
    workspaceRoot: string,
    params: { model?: string; effort?: string },
  ): Promise<unknown> {
    return this.setRuntimeParamsForWorkspace(bindingKey, workspaceRoot, params);
  }

  async setThreadIdForWorkspace(
    bindingKey: string,
    workspaceRoot: string,
    threadId: string,
    extra?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.store.setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, extra);
  }

  async clearThreadIdForWorkspace(bindingKey: string, workspaceRoot: string): Promise<unknown> {
    return this.store.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
  }
}
