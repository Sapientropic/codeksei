import * as crypto from "node:crypto";

import type { AppRuntimeConfig } from "../core/app-service-contract";
import { parseCompactDurationMs } from "../core/duration";
import type {
  CheckinActiveWake,
  CheckinBookkeepingAction,
  CheckinCompletionResult,
  CheckinLastCompletion,
  CheckinPendingHandoff,
  CheckinPendingTrigger,
  CheckinScheduleSource,
  CheckinScheduleState,
} from "../contracts/checkin-schedule-state";
import {
  normalizeCheckinCompletionResult,
} from "../contracts/checkin-schedule-state";
import { resolvePromptPersonEn } from "../contracts/person-reference";
import { normalizeText } from "../contracts/text-normalization";
import {
  buildCheckinCompletionDurationGuidanceLines,
  CHECKIN_COMPLETION_CONTEXT_GUIDANCE,
  CHECKIN_COMPLETION_SLEEP_FOR_PLACEHOLDER,
} from "./completion-guidance";
import type { ResolvedCheckinConfig } from "../state/checkin-config";
import {
  DEFAULT_CHECKIN_MAX_INTERVAL_MS,
  DEFAULT_CHECKIN_MIN_INTERVAL_MS,
  resolveCheckinConfig,
} from "../state/checkin-config";
import { CheckinScheduleStateStore } from "../state/checkin-schedule-state-store";
import {
  buildCheckinTargetKey,
  type CheckinResolvedTarget,
} from "./target-resolution";
import {
  buildOnboardingCheckinPrompt,
  createOnboardingStateStore,
} from "../onboarding/state";
import { resolveCompanionProfileSignals } from "../companion-memory/profile-signals";
import { normalizeCompanionProfileLanguage } from "../companion-memory/profile-signal-contracts";

const INTERNAL_CHECKIN_TRIGGER_TEMPLATE = "Take a quiet look at whether now is a good moment to reach out to %PERSON%. You may stay silent, send one short WeChat message, update diary/timeline, or take another useful backstage action. If no user-visible message should be sent, output exactly SILENT. If you do send a message, output only the message text.";
const CHECKIN_MAX_SILENCE_MS = 24 * 60 * 60_000;
export const CHECKIN_ACTIVE_WAKE_TIMEOUT_MS = 30 * 60_000;
export const CHECKIN_HANDOFF_TIMEOUT_MS = 12 * 60 * 60_000;

type CheckinTickConfig = Pick<AppRuntimeConfig, "checkinConfigFile" | "checkinScheduleStateFile"> & Partial<Pick<AppRuntimeConfig, "stateDir" | "userName">>;

interface CheckinTickArgs {
  ack?: string;
  config: CheckinTickConfig;
  nowMs?: number;
  target: CheckinResolvedTarget;
}

interface CheckinCompleteArgs {
  config: CheckinTickConfig;
  nextWakeAt?: string;
  nowMs?: number;
  result: CheckinCompletionResult;
  sleepFor?: string;
  target: CheckinResolvedTarget;
  triggerId: string;
}

interface CheckinCreateHandoffArgs {
  bookkeepingActions?: CheckinBookkeepingAction[];
  config: CheckinTickConfig;
  followupContext?: string;
  handoffTimeoutMs?: number;
  nowMs?: number;
  observedCurrentState?: string;
  result: CheckinCompletionResult;
  target: CheckinResolvedTarget;
  triggerId: string;
  userVisibleMessage?: string;
}

interface CheckinFinalizeHandoffArgs {
  config: CheckinTickConfig;
  nextWakeAt?: string;
  nowMs?: number;
  result?: CheckinCompletionResult;
  sleepFor?: string;
  target: CheckinResolvedTarget;
  triggerId: string;
}

export interface CheckinTriggerPayload {
  createdAt: string;
  kind: "checkin";
  senderId: string;
  source: "checkin_trigger";
  text: string;
  workspaceRoot: string;
}

export type CheckinTickStatus = "due" | "in_progress" | "scheduled";

