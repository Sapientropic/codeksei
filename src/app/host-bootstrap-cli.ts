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
    defaultProvider: "hermes",
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
      }, null, 2),
      next: bootstrapTarget.provider === "hermes"
        ? ["codeksei host doctor --provider hermes", "codeksei host smoke --provider hermes"]
        : [`codeksei host doctor --provider ${bootstrapTarget.provider}`],
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
            state: "local_cli_ready",
          },
          provider: bootstrapTarget.provider,
          skillInstall,
        },
        text: [
          `host bootstrap written: ${bootstrapTarget.configFilePath}`,
          `provider: ${bootstrapTarget.provider}`,
          `modeClass: ${written.modeClass}`,
          `daemonState: local_cli_ready`,
        ].join("\n"),
        next: bootstrapTarget.provider === "hermes"
          ? ["codeksei host doctor --provider hermes", "codeksei host smoke --provider hermes"]
          : ["codeksei host doctor"],
      };
    },
    idempotencyKey: options.idempotencyKey,
    request: {
      config: nextConfig,
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
    $schema: "./schemas/codeksei-config-v2.json",
    modeClass: resolveModeClass(existing, options, provider, config) as CodekseiHostConfig["modeClass"],
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
      runtimeProvider: resolveRuntimeProvider(existing, provider, config),
      runtimeOwner: resolveRuntimeOwner(existing, provider, config),
      channelProvider: resolveChannelProvider(existing, provider, options, config),
      channelKind: resolveChannelKind(existing, provider, options),
      deliveryRecipe: resolveDeliveryRecipe(existing, provider, options, config),
      channel: normalizeText(options.channel)
        || normalizeText(existing?.host.channel)
        || resolveChannelKind(existing, provider, options),
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

function resolveModeClass(
  existing: CodekseiHostConfig | null,
  options: HostBootstrapOptions,
  provider: string,
  config: BootstrapConfig,
): CodekseiHostConfig["modeClass"] {
  const explicit = normalizeText(options.modeClass) as CodekseiHostConfig["modeClass"] | "";
  if (explicit) {
    return explicit;
  }
  if (normalizeText(existing?.modeClass) === "codex-managed") {
    return "codex-managed";
  }
  if (provider === "hermes") {
    return "hosted-proactive";
  }
  const runtimeProvider = resolveRuntimeProvider(existing, provider, config);
  const channelProvider = resolveChannelProvider(existing, provider, options, config);
  return runtimeProvider === "codex" && channelProvider === "codeksei"
    ? "codex-managed"
    : (normalizeText(existing?.modeClass) as CodekseiHostConfig["modeClass"] | "") || "hosted-skill-only";
}

function resolveRuntimeProvider(
  existing: CodekseiHostConfig | null,
  provider: string,
  config: BootstrapConfig,
): CodekseiHostConfig["host"]["runtimeProvider"] {
  const current = normalizeText(existing?.host.runtimeProvider) as CodekseiHostConfig["host"]["runtimeProvider"] | "";
  if (current) {
    return current;
  }
  if (provider === "hermes") {
    return "hermes";
  }
  return normalizeText(config.runtime) === "hermes" ? "hermes" : "codex";
}

function resolveRuntimeOwner(
  existing: CodekseiHostConfig | null,
  provider: string,
  config: BootstrapConfig,
): CodekseiHostConfig["host"]["runtimeOwner"] {
  const current = normalizeText(existing?.host.runtimeOwner) as CodekseiHostConfig["host"]["runtimeOwner"] | "";
  if (current) {
    return current;
  }
  const runtimeProvider = resolveRuntimeProvider(existing, provider, config);
  return runtimeProvider === "codex" ? "codeksei" : "host";
}

function resolveChannelKind(
  existing: CodekseiHostConfig | null,
  provider: string,
  options: HostBootstrapOptions,
): string {
  return normalizeText(options.channel)
    || normalizeText(existing?.host.channelKind)
    || normalizeText(existing?.host.channel)
    || (provider === "hermes" ? "weixin" : "none");
}

function resolveChannelProvider(
  existing: CodekseiHostConfig | null,
  provider: string,
  options: HostBootstrapOptions,
  config: BootstrapConfig,
): CodekseiHostConfig["host"]["channelProvider"] {
  const current = normalizeText(existing?.host.channelProvider) as CodekseiHostConfig["host"]["channelProvider"] | "";
  if (current) {
    return current;
  }
  const channelKind = resolveChannelKind(existing, provider, options);
  if (provider === "hermes") {
    return channelKind === "weixin" ? "hermes" : "host";
  }
  return normalizeText(config.runtime) === "codex" && channelKind === "weixin" ? "codeksei" : "host";
}

function resolveDeliveryRecipe(
  existing: CodekseiHostConfig | null,
  provider: string,
  options: HostBootstrapOptions,
  config: BootstrapConfig,
): string {
  const current = normalizeText(existing?.host.deliveryRecipe);
  if (current) {
    return current;
  }
  const channelProvider = resolveChannelProvider(existing, provider, options, config);
  if (provider === "hermes" && channelProvider === "hermes") {
    return "hermes-origin";
  }
  if (channelProvider === "codeksei") {
    return "codeksei-weixin-bridge";
  }
  return "generic-shell";
}
