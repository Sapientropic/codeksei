import {
  listCommandActions,
  type CommandAction,
  type CommandHostDependency,
  type CommandHostProfileId,
  type CommandHostSupportTier,
  type CommandMutability,
  type CommandSafetyTier,
} from "../contracts/command-surface";
import { normalizeText } from "../contracts/text-normalization";
import { resolveHostMode, type HostProfileId } from "../core/host-mode";
import type { HostModeConfigInput } from "../core/host-mode-resolution";
import { createSessionStore } from "../session/session-store-factory";
import { resolveCheckinTarget } from "../checkin";
import { collectWhereaboutsCapabilityReadiness } from "../whereabouts/readiness";

export const CAPABILITY_STATUS_VALUES = [
  "available",
  "blocked",
  "degraded",
  "unknown",
] as const;

export type CapabilityStatusValue = typeof CAPABILITY_STATUS_VALUES[number];

export interface CapabilityStatusItem {
  availableNow: boolean;
  configured: boolean;
  entrypoints: string[];
  hostDependencies: CommandHostDependency[];
  hostProfiles: CommandHostProfileId[];
  hostSupportTier: CommandHostSupportTier;
  id: string;
  label: string;
  mutability: CommandMutability;
  reasons: string[];
  safetyTier: CommandSafetyTier;
  sideEffect: boolean;
  status: CapabilityStatusValue;
}

export interface CapabilityStatusReport {
  capabilities: CapabilityStatusItem[];
  host: {
    profile: HostProfileId;
    provider: string;
    supported: boolean;
  };
  summary: {
    available: number;
    blocked: number;
    degraded: number;
    total: number;
    unknown: number;
  };
}

export interface CapabilityStatusConfig extends HostModeConfigInput {
  accountId?: string;
  allowedUserIds?: string[];
  sessionsFile?: string;
  stateDir?: string;
  whereaboutsHost?: unknown;
  whereaboutsPlacesFile?: unknown;
  whereaboutsPort?: unknown;
  whereaboutsRetentionDays?: unknown;
  whereaboutsToken?: unknown;
  workspaceId?: string;
  workspaceRoot?: string;
}

interface CapabilityStatusOptions {
  provider?: string;
  user?: string;
  workspace?: string;
}

