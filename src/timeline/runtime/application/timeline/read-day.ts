import type { TimelineReadDayResult } from "../../contracts";
import type { TimelineRuntimeConfig } from "../../../runtime-config";
import { createTimelineStore } from "./shared";

interface TimelineReadDayInput {
  date?: string;
}

async function readTimelineDay(
  config: TimelineRuntimeConfig,
  input: TimelineReadDayInput,
): Promise<TimelineReadDayResult> {
  const payload = input && typeof input === "object" ? input : {};
  const date = String(payload.date || "").trim();
  if (!date) {
    throw new Error("timeline-read 缺少日期，传 --date YYYY-MM-DD");
  }

  const store = createTimelineStore(config);
  const day = store.getDay(date);
  if (!day) {
    return {
      date,
      exists: false,
      status: "missing",
      updatedAt: "",
      eventCount: 0,
      events: [],
    };
  }

  return {
    date,
    exists: true,
    status: day.status || "draft",
    updatedAt: day.updatedAt || "",
    eventCount: Array.isArray(day.events) ? day.events.length : 0,
    events: Array.isArray(day.events)
      ? day.events.map((event: (typeof day.events)[number]) => ({
        id: event.id,
        startAt: event.startAt,
        endAt: event.endAt,
        title: event.title,
        note: event.note || "",
        categoryId: event.categoryId,
        subcategoryId: event.subcategoryId,
        eventNodeId: event.eventNodeId || "",
        tags: Array.isArray(event.tags) ? [...event.tags] : [],
        confidence: Number(event.confidence || 0),
        sourceMessageIds: Array.isArray(event.sourceMessageIds) ? [...event.sourceMessageIds] : [],
      }))
      : [],
  };
}

export { readTimelineDay };
