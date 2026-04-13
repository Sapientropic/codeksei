import {
  DEFAULT_FALLBACK_TIMEZONE,
  LEGACY_TIMELINE_TIMEZONE,
  normalizeTimezone,
} from "./timezone-shared";
import { readTimelineStateTimezone } from "./timezone-state";

interface TimezoneConfigResult {
  timezone: string;
  source: "env" | "timeline_state" | "system" | "timeline_state_legacy" | "fallback";
  explicit: boolean;
  timelineStateTimezone: string;
}

function resolveSystemTimezone(): string {
  return normalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

function resolveTimezoneConfig({
  explicitTimezone = "",
  timelineStateDir = "",
}: {
  explicitTimezone?: unknown;
  timelineStateDir?: string;
} = {}): TimezoneConfigResult {
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

export {
  resolveSystemTimezone,
  resolveTimezoneConfig,
};

export type {
  TimezoneConfigResult,
};
