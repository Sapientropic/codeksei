const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

import type { AppRuntimeConfig } from "../src/core/app-service-contract";
const { CodekseiApp }: typeof import("../src/core/app") = require("../src/core/app");
const { createAppServices }: typeof import("../src/core/app-runtime-factory") = require("../src/core/app-runtime-factory");

function createRuntimeConfig(): AppRuntimeConfig {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-app-factory-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  fs.mkdirSync(workspaceRoot, { recursive: true });

  return {
    accountId: "",
    accountsDir: path.join(tempRoot, "accounts"),
    allowedUserIds: ["user-1"],
    channel: "weixin",
    channelProvider: "codeksei",
    checkinConfigFile: path.join(tempRoot, "checkin-config.json"),
    checkinScheduleStateFile: path.join(tempRoot, "checkin-schedule-state.json"),
    cliIdempotencyLedgerFile: path.join(tempRoot, "cli-idempotency-ledger.json"),
    codekseiHome: tempRoot,
    codexAccessMode: "current",
    diaryDir: path.join(tempRoot, "diary"),
    durableNoteSchemaConfigFile: path.join(workspaceRoot, ".codex", "durable-note-schema.json"),
    hermesCommand: "hermes",
    hermesHome: path.join(tempRoot, ".hermes"),
    hermesPythonCommand: "",
    hermesRepoLocalShimPath: "",
    hermesRepoRoot: "",
    logDir: path.join(tempRoot, "logs"),
    projectRadarConfigFile: path.join(workspaceRoot, ".codex", "code-projects.json"),
    reminderQueueFile: path.join(tempRoot, "reminder-queue.json"),
    reviewSchemaConfigFile: path.join(workspaceRoot, ".codex", "review-schema.json"),
    reviewSemanticHost: "auto",
    reviewSemanticMode: "hybrid",
    reviewSemanticModel: "",
    reviewSemanticTimeoutMs: 120_000,
    companionSemanticHost: "",
    companionSemanticMode: "",
    companionSemanticModel: "",
    companionSemanticTimeoutMs: 15_000,
    onboardingSemanticHost: "",
    onboardingSemanticMode: "",
    onboardingSemanticModel: "",
    onboardingSemanticTimeoutMs: 15_000,
    runtime: "codex",
    runtimeAccessMode: "workspace-write",
    runtimeCommand: "",
    runtimeEndpoint: "",
    sessionsFile: path.join(tempRoot, "sessions.json"),
    sharedBridgeHeartbeatFile: path.join(tempRoot, "logs", "shared-wechat-heartbeat.json"),
    sharedWatchdogStateFile: path.join(tempRoot, "logs", "shared-watchdog-state.json"),
    startWithCheckin: false,
    stateDir: tempRoot,
    syncBufferDir: path.join(tempRoot, "sync-buffers"),
    systemMessageDeadLetterFile: path.join(tempRoot, "system-message-dead-letter.json"),
    systemMessageQueueFile: path.join(tempRoot, "system-message-queue.json"),
    timelineScreenshotQueueFile: path.join(tempRoot, "timeline-screenshot-queue.json"),
    timelineStateDir: tempRoot,
    timelineStateTimezone: "",
    timezone: "Asia/Shanghai",
    timezoneExplicit: false,
    timezoneSource: "system",
    userGender: "female",
    userName: "Tester",
    weixinBaseUrl: "http://127.0.0.1",
    weixinCdnBaseUrl: "https://cdn.example.com",
    weixinDeliveryTrace: false,
    weixinInstructionsFile: path.join(tempRoot, "weixin-instructions.md"),
    weixinInstructionsOverlayFile: path.join(tempRoot, "weixin-instructions.local.md"),
    weixinOperationsFile: path.join(tempRoot, "weixin-operations.md"),
    weixinOperationsOverlayFile: path.join(tempRoot, "weixin-operations.local.md"),
    weixinProtocolClientVersion: "2.1.8",
    weixinQrBotType: "3",
    weixinReplyMode: "stream" as const,
    weixinRouteTag: "",
    workspaceBootstrapConfigFile: path.join(tempRoot, "workspace-bootstrap.json"),
    workspaceId: "workspace-1",
    workspaceRoot,
  };
}

