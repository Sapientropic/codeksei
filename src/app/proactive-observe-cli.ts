import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTargetResolutionRequiredError } from "../core/cli-contract";
import { buildTerminalLeafHelp } from "../core/command-registry";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { normalizeText } from "../core/text-normalization";
import { createSessionStore } from "../session/session-store-factory";
import {
  buildCheckinTargetResolutionErrorMessage,
  resolveCheckinTarget,
} from "../checkin";
import {
  buildContextBoardBriefing,
  refreshContextBoard,
  type ContextBoardConfig,
} from "../context/board";
import {
  buildProactiveObservationInputFromBriefing,
  buildProactiveObservationSourceHash,
  maybeGenerateProactiveObservation,
} from "../proactive/observation";
import { readObservationState } from "../proactive/observation-store";
import type { ProactiveJudgmentConfig } from "../proactive/contracts";

interface ProactiveObserveOptions {
  dryRun: boolean;
  help: boolean;
  show: boolean;
  user: string;
  workspace: string;
}

type ProactiveObserveConfig = ContextBoardConfig & ProactiveJudgmentConfig & Partial<Pick<
  AppRuntimeConfig,
  "accountId" | "allowedUserIds" | "sessionsFile" | "workspaceRoot"
>>;

export async function runProactiveObserveCommand(
  config: ProactiveObserveConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<ProactiveObserveOptions>(args, getCommandArgsSchema("proactiveObserve"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("proactive.observe"),
    };
  }

  const resolution = resolveCheckinTarget({
    accountId: normalizeText(config.accountId),
    config,
    explicitUser: normalizeText(options.user),
    explicitWorkspace: normalizeText(options.workspace),
    sessionStore: createSessionStore(config.sessionsFile),
  });
  if (!resolution.ok || !resolution.value) {
    throw buildTargetResolutionRequiredError(
      buildCheckinTargetResolutionErrorMessage(resolution),
      {
        senderCandidates: resolution.senderResolution.candidates,
        senderSource: resolution.senderResolution.source,
        workspaceCandidates: resolution.workspaceResolution.candidates,
        workspaceSource: resolution.workspaceResolution.source,
      },
      "显式传 --user / --workspace，或先把唯一稳定默认值写进配置。",
    );
  }

  const target = resolution.value;
  if (options.show) {
    const briefing = buildContextBoardBriefing(config, target, { mode: "proactive" });
    const input = buildProactiveObservationInputFromBriefing(config, target, briefing);
    const currentSourceHash = buildProactiveObservationSourceHash(input);
    const state = readObservationState(config, target);
    const latest = state.latest
      ? {
        ...state.latest,
        expired: isObservationExpired(state.latest.createdAt, new Date()),
        sourceHashMatches: state.latest.sourceHash === currentSourceHash,
      }
      : null;
    return {
      data: {
        currentSourceHash,
        latest,
        recentCount: state.recent.length,
        status: "shown",
        target: briefing.target,
      },
      text: [
        "status: shown",
        `currentSourceHash: ${currentSourceHash}`,
        latest ? `latest: ${latest.id}` : "latest: (none)",
        latest ? `usable: ${latest.usable ? "yes" : "no"}` : "",
        latest ? `expired: ${latest.expired ? "yes" : "no"}` : "",
      ].filter(Boolean).join("\n"),
    };
  }

  const initialBriefing = options.dryRun
    ? buildContextBoardBriefing(config, target, { mode: "proactive" })
    : refreshContextBoard(config, target, { mode: "proactive" });
  const input = buildProactiveObservationInputFromBriefing(config, target, initialBriefing);
  const observed = await maybeGenerateProactiveObservation(config, input, {
    write: !options.dryRun,
  });
  const finalBriefing = observed.data && !options.dryRun
    ? refreshContextBoard(config, target, {
      mode: "proactive",
      observation: observed.data,
    })
    : initialBriefing;

  const status = observed.data ? "observed" : "fallback";
  return {
    data: {
      briefingText: finalBriefing.briefingText,
      observation: observed.data,
      reason: observed.reason,
      source: observed.source,
      status,
      target: finalBriefing.target,
      written: Boolean(observed.data && !options.dryRun),
    },
    text: [
      `status: ${status}`,
      `source: ${observed.source}`,
      observed.data ? `observation: ${observed.data.id}` : `reason: ${observed.reason || "none"}`,
      `written: ${observed.data && !options.dryRun ? "yes" : "no"}`,
    ].join("\n"),
  };
}

function isObservationExpired(createdAt: string, now: Date): boolean {
  const createdAtMs = Date.parse(createdAt);
  return !Number.isFinite(createdAtMs) || now.getTime() - createdAtMs > 30 * 60_000;
}
