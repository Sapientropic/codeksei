import {
  type WhereaboutsMove,
  type WhereaboutsNormalizedEvent,
  type WhereaboutsSnapshot,
  type WhereaboutsStateConfig,
  type WhereaboutsStay,
  type WhereaboutsSummary,
} from "./contracts";
import {
  readWhereaboutsEventsFile,
  readWhereaboutsMovesFile,
  readWhereaboutsSnapshotFile,
  readWhereaboutsStaysFile,
  readWhereaboutsSummaryFile,
  resolveWhereaboutsPaths,
} from "./store";
import { buildWhereaboutsMaterializedState } from "./summary";

export function readWhereaboutsEvents(config: WhereaboutsStateConfig): WhereaboutsNormalizedEvent[] {
  return readWhereaboutsEventsFile(resolveWhereaboutsPaths(config).eventsFile);
}

export function listRecentWhereaboutsStays(config: WhereaboutsStateConfig): WhereaboutsStay[] {
  const stored = readWhereaboutsStaysFile(config);
  if (stored.length) {
    return stored;
  }
  return buildWhereaboutsMaterializedState(readWhereaboutsEvents(config)).stays;
}

export function listRecentWhereaboutsMoves(config: WhereaboutsStateConfig): WhereaboutsMove[] {
  const stored = readWhereaboutsMovesFile(config);
  if (stored.length) {
    return stored;
  }
  return buildWhereaboutsMaterializedState(readWhereaboutsEvents(config)).moves;
}

export function readWhereaboutsSnapshot(
  config: WhereaboutsStateConfig,
  {
    now = new Date().toISOString(),
  }: {
    now?: string;
  } = {},
): WhereaboutsSnapshot {
  const stored = readWhereaboutsSnapshotFile(config);
  if (stored && stored.generatedAt === now) {
    return stored;
  }
  return buildWhereaboutsMaterializedState(readWhereaboutsEvents(config), { now }).snapshot;
}

export function readWhereaboutsSummary(
  config: WhereaboutsStateConfig,
  {
    now = new Date().toISOString(),
  }: {
    now?: string;
  } = {},
): WhereaboutsSummary {
  const stored = readWhereaboutsSummaryFile(config);
  if (stored && stored.generatedAt === now) {
    return stored;
  }
  return buildWhereaboutsMaterializedState(readWhereaboutsEvents(config), { now }).summary;
}
