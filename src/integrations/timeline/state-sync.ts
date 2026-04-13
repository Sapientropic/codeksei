import * as fs from "node:fs";

import { writeForeignJsonDocument } from "../../state/json-state";

import {
  LEGACY_TIMELINE_TIMEZONE,
  formatDateInTimezone,
  loadTimelineStateSnapshot,
  normalizeTimezone,
} from "../../core/timezone";
import type { TimelineStateFiles } from "../../core/timezone-state";

interface TimelineStateSyncConfig {
  timelineStateDir?: string;
  timezone?: unknown;
  timezoneExplicit?: boolean;
}

interface TimelineSourceRecord extends Record<string, unknown> {
  threadId?: unknown;
  workspaceRoot?: unknown;
  transcriptMessageCount?: unknown;
}

interface TimelineDayRecord extends Record<string, unknown> {
  status?: unknown;
  updatedAt?: unknown;
  source?: unknown;
  events?: unknown;
}

type TimelineEvent = Record<string, unknown> | unknown[] | string | number | boolean | null;

interface TimelineNormalizedSource {
  threadId: string;
  workspaceRoot: string;
  transcriptMessageCount: number;
}

interface TimelineNormalizedDay {
  status: "final" | "draft";
  updatedAt: string;
  source: TimelineNormalizedSource | null;
  events: TimelineEvent[];
}

interface TimelineSnapshotWritePayload {
  timezone: string;
  taxonomy: Record<string, unknown>;
  facts: Record<string, TimelineNormalizedDay>;
  proposals: unknown[];
}

function ensureTimelineStateTimezone(config: TimelineStateSyncConfig = {}): void {
  const desiredTimezone = normalizeTimezone(config.timezone);
  if (!desiredTimezone) {
    return;
  }

  const snapshot = loadTimelineStateSnapshot(normalizeText(config.timelineStateDir));
  if (!snapshot.paths.dir) {
    return;
  }

  const currentTimezone = snapshot.timezone
    || (snapshot.hasAnyFile ? LEGACY_TIMELINE_TIMEZONE : "");

  if (!snapshot.hasAnyFile) {
    initializeTimelineSnapshot(snapshot.paths, desiredTimezone);
    return;
  }

  if (currentTimezone === desiredTimezone) {
    if (!snapshot.timezone) {
      writeTimelineSnapshot(snapshot.paths, {
        timezone: desiredTimezone,
        taxonomy: snapshot.taxonomy,
        facts: regroupFactsByTimezone(snapshot.facts, desiredTimezone),
        proposals: snapshot.proposals,
      });
    }
    return;
  }

  if (!shouldSyncTimezone({ currentTimezone, desiredTimezone, config })) {
    return;
  }

  writeTimelineSnapshot(snapshot.paths, {
    timezone: desiredTimezone,
    taxonomy: snapshot.taxonomy,
    facts: regroupFactsByTimezone(snapshot.facts, desiredTimezone),
    proposals: snapshot.proposals,
  });
}

function shouldSyncTimezone({
  currentTimezone,
  desiredTimezone,
  config = {},
}: {
  currentTimezone: string;
  desiredTimezone: string;
  config?: TimelineStateSyncConfig;
}): boolean {
  if (!desiredTimezone) {
    return false;
  }
  if (!currentTimezone) {
    return true;
  }
  if (currentTimezone === desiredTimezone) {
    return false;
  }

  // Explicit env selection is authoritative. Without it, only auto-migrate
  // from the old hard-coded default so we do not silently rewrite a customized
  // timeline timezone just because this machine has a different OS setting.
  if (Boolean(config.timezoneExplicit)) {
    return true;
  }

  return currentTimezone === LEGACY_TIMELINE_TIMEZONE;
}

