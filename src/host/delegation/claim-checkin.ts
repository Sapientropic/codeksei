import { CliError } from "../../core/cli-contract";
import type { AppRuntimeConfig } from "../../core/app-service-contract";
import { tryRefreshContextBoard, type ContextBoardBriefing } from "../../context/board";
import {
  buildCheckinTargetKey,
  CHECKIN_ACTIVE_WAKE_TIMEOUT_MS,
  runCheckinTick,
  type CheckinResolvedTarget,
} from "../../checkin";
import { syncHostedCheckinPlanViaHermes } from "../recipes/hermes/wake-forwarder";
import { buildProactiveDecision } from "../../proactive/decision";
import { readRecentProactiveOutcomes } from "../../proactive/outcome-log";
import type { ProactiveDecision, ProactiveJudgmentInput } from "../../proactive/contracts";
import type {
  ClaimedPayload,
  DelegationLease,
  HostCheckinBookkeepingExpectation,
  HostClaimContextBriefing,
  HostClaimStatus,
  HostPendingHandoffSummary,
  PersistedOriginRef,
} from "../contracts/claim-ticket";

type ClaimConfig = Pick<
  AppRuntimeConfig,
  "checkinConfigFile" | "checkinScheduleStateFile"
> & Partial<Pick<
  AppRuntimeConfig,
  | "allowedUserIds"
  | "diaryDir"
  | "durableNoteSchemaConfigFile"
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
  | "projectRadarConfigFile"
  | "sessionsFile"
  | "stateDir"
  | "timezone"
  | "proactiveJudgmentApiKey"
  | "proactiveJudgmentEndpoint"
  | "proactiveJudgmentHost"
  | "proactiveJudgmentMinConfidence"
  | "proactiveJudgmentMode"
  | "proactiveJudgmentModel"
  | "proactiveJudgmentTimeoutMs"
  | "workspaceBootstrapConfigFile"
  | "workspaceRoot"
>>;

export interface HostClaimCheckinResult {
  bookkeepingExpectations: HostCheckinBookkeepingExpectation[];
  contextBriefing: HostClaimContextBriefing | null;
  status: HostClaimStatus;
  lease: DelegationLease | null;
  pendingHandoff: HostPendingHandoffSummary | null;
  payload: ClaimedPayload | null;
  proactiveDecision: ProactiveDecision | null;
  origin: PersistedOriginRef | null;
  nextWakeAt: string;
  hostedSync: Record<string, unknown> | null;
}

const HOSTED_CHECKIN_DECISION_ORDER = Object.freeze([
  "先确认我知不知道用户现在在做什么，不知道就优先短问确认。",
  "再判断此刻适不适合发一句短消息；只有明确不该打扰时才沉默。",
  "即使不发消息，也要判断这轮是否该补 timeline / diary / project note / companion memory / review。",
]);

const HOSTED_CHECKIN_BOOKKEEPING_EXPECTATIONS = Object.freeze<HostCheckinBookkeepingExpectation[]>([
  {
    kind: "timeline",
    route: "codeksei timeline event / codeksei diary write --section timeline",
    when: "已经形成明确时间块、切换点或完成块时默认优先记录。",
  },
  {
    kind: "diary",
    route: "codeksei diary write",
    when: "今天的 lived note、todo cutover、补充判断和轻量 closeout 默认写这里。",
  },
  {
    kind: "project_note",
    route: "codeksei project radar --project <slug> --json + codeksei note auto --project <slug>",
    when: "已经知道项目当前状态、最近动作或下一步时，不要只留在聊天里。",
  },
  {
    kind: "companion_memory",
    route: "codeksei companion remember",
    when: "支持偏好、边界、当前状态判断或持续照看方式被纠正时默认写入。",
  },
  {
    kind: "review",
    route: "codeksei review nightly",
    when: "晚间或明显收口时，优先补 nightly closeout。",
  },
]);

