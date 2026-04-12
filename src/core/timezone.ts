const fs = require("fs");
const path = require("path");
const { readForeignJsonDocument } = require("./json-state");

const LEGACY_TIMELINE_TIMEZONE = "Asia/Shanghai";
const DEFAULT_FALLBACK_TIMEZONE = "UTC";

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimezone(value: any) {
  const raw = normalizeText(value);
  if (!raw) {
    return "";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return "";
  }
}

function resolveSystemTimezone() {
  return normalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

function resolveTimezoneConfig({ explicitTimezone = "", timelineStateDir = "" }: any = {}) {
  const explicit = normalizeTimezone(explicitTimezone);
  const timelineStateTimezone = readTimelineStateTimezone(timelineStateDir);
  if (explicit) {
    return {
      timezone: explicit,
      source: "env",
      explicit: true,
      timelineStateTimezone,
    };
  }

  // Preserve an explicitly established timeline timezone when it is not just
  // the old hard-coded default. This keeps diary/review/reminder aligned with
  // existing timeline business data instead of silently drifting per machine.
  if (timelineStateTimezone && timelineStateTimezone !== LEGACY_TIMELINE_TIMEZONE) {
    return {
      timezone: timelineStateTimezone,
      source: "timeline_state",
      explicit: false,
      timelineStateTimezone,
    };
  }

  const systemTimezone = resolveSystemTimezone();
  if (systemTimezone) {
    return {
      timezone: systemTimezone,
      source: "system",
      explicit: false,
      timelineStateTimezone,
    };
  }

  if (timelineStateTimezone) {
    return {
      timezone: timelineStateTimezone,
      source: "timeline_state_legacy",
      explicit: false,
      timelineStateTimezone,
    };
  }

  return {
    timezone: DEFAULT_FALLBACK_TIMEZONE,
    source: "fallback",
    explicit: false,
    timelineStateTimezone,
  };
}

function readTimelineStateTimezone(timelineStateDir: string = "") {
  const snapshot = loadTimelineStateSnapshot(timelineStateDir);
  return snapshot.timezone;
}

function loadTimelineStateSnapshot(timelineStateDir: string = "") {
  const paths = resolveTimelineStateFiles(timelineStateDir);
  if (!paths.dir) {
    return {
      paths,
      hasAnyFile: false,
      hasFacts: false,
      timezone: "",
      stateDoc: null,
      taxonomyDoc: null,
      factsDoc: null,
      taxonomy: {},
      facts: {},
      proposals: [],
    };
  }

  const stateDoc = readJsonFile(paths.stateFile);
  const taxonomyDoc = readJsonFile(paths.taxonomyFile);
  const factsDoc = readJsonFile(paths.factsFile);
  const facts = readFacts(stateDoc, factsDoc);

  return {
    paths,
    hasAnyFile: Boolean(stateDoc || taxonomyDoc || factsDoc),
    hasFacts: Object.keys(facts).length > 0,
    timezone: normalizeTimezone(stateDoc?.timezone)
      || normalizeTimezone(taxonomyDoc?.timezone)
      || normalizeTimezone(factsDoc?.timezone),
    stateDoc,
    taxonomyDoc,
    factsDoc,
    taxonomy: readTaxonomy(stateDoc, taxonomyDoc),
    facts,
    proposals: readProposals(stateDoc, factsDoc),
  };
}

function resolveTimelineStateFiles(timelineStateDir: string = "") {
  const normalizedDir = normalizeText(timelineStateDir);
  if (!normalizedDir) {
    return {
      dir: "",
      stateFile: "",
      taxonomyFile: "",
      factsFile: "",
    };
  }

  const baseDir = path.resolve(normalizedDir);
  const nestedDir = path.join(baseDir, "timeline");
  // timeline-for-agent's canonical layout is <stateDir>/timeline/*.json. We
  // still detect legacy direct files for migration, but a fresh root should
  // default to the nested layout so bootstrap, state sync, and the runtime all
  // converge on the same paths.
  const candidates = [nestedDir, baseDir];
  const existingDir = candidates.find(hasAnyTimelineStateFile) || nestedDir;
  return buildTimelineStateFiles(existingDir);
}

function hasAnyTimelineStateFile(dirPath: any) {
  if (!dirPath) {
    return false;
  }
  const files = buildTimelineStateFiles(dirPath);
  return fs.existsSync(files.stateFile)
    || fs.existsSync(files.taxonomyFile)
    || fs.existsSync(files.factsFile);
}

function buildTimelineStateFiles(dirPath: any) {
  return {
    dir: dirPath,
    stateFile: path.join(dirPath, "timeline-state.json"),
    taxonomyFile: path.join(dirPath, "timeline-taxonomy.json"),
    factsFile: path.join(dirPath, "timeline-facts.json"),
  };
}

function readTaxonomy(stateDoc: any, taxonomyDoc: any) {
  const fromState = stateDoc?.taxonomy;
  if (fromState && typeof fromState === "object") {
    return fromState;
  }
  const fromTaxonomy = taxonomyDoc?.taxonomy;
  return fromTaxonomy && typeof fromTaxonomy === "object" ? fromTaxonomy : {};
}

function readFacts(stateDoc: any, factsDoc: any) {
  const fromState = stateDoc?.facts;
  if (fromState && typeof fromState === "object") {
    return fromState;
  }
  const fromFacts = factsDoc?.facts;
  return fromFacts && typeof fromFacts === "object" ? fromFacts : {};
}

function readProposals(stateDoc: any, factsDoc: any) {
  if (Array.isArray(stateDoc?.proposals)) {
    return stateDoc.proposals;
  }
  return Array.isArray(factsDoc?.proposals) ? factsDoc.proposals : [];
}

function readJsonFile(filePath: any) {
  // Timeline state/taxonomy/facts are foreign documents produced by another
  // workflow. Parse them gently and let that workflow own recovery instead of
  // moving files aside as if codeksei fully owned their schema.
  return readForeignJsonDocument(filePath, { fallback: null });
}

function formatDateInTimezone(value: any, timezone: any = LEGACY_TIMELINE_TIMEZONE) {
  return formatInTimezone(value, timezone, "en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatTimeInTimezone(value: any, timezone: any = LEGACY_TIMELINE_TIMEZONE, locale: string = "zh-CN") {
  return formatInTimezone(value, timezone, locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });
}

function formatDateTimeInTimezone(value: any, timezone: any = LEGACY_TIMELINE_TIMEZONE) {
  return formatInTimezone(value, timezone, "sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).replace(" ", "T");
}

function getCurrentDateStringInTimezone(timezone: any = LEGACY_TIMELINE_TIMEZONE, now: any = new Date()) {
  return formatDateInTimezone(now, timezone);
}

function coerceLocalDateTimeToIso(value: any, {
  timeZone = LEGACY_TIMELINE_TIMEZONE,
  defaultDate = "",
  defaultTime = "",
}: any = {}) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?([zZ]|[+-]\d{2}:\d{2})$/.test(normalized)) {
    return normalized.replace(" ", "T");
  }

  const localDateTime = normalized.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  if (localDateTime) {
    return buildZonedIsoString(localDateTime[1], localDateTime[2], timeZone);
  }

  const localTime = normalized.match(/^(\d{2}:\d{2}(?::\d{2})?)$/);
  if (localTime && normalizeText(defaultDate)) {
    return buildZonedIsoString(defaultDate, localTime[1], timeZone);
  }

  const localDate = normalized.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (localDate && normalizeText(defaultTime)) {
    return buildZonedIsoString(localDate[1], defaultTime, timeZone);
  }

  return "";
}

