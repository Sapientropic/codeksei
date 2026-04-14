import * as crypto from "node:crypto";

import { readPrefixedEnv } from "../contracts/app-env";
import type { AppRuntimeConfig } from "./app-service-contract";
import { resolvePromptPersonEn } from "./person-reference";
import type { PreferredTargetResolution } from "../workspace/default-targets";
import {
  inspectPreferredSenderId,
  inspectPreferredWorkspaceRoot,
} from "../workspace/default-targets";
import { normalizeText } from "./text-normalization";
import { parseCompactDurationMs } from "./duration";
import type { ResolvedCheckinConfig } from "../state/checkin-config";
import {
  DEFAULT_CHECKIN_MAX_INTERVAL_MS,
  DEFAULT_CHECKIN_MIN_INTERVAL_MS,
  resolveCheckinConfig,
} from "../state/checkin-config";
import type {
  CheckinActiveWake,
  CheckinCompletionResult,
  CheckinLastCompletion,
  CheckinPendingTrigger,
  CheckinScheduleSource,
  CheckinScheduleState,
} from "../contracts/checkin-schedule-state";
import {
  normalizeCheckinCompletionResult,
} from "../contracts/checkin-schedule-state";
import { CheckinScheduleStateStore } from "../state/checkin-schedule-state-store";
import type { SystemMessageQueueLike } from "./app-service-contract";

const INTERNAL_CHECKIN_TRIGGER_TEMPLATE = "Take a quiet look at whether now is a good moment to reach out to %PERSON%. You may stay silent, send one short WeChat message, update diary/timeline, or take another useful backstage action. If no user-visible message should be sent, output exactly SILENT. If you do send a message, output only the message text.";
const CHECKIN_MAX_SILENCE_MS = 24 * 60 * 60_000;
const CHECKIN_ACTIVE_WAKE_TIMEOUT_MS = 30 * 60_000;

interface CheckinSessionStoreLike {
  buildBindingKey(args: { accountId: string; senderId: string; workspaceId: string }): string;
  getActiveWorkspaceRoot(bindingKey: string): string;
  getBinding(bindingKey: string): Record<string, unknown> | null;
  state?: {
    bindings?: Record<string, Record<string, unknown>>;
  };
}

interface CheckinTargetResolutionArgs {
  accountId?: string;
  config: Record<string, unknown>;
  explicitUser?: string;
  explicitWorkspace?: string;
  sessionStore?: CheckinSessionStoreLike | null;
}

interface CheckinTickArgs {
  ack?: string;
  config: Record<string, unknown> & Pick<AppRuntimeConfig, "checkinConfigFile" | "checkinScheduleStateFile">;
  nowMs?: number;
  target: CheckinResolvedTarget;
}

interface CheckinCompleteArgs {
  config: Record<string, unknown> & Pick<AppRuntimeConfig, "checkinConfigFile" | "checkinScheduleStateFile">;
  nextWakeAt?: string;
  nowMs?: number;
  result: CheckinCompletionResult;
  sleepFor?: string;
  target: CheckinResolvedTarget;
  triggerId: string;
}

interface BridgeCheckinPollerIterationArgs {
  accountId: string;
  config: Record<string, unknown> & Pick<AppRuntimeConfig, "checkinConfigFile" | "checkinScheduleStateFile" | "systemMessageDeadLetterFile" | "systemMessageQueueFile">;
  nowMs?: number;
  queueStore: Pick<SystemMessageQueueLike, "enqueue" | "hasPendingForAccount">;
  sessionStore: CheckinSessionStoreLike;
}

export interface CheckinResolvedTarget {
  senderId: string;
  senderSource: string;
  workspaceRoot: string;
  workspaceSource: string;
}