export async function claimDelegatedCheckin(
  config: ClaimConfig,
  target: CheckinResolvedTarget,
  provider: string,
): Promise<HostClaimCheckinResult> {
  const firstTick = runCheckinTick({
    config,
    target,
  });
  const contextBoard = tryRefreshContextBoard(config, target, {
    mode: "proactive",
  });
  const contextBriefing = buildContextBriefingSnapshot(contextBoard);

  if (firstTick.status === "scheduled") {
    const hostedSync = syncHostedCheckinIfNeeded(config, target, provider, firstTick);
    return {
      bookkeepingExpectations: [...HOSTED_CHECKIN_BOOKKEEPING_EXPECTATIONS],
      contextBriefing,
      status: "idle",
      lease: null,
      pendingHandoff: buildPendingHandoffSummary(firstTick.state),
      payload: null,
      proactiveDecision: buildIdleProactiveDecision(config, target, contextBoard),
      origin: null,
      nextWakeAt: hostedSync?.plan.jobs[0]?.plannedWakeAt || firstTick.nextWakeAt,
      hostedSync: hostedSync ? {
        plan: hostedSync.plan,
        sync: hostedSync.sync,
      } : null,
    };
  }

  if (firstTick.status === "in_progress") {
    const hostedSync = syncHostedCheckinIfNeeded(config, target, provider, firstTick);
    return {
      bookkeepingExpectations: [...HOSTED_CHECKIN_BOOKKEEPING_EXPECTATIONS],
      contextBriefing,
      status: "in_progress",
      lease: firstTick.activeWake ? buildDelegationLease(firstTick.activeWake.triggerId, firstTick.activeWake.startedAt) : null,
      pendingHandoff: buildPendingHandoffSummary(firstTick.state),
      payload: null,
      proactiveDecision: buildIdleProactiveDecision(config, target, contextBoard),
      origin: buildOriginRef(target),
      nextWakeAt: hostedSync?.plan.jobs[0]?.plannedWakeAt || "",
      hostedSync: hostedSync ? {
        plan: hostedSync.plan,
        sync: hostedSync.sync,
      } : null,
    };
  }

  if (!firstTick.payload?.triggerId) {
    throw new CliError({
      code: "resident_daemon_unavailable",
      exitCode: 1,
      message: "当前没有可 claim 的 proactive trigger。",
      retryable: true,
    });
  }

  let acknowledged;
  try {
    acknowledged = runCheckinTick({
      ack: firstTick.payload.triggerId,
      config,
      target,
    });
  } catch (error) {
    throw new CliError({
      code: "stale_lease",
      exitCode: 1,
      message: error instanceof Error ? error.message : "claim-checkin ack failed",
      retryable: true,
    });
  }

  const hostedSync = provider === "hermes"
    ? syncHostedCheckinPlanViaHermes(config, target, acknowledged)
    : null;
  const proactiveDecision = await buildProactiveDecision(
    config,
    buildProactiveJudgmentInput(config, target, contextBoard, acknowledged),
  );
  return {
    bookkeepingExpectations: [...HOSTED_CHECKIN_BOOKKEEPING_EXPECTATIONS],
    contextBriefing,
    status: "claimed",
    lease: acknowledged.activeWake ? buildDelegationLease(acknowledged.activeWake.triggerId, acknowledged.activeWake.startedAt) : null,
    payload: firstTick.payload ? {
      kind: "proactive_checkin",
      format: "plain_text",
      bookkeepingPriorities: HOSTED_CHECKIN_BOOKKEEPING_EXPECTATIONS.map((entry) => `${entry.kind}: ${entry.when}`),
      decisionOrder: [...HOSTED_CHECKIN_DECISION_ORDER],
      observerContract: "你这轮的目标是重新掌握用户此刻在做什么，并决定短消息、后台写入或沉默。SILENT 只在明确不该打扰时使用。",
      text: firstTick.payload.text,
    } : null,
    pendingHandoff: buildPendingHandoffSummary(acknowledged.state),
    proactiveDecision,
    origin: buildOriginRef(target),
    nextWakeAt: hostedSync?.plan.jobs[0]?.plannedWakeAt || "",
    hostedSync: hostedSync ? {
      plan: hostedSync.plan,
      sync: hostedSync.sync,
      } : null,
  };
}

function syncHostedCheckinIfNeeded(
  config: ClaimConfig,
  target: CheckinResolvedTarget,
  provider: string,
  tick: ReturnType<typeof runCheckinTick>,
) {
  if (provider !== "hermes") {
    return null;
  }
  // A hosted wake can be consumed by Hermes before the child reaches
  // claim-checkin or settle-checkin. Re-syncing even idle/in-progress truth
  // keeps the future wake/recovery/guard chain alive from Codeksei's local
  // scheduler truth instead of assuming the current cron run will finish cleanly.
  return syncHostedCheckinPlanViaHermes(config, target, tick);
}

