const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  composeAppRuntimeConfig,
}: typeof import("../src/core/config-slices") = require("../src/core/config-slices");
const { parseEnvConfig }: typeof import("../src/core/config") = require("../src/core/config");

test("config slices compose into the legacy-compatible app runtime surface", () => {
  const config = composeAppRuntimeConfig({
    workspacePaths: {
      stateDir: "E:/state",
      codekseiHome: "E:/codeksei",
      workspaceId: "workspace-1",
      workspaceRoot: "E:/workspace",
      diaryDir: "E:/state/diary",
      timelineStateDir: "E:/state/timeline",
      logDir: "E:/state/logs",
      reminderQueueFile: "E:/state/reminder-queue.json",
      timelineScreenshotQueueFile: "E:/state/timeline-screenshot-queue.json",
      cliIdempotencyLedgerFile: "E:/state/cli-idempotency-ledger.json",
      syncBufferDir: "E:/state/sync-buffers",
      sessionsFile: "E:/state/sessions.json",
      sharedBridgeHeartbeatFile: "E:/state/logs/shared-heartbeat.json",
      sharedWatchdogStateFile: "E:/state/logs/shared-watchdog.json",
    },
    identityAndTime: {
      timezone: "Asia/Shanghai",
      timezoneSource: "env",
      timezoneExplicit: true,
      timelineStateTimezone: "Asia/Shanghai",
      userName: "Tester",
      userGender: "female",
      allowedUserIds: ["wx-user"],
    },
    weixinBridge: {
      accountId: "acct-1",
      accountsDir: "E:/state/accounts",
      weixinBaseUrl: "http://127.0.0.1",
      weixinCdnBaseUrl: "https://cdn.example.com",
      weixinAdapterVariant: "v2",
      weixinReplyMode: "stream",
      weixinDeliveryTrace: false,
      weixinQrBotType: "3",
      weixinRouteTag: "",
      weixinProtocolClientVersion: "2.1.1",
    },
    runtimeHost: {
      channel: "weixin",
      channelProvider: "codeksei",
      runtime: "codex",
      runtimeEndpoint: "",
      runtimeCommand: "codex",
      runtimeAccessMode: "workspace-write",
      codexAccessMode: "current",
      hermesCommand: "hermes",
      hermesHome: "E:/hermes",
      hermesRepoRoot: "E:/hermes-agent",
      hermesRepoLocalShimPath: "E:/hermes-agent/tools/hermes_repo_local/bridge.py",
      hermesPythonCommand: "python",
    },
    schemaAndTemplate: {
      weixinInstructionsFile: "E:/codeksei/templates/weixin-instructions.md",
      weixinInstructionsOverlayFile: "E:/state/weixin-instructions.local.md",
      weixinOperationsFile: "E:/codeksei/templates/weixin-operations.md",
      weixinOperationsOverlayFile: "E:/state/weixin-operations.local.md",
      workspaceBootstrapConfigFile: "E:/state/workspace-bootstrap.json",
      projectRadarConfigFile: "E:/workspace/.codex/code-projects.json",
      durableNoteSchemaConfigFile: "E:/workspace/.codex/durable-note-schema.json",
      reviewSchemaConfigFile: "E:/workspace/.codex/review-schema.json",
      reviewSemanticMode: "hybrid",
      reviewSemanticHost: "auto",
      reviewSemanticModel: "gpt-5.4",
      reviewSemanticTimeoutMs: 120000,
    },
    checkinRuntime: {
      workspaceId: "workspace-1",
      workspaceRoot: "E:/workspace",
      allowedUserIds: ["wx-user"],
      userName: "Tester",
      checkinConfigFile: "E:/state/checkin-config.json",
      checkinScheduleStateFile: "E:/state/checkin-schedule-state.json",
      systemMessageQueueFile: "E:/state/system-message-queue.json",
      systemMessageDeadLetterFile: "E:/state/system-message-dead-letter.json",
      startWithCheckin: false,
    },
  });

  assert.equal(config.workspaceRoot, "E:/workspace");
  assert.equal(config.reviewSchemaConfigFile, "E:/workspace/.codex/review-schema.json");
  assert.equal(config.checkinConfigFile, "E:/state/checkin-config.json");
  assert.equal(config.weixinBaseUrl, "http://127.0.0.1");
});

test("parseEnvConfig keeps workspace schema refs and state-backed checkin files aligned across slices", () => {
  const config = parseEnvConfig({
    CODEKSEI_STATE_DIR: "E:/state",
    CODEKSEI_WORKSPACE_ROOT: "E:/workspace/current",
    CODEKSEI_USER_NAME: "Tester",
  });

  assert.equal(config.workspaceRoot, "E:/workspace/current");
  assert.equal(config.projectRadarConfigFile.replace(/\\/g, "/"), "E:/workspace/current/.codex/code-projects.json");
  assert.equal(config.reviewSchemaConfigFile.replace(/\\/g, "/"), "E:/workspace/current/.codex/review-schema.json");
  assert.equal(config.checkinConfigFile.replace(/\\/g, "/"), "E:/state/checkin-config.json");
  assert.equal(config.systemMessageQueueFile.replace(/\\/g, "/"), "E:/state/system-message-queue.json");
});
