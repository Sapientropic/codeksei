import * as path from "node:path";
import { readPrefixedEnv, readPrefixedIntEnv, resolveStateDir } from "../core/branding";
import { resolveTimelineStateFiles } from "../core/timezone";

interface TimelineRuntimeBaseConfig extends Record<string, unknown> {
  stateDir?: unknown;
  timelineStateDir?: unknown;
}

interface TimelineRuntimeConfig {
  chromeExecutablePath: string;
  stateDir: string;
  timelineDbFile: string;
  timelineDir: string;
  timelineFactsFile: string;
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

function normalizePath(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export {
  resolveTimelineRuntimeConfig,
};

export type {
  TimelineRuntimeConfig,
};
