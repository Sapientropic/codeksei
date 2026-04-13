const { createControlCommandHandlers }: typeof import("../../src/core/channel-command-control-handlers") = require("../../src/core/channel-command-control-handlers");
const { createWorkspaceCommandHandlers }: typeof import("../../src/core/channel-command-workspace-handlers") = require("../../src/core/channel-command-workspace-handlers");

import type {
  ChannelCommandThreadState,
  ChannelCommandUsageSnapshot,
} from "../../src/core/channel-command-context";
import type { NormalizedIncomingMessage, PendingApprovalState, ThreadBindingRef } from "../../src/core/runtime-types";

interface TextCall {
  contextToken?: string;
  text: string;
  userId: string;
}

interface ModelCatalogView {
  models: Array<{ model: string }>;
}

interface ControlHarnessOptions {
  catalog?: ModelCatalogView;
  currentModel?: string;
  pendingApproval?: PendingApprovalState | null;
  workspaceRoot?: string;
}

interface ControlHarness {
  handlers: ReturnType<typeof createControlCommandHandlers>;
  rememberPrefixCalls: Array<{ commandTokens: string[]; workspaceRoot: string }>;
  resolveApprovalCalls: Array<{ status?: string; threadId: string }>;
  respondApprovalCalls: Array<{ decision: "accept" | "decline"; requestId: string }>;
  setModelCalls: Array<{
    bindingKey: string;
    params: { model: string };
    workspaceRoot: string;
  }>;
  textCalls: TextCall[];
}

interface WorkspaceHarnessOptions {
  currentModel?: string;
  currentThreadId?: string;
  currentThreadState?: ChannelCommandThreadState | null;
  currentWorkspaceRoot?: string;
  knownThreadBindings?: Record<string, ThreadBindingRef>;
  usage?: ChannelCommandUsageSnapshot | null;
}

interface WorkspaceHarness {
  cancelCalls: Array<{ threadId: string; turnId: string }>;
  clearThreadCalls: Array<{ key: string; workspaceRoot: string }>;
  handlers: ReturnType<typeof createWorkspaceCommandHandlers>;
  queueReplyCalls: Array<{
    target: { contextToken: string; provider: string; userId: string };
    threadId: string;
  }>;
  refreshCalls: Array<{
    accessMode?: string;
    bindingKey: string;
    model?: string;
    threadId: string;
    workspaceRoot: string;
  }>;
  resumeCalls: Array<{ threadId: string }>;
  setThreadCalls: Array<{ key: string; threadId: string; workspaceRoot: string }>;
  setWorkspaceCalls: Array<{ key: string; workspaceRoot: string }>;
  textCalls: TextCall[];
  watchdogCalls: Array<{
    bindingKey: string;
    normalized: {
      accountId: string;
      contextToken: string;
      provider: string;
      senderId: string;
      workspaceId: string;
    };
    threadId?: string;
    workspaceRoot: string;
  }>;
}

const DEFAULT_BINDING_KEY = "workspace-1:acct-1:user-1";
const DEFAULT_WORKSPACE_ROOT = "E:/repo/current";

function buildNormalizedCommandMessage(text: string = "/help"): NormalizedIncomingMessage {
  return {
    provider: "weixin",
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
    contextToken: "ctx-1",
    chatId: "chat-1",
    threadKey: "thread:user-1",
    command: "message",
    messageId: "msg-1",
    receivedAt: "2026-04-12T12:00:00.000Z",
    text,
    attachments: [],
  };
}

function createControlCommandHarness({
  pendingApproval = {
    requestId: "approval-1",
    reason: "Need shell access",
    command: "npm run timeline:write",
    commandTokens: ["npm", "run", "timeline:write"],
    signature: "sig-1",
    promptedAt: "2026-04-12T00:00:00.000Z",
  },
  currentModel = "gpt-5",
  catalog = {
    models: [
      { model: "gpt-5" },
      { model: "gpt-5-mini" },
    ],
  },
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
}: ControlHarnessOptions = {}): ControlHarness {
  const textCalls: TextCall[] = [];
  const respondApprovalCalls: Array<{ decision: "accept" | "decline"; requestId: string }> = [];
  const rememberPrefixCalls: Array<{ commandTokens: string[]; workspaceRoot: string }> = [];
  const resolveApprovalCalls: Array<{ status?: string; threadId: string }> = [];
  const setModelCalls: Array<{ bindingKey: string; params: { model: string }; workspaceRoot: string }> = [];

  const sessionStore = {
    buildBindingKey() {
      return DEFAULT_BINDING_KEY;
    },
    getAvailableModelCatalog() {
      return catalog;
    },
    getCodexParamsForWorkspace() {
      return { model: currentModel };
    },
    getPendingApprovalForThread() {
      return null;
    },
    getThreadIdForWorkspace() {
      return "thread-current";
    },
  };

  const sessionWriter = {
    async clearApprovalPrompt() {},
    async rememberApprovalPrefixForWorkspace(targetWorkspaceRoot: string, commandTokens: string[]) {
      rememberPrefixCalls.push({ workspaceRoot: targetWorkspaceRoot, commandTokens });
      return [];
    },
    async setCodexParamsForWorkspace(bindingKey: string, targetWorkspaceRoot: string, params: { model: string }) {
      setModelCalls.push({ bindingKey, workspaceRoot: targetWorkspaceRoot, params });
      return undefined;
    },
  };

  const runtimeAdapter = {
    getSessionStore() {
      return sessionStore;
    },
    async respondApproval(payload: { decision: "accept" | "decline"; requestId: string }) {
      respondApprovalCalls.push(payload);
    },
  };

  const threadStateStore = {
    getLatestUsage() {
      return null;
    },
    getThreadState() {
      return pendingApproval ? { pendingApproval } : null;
    },
    resolveApproval(threadId: string, status?: string) {
      resolveApprovalCalls.push(status ? { threadId, status } : { threadId });
    },
  };

  const channelAdapter = {
    async sendText(payload: TextCall) {
      textCalls.push(payload);
    },
  };

  return {
    handlers: createControlCommandHandlers({
      channelAdapter,
      resolveWorkspaceRoot() {
        return workspaceRoot;
      },
      runtimeAdapter,
      sessionWriter,
      threadStateStore,
    }),
    rememberPrefixCalls,
    resolveApprovalCalls,
    respondApprovalCalls,
    setModelCalls,
    textCalls,
  };
}