export interface CheckinTickResult {
  acknowledged: boolean;
  activeWake: CheckinActiveWake | null;
  due: boolean;
  intervalConfig: ResolvedCheckinConfig;
  nextDueAt: string;
  nextWakeAt: string;
  payload: CheckinPendingTrigger | null;
  state: CheckinScheduleState;
  status: CheckinTickStatus;
  target: CheckinResolvedTarget;
}

export interface CheckinCompleteResult {
  completion: CheckinLastCompletion;
  intervalConfig: ResolvedCheckinConfig;
  nextDueAt: string;
  nextWakeAt: string;
  state: CheckinScheduleState;
  target: CheckinResolvedTarget;
}

export interface CheckinCreateHandoffResult {
  handoff: CheckinPendingHandoff;
  intervalConfig: ResolvedCheckinConfig;
  state: CheckinScheduleState;
  target: CheckinResolvedTarget;
}

export interface CheckinScheduledWakeResult {
  intervalConfig: ResolvedCheckinConfig;
  nextDueAt: string;
  nextWakeAt: string;
  scheduleSource: CheckinScheduleSource;
  state: CheckinScheduleState;
  target: CheckinResolvedTarget;
}

export function buildCheckinTriggerPayload(
  config: Partial<Pick<
    AppRuntimeConfig,
    "allowedUserIds" | "durableNoteSchemaConfigFile" | "stateDir" | "userGender" | "userLanguage" | "userName" | "workspaceRoot"
  >>,
  target: CheckinResolvedTarget,
  {
    nowMs = Date.now(),
    triggerId = "",
  }: {
    nowMs?: number;
    triggerId?: string;
  } = {},
): CheckinTriggerPayload {
  const person = resolvePromptPersonEn(config);
  const onboardingPrompt = resolveOnboardingPrompt(config, target.senderId);
  const basePrompt = onboardingPrompt || INTERNAL_CHECKIN_TRIGGER_TEMPLATE.replace("%PERSON%", person);
  return {
    createdAt: new Date(nowMs).toISOString(),
    kind: "checkin",
    senderId: target.senderId,
    source: "checkin_trigger",
    text: triggerId
      ? buildScheduledCheckinPrompt(basePrompt, target, triggerId)
      : basePrompt,
    workspaceRoot: target.workspaceRoot,
  };
}

export function runCheckinTick({
  ack = "",
  config,
  nowMs = Date.now(),
  target,
}: CheckinTickArgs): CheckinTickResult {
  const intervalConfig = resolveCheckinIntervalConfig(config);
  const stateStore = new CheckinScheduleStateStore({
    filePath: resolveCheckinScheduleStateFile(config),
  });
  const normalizedAck = normalizeText(ack);
  const currentState = resolveOperationalCheckinStateForTarget({
    intervalConfig,
    nowMs,
    stateStore,
    target,
  });

  if (normalizedAck) {
    const pending = currentState.pendingTrigger;
    if (!pending) {
      throw new Error("checkin tick 当前没有可确认的 pending trigger");
    }
    if (pending.triggerId !== normalizedAck) {
      throw new Error(`checkin tick ack 不匹配当前 pending trigger: ${normalizedAck}`);
    }
    const nextState = activatePendingTrigger({
      currentState,
      nowMs,
      stateStore,
      target,
    });
    return buildTickResult({
      acknowledged: true,
      due: false,
      intervalConfig,
      payload: null,
      state: nextState,
      status: "in_progress",
      target,
    });
  }

  if (currentState.activeWake) {
    return buildTickResult({
      acknowledged: false,
      due: false,
      intervalConfig,
      payload: null,
      state: currentState,
      status: "in_progress",
      target,
    });
  }

  if (currentState.pendingHandoff) {
    return buildTickResult({
      acknowledged: false,
      due: false,
      intervalConfig,
      payload: null,
      state: currentState,
      status: "scheduled",
      target,
    });
  }

  if (currentState.pendingTrigger) {
    return buildTickResult({
      acknowledged: false,
      due: true,
      intervalConfig,
      payload: currentState.pendingTrigger,
      state: currentState,
      status: "due",
      target,
    });
  }

  if (!currentState.nextWakeAt) {
    const nextState = scheduleFallbackCheckin({
      currentState,
      intervalConfig,
      nowMs,
      scheduleSource: "fallback",
      stateStore,
      target,
    });
    return buildTickResult({
      acknowledged: false,
      due: false,
      intervalConfig,
      payload: null,
      state: nextState,
      status: "scheduled",
      target,
    });
  }

  if (Date.parse(currentState.nextWakeAt) > nowMs) {
    return buildTickResult({
      acknowledged: false,
      due: false,
      intervalConfig,
      payload: null,
      state: currentState,
      status: "scheduled",
      target,
    });
  }

  const dueState = setPendingTrigger({
    config,
    currentState,
    dueAt: currentState.nextWakeAt,
    nowMs,
    stateStore,
    target,
  });
  return buildTickResult({
    acknowledged: false,
    due: true,
    intervalConfig,
    payload: dueState.pendingTrigger,
    state: dueState,
    status: "due",
    target,
  });
}

