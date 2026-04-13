import * as os from "node:os";
import * as path from "node:path";
import {
  resolveCrossPlatformPathFromRoot,
  resolvePackageRoot,
} from "./path-utils";
import { resolveTimezoneConfig } from "./timezone";
import { readPrefixedBoolEnv, readPrefixedEnv, readPrefixedIntEnv, readPrefixedListEnv, resolveAppHome, resolveStateDir } from "./branding";


function readConfig() {
  const packageRoot = resolvePackageRoot(__dirname);
  const stateDir = resolveStateDir({ env: process.env });
  const workspaceRoot = readPrefixedEnv(process.env, "WORKSPACE_ROOT") || process.cwd();
  const timelineStateDir = readPrefixedEnv(process.env, "TIMELINE_STATE_DIR") || stateDir;
  const timezoneConfig = resolveTimezoneConfig({
    explicitTimezone: readPrefixedEnv(process.env, "TIMEZONE"),
    timelineStateDir,
  });
  const appHome = resolveAppHome({
    env: process.env,
    fallbackRoot: packageRoot,
  }) || packageRoot;

  return {
    stateDir,
    codekseiHome: appHome,
    workspaceId: readPrefixedEnv(process.env, "WORKSPACE_ID") || "default",
    workspaceRoot,
    timezone: timezoneConfig.timezone,
    timezoneSource: timezoneConfig.source,
    timezoneExplicit: timezoneConfig.explicit,
    timelineStateTimezone: timezoneConfig.timelineStateTimezone,
    diaryDir: readPrefixedEnv(process.env, "DIARY_DIR") || path.join(stateDir, "diary"),
    timelineStateDir,
    userName: readPrefixedEnv(process.env, "USER_NAME") || "",
    userGender: readPrefixedEnv(process.env, "USER_GENDER") || "female",
    allowedUserIds: readPrefixedListEnv(process.env, "ALLOWED_USER_IDS"),
    channel: readPrefixedEnv(process.env, "CHANNEL") || "weixin",
    runtime: readPrefixedEnv(process.env, "RUNTIME") || "codex",
    accountId: readPrefixedEnv(process.env, "ACCOUNT_ID"),
    weixinBaseUrl: readPrefixedEnv(process.env, "WEIXIN_BASE_URL") || "https://ilinkai.weixin.qq.com",
    weixinCdnBaseUrl: readPrefixedEnv(process.env, "WEIXIN_CDN_BASE_URL") || "https://novac2c.cdn.weixin.qq.com/c2c",
    weixinAdapterVariant: readPrefixedEnv(process.env, "WEIXIN_ADAPTER") || "v2",
    weixinReplyMode: normalizeWeixinReplyMode(readPrefixedEnv(process.env, "WEIXIN_REPLY_MODE") || "stream"),
    weixinDeliveryTrace: readPrefixedBoolEnv(process.env, "WEIXIN_DELIVERY_TRACE"),
    weixinQrBotType: readPrefixedEnv(process.env, "WEIXIN_QR_BOT_TYPE") || "3",
    weixinRouteTag: readPrefixedEnv(process.env, "WEIXIN_ROUTE_TAG"),
    weixinProtocolClientVersion: readPrefixedEnv(process.env, "WEIXIN_PROTOCOL_CLIENT_VERSION") || "2.1.1",
    accountsDir: path.join(stateDir, "accounts"),
    logDir: path.join(stateDir, "logs"),
    reminderQueueFile: path.join(stateDir, "reminder-queue.json"),
    checkinConfigFile: path.join(stateDir, "checkin-config.json"),
    systemMessageQueueFile: path.join(stateDir, "system-message-queue.json"),
    systemMessageDeadLetterFile: path.join(stateDir, "system-message-dead-letter.json"),
    timelineScreenshotQueueFile: path.join(stateDir, "timeline-screenshot-queue.json"),
    weixinInstructionsFile: readPrefixedEnv(process.env, "WEIXIN_INSTRUCTIONS_FILE")
      || path.join(packageRoot, "templates", "weixin-instructions.md"),
    weixinInstructionsOverlayFile: readPrefixedEnv(process.env, "WEIXIN_INSTRUCTIONS_OVERLAY_FILE")
      || path.join(stateDir, "weixin-instructions.local.md"),
    weixinOperationsFile: path.join(packageRoot, "templates", "weixin-operations.md"),
    weixinOperationsOverlayFile: readPrefixedEnv(process.env, "WEIXIN_OPERATIONS_OVERLAY_FILE")
      || path.join(stateDir, "weixin-operations.local.md"),
    syncBufferDir: path.join(stateDir, "sync-buffers"),
    codexEndpoint: readPrefixedEnv(process.env, "CODEX_ENDPOINT"),
    codexCommand: readPrefixedEnv(process.env, "CODEX_COMMAND"),
    codexAccessMode: readPrefixedEnv(process.env, "CODEX_ACCESS_MODE"),
    sessionsFile: path.join(stateDir, "sessions.json"),
    workspaceBootstrapConfigFile: readPrefixedEnv(process.env, "WORKSPACE_BOOTSTRAP_CONFIG")
      || path.join(stateDir, "workspace-bootstrap.json"),
    projectRadarConfigFile: readPrefixedEnv(process.env, "PROJECT_RADAR_CONFIG")
      || resolveCrossPlatformPathFromRoot(workspaceRoot, ".codex", "code-projects.json"),
    durableNoteSchemaConfigFile: readPrefixedEnv(process.env, "DURABLE_NOTE_SCHEMA_CONFIG")
      || resolveCrossPlatformPathFromRoot(workspaceRoot, ".codex", "durable-note-schema.json"),
    reviewSchemaConfigFile: readPrefixedEnv(process.env, "REVIEW_SCHEMA_CONFIG")
      || resolveCrossPlatformPathFromRoot(workspaceRoot, ".codex", "review-schema.json"),
    reviewSemanticMode: readPrefixedEnv(process.env, "REVIEW_SEMANTIC_MODE") || "hybrid",
    reviewSemanticModel: readPrefixedEnv(process.env, "REVIEW_SEMANTIC_MODEL"),
    reviewSemanticTimeoutMs: readPrefixedIntEnv(process.env, "REVIEW_SEMANTIC_TIMEOUT_MS") || 120000,
    sharedBridgeHeartbeatFile: path.join(stateDir, "logs", "shared-wechat-heartbeat.json"),
    sharedWatchdogStateFile: path.join(stateDir, "logs", "shared-watchdog-state.json"),
    startWithCheckin: readPrefixedBoolEnv(process.env, "ENABLE_CHECKIN"),
  };
}

function normalizeWeixinReplyMode(value: any) {
  return String(value || "").trim().toLowerCase() === "settled" ? "settled" : "stream";
}

export { readConfig };
