import * as fs from "node:fs";
import * as path from "node:path";

import { normalizeText } from "../contracts/text-normalization";
import {
  DEFAULT_WHEREABOUTS_RETENTION_DAYS,
  type WhereaboutsMove,
  type WhereaboutsNamedPlace,
  type WhereaboutsNormalizedEvent,
  type WhereaboutsPaths,
  type WhereaboutsPlacesDocument,
  type WhereaboutsSnapshot,
  type WhereaboutsStateConfig,
  type WhereaboutsStay,
  type WhereaboutsSummary,
} from "./contracts";
import { ensureParentDirectory, readForeignJsonDocument, writeForeignJsonDocument } from "../state/json-state";

export function resolveWhereaboutsPaths(config: WhereaboutsStateConfig): WhereaboutsPaths {
  const stateDir = normalizeText(config.stateDir);
  if (!stateDir) {
    throw new Error("缺少 stateDir，无法读写 whereabouts 状态。");
  }
  const rootDir = path.join(stateDir, "whereabouts");
  const placesFile = normalizeText(config.whereaboutsPlacesFile) || path.join(rootDir, "places.json");
  return {
    eventsFile: path.join(rootDir, "events.jsonl"),
    movesFile: path.join(rootDir, "moves.json"),
    placesFile,
    rootDir,
    snapshotFile: path.join(rootDir, "snapshot.json"),
    staysFile: path.join(rootDir, "stays.json"),
    summaryFile: path.join(rootDir, "summary.json"),
  };
}

export function resolveWhereaboutsRetentionDays(config: WhereaboutsStateConfig): number {
  const configured = Number.parseInt(String(config.whereaboutsRetentionDays || "").trim(), 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_WHEREABOUTS_RETENTION_DAYS;
}

export function readWhereaboutsEventsFile(filePath: string): WhereaboutsNormalizedEvent[] {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as WhereaboutsNormalizedEvent)
      .filter((entry) => entry && entry.kind === "whereabouts_event" && typeof entry.occurredAt === "string")
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  } catch {
    return [];
  }
}

export function writeWhereaboutsEventsFile(filePath: string, events: WhereaboutsNormalizedEvent[]): void {
  ensureParentDirectory(filePath);
  const content = events.map((entry) => JSON.stringify(entry)).join("\n");
  fs.writeFileSync(filePath, content ? `${content}\n` : "", "utf8");
}

export function readWhereaboutsPlaces(config: WhereaboutsStateConfig): WhereaboutsNamedPlace[] {
  const document = readForeignJsonDocument<WhereaboutsPlacesDocument | null>(
    resolveWhereaboutsPaths(config).placesFile,
    { fallback: null },
  );
  return Array.isArray(document?.places)
    ? document.places.filter((entry) => entry && typeof entry.id === "string" && typeof entry.label === "string")
    : [];
}

export function writeWhereaboutsPlaces(config: WhereaboutsStateConfig, places: WhereaboutsNamedPlace[]): void {
  const document: WhereaboutsPlacesDocument = {
    places,
    version: 1,
  };
  writeForeignJsonDocument(resolveWhereaboutsPaths(config).placesFile, document);
}

export function readWhereaboutsSnapshotFile(config: WhereaboutsStateConfig): WhereaboutsSnapshot | null {
  return readForeignJsonDocument<WhereaboutsSnapshot | null>(
    resolveWhereaboutsPaths(config).snapshotFile,
    { fallback: null },
  );
}

export function readWhereaboutsSummaryFile(config: WhereaboutsStateConfig): WhereaboutsSummary | null {
  return readForeignJsonDocument<WhereaboutsSummary | null>(
    resolveWhereaboutsPaths(config).summaryFile,
    { fallback: null },
  );
}

export function readWhereaboutsMovesFile(config: WhereaboutsStateConfig): WhereaboutsMove[] {
  return readForeignJsonDocument<WhereaboutsMove[]>(
    resolveWhereaboutsPaths(config).movesFile,
    { fallback: [] },
  );
}

export function readWhereaboutsStaysFile(config: WhereaboutsStateConfig): WhereaboutsStay[] {
  return readForeignJsonDocument<WhereaboutsStay[]>(
    resolveWhereaboutsPaths(config).staysFile,
    { fallback: [] },
  );
}

export function writeWhereaboutsMaterializedState(
  config: WhereaboutsStateConfig,
  {
    moves,
    snapshot,
    stays,
    summary,
  }: {
    moves: WhereaboutsMove[];
    snapshot: WhereaboutsSnapshot;
    stays: WhereaboutsStay[];
    summary: WhereaboutsSummary;
  },
): void {
  const paths = resolveWhereaboutsPaths(config);
  writeForeignJsonDocument(paths.staysFile, stays);
  writeForeignJsonDocument(paths.movesFile, moves);
  writeForeignJsonDocument(paths.snapshotFile, snapshot);
  writeForeignJsonDocument(paths.summaryFile, summary);
}
