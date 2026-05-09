import { redactSensitiveText } from "../contracts/redact";
import { normalizeText } from "../contracts/text-normalization";
import { createSessionStore } from "../session/session-store-factory";
import {
  buildCheckinTargetResolutionErrorMessage,
  resolveCheckinTarget,
} from "../checkin";
import { buildTargetResolutionRequiredError } from "../core/cli-contract";
import {
  refreshContextBoard,
  type ContextBoardBriefing,
  type ContextBoardConfig,
  type ContextBriefingMode,
} from "./board";
import { evaluateContextPacks, type ContextPackEvaluation } from "./context-packs";

export interface ContextInspectConfig extends ContextBoardConfig {}

export interface ContextInspectLayer {
  id: string;
  included: boolean;
  reason: string;
  sourceKind: string;
  title: string;
  tokenOrCharEstimate: number;
}

export interface ContextInspectReport {
  companionMemory: ContextBoardBriefing["companionMemory"];
  excluded: ContextInspectLayer[];
  layers: ContextInspectLayer[];
  mode: ContextBriefingMode;
  onboarding: ContextBoardBriefing["onboarding"] & {
    nextAction: "start" | "step" | "ready";
    nextPrompt: string;
    readyForDailyLoop: boolean;
  };
  pendingHandoff: ContextBoardBriefing["checkin"]["pendingHandoff"];
  redaction: {
    applied: boolean;
    strategy: string;
  };
  sourceHealth: {
    missing: string[];
    readyForDailyLoop: boolean;
    staleReasons: string[];
    thin: boolean;
  };
  staleReasons: string[];
  stateCard: ContextBoardBriefing["stateCard"];
  target: ContextBoardBriefing["target"];
  updatedAt: string;
}

export interface ContextInspectOptions {
  mode?: string;
  recordContextPackMatches?: boolean;
  text?: string;
  user?: string;
  workspace?: string;
}

