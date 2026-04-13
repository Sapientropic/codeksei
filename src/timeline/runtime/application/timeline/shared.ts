import * as fs from "node:fs";
import * as path from "node:path";

import type { TimelineRuntimeConfig } from "../../../runtime-config";
import { TimelineStore } from "../../infra/timeline/timeline-store";

interface TimelineDashboardBuildOptions {
  siteDir: string;
  entryFile: string;
  cssFile: string;
}

interface TimelineDashboardBuildInput extends TimelineDashboardBuildOptions {
  store: TimelineStore;
}

interface TimelineWriteLockOptions {
  timeoutMs?: number;
  retryDelayMs?: number;
}

function createTimelineStore(config: TimelineRuntimeConfig): TimelineStore {
  return new TimelineStore({
    stateFilePath: config.timelineStateFile,
    taxonomyFilePath: config.timelineTaxonomyFile,
    factsFilePath: config.timelineFactsFile,
    legacyFilePath: config.timelineDbFile,
  });
}

function getTimelineDashboardBuildOptions(config: TimelineRuntimeConfig): TimelineDashboardBuildOptions {
  return {
    siteDir: config.timelineSiteDir,
    entryFile: path.join(__dirname, "..", "..", "timeline", "dashboard-app.js"),
    cssFile: path.join(__dirname, "..", "..", "timeline", "css", "dashboard.css"),
  };
}

function createTimelineDashboardBuildInput(config: TimelineRuntimeConfig): TimelineDashboardBuildInput {
  return {
    store: createTimelineStore(config),
    ...getTimelineDashboardBuildOptions(config),
  };
}

async function withTimelineWriteLock<T>(
  config: TimelineRuntimeConfig,
  action: () => Promise<T> | T,
  options: TimelineWriteLockOptions = {},
): Promise<T> {
  const lockDir = String(config.timelineWriteLockDir || "").trim();
  if (!lockDir) {
    return await action();
  }
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });

  const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : 5_000;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) && Number(options.retryDelayMs) > 0
    ? Number(options.retryDelayMs)
    : 50;
  const startedAt = Date.now();

  while (true) {
    try {
      fs.mkdirSync(lockDir, { recursive: false });
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
        throw error;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error("timeline-write 正在被其他进程占用，请稍后重试");
      }
      await sleep(retryDelayMs);
    }
  }

  try {
    return await action();
  } finally {
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // Ignore lock cleanup errors so the original write result wins.
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export {
  createTimelineDashboardBuildInput,
  createTimelineStore,
  getTimelineDashboardBuildOptions,
  withTimelineWriteLock,
};
