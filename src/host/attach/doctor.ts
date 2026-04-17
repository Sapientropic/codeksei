import { normalizeText } from "../../contracts/text-normalization";
import type { AppRuntimeConfig } from "../../core/app-service-contract";
import type { AttachedDaemonState } from "../contracts/daemon-attach";
import {
  HOST_ATTACHMENT_CONTRACT_VERSION,
  HOST_BOOTSTRAP_SNAPSHOT_VERSION,
  type HostAttachmentManifest,
} from "../contracts/attach-manifest";
import type { HostRecipeId } from "../contracts/host-recipe";
import { resolveHostAttachment, type HostAttachmentConfigInput } from "./model";
import { loadResolvedHostConfig } from "./config";
import { collectHermesRecipeDoctorReport, runHermesRecipeSmoke } from "../recipes/hermes/doctor";
import { buildHostAttachmentManifest } from "./manifest";
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
  upgrade: {
    bootstrapSnapshotMissing: boolean;
    configBootstrapOutdated: boolean;
    configPath: string;
    currentManifestContractVersion: number;
    currentSkillHash: string;
    currentSkillVersion: string;
    installedSkillOutdated: boolean;
    needsBootstrap: boolean;
    needsSkillInstall: boolean;
    recordedManifestContractVersion: number;
    recordedSkillHash: string;
    recordedSkillVersion: string;
    startupDoctorRecommended: boolean;
    suggestedActions: string[];
  };
}

export function collectHostDoctorReport(
  config: HostDoctorConfigInput = {},
): HostDoctorReport {
  const attachment = resolveHostAttachment(config);
  const cwd = normalizeText(config.workspaceRoot) || process.cwd();
  const resolvedConfig = loadResolvedHostConfig(config.configFile, cwd);
  const manifest = buildHostAttachmentManifest(config);
  const daemonState: AttachedDaemonState = {
    instanceId: "local-cli-state-owner",
    bridgeProfile: attachment.profile,
    pollLoopActive: attachment.profile === "codex-mode" && attachment.channelKind === "weixin" && attachment.channelProvider === "codeksei",
    scheduleOwner: "daemon",
    recoveryOwner: "daemon",
  };

  if (attachment.provider === "hermes") {
    const doctor = collectHermesRecipeDoctorReport(config);
    const smoke = runHermesRecipeSmoke(config);
    const upgrade = buildHostUpgradeStatus(manifest, resolvedConfig, doctor.installedSkill.inSync, "hermes");
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
      upgrade,
    };
  }

  const generic = resolveGenericShellRecipe();
  const upgrade = buildHostUpgradeStatus(manifest, resolvedConfig, false, generic.id);
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
    upgrade,
  };
}

function buildHostUpgradeStatus(
  manifest: HostAttachmentManifest,
  resolvedConfig: ReturnType<typeof loadResolvedHostConfig>,
  installedSkillInSync: boolean,
  providerId: HostRecipeId | "",
): HostDoctorReport["upgrade"] {
  const bootstrap = resolvedConfig.config?.bootstrap;
  const bootstrapSnapshotMissing = !bootstrap;
  const recordedManifestContractVersion = bootstrap?.manifestContractVersion || 0;
  const recordedSkillVersion = normalizeText(bootstrap?.companionSkillVersion);
  const recordedSkillHash = normalizeText(bootstrap?.companionSkillHash);
  const currentSkillVersion = normalizeText(manifest.upgrade.companionSkill.version);
  const currentSkillHash = normalizeText(manifest.upgrade.companionSkill.hash);
  const configBootstrapOutdated = bootstrapSnapshotMissing
    || normalizeBootstrapSnapshotVersion(bootstrap?.snapshotVersion) < HOST_BOOTSTRAP_SNAPSHOT_VERSION
    || recordedManifestContractVersion < HOST_ATTACHMENT_CONTRACT_VERSION
    || Boolean(currentSkillHash && recordedSkillHash && currentSkillHash !== recordedSkillHash)
    || Boolean(currentSkillHash && !recordedSkillHash);
  const installedSkillOutdated = Boolean(currentSkillHash) && !installedSkillInSync;
  const needsBootstrap = configBootstrapOutdated;
  const needsSkillInstall = !needsBootstrap && installedSkillOutdated;
  const suggestedActions: string[] = [];
  if (needsBootstrap) {
    suggestedActions.push(`codeksei host bootstrap --provider ${providerId || "generic-shell"} --ensure-daemon`);
  } else if (needsSkillInstall) {
    suggestedActions.push("codeksei operator hermes install-skill");
  } else if (manifest.upgrade.startupDoctorRequired) {
    suggestedActions.push(`codeksei host doctor --provider ${providerId || "generic-shell"}`);
  }
  return {
    bootstrapSnapshotMissing,
    configBootstrapOutdated,
    configPath: resolvedConfig.path,
    currentManifestContractVersion: manifest.contractVersion,
    currentSkillHash,
    currentSkillVersion,
    installedSkillOutdated,
    needsBootstrap,
    needsSkillInstall,
    recordedManifestContractVersion,
    recordedSkillHash,
    recordedSkillVersion,
    startupDoctorRecommended: manifest.upgrade.startupDoctorRequired,
    suggestedActions,
  };
}

function normalizeBootstrapSnapshotVersion(value: unknown): number {
  const numeric = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}
