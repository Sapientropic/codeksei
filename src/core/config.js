const os = require("os");
const path = require("path");
const {
  readPrefixedBoolEnv,
  readPrefixedEnv,
  readPrefixedIntEnv,
  readPrefixedListEnv,
  resolveAppHome,
  resolveStateDir,
} = require("./branding");

function readConfig() {
  const argv = process.argv.slice(2);
  const mode = argv[0] || "";
  const stateDir = resolveStateDir({ env: process.env });
  const workspaceRoot = readPrefixedEnv(process.env, "WORKSPACE_ROOT") || process.cwd();
  const appHome = resolveAppHome({
    env: process.env,
    fallbackRoot: path.resolve(__dirname, "..", ".."),
  }) || path.resolve(__dirname, "..", "..");

  return {
    mode,
    argv,
    stateDir,
    codekseiHome: appHome,
    cyberbossHome: appHome,
    workspaceId: readPrefixedEnv(process.env, "WORKSPACE_ID") || "default",
    workspaceRoot,
    diaryDir: readPrefixedEnv(process.env, "DIARY_DIR") || path.join(stateDir, "diary"),
    timelineStateDir: readPrefixedEnv(process.env, "TIMELINE_STATE_DIR") || stateDir,
    userName: readPrefixedEnv(process.env, "USER_NAME") || "用户",
    userGender: readPrefixedEnv(process.env, "USER_GENDER") || "female",
    allowedUserIds: readPrefixedListEnv(process.env, "ALLOWED_USER_IDS"),
    channel: readPrefixedEnv(process.env, "CHANNEL") || "weixin",
    runtime: readPrefixedEnv(process.env, "RUNTIME") || "codex",
    timelineCommand: readPrefixedEnv(process.env, "TIMELINE_COMMAND") || "timeline-for-agent",
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
    systemMessageQueueFile: path.join(stateDir, "system-message-queue.json"),
    timelineScreenshotQueueFile: path.join(stateDir, "timeline-screenshot-queue.json"),
    weixinInstructionsFile: path.join(stateDir, "weixin-instructions.md"),
    weixinOperationsFile: path.resolve(__dirname, "..", "..", "templates", "weixin-operations.md"),
    syncBufferDir: path.join(stateDir, "sync-buffers"),
    codexEndpoint: readPrefixedEnv(process.env, "CODEX_ENDPOINT"),
    codexCommand: readPrefixedEnv(process.env, "CODEX_COMMAND"),
    codexAccessMode: readPrefixedEnv(process.env, "CODEX_ACCESS_MODE"),
    sessionsFile: path.join(stateDir, "sessions.json"),
    workspaceBootstrapConfigFile: readPrefixedEnv(process.env, "WORKSPACE_BOOTSTRAP_CONFIG")
      || path.join(stateDir, "workspace-bootstrap.json"),
    projectRadarConfigFile: readPrefixedEnv(process.env, "PROJECT_RADAR_CONFIG")
      || path.resolve(workspaceRoot, ".codex", "code-projects.json"),
    durableNoteSchemaConfigFile: readPrefixedEnv(process.env, "DURABLE_NOTE_SCHEMA_CONFIG")
      || path.resolve(workspaceRoot, ".codex", "durable-note-schema.json"),
    reviewSchemaConfigFile: readPrefixedEnv(process.env, "REVIEW_SCHEMA_CONFIG")
      || path.resolve(workspaceRoot, ".codex", "review-schema.json"),
    reviewSemanticMode: readPrefixedEnv(process.env, "REVIEW_SEMANTIC_MODE") || "hybrid",
    reviewSemanticModel: readPrefixedEnv(process.env, "REVIEW_SEMANTIC_MODEL"),
    reviewSemanticTimeoutMs: readPrefixedIntEnv(process.env, "REVIEW_SEMANTIC_TIMEOUT_MS") || 120000,
    sharedBridgeHeartbeatFile: path.join(stateDir, "logs", "shared-wechat-heartbeat.json"),
    sharedWatchdogStateFile: path.join(stateDir, "logs", "shared-watchdog-state.json"),
    startWithCheckin: (mode === "start" && hasArgFlag(argv, "--checkin")) || readPrefixedBoolEnv(process.env, "ENABLE_CHECKIN"),
  };
}

function normalizeWeixinReplyMode(value) {
  return String(value || "").trim().toLowerCase() === "settled" ? "settled" : "stream";
}

function hasArgFlag(argv, flag) {
  return Array.isArray(argv) && argv.some((item) => String(item || "").trim() === flag);
}

module.exports = { readConfig };
