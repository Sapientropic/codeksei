import * as crypto from "node:crypto";

import type { CommandEnvelope } from "../contracts/cli-contract";
import { readManagedJsonStateFile, writeManagedJsonStateFile } from "../state/json-state";

interface CliIdempotencyRecord {
  commandKey: string;
  compositeKey: string;
  envelope: CommandEnvelope;
  idempotencyKey: string;
  recordedAt: string;
  requestHash: string;
}

interface CliIdempotencyLedger {
  records: Record<string, CliIdempotencyRecord>;
  version: 1;
}

interface CliIdempotencyArgs {
  commandKey: string;
  filePath: string;
  idempotencyKey: string;
  request: unknown;
  resolvedTargets: unknown;
}

const EMPTY_LEDGER: CliIdempotencyLedger = {
  version: 1,
  records: {},
};

function buildCliIdempotencyCompositeKey({
  commandKey,
  idempotencyKey,
  resolvedTargets,
}: Omit<CliIdempotencyArgs, "filePath" | "request">): string {
  const targetHash = hashCliIdempotencyValue(resolvedTargets);
  return `${commandKey}:${idempotencyKey}:${targetHash}`;
}

function hashCliIdempotencyValue(value: unknown): string {
  const hash = crypto.createHash("sha256");
  hash.update(stableSerialize(value));
  return hash.digest("hex");
}

function lookupCliIdempotencyRecord(args: CliIdempotencyArgs): CliIdempotencyRecord | null {
  const ledger = readCliIdempotencyLedger(args.filePath);
  const compositeKey = buildCliIdempotencyCompositeKey(args);
  const record = ledger.records[compositeKey];
  if (!record) {
    return null;
  }
  const requestHash = hashCliIdempotencyValue(args.request);
  if (record.requestHash !== requestHash) {
    throw new Error(
      `同一个 --idempotency-key 已经用于不同请求: ${args.idempotencyKey} (${args.commandKey})`
    );
  }
  return record;
}

function recordCliIdempotencyResult(
  args: CliIdempotencyArgs,
  envelope: CommandEnvelope,
): void {
  const ledger = readCliIdempotencyLedger(args.filePath);
  const compositeKey = buildCliIdempotencyCompositeKey(args);
  ledger.records[compositeKey] = {
    commandKey: args.commandKey,
    compositeKey,
    envelope,
    idempotencyKey: args.idempotencyKey,
    recordedAt: new Date().toISOString(),
    requestHash: hashCliIdempotencyValue(args.request),
  };
  const entries = Object.entries(ledger.records)
    .sort((left, right) =>
      String(right[1]?.recordedAt || "").localeCompare(String(left[1]?.recordedAt || ""))
    )
    .slice(0, 200);
  ledger.records = Object.fromEntries(entries);
  writeManagedJsonStateFile(args.filePath, ledger);
}

function readCliIdempotencyLedger(filePath: string): CliIdempotencyLedger {
  return readManagedJsonStateFile<CliIdempotencyLedger>({
    filePath,
    fallback: EMPTY_LEDGER,
    label: "cli idempotency ledger",
    validate: validateCliIdempotencyLedger,
  });
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortStableValue(value));
}

function sortStableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortStableValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([key, entryValue]) => [key, sortStableValue(entryValue)]);
  return Object.fromEntries(entries);
}

function validateCliIdempotencyLedger(value: unknown): true | string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "cli idempotency ledger must be an object";
  }
  const candidate = value as {
    records?: unknown;
    version?: unknown;
  };
  if (candidate.version !== 1) {
    return "cli idempotency ledger version must equal 1";
  }
  if (!candidate.records || typeof candidate.records !== "object" || Array.isArray(candidate.records)) {
    return "cli idempotency ledger records must be an object";
  }
  for (const record of Object.values(candidate.records as Record<string, unknown>)) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return "cli idempotency ledger record must be an object";
    }
  }
  return true;
}

export {
  buildCliIdempotencyCompositeKey,
  lookupCliIdempotencyRecord,
  recordCliIdempotencyResult,
};
