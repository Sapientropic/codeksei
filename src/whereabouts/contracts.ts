import { normalizeText } from "../contracts/text-normalization";

export const WHEREABOUTS_EVENT_VERSION = 1;
export const WHEREABOUTS_STATE_VERSION = 1;
export const DEFAULT_WHEREABOUTS_HOST = "127.0.0.1";
export const DEFAULT_WHEREABOUTS_PORT = 4318;
export const DEFAULT_WHEREABOUTS_RETENTION_DAYS = 30;
export const DEFAULT_WHEREABOUTS_STALE_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_WHEREABOUTS_RECENT_MOVE_MS = 90 * 60 * 1000;
export const DEFAULT_WHEREABOUTS_HTTP_MAX_BODY_BYTES = 64 * 1024;
export const WHEREABOUTS_LOW_BATTERY_LEVEL = 0.2;

export type WhereaboutsPlaceKind = "custom" | "home" | "work";

export interface WhereaboutsStateConfig {
  stateDir?: unknown;
  timezone?: unknown;
  whereaboutsHost?: unknown;
  whereaboutsPlacesFile?: unknown;
  whereaboutsPort?: unknown;
  whereaboutsRetentionDays?: unknown;
  whereaboutsToken?: unknown;
}

export interface WhereaboutsNamedPlace {
  id: string;
  kind: WhereaboutsPlaceKind;
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface WhereaboutsPlacesDocument {
  places: WhereaboutsNamedPlace[];
  version: number;
}

export interface WhereaboutsDeviceInfo {
  appVersion?: string;
  deviceId: string;
  model?: string;
  platform?: string;
}

export interface WhereaboutsLocationInfo {
  accuracyMeters?: number;
  altitudeMeters?: number;
  headingDegrees?: number;
  latitude: number;
  longitude: number;
  speedMps?: number;
}

export interface WhereaboutsBatteryInfo {
  charging?: boolean;
  level?: number;
  state?: string;
}

export interface WhereaboutsMotionInfo {
  confidence?: number;
  state?: string;
}

export interface WhereaboutsContextInfo {
  note?: string;
  source?: string;
  trigger?: string;
}

export interface WhereaboutsIngestEvent {
  battery?: WhereaboutsBatteryInfo;
  context?: WhereaboutsContextInfo;
  device: WhereaboutsDeviceInfo;
  extras?: Record<string, unknown>;
  location: WhereaboutsLocationInfo;
  motion?: WhereaboutsMotionInfo;
  occurredAt: string;
}

export interface WhereaboutsPlaceRef {
  id: string;
  kind: WhereaboutsPlaceKind;
  label: string;
}

export interface WhereaboutsNormalizedBatteryInfo {
  charging: boolean;
  isLow: boolean;
  level: number;
  state: string;
}

export interface WhereaboutsNormalizedMotionInfo {
  confidence: number;
  state: string;
}

export interface WhereaboutsNormalizedContextInfo {
  note: string;
  source: string;
  trigger: string;
}

export interface WhereaboutsDerivedInfo {
  locationSummary: string;
  place: WhereaboutsPlaceRef | null;
}

export interface WhereaboutsNormalizedEvent {
  battery: WhereaboutsNormalizedBatteryInfo | null;
  context: WhereaboutsNormalizedContextInfo | null;
  derived: WhereaboutsDerivedInfo;
  device: WhereaboutsDeviceInfo;
  extras: Record<string, unknown>;
  kind: "whereabouts_event";
  location: WhereaboutsLocationInfo;
  motion: WhereaboutsNormalizedMotionInfo | null;
  occurredAt: string;
  recordedAt: string;
  version: number;
}

export interface WhereaboutsStay {
  durationMinutes: number;
  endedAt: string;
  kind: "whereabouts_stay";
  locationSummary: string;
  place: WhereaboutsPlaceRef | null;
  startedAt: string;
  version: number;
}

export interface WhereaboutsMove {
  durationMinutes: number;
  endedAt: string;
  fromPlace: WhereaboutsPlaceRef | null;
  kind: "whereabouts_move";
  motionState: string;
  startedAt: string;
  toPlace: WhereaboutsPlaceRef | null;
  trigger: string;
  version: number;
}

export interface WhereaboutsSnapshot {
  battery: WhereaboutsNormalizedBatteryInfo | null;
  currentPlace: WhereaboutsPlaceRef | null;
  currentStay: WhereaboutsStay | null;
  freshnessSummary: string;
  generatedAt: string;
  isStale: boolean;
  kind: "whereabouts_snapshot";
  lastContext: WhereaboutsNormalizedContextInfo | null;
  lastEventAt: string;
  locationSummary: string;
  motion: WhereaboutsNormalizedMotionInfo | null;
  recentMove: WhereaboutsMove | null;
  version: number;
}

export interface WhereaboutsSummary {
  batterySummary: string;
  freshnessSummary: string;
  generatedAt: string;
  kind: "whereabouts_summary";
  locationSummary: string;
  mobilitySummary: string;
  snapshot: WhereaboutsSnapshot;
  version: number;
}

export interface WhereaboutsServerConfig {
  host: string;
  placesFile: string;
  port: number;
  retentionDays: number;
  stateDir: string;
  token: string;
}

export interface WhereaboutsPaths {
  eventsFile: string;
  movesFile: string;
  placesFile: string;
  rootDir: string;
  snapshotFile: string;
  staysFile: string;
  summaryFile: string;
}

export function normalizeWhereaboutsServerConfig(config: WhereaboutsStateConfig): WhereaboutsServerConfig {
  const stateDir = normalizeText(config.stateDir);
  if (!stateDir) {
    throw new Error("缺少 stateDir，无法使用 whereabouts。");
  }
  const token = normalizeText(config.whereaboutsToken);
  return {
    host: normalizeText(config.whereaboutsHost) || DEFAULT_WHEREABOUTS_HOST,
    placesFile: normalizeText(config.whereaboutsPlacesFile),
    port: normalizePositiveInteger(config.whereaboutsPort) || DEFAULT_WHEREABOUTS_PORT,
    retentionDays: normalizePositiveInteger(config.whereaboutsRetentionDays) || DEFAULT_WHEREABOUTS_RETENTION_DAYS,
    stateDir,
    token,
  };
}

export function normalizePositiveInteger(value: unknown): number {
  const numeric = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function isMovingMotionState(value: unknown): boolean {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "cycling"
    || normalized === "driving"
    || normalized === "moving"
    || normalized === "moving_vehicle"
    || normalized === "running"
    || normalized === "walking";
}