export interface CheckinTargetResolution {
  ok: boolean;
  senderResolution: PreferredTargetResolution;
  value: CheckinResolvedTarget | null;
  workspaceResolution: PreferredTargetResolution;
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

export interface BridgeCheckinPollerIterationResult {
  action: "enqueue_and_ack" | "waiting" | "waiting_for_queue";
  tick: CheckinTickResult;
}

export function buildCheckinTargetResolutionErrorMessage(resolution: CheckinTargetResolution): string {
  if (!resolution.senderResolution.value) {
    return resolution.senderResolution.ambiguous
      ? "checkin target 无法确定唯一 sender；请显式传 --user"
      : "checkin target 缺少可用 sender；请显式传 --user 或设置稳定默认值";
  }
  return resolution.workspaceResolution.ambiguous
    ? "checkin target 无法确定唯一 workspace；请显式传 --workspace"
    : "checkin target 缺少可用 workspace；请显式传 --workspace 或设置稳定默认值";
}

export function buildCheckinTriggerPayload(
  config: Record<string, unknown>,
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
  return {
    createdAt: new Date(nowMs).toISOString(),
    kind: "checkin",
    senderId: target.senderId,
    source: "checkin_trigger",
    text: triggerId
      ? buildScheduledCheckinPrompt(person, target, triggerId)
      : INTERNAL_CHECKIN_TRIGGER_TEMPLATE.replace("%PERSON%", person),
    workspaceRoot: target.workspaceRoot,
  };
}

export function processBridgeCheckinPollerIteration({
  accountId,
  config,
  nowMs = Date.now(),
  queueStore,
  sessionStore,
}: BridgeCheckinPollerIterationArgs): BridgeCheckinPollerIterationResult {
  const resolution = resolveCheckinTarget({
    accountId,
    config,
    explicitUser: readPrefixedEnv(process.env, "CHECKIN_USER_ID") || "",
    explicitWorkspace: readPrefixedEnv(process.env, "CHECKIN_WORKSPACE") || "",
    sessionStore,
  });
  if (!resolution.ok || !resolution.value) {
    throw new Error(buildCheckinTargetResolutionErrorMessage(resolution));
  }

  const tick = runCheckinTick({
    config,
    nowMs,
    target: resolution.value,
  });
  if (!tick.due || !tick.payload) {
    return {
      action: "waiting",
      tick,
    };
  }
  if (queueStore.hasPendingForAccount(accountId)) {
    return {
      action: "waiting_for_queue",
      tick,
    };
  }

  queueStore.enqueue({
    accountId,
    checkinTriggerId: tick.payload.triggerId,
    createdAt: tick.payload.createdAt,
    id: crypto.randomUUID(),
    kind: "checkin",
    senderId: tick.payload.senderId,
    text: tick.payload.text,
    workspaceRoot: tick.payload.workspaceRoot,
  });

  const acked = runCheckinTick({
    ack: tick.payload.triggerId,
    config,
    nowMs,
    target: resolution.value,
  });
  return {
    action: "enqueue_and_ack",
    tick: acked,
  };
}

export function resolveCheckinTarget({
  accountId = "",
  config,
  explicitUser = "",
  explicitWorkspace = "",
  sessionStore = null,
}: CheckinTargetResolutionArgs): CheckinTargetResolution {
  const senderResolution = inspectPreferredSenderId({
    accountId,
    config,
    explicitUser,
    sessionStore,
  });
  const workspaceResolution = inspectCheckinWorkspaceRoot({
    accountId,
    config,
    explicitWorkspace,
    senderId: senderResolution.value,
    sessionStore,
  });

  if (!senderResolution.value || !workspaceResolution.value) {
    return {
      ok: false,
      senderResolution,
      value: null,
      workspaceResolution,
    };
  }

  return {
    ok: true,
    senderResolution,
    value: {
      senderId: senderResolution.value,
      senderSource: senderResolution.source,
      workspaceRoot: workspaceResolution.value,
      workspaceSource: workspaceResolution.source,
    },
    workspaceResolution,
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
  const completion = resolveNextWakeForCompletion({
    currentState,
    intervalConfig,
    nowMs,
    requestedNextWakeAt,
    result,
    triggerId: activeWake.triggerId,
  });
  const nextState = stateStore.setState({
    activeWake: null,
    lastCompletion: completion,
    nextWakeAt: completion.nextWakeAt,
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

function inspectCheckinWorkspaceRoot({
  accountId,
  config,
  explicitWorkspace,
  senderId,
  sessionStore,
}: {
  accountId: string;
  config: Record<string, unknown>;
  explicitWorkspace: string;
  senderId: string;
  sessionStore: CheckinSessionStoreLike | null;
}): PreferredTargetResolution {
  const normalizedExplicitWorkspace = normalizeText(explicitWorkspace);
  if (normalizedExplicitWorkspace) {
    return {
      ambiguous: false,
      candidates: [normalizedExplicitWorkspace],
      reason: "explicit_workspace",
      source: "explicit_workspace",
      value: normalizedExplicitWorkspace,
    };
  }

  const configuredWorkspace = normalizeText(config.workspaceRoot);
  if (configuredWorkspace) {
    return {
      ambiguous: false,
      candidates: [configuredWorkspace],
      reason: "config_workspace_root",
      source: "config.workspaceRoot",
      value: configuredWorkspace,
    };
  }

  return inspectPreferredWorkspaceRoot({
    accountId,
    config: {
      ...config,
      workspaceRoot: "",
    },
    explicitWorkspace: "",
    senderId,
    sessionStore,
  });
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
    pendingTrigger: null,
    scheduleSource,
    senderId: target.senderId,
    targetKey: buildCheckinTargetKey(target),
    updatedAt: new Date(nowMs).toISOString(),
    workspaceRoot: target.workspaceRoot,
  });
}

function setPendingTrigger({
  config,
  currentState,
  dueAt,
  nowMs,
  stateStore,
  target,
}: {
  config: Record<string, unknown>;
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
  triggerId,
}: {
  currentState: CheckinScheduleState;
  intervalConfig: ResolvedCheckinConfig;
  nowMs: number;
  requestedNextWakeAt: string;
  result: CheckinCompletionResult;
  triggerId: string;
}): CheckinLastCompletion {
  const requestedNextWakeAtMs = Date.parse(requestedNextWakeAt);
  const completedAt = new Date(nowMs).toISOString();
  if (!requestedNextWakeAt || !Number.isFinite(requestedNextWakeAtMs) || requestedNextWakeAtMs <= nowMs) {
    return {
      completedAt,
      nextWakeAt: new Date(nowMs + pickRandomDelayMs(intervalConfig.minIntervalMs, intervalConfig.maxIntervalMs)).toISOString(),
      result,
      scheduleSource: "fallback",
      triggerId,
    };
  }
  if (requestedNextWakeAtMs > nowMs + CHECKIN_MAX_SILENCE_MS) {
    return {
      completedAt,
      nextWakeAt: new Date(nowMs + CHECKIN_MAX_SILENCE_MS).toISOString(),
      result,
      scheduleSource: "guardrail_clamped",
      triggerId,
    };
  }
  return {
    completedAt,
    nextWakeAt: requestedNextWakeAt,
    result,
    scheduleSource: "agent",
    triggerId,
  };
}

function resolveLastWakeAnchorMs(state: CheckinScheduleState): number {
  const candidates = [
    state.lastCompletion?.completedAt,
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
  person: string,
  target: CheckinResolvedTarget,
  triggerId: string,
): string {
  const quotedWorkspace = JSON.stringify(target.workspaceRoot);
  const quotedSender = JSON.stringify(target.senderId);
  return [
    INTERNAL_CHECKIN_TRIGGER_TEMPLATE.replace("%PERSON%", person),
    "",
    `Trigger id: ${triggerId}`,
    "After this proactive pass, you must decide when Codeksei should wake next and record it with exactly one completion command.",
    "Use result=sent_message only if you actually sent a user-visible message.",
    "Use result=silent when you intentionally stayed silent.",
    "Use result=backstage_only when you only did backstage work such as diary/timeline/reminder or other internal housekeeping.",
    "",
    "Completion command example:",
    `codeksei --workspace-root ${quotedWorkspace} system checkin-complete --user ${quotedSender} --workspace ${quotedWorkspace} --trigger ${triggerId} --result silent --sleep-for 6h`,
    "You may replace --sleep-for with --next-wake-at 2026-04-15T09:00:00+08:00 if you want an exact wake time.",
  ].join("\n");
}

export function buildCheckinTargetKey(target: Pick<CheckinResolvedTarget, "senderId" | "workspaceRoot">): string {
  return `${target.senderId}::${target.workspaceRoot}`;
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
