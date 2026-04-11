const fs = require("fs");
const path = require("path");

const {
  LEGACY_TIMELINE_TIMEZONE,
  formatDateInTimezone,
  loadTimelineStateSnapshot,
  normalizeTimezone,
} = require("../../core/timezone");

function ensureTimelineStateTimezone(config = {}) {
  const desiredTimezone = normalizeTimezone(config.timezone);
  if (!desiredTimezone) {
    return;
  }

  const snapshot = loadTimelineStateSnapshot(config.timelineStateDir);
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
        facts: snapshot.facts,
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

function shouldSyncTimezone({ currentTimezone, desiredTimezone, config = {} }) {
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
  // from the old hard-coded default so we do not silently rewrite an already
  // customized timeline timezone just because this machine has a different OS
  // setting today.
  if (config.timezoneExplicit) {
    return true;
  }

  return currentTimezone === LEGACY_TIMELINE_TIMEZONE;
}

function regroupFactsByTimezone(facts, timezone) {
  const buckets = new Map();

  for (const [originalDate, rawDay] of Object.entries(facts || {})) {
    const day = rawDay && typeof rawDay === "object" ? rawDay : {};
    const events = Array.isArray(day.events) ? day.events : [];
    if (!events.length) {
      mergeDayBucket(buckets, originalDate, day, []);
      continue;
    }

    for (const event of events) {
      const bucketDate = resolveEventBucketDate(event, timezone) || normalizeText(originalDate);
      mergeDayBucket(buckets, bucketDate, day, [event]);
    }
  }

  const output = {};
  for (const [date, day] of Array.from(buckets.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    const sortedEvents = Array.isArray(day.events)
      ? [...day.events].sort(compareEventsByStart)
      : [];
    if (!normalizeText(date)) {
      continue;
    }
    output[date] = {
      status: day.status === "final" ? "final" : "draft",
      updatedAt: day.updatedAt || "",
      source: day.source || null,
      events: sortedEvents,
    };
  }
  return output;
}

function mergeDayBucket(buckets, date, sourceDay, events) {
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

  current.status = current.status === "final" && sourceDay?.status === "final" ? "final" : "draft";
  current.updatedAt = pickLatestTimestamp(current.updatedAt, sourceDay?.updatedAt);
  current.source = mergeSource(current.source, sourceDay?.source);
  current.events.push(...events);
  buckets.set(normalizedDate, current);
}

function mergeSource(current, incoming) {
  const left = normalizeSource(current);
  const right = normalizeSource(incoming);
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return JSON.stringify(left) === JSON.stringify(right) ? left : null;
}

function normalizeSource(source) {
  if (!source || typeof source !== "object") {
    return null;
  }
  const threadId = normalizeText(source.threadId);
  const workspaceRoot = normalizeText(source.workspaceRoot);
  const transcriptMessageCount = Number.isFinite(Number(source.transcriptMessageCount))
    ? Number(source.transcriptMessageCount)
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

function pickLatestTimestamp(left, right) {
  const leftValue = Date.parse(normalizeText(left));
  const rightValue = Date.parse(normalizeText(right));
  if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
    return leftValue >= rightValue ? normalizeText(left) : normalizeText(right);
  }
  return normalizeText(right) || normalizeText(left);
}

function resolveEventBucketDate(event, timezone) {
  return formatDateInTimezone(event?.startAt, timezone)
    || formatDateInTimezone(event?.endAt, timezone)
    || "";
}

function compareEventsByStart(left, right) {
  const leftTime = Date.parse(left?.startAt || "");
  const rightTime = Date.parse(right?.startAt || "");
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function initializeTimelineSnapshot(paths, timezone) {
  writeTimelineSnapshot(paths, {
    timezone,
    taxonomy: {},
    facts: {},
    proposals: [],
  });
}

function writeTimelineSnapshot(paths, snapshot) {
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

function writeJsonFile(filePath, value) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
    fs.renameSync(tempPath, filePath);
  } finally {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Ignore temp cleanup after the final file is already in place.
    }
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  ensureTimelineStateTimezone,
};