export function runCheckinComplete({
  config,
  nextWakeAt = "",
  nowMs = Date.now(),
  result,
  sleepFor = "",
  target,
  triggerId,
}: CheckinCompleteArgs): CheckinCompleteResult {
  const intervalConfig = resolveCheckinIntervalConfig(config);
  const stateStore = new CheckinScheduleStateStore({
    filePath: resolveCheckinScheduleStateFile(config),
  });
  const currentState = resolveOperationalCheckinStateForTarget({
    intervalConfig,
    nowMs,
    stateStore,
    target,
  });
  const activeWake = currentState.activeWake;
  if (!activeWake) {
    throw new Error("checkin complete 当前没有处于进行中的 active wake");
  }
  if (activeWake.triggerId !== normalizeText(triggerId)) {
    throw new Error(`checkin complete trigger 不匹配当前 active wake: ${normalizeText(triggerId)}`);
  }

  const requestedNextWakeAt = resolveRequestedNextWakeAt({
    nextWakeAt,
    nowMs,
    sleepFor,
  });
  return persistCheckinCompletion({
    currentState,
    intervalConfig,
    nowMs,
    requestedNextWakeAt,
    result,
    stateStore,
    target,
    triggerId: activeWake.triggerId,
  });
}

export function runCheckinCreateHandoff({
  bookkeepingActions = [],
  config,
  followupContext = "",
  handoffTimeoutMs = CHECKIN_HANDOFF_TIMEOUT_MS,
  nowMs = Date.now(),
  observedCurrentState = "",
  result,
  target,
  triggerId,
  userVisibleMessage = "",
}: CheckinCreateHandoffArgs): CheckinCreateHandoffResult {
  const intervalConfig = resolveCheckinIntervalConfig(config);
  const stateStore = new CheckinScheduleStateStore({
    filePath: resolveCheckinScheduleStateFile(config),
  });
  const currentState = resolveOperationalCheckinStateForTarget({
    intervalConfig,
    nowMs,
    stateStore,
    target,
  });
  const activeWake = currentState.activeWake;
  if (!activeWake) {
    throw new Error("checkin handoff 当前没有处于进行中的 active wake");
  }
  if (activeWake.triggerId !== normalizeText(triggerId)) {
    throw new Error(`checkin handoff trigger 不匹配当前 active wake: ${normalizeText(triggerId)}`);
  }
  const handoff = buildPendingHandoff({
    bookkeepingActions,
    followupContext,
    handoffTimeoutMs,
    nowMs,
    observedCurrentState,
    result,
    triggerId: activeWake.triggerId,
    userVisibleMessage,
  });
  const nextState = stateStore.setState({
    activeWake: null,
    lastCompletion: currentState.lastCompletion,
    nextWakeAt: "",
    pendingHandoff: handoff,
    pendingTrigger: null,
    scheduleSource: currentState.scheduleSource,
    senderId: target.senderId,
    targetKey: buildCheckinTargetKey(target),
    updatedAt: new Date(nowMs).toISOString(),
    workspaceRoot: target.workspaceRoot,
  });
  return {
    handoff,
    intervalConfig,
    state: nextState,
    target,
  };
}

