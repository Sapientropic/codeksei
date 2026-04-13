import type {
  TimelineMergeDayInput,
  TimelineReplaceDayInput,
  TimelineStatus,
} from "../../contracts";
import type { TimelineRuntimeConfig } from "../../../runtime-config";
import { createTimelineStore, withTimelineWriteLock } from "./shared";

interface TimelineWriteDayInput extends TimelineMergeDayInput {
  mode?: string;
  finalize?: boolean;
}

interface TimelineWriteDayResult {
  date: string;
  mode: string;
  eventCount: number;
  status: TimelineStatus | "missing";
}

async function writeTimelineDay(
  config: TimelineRuntimeConfig,
  input: TimelineWriteDayInput,
): Promise<TimelineWriteDayResult> {
  const payload = input && typeof input === "object" ? input : null;
  if (!payload) {
    throw new Error("timeline-write 需要对象输入");
  }
  const date = String(payload.date || "").trim();
  if (!date) {
    throw new Error("timeline-write 缺少日期，传 --date YYYY-MM-DD 或在 JSON 里带 date");
  }

  return withTimelineWriteLock(config, async () => {
    const store = createTimelineStore(config);
    const mode = String(payload.mode || "merge").trim().toLowerCase() || "merge";
    const common: TimelineReplaceDayInput = {
      date,
      status: payload.finalize ? "final" : ((payload.status as TimelineStatus | undefined) ?? "draft"),
      source: payload.source ?? null,
      events: Array.isArray(payload.events) ? payload.events : [],
      newEventNodes: Array.isArray(payload.newEventNodes) ? payload.newEventNodes : [],
    };

    const saved = mode === "replace"
      ? store.replaceDay(common)
      : store.mergeDay({
        ...common,
        dropEventIds: Array.isArray(payload.dropEventIds) ? payload.dropEventIds : [],
      });

    if (payload.finalize) {
      store.finalizeDay(date);
    }

    return {
      date,
      mode,
      eventCount: Array.isArray(saved?.events) ? saved.events.length : 0,
      status: payload.finalize ? "final" : (saved?.status || "missing"),
    };
  });
}

export { writeTimelineDay };
