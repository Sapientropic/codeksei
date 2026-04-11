const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveCrossPlatformPath } = require("./path-utils");

const APP_NAME = "Codeksei";
const LEGACY_APP_NAME = "Cyberboss";
const PACKAGE_NAME = "codeksei";
const LEGACY_PACKAGE_NAME = "cyberboss";
const PRIMARY_ENV_PREFIX = "CODEKSEI";
const LEGACY_ENV_PREFIX = "CYBERBOSS";
const PRIMARY_STATE_DIRNAME = ".codeksei";
const LEGACY_STATE_DIRNAME = ".cyberboss";
const PRIMARY_NOTE_SYNC_MARKER_PREFIX = "codeksei-note-sync";
const LEGACY_NOTE_SYNC_MARKER_PREFIX = "cyberboss-note-sync";
const PRIMARY_REVIEW_MARKER_PREFIX = "codeksei-review";
const LEGACY_REVIEW_MARKER_PREFIX = "cyberboss-review";
const PRIMARY_CHANNEL_VERSION = "codeksei-weixin/2.0";
const PRIMARY_RPC_CLIENT_INFO = {
  name: "codeksei_agent",
  title: "Codeksei Agent",
  version: "0.1.0",
};
const PRIMARY_WINDOWS_SHARED_TASK_NAMES = {
  start: "Codeksei Shared Start",
  unlock: "Codeksei Shared Unlock",
  resume: "Codeksei Shared Resume",
  watchdog: "Codeksei Shared Watchdog",
};
const LEGACY_WINDOWS_SHARED_TASK_NAMES = {
  start: "Cyberboss Shared Start",
  unlock: "Cyberboss Shared Unlock",
  resume: "Cyberboss Shared Resume",
  watchdog: "Cyberboss Shared Watchdog",
};

function normalizeEnvValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readNamedEnv(env, primaryKey, legacyKey) {
  const primary = normalizeEnvValue(env?.[primaryKey]);
  if (primary) {
    return primary;
  }
  return normalizeEnvValue(env?.[legacyKey]);
}

function readPrefixedEnv(env, suffix) {
  return readNamedEnv(env, `${PRIMARY_ENV_PREFIX}_${suffix}`, `${LEGACY_ENV_PREFIX}_${suffix}`);
}

function readNamedBoolEnv(env, primaryKey, legacyKey, defaultValue = false) {
  const raw = readNamedEnv(env, primaryKey, legacyKey).toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return defaultValue;
}

function readPrefixedBoolEnv(env, suffix, defaultValue = false) {
  return readNamedBoolEnv(env, `${PRIMARY_ENV_PREFIX}_${suffix}`, `${LEGACY_ENV_PREFIX}_${suffix}`, defaultValue);
}

function readPrefixedListEnv(env, suffix) {
  return String(readPrefixedEnv(env, suffix) || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readPrefixedIntEnv(env, suffix, defaultValue = 0) {
  const value = Number.parseInt(readPrefixedEnv(env, suffix), 10);
  return Number.isFinite(value) ? value : defaultValue;
}

function getPrimaryStateDir() {
  return path.join(os.homedir(), PRIMARY_STATE_DIRNAME);
}

function getLegacyStateDir() {
  return path.join(os.homedir(), LEGACY_STATE_DIRNAME);
}

function resolveStateDir({ env = process.env } = {}) {
  const explicit = readPrefixedEnv(env, "STATE_DIR");
  if (explicit) {
    return resolveCrossPlatformPath(explicit);
  }

  const primary = getPrimaryStateDir();
  const legacy = getLegacyStateDir();
  if (fs.existsSync(primary)) {
    return primary;
  }
  if (fs.existsSync(legacy)) {
    return legacy;
  }
  return primary;
}

function ensureStateDirectory({ env = process.env } = {}) {
  const stateDir = resolveStateDir({ env });
  fs.mkdirSync(stateDir, { recursive: true });
  return stateDir;
}

function listEnvFileCandidates({ cwd = process.cwd(), env = process.env } = {}) {
  const stateDir = resolveStateDir({ env });
  return [
    path.join(cwd, ".env"),
    path.join(stateDir, ".env"),
  ];
}

function resolveAppHome({ env = process.env, fallbackRoot = "" } = {}) {
  return readPrefixedEnv(env, "HOME") || fallbackRoot;
}

function ensureCompatHomeEnv({ env = process.env, fallbackRoot = "" } = {}) {
  const resolved = resolveAppHome({ env, fallbackRoot });
  if (!resolved) {
    return "";
  }
  if (!normalizeEnvValue(env.CODEKSEI_HOME)) {
    env.CODEKSEI_HOME = resolved;
  }
  if (!normalizeEnvValue(env.CYBERBOSS_HOME)) {
    env.CYBERBOSS_HOME = resolved;
  }
  return resolved;
}

module.exports = {
  APP_NAME,
  LEGACY_APP_NAME,
  PACKAGE_NAME,
  LEGACY_PACKAGE_NAME,
  PRIMARY_CHANNEL_VERSION,
  PRIMARY_ENV_PREFIX,
  LEGACY_ENV_PREFIX,
  PRIMARY_NOTE_SYNC_MARKER_PREFIX,
  LEGACY_NOTE_SYNC_MARKER_PREFIX,
  PRIMARY_REVIEW_MARKER_PREFIX,
  LEGACY_REVIEW_MARKER_PREFIX,
  PRIMARY_RPC_CLIENT_INFO,
  PRIMARY_WINDOWS_SHARED_TASK_NAMES,
  LEGACY_WINDOWS_SHARED_TASK_NAMES,
  getPrimaryStateDir,
  getLegacyStateDir,
  listEnvFileCandidates,
  readNamedEnv,
  readNamedBoolEnv,
  readPrefixedBoolEnv,
  readPrefixedEnv,
  readPrefixedIntEnv,
  readPrefixedListEnv,
  resolveAppHome,
  resolveStateDir,
  ensureCompatHomeEnv,
  ensureStateDirectory,
};
