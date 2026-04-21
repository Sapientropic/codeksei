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
  refreshContextBoard,
  type ContextBoardBriefing,
  type ContextBoardConfig,
  type ContextBriefingMode,
} from "../context/board";

interface ContextBriefingOptions {
  help: boolean;
  mode: string;
  user: string;
  workspace: string;
}

type ContextBriefingCliConfig = ContextBoardConfig & Partial<Pick<
  AppRuntimeConfig,
  | "accountId"
  | "allowedUserIds"
  | "sessionsFile"
  | "workspaceRoot"
>>;

export async function runContextBriefingCommand(
  config: ContextBriefingCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<ContextBriefingOptions>(args, getCommandArgsSchema("contextBriefing"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("context.briefing"),
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

  const briefing = refreshContextBoard(config, resolution.value, {
    mode: normalizeBriefingMode(options.mode),
  });
  return {
    data: buildBriefingData(briefing),
    meta: {
      configSource: {
        checkinScheduleStateFile: config.checkinScheduleStateFile || "",
        diaryDir: config.diaryDir || "",
        durableNoteSchemaConfigFile: config.durableNoteSchemaConfigFile || "",
        projectRadarConfigFile: config.projectRadarConfigFile || "",
        stateDir: config.stateDir || "",
        workspaceBootstrapConfigFile: config.workspaceBootstrapConfigFile || "",
      },
      effectiveWorkspaceRoot: briefing.target.workspaceRoot,
    },
    text: briefing.briefingText,
  };
}

function buildBriefingData(briefing: ContextBoardBriefing): Record<string, unknown> {
  return {
    boardPath: briefing.boardPath,
    boardText: briefing.boardText,
    briefingText: briefing.briefingText,
    followupContext: briefing.followupContext,
    freshness: briefing.freshness,
    mode: briefing.mode,
    sources: {
      checkin: briefing.checkin,
      companionMemory: briefing.companionMemory,
      companionNote: briefing.companionNote,
      onboarding: briefing.onboarding,
      pendingHandoff: briefing.checkin.pendingHandoff,
      projectRadar: briefing.projectRadar,
      todayDiary: briefing.todayDiary,
      workspaceBootstrap: briefing.workspaceBootstrap,
    },
    stale: briefing.stale,
    staleReasons: briefing.staleReasons,
    stateCard: briefing.stateCard,
    target: briefing.target,
    updatedAt: briefing.updatedAt,
  };
}

function normalizeBriefingMode(value: unknown): ContextBriefingMode {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "review" ? "review" : "proactive";
}
