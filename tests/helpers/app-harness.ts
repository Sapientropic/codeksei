const { normalizeText }: typeof import("../../src/core/text-normalization") = require("../../src/core/text-normalization");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const { CodekseiApp }: typeof import("../../src/core/app") = require("../../src/core/app");
import type {
  AppRuntimeConfig,
  AppServiceFactory,
  ChannelCommandRouterLike,
  ChannelAdapterLike,
  CreateAppServicesArgs,
  ReminderQueueLike,
  RuntimeAdapterLike,
  RuntimeTurnLifecycleLike,
  RuntimeWatchdogLifecycleLike,
  SessionStoreLike,
  SessionStoreWriterLike,
  StreamDeliveryLike,
  SystemMessageDispatcherRef,
  SystemMessageQueueLike,
  ThreadStateStoreLike,
  TimelineIntegrationLike,
  TimelineScreenshotQueueLike,
} from "../../src/core/app-service-contract";
const { BackstageTaskLifecycle }: typeof import("../../src/runtime/backstage-task-lifecycle") = require("../../src/runtime/backstage-task-lifecycle");
const { RuntimeTurnLifecycle }: typeof import("../../src/runtime/runtime-turn-lifecycle") = require("../../src/runtime/runtime-turn-lifecycle");
const { RuntimeWatchdogLifecycle }: typeof import("../../src/runtime/runtime-watchdog-lifecycle") = require("../../src/runtime/runtime-watchdog-lifecycle");
import type {
  DeliveryFailurePayload,
  NormalizedIncomingMessage,
  PreparedRuntimeMessage,
  RuntimeTurnSendState,
} from "../../src/core/runtime-types";

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
  }) => Promise<RuntimeTurnSendState>;
}

interface QueueEntry {
  id: string;
  senderId: string;
  outputFile: string;
  args: string[];
}

interface TestAppHarness {
  app: InstanceType<typeof CodekseiApp>;
  baseConfig: AppRuntimeConfig;
  callOrder: string[];
  fileCalls: Array<{ userId: string; filePath: string; contextToken?: string }>;
  sendTextTurnCalls: Array<{
    bindingKey: string;
    workspaceRoot: string;
    text: string;
    model?: string;
    accessMode?: string;
    metadata?: Record<string, unknown>;
  }>;
  tempRoot: string;
  textCalls: Array<{
    userId: string;
    text: string;
    contextToken?: string;
    preserveBlock?: boolean;
  }>;
  typingCalls: Array<{ userId: string; status: number; contextToken?: string }>;
  workspaceRoot: string;
  handleReplyDeliveryFailure(payload: DeliveryFailurePayload): Promise<void>;
}

function buildTestChannelDescriptor(id: string) {
  return {
    id,
    kind: "channel" as const,
    provider: "test",
    operations: {
      pollUpdates: true,
      login: true,
      resolveAccount: true,
      visibleTextDelivery: true,
      visibleTypingDelivery: true,
      visibleFileDelivery: true,
    },
  };
}

function buildTestRuntimeDescriptor(id: string) {
  return {
    id,
    kind: "runtime" as const,
    provider: "test",
    operations: {
      initialize: true,
      interactiveTurn: true,
      refreshThreadInstructions: true,
      respondApproval: true,
      resumeThread: true,
      cancelTurn: true,
    },
  };
}

