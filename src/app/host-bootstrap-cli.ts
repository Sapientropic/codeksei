import type { CommandExecutionResult } from "../contracts/cli-contract";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { runCliMutation } from "../core/cli-mutation";
import { normalizeText } from "../core/text-normalization";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import {
  HOST_ATTACHMENT_CONTRACT_VERSION,
  HOST_BOOTSTRAP_SNAPSHOT_VERSION,
  resolveCodekseiConfigPath,
  writeCodekseiHostConfig,
  type CodekseiHostConfig,
} from "../host";
import { previewHermesCompanionSkillInstall, installHermesCompanionSkill } from "../host/recipes/hermes/skill";
import { resolveHostProviderWithConfig, type HostCliRuntimeConfig } from "./host-cli-shared";

interface HostBootstrapOptions {
  channel: string;
  config: string;
  dryRun: boolean;
  ensureDaemon: boolean;
  help: boolean;
  idempotencyKey: string;
  modeClass: string;
  name: string;
  provider: string;
  stateDir: string;
  timezone: string;
  user: string;
  workspace: string;
}

type BootstrapConfig = HostCliRuntimeConfig;
interface HostBootstrapResultData {
  config: CodekseiHostConfig;
  daemon: {
    required: true;
    ensured: boolean;
    state: string;
  };
  provider: string;
  skillInstall: unknown;
}

export async function runHostBootstrapCommand(
  config: BootstrapConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<HostBootstrapOptions>(args, getCommandArgsSchema("hostBootstrap"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("host.bootstrap"),
    };
  }

  const resolvedProvider = resolveHostProviderWithConfig(config, {
    provider: options.provider,
    configFile: options.config,
  });
  const bootstrapTarget = resolveHostBootstrapTarget(config, resolvedProvider, options);
  const nextConfig = buildCanonicalHostConfig(config, bootstrapTarget, options);

  return runCliMutation<HostBootstrapResultData>({
    commandKey: "host.bootstrap",
    config,
    configSource: {
      provider: bootstrapTarget.provider,
      resolvedConfigPath: bootstrapTarget.configFilePath,
    },
    dryRun: Boolean(options.dryRun),
    dryRunResult: {
      data: {
        config: nextConfig,
        daemon: {
          required: true,
          ensured: Boolean(options.ensureDaemon),
          state: "local_cli_ready",
        },
        provider: bootstrapTarget.provider,
        skillInstall: bootstrapTarget.provider === "hermes"
          ? previewHermesCompanionSkillInstall(config)
          : null,
      },
      text: JSON.stringify({
        config: nextConfig,
        provider: bootstrapTarget.provider,
        ensureDaemon: Boolean(options.ensureDaemon),
      }, null, 2),
      next: ["codeksei host doctor --provider hermes"],
    },
    execute: async () => {
      const written = writeCodekseiHostConfig(bootstrapTarget.configFilePath, nextConfig);
      const skillInstall = bootstrapTarget.provider === "hermes"
        ? installHermesCompanionSkill(config)
        : null;
      return {
        data: {
          config: written,
          daemon: {
            required: true,
            ensured: Boolean(options.ensureDaemon),
            state: "local_cli_ready",
          },
          provider: bootstrapTarget.provider,
          skillInstall,
        },
        text: [
          `host bootstrap written: ${bootstrapTarget.configFilePath}`,
          `provider: ${bootstrapTarget.provider}`,
          `modeClass: ${written.modeClass}`,
          `ensureDaemon: ${options.ensureDaemon ? "yes" : "no"}`,
        ].join("\n"),
        next: bootstrapTarget.provider === "hermes"
          ? ["codeksei host doctor --provider hermes", "codeksei host smoke --provider hermes"]
          : ["codeksei host doctor"],
      };
    },
    idempotencyKey: options.idempotencyKey,
    request: {
      config: nextConfig,
      ensureDaemon: Boolean(options.ensureDaemon),
      provider: bootstrapTarget.provider,
    },
    resolvedTargets: {
      configFile: bootstrapTarget.configFilePath,
      provider: bootstrapTarget.provider,
    },
    sideEffects: [
      { kind: "write_canonical_config", target: bootstrapTarget.configFilePath },
      ...(bootstrapTarget.provider === "hermes"
        ? [{ kind: "install_companion_skill", target: "~/.hermes/skills/codeksei-companion/SKILL.md" }]
        : []),
    ],
  });
}

interface ResolvedHostBootstrapTarget {
  configFilePath: string;
  effectiveWorkspaceRoot: string;
  existingConfig: CodekseiHostConfig | null;
  provider: string;
}

function resolveHostBootstrapTarget(
  config: BootstrapConfig,
  resolvedProvider: ReturnType<typeof resolveHostProviderWithConfig>,
  options: HostBootstrapOptions,
): ResolvedHostBootstrapTarget {
  const existingConfig = resolvedProvider.canonicalConfig;
  const effectiveWorkspaceRoot = normalizeText(options.workspace)
    || normalizeText(existingConfig?.workspaceRoot)
    || normalizeText(config.workspaceRoot)
    || process.cwd();
  // `--workspace` is the default canonical-config location selector too; if path and content
  // fall back independently, bootstrap can mutate workspace B while previewing workspace A.
  const configFilePath = resolveCodekseiConfigPath(options.config, effectiveWorkspaceRoot);
  return {
    configFilePath,
    effectiveWorkspaceRoot,
    existingConfig,
    provider: resolvedProvider.provider,
  };
}

function buildCanonicalHostConfig(
  config: BootstrapConfig,
  bootstrapTarget: ResolvedHostBootstrapTarget,
  options: HostBootstrapOptions,
): CodekseiHostConfig {
  const existing = bootstrapTarget.existingConfig;
  const workspaceRoot = bootstrapTarget.effectiveWorkspaceRoot;
  const stateDir = normalizeText(options.stateDir)
    || normalizeText(existing?.stateDir)
    || normalizeText(config.stateDir)
    || workspaceRoot;
  const provider = normalizeText(options.provider)
    || normalizeText(existing?.host.provider)
    || bootstrapTarget.provider
    || "generic-shell";
  const skillPreview = provider === "hermes"
    ? previewHermesCompanionSkillInstall(config)
    : null;
  return {
    $schema: "./schemas/codeksei-config-v1.json",
    modeClass: (normalizeText(options.modeClass)
      || normalizeText(existing?.modeClass)
      || (provider === "hermes" ? "hosted-proactive" : "hosted-skill-only")) as CodekseiHostConfig["modeClass"],
    workspaceRoot,
    stateDir,
    user: {
      id: normalizeText(options.user)
        || normalizeText(existing?.user.id)
        || normalizeText(config.allowedUserIds?.[0])
        || "user_1",
      name: normalizeText(options.name)
        || normalizeText(existing?.user.name)
        || normalizeText(config.userName)
        || "User",
      timezone: normalizeText(options.timezone)
        || normalizeText(existing?.user.timezone)
        || normalizeText(config.timezone)
        || "Asia/Shanghai",
    },
    host: {
      provider: provider as CodekseiHostConfig["host"]["provider"],
      channel: normalizeText(options.channel)
        || normalizeText(existing?.host.channel)
        || "weixin",
    },
    bootstrap: {
      snapshotVersion: HOST_BOOTSTRAP_SNAPSHOT_VERSION,
      manifestContractVersion: HOST_ATTACHMENT_CONTRACT_VERSION,
      companionSkillVersion: skillPreview?.repoSkillAsset.version || "",
      companionSkillHash: skillPreview?.repoSkillAsset.hash || "",
      completedAt: new Date().toISOString(),
    },
  };
}
