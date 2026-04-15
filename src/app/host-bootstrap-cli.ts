import type { CommandExecutionResult } from "../contracts/cli-contract";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { runCliMutation } from "../core/cli-mutation";
import { normalizeText } from "../core/text-normalization";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import {
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
  const configFilePath = resolveCodekseiConfigPath(options.config, normalizeText(config.workspaceRoot) || process.cwd());
  const nextConfig = buildCanonicalHostConfig(config, resolvedProvider, options);

  return runCliMutation<HostBootstrapResultData>({
    commandKey: "host.bootstrap",
    config,
    configSource: {
      provider: resolvedProvider.provider,
      resolvedConfigPath: configFilePath,
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
        provider: resolvedProvider.provider,
        skillInstall: resolvedProvider.provider === "hermes"
          ? previewHermesCompanionSkillInstall(config)
          : null,
      },
      text: JSON.stringify({
        config: nextConfig,
        provider: resolvedProvider.provider,
        ensureDaemon: Boolean(options.ensureDaemon),
      }, null, 2),
      next: ["codeksei host doctor --provider hermes"],
    },
    execute: async () => {
      const written = writeCodekseiHostConfig(configFilePath, nextConfig);
      const skillInstall = resolvedProvider.provider === "hermes"
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
          provider: resolvedProvider.provider,
          skillInstall,
        },
        text: [
          `host bootstrap written: ${configFilePath}`,
          `provider: ${resolvedProvider.provider}`,
          `modeClass: ${written.modeClass}`,
          `ensureDaemon: ${options.ensureDaemon ? "yes" : "no"}`,
        ].join("\n"),
        next: resolvedProvider.provider === "hermes"
          ? ["codeksei host doctor --provider hermes", "codeksei host smoke --provider hermes"]
          : ["codeksei host doctor"],
      };
    },
    idempotencyKey: options.idempotencyKey,
    request: {
      config: nextConfig,
      ensureDaemon: Boolean(options.ensureDaemon),
      provider: resolvedProvider.provider,
    },
    resolvedTargets: {
      configFile: configFilePath,
      provider: resolvedProvider.provider,
    },
    sideEffects: [
      { kind: "write_canonical_config", target: configFilePath },
      ...(resolvedProvider.provider === "hermes"
        ? [{ kind: "install_companion_skill", target: "~/.hermes/skills/codeksei-companion/SKILL.md" }]
        : []),
    ],
  });
}

function buildCanonicalHostConfig(
  config: BootstrapConfig,
  resolvedProvider: ReturnType<typeof resolveHostProviderWithConfig>,
  options: HostBootstrapOptions,
): CodekseiHostConfig {
  const existing = resolvedProvider.canonicalConfig;
  const workspaceRoot = normalizeText(options.workspace)
    || normalizeText(existing?.workspaceRoot)
    || normalizeText(config.workspaceRoot)
    || process.cwd();
  const stateDir = normalizeText(options.stateDir)
    || normalizeText(existing?.stateDir)
    || normalizeText(config.stateDir)
    || workspaceRoot;
  const provider = normalizeText(options.provider)
    || normalizeText(existing?.host.provider)
    || resolvedProvider.provider
    || "generic-shell";
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
  };
}
