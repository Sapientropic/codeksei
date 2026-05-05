const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

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
  models: Array<{
    displayName: string;
    defaultReasoningEffort: string;
    id: string;
    isDefault: boolean;
    model: string;
    supportedReasoningEfforts: string[];
  }>;
  updatedAt: string;
}

interface ControlHarnessOptions {
  catalog?: ModelCatalogView;
  currentEffort?: string;
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
    params: { effort?: string; model?: string };
    workspaceRoot: string;
  }>;
  setReplyModeCalls: unknown[];
  textCalls: TextCall[];
}

interface WorkspaceHarnessOptions {
  currentModel?: string;
  currentEffort?: string;
  currentThreadId?: string;
  currentThreadState?: ChannelCommandThreadState | null;
  currentWorkspaceRoot?: string;
  runtimeProvider?: string;
  knownThreadBindings?: Record<string, ThreadBindingRef>;
  pageArtifactStore?: import("../../src/state/page-artifacts").PageArtifactStore;
  usage?: ChannelCommandUsageSnapshot | null;
}

interface WorkspaceHarness {
  cancelCalls: Array<{ threadId: string; turnId: string }>;
  clearThreadCalls: Array<{ key: string; workspaceRoot: string }>;
  compactCalls: Array<{ threadId: string; workspaceRoot: string }>;
  fileCalls: Array<{ contextToken?: string; filePath: string; userId: string }>;
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
  resumeCalls: Array<{ threadId: string; workspaceRoot?: string }>;
  startFreshThreadDraftCalls: Array<{ workspaceRoot: string }>;
  setPendingThreadCalls: Array<{ key: string; threadId: string; workspaceRoot: string }>;
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
  currentEffort = "",
  currentModel = "gpt-5",
  catalog = {
    models: [
      {
        id: "gpt-5",
        model: "gpt-5",
        displayName: "GPT-5",
        supportedReasoningEfforts: ["low", "medium", "high"],
        defaultReasoningEffort: "medium",
        isDefault: true,
      },
      {
        id: "gpt-5-mini",
        model: "gpt-5-mini",
        displayName: "GPT-5 mini",
        supportedReasoningEfforts: ["low", "medium"],
        defaultReasoningEffort: "medium",
        isDefault: false,
      },
    ],
    updatedAt: "2026-04-12T00:00:00.000Z",
  },
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
}: ControlHarnessOptions = {}): ControlHarness {
  const textCalls: TextCall[] = [];
  const respondApprovalCalls: Array<{ decision: "accept" | "decline"; requestId: string }> = [];
  const rememberPrefixCalls: Array<{ commandTokens: string[]; workspaceRoot: string }> = [];
  const resolveApprovalCalls: Array<{ status?: string; threadId: string }> = [];
  const setModelCalls: Array<{ bindingKey: string; params: { effort?: string; model?: string }; workspaceRoot: string }> = [];
  const setReplyModeCalls: unknown[] = [];

  const sessionStore = {
    buildBindingKey() {
      return DEFAULT_BINDING_KEY;
    },
    getAvailableModelCatalog() {
      return catalog;
    },
    getRuntimeParamsForWorkspace() {
      return { model: currentModel, effort: currentEffort };
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
    async setRuntimeParamsForWorkspace(
      bindingKey: string,
      targetWorkspaceRoot: string,
      params: { effort?: string; model?: string },
    ) {
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
      config: {
        checkinConfigFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-checkin-harness-")), "checkin-config.json"),
        weixinDeliveryConfigFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-delivery-harness-")), "weixin-delivery-config.json"),
        weixinReplyMode: "stream",
      },
      resolveWorkspaceRoot() {
        return workspaceRoot;
      },
      runtimeAdapter,
      sessionWriter,
      streamDelivery: {
        setWeixinReplyMode(mode: unknown) {
          setReplyModeCalls.push(mode);
        },
      },
      threadStateStore,
    }),
    rememberPrefixCalls,
    resolveApprovalCalls,
    respondApprovalCalls,
    setModelCalls,
    setReplyModeCalls,
    textCalls,
  };
}