function buildZonedIsoString(dateString: any, timeString: any, timeZone: any = LEGACY_TIMELINE_TIMEZONE) {
  const resolvedTimezone = normalizeTimezone(timeZone) || LEGACY_TIMELINE_TIMEZONE;
  const parts = parseLocalDateTimeParts(dateString, timeString);
  if (!parts) {
    return "";
  }

  // Convert a wall-clock time in the target timezone into a real instant. We
  // iterate because offsets can change across DST boundaries.
  const instantMs = resolveInstantFromLocalParts(parts, resolvedTimezone);
  const offsetMinutes = getOffsetMinutesForInstant(instantMs, resolvedTimezone);
  return `${formatPartsDate(parts)}T${formatPartsTime(parts)}${formatOffsetMinutes(offsetMinutes)}`;
}

function resolveInstantFromLocalParts(parts: any, timezone: any) {
  let guessMs = partsToUtcMs(parts);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const zonedParts = getLocalDateTimePartsForInstant(guessMs, timezone);
    const deltaMs = partsToUtcMs(parts) - partsToUtcMs(zonedParts);
    if (deltaMs === 0) {
      return guessMs;
    }
    guessMs += deltaMs;
  }
  return guessMs;
}

function getOffsetMinutesForInstant(instantMs: any, timezone: any) {
  const zonedParts = getLocalDateTimePartsForInstant(instantMs, timezone);
  return Math.round((partsToUtcMs(zonedParts) - instantMs) / 60000);
}

