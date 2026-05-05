export const HOST_MODE_CLASSES = [
  "codex-managed",
  "claudecode-managed",
  "hosted-proactive",
  "hosted-skill-only",
  "cli-only",
  "bridge-full",
] as const;

export const HOST_TRANSPORTS = [
  "cli_stdio",
] as const;

export const HOST_CAPABILITY_IDS = [
  "invokeCodekseiAction",
  "deliverVisibleText",
  "deliverVisibleFile",
  "upsertWakeJob",
  "cancelWakeJob",
  "resolveOriginSession",
  "upsertOneShotWake",
  "cancelOneShotWake",
  "persistedOriginRouting",
  "installCompanionSkill",
  "hostSmoke",
  "bridgeRuntimeLifecycle",
  "bridgeQueueAccess",
  "contextTokenAccess",
  "weixinAccountAccess",
  "resolveHostedSession",
  "semanticReviewHybrid",
] as const;

export type HostModeClass = typeof HOST_MODE_CLASSES[number];
export type HostTransport = typeof HOST_TRANSPORTS[number];
export type HostCapabilityId = typeof HOST_CAPABILITY_IDS[number];

export interface HostCapabilityMap {
  invokeCodekseiAction: boolean;
  deliverVisibleText: boolean;
  deliverVisibleFile: boolean;
  upsertWakeJob: boolean;
  cancelWakeJob: boolean;
  resolveOriginSession: boolean;
  upsertOneShotWake: boolean;
  cancelOneShotWake: boolean;
  persistedOriginRouting: boolean;
  installCompanionSkill: boolean;
  hostSmoke: boolean;
  bridgeRuntimeLifecycle: boolean;
  bridgeQueueAccess: boolean;
  contextTokenAccess: boolean;
  weixinAccountAccess: boolean;
  resolveHostedSession: boolean;
  semanticReviewHybrid: boolean;
}

export function createEmptyHostCapabilityMap(): HostCapabilityMap {
  return {
    invokeCodekseiAction: false,
    deliverVisibleText: false,
    deliverVisibleFile: false,
    upsertWakeJob: false,
    cancelWakeJob: false,
    resolveOriginSession: false,
    upsertOneShotWake: false,
    cancelOneShotWake: false,
    persistedOriginRouting: false,
    installCompanionSkill: false,
    hostSmoke: false,
    bridgeRuntimeLifecycle: false,
    bridgeQueueAccess: false,
    contextTokenAccess: false,
    weixinAccountAccess: false,
    resolveHostedSession: false,
    semanticReviewHybrid: false,
  };
}

export function buildHostCapabilityMap(
  capabilities: readonly HostCapabilityId[],
): HostCapabilityMap {
  const map = createEmptyHostCapabilityMap();
  for (const capability of capabilities) {
    map[capability] = true;
    if (capability === "upsertWakeJob") {
      map.upsertOneShotWake = true;
    }
    if (capability === "cancelWakeJob") {
      map.cancelOneShotWake = true;
    }
    if (capability === "resolveOriginSession") {
      map.resolveHostedSession = true;
    }
    if (capability === "upsertOneShotWake") {
      map.upsertWakeJob = true;
    }
    if (capability === "cancelOneShotWake") {
      map.cancelWakeJob = true;
    }
    if (capability === "resolveHostedSession") {
      map.resolveOriginSession = true;
    }
  }
  return map;
}
