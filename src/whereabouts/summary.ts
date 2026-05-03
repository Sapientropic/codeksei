import {
  DEFAULT_WHEREABOUTS_RECENT_MOVE_MS,
  DEFAULT_WHEREABOUTS_STALE_MS,
  isMovingMotionState,
  WHEREABOUTS_EVENT_VERSION,
  WHEREABOUTS_LOW_BATTERY_LEVEL,
  WHEREABOUTS_STATE_VERSION,
  type WhereaboutsBatteryInfo,
  type WhereaboutsContextInfo,
  type WhereaboutsDeviceInfo,
  type WhereaboutsIngestEvent,
  type WhereaboutsLocationInfo,
  type WhereaboutsMotionInfo,
  type WhereaboutsMove,
  type WhereaboutsNamedPlace,
  type WhereaboutsNormalizedBatteryInfo,
  type WhereaboutsNormalizedContextInfo,
  type WhereaboutsNormalizedEvent,
  type WhereaboutsNormalizedMotionInfo,
  type WhereaboutsPlaceRef,
  type WhereaboutsSnapshot,
  type WhereaboutsStay,
  type WhereaboutsSummary,
} from "./contracts";

export function normalizeWhereaboutsEvent(
  payload: WhereaboutsIngestEvent,
  {
    places,
    recordedAt = new Date().toISOString(),
  }: {
    places: WhereaboutsNamedPlace[];
    recordedAt?: string;
  },
): WhereaboutsNormalizedEvent {
  const occurredAt = assertIsoTimestamp(payload.occurredAt, "occurredAt");
  const device = normalizeDevice(payload.device);
  const location = normalizeLocation(payload.location);
  const place = matchNamedPlace(location, places);
  return {
    battery: normalizeBattery(payload.battery),
    context: normalizeContext(payload.context),
    derived: {
      locationSummary: place ? formatNamedPlaceSummary(place) : "在外",
      place: place ? toPlaceRef(place) : null,
    },
    device,
    extras: isPlainObject(payload.extras) ? { ...payload.extras } : {},
    kind: "whereabouts_event",
    location,
    motion: normalizeMotion(payload.motion),
    occurredAt,
    recordedAt: assertIsoTimestamp(recordedAt, "recordedAt"),
    version: WHEREABOUTS_EVENT_VERSION,
  };
}

export function pruneWhereaboutsEvents(
  events: WhereaboutsNormalizedEvent[],
  {
    now,
    retentionDays,
  }: {
    now: string;
    retentionDays: number;
  },
): WhereaboutsNormalizedEvent[] {
  const cutoffMs = Date.parse(now) - retentionDays * 24 * 60 * 60 * 1000;
  return events.filter((entry) => {
    const occurredAtMs = Date.parse(entry.occurredAt);
    return Number.isFinite(occurredAtMs) && occurredAtMs >= cutoffMs;
  });
}

