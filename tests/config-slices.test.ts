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
      pageArtifactsDir: "E:/state/page-artifacts",
      reminderQueueFile: "E:/state/reminder-queue.json",
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
      locale: "zh-CN",
      allowedUserIds: ["wx-user"],
    },
    weixinBridge: {
      accountId: "acct-1",
      accountsDir: "E:/state/accounts",
      weixinBaseUrl: "http://127.0.0.1",
      weixinCdnBaseUrl: "https://cdn.example.com",
      weixinDeliveryConfigFile: "E:/state/weixin-delivery-config.json",
      weixinReplyMode: "stream",
      weixinDeliveryTrace: false,
      weixinQrBotType: "3",
      weixinRouteTag: "",
      weixinProtocolClientVersion: "2.1.8",
    },
    runtimeHost: {
      channel: "weixin",
      channelProvider: "codeksei",
      runtime: "codex",
      runtimeEndpoint: "",
      runtimeCommand: "codex",
      runtimeAccessMode: "workspace-write",
      codexAccessMode: "current",
      claudeCommand: "claude",
      claudeContextWindow: 0,
      claudeDisableVerbose: false,
      claudeExtraArgs: [],
      claudeMcpConfigPaths: [],
      claudeStrictMcpConfig: false,
      claudeMaxOutputTokens: 0,
      claudeModel: "",
      claudePermissionMode: "default",
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
      projectRadarConfigFile: "E:/workspace/.codeksei/code-projects.json",
      durableNoteSchemaConfigFile: "E:/workspace/.codeksei/durable-note-schema.json",
      reviewSchemaConfigFile: "E:/workspace/.codeksei/review-schema.json",
      reviewSemanticMode: "hybrid",
      reviewSemanticHost: "auto",
      reviewSemanticModel: "gpt-5.4",
      reviewSemanticTimeoutMs: 120000,
      companionSemanticMode: "",
      companionSemanticHost: "",
      companionSemanticModel: "",
      companionSemanticTimeoutMs: 15000,
      onboardingSemanticMode: "",
      onboardingSemanticHost: "",
      onboardingSemanticModel: "",
      onboardingSemanticTimeoutMs: 15000,
      proactiveJudgmentApiKey: "",
      proactiveJudgmentEndpoint: "http://127.0.0.1:11434/v1",
      proactiveJudgmentHost: "auto",
      proactiveJudgmentMinConfidence: 0.62,
      proactiveJudgmentMode: "hybrid",
      proactiveJudgmentModel: "qwen3.5:2b",
      proactiveJudgmentTimeoutMs: 2500,
      proactiveObservationApiKey: "",
      proactiveObservationEndpoint: "http://127.0.0.1:8080/v1",
      proactiveObservationHost: "auto",
      proactiveObservationMinConfidence: 0.55,
      proactiveObservationMode: "hybrid",
      proactiveObservationModel: "gemma-4-E2B-it",
      proactiveObservationTimeoutMs: 8000,
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
    whereaboutsRuntime: {
      whereaboutsHost: "127.0.0.1",
      whereaboutsPlacesFile: "E:/state/whereabouts/places.json",
      whereaboutsPort: 4318,
      whereaboutsRetentionDays: 30,
      whereaboutsToken: "",
    },
  });

  assert.equal(config.workspaceRoot, "E:/workspace");
  assert.equal(config.reviewSchemaConfigFile, "E:/workspace/.codeksei/review-schema.json");
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
  assert.equal(config.projectRadarConfigFile.replace(/\\/g, "/"), "E:/workspace/current/.codeksei/code-projects.json");
  assert.equal(config.reviewSchemaConfigFile.replace(/\\/g, "/"), "E:/workspace/current/.codeksei/review-schema.json");
  assert.equal(config.companionSemanticTimeoutMs, 15000);
  assert.equal(config.onboardingSemanticTimeoutMs, 15000);
  assert.equal(config.proactiveJudgmentHost, "auto");
  assert.equal(config.proactiveJudgmentEndpoint, "http://127.0.0.1:11434/v1");
  assert.equal(config.proactiveJudgmentMinConfidence, 0.62);
  assert.equal(config.proactiveObservationHost, "auto");
  assert.equal(config.proactiveObservationEndpoint, "http://127.0.0.1:8080/v1");
  assert.equal(config.proactiveObservationModel, "gemma-4-E2B-it");
  assert.equal(config.proactiveObservationMinConfidence, 0.55);
  assert.equal(config.checkinConfigFile.replace(/\\/g, "/"), "E:/state/checkin-config.json");
  assert.equal(config.pageArtifactsDir.replace(/\\/g, "/"), "E:/state/page-artifacts");
  assert.equal(config.weixinDeliveryConfigFile.replace(/\\/g, "/"), "E:/state/weixin-delivery-config.json");
  assert.equal(config.systemMessageQueueFile.replace(/\\/g, "/"), "E:/state/system-message-queue.json");
});

test("parseEnvConfig resolves Claude Code runtime config without falling back to Codex defaults", () => {
  const config = parseEnvConfig({
    CODEKSEI_STATE_DIR: "E:/state",
    CODEKSEI_WORKSPACE_ROOT: "E:/workspace/current",
    CODEKSEI_RUNTIME: "claudecode",
    CODEKSEI_RUNTIME_COMMAND: "runtime-default",
    CODEKSEI_CLAUDE_COMMAND: "claude-beta",
    CODEKSEI_CLAUDE_MODEL: "claude-sonnet-4-5",
    CODEKSEI_CLAUDE_PERMISSION_MODE: "acceptEdits",
    CODEKSEI_CLAUDE_DISABLE_VERBOSE: "1",
    CODEKSEI_CLAUDE_EXTRA_ARGS: "--dangerously-skip-permissions --debug",
    CODEKSEI_CLAUDE_MCP_CONFIG: "E:/mcp-one.json;E:/mcp-two.json",
    CODEKSEI_CLAUDE_STRICT_MCP_CONFIG: "1",
    CODEKSEI_CLAUDE_CONTEXT_WINDOW: "200000",
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: "8192",
  });

  assert.equal(config.runtime, "claudecode");
  assert.equal(config.channelProvider, "codeksei");
  assert.equal(config.runtimeCommand, "runtime-default");
  assert.equal(config.claudeCommand, "claude-beta");
  assert.equal(config.claudeModel, "claude-sonnet-4-5");
  assert.equal(config.claudePermissionMode, "acceptEdits");
  assert.equal(config.claudeDisableVerbose, true);
  assert.deepEqual(config.claudeExtraArgs, ["--dangerously-skip-permissions", "--debug"]);
  assert.deepEqual(config.claudeMcpConfigPaths, ["E:/mcp-one.json", "E:/mcp-two.json"]);
  assert.equal(config.claudeStrictMcpConfig, true);
  assert.equal(config.claudeContextWindow, 200000);
  assert.equal(config.claudeMaxOutputTokens, 8192);
});