export function runCheckinFinalizeHandoff({
  config,
  nextWakeAt = "",
  nowMs = Date.now(),
  result,
  sleepFor = "",
  target,
  triggerId,
}: CheckinFinalizeHandoffArgs): CheckinCompleteResult {
  const intervalConfig = resolveCheckinIntervalConfig(config);
  const stateStore = new CheckinScheduleStateStore({
    filePath: resolveCheckinScheduleStateFile(config),
  });
  const currentState = resolveOperationalCheckinStateForTarget({
    intervalConfig,
    nowMs,
    stateStore,
    target,
  });
  const pendingHandoff = currentState.pendingHandoff;
  if (!pendingHandoff) {
    throw new Error("checkin finalize 当前没有待主会话接管的 proactive handoff");
  }
  if (pendingHandoff.triggerId !== normalizeText(triggerId)) {
    throw new Error(`checkin finalize trigger 不匹配当前 pending handoff: ${normalizeText(triggerId)}`);
  }
  const requestedNextWakeAt = resolveRequestedNextWakeAt({
    nextWakeAt,
    nowMs,
    sleepFor,
  });
  return persistCheckinCompletion({
    currentState,
    intervalConfig,
    nowMs,
    requestedNextWakeAt,
    result: result || pendingHandoff.outcome,
    stateStore,
    target,
    triggerId: pendingHandoff.triggerId,
  });
}

export function runCheckinScheduleNextWake({
  config,
  nextWakeAt,
  nowMs = Date.now(),
  target,
}: {
  config: CheckinTickConfig;
  nextWakeAt: string;
  nowMs?: number;
  target: CheckinResolvedTarget;
}): CheckinScheduledWakeResult {
  const intervalConfig = resolveCheckinIntervalConfig(config);
  const stateStore = new CheckinScheduleStateStore({
    filePath: resolveCheckinScheduleStateFile(config),
  });
  const currentState = resolveOperationalCheckinStateForTarget({
    intervalConfig,
    nowMs,
    stateStore,
    target,
  });
  const normalizedNextWakeAt = normalizeText(nextWakeAt);
  const requestedNextWakeAt = resolveRequestedNextWakeAt({
    nextWakeAt: normalizedNextWakeAt,
    nowMs,
    sleepFor: "",
  });
  const requestedNextWakeAtMs = Date.parse(requestedNextWakeAt);
  if (!requestedNextWakeAt || !Number.isFinite(requestedNextWakeAtMs)) {
    throw new Error(`非法的 nextWakeAt：${normalizedNextWakeAt || "(empty)"}`);
  }
  if (requestedNextWakeAtMs <= nowMs) {
    throw new Error("nextWakeAt 必须晚于当前时间");
  }
  const scheduleSource: CheckinScheduleSource = requestedNextWakeAtMs > nowMs + CHECKIN_MAX_SILENCE_MS
    ? "guardrail_clamped"
    : "agent";
  const recordedNextWakeAt = scheduleSource === "guardrail_clamped"
    ? new Date(nowMs + CHECKIN_MAX_SILENCE_MS).toISOString()
    : requestedNextWakeAt;
  const nextState = stateStore.setState({
    activeWake: null,
    lastCompletion: currentState.lastCompletion,
    nextWakeAt: recordedNextWakeAt,
    pendingHandoff: null,
    pendingTrigger: null,
    scheduleSource,
    senderId: target.senderId,
    targetKey: buildCheckinTargetKey(target),
    updatedAt: new Date(nowMs).toISOString(),
    workspaceRoot: target.workspaceRoot,
  });
  return {
    intervalConfig,
    nextDueAt: recordedNextWakeAt,
    nextWakeAt: recordedNextWakeAt,
    scheduleSource,
    state: nextState,
    target,
  };
}