function regroupFactsByTimezone(
  facts: Record<string, unknown>,
  timezone: string,
): Record<string, TimelineNormalizedDay> {
  const buckets = new Map<string, TimelineNormalizedDay>();

  for (const [originalDate, rawDay] of Object.entries(facts || {})) {
    const day = asTimelineDayRecord(rawDay);
    const events = readTimelineEvents(day.events);
    if (!events.length) {
      mergeDayBucket(buckets, originalDate, day, []);
      continue;
    }

    for (const event of events) {
      const bucketDate = resolveEventBucketDate(event, timezone) || normalizeText(originalDate);
      mergeDayBucket(buckets, bucketDate, day, [event]);
    }
  }

  const output: Record<string, TimelineNormalizedDay> = {};
  for (const [date, day] of Array.from(buckets.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    if (!normalizeText(date)) {
      continue;
    }
    output[date] = {
      status: day.status,
      updatedAt: day.updatedAt,
      source: day.source,
      events: [...day.events].sort(compareEventsByStart),
    };
  }
  return output;
}

function mergeDayBucket(
  buckets: Map<string, TimelineNormalizedDay>,
  date: unknown,
  sourceDay: TimelineDayRecord,
  events: TimelineEvent[],
): void {
  const normalizedDate = normalizeText(date);
  if (!normalizedDate) {
    return;
  }

  const current = buckets.get(normalizedDate) || {
    status: "final",
    updatedAt: "",
    source: null,
    events: [],
  };

  current.status = current.status === "final" && isFinalStatus(sourceDay.status) ? "final" : "draft";
  current.updatedAt = pickLatestTimestamp(current.updatedAt, sourceDay.updatedAt);
  current.source = mergeSource(current.source, sourceDay.source);
  current.events.push(...events);
  buckets.set(normalizedDate, current);
}

function mergeSource(
  current: TimelineNormalizedSource | null,
  incoming: unknown,
): TimelineNormalizedSource | null {
  const right = normalizeSource(incoming);
  if (!current) {
    return right;
  }
  if (!right) {
    return current;
  }
  return JSON.stringify(current) === JSON.stringify(right) ? current : null;
}

function normalizeSource(source: unknown): TimelineNormalizedSource | null {
  const record = asTimelineSourceRecord(source);
  const threadId = normalizeText(record.threadId);
  const workspaceRoot = normalizeText(record.workspaceRoot);
  const transcriptMessageCount = Number.isFinite(Number(record.transcriptMessageCount))
    ? Number(record.transcriptMessageCount)
    : 0;
  if (!threadId && !workspaceRoot && transcriptMessageCount <= 0) {
    return null;
  }
  return {
    threadId,
    workspaceRoot,
    transcriptMessageCount,
  };
}

function pickLatestTimestamp(left: unknown, right: unknown): string {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  const leftValue = Date.parse(normalizedLeft);
  const rightValue = Date.parse(normalizedRight);
  if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
    return leftValue >= rightValue ? normalizedLeft : normalizedRight;
  }
  return normalizedRight || normalizedLeft;
}

function resolveEventBucketDate(event: TimelineEvent, timezone: string): string {
  return formatDateInTimezone(readEventField(event, "startAt"), timezone)
    || formatDateInTimezone(readEventField(event, "endAt"), timezone)
    || "";
}

function compareEventsByStart(left: TimelineEvent, right: TimelineEvent): number {
  const leftTime = Date.parse(normalizeText(readEventField(left, "startAt")));
  const rightTime = Date.parse(normalizeText(readEventField(right, "startAt")));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return String(readEventField(left, "id") || "").localeCompare(String(readEventField(right, "id") || ""));
}

function initializeTimelineSnapshot(paths: TimelineStateFiles, timezone: string): void {
  writeTimelineSnapshot(paths, {
    timezone,
    taxonomy: {},
    facts: {},
    proposals: [],
  });
}

function writeTimelineSnapshot(paths: TimelineStateFiles, snapshot: TimelineSnapshotWritePayload): void {
  fs.mkdirSync(paths.dir, { recursive: true });
  writeJsonFile(paths.stateFile, {
    version: 1,
    timezone: snapshot.timezone,
    taxonomy: snapshot.taxonomy,
    facts: snapshot.facts,
    proposals: snapshot.proposals,
  });
  writeJsonFile(paths.taxonomyFile, {
    version: 1,
    timezone: snapshot.timezone,
    taxonomy: snapshot.taxonomy,
  });
  writeJsonFile(paths.factsFile, {
    version: 1,
    timezone: snapshot.timezone,
    facts: snapshot.facts,
    proposals: snapshot.proposals,
  });
}

function writeJsonFile(filePath: string, value: unknown): void {
  // Timeline state files are now first-party Codeksei data. We still keep
  // timezone sync narrow: write atomically, but do not quarantine files here
  // the way bridge-managed runtime queues do, so one migration helper cannot
  // silently take ownership of broader timeline recovery semantics.
  writeForeignJsonDocument(filePath, value);
}

function readTimelineEvents(value: unknown): TimelineEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isTimelineEvent);
}

function readEventField(event: TimelineEvent, key: string): unknown {
  return isRecord(event) ? event[key] : undefined;
}

function isFinalStatus(value: unknown): boolean {
  return normalizeText(value) === "final";
}

function isTimelineEvent(value: unknown): value is TimelineEvent {
  return value === null
    || Array.isArray(value)
    || isRecord(value)
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTimelineDayRecord(value: unknown): TimelineDayRecord {
  return isRecord(value) ? value as TimelineDayRecord : {};
}

function asTimelineSourceRecord(value: unknown): TimelineSourceRecord {
  return isRecord(value) ? value as TimelineSourceRecord : {};
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export {
  ensureTimelineStateTimezone,
};
