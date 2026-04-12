const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CodekseiApp } = require("../../src/core/app");
import type {
  AppRuntimeConfig,
  AppServiceFactory,
  ChannelAdapterLike,
  CreateAppServicesArgs,
  ReminderQueueLike,
  RuntimeAdapterLike,
  SessionStoreLike,
  StreamDeliveryLike,
  SystemMessageDispatcherRef,
  SystemMessageQueueLike,
  ThreadStateStoreLike,
  TimelineIntegrationLike,
  TimelineScreenshotQueueLike,
} from "../../src/core/app-service-contract";
const { BackstageTaskLifecycle } = require("../../src/core/backstage-task-lifecycle");
const { RuntimeTurnLifecycle } = require("../../src/core/runtime-turn-lifecycle");
const { RuntimeWatchdogLifecycle } = require("../../src/core/runtime-watchdog-lifecycle");
import type { DeliveryFailurePayload } from "../../src/core/runtime-types";

interface AppHarnessOptions {
  runTimelineSubcommandImpl?: (command: string, args: string[]) => Promise<unknown>;
  sendFileImpl?: (payload: { userId: string; filePath: string; contextToken?: string }) => Promise<unknown>;
  sendTextTurnImpl?: (payload: {
    bindingKey: string;
    workspaceRoot: string;
    text: string;
    model?: string;
    accessMode?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<{ threadId: string; workspaceBootstrapPending: boolean }>;
}

interface QueueEntry {
  id: string;
  senderId: string;
  outputFile: string;
  args: string[];
}

function createTestAppHarness({
  runTimelineSubcommandImpl = async () => undefined,
  sendFileImpl = async () => ({ kind: "file" }),
  sendTextTurnImpl = async () => ({ threadId: "thread-1", workspaceBootstrapPending: false }),
}: AppHarnessOptions = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-app-harness-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });

  const callOrder: string[] = [];
  const fileCalls: Array<{ userId: string; filePath: string; contextToken?: string }> = [];
  const sendTextTurnCalls: Array<{
    bindingKey: string;
    workspaceRoot: string;
    text: string;
    model?: string;
    accessMode?: string;
    metadata?: Record<string, unknown>;
  }> = [];
  const textCalls: Array<{
    userId: string;
    text: string;
    contextToken?: string;
    preserveBlock?: boolean;
  }> = [];
  const typingCalls: Array<{ userId: string; status: number; contextToken?: string }> = [];

  const baseConfig: AppRuntimeConfig = {
    allowedUserIds: ["user-1"],
    codexAccessMode: "",
    reminderQueueFile: path.join(tempRoot, "reminder-queue.json"),
    sessionsFile: path.join(tempRoot, "sessions.json"),
    stateDir: tempRoot,
    systemMessageDeadLetterFile: path.join(tempRoot, "system-message-dead-letter.json"),
    systemMessageQueueFile: path.join(tempRoot, "system-message-queue.json"),
    timelineScreenshotQueueFile: path.join(tempRoot, "timeline-screenshot-queue.json"),
    weixinDeliveryTrace: false,
    weixinReplyMode: "stream",
    workspaceId: "workspace-1",
    workspaceRoot,
  };

  const bindingKey = "workspace-1:acct-1:user-1";
  const sessionStore: SessionStoreLike = {
    state: {
      bindings: {
        [bindingKey]: {
          accountId: "acct-1",
          activeWorkspaceRoot: workspaceRoot,
          bindingKey,
          senderId: "user-1",
          threadIdByWorkspaceRoot: {},
          workspaceId: "workspace-1",
        },
      },
    },
    buildBindingKey({ workspaceId, accountId, senderId }) {
      return `${workspaceId}:${accountId}:${senderId}`;
    },
    findBindingForThreadId() {
      return null;
    },
    getActiveWorkspaceRoot() {
      return workspaceRoot;
    },
    getApprovalCommandAllowlistForWorkspace() {
      return [];
    },
    getBinding(candidateBindingKey) {
      return this.state?.bindings?.[candidateBindingKey] || null;
    },
    getCodexParamsForWorkspace() {
      return { model: "" };
    },
    getPendingApprovalForThread() {
      return null;
    },
    getThreadIdForWorkspace() {
      return "";
    },
    listBindings() {
      return Object.values(this.state?.bindings || {});
    },
    listPendingApprovals() {
      return [];
    },
    rememberPendingApprovalForThread() {
      return null;
    },
    rememberWorkspaceBootstrapForThread() {},
  };

