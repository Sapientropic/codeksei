// @ts-check

const {
  compareTimelineScreenshotJobs,
  normalizeTimelineScreenshotJob,
  validateTimelineScreenshotQueueState,
} = require("../contracts/queue-items");
const {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} = require("./json-state");

class TimelineScreenshotQueueStore {
  constructor({ filePath }) {
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
      validate: validateTimelineScreenshotQueueState,
    });
    const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
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

  enqueue(job) {
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

  drainForAccount(accountId) {
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

  hasPendingForAccount(accountId) {
    this.load();
    const normalizedAccountId = normalizeText(accountId);
    return this.state.jobs.some((job) => job.accountId === normalizedAccountId);
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = { TimelineScreenshotQueueStore };
