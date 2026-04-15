import { normalizeText } from "../../contracts/text-normalization";
import type { AppRuntimeConfig } from "../../core/app-service-contract";
import type { AttachedDaemonState } from "../contracts/daemon-attach";
import type { HostRecipeId } from "../contracts/host-recipe";
import { resolveHostAttachment, type HostAttachmentConfigInput } from "./model";
import { loadResolvedHostConfig } from "./config";
import { collectHermesRecipeDoctorReport, runHermesRecipeSmoke } from "../recipes/hermes/doctor";
import { resolveGenericShellRecipe } from "../recipes/generic/recipe";

interface HostDoctorConfigInput
  extends HostAttachmentConfigInput,
    Partial<Pick<AppRuntimeConfig, "workspaceRoot">> {
  configFile?: unknown;
}

export interface HostDoctorReport {
  daemon: {
    required: true;
    state: AttachedDaemonState;
  };
  attachment: ReturnType<typeof resolveHostAttachment>;
  resolvedConfig: {
    path: string;
    exists: boolean;
  };
  provider: {
    id: HostRecipeId | "";
    doctor: unknown;
    smokeReady: boolean;
  };
}

export function collectHostDoctorReport(
  config: HostDoctorConfigInput = {},
): HostDoctorReport {
  const attachment = resolveHostAttachment(config);
  const cwd = normalizeText(config.workspaceRoot) || process.cwd();
  const resolvedConfig = loadResolvedHostConfig(config.configFile, cwd);
  const daemonState: AttachedDaemonState = {
    instanceId: "local-cli-state-owner",
    bridgeProfile: attachment.profile,
    pollLoopActive: attachment.profile === "bridge-codex-weixin",
    scheduleOwner: "daemon",
    recoveryOwner: "daemon",
  };

  if (attachment.provider === "hermes") {
    const doctor = collectHermesRecipeDoctorReport(config);
    const smoke = runHermesRecipeSmoke(config);
    return {
      daemon: { required: true, state: daemonState },
      attachment,
      resolvedConfig: {
        path: resolvedConfig.path,
        exists: Boolean(resolvedConfig.config),
      },
      provider: {
        id: "hermes",
        doctor,
        smokeReady: smoke.ok,
      },
    };
  }

  const generic = resolveGenericShellRecipe();
  return {
    daemon: { required: true, state: daemonState },
    attachment,
    resolvedConfig: {
      path: resolvedConfig.path,
      exists: Boolean(resolvedConfig.config),
    },
    provider: {
      id: generic.id,
      doctor: {
        recipe: generic,
      },
      smokeReady: true,
    },
  };
}