function resolveCheckinIntervalConfig(config: Pick<AppRuntimeConfig, "checkinConfigFile">): ResolvedCheckinConfig {
  const filePath = normalizeText(config.checkinConfigFile);
  if (filePath) {
    return resolveCheckinConfig({ filePath });
  }
  return {
    maxIntervalMs: DEFAULT_CHECKIN_MAX_INTERVAL_MS,
    minIntervalMs: DEFAULT_CHECKIN_MIN_INTERVAL_MS,
    source: "default",
    storedConfig: null,
  };
}

function resolveCheckinScheduleStateFile(config: Pick<AppRuntimeConfig, "checkinScheduleStateFile">): string {
  const filePath = normalizeText(config.checkinScheduleStateFile);
  if (!filePath) {
    throw new Error("当前未配置 checkin schedule state file");
  }
  return filePath;
}

function resolveOperationalCheckinStateForTarget({
  intervalConfig,
  nowMs,
  stateStore,
  target,
}: {
  intervalConfig: ResolvedCheckinConfig;
  nowMs: number;
  stateStore: CheckinScheduleStateStore;
  target: CheckinResolvedTarget;
}): CheckinScheduleState {
  const state = resolveCheckinScheduleStateForTarget({
    nowMs,
    stateStore,
    target,
  });
  const pendingHandoff = state.pendingHandoff;
  if (pendingHandoff) {
    const handoffExpiresAtMs = Date.parse(pendingHandoff.handoffExpiresAt);
    if (Number.isFinite(handoffExpiresAtMs) && handoffExpiresAtMs <= nowMs) {
      return persistCheckinCompletion({
        currentState: state,
        intervalConfig,
        nowMs,
        requestedNextWakeAt: "",
        result: pendingHandoff.outcome,
        scheduleSourceOverride: "recovery",
        stateStore,
        target,
        triggerId: pendingHandoff.triggerId,
      }).state;
    }
    if (state.activeWake) {
      return stateStore.setState({
        ...state,
        activeWake: null,
        updatedAt: new Date(nowMs).toISOString(),
      });
    }
    return state;
  }
  const activeWake = state.activeWake;
  if (activeWake) {
    const startedAtMs = Date.parse(activeWake.startedAt);
    if (startedAtMs > 0 && startedAtMs + CHECKIN_ACTIVE_WAKE_TIMEOUT_MS <= nowMs) {
      return scheduleFallbackCheckin({
        currentState: state,
        intervalConfig,
        nowMs,
        scheduleSource: "recovery",
        stateStore,
        target,
      });
    }
  }

  if (state.nextWakeAt) {
    const nextWakeAtMs = Date.parse(state.nextWakeAt);
    if (Number.isFinite(nextWakeAtMs) && nextWakeAtMs > nowMs + CHECKIN_MAX_SILENCE_MS) {
      return stateStore.setState({
        ...state,
        nextWakeAt: new Date(nowMs + CHECKIN_MAX_SILENCE_MS).toISOString(),
        scheduleSource: "guardrail_clamped",
        updatedAt: new Date(nowMs).toISOString(),
      });
    }
  }

  if (!state.activeWake && !state.pendingTrigger && !state.nextWakeAt) {
    const lastWakeAnchorMs = resolveLastWakeAnchorMs(state);
    if (lastWakeAnchorMs > 0 && lastWakeAnchorMs + CHECKIN_MAX_SILENCE_MS <= nowMs) {
      return scheduleFallbackCheckin({
        currentState: state,
        intervalConfig,
        nowMs,
        scheduleSource: "recovery",
        stateStore,
        target,
      });
    }
  }

  return state;
}

function resolveCheckinScheduleStateForTarget({
  nowMs,
  stateStore,
  target,
}: {
  nowMs: number;
  stateStore: CheckinScheduleStateStore;
  target: CheckinResolvedTarget;
}): CheckinScheduleState {
  const targetKey = buildCheckinTargetKey(target);
  const existing = stateStore.getState();
  if (existing && existing.targetKey === targetKey && existing.senderId === target.senderId && existing.workspaceRoot === target.workspaceRoot) {
    return existing;
  }
  const nextState: CheckinScheduleState = {
    activeWake: null,
    lastCompletion: null,
    nextWakeAt: "",
    pendingHandoff: null,
    pendingTrigger: null,
    scheduleSource: "fallback",
    senderId: target.senderId,
    targetKey,
    updatedAt: new Date(nowMs).toISOString(),
    workspaceRoot: target.workspaceRoot,
  };
  return stateStore.setState(nextState);
}

