import { normalizeText } from "../core/text-normalization";
import * as path from "node:path";
import { readPrefixedEnv, readPrefixedIntEnv, resolveStateDir } from "../contracts/app-env";
import { resolveTimelineStateFiles } from "../core/timezone";
import type { TimelineLocale } from "./runtime/contracts";
import { resolveTimelineLocale } from "./runtime/infra/i18n/timeline-locale";

interface TimelineRuntimeBaseConfig {
  stateDir?: unknown;
  timelineLocale?: unknown;
  timelineStateDir?: unknown;
}

interface TimelineRuntimeConfig {
  chromeExecutablePath: string;
  stateDir: string;
  timelineDbFile: string;
  timelineDir: string;
  timelineFactsFile: string;
  timelineLocale: TimelineLocale;
  timelinePort: number;
  timelineSiteDir: string;
  timelineStateFile: string;
  timelineTaxonomyFile: string;
  timelineWriteLockDir: string;
}

function resolveTimelineRuntimeConfig(
  baseConfig: TimelineRuntimeBaseConfig = {},
): TimelineRuntimeConfig {
  const stateDir = normalizePath(baseConfig.stateDir)
    || resolveStateDir({ env: process.env });
  const timelineStateDir = normalizePath(baseConfig.timelineStateDir)
    || normalizePath(process.env.TIMELINE_FOR_AGENT_STATE_DIR)
    || stateDir;
  const timelineFiles = resolveTimelineStateFiles(timelineStateDir);

  return {
    chromeExecutablePath: resolveTimelineChromePath(),
    stateDir,
    timelineDbFile: path.join(timelineFiles.dir, "timeline-db.json"),
    timelineDir: timelineFiles.dir,
    timelineFactsFile: timelineFiles.factsFile,
    timelineLocale: resolveConfiguredTimelineLocale(baseConfig.timelineLocale),
    timelinePort: resolveTimelinePort(),
    timelineSiteDir: path.join(timelineFiles.dir, "site"),
    timelineStateFile: timelineFiles.stateFile,
    timelineTaxonomyFile: timelineFiles.taxonomyFile,
    timelineWriteLockDir: path.join(timelineFiles.dir, "timeline-write.lock"),
  };
}

function resolveTimelineChromePath(): string {
  return normalizePath(readPrefixedEnv(process.env, "SCREENSHOT_CHROME_PATH"))
    || normalizePath(process.env.TIMELINE_FOR_AGENT_CHROME_PATH);
}

function resolveTimelinePort(): number {
  const codekseiPort = readPrefixedIntEnv(process.env, "TIMELINE_PORT", 0);
  if (codekseiPort > 0) {
    return codekseiPort;
  }
  const legacyPort = Number.parseInt(String(process.env.TIMELINE_FOR_AGENT_PORT || "").trim(), 10);
  return Number.isFinite(legacyPort) && legacyPort > 0 ? legacyPort : 4317;
}

function resolveConfiguredTimelineLocale(rawValue: unknown): TimelineLocale {
  return resolveTimelineLocale(
    normalizeText(rawValue)
      || readPrefixedEnv(process.env, "TIMELINE_LOCALE")
      || process.env.TIMELINE_FOR_AGENT_LOCALE
  );
}

function normalizePath(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export {
  resolveTimelineRuntimeConfig,
};

export type {
  TimelineRuntimeConfig,
};

