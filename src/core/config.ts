import * as path from "node:path";
import type { AppRuntimeConfig } from "./app-service-contract";
import { composeAppRuntimeConfig } from "./config-slices";
import {
  resolveCrossPlatformPathFromRoot,
  resolvePackageRoot,
} from "./path-utils";
import { resolveWorkspaceScopedConfigFile } from "./workspace-config-paths";
import {
  resolveHermesHomePath,
  resolveHermesRepoLocalShimPath,
  resolveHermesRepoRoot,
} from "./hermes-repo-local";
import { TENCENT_OPENCLAW_WEIXIN_VERSION } from "../contracts/weixin-official";
import {
  normalizeCodekseiChannel,
  normalizeCodekseiChannelProvider,
  normalizeCodekseiRuntimeAccessMode,
  normalizeCodekseiRuntimeProvider,
  normalizeOptionalReviewSemanticHost,
  normalizeReviewSemanticHost,
  normalizeWeixinReplyMode,
} from "./config-value-types";
import { resolveTimezoneConfig } from "./timezone";
import { readPrefixedBoolEnv, readPrefixedEnv, readPrefixedIntEnv, readPrefixedListEnv, resolveAppHome, resolveStateDir } from "./branding";

interface ReadConfigOptions {
  workspaceRoot?: string;
}

type EnvSource = NodeJS.ProcessEnv & Record<string, string | undefined>;

function readConfig(options: ReadConfigOptions = {}): AppRuntimeConfig {
  return parseEnvConfig(process.env, options);
}

