import type { AppRuntimeConfig } from "../core/app-service-contract";
import { CliError, buildTargetResolutionRequiredError } from "../core/cli-contract";
import { normalizeText } from "../core/text-normalization";
import {
  buildCheckinTargetResolutionErrorMessage,
  resolveCheckinTarget,
  type CheckinResolvedTarget,
} from "../checkin";
import { loadResolvedHostConfig } from "../host";
import { createSessionStore } from "../session/session-store-factory";

export type HostCliRuntimeConfig = Partial<Pick<
  AppRuntimeConfig,
  | "accountId"
  | "allowedUserIds"
  | "channelProvider"
  | "claudeCommand"
  | "checkinConfigFile"
  | "checkinScheduleStateFile"
  | "cliIdempotencyLedgerFile"
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
  | "runtime"
  | "sessionsFile"
  | "stateDir"
  | "timezone"
  | "userName"
  | "workspaceId"
  | "workspaceRoot"
>>;

export function resolveHostCheckinTarget(
  config: HostCliRuntimeConfig,
  {
    user,
    workspace,
  }: {
    user?: string;
    workspace?: string;
  },
): CheckinResolvedTarget {
  const resolution = resolveCheckinTarget({
    accountId: normalizeText(config.accountId),
    config,
    explicitUser: normalizeText(user),
    explicitWorkspace: normalizeText(workspace),
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
  return resolution.value;
}

export function assertResidentDaemonConfig(
  config: HostCliRuntimeConfig,
): void {
  if (!normalizeText(config.checkinScheduleStateFile) || !normalizeText(config.checkinConfigFile)) {
    throw new CliError({
      code: "resident_daemon_unavailable",
      exitCode: 1,
      message: "当前缺少 resident daemon 所需的 checkin state/config 路径。",
      hint: "先提供有效的 stateDir / checkin config，再执行 host proactive 命令。",
      retryable: false,
    });
  }
}

export function resolveHostProviderWithConfig(
  config: HostCliRuntimeConfig,
  {
    provider,
    configFile,
    defaultProvider,
  }: {
    provider?: string;
    configFile?: string;
    defaultProvider?: string;
  } = {},
): {
  provider: string;
  resolvedConfigPath: string;
  canonicalConfig: ReturnType<typeof loadResolvedHostConfig>["config"];
} {
  const cwd = normalizeText(config.workspaceRoot) || process.cwd();
  const resolved = loadResolvedHostConfig(configFile, cwd);
  const resolvedProvider = normalizeText(provider)
    || normalizeText(resolved.config?.host.provider)
    || normalizeText(defaultProvider)
    || (normalizeText(config.runtime) === "hermes" && normalizeText(config.channelProvider) === "hermes" ? "hermes" : "generic-shell");
  return {
    provider: resolvedProvider,
    resolvedConfigPath: resolved.path,
    canonicalConfig: resolved.config,
  };
}