function scheduleFallbackCheckin({
  currentState,
  intervalConfig,
  nowMs,
  scheduleSource,
  stateStore,
  target,
}: {
  currentState: CheckinScheduleState;
  intervalConfig: ResolvedCheckinConfig;
  nowMs: number;
  scheduleSource: Extract<CheckinScheduleSource, "fallback" | "recovery">;
  stateStore: CheckinScheduleStateStore;
  target: CheckinResolvedTarget;
}): CheckinScheduleState {
  const nextWakeAt = new Date(nowMs + pickRandomDelayMs(intervalConfig.minIntervalMs, intervalConfig.maxIntervalMs)).toISOString();
  return stateStore.setState({
    activeWake: null,
    lastCompletion: currentState.lastCompletion,
    nextWakeAt,
    pendingHandoff: null,
    pendingTrigger: null,
    scheduleSource,
    senderId: target.senderId,
    targetKey: buildCheckinTargetKey(target),
    updatedAt: new Date(nowMs).toISOString(),
    workspaceRoot: target.workspaceRoot,
  });
}

function persistCheckinCompletion({
  currentState,
  intervalConfig,
  nowMs,
  requestedNextWakeAt,
  result,
  scheduleSourceOverride,
  stateStore,
  target,
  triggerId,
}: {
  currentState: CheckinScheduleState;
  intervalConfig: ResolvedCheckinConfig;
  nowMs: number;
  requestedNextWakeAt: string;
  result: CheckinCompletionResult;
  scheduleSourceOverride?: CheckinScheduleSource;
  stateStore: CheckinScheduleStateStore;
  target: CheckinResolvedTarget;
  triggerId: string;
}): CheckinCompleteResult {
  const completion = resolveNextWakeForCompletion({
    currentState,
    intervalConfig,
    nowMs,
    requestedNextWakeAt,
    result,
    triggerId,
    ...(scheduleSourceOverride ? { scheduleSourceOverride } : {}),
  });
  const nextState = stateStore.setState({
    activeWake: null,
    lastCompletion: completion,
    nextWakeAt: completion.nextWakeAt,
    pendingHandoff: null,
    pendingTrigger: null,
    scheduleSource: completion.scheduleSource,
    senderId: target.senderId,
    targetKey: buildCheckinTargetKey(target),
    updatedAt: new Date(nowMs).toISOString(),
    workspaceRoot: target.workspaceRoot,
  });
  return {
    completion,
    intervalConfig,
    nextDueAt: completion.nextWakeAt,
    nextWakeAt: completion.nextWakeAt,
    state: nextState,
    target,
  };
}

function buildPendingHandoff({
  bookkeepingActions,
  followupContext,
  handoffTimeoutMs,
  nowMs,
  observedCurrentState,
  result,
  triggerId,
  userVisibleMessage,
}: {
  bookkeepingActions: CheckinBookkeepingAction[];
  followupContext: string;
  handoffTimeoutMs: number;
  nowMs: number;
  observedCurrentState: string;
  result: CheckinCompletionResult;
  triggerId: string;
  userVisibleMessage: string;
}): CheckinPendingHandoff {
  const handoffCreatedAt = new Date(nowMs).toISOString();
  return {
    bookkeepingActions: bookkeepingActions
      .map((entry) => ({
        kind: entry.kind,
        status: entry.status,
        summary: normalizeText(entry.summary),
      }))
      .filter((entry) => entry.summary),
    followupContext: normalizeText(followupContext),
    handoffCreatedAt,
    handoffExpiresAt: new Date(nowMs + Math.max(handoffTimeoutMs, 60_000)).toISOString(),
    observedCurrentState: normalizeText(observedCurrentState),
    outcome: result,
    triggerId,
    userVisibleMessage: normalizeText(userVisibleMessage),
  };
}