function parseEnvConfig(env: EnvSource, options: ReadConfigOptions = {}): AppRuntimeConfig {
  const packageRoot = resolvePackageRoot(__dirname);
  const stateDir = resolveStateDir({ env });
  const workspaceRoot = options.workspaceRoot
    || readPrefixedEnv(env, "WORKSPACE_ROOT")
    || process.cwd();
  const timelineStateDir = readPrefixedEnv(env, "TIMELINE_STATE_DIR") || stateDir;
  const timezoneConfig = resolveTimezoneConfig({
    explicitTimezone: readPrefixedEnv(env, "TIMEZONE"),
    timelineStateDir,
  });
  const appHome = resolveAppHome({
    env,
    fallbackRoot: packageRoot,
  }) || packageRoot;
  const hermesHome = resolveHermesHomePath({
    hermesHome: readPrefixedEnv(env, "HERMES_HOME") || env.HERMES_HOME,
  });
  const hermesRepoRoot = resolveHermesRepoRoot({
    hermesRepoRoot: readPrefixedEnv(env, "HERMES_REPO_ROOT"),
  });
  const hermesRepoLocalShimPath = resolveHermesRepoLocalShimPath({
    hermesRepoLocalShimPath: readPrefixedEnv(env, "HERMES_REPO_LOCAL_SHIM_PATH"),
  });
  const runtimeAccessMode = normalizeCodekseiRuntimeAccessMode(
    readPrefixedEnv(env, "RUNTIME_ACCESS_MODE") || readPrefixedEnv(env, "CODEX_ACCESS_MODE"),
  );
  const codexAccessMode = normalizeCodekseiRuntimeAccessMode(readPrefixedEnv(env, "CODEX_ACCESS_MODE"));
  const runtime = normalizeCodekseiRuntimeProvider(
    readPrefixedEnv(env, "RUNTIME") || (readPrefixedEnv(env, "CHANNEL_PROVIDER") === "hermes" ? "hermes" : "codex"),
  ) || "codex";
  const channelProvider = normalizeCodekseiChannelProvider(
    readPrefixedEnv(env, "CHANNEL_PROVIDER") || (runtime === "hermes" ? "hermes" : "codeksei"),
  ) || (runtime === "hermes" ? "hermes" : "codeksei");
  const channel = normalizeCodekseiChannel(readPrefixedEnv(env, "CHANNEL")) || "weixin";

  return composeAppRuntimeConfig({
    workspacePaths: {
      stateDir,
      codekseiHome: appHome,
      workspaceId: readPrefixedEnv(env, "WORKSPACE_ID") || "default",
      workspaceRoot,
      diaryDir: readPrefixedEnv(env, "DIARY_DIR") || path.join(stateDir, "diary"),
      timelineStateDir,
      logDir: path.join(stateDir, "logs"),
      reminderQueueFile: path.join(stateDir, "reminder-queue.json"),
      cliIdempotencyLedgerFile: path.join(stateDir, "cli-idempotency-ledger.json"),
      syncBufferDir: path.join(stateDir, "sync-buffers"),
      sessionsFile: path.join(stateDir, "sessions.json"),
      sharedBridgeHeartbeatFile: path.join(stateDir, "logs", "shared-wechat-heartbeat.json"),
      sharedWatchdogStateFile: path.join(stateDir, "logs", "shared-watchdog-state.json"),
    },
    identityAndTime: {
      timezone: timezoneConfig.timezone,
      timezoneSource: timezoneConfig.source,
      timezoneExplicit: timezoneConfig.explicit,
      timelineStateTimezone: timezoneConfig.timelineStateTimezone,
      userName: readPrefixedEnv(env, "USER_NAME") || "",
      userGender: readPrefixedEnv(env, "USER_GENDER") || "neutral",
      userLanguage: readPrefixedEnv(env, "USER_LANGUAGE") || "zh-CN",
      allowedUserIds: readPrefixedListEnv(env, "ALLOWED_USER_IDS"),
    },
    weixinBridge: {
      accountId: readPrefixedEnv(env, "ACCOUNT_ID") || "",
      accountsDir: path.join(stateDir, "accounts"),
      weixinBaseUrl: readPrefixedEnv(env, "WEIXIN_BASE_URL") || "https://ilinkai.weixin.qq.com",
      weixinCdnBaseUrl: readPrefixedEnv(env, "WEIXIN_CDN_BASE_URL") || "https://novac2c.cdn.weixin.qq.com/c2c",
      weixinReplyMode: normalizeWeixinReplyMode(readPrefixedEnv(env, "WEIXIN_REPLY_MODE") || "stream"),
      weixinDeliveryTrace: readPrefixedBoolEnv(env, "WEIXIN_DELIVERY_TRACE"),
      weixinQrBotType: readPrefixedEnv(env, "WEIXIN_QR_BOT_TYPE") || "3",
      weixinRouteTag: readPrefixedEnv(env, "WEIXIN_ROUTE_TAG") || "",
      weixinProtocolClientVersion: readPrefixedEnv(env, "WEIXIN_PROTOCOL_CLIENT_VERSION") || TENCENT_OPENCLAW_WEIXIN_VERSION,
    },
    runtimeHost: {
      channel,
      runtime,
      channelProvider,
      runtimeEndpoint: readPrefixedEnv(env, "RUNTIME_ENDPOINT")
        || readPrefixedEnv(env, "CODEX_ENDPOINT")
        || "",
      runtimeCommand: readPrefixedEnv(env, "RUNTIME_COMMAND")
        || readPrefixedEnv(env, "CODEX_COMMAND")
        || "",
      runtimeAccessMode,
      codexAccessMode,
      hermesCommand: readPrefixedEnv(env, "HERMES_COMMAND")
        || env.HERMES_COMMAND
        || "hermes",
      hermesHome,
      hermesRepoRoot,
      hermesRepoLocalShimPath,
      hermesPythonCommand: readPrefixedEnv(env, "HERMES_PYTHON_COMMAND") || "",
    },
    schemaAndTemplate: {
      weixinInstructionsFile: readPrefixedEnv(env, "WEIXIN_INSTRUCTIONS_FILE")
        || path.join(packageRoot, "templates", "weixin-instructions.md"),
      weixinInstructionsOverlayFile: readPrefixedEnv(env, "WEIXIN_INSTRUCTIONS_OVERLAY_FILE")
        || path.join(stateDir, "weixin-instructions.local.md"),
      weixinOperationsFile: path.join(packageRoot, "templates", "weixin-operations.md"),
      weixinOperationsOverlayFile: readPrefixedEnv(env, "WEIXIN_OPERATIONS_OVERLAY_FILE")
        || path.join(stateDir, "weixin-operations.local.md"),
      workspaceBootstrapConfigFile: readPrefixedEnv(env, "WORKSPACE_BOOTSTRAP_CONFIG")
        || path.join(stateDir, "workspace-bootstrap.json"),
      projectRadarConfigFile: readPrefixedEnv(env, "PROJECT_RADAR_CONFIG")
        || resolveWorkspaceScopedConfigFile(workspaceRoot, "code-projects.json"),
      durableNoteSchemaConfigFile: readPrefixedEnv(env, "DURABLE_NOTE_SCHEMA_CONFIG")
        || resolveWorkspaceScopedConfigFile(workspaceRoot, "durable-note-schema.json"),
      reviewSchemaConfigFile: readPrefixedEnv(env, "REVIEW_SCHEMA_CONFIG")
        || resolveWorkspaceScopedConfigFile(workspaceRoot, "review-schema.json"),
      reviewSemanticMode: readPrefixedEnv(env, "REVIEW_SEMANTIC_MODE") || "hybrid",
      reviewSemanticHost: normalizeReviewSemanticHost(readPrefixedEnv(env, "REVIEW_SEMANTIC_HOST")),
      reviewSemanticModel: readPrefixedEnv(env, "REVIEW_SEMANTIC_MODEL") || "",
      reviewSemanticTimeoutMs: readPrefixedIntEnv(env, "REVIEW_SEMANTIC_TIMEOUT_MS") || 120000,
      companionSemanticMode: readPrefixedEnv(env, "COMPANION_SEMANTIC_MODE") || "",
      companionSemanticHost: normalizeOptionalReviewSemanticHost(readPrefixedEnv(env, "COMPANION_SEMANTIC_HOST")),
      companionSemanticModel: readPrefixedEnv(env, "COMPANION_SEMANTIC_MODEL") || "",
      companionSemanticTimeoutMs: readPrefixedIntEnv(env, "COMPANION_SEMANTIC_TIMEOUT_MS") || 15000,
      onboardingSemanticMode: readPrefixedEnv(env, "ONBOARDING_SEMANTIC_MODE") || "",
      onboardingSemanticHost: normalizeOptionalReviewSemanticHost(readPrefixedEnv(env, "ONBOARDING_SEMANTIC_HOST")),
      onboardingSemanticModel: readPrefixedEnv(env, "ONBOARDING_SEMANTIC_MODEL") || "",
      onboardingSemanticTimeoutMs: readPrefixedIntEnv(env, "ONBOARDING_SEMANTIC_TIMEOUT_MS") || 15000,
    },
    checkinRuntime: {
      workspaceId: readPrefixedEnv(env, "WORKSPACE_ID") || "default",
      workspaceRoot,
      allowedUserIds: readPrefixedListEnv(env, "ALLOWED_USER_IDS"),
      userName: readPrefixedEnv(env, "USER_NAME") || "",
      checkinConfigFile: path.join(stateDir, "checkin-config.json"),
      checkinScheduleStateFile: path.join(stateDir, "checkin-schedule-state.json"),
      systemMessageQueueFile: path.join(stateDir, "system-message-queue.json"),
      systemMessageDeadLetterFile: path.join(stateDir, "system-message-dead-letter.json"),
      startWithCheckin: readPrefixedBoolEnv(env, "ENABLE_CHECKIN"),
    },
  });
}

export { parseEnvConfig, readConfig };
