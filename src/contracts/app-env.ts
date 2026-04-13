import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { resolveCrossPlatformPath } from "./path-utils";

type EnvMap = Record<string, unknown>;

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

function normalizeEnvValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNamedEnv(env: EnvMap, key: string): string {
  return normalizeEnvValue(env?.[key]);
}

function readPrefixedEnv(env: EnvMap, suffix: string): string {
  return readNamedEnv(env, `${PRIMARY_ENV_PREFIX}_${suffix}`);
}

function readNamedBoolEnv(env: EnvMap, key: string, defaultValue: boolean = false): boolean {
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

function readPrefixedBoolEnv(env: EnvMap, suffix: string, defaultValue: boolean = false): boolean {
  return readNamedBoolEnv(env, `${PRIMARY_ENV_PREFIX}_${suffix}`, defaultValue);
}

function readPrefixedListEnv(env: EnvMap, suffix: string): string[] {
  return String(readPrefixedEnv(env, suffix) || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readPrefixedIntEnv(env: EnvMap, suffix: string, defaultValue: number = 0): number {
  const value = Number.parseInt(readPrefixedEnv(env, suffix), 10);
  return Number.isFinite(value) ? value : defaultValue;
}

function getPrimaryStateDir(): string {
  return path.join(os.homedir(), PRIMARY_STATE_DIRNAME);
}

function resolveStateDir({ env = process.env as EnvMap }: { env?: EnvMap } = {}): string {
  const explicit = readPrefixedEnv(env, "STATE_DIR");
  if (explicit) {
    return resolveCrossPlatformPath(explicit);
  }
  return getPrimaryStateDir();
}

function ensureStateDirectory({ env = process.env as EnvMap }: { env?: EnvMap } = {}): string {
  const stateDir = resolveStateDir({ env });
  fs.mkdirSync(stateDir, { recursive: true });
  return stateDir;
}

function listEnvFileCandidates({
  cwd = process.cwd(),
  env = process.env as EnvMap,
}: {
  cwd?: string;
  env?: EnvMap;
} = {}): string[] {
  const stateDir = resolveStateDir({ env });
  return [
    path.join(cwd, ".env"),
    path.join(stateDir, ".env"),
  ];
}

function resolveAppHome({
  env = process.env as EnvMap,
  fallbackRoot = "",
}: {
  env?: EnvMap;
  fallbackRoot?: string;
} = {}): string {
  return readPrefixedEnv(env, "HOME") || fallbackRoot;
}

function ensureCodekseiHomeEnv({
  env = process.env as EnvMap,
  fallbackRoot = "",
}: {
  env?: EnvMap;
  fallbackRoot?: string;
} = {}): string {
  const resolved = resolveAppHome({ env, fallbackRoot });
  if (!resolved) {
    return "";
  }
  if (!normalizeEnvValue(env.CODEKSEI_HOME)) {
    env.CODEKSEI_HOME = resolved;
  }
  return resolved;
}

export {
  PACKAGE_NAME,
  PRIMARY_CHANNEL_VERSION,
  PRIMARY_ENV_PREFIX,
  PRIMARY_NOTE_SYNC_MARKER_PREFIX,
  PRIMARY_REVIEW_MARKER_PREFIX,
  PRIMARY_RPC_CLIENT_INFO,
  ensureCodekseiHomeEnv,
  ensureStateDirectory,
  getPrimaryStateDir,
  listEnvFileCandidates,
  readNamedBoolEnv,
  readNamedEnv,
  readPrefixedBoolEnv,
  readPrefixedEnv,
  readPrefixedIntEnv,
  readPrefixedListEnv,
  resolveAppHome,
  resolveStateDir,
};