function createTestAppHarness({
  runTimelineSubcommandImpl = async () => undefined,
  sendFileImpl = async () => ({ kind: "file" }),
  sendTextTurnImpl = async () => ({ threadId: "thread-1", workspaceBootstrapPending: false }),
}: AppHarnessOptions = {}): TestAppHarness {
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
    stateDir: tempRoot,
    codekseiHome: tempRoot,
    workspaceId: "workspace-1",
    workspaceRoot,
    timezone: "Asia/Shanghai",
    timezoneSource: "system",
    timezoneExplicit: false,
    timelineStateTimezone: "",
    diaryDir: path.join(tempRoot, "diary"),
    timelineStateDir: tempRoot,
    userName: "",
    userGender: "female",
    allowedUserIds: ["user-1"],
    channel: "weixin",
    channelProvider: "codeksei",
    runtime: "codex",
    accountId: "",
    weixinBaseUrl: "http://127.0.0.1",
    weixinCdnBaseUrl: "https://cdn.example.com",
    weixinReplyMode: "stream",
    weixinDeliveryTrace: false,
    weixinQrBotType: "3",
    weixinRouteTag: "",
    weixinProtocolClientVersion: "2.1.1",
    accountsDir: path.join(tempRoot, "accounts"),
    logDir: path.join(tempRoot, "logs"),
    reminderQueueFile: path.join(tempRoot, "reminder-queue.json"),
    checkinConfigFile: path.join(tempRoot, "checkin-config.json"),
    checkinScheduleStateFile: path.join(tempRoot, "checkin-schedule-state.json"),
    systemMessageDeadLetterFile: path.join(tempRoot, "system-message-dead-letter.json"),
    systemMessageQueueFile: path.join(tempRoot, "system-message-queue.json"),
    timelineScreenshotQueueFile: path.join(tempRoot, "timeline-screenshot-queue.json"),
    cliIdempotencyLedgerFile: path.join(tempRoot, "cli-idempotency-ledger.json"),
    weixinInstructionsFile: path.join(tempRoot, "weixin-instructions.md"),
    weixinInstructionsOverlayFile: path.join(tempRoot, "weixin-instructions.local.md"),
    weixinOperationsFile: path.join(tempRoot, "weixin-operations.md"),
    weixinOperationsOverlayFile: path.join(tempRoot, "weixin-operations.local.md"),
    syncBufferDir: path.join(tempRoot, "sync-buffers"),
    runtimeEndpoint: "",
    runtimeCommand: "",
    runtimeAccessMode: "workspace-write",
    codexAccessMode: "",
    hermesCommand: "hermes",
    hermesHome: path.join(tempRoot, ".hermes"),
    hermesRepoRoot: "",
    hermesRepoLocalShimPath: "",
    hermesPythonCommand: "",
    sessionsFile: path.join(tempRoot, "sessions.json"),
    workspaceBootstrapConfigFile: path.join(tempRoot, "workspace-bootstrap.json"),
    projectRadarConfigFile: path.join(workspaceRoot, ".codex", "code-projects.json"),
    durableNoteSchemaConfigFile: path.join(workspaceRoot, ".codex", "durable-note-schema.json"),
    reviewSchemaConfigFile: path.join(workspaceRoot, ".codex", "review-schema.json"),
    reviewSemanticMode: "hybrid",
    reviewSemanticHost: "auto",
    reviewSemanticModel: "",
    reviewSemanticTimeoutMs: 120_000,
    sharedBridgeHeartbeatFile: path.join(tempRoot, "logs", "shared-wechat-heartbeat.json"),
    sharedWatchdogStateFile: path.join(tempRoot, "logs", "shared-watchdog-state.json"),
    startWithCheckin: false,
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
    getAvailableModelCatalog() {
      return null;
    },
    getBinding(candidateBindingKey) {
      return this.state?.bindings?.[candidateBindingKey] || null;
    },
    getRuntimeParamsForWorkspace() {
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
  };

  const sessionWriter: SessionStoreWriterLike = {
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

  const channelAdapter: ChannelAdapterLike = {
    describe() {
      return buildTestChannelDescriptor("test-channel");
    },
    getKnownContextTokens() {
      return { "user-1": "ctx-1" };
    },
    async getUpdates() {
      return { ret: 0, msgs: [] };
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
      return buildTestRuntimeDescriptor("test-runtime");
    },
    getSessionStore() {
      return sessionStore;
    },
    getSessionWriter() {
      return sessionWriter;
    },
    async initialize() {
      return { endpoint: "ws://127.0.0.1:8765", models: [] };
    },
    onEvent() {
      return () => undefined;
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
    complete() {
      return { status: "sent", message: null };
    },
    deadLetter() {
      return { status: "dead_letter", message: null };
    },
    defer() {
      return { status: "deferred", message: null };
    },
    hasPendingForAccount() {
      return false;
    },
    takeReadyForAccount() {
      return [];
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
  }: CreateAppServicesArgs) => {
    const systemMessageDispatcherState: SystemMessageDispatcherRef = { current: null };
    const channelCommandRouter: ChannelCommandRouterLike = {
      async maybeDispatchCommand(_normalized: unknown) {
        return false;
      },
    };
    const resolveDefaultTerminalUser = () => "user-1";
    const resolveReplyTargetForBinding = () => ({
      userId: "user-1",
      contextToken: "ctx-1",
      provider: "weixin",
    });
    const resolveWorkspaceRoot = () => workspaceRoot;

    const runtimeWatchdogLifecycle: RuntimeWatchdogLifecycleLike = new RuntimeWatchdogLifecycle({
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
      sessionWriter,
      streamDelivery,
      streamSettlementTimeoutMs: 5 * 60_000,
      threadStateStore,
    });

    const runtimeTurnLifecycle: RuntimeTurnLifecycleLike = new RuntimeTurnLifecycle({
      buildRuntimeInboundText: (normalized: { text?: string }) => normalizeText(normalized.text),
      channelAdapter,
      config,
      formatErrorMessage,
      maybeDispatchCommand: (normalized: NormalizedIncomingMessage) => channelCommandRouter.maybeDispatchCommand(normalized),
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
        normalized: PreparedRuntimeMessage;
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
      handlePreparedMessage: (normalized, options) => runtimeTurnLifecycle.handlePreparedMessage(normalized, options),
      hasRpcId: (requestId: unknown) => normalizeText(requestId).length > 0,
      normalizeText,
      reminderQueue,
      resolveWorkspaceRoot,
      runtimeAdapter,
      sendTimelineScreenshot: (payload) => runtimeTurnLifecycle.sendTimelineScreenshot(payload),
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
      sessionWriter,
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
