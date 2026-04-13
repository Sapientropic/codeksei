import * as fs from "node:fs";
import * as path from "node:path";
import { ensureStateDirectory, readPrefixedBoolEnv, readPrefixedEnv, resolveStateDir } from "../core/branding";
import { loadEnvStack } from "../core/env-loader";
import { resolvePackageRoot } from "../core/path-utils";
import { DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS } from "./shared-bridge-heartbeat";
import type { SharedProcessContext } from "./shared-types";


interface ResolveSharedProcessContextArgs {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function loadSharedEnv({
  cwd = resolvePackageRoot(__dirname),
  env = process.env,
}: ResolveSharedProcessContextArgs = {}): void {
  loadEnvStack({ cwd, env });
  ensureStateDirectory({ env });
}

function resolveSharedProcessContext({
  cwd = resolvePackageRoot(__dirname),
  env = process.env,
}: ResolveSharedProcessContextArgs = {}): SharedProcessContext {
  loadSharedEnv({ cwd, env });
  const port = String(readPrefixedEnv(env, "SHARED_PORT") || "8765");
  const stateDir = resolveStateDir({ env });
  const logDir = path.join(stateDir, "logs");
  return {
    rootDir: cwd,
    port,
    listenUrl: `ws://127.0.0.1:${port}`,
    stateDir,
    logDir,
    accountsDir: path.join(stateDir, "accounts"),
    sessionFile: readPrefixedEnv(env, "SESSIONS_FILE") || path.join(stateDir, "sessions.json"),
    appServerPidFile: path.join(logDir, "shared-app-server.pid"),
    bridgePidFile: path.join(logDir, "shared-wechat.pid"),
    supervisorPidFile: path.join(logDir, "shared-supervisor.pid"),
    appServerLogFile: path.join(logDir, "shared-app-server.log"),
    bridgeLogFile: path.join(logDir, "shared-wechat.log"),
    supervisorLogFile: path.join(logDir, "shared-supervisor.log"),
    bridgeHeartbeatFile: path.join(logDir, "shared-wechat-heartbeat.json"),
    watchdogStateFile: path.join(logDir, "shared-watchdog-state.json"),
    bridgeHeartbeatMaxAgeMs: Number.parseInt(
      String(readPrefixedEnv(env, "SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS") || ""),
      10,
    ) || DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS,
    sharedUseBundledCodexBinary: readPrefixedBoolEnv(env, "SHARED_USE_BUNDLED_CODEX_BINARY", true),
    sharedDisablePlugins: readPrefixedBoolEnv(env, "SHARED_DISABLE_PLUGINS", false),
    sharedDisableShellSnapshot: readPrefixedBoolEnv(env, "SHARED_DISABLE_SHELL_SNAPSHOT", false),
  };
}

function ensureLogDir(context: SharedProcessContext = resolveSharedProcessContext()): void {
  fs.mkdirSync(context.logDir, { recursive: true });
}

export {
  ensureLogDir,
  loadSharedEnv,
  resolveSharedProcessContext,
};

export type {
  SharedProcessContext,
};