function setPendingTrigger({
  config,
  currentState,
  dueAt,
  nowMs,
  stateStore,
  target,
}: {
  config: Partial<Pick<AppRuntimeConfig, "userName">>;
  currentState: CheckinScheduleState;
  dueAt: string;
  nowMs: number;
  stateStore: CheckinScheduleStateStore;
  target: CheckinResolvedTarget;
}): CheckinScheduleState {
  const triggerId = crypto.randomUUID();
  const payload = buildCheckinTriggerPayload(config, target, { nowMs, triggerId });
  return stateStore.setState({
    activeWake: null,
    lastCompletion: currentState.lastCompletion,
    nextWakeAt: "",
    pendingHandoff: null,
    pendingTrigger: {
      ...payload,
      dueAt,
      triggerId,
    },
    scheduleSource: currentState.scheduleSource,
    senderId: target.senderId,
    targetKey: buildCheckinTargetKey(target),
    updatedAt: new Date(nowMs).toISOString(),
    workspaceRoot: target.workspaceRoot,
  });
}

function activatePendingTrigger({
  currentState,
  nowMs,
  stateStore,
  target,
}: {
  currentState: CheckinScheduleState;
  nowMs: number;
  stateStore: CheckinScheduleStateStore;
  target: CheckinResolvedTarget;
}): CheckinScheduleState {
  const pendingTrigger = currentState.pendingTrigger;
  if (!pendingTrigger) {
    throw new Error("checkin tick 当前没有可确认的 pending trigger");
  }
  return stateStore.setState({
    activeWake: {
      ...pendingTrigger,
      startedAt: new Date(nowMs).toISOString(),
    },
    lastCompletion: currentState.lastCompletion,
    nextWakeAt: "",
    pendingHandoff: null,
    pendingTrigger: null,
    scheduleSource: currentState.scheduleSource,
    senderId: target.senderId,
    targetKey: buildCheckinTargetKey(target),
    updatedAt: new Date(nowMs).toISOString(),
    workspaceRoot: target.workspaceRoot,
  });
}

function resolveRequestedNextWakeAt({
  nextWakeAt,
  nowMs,
  sleepFor,
}: {
  nextWakeAt: string;
  nowMs: number;
  sleepFor: string;
}): string {
  const normalizedNextWakeAt = normalizeText(nextWakeAt);
  const normalizedSleepFor = normalizeText(sleepFor);
  if (normalizedNextWakeAt && normalizedSleepFor) {
    throw new Error("checkin complete 不能同时传 --next-wake-at 和 --sleep-for");
  }
  if (!normalizedNextWakeAt && !normalizedSleepFor) {
    return "";
  }
  if (normalizedNextWakeAt) {
    const parsed = Date.parse(normalizedNextWakeAt);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
  }
  const durationMs = parseCompactDurationMs(normalizedSleepFor);
  if (!durationMs) {
    return "";
  }
  return new Date(nowMs + durationMs).toISOString();
}

function resolveNextWakeForCompletion({
  currentState,
  intervalConfig,
  nowMs,
  requestedNextWakeAt,
  result,
  scheduleSourceOverride,
  triggerId,
}: {
  currentState: CheckinScheduleState;
  intervalConfig: ResolvedCheckinConfig;
  nowMs: number;
  requestedNextWakeAt: string;
  result: CheckinCompletionResult;
  scheduleSourceOverride?: CheckinScheduleSource;
  triggerId: string;
}): CheckinLastCompletion {
  const requestedNextWakeAtMs = Date.parse(requestedNextWakeAt);
  const completedAt = new Date(nowMs).toISOString();
  if (!requestedNextWakeAt || !Number.isFinite(requestedNextWakeAtMs) || requestedNextWakeAtMs <= nowMs) {
    return {
      completedAt,
      nextWakeAt: new Date(nowMs + pickRandomDelayMs(intervalConfig.minIntervalMs, intervalConfig.maxIntervalMs)).toISOString(),
      result,
      scheduleSource: scheduleSourceOverride || "fallback",
      triggerId,
    };
  }
  if (requestedNextWakeAtMs > nowMs + CHECKIN_MAX_SILENCE_MS) {
    return {
      completedAt,
      nextWakeAt: new Date(nowMs + CHECKIN_MAX_SILENCE_MS).toISOString(),
      result,
      scheduleSource: scheduleSourceOverride || "guardrail_clamped",
      triggerId,
    };
  }
  return {
    completedAt,
    nextWakeAt: requestedNextWakeAt,
    result,
    scheduleSource: scheduleSourceOverride || "agent",
    triggerId,
  };
}

