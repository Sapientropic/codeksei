const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveCrossPlatformPath } = require("./path-utils");

const PACKAGE_NAME = "codeksei";
const PRIMARY_ENV_PREFIX = "CODEKSEI";
const PRIMARY_STATE_DIRNAME = ".codeksei";
const PRIMARY_NOTE_SYNC_MARKER_PREFIX = "codeksei-note-sync";
const PRIMARY_REVIEW_MARKER_PREFIX = "codeksei-review";
const PRIMARY_CHANNEL_VERSION = "codeksei-weixin/2.0";
const PRIMARY_RPC_CLIENT_INFO = {
  name: "codeksei_agent",
  title: "Codeksei Agent",
  version: "0.1.0",
};
function normalizeEnvValue(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

function readNamedEnv(env: any, key: any) {
  return normalizeEnvValue(env?.[key]);
}

function readPrefixedEnv(env: any, suffix: any) {
  return readNamedEnv(env, `${PRIMARY_ENV_PREFIX}_${suffix}`);
}

function readNamedBoolEnv(env: any, key: any, defaultValue: boolean = false) {
  const raw = readNamedEnv(env, key).toLowerCase();
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

function readPrefixedBoolEnv(env: any, suffix: any, defaultValue: boolean = false) {
  return readNamedBoolEnv(env, `${PRIMARY_ENV_PREFIX}_${suffix}`, defaultValue);
}

function readPrefixedListEnv(env: any, suffix: any) {
  return String(readPrefixedEnv(env, suffix) || "")
    .split(",")
    .map((item: any) => item.trim())
    .filter(Boolean);
}

function readPrefixedIntEnv(env: any, suffix: any, defaultValue: number = 0) {
  const value = Number.parseInt(readPrefixedEnv(env, suffix), 10);
  return Number.isFinite(value) ? value : defaultValue;
}

function getPrimaryStateDir() {
  return path.join(os.homedir(), PRIMARY_STATE_DIRNAME);
}

function resolveStateDir({ env = process.env }: any = {}) {
  const explicit = readPrefixedEnv(env, "STATE_DIR");
  if (explicit) {
    return resolveCrossPlatformPath(explicit);
  }
  return getPrimaryStateDir();
}

function ensureStateDirectory({ env = process.env }: any = {}) {
  const stateDir = resolveStateDir({ env });
  fs.mkdirSync(stateDir, { recursive: true });
  return stateDir;
}

function listEnvFileCandidates({ cwd = process.cwd(), env = process.env }: any = {}) {
  const stateDir = resolveStateDir({ env });
  return [
    path.join(cwd, ".env"),
    path.join(stateDir, ".env"),
  ];
}

function resolveAppHome({ env = process.env, fallbackRoot = "" }: any = {}) {
  return readPrefixedEnv(env, "HOME") || fallbackRoot;
}

function ensureCodekseiHomeEnv({ env = process.env, fallbackRoot = "" }: any = {}) {
  const resolved = resolveAppHome({ env, fallbackRoot });
  if (!resolved) {
    return "";
  }
  if (!normalizeEnvValue(env.CODEKSEI_HOME)) {
    env.CODEKSEI_HOME = resolved;
  }
  return resolved;
}

module.exports = {
  PACKAGE_NAME,
  PRIMARY_CHANNEL_VERSION,
  PRIMARY_ENV_PREFIX,
  PRIMARY_NOTE_SYNC_MARKER_PREFIX,
  PRIMARY_REVIEW_MARKER_PREFIX,
  PRIMARY_RPC_CLIENT_INFO,
  getPrimaryStateDir,
  listEnvFileCandidates,
  readNamedEnv,
  readNamedBoolEnv,
  readPrefixedBoolEnv,
  readPrefixedEnv,
  readPrefixedIntEnv,
  readPrefixedListEnv,
  resolveAppHome,
  resolveStateDir,
  ensureCodekseiHomeEnv,
  ensureStateDirectory,
};

export {};
