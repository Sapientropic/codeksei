// @ts-check

const {
  compareTimelineScreenshotJobs,
  normalizeTimelineScreenshotJob,
  timelineScreenshotQueueStateSchema,
} = require("../contracts/queue-items");
const {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} = require("./json-state");

class TimelineScreenshotQueueStore {
  filePath: any;
  state: Record<string, any>;

  constructor({ filePath }: any) {
    this.filePath = filePath;
    this.state = { jobs: [] };
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory() {
    ensureParentDirectory(this.filePath);
  }

  load() {
    const parsed = readManagedJsonStateFile({
      filePath: this.filePath,
      fallback: { jobs: [] },
      label: "timeline screenshot queue",
      schema: timelineScreenshotQueueStateSchema,
    });
    const normalizedState = /** @type {{ jobs?: unknown[] }} */ (parsed || {});
    const jobs = Array.isArray(normalizedState.jobs) ? normalizedState.jobs : [];
    this.state = {
      jobs: jobs
        .map(normalizeTimelineScreenshotJob)
        .filter(Boolean)
        .sort(compareTimelineScreenshotJobs),
    };
  }

  save() {
    writeManagedJsonStateFile(this.filePath, this.state);
  }

  enqueue(job: any) {
    this.load();
    const normalized = normalizeTimelineScreenshotJob(job);
    if (!normalized) {
      throw new Error("invalid timeline screenshot job");
    }
    this.state.jobs.push(normalized);
    this.state.jobs.sort(compareTimelineScreenshotJobs);
    this.save();
    return normalized;
  }

  drainForAccount(accountId: any) {
    this.load();
    const normalizedAccountId = normalizeText(accountId);
    const drained = [];
    const pending = [];

    for (const job of this.state.jobs) {
      if (job.accountId === normalizedAccountId) {
        drained.push(job);
      } else {
        pending.push(job);
      }
    }

    if (drained.length) {
      this.state.jobs = pending;
      this.save();
    }

    return drained;
  }

  hasPendingForAccount(accountId: any) {
    this.load();
    const normalizedAccountId = normalizeText(accountId);
    return this.state.jobs.some((job: any) => job.accountId === normalizedAccountId);
  }
}

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { TimelineScreenshotQueueStore };

export {};