function getLocalDateTimePartsForInstant(instantMs: any, timezone: any) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimezone(timezone) || LEGACY_TIMELINE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });
  const parts = Object.create(null);
  for (const part of formatter.formatToParts(new Date(instantMs))) {
    if (part.type === "literal") {
      continue;
    }
    parts[part.type] = part.value;
  }
  return {
    year: Number.parseInt(parts.year, 10),
    month: Number.parseInt(parts.month, 10),
    day: Number.parseInt(parts.day, 10),
    hour: Number.parseInt(parts.hour, 10),
    minute: Number.parseInt(parts.minute, 10),
    second: Number.parseInt(parts.second, 10),
  };
}

function parseLocalDateTimeParts(dateString: any, timeString: any) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizeText(dateString));
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(normalizeText(timeString));
  if (!dateMatch || !timeMatch) {
    return null;
  }

  const parts = {
    year: Number.parseInt(dateMatch[1], 10),
    month: Number.parseInt(dateMatch[2], 10),
    day: Number.parseInt(dateMatch[3], 10),
    hour: Number.parseInt(timeMatch[1], 10),
    minute: Number.parseInt(timeMatch[2], 10),
    second: Number.parseInt(timeMatch[3] || "00", 10),
  };

  if (!isValidDateTimeParts(parts)) {
    return null;
  }
  return parts;
}

function isValidDateTimeParts(parts: any) {
  if (!Number.isInteger(parts.year) || parts.year < 1) {
    return false;
  }
  if (!Number.isInteger(parts.month) || parts.month < 1 || parts.month > 12) {
    return false;
  }
  if (!Number.isInteger(parts.day) || parts.day < 1 || parts.day > 31) {
    return false;
  }
  if (!Number.isInteger(parts.hour) || parts.hour < 0 || parts.hour > 23) {
    return false;
  }
  if (!Number.isInteger(parts.minute) || parts.minute < 0 || parts.minute > 59) {
    return false;
  }
  if (!Number.isInteger(parts.second) || parts.second < 0 || parts.second > 59) {
    return false;
  }

  const probe = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  ));
  return probe.getUTCFullYear() === parts.year
    && probe.getUTCMonth() + 1 === parts.month
    && probe.getUTCDate() === parts.day
    && probe.getUTCHours() === parts.hour
    && probe.getUTCMinutes() === parts.minute
    && probe.getUTCSeconds() === parts.second;
}

function partsToUtcMs(parts: any) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0
  );
}

function formatPartsDate(parts: any) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatPartsTime(parts: any) {
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second || 0).padStart(2, "0")}`;
}

function formatOffsetMinutes(offsetMinutes: any) {
  const normalized = Number.isFinite(offsetMinutes) ? offsetMinutes : 0;
  const sign = normalized >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(normalized);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minutes = String(absoluteMinutes % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function formatInTimezone(value: any, timezone: any, locale: any, options: any) {
  const resolvedTimezone = normalizeTimezone(timezone) || LEGACY_TIMELINE_TIMEZONE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(locale, {
    timeZone: resolvedTimezone,
    ...options,
  }).format(date);
}

module.exports = {
  DEFAULT_FALLBACK_TIMEZONE,
  LEGACY_TIMELINE_TIMEZONE,
  buildZonedIsoString,
  coerceLocalDateTimeToIso,
  formatDateInTimezone,
  formatDateTimeInTimezone,
  formatOffsetMinutes,
  formatTimeInTimezone,
  getCurrentDateStringInTimezone,
  loadTimelineStateSnapshot,
  normalizeTimezone,
  readTimelineStateTimezone,
  resolveSystemTimezone,
  resolveTimelineStateFiles,
  resolveTimezoneConfig,
};

export {};
