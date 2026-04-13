import { readPrefixedEnv } from "../contracts/app-env";
import type { CheckinConfig } from "../contracts/checkin-config";
import { CheckinConfigStore } from "./checkin-config-store";

export const DEFAULT_CHECKIN_MIN_INTERVAL_MS = 3 * 60_000;
export const DEFAULT_CHECKIN_MAX_INTERVAL_MS = 60 * 60_000;

export interface ResolvedCheckinConfig {
  minIntervalMs: number;
  maxIntervalMs: number;
  source: "stored" | "env" | "default";
  storedConfig: CheckinConfig | null;
}

export function resolveCheckinConfig({
  filePath,
  env = process.env,
}: {
  filePath: string;
  env?: NodeJS.ProcessEnv;
}): ResolvedCheckinConfig {
  const store = new CheckinConfigStore({ filePath });
  const storedConfig = store.getConfig();
  if (storedConfig) {
    return {
      minIntervalMs: storedConfig.minIntervalMs,
      maxIntervalMs: storedConfig.maxIntervalMs,
      source: "stored",
      storedConfig,
    };
  }

  const envMin = readIntervalMs(readPrefixedEnv(env, "CHECKIN_MIN_INTERVAL_MS"));
  const envMax = readIntervalMs(readPrefixedEnv(env, "CHECKIN_MAX_INTERVAL_MS"));
  if (envMin || envMax) {
    const minIntervalMs = envMin || DEFAULT_CHECKIN_MIN_INTERVAL_MS;
    const maxIntervalMs = Math.max(minIntervalMs, envMax || DEFAULT_CHECKIN_MAX_INTERVAL_MS);
    return {
      minIntervalMs,
      maxIntervalMs,
      source: "env",
      storedConfig: null,
    };
  }

  return {
    minIntervalMs: DEFAULT_CHECKIN_MIN_INTERVAL_MS,
    maxIntervalMs: DEFAULT_CHECKIN_MAX_INTERVAL_MS,
    source: "default",
    storedConfig: null,
  };
}

export function parseCheckinRangeArgument(value: unknown): { minIntervalMs: number; maxIntervalMs: number } | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) {
    return null;
  }
  const matched = normalized.match(/^(\d+)(?:m)?\s*-\s*(\d+)(?:m)?$/u);
  if (!matched) {
    return null;
  }
  const minMinutes = Number.parseInt(matched[1] || "", 10);
  const maxMinutes = Number.parseInt(matched[2] || "", 10);
  if (!Number.isInteger(minMinutes) || !Number.isInteger(maxMinutes) || minMinutes < 1 || maxMinutes < minMinutes) {
    return null;
  }
  return {
    minIntervalMs: minMinutes * 60_000,
    maxIntervalMs: maxMinutes * 60_000,
  };
}

export function formatCheckinRange(config: Pick<ResolvedCheckinConfig, "minIntervalMs" | "maxIntervalMs">): string {
  return `${Math.round(config.minIntervalMs / 60_000)}m-${Math.round(config.maxIntervalMs / 60_000)}m`;
}

function readIntervalMs(rawValue: unknown): number {
  const parsed = Number.parseInt(String(rawValue || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
