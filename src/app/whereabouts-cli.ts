import type { CommandExecutionResult } from "../contracts/cli-contract";
import { getCommandArgsSchema } from "../contracts/command-args";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { normalizeText } from "../contracts/text-normalization";
import { listRecentWhereaboutsMoves, listRecentWhereaboutsStays, readWhereaboutsSnapshot, readWhereaboutsSummary } from "../whereabouts/query";
import { createWhereaboutsHttpServer, listenWhereaboutsHttpServer } from "../whereabouts/http-server";
import { pruneWhereaboutsState } from "../whereabouts/ingest";
import { collectWhereaboutsCapabilityReadiness } from "../whereabouts/readiness";
import {
  renderWhereaboutsMovesText,
  renderWhereaboutsSnapshotText,
  renderWhereaboutsStaysText,
  renderWhereaboutsSummaryText,
} from "../whereabouts/presentation";

interface WhereaboutsServeOptions {
  help: boolean;
  host: string;
  port: string;
}

interface WhereaboutsReadOptions {
  help: boolean;
  now: string;
}

type WhereaboutsCliConfig = Partial<Pick<
  AppRuntimeConfig,
  | "stateDir"
  | "timezone"
  | "whereaboutsHost"
  | "whereaboutsPlacesFile"
  | "whereaboutsPort"
  | "whereaboutsRetentionDays"
  | "whereaboutsToken"
>>;

export async function runWhereaboutsServeCommand(
  config: WhereaboutsCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<WhereaboutsServeOptions>(args, getCommandArgsSchema("whereaboutsServe"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("whereabouts.serve"),
    };
  }

  const readiness = collectWhereaboutsCapabilityReadiness(config);
  if (!readiness.query.available) {
    throw new Error(readiness.query.reason);
  }
  if (!readiness.serve.available) {
    throw new Error(readiness.serve.reason);
  }

  const baseline = pruneWhereaboutsState(config);
  const server = createWhereaboutsHttpServer(config);
  const host = normalizeText(options.host) || readiness.host;
  const port = parsePort(options.port, readiness.port);
  const started = await listenWhereaboutsHttpServer(server, { host, port });
  return {
    data: {
      baseUrl: started.baseUrl,
      host: started.host,
      port: started.port,
      snapshot: baseline.snapshot,
      summary: baseline.summary,
    },
    text: `whereabouts serve ready: ${started.baseUrl}`,
  };
}

export async function runWhereaboutsSnapshotCommand(
  config: WhereaboutsCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<WhereaboutsReadOptions>(args, getCommandArgsSchema("whereaboutsSnapshot"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("whereabouts.snapshot"),
    };
  }
  const snapshot = readWhereaboutsSnapshot(config, { now: normalizeText(options.now) || new Date().toISOString() });
  return {
    data: snapshot,
    text: renderWhereaboutsSnapshotText(snapshot),
  };
}

export async function runWhereaboutsRecentStaysCommand(
  config: WhereaboutsCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<{ help: boolean }>(args, getCommandArgsSchema("whereaboutsRecentStays"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("whereabouts.recent_stays"),
    };
  }
  const items = listRecentWhereaboutsStays(config);
  return {
    data: { items },
    text: renderWhereaboutsStaysText(items),
  };
}

export async function runWhereaboutsRecentMovesCommand(
  config: WhereaboutsCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<{ help: boolean }>(args, getCommandArgsSchema("whereaboutsRecentMoves"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("whereabouts.recent_moves"),
    };
  }
  const items = listRecentWhereaboutsMoves(config);
  return {
    data: { items },
    text: renderWhereaboutsMovesText(items),
  };
}

export async function runWhereaboutsSummaryCommand(
  config: WhereaboutsCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<WhereaboutsReadOptions>(args, getCommandArgsSchema("whereaboutsSummary"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("whereabouts.summary"),
    };
  }
  const summary = readWhereaboutsSummary(config, { now: normalizeText(options.now) || new Date().toISOString() });
  return {
    data: summary,
    text: renderWhereaboutsSummaryText(summary),
  };
}

function parsePort(value: string, fallback: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