function buildDelegationLease(triggerId: string, startedAt: string): DelegationLease {
  const claimedAt = startedAt || new Date().toISOString();
  const startedAtMs = Date.parse(claimedAt);
  return {
    id: triggerId,
    triggerId,
    claimedAt,
    expiresAt: Number.isFinite(startedAtMs)
      ? new Date(startedAtMs + CHECKIN_ACTIVE_WAKE_TIMEOUT_MS).toISOString()
      : new Date(Date.now() + CHECKIN_ACTIVE_WAKE_TIMEOUT_MS).toISOString(),
    recoveryOnExpiry: true,
  };
}

function buildOriginRef(target: CheckinResolvedTarget): PersistedOriginRef {
  return {
    channel: "weixin",
    senderId: target.senderId,
    raw: {
      workspaceRoot: target.workspaceRoot,
    },
  };
}

function buildContextBriefingSnapshot(
  briefing: ContextBoardBriefing | null,
): HostClaimContextBriefing | null {
  if (!briefing) {
    return null;
  }
  return {
    briefingText: briefing.briefingText,
    followupContext: briefing.followupContext,
    stale: briefing.stale,
    staleReasons: [...briefing.staleReasons],
  };
}

function buildProactiveJudgmentInput(
  config: ClaimConfig,
  target: CheckinResolvedTarget,
  briefing: ContextBoardBriefing | null,
  tick: ReturnType<typeof runCheckinTick>,
): ProactiveJudgmentInput {
  const targetKey = buildCheckinTargetKey(target);
  return {
    checkin: {
      lastCompletionAt: briefing?.checkin.lastCompletionAt || "",
      lastCompletionResult: briefing?.checkin.lastCompletionResult || "",
      nextWakeAt: tick.nextWakeAt || briefing?.checkin.nextWakeAt || "",
      pendingHandoffExists: Boolean(briefing?.checkin.pendingHandoff.exists),
    },
    contextBriefing: {
      followupContext: briefing?.followupContext || "",
      stale: Boolean(briefing?.stale ?? true),
      staleReasons: briefing?.staleReasons || ["missing_context_board"],
    },
    now: new Date().toISOString(),
    recentOutcomes: readRecentProactiveOutcomes(config, { targetKey }),
    stateCard: briefing?.stateCard || {
      activeThread: "",
      currentLikelyState: "当前判断上下文偏薄，需要先确认用户此刻状态。",
      doNotDo: ["不要假装知道；先轻问确认。"],
      easiestReentryStep: "",
      likelyBlocker: "缺少 context board。",
      sourceThickness: "thin",
      toneHint: "短、自然、先确认。",
    },
    target: {
      senderId: target.senderId,
      targetKey,
      workspaceRoot: target.workspaceRoot,
    },
    timezone: String(config.timezone || ""),
  };
}

function buildIdleProactiveDecision(
  config: ClaimConfig,
  target: CheckinResolvedTarget,
  briefing: ContextBoardBriefing | null,
): ProactiveDecision {
  const targetKey = buildCheckinTargetKey(target);
  const now = new Date().toISOString();
  return {
    backstageActions: [],
    confidence: 1,
    decisionId: `pd_idle_${targetKey.replace(/[^a-zA-Z0-9]+/gu, "_").slice(0, 24)}_${Date.parse(now) || 0}`,
    decisionVersion: 1,
    interventionLevel: "silent",
    kind: "proactive_decision",
    model: {
      fallbackReason: "claim status is not claimed",
      host: "deterministic",
      model: "",
      used: false,
    },
    nextWakePolicy: {
      mode: "keep_existing",
      reason: "当前没有可执行的 proactive lease。",
    },
    outputModality: "silent",
    reasonCode: "no_action",
    shouldSurface: false,
    suggestedMessage: "",
    userVisibleReason: briefing?.stale ? "当前上下文偏薄且没有可执行唤醒。" : "当前没有可执行唤醒。",
  };
}

function buildPendingHandoffSummary(
  state: ReturnType<typeof runCheckinTick>["state"],
): HostPendingHandoffSummary | null {
  const handoff = state.pendingHandoff;
  if (!handoff) {
    return null;
  }
  return {
    bookkeepingActions: handoff.bookkeepingActions.map((entry) => `${entry.kind}:${entry.status}:${entry.summary}`),
    exists: true,
    followupContext: handoff.followupContext,
    handoffCreatedAt: handoff.handoffCreatedAt,
    handoffExpiresAt: handoff.handoffExpiresAt,
    observedCurrentState: handoff.observedCurrentState,
    outcome: handoff.outcome,
    triggerId: handoff.triggerId,
    userVisibleMessage: handoff.userVisibleMessage,
  };
}