function createWorkspaceCommandHarness({
  currentWorkspaceRoot = DEFAULT_WORKSPACE_ROOT,
  currentThreadId = "thread-current",
  currentThreadState = null,
  currentModel = "gpt-5",
  knownThreadBindings = {},
  usage = null,
}: WorkspaceHarnessOptions = {}): WorkspaceHarness {
  const textCalls: TextCall[] = [];
  const queueReplyCalls: WorkspaceHarness["queueReplyCalls"] = [];
  const watchdogCalls: WorkspaceHarness["watchdogCalls"] = [];
  const refreshCalls: WorkspaceHarness["refreshCalls"] = [];
  const resumeCalls: WorkspaceHarness["resumeCalls"] = [];
  const cancelCalls: WorkspaceHarness["cancelCalls"] = [];
  const clearThreadCalls: WorkspaceHarness["clearThreadCalls"] = [];
  const setThreadCalls: WorkspaceHarness["setThreadCalls"] = [];
  const setWorkspaceCalls: WorkspaceHarness["setWorkspaceCalls"] = [];

  const config = {
    workspaceRoot: currentWorkspaceRoot,
    codexAccessMode: "workspace-write",
  };

  const sessionStore = {
    buildBindingKey() {
      return DEFAULT_BINDING_KEY;
    },
    findBindingForThreadId(threadId: string) {
      return knownThreadBindings[threadId] || null;
    },
    getActiveWorkspaceRoot() {
      return currentWorkspaceRoot;
    },
    getCodexParamsForWorkspace() {
      return { model: currentModel };
    },
    getPendingApprovalForThread() {
      return null;
    },
    getThreadIdForWorkspace(key: string, workspaceRoot: string) {
      if (key === DEFAULT_BINDING_KEY && workspaceRoot === currentWorkspaceRoot) {
        return currentThreadId;
      }
      return "";
    },
  };

  const sessionWriter = {
    async clearThreadIdForWorkspace(key: string, workspaceRoot: string) {
      clearThreadCalls.push({ key, workspaceRoot });
    },
    async setActiveWorkspaceRoot(key: string, workspaceRoot: string) {
      setWorkspaceCalls.push({ key, workspaceRoot });
    },
    async setThreadIdForWorkspace(key: string, workspaceRoot: string, threadId: string) {
      setThreadCalls.push({ key, workspaceRoot, threadId });
    },
  };

  const runtimeAdapter = {
    getSessionStore() {
      return sessionStore;
    },
    async cancelTurn(payload: { threadId: string; turnId: string }) {
      cancelCalls.push(payload);
    },
    async refreshThreadInstructions(payload: WorkspaceHarness["refreshCalls"][number]) {
      refreshCalls.push(payload);
    },
    async resumeThread(payload: { threadId: string }) {
      resumeCalls.push(payload);
    },
  };

  const threadStateStore = {
    getLatestUsage() {
      return usage;
    },
    getThreadState(threadId: string) {
      return threadId === currentThreadId ? currentThreadState : null;
    },
  };

  const channelAdapter = {
    async sendText(payload: TextCall) {
      textCalls.push(payload);
    },
  };

  const streamDelivery = {
    queueReplyTargetForThread(threadId: string, target: { contextToken: string; provider: string; userId: string }) {
      queueReplyCalls.push({ threadId, target });
    },
  };

  return {
    cancelCalls,
    clearThreadCalls,
    handlers: createWorkspaceCommandHandlers({
      channelAdapter,
      config,
      resolveWorkspaceRoot() {
        return currentWorkspaceRoot;
      },
      runtimeAdapter,
      scheduleRuntimeEventWatchdog(payload) {
        watchdogCalls.push(payload);
      },
      sessionWriter,
      streamDelivery,
      threadStateStore,
    }),
    queueReplyCalls,
    refreshCalls,
    resumeCalls,
    setThreadCalls,
    setWorkspaceCalls,
    textCalls,
    watchdogCalls,
  };
}

module.exports = {
  buildNormalizedCommandMessage,
  createControlCommandHarness,
  createWorkspaceCommandHarness,
};
