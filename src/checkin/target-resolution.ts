import type { AppRuntimeConfig } from "../core/app-service-contract";
import { normalizeText } from "../contracts/text-normalization";
import type { PreferredTargetResolution } from "../workspace/default-targets";
import {
  inspectPreferredSenderId,
  inspectPreferredWorkspaceRoot,
} from "../workspace/default-targets";

export interface CheckinSessionStoreLike {
  buildBindingKey(args: { accountId: string; senderId: string; workspaceId: string }): string;
  getActiveWorkspaceRoot(bindingKey: string): string;
  getBinding(bindingKey: string): Record<string, unknown> | null;
  state?: {
    bindings?: Record<string, Record<string, unknown>>;
  };
}

type CheckinTargetConfig = Partial<Pick<AppRuntimeConfig, "allowedUserIds" | "workspaceId" | "workspaceRoot">>;

interface CheckinTargetResolutionArgs {
  accountId?: string;
  config: CheckinTargetConfig;
  explicitUser?: string;
  explicitWorkspace?: string;
  sessionStore?: CheckinSessionStoreLike | null;
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

export function buildCheckinTargetKey(target: Pick<CheckinResolvedTarget, "senderId" | "workspaceRoot">): string {
  return `${target.senderId}::${target.workspaceRoot}`;
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

function inspectCheckinWorkspaceRoot({
  accountId,
  config,
  explicitWorkspace,
  senderId,
  sessionStore,
}: {
  accountId: string;
  config: CheckinTargetConfig;
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