export function buildWhereaboutsMaterializedState(
  events: WhereaboutsNormalizedEvent[],
  {
    now = new Date().toISOString(),
  }: {
    now?: string;
  } = {},
): {
  moves: WhereaboutsMove[];
  snapshot: WhereaboutsSnapshot;
  stays: WhereaboutsStay[];
  summary: WhereaboutsSummary;
} {
  const sorted = [...events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const stays = buildStays(sorted);
  const moves = buildMoves(sorted);
  const latest = sorted[sorted.length - 1] || null;
  const lastEventAt = latest?.occurredAt || "";
  const freshnessMs = lastEventAt ? Date.parse(now) - Date.parse(lastEventAt) : Number.POSITIVE_INFINITY;
  const isStale = !latest || !Number.isFinite(freshnessMs) || freshnessMs > DEFAULT_WHEREABOUTS_STALE_MS;
  const currentPlace = latest?.derived.place || null;
  const snapshot: WhereaboutsSnapshot = {
    battery: latest?.battery || null,
    currentPlace,
    currentStay: stays[stays.length - 1] || null,
    freshnessSummary: isStale ? "位置数据已过旧" : "位置数据刚更新",
    generatedAt: now,
    isStale,
    kind: "whereabouts_snapshot",
    lastContext: latest?.context || null,
    lastEventAt,
    locationSummary: latest?.derived.locationSummary || "位置未知",
    motion: latest?.motion || null,
    recentMove: selectRecentMove(moves, now),
    version: WHEREABOUTS_STATE_VERSION,
  };
  const summary: WhereaboutsSummary = {
    batterySummary: summarizeBattery(snapshot.battery),
    freshnessSummary: snapshot.freshnessSummary,
    generatedAt: now,
    kind: "whereabouts_summary",
    locationSummary: summarizeLocation(snapshot),
    mobilitySummary: summarizeMobility(snapshot),
    snapshot,
    version: WHEREABOUTS_STATE_VERSION,
  };
  return { moves, snapshot, stays, summary };
}

export function matchNamedPlace(
  location: WhereaboutsLocationInfo,
  places: WhereaboutsNamedPlace[],
): WhereaboutsNamedPlace | null {
  for (const place of places) {
    if (distanceMeters(location.latitude, location.longitude, place.latitude, place.longitude) <= Math.max(1, place.radiusMeters)) {
      return place;
    }
  }
  return null;
}

function buildStays(events: WhereaboutsNormalizedEvent[]): WhereaboutsStay[] {
  const firstEvent = events[0];
  if (!firstEvent) {
    return [];
  }
  const stays: WhereaboutsStay[] = [];
  let current = createStay(firstEvent, firstEvent.occurredAt);
  for (let index = 1; index < events.length; index += 1) {
    const event = events[index];
    if (!event) {
      continue;
    }
    if (samePlaceKey(current.place, event.derived.place) && current.locationSummary === event.derived.locationSummary) {
      current = createStayFromCurrent(current, event.occurredAt);
      continue;
    }
    stays.push(finalizeStay(current));
    current = createStay(event, event.occurredAt);
  }
  stays.push(finalizeStay(current));
  return stays;
}

function buildMoves(events: WhereaboutsNormalizedEvent[]): WhereaboutsMove[] {
  if (events.length < 2) {
    return [];
  }
  const moves: WhereaboutsMove[] = [];
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];
    if (!previous || !current) {
      continue;
    }
    if (samePlaceKey(previous.derived.place, current.derived.place) && previous.derived.locationSummary === current.derived.locationSummary) {
      continue;
    }
    moves.push({
      durationMinutes: computeDurationMinutes(previous.occurredAt, current.occurredAt),
      endedAt: current.occurredAt,
      fromPlace: previous.derived.place,
      kind: "whereabouts_move",
      motionState: current.motion?.state || "",
      startedAt: previous.occurredAt,
      toPlace: current.derived.place,
      trigger: current.context?.trigger || "",
      version: WHEREABOUTS_STATE_VERSION,
    });
  }
  return moves;
}

function selectRecentMove(moves: WhereaboutsMove[], now: string): WhereaboutsMove | null {
  const latest = moves[moves.length - 1] || null;
  if (!latest) {
    return null;
  }
  const ageMs = Date.parse(now) - Date.parse(latest.endedAt);
  return Number.isFinite(ageMs) && ageMs <= DEFAULT_WHEREABOUTS_RECENT_MOVE_MS ? latest : null;
}

function summarizeLocation(snapshot: WhereaboutsSnapshot): string {
  if (snapshot.currentPlace?.kind === "home") {
    return "在家";
  }
  if (snapshot.currentPlace?.kind === "work") {
    return "在公司";
  }
  if (snapshot.currentPlace?.label) {
    return `在${snapshot.currentPlace.label}`;
  }
  return snapshot.locationSummary || "位置未知";
}

function summarizeBattery(battery: WhereaboutsNormalizedBatteryInfo | null): string {
  if (!battery) {
    return "电量未知";
  }
  if (battery.charging) {
    return "充电中";
  }
  if (battery.isLow) {
    return "低电";
  }
  return "电量正常";
}

function summarizeMobility(snapshot: WhereaboutsSnapshot): string {
  if (snapshot.recentMove) {
    return "刚移动过";
  }
  if (isMovingMotionState(snapshot.motion?.state)) {
    return "移动中";
  }
  if (snapshot.motion?.state === "stationary") {
    return "静止中";
  }
  return "移动状态未知";
}

function createStay(event: WhereaboutsNormalizedEvent, endedAt: string): Omit<WhereaboutsStay, "durationMinutes"> & { anchorAt: string } {
  return {
    anchorAt: event.occurredAt,
    endedAt,
    kind: "whereabouts_stay",
    locationSummary: event.derived.locationSummary,
    place: event.derived.place,
    startedAt: event.occurredAt,
    version: WHEREABOUTS_STATE_VERSION,
  };
}

function createStayFromCurrent(
  current: Omit<WhereaboutsStay, "durationMinutes"> & { anchorAt: string },
  endedAt: string,
): Omit<WhereaboutsStay, "durationMinutes"> & { anchorAt: string } {
  return {
    ...current,
    endedAt,
  };
}

function finalizeStay(stay: Omit<WhereaboutsStay, "durationMinutes"> & { anchorAt: string }): WhereaboutsStay {
  return {
    durationMinutes: computeDurationMinutes(stay.startedAt, stay.endedAt),
    endedAt: stay.endedAt,
    kind: stay.kind,
    locationSummary: stay.locationSummary,
    place: stay.place,
    startedAt: stay.startedAt,
    version: stay.version,
  };
}