  const channelAdapter: ChannelAdapterLike = {
    describe() {
      return { id: "test-channel" };
    },
    getKnownContextTokens() {
      return { "user-1": "ctx-1" };
    },
    loadSyncBuffer() {
      return "";
    },
    async login() {},
    normalizeIncomingMessage(message) {
      return message as ReturnType<ChannelAdapterLike["normalizeIncomingMessage"]>;
    },
    printAccounts() {},
    resolveAccount() {
      return { accountId: "acct-1", baseUrl: "http://127.0.0.1" };
    },
    async sendFile(payload) {
      fileCalls.push(payload);
      callOrder.push(`file:${path.basename(payload.filePath)}`);
      return sendFileImpl(payload);
    },
    async sendText(payload) {
      textCalls.push(payload);
      callOrder.push(`text:${payload.text}`);
      return undefined;
    },
    async sendTyping(payload) {
      typingCalls.push(payload);
      callOrder.push(`typing:${payload.status}`);
      return undefined;
    },
  };

  const runtimeAdapter: RuntimeAdapterLike = {
    async cancelTurn() {},
    async close() {},
    describe() {
      return { id: "test-runtime" };
    },
    getSessionStore() {
      return sessionStore;
    },
    async initialize() {
      return { endpoint: "ws://127.0.0.1:8765", models: [] };
    },
    onEvent() {
      return undefined;
    },
    async refreshThreadInstructions() {},
    async respondApproval() {},
    async resumeThread() {},
    async sendTextTurn(payload) {
      sendTextTurnCalls.push(payload);
      callOrder.push("sendTextTurn");
      return sendTextTurnImpl(payload);
    },
  };

  const streamDelivery: StreamDeliveryLike = {
    async finalizeAbandonedTurn() {
      return undefined;
    },
    async handleRuntimeEvent() {},
    queueReplyTargetForThread() {},
    setReplyTarget() {},
  };

  const threadStateStore: ThreadStateStoreLike = {
    applyRuntimeEvent() {},
    getThreadState() {
      return null;
    },
    hydratePendingApproval() {
      return null;
    },
    markTurnFailed() {
      return null;
    },
    resolveApproval() {
      return null;
    },
    snapshot() {
      return {};
    },
  };

  const reminderQueue: ReminderQueueLike = {
    enqueue(reminder) {
      return reminder;
    },
    listDue() {
      return [];
    },
    peekNextDueAtMs() {
      return 0;
    },
  };

  const systemMessageQueue: SystemMessageQueueLike = {
    enqueue(message) {
      return message;
    },
  };

  const timelineScreenshotQueue: TimelineScreenshotQueueLike = {
    drainForAccount() {
      return [] as QueueEntry[];
    },
    hasPendingForAccount() {
      return false;
    },
  };

  const timelineIntegration: TimelineIntegrationLike = {
    describe() {
      return { id: "test-timeline" };
    },
    runSubcommand(command, args) {
      return runTimelineSubcommandImpl(command, args);
    },
  };