function resolveLastWakeAnchorMs(state: CheckinScheduleState): number {
  const candidates = [
    state.lastCompletion?.completedAt,
    state.pendingHandoff?.handoffCreatedAt,
    state.activeWake?.startedAt,
    state.pendingTrigger?.createdAt,
    state.updatedAt,
  ];
  for (const candidate of candidates) {
    const parsed = Date.parse(normalizeText(candidate));
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

function buildTickResult({
  acknowledged,
  due,
  intervalConfig,
  payload,
  state,
  status,
  target,
}: {
  acknowledged: boolean;
  due: boolean;
  intervalConfig: ResolvedCheckinConfig;
  payload: CheckinPendingTrigger | null;
  state: CheckinScheduleState;
  status: CheckinTickStatus;
  target: CheckinResolvedTarget;
}): CheckinTickResult {
  return {
    acknowledged,
    activeWake: state.activeWake,
    due,
    intervalConfig,
    nextDueAt: state.nextWakeAt,
    nextWakeAt: state.nextWakeAt,
    payload,
    state,
    status,
    target,
  };
}

function buildScheduledCheckinPrompt(
  leadPrompt: string,
  target: CheckinResolvedTarget,
  triggerId: string,
): string {
  const quotedWorkspace = JSON.stringify(target.workspaceRoot);
  const quotedSender = JSON.stringify(target.senderId);
  return [
    leadPrompt,
    "",
    `Trigger id: ${triggerId}`,
    "After this proactive pass, you must decide when Codeksei should wake next and record it with exactly one completion command.",
    CHECKIN_COMPLETION_CONTEXT_GUIDANCE,
    ...buildCheckinCompletionDurationGuidanceLines(),
    "Use result=sent_message only if you actually sent a user-visible message.",
    "Use result=silent when you intentionally stayed silent.",
    "Use result=backstage_only when you only did backstage work such as diary/timeline/reminder or other internal housekeeping.",
    "",
    "Completion command example:",
    `codeksei --workspace-root ${quotedWorkspace} system checkin-complete --user ${quotedSender} --workspace ${quotedWorkspace} --trigger ${triggerId} --result silent --sleep-for ${CHECKIN_COMPLETION_SLEEP_FOR_PLACEHOLDER}`,
    "You may replace --sleep-for with --next-wake-at 2026-04-15T09:00:00+08:00 if you want an exact wake time.",
  ].join("\n");
}

function resolveOnboardingPrompt(
  config: Partial<Pick<AppRuntimeConfig, "allowedUserIds" | "durableNoteSchemaConfigFile" | "stateDir" | "userGender" | "userLanguage" | "workspaceRoot">>,
  senderId: string,
): string {
  try {
    if (!normalizeText(config.stateDir)) {
      return "";
    }
    const state = createOnboardingStateStore(config, senderId).getState();
    const signals = resolveCompanionProfileSignals(config, senderId);
    return buildOnboardingCheckinPrompt(
      state,
      normalizeCompanionProfileLanguage(signals.preferredLanguage || config.userLanguage) || "zh-CN",
    );
  } catch {
    return "";
  }
}

export function pickRandomDelayMs(minIntervalMs: number, maxIntervalMs: number): number {
  if (maxIntervalMs <= minIntervalMs) {
    return minIntervalMs;
  }
  return minIntervalMs + Math.floor(Math.random() * (maxIntervalMs - minIntervalMs + 1));
}

export function normalizeCheckinCompleteResult(value: unknown): CheckinCompletionResult | "" {
  return normalizeCheckinCompletionResult(value);
}