function createWorkspaceCommandHarness({
  currentWorkspaceRoot = DEFAULT_WORKSPACE_ROOT,
  currentThreadId = "thread-current",
  currentThreadState = null,
  currentEffort = "medium",
  currentModel = "gpt-5",
  runtimeProvider = "test",
  knownThreadBindings = {},
  pageArtifactStore = undefined,
  usage = null,
}: WorkspaceHarnessOptions = {}): WorkspaceHarness {
  const textCalls: TextCall[] = [];
  const queueReplyCalls: WorkspaceHarness["queueReplyCalls"] = [];
  const watchdogCalls: WorkspaceHarness["watchdogCalls"] = [];
  const refreshCalls: WorkspaceHarness["refreshCalls"] = [];
  const resumeCalls: WorkspaceHarness["resumeCalls"] = [];
  const cancelCalls: WorkspaceHarness["cancelCalls"] = [];
  const compactCalls: WorkspaceHarness["compactCalls"] = [];
  const fileCalls: WorkspaceHarness["fileCalls"] = [];
  const clearThreadCalls: WorkspaceHarness["clearThreadCalls"] = [];
  const startFreshThreadDraftCalls: WorkspaceHarness["startFreshThreadDraftCalls"] = [];
  const setPendingThreadCalls: WorkspaceHarness["setPendingThreadCalls"] = [];
  const setThreadCalls: WorkspaceHarness["setThreadCalls"] = [];
  const setWorkspaceCalls: WorkspaceHarness["setWorkspaceCalls"] = [];

  const config = {
    checkinConfigFile: "",
    workspaceRoot: currentWorkspaceRoot,
    runtimeAccessMode: "workspace-write",
    codexAccessMode: "workspace-write",
  } as const;

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
    getRuntimeParamsForWorkspace() {
      return { model: currentModel, effort: currentEffort };
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
    async setPendingThreadIdForWorkspace(key: string, workspaceRoot: string, threadId: string) {
      setPendingThreadCalls.push({ key, workspaceRoot, threadId });
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
    describe() {
      return {
        id: "test-runtime",
        kind: "runtime" as const,
        provider: runtimeProvider,
        operations: {
          cancelTurn: true,
          compactThread: true,
          initialize: true,
          interactiveTurn: true,
          refreshThreadInstructions: true,
          respondApproval: true,
          resumeThread: true,
        },
      };
    },
    async compactThread(payload: { threadId: string; workspaceRoot: string }) {
      compactCalls.push(payload);
    },
    async refreshThreadInstructions(payload: WorkspaceHarness["refreshCalls"][number]) {
      refreshCalls.push(payload);
    },
    async resumeThread(payload: { threadId: string; workspaceRoot?: string }) {
      resumeCalls.push(payload);
    },
    async startFreshThreadDraft(payload: { workspaceRoot: string }) {
      startFreshThreadDraftCalls.push(payload);
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
    async sendFile(payload: { contextToken?: string; filePath: string; userId: string }) {
      fileCalls.push(payload);
      return { status: "ok" };
    },
  };

  const streamDelivery = {
    queueReplyTargetForThread(threadId: string, target: { contextToken: string; provider: string; userId: string }) {
      queueReplyCalls.push({ threadId, target });
    },
  };
  type WorkspaceCommandHandlerOptions = Parameters<typeof createWorkspaceCommandHandlers>[0];
  const workspaceCommandHandlerOptions: WorkspaceCommandHandlerOptions = {
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
  };
  if (pageArtifactStore) {
    workspaceCommandHandlerOptions.pageArtifactStore = pageArtifactStore;
  }

  return {
    cancelCalls,
    compactCalls,
    clearThreadCalls,
    fileCalls,
    handlers: createWorkspaceCommandHandlers(workspaceCommandHandlerOptions),
    queueReplyCalls,
    refreshCalls,
    resumeCalls,
    startFreshThreadDraftCalls,
    setPendingThreadCalls,
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
