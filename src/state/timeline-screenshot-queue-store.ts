import { normalizeText } from "../core/text-normalization";
import {
  compareTimelineScreenshotJobs,
  normalizeTimelineScreenshotJob,
  timelineScreenshotQueueStateSchema,
  type TimelineScreenshotJob,
} from "../contracts/queue-items";
import {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} from "./json-state";

interface TimelineScreenshotQueueState {
  jobs: TimelineScreenshotJob[];
}

class TimelineScreenshotQueueStore {
  filePath: string;
  state: TimelineScreenshotQueueState;

  constructor({ filePath }: { filePath: string }) {
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
    const normalizedState = /** @type {{ jobs?: import("../contracts/queue-items").TimelineScreenshotJob[] }} */ (parsed || {});
    const jobs = Array.isArray(normalizedState.jobs)
      ? normalizedState.jobs.slice() as TimelineScreenshotJob[]
      : [];
    this.state = {
      jobs: jobs.sort(compareTimelineScreenshotJobs),
    };
  }

  save() {
    writeManagedJsonStateFile(this.filePath, this.state);
  }

  enqueue(job: unknown): TimelineScreenshotJob {
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

  drainForAccount(accountId: unknown): TimelineScreenshotJob[] {
    this.load();
    const normalizedAccountId = normalizeText(accountId);
    const drained: TimelineScreenshotJob[] = [];
    const pending: TimelineScreenshotJob[] = [];

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

  hasPendingForAccount(accountId: unknown): boolean {
    this.load();
    const normalizedAccountId = normalizeText(accountId);
    return this.state.jobs.some((job) => job.accountId === normalizedAccountId);
  }
}

export { TimelineScreenshotQueueStore };