export function buildContextInspectReport(
  config: ContextInspectConfig,
  options: ContextInspectOptions = {},
): {
  briefing: ContextBoardBriefing;
  contextPacks: ContextPackEvaluation;
  report: ContextInspectReport;
} {
  const resolution = resolveCheckinTarget({
    accountId: normalizeText(config.accountId),
    config: normalizeContextInspectTargetConfig(config),
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
  const mode = normalizeInspectMode(options.mode);
  const briefing = refreshContextBoard(config, resolution.value, { mode });
  const contextPacks = evaluateContextPacks(config, {
    mode,
    recordMatches: options.recordContextPackMatches === true,
    scanText: buildContextPackScanText(briefing, options.text),
  });
  const layers = [
    ...buildBaseLayers(briefing),
    ...contextPacks.packs.map((pack): ContextInspectLayer => ({
      id: `contextPack:${pack.id}`,
      included: pack.included,
      reason: pack.reason,
      sourceKind: "context_pack",
      title: `Context Pack: ${pack.id}`,
      tokenOrCharEstimate: pack.content.length,
    })),
  ];
  const sourceHealth = buildSourceHealth(briefing);
  const report: ContextInspectReport = {
    companionMemory: briefing.companionMemory,
    excluded: layers.filter((layer) => !layer.included),
    layers,
    mode,
    onboarding: {
      ...briefing.onboarding,
      nextAction: briefing.onboarding.status === "ready" ? "ready" : (briefing.onboarding.status === "not_started" ? "start" : "step"),
      nextPrompt: buildOnboardingInspectPrompt(briefing.onboarding),
      readyForDailyLoop: briefing.onboarding.status === "ready",
    },
    pendingHandoff: briefing.checkin.pendingHandoff,
    redaction: {
      applied: true,
      strategy: "text output redacts sensitive tokens and local workspace/state paths",
    },
    sourceHealth,
    staleReasons: [...briefing.staleReasons],
    stateCard: briefing.stateCard,
    target: briefing.target,
    updatedAt: briefing.updatedAt,
  };
  return { briefing, contextPacks, report };
}

function normalizeContextInspectTargetConfig(
  config: ContextInspectConfig,
): {
  allowedUserIds?: string[];
  workspaceId?: string;
  workspaceRoot?: string;
} {
  const normalized: {
    allowedUserIds?: string[];
    workspaceId?: string;
    workspaceRoot?: string;
  } = {};
  if (Array.isArray(config.allowedUserIds)) {
    normalized.allowedUserIds = [...config.allowedUserIds].map((entry) => normalizeText(entry)).filter(Boolean);
  }
  const workspaceId = normalizeText((config as { workspaceId?: unknown }).workspaceId);
  if (workspaceId) {
    normalized.workspaceId = workspaceId;
  }
  const workspaceRoot = normalizeText(config.workspaceRoot);
  if (workspaceRoot) {
    normalized.workspaceRoot = workspaceRoot;
  }
  return normalized;
}

export function renderContextInspectText(
  report: ContextInspectReport,
  {
    stateDir = "",
    workspaceRoot = "",
  }: {
    stateDir?: unknown;
    workspaceRoot?: unknown;
  } = {},
): string {
  const onboarding = report.onboarding || {
    missingSlots: [],
    nextAction: "start",
    nextPrompt: "",
    readyForDailyLoop: false,
    status: "not_started",
    updatedAt: "",
  };
  const companionMemory = report.companionMemory || {
    lastSource: "",
    lastUpdatedAt: "",
    recentWriteCount: 0,
    slotFreshness: {},
  };
  const sourceHealth = report.sourceHealth || {
    missing: [],
    readyForDailyLoop: false,
    staleReasons: report.staleReasons || [],
    thin: Boolean(report.staleReasons?.length),
  };
  const lines = [
    `Codeksei context inspect (${report.mode})`,
    `target: ${report.target.senderId} @ ${report.target.workspaceRoot}`,
    `pending handoff: ${report.pendingHandoff.exists ? "yes" : "no"}`,
    report.staleReasons.length ? `stale: ${report.staleReasons.join(", ")}` : "stale: none",
    `onboarding: ${onboarding.status}${onboarding.missingSlots.length ? ` | missing ${onboarding.missingSlots.join(", ")}` : ""}${onboarding.nextAction ? ` | next ${onboarding.nextAction}` : ""}${onboarding.readyForDailyLoop ? " | daily loop ready" : ""}`,
    `companion memory: ${companionMemory.lastUpdatedAt || "missing"}${companionMemory.lastSource ? ` | source ${companionMemory.lastSource}` : ""} | recent writes ${companionMemory.recentWriteCount}`,
    `source health: ${sourceHealth.thin ? "thin" : "ready"}${sourceHealth.missing.length ? ` | missing ${sourceHealth.missing.join(", ")}` : ""}`,
    "",
    "Layers:",
    ...report.layers.map((layer) => `- ${layer.id} | ${layer.included ? "included" : "excluded"} | ${layer.sourceKind} | ${layer.reason} | chars ${layer.tokenOrCharEstimate}`),
  ];
  return redactLocalPaths(redactSensitiveText(lines.join("\n"), 4000), [
    normalizeText(report.target.workspaceRoot),
    normalizeText(workspaceRoot),
    normalizeText(stateDir),
  ]);
}

function buildBaseLayers(briefing: ContextBoardBriefing): ContextInspectLayer[] {
  return [
    buildLayer("checkin", "Check-in State", "checkin_state", briefing.checkin.stateFound, briefing.checkin.stateFound ? "current target checkin state loaded" : "checkin state missing or target mismatch", briefing.sections.currentStatus),
    buildLayer("todayDiary", "Today Diary", "diary", briefing.todayDiary.exists, briefing.todayDiary.exists ? "today diary loaded" : "missing today diary", briefing.sections.todayFacts),
    buildLayer("companionNote", "Companion Note", "companion_note", briefing.companionNote.exists, briefing.companionNote.exists ? "companion note loaded" : "companion note missing", [
      briefing.sections.currentStatus,
      briefing.sections.cautions,
      briefing.sections.reentryPoints,
    ].join("\n")),
    buildLayer("whereabouts", "Whereabouts", "whereabouts", briefing.whereabouts.available, briefing.whereabouts.reason, briefing.whereabouts.statusLine || briefing.whereabouts.reason),
    buildLayer("companionMemory", "Companion Memory Runtime", "companion_memory", Boolean(briefing.companionMemory.lastUpdatedAt || briefing.companionMemory.recentWriteCount), briefing.companionMemory.lastUpdatedAt ? "recent companion memory state loaded" : "companion memory runtime state missing", JSON.stringify(briefing.companionMemory)),
    buildLayer("projectRadar", "Project Radar", "project_radar", briefing.projectRadar.available, briefing.projectRadar.available ? "project radar matched current workspace" : `project radar unavailable: ${briefing.projectRadar.reason || "unknown"}`, briefing.sections.activeThreads),
    buildLayer("workspaceBootstrap", "Workspace Bootstrap", "workspace_bootstrap", countWorkspaceFiles(briefing) > 0, countWorkspaceFiles(briefing) > 0 ? "workspace continuity files loaded" : "workspace bootstrap files missing", briefing.sections.reentryPoints),
    buildLayer("proactiveStateCard", "Companion State Card", "state_card", true, "deterministic state card built from included layers", JSON.stringify(briefing.stateCard)),
  ];
}

function buildLayer(
  id: string,
  title: string,
  sourceKind: string,
  included: boolean,
  reason: string,
  content: string,
): ContextInspectLayer {
  return {
    id,
    included,
    reason,
    sourceKind,
    title,
    tokenOrCharEstimate: normalizeText(content).length,
  };
}

function countWorkspaceFiles(briefing: ContextBoardBriefing): number {
  return briefing.workspaceBootstrap.primaryFiles.length
    + briefing.workspaceBootstrap.recentFiles.length
    + briefing.workspaceBootstrap.conditionalFiles.length;
}

function buildSourceHealth(briefing: ContextBoardBriefing): ContextInspectReport["sourceHealth"] {
  const missing: string[] = [];
  if (!briefing.todayDiary.exists) {
    missing.push("todayDiary");
  }
  if (!briefing.companionNote.exists) {
    missing.push("companionNote");
  }
  if (!briefing.companionMemory.lastUpdatedAt && !briefing.companionMemory.recentWriteCount) {
    missing.push("companionMemory");
  }
  if (briefing.onboarding.status !== "ready") {
    missing.push("onboarding");
  }
  if (!briefing.checkin.stateFound) {
    missing.push("checkin");
  }
  const thin = briefing.stale || briefing.stateCard.sourceThickness === "thin" || missing.includes("onboarding");
  return {
    missing,
    readyForDailyLoop: !thin && briefing.onboarding.status === "ready",
    staleReasons: [...briefing.staleReasons],
    thin,
  };
}

function buildOnboardingInspectPrompt(onboarding: ContextBoardBriefing["onboarding"]): string {
  if (onboarding.status === "ready") {
    return "";
  }
  const nextSlot = onboarding.missingSlots[0] || "current_status";
  switch (nextSlot) {
    case "rhythm":
      return "补一句你通常什么时候有精力、什么时候最好别打扰。";
    case "preference":
      return "补一句你更喜欢我怎样说话、怎样支持你。";
    case "boundary":
      return "补一句哪些做法会冒犯、越界或需要先问你。";
    case "next":
      return "补一句接下来几天最可能先发生、最希望被接住的事。";
    case "current_status":
    default:
      return "补一句最近的日子大概是什么样、眼下最想被帮到什么。";
  }
}

function buildContextPackScanText(briefing: ContextBoardBriefing, text: unknown): string {
  return [
    normalizeText(text),
    briefing.sections.currentStatus,
    briefing.sections.todayFacts,
    briefing.sections.activeThreads,
    briefing.sections.cautions,
    briefing.sections.reentryPoints,
  ].join("\n");
}

function normalizeInspectMode(value: unknown): ContextBriefingMode {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "review" ? "review" : "proactive";
}

function redactLocalPaths(text: string, paths: string[]): string {
  return paths
    .filter(Boolean)
    .reduce((current, targetPath) => current.split(targetPath).join("<local-path>"), text);
}
