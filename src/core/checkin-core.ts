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
import type { ResolvedCheckinConfig } from "../state/checkin-config";
import { resolveCheckinConfig } from "../state/checkin-config";
import type { CheckinPendingTrigger, CheckinScheduleState } from "../contracts/checkin-schedule-state";
import { CheckinScheduleStateStore } from "../state/checkin-schedule-state-store";
import type { SystemMessageQueueLike } from "./app-service-contract";

const INTERNAL_CHECKIN_TRIGGER_TEMPLATE = "Take a quiet look at whether now is a good moment to reach out to %PERSON%. You may stay silent, send one short WeChat message, update diary/timeline, or take another useful backstage action. If no user-visible message should be sent, output exactly SILENT. If you do send a message, output only the message text.";

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

export interface CheckinTickResult {
  acknowledged: boolean;
  due: boolean;
  intervalConfig: ResolvedCheckinConfig;
  nextDueAt: string;
  payload: CheckinPendingTrigger | null;
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
  { nowMs = Date.now() }: { nowMs?: number } = {},
): CheckinTriggerPayload {
  const person = resolvePromptPersonEn(config);
  return {
    createdAt: new Date(nowMs).toISOString(),
    kind: "checkin",
    senderId: target.senderId,
    source: "checkin_trigger",
    text: INTERNAL_CHECKIN_TRIGGER_TEMPLATE.replace("%PERSON%", person),
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
  const currentState = resolveCheckinScheduleStateForTarget({
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
    const nextState = scheduleNextCheckin({
      intervalConfig,
      lastConfirmedAt: new Date(nowMs).toISOString(),
      nowMs,
      stateStore,
      target,
    });
    return {
      acknowledged: true,
      due: false,
      intervalConfig,
      nextDueAt: nextState.nextDueAt,
      payload: null,
      state: nextState,
      target,
    };
  }

  if (currentState.pendingTrigger) {
    return {
      acknowledged: false,
      due: true,
      intervalConfig,
      nextDueAt: "",
      payload: currentState.pendingTrigger,
      state: currentState,
      target,
    };
  }

  if (!currentState.nextDueAt) {
    const nextState = scheduleNextCheckin({
      intervalConfig,
      lastConfirmedAt: currentState.lastConfirmedAt,
      nowMs,
      stateStore,
      target,
    });
    return {
      acknowledged: false,
      due: false,
      intervalConfig,
      nextDueAt: nextState.nextDueAt,
      payload: null,
      state: nextState,
      target,
    };
  }

  if (Date.parse(currentState.nextDueAt) > nowMs) {
    return {
      acknowledged: false,
      due: false,
      intervalConfig,
      nextDueAt: currentState.nextDueAt,
      payload: null,
      state: currentState,
      target,
    };
  }

  const dueState = setPendingTrigger({
    config,
    nowMs,
    stateStore,
    target,
  });
  return {
    acknowledged: false,
    due: true,
    intervalConfig,
    nextDueAt: "",
    payload: dueState.pendingTrigger,
    state: dueState,
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
    maxIntervalMs: 60 * 60_000,
    minIntervalMs: 3 * 60_000,
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
    lastConfirmedAt: "",
    nextDueAt: "",
    pendingTrigger: null,
    senderId: target.senderId,
    targetKey,
    updatedAt: new Date(nowMs).toISOString(),
    workspaceRoot: target.workspaceRoot,
  };
  return stateStore.setState(nextState);
}

function scheduleNextCheckin({
  intervalConfig,
  lastConfirmedAt,
  nowMs,
  stateStore,
  target,
}: {
  intervalConfig: ResolvedCheckinConfig;
  lastConfirmedAt: string;
  nowMs: number;
  stateStore: CheckinScheduleStateStore;
  target: CheckinResolvedTarget;
}): CheckinScheduleState {
  const nextDueAt = new Date(nowMs + pickRandomDelayMs(intervalConfig.minIntervalMs, intervalConfig.maxIntervalMs)).toISOString();
  return stateStore.setState({
    lastConfirmedAt,
    nextDueAt,
    pendingTrigger: null,
    senderId: target.senderId,
    targetKey: buildCheckinTargetKey(target),
    updatedAt: new Date(nowMs).toISOString(),
    workspaceRoot: target.workspaceRoot,
  });
}

function setPendingTrigger({
  config,
  nowMs,
  stateStore,
  target,
}: {
  config: Record<string, unknown>;
  nowMs: number;
  stateStore: CheckinScheduleStateStore;
  target: CheckinResolvedTarget;
}): CheckinScheduleState {
  const payload = buildCheckinTriggerPayload(config, target, { nowMs });
  const existing = stateStore.getState();
  return stateStore.setState({
    lastConfirmedAt: existing?.lastConfirmedAt || "",
    nextDueAt: "",
    pendingTrigger: {
      ...payload,
      dueAt: existing?.nextDueAt || payload.createdAt,
      triggerId: crypto.randomUUID(),
    },
    senderId: target.senderId,
    targetKey: buildCheckinTargetKey(target),
    updatedAt: new Date(nowMs).toISOString(),
    workspaceRoot: target.workspaceRoot,
  });
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
