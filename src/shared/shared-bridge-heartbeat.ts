import { normalizeText } from "../core/text-normalization";
import { isPlainObject, readManagedJsonStateFile, writeManagedJsonStateFile } from "../state/json-state";
import type {
  SharedBridgeHeartbeatClassification,
  SharedBridgeHeartbeatRecord,
} from "./shared-types";


const DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS = 120_000;

function readSharedBridgeHeartbeat(filePath: string): SharedBridgeHeartbeatRecord | null {
  const parsed = readManagedJsonStateFile({
    filePath,
    fallback: null,
    label: "shared bridge heartbeat",
    validate: validateHeartbeatRecord,
  });
  return normalizeHeartbeat(parsed);
}

function writeSharedBridgeHeartbeat(
  filePath: string,
  patch: Partial<SharedBridgeHeartbeatRecord>,
): SharedBridgeHeartbeatRecord | null {
  const current = readSharedBridgeHeartbeat(filePath) || {};
  const next = normalizeHeartbeat({
    ...current,
    ...(patch || {}),
    updatedAt: new Date().toISOString(),
  });
  writeManagedJsonStateFile(filePath, next);
  return next;
}

function classifySharedBridgeHeartbeat(
  record: SharedBridgeHeartbeatRecord | null,
  { expectedPid = 0, maxAgeMs = DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS }: {
    expectedPid?: number;
    maxAgeMs?: number;
  } = {},
): SharedBridgeHeartbeatClassification {
  if (!record) {
    return {
      status: "missing",
      healthy: false,
      updatedAt: "",
    };
  }

  if (record.status === "stopped") {
    return {
      status: "stopped",
      healthy: false,
      updatedAt: record.updatedAt,
    };
  }

  // The managed pid is the truth source for "is the shared bridge actually
  // online right now". A fresh heartbeat without a live adopted pid only means
  // we have leftover state on disk, not a bridge the operator can trust.
  if (!expectedPid) {
    return {
      status: "missing_process",
      healthy: false,
      updatedAt: record.updatedAt,
    };
  }

  if (expectedPid && Number(record.pid) !== Number(expectedPid)) {
    return {
      status: "pid_mismatch",
      healthy: false,
      updatedAt: record.updatedAt,
    };
  }

  const updatedAtMs = Date.parse(record.updatedAt || "");
  if (!Number.isFinite(updatedAtMs)) {
    return {
      status: "stale",
      healthy: false,
      updatedAt: record.updatedAt,
    };
  }

  // The bridge can sit inside a 35s long-poll and also briefly back off after
  // transient failures. Use a larger heartbeat window so "quiet but healthy"
  // does not get misclassified as dead and trigger restart loops.
  if (Date.now() - updatedAtMs > maxAgeMs) {
    return {
      status: "stale",
      healthy: false,
      updatedAt: record.updatedAt,
    };
  }

  return {
    status: "ok",
    healthy: true,
    updatedAt: record.updatedAt,
  };
}

function normalizeHeartbeat(value: unknown): SharedBridgeHeartbeatRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;

  return {
    pid: normalizePid(record.pid),
    status: normalizeText(record.status),
    accountId: normalizeText(record.accountId),
    workspaceRoot: normalizeText(record.workspaceRoot),
    codexEndpoint: normalizeText(record.codexEndpoint),
    startedAt: normalizeIso(record.startedAt),
    updatedAt: normalizeIso(record.updatedAt),
    stoppedAt: normalizeIso(record.stoppedAt),
    lastPollStartedAt: normalizeIso(record.lastPollStartedAt),
    lastPollSucceededAt: normalizeIso(record.lastPollSucceededAt),
    lastPollFailedAt: normalizeIso(record.lastPollFailedAt),
    consecutiveFailures: normalizeCount(record.consecutiveFailures),
    lastError: normalizeText(record.lastError),
  };
}

function normalizePid(value: unknown): number {
  const numeric = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeIso(value: unknown): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeCount(value: unknown): number {
  const numeric = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function validateHeartbeatRecord(value: unknown): true | string {
  if (!isPlainObject(value)) {
    return "shared bridge heartbeat must be an object";
  }
  const record = value as Record<string, unknown>;
  if ("pid" in record && typeof record.pid !== "number" && typeof record.pid !== "string") {
    return "shared bridge heartbeat pid must be numeric";
  }
  if ("status" in record && typeof record.status !== "string") {
    return "shared bridge heartbeat status must be a string";
  }
  if ("accountId" in record && typeof record.accountId !== "string") {
    return "shared bridge heartbeat accountId must be a string";
  }
  if ("workspaceRoot" in record && typeof record.workspaceRoot !== "string") {
    return "shared bridge heartbeat workspaceRoot must be a string";
  }
  if ("codexEndpoint" in record && typeof record.codexEndpoint !== "string") {
    return "shared bridge heartbeat codexEndpoint must be a string";
  }
  if ("startedAt" in record && typeof record.startedAt !== "string") {
    return "shared bridge heartbeat startedAt must be a string";
  }
  if ("updatedAt" in record && typeof record.updatedAt !== "string") {
    return "shared bridge heartbeat updatedAt must be a string";
  }
  if ("stoppedAt" in record && typeof record.stoppedAt !== "string") {
    return "shared bridge heartbeat stoppedAt must be a string";
  }
  if ("lastPollStartedAt" in record && typeof record.lastPollStartedAt !== "string") {
    return "shared bridge heartbeat lastPollStartedAt must be a string";
  }
  if ("lastPollSucceededAt" in record && typeof record.lastPollSucceededAt !== "string") {
    return "shared bridge heartbeat lastPollSucceededAt must be a string";
  }
  if ("lastPollFailedAt" in record && typeof record.lastPollFailedAt !== "string") {
    return "shared bridge heartbeat lastPollFailedAt must be a string";
  }
  if ("consecutiveFailures" in record && typeof record.consecutiveFailures !== "number" && typeof record.consecutiveFailures !== "string") {
    return "shared bridge heartbeat consecutiveFailures must be numeric";
  }
  if ("lastError" in record && typeof record.lastError !== "string") {
    return "shared bridge heartbeat lastError must be a string";
  }
  return true;
}

export {
  DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS,
  classifySharedBridgeHeartbeat,
  readSharedBridgeHeartbeat,
  writeSharedBridgeHeartbeat,
};