function normalizeBattery(input: WhereaboutsBatteryInfo | undefined): WhereaboutsNormalizedBatteryInfo | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const parsedLevel = typeof input.level === "number" && Number.isFinite(input.level) ? input.level : Number.NaN;
  const normalizedLevel = Number.isFinite(parsedLevel)
    ? parsedLevel > 1
      ? Math.min(1, parsedLevel / 100)
      : Math.max(0, parsedLevel)
    : Number.NaN;
  return {
    charging: Boolean(input.charging),
    isLow: Number.isFinite(normalizedLevel) && normalizedLevel <= WHEREABOUTS_LOW_BATTERY_LEVEL,
    level: Number.isFinite(normalizedLevel) ? normalizedLevel : -1,
    state: typeof input.state === "string" ? input.state.trim() : "",
  };
}

function normalizeMotion(input: WhereaboutsMotionInfo | undefined): WhereaboutsNormalizedMotionInfo | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  return {
    confidence: typeof input.confidence === "number" && Number.isFinite(input.confidence) ? input.confidence : 0,
    state: typeof input.state === "string" ? input.state.trim().toLowerCase() : "",
  };
}

function normalizeContext(input: WhereaboutsContextInfo | undefined): WhereaboutsNormalizedContextInfo | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  return {
    note: typeof input.note === "string" ? input.note.trim() : "",
    source: typeof input.source === "string" ? input.source.trim() : "",
    trigger: typeof input.trigger === "string" ? input.trigger.trim() : "",
  };
}

function normalizeDevice(input: WhereaboutsDeviceInfo): WhereaboutsDeviceInfo {
  if (!input || typeof input !== "object") {
    throw new Error("缺少 device。");
  }
  const deviceId = normalizeRequiredString(input.deviceId, "device.deviceId");
  const normalized: WhereaboutsDeviceInfo = { deviceId };
  const appVersion = normalizeOptionalString(input.appVersion);
  const model = normalizeOptionalString(input.model);
  const platform = normalizeOptionalString(input.platform);
  if (appVersion) {
    normalized.appVersion = appVersion;
  }
  if (model) {
    normalized.model = model;
  }
  if (platform) {
    normalized.platform = platform;
  }
  return normalized;
}

function normalizeLocation(input: WhereaboutsLocationInfo): WhereaboutsLocationInfo {
  if (!input || typeof input !== "object") {
    throw new Error("缺少 location。");
  }
  const normalized: WhereaboutsLocationInfo = {
    latitude: normalizeRequiredNumber(input.latitude, "location.latitude"),
    longitude: normalizeRequiredNumber(input.longitude, "location.longitude"),
  };
  const accuracyMeters = normalizeOptionalNumber(input.accuracyMeters);
  const altitudeMeters = normalizeOptionalNumber(input.altitudeMeters);
  const headingDegrees = normalizeOptionalNumber(input.headingDegrees);
  const speedMps = normalizeOptionalNumber(input.speedMps);
  if (typeof accuracyMeters === "number") {
    normalized.accuracyMeters = accuracyMeters;
  }
  if (typeof altitudeMeters === "number") {
    normalized.altitudeMeters = altitudeMeters;
  }
  if (typeof headingDegrees === "number") {
    normalized.headingDegrees = headingDegrees;
  }
  if (typeof speedMps === "number") {
    normalized.speedMps = speedMps;
  }
  return normalized;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function normalizeRequiredNumber(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  throw new Error(`缺少有效的 ${field}。`);
}

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized) {
    return normalized;
  }
  throw new Error(`缺少有效的 ${field}。`);
}

function computeDurationMinutes(startedAt: string, endedAt: string): number {
  const startedAtMs = Date.parse(startedAt);
  const endedAtMs = Date.parse(endedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs) || endedAtMs < startedAtMs) {
    return 0;
  }
  return Math.max(0, Math.round((endedAtMs - startedAtMs) / 60000));
}

function samePlaceKey(left: WhereaboutsPlaceRef | null, right: WhereaboutsPlaceRef | null): boolean {
  return `${left?.kind || ""}:${left?.id || ""}:${left?.label || ""}` === `${right?.kind || ""}:${right?.id || ""}:${right?.label || ""}`;
}

function toPlaceRef(place: WhereaboutsNamedPlace): WhereaboutsPlaceRef {
  return {
    id: place.id,
    kind: place.kind,
    label: place.label,
  };
}

function formatNamedPlaceSummary(place: WhereaboutsNamedPlace): string {
  if (place.kind === "home") {
    return "在家";
  }
  if (place.kind === "work") {
    return "在公司";
  }
  return `在${place.label}`;
}

function assertIsoTimestamp(value: unknown, field: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new Error(`缺少有效的 ${field}。`);
  }
  return normalized;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return value * (Math.PI / 180);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
