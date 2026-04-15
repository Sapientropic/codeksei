import type { CodekseiHostConfig } from "../contracts/codeksei-config";
import { resolveCodekseiConfigPath, readCodekseiHostConfig } from "../contracts/codeksei-config";

export function loadResolvedHostConfig(explicitPath: unknown, cwd: string): {
  path: string;
  config: CodekseiHostConfig | null;
} {
  const filePath = resolveCodekseiConfigPath(explicitPath, cwd);
  return {
    path: filePath,
    config: readCodekseiHostConfig(filePath),
  };
}

export function applyHostConfigEnvFallback(
  env: NodeJS.ProcessEnv,
  cwd: string,
  explicitPath?: unknown,
): CodekseiHostConfig | null {
  const resolved = loadResolvedHostConfig(explicitPath, cwd);
  const config = resolved.config;
  if (!config) {
    return null;
  }

  setEnvIfMissing(env, "CODEKSEI_STATE_DIR", config.stateDir);
  setEnvIfMissing(env, "CODEKSEI_WORKSPACE_ROOT", config.workspaceRoot);
  setEnvIfMissing(env, "CODEKSEI_CHANNEL", config.host.channel);
  setEnvIfMissing(env, "CODEKSEI_ALLOWED_USER_IDS", config.user.id);
  setEnvIfMissing(env, "CODEKSEI_USER_NAME", config.user.name);
  setEnvIfMissing(env, "CODEKSEI_TIMEZONE", config.user.timezone);
  if (config.host.provider === "hermes") {
    setEnvIfMissing(env, "CODEKSEI_RUNTIME", "hermes");
    setEnvIfMissing(env, "CODEKSEI_CHANNEL_PROVIDER", "hermes");
  }
  return config;
}

function setEnvIfMissing(env: NodeJS.ProcessEnv, key: string, value: string): void {
  if (env[key]) {
    return;
  }
  const normalized = String(value || "").trim();
  if (!normalized) {
    return;
  }
  env[key] = normalized;
}