export function buildCapabilityStatusReport(
  config: CapabilityStatusConfig = {},
  options: CapabilityStatusOptions = {},
): CapabilityStatusReport {
  const hostConfig = resolveHostConfig(config, options.provider);
  const host = resolveHostMode(hostConfig);
  const targetResolution = resolveCheckinTarget({
    accountId: normalizeText(config.accountId),
    config: normalizeCapabilityTargetConfig(config),
    explicitUser: normalizeText(options.user),
    explicitWorkspace: normalizeText(options.workspace),
    sessionStore: createSessionStore(config.sessionsFile),
  });
  const whereaboutsReadiness = collectWhereaboutsCapabilityReadiness(config);
  const capabilities = listCommandActions()
    .filter((action) => action.status === "active")
    .map((action) => buildCapabilityStatusItem(action, {
      hostProfile: host.profile,
      hostSupported: host.supported,
      localReadinessReasons: resolveLocalCapabilityReadinessReasons(action.action, whereaboutsReadiness),
      targetResolvable: Boolean(targetResolution.ok && targetResolution.value),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    capabilities,
    host: {
      profile: host.profile,
      provider: resolveProviderLabel(options.provider, host),
      supported: host.supported,
    },
    summary: summarizeCapabilities(capabilities),
  };
}

function buildCapabilityStatusItem(
  action: CommandAction,
  {
    hostProfile,
    hostSupported,
    localReadinessReasons,
    targetResolvable,
  }: {
    hostProfile: HostProfileId;
    hostSupported: boolean;
    localReadinessReasons: string[];
    targetResolvable: boolean;
  },
): CapabilityStatusItem {
  const configured = action.status === "active";
  const entrypoints = buildCapabilityEntrypoints(action);
  const reasons: string[] = [];
  if (!configured) {
    reasons.push("command is not active");
  }
  if (!hostSupported) {
    reasons.push("current host combination is unsupported");
  }
  if (action.hostProfileIds.length && (hostProfile === "unsupported" || !action.hostProfileIds.includes(hostProfile))) {
    reasons.push(`current host profile ${hostProfile} is not in supported profiles: ${action.hostProfileIds.join(", ")}`);
  }
  if (requiresResolvedTarget(action.hostDependencies) && !targetResolvable) {
    reasons.push("target resolution is required for this capability but no unique sender/workspace was resolved");
  }
  const unverifiedReadinessDependencies = getUnverifiedReadinessDependencies(action);
  if (unverifiedReadinessDependencies.length) {
    reasons.push([
      `host readiness is required for dependencies: ${unverifiedReadinessDependencies.join(", ")}`,
      "run host doctor/smoke or pass a provider readiness signal before marking this capability available",
    ].join("; "));
  }
  reasons.push(...localReadinessReasons);
  if (!entrypoints.length) {
    reasons.push("no public terminal or channel entrypoint is exposed");
  }
  const availableNow = configured && hostSupported && reasons.length === 0;
  const status = resolveCapabilityStatus(availableNow, reasons);
  return {
    availableNow,
    configured,
    entrypoints,
    hostDependencies: [...action.hostDependencies],
    hostProfiles: [...action.hostProfileIds],
    hostSupportTier: action.hostSupportTier,
    id: action.action,
    label: action.summary || action.action,
    mutability: action.mutability,
    reasons,
    safetyTier: action.safetyTier,
    sideEffect: hasCapabilitySideEffect(action),
    status,
  };
}

function hasCapabilitySideEffect(action: CommandAction): boolean {
  return action.sideEffects.length > 0 || action.mutability !== "read";
}

function buildCapabilityEntrypoints(action: CommandAction): string[] {
  const terminalEntrypoints = action.terminal.map((entry) => `codeksei ${entry}`);
  const weixinEntrypoints = action.weixin.map((entry) => `weixin:${entry}`);
  return [...terminalEntrypoints, ...weixinEntrypoints];
}

function requiresResolvedTarget(dependencies: readonly CommandHostDependency[]): boolean {
  return dependencies.includes("context_token")
    || dependencies.includes("hosted_session_lookup")
    || dependencies.includes("bridge_file_delivery")
    || dependencies.includes("hosted_repo_local_delivery");
}

function getUnverifiedReadinessDependencies(
  action: CommandAction,
): CommandHostDependency[] {
  if (canVerifyOrRepairHostReadiness(action.action)) {
    return [];
  }
  const dependencies = action.hostDependencies;
  return dependencies.filter((dependency) => !isTargetResolutionDependency(dependency));
}

function canVerifyOrRepairHostReadiness(actionId: string): boolean {
  return [
    "host.bootstrap",
    "host.doctor",
    "host.render",
    "host.smoke",
    "operator.hermes.install_skill",
    "operator.hermes.smoke",
    "operator.hermes.status",
  ].includes(actionId);
}

function isTargetResolutionDependency(dependency: CommandHostDependency): boolean {
  return dependency === "context_token"
    || dependency === "hosted_session_lookup"
    || dependency === "bridge_file_delivery"
    || dependency === "hosted_repo_local_delivery";
}

function resolveCapabilityStatus(
  availableNow: boolean,
  reasons: string[],
): CapabilityStatusValue {
  if (availableNow) {
    return "available";
  }
  if (reasons.some((reason) => reason.includes("unsupported") || reason.includes("not in supported profiles") || reason.includes("target resolution"))) {
    return "blocked";
  }
  if (reasons.length) {
    return "degraded";
  }
  return "unknown";
}

function summarizeCapabilities(items: CapabilityStatusItem[]): CapabilityStatusReport["summary"] {
  const summary = {
    available: 0,
    blocked: 0,
    degraded: 0,
    total: items.length,
    unknown: 0,
  };
  for (const item of items) {
    summary[item.status] += 1;
  }
  return summary;
}

function normalizeCapabilityTargetConfig(
  config: CapabilityStatusConfig,
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
  const workspaceId = normalizeText(config.workspaceId);
  if (workspaceId) {
    normalized.workspaceId = workspaceId;
  }
  const workspaceRoot = normalizeText(config.workspaceRoot);
  if (workspaceRoot) {
    normalized.workspaceRoot = workspaceRoot;
  }
  return normalized;
}

function resolveHostConfig(
  config: CapabilityStatusConfig,
  provider: unknown,
): HostModeConfigInput {
  const normalizedProvider = normalizeText(provider);
  if (normalizedProvider === "codex") {
    return { ...config, runtime: "codex", channelProvider: "codeksei", channel: "weixin" };
  }
  if (normalizedProvider === "claudecode") {
    return { ...config, runtime: "claudecode", channelProvider: "codeksei", channel: "weixin" };
  }
  if (normalizedProvider === "hermes") {
    return { ...config, runtime: "hermes", channelProvider: "hermes", channel: "weixin" };
  }
  if (normalizedProvider === "generic-shell") {
    return { ...config, runtime: "hermes", channelProvider: "host", channel: "none" };
  }
  return config;
}

function resolveProviderLabel(
  provider: unknown,
  host: ReturnType<typeof resolveHostMode>,
): string {
  return normalizeText(provider)
    || (host.runtime === "claudecode" ? "claudecode" : host.channelProvider === "hermes" ? "hermes" : host.channelProvider === "host" ? "generic-shell" : "codex");
}

function resolveLocalCapabilityReadinessReasons(
  actionId: string,
  whereaboutsReadiness: ReturnType<typeof collectWhereaboutsCapabilityReadiness>,
): string[] {
  if (actionId === "whereabouts.serve") {
    return whereaboutsReadiness.serve.available ? [] : [whereaboutsReadiness.serve.reason];
  }
  if (
    actionId === "whereabouts.snapshot"
    || actionId === "whereabouts.recent_stays"
    || actionId === "whereabouts.recent_moves"
    || actionId === "whereabouts.summary"
  ) {
    return whereaboutsReadiness.query.available ? [] : [whereaboutsReadiness.query.reason];
  }
  return [];
}