  const createAppServices: AppServiceFactory = ({
    config,
    handlePreparedMessage,
    handleReplyDeliveryFailure,
    resolveDefaultTerminalUser,
    resolveReplyTargetForBinding,
    resolveWorkspaceRoot,
    sendTimelineScreenshot,
  }: CreateAppServicesArgs) => {
    const systemMessageDispatcherState: SystemMessageDispatcherRef = { current: null };
    const channelCommandRouter = {
      async maybeDispatchCommand(_normalized: unknown) {
        return false;
      },
    };

    const runtimeWatchdogLifecycle = new RuntimeWatchdogLifecycle({
      buildApprovalPromptSignature: () => "",
      buildApprovalPromptText: () => "",
      channelAdapter,
      firstRuntimeEventFailureTimeoutMs: 45_000,
      firstRuntimeEventNoticeTimeoutMs: 8_000,
      matchesBuiltInCommandPrefix: () => false,
      matchesCommandPrefix: () => false,
      normalizeCommandArgument: normalizeText,
      normalizeText,
      resolveReplyTargetForBinding,
      runtimeAdapter,
      streamDelivery,
      streamSettlementTimeoutMs: 5 * 60_000,
      threadStateStore,
    });

    const runtimeTurnLifecycle = new RuntimeTurnLifecycle({
      buildCodexInboundText: (normalized: { text?: string }) => normalizeText(normalized.text),
      channelAdapter,
      config,
      formatErrorMessage,
      maybeDispatchCommand: (normalized: unknown) => channelCommandRouter.maybeDispatchCommand(normalized),
      normalizeText,
      persistIncomingWeixinAttachments: async () => ({ saved: [], failed: [] }),
      queuePendingWorkspaceBootstrap: (payload: { bindingKey: string; workspaceRoot: string; threadId: string }) => {
        runtimeWatchdogLifecycle.queuePendingWorkspaceBootstrap(payload);
      },
      resolveDefaultTerminalUser,
      resolveTimelineScreenshotOutput: (args: string[]) => resolveTimelineScreenshotOutput(tempRoot, args),
      resolveWorkspaceRoot,
      runtimeAdapter,
      scheduleRuntimeEventWatchdog: (payload: {
        bindingKey: string;
        workspaceRoot: string;
        normalized: any;
        threadId?: string;
      }) => runtimeWatchdogLifecycle.scheduleRuntimeEventWatchdog(payload),
      streamDelivery,
      timelineIntegration,
    });

    const backstageTaskLifecycle = new BackstageTaskLifecycle({
      buildReminderSystemTrigger: (reminder: { text?: string }) => normalizeText(reminder.text),
      channelAdapter,
      config,
      formatErrorMessage,
      getSystemMessageDispatcher: () => systemMessageDispatcherState.current,
      getSystemMessageFailureRetryDelayMs: () => 30_000,
      handlePreparedMessage,
      hasRpcId: (requestId: unknown) => normalizeText(requestId).length > 0,
      normalizeText,
      reminderQueue,
      resolveWorkspaceRoot,
      runtimeAdapter,
      sendTimelineScreenshot,
      systemMessageBusyRetryMs: 30_000,
      systemMessageQueue,
      threadStateStore,
      timelineScreenshotQueue,
    });

    return {
      backstageTaskLifecycle,
      channelAdapter,
      channelCommandRouter,
      reminderQueue,
      runtimeAdapter,
      runtimeTurnLifecycle,
      runtimeWatchdogLifecycle,
      streamDelivery,
      systemMessageDispatcherState,
      systemMessageQueue,
      threadStateStore,
      timelineIntegration,
      timelineScreenshotQueue,
    };
  };

  const app = new CodekseiApp(baseConfig, { createAppServices });

  return {
    app,
    baseConfig,
    callOrder,
    fileCalls,
    sendTextTurnCalls,
    tempRoot,
    textCalls,
    typingCalls,
    workspaceRoot,
    async handleReplyDeliveryFailure(payload: DeliveryFailurePayload) {
      await app.handleReplyDeliveryFailure(payload);
    },
  };
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message || error.stack || String(error) : String(error || "unknown error");
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveTimelineScreenshotOutput(tempRoot: string, args: string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--output" && args[index + 1]) {
      return path.resolve(String(args[index + 1]));
    }
  }
  return path.join(tempRoot, "timeline-screenshot.png");
}

module.exports = {
  createTestAppHarness,
};
