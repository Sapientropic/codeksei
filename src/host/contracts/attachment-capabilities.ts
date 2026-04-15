export const HOST_MODE_CLASSES = [
  "bridge-full",
  "hosted-proactive",
  "hosted-skill-only",
  "cli-only",
] as const;

export const HOST_TRANSPORTS = [
  "cli_stdio",
] as const;

export const HOST_CAPABILITY_IDS = [
  "invokeCodekseiAction",
  "deliverVisibleText",
  "deliverVisibleFile",
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
  }
  return map;
}