test("createAppServices composes the runtime graph from config alone", () => {
  const config = createRuntimeConfig();
  const services = createAppServices({ config });

  assert.equal(typeof services.runtimeAdapter.getSessionWriter, "function");
  assert.equal(typeof services.runtimeTurnLifecycle.handlePreparedMessage, "function");
  assert.equal(typeof services.backstageTaskLifecycle.dispatchSystemMessage, "function");
});

test("CodekseiApp passes only config into the factory seam", () => {
  const config = createRuntimeConfig();
  let receivedArgs: Record<string, unknown> | null = null;

  new CodekseiApp(config as never, {
    createAppServices(args) {
      receivedArgs = args as unknown as Record<string, unknown>;
      return {
        backstageTaskLifecycle: {
          dispatchSystemMessage: async () => ({ status: "sent", reason: "" }),
          flushDueReminders: async () => undefined,
          flushPendingSystemMessages: async () => undefined,
          flushPendingTimelineScreenshots: async () => undefined,
        },
        channelAdapter: {
          describe: () => ({ id: "test-channel" }),
          getKnownContextTokens: () => ({}),
          loadSyncBuffer: () => "",
          normalizeIncomingMessage: () => null,
          printAccounts: () => undefined,
          resolveAccount: () => ({ accountId: "acct-1", baseUrl: "http://127.0.0.1" }),
        },
        channelCommandRouter: {
          maybeDispatchCommand: async () => false,
        },
        reminderQueue: {},
        runtimeAdapter: {
          close: async () => undefined,
          describe: () => ({ id: "test-runtime" }),
          getSessionStore: () => ({
            getActiveWorkspaceRoot: () => "",
            getBinding: () => null,
          }),
          getSessionWriter: () => ({
            rememberApprovalPrefixForWorkspace: async () => [],
            rememberPendingApprovalForThread: async () => undefined,
            rememberWorkspaceBootstrapForThread: async () => undefined,
            setActiveWorkspaceRoot: async () => undefined,
            setRuntimeParamsForWorkspace: async () => undefined,
            setThreadIdForWorkspace: async () => undefined,
            clearThreadIdForWorkspace: async () => undefined,
          }),
          initialize: async () => ({ endpoint: "ws://127.0.0.1", models: [] }),
          onEvent: () => () => undefined,
        },
        sessionWriter: {
          rememberApprovalPrefixForWorkspace: async () => [],
          rememberPendingApprovalForThread: async () => undefined,
          rememberWorkspaceBootstrapForThread: async () => undefined,
          setActiveWorkspaceRoot: async () => undefined,
          setRuntimeParamsForWorkspace: async () => undefined,
          setThreadIdForWorkspace: async () => undefined,
          clearThreadIdForWorkspace: async () => undefined,
        },
        runtimeTurnLifecycle: {
          handlePreparedMessage: async () => undefined,
          prepareIncomingMessageForRuntime: async () => null,
          sendLocalFileToCurrentChat: async () => undefined,
          sendPreparedMessageToRuntime: async () => ({ status: "sent", threadId: "thread-1" }),
          sendTimelineScreenshot: async () => undefined,
          withUserTyping: async (_options: unknown, work: () => Promise<unknown>) => work(),
        },
        runtimeWatchdogLifecycle: {
          clearRuntimeEventWatchdog: () => undefined,
          clearTurnSettlementWatchdog: () => undefined,
          confirmPendingWorkspaceBootstrap: async () => undefined,
          handleRuntimeEvent: async () => undefined,
          observeRuntimeEvent: () => undefined,
          queuePendingWorkspaceBootstrap: () => undefined,
          refreshTurnSettlementWatchdog: () => undefined,
          restoreBoundThreadSubscriptions: async () => undefined,
          scheduleRuntimeEventWatchdog: () => undefined,
          sendApprovalPrompt: async () => undefined,
          sendFailureToThread: async () => undefined,
          stopTypingForThread: async () => undefined,
        },
        streamDelivery: {
          finalizeAbandonedTurn: async () => undefined,
          handleRuntimeEvent: async () => undefined,
          queueReplyTargetForThread: () => undefined,
          setReplyTarget: () => undefined,
        },
        systemMessageDispatcherState: { current: null },
        systemMessageQueue: {},
        threadStateStore: {
          applyRuntimeEvent: () => undefined,
          snapshot: () => ({}),
        },
        timelineIntegration: {
          describe: () => ({ id: "test-timeline" }),
          runSubcommand: async () => undefined,
        },
        timelineScreenshotQueue: {},
      } as never;
    },
  });

  assert.deepEqual(receivedArgs, { config });
});
