const fs = require("fs");
const path = require("path");

const DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS = 120_000;

function readSharedBridgeHeartbeat(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return normalizeHeartbeat(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeSharedBridgeHeartbeat(filePath, patch) {
  const current = readSharedBridgeHeartbeat(filePath) || {};
  const next = normalizeHeartbeat({
    ...current,
    ...(patch || {}),
    updatedAt: new Date().toISOString(),
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function classifySharedBridgeHeartbeat(record, { expectedPid = 0, maxAgeMs = DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS } = {}) {
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

function normalizeHeartbeat(value) {
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

function normalizePid(value) {
  const numeric = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeIso(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeCount(value) {
  const numeric = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : 0;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  DEFAULT_SHARED_BRIDGE_HEARTBEAT_MAX_AGE_MS,
  classifySharedBridgeHeartbeat,
  readSharedBridgeHeartbeat,
  writeSharedBridgeHeartbeat,
};
