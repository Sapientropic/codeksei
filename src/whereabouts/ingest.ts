import {
  type WhereaboutsIngestEvent,
  type WhereaboutsStateConfig,
} from "./contracts";
import {
  readWhereaboutsEventsFile,
  readWhereaboutsPlaces,
  resolveWhereaboutsPaths,
  resolveWhereaboutsRetentionDays,
  writeWhereaboutsEventsFile,
  writeWhereaboutsMaterializedState,
} from "./store";
import {
  buildWhereaboutsMaterializedState,
  normalizeWhereaboutsEvent,
  pruneWhereaboutsEvents,
} from "./summary";

export async function ingestWhereaboutsEvent(
  config: WhereaboutsStateConfig,
  payload: WhereaboutsIngestEvent,
): Promise<ReturnType<typeof buildWhereaboutsMaterializedState>> {
  const paths = resolveWhereaboutsPaths(config);
  const existing = readWhereaboutsEventsFile(paths.eventsFile);
  const now = payload.occurredAt || new Date().toISOString();
  const retentionDays = resolveWhereaboutsRetentionDays(config);
  const normalized = normalizeWhereaboutsEvent(payload, {
    places: readWhereaboutsPlaces(config),
  });
  const events = pruneWhereaboutsEvents([...existing, normalized], {
    now,
    retentionDays,
  }).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  writeWhereaboutsEventsFile(paths.eventsFile, events);
  const nextState = buildWhereaboutsMaterializedState(events, { now });
  writeWhereaboutsMaterializedState(config, nextState);
  return nextState;
}

export function pruneWhereaboutsState(
  config: WhereaboutsStateConfig,
  {
    now = new Date().toISOString(),
  }: {
    now?: string;
  } = {},
): ReturnType<typeof buildWhereaboutsMaterializedState> {
  const paths = resolveWhereaboutsPaths(config);
  const retentionDays = resolveWhereaboutsRetentionDays(config);
  const events = pruneWhereaboutsEvents(readWhereaboutsEventsFile(paths.eventsFile), {
    now,
    retentionDays,
  }).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  writeWhereaboutsEventsFile(paths.eventsFile, events);
  const nextState = buildWhereaboutsMaterializedState(events, { now });
  writeWhereaboutsMaterializedState(config, nextState);
  return nextState;
}
