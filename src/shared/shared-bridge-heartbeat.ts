import * as jsonStateModule from "../state/json-state";

const {
  isPlainObject,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} = jsonStateModule as {
  isPlainObject: (value: unknown) => boolean;
  readManagedJsonStateFile: (args: {
    filePath: string;
    fallback: null;
    label: string;
    validate: (value: unknown) => true | string;
  }) => unknown;
  writeManagedJsonStateFile: (filePath: string, payload: unknown) => void;
};

const DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS = 120_000;

function readSharedBridgeHeartbeat(filePath: any) {
  const parsed = readManagedJsonStateFile({
    filePath,
    fallback: null,
    label: "shared bridge heartbeat",
    validate: validateHeartbeatRecord,
  });
  return normalizeHeartbeat(parsed);
}

function writeSharedBridgeHeartbeat(filePath: any, patch: any) {
  const current = readSharedBridgeHeartbeat(filePath) || {};
  const next = normalizeHeartbeat({
    ...current,
    ...(patch || {}),
    updatedAt: new Date().toISOString(),
  });
  writeManagedJsonStateFile(filePath, next);
  return next;
}

function classifySharedBridgeHeartbeat(record: any, { expectedPid = 0, maxAgeMs = DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS }: any = {}) {
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

function normalizeHeartbeat(value: any) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    pid: normalizePid(value.pid),
    status: normalizeText(value.status),
    accountId: normalizeText(value.accountId),
    workspaceRoot: normalizeText(value.workspaceRoot),
    codexEndpoint: normalizeText(value.codexEndpoint),
    startedAt: normalizeIso(value.startedAt),
    updatedAt: normalizeIso(value.updatedAt),
    stoppedAt: normalizeIso(value.stoppedAt),
    lastPollStartedAt: normalizeIso(value.lastPollStartedAt),
    lastPollSucceededAt: normalizeIso(value.lastPollSucceededAt),
    lastPollFailedAt: normalizeIso(value.lastPollFailedAt),
    consecutiveFailures: normalizeCount(value.consecutiveFailures),
    lastError: normalizeText(value.lastError),
  };
}

function normalizePid(value: any) {
  const numeric = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeIso(value: any) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeCount(value: any) {
  const numeric = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

function validateHeartbeatRecord(value: any) {
  if (!isPlainObject(value)) {
    return "shared bridge heartbeat must be an object";
  }
  if ("pid" in value && typeof value.pid !== "number" && typeof value.pid !== "string") {
    return "shared bridge heartbeat pid must be numeric";
  }
  if ("status" in value && typeof value.status !== "string") {
    return "shared bridge heartbeat status must be a string";
  }
  if ("accountId" in value && typeof value.accountId !== "string") {
    return "shared bridge heartbeat accountId must be a string";
  }
  if ("workspaceRoot" in value && typeof value.workspaceRoot !== "string") {
    return "shared bridge heartbeat workspaceRoot must be a string";
  }
  if ("codexEndpoint" in value && typeof value.codexEndpoint !== "string") {
    return "shared bridge heartbeat codexEndpoint must be a string";
  }
  if ("startedAt" in value && typeof value.startedAt !== "string") {
    return "shared bridge heartbeat startedAt must be a string";
  }
  if ("updatedAt" in value && typeof value.updatedAt !== "string") {
    return "shared bridge heartbeat updatedAt must be a string";
  }
  if ("stoppedAt" in value && typeof value.stoppedAt !== "string") {
    return "shared bridge heartbeat stoppedAt must be a string";
  }
  if ("lastPollStartedAt" in value && typeof value.lastPollStartedAt !== "string") {
    return "shared bridge heartbeat lastPollStartedAt must be a string";
  }
  if ("lastPollSucceededAt" in value && typeof value.lastPollSucceededAt !== "string") {
    return "shared bridge heartbeat lastPollSucceededAt must be a string";
  }
  if ("lastPollFailedAt" in value && typeof value.lastPollFailedAt !== "string") {
    return "shared bridge heartbeat lastPollFailedAt must be a string";
  }
  if ("consecutiveFailures" in value && typeof value.consecutiveFailures !== "number" && typeof value.consecutiveFailures !== "string") {
    return "shared bridge heartbeat consecutiveFailures must be numeric";
  }
  if ("lastError" in value && typeof value.lastError !== "string") {
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
