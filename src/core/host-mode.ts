import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { resolvePackageRoot } from "../contracts/path-utils";
import { normalizeText } from "../contracts/text-normalization";

export type CodekseiRuntimeProvider = "codex" | "hermes" | "openclaw-reserved";
export type CodekseiChannelProvider = "codeksei" | "hermes";
export type CodekseiExecutionMode = "bridge" | "hosted" | "unsupported";

export interface HostModeResolution {
  runtime: CodekseiRuntimeProvider;
  channelProvider: CodekseiChannelProvider;
  channel: string;
  mode: CodekseiExecutionMode;
  supported: boolean;
  reason: string;
}

export interface HermesHostedDoctorReport {
  command: string;
  binaryPath: string;
  available: boolean;
  hermesHome: string;
  configFile: {
    path: string;
    exists: boolean;
  };
  weixinAccounts: {
    dir: string;
    exists: boolean;
    count: number;
  };
  repoSkillAsset: {
    path: string;
    exists: boolean;
  };
  installedSkill: {
    path: string;
    exists: boolean;
  };
}

export function resolveHostMode(config: Record<string, unknown> = {}): HostModeResolution {
  const explicitRuntime = normalizeRuntimeProvider(config.runtime || config.CODEKSEI_RUNTIME);
  const explicitChannelProvider = normalizeChannelProvider(
    config.channelProvider || config.CODEKSEI_CHANNEL_PROVIDER,
  );
  const channel = normalizeChannel(config.channel || config.CODEKSEI_CHANNEL);
  const runtime = explicitRuntime || (explicitChannelProvider === "hermes" ? "hermes" : "codex");
  const channelProvider = explicitChannelProvider || (runtime === "hermes" ? "hermes" : "codeksei");

  if (channel !== "weixin") {
    return {
      runtime,
      channelProvider,
      channel,
      mode: "unsupported",
      supported: false,
      reason: `当前首个 host-neutral cut 只支持 channel=weixin；当前值是 ${channel || "(empty)"}。`,
    };
  }

  if (runtime === "codex" && channelProvider === "codeksei") {
    return {
      runtime,
      channelProvider,
      channel,
      mode: "bridge",
      supported: true,
      reason: "",
    };
  }

  if (runtime === "hermes" && channelProvider === "hermes") {
    return {
      runtime,
      channelProvider,
      channel,
      mode: "hosted",
      supported: true,
      reason: "",
    };
  }

  if (runtime === "hermes" && channelProvider === "codeksei") {
    return {
      runtime,
      channelProvider,
      channel,
      mode: "unsupported",
      supported: false,
      reason: "当前组合尚未实现：runtime=hermes + channelProvider=codeksei。若要用 Hermes，请把 channelProvider 也切到 hermes，让 Hermes 官方 Weixin 托管消息面。",
    };
  }

  if (runtime === "codex" && channelProvider === "hermes") {
    return {
      runtime,
      channelProvider,
      channel,
      mode: "unsupported",
      supported: false,
      reason: "当前组合尚未实现：runtime=codex + channelProvider=hermes。若要复用 Hermes 官方 Weixin，请同时把 runtime 切到 hermes。",
    };
  }

  if (runtime === "openclaw-reserved") {
    return {
      runtime,
      channelProvider,
      channel,
      mode: "unsupported",
      supported: false,
      reason: "openclaw-reserved 目前只保留为未来兼容占位；这次 PR 不实现 OpenClaw host path。",
    };
  }

  return {
    runtime,
    channelProvider,
    channel,
    mode: "unsupported",
    supported: false,
    reason: `当前组合不受支持：runtime=${runtime} channelProvider=${channelProvider} channel=${channel}。`,
  };
}

export function assertBridgeMode(config: Record<string, unknown>, commandLabel: string): HostModeResolution {
  const resolved = resolveHostMode(config);
  if (resolved.mode === "bridge") {
    return resolved;
  }
  throw new Error(formatBridgeOnlyCommandMessage(resolved, commandLabel));
}

export function formatBridgeOnlyCommandMessage(
  resolved: HostModeResolution,
  commandLabel: string,
): string {
  const label = normalizeText(commandLabel) || "该命令";
  if (resolved.mode === "hosted") {
    return [
      `${label} 在 Hermes Hosted Mode 下不会启动 Codeksei 自己的 runtime/Weixin bridge。`,
      "请改用 Hermes gateway，并加载仓内提供的 Codeksei companion skill。",
      `当前组合: runtime=${resolved.runtime}, channelProvider=${resolved.channelProvider}, channel=${resolved.channel}`,
    ].join("\n");
  }
  return [
    `${label} 当前不可用。`,
    resolved.reason || "当前 host 组合不受支持。",
    `当前组合: runtime=${resolved.runtime}, channelProvider=${resolved.channelProvider}, channel=${resolved.channel}`,
  ].join("\n");
}

export function collectHermesHostedDoctorReport(
  config: Record<string, unknown> = {},
): HermesHostedDoctorReport {
  const hermesCommand = normalizeText(config.hermesCommand || config.CODEKSEI_HERMES_COMMAND) || "hermes";
  const hermesHome = path.join(os.homedir(), ".hermes");
  const repoSkillAssetPath = resolveRepoHermesSkillAssetPath();
  const installedSkillPath = path.join(hermesHome, "skills", "codeksei-companion", "SKILL.md");
  const configFile = path.join(hermesHome, "config.yaml");
  const weixinAccountsDir = path.join(hermesHome, "weixin", "accounts");
  const binaryPath = resolveCommandOnPath(hermesCommand);

  return {
    command: hermesCommand,
    binaryPath,
    available: Boolean(binaryPath),
    hermesHome,
    configFile: {
      path: configFile,
      exists: fs.existsSync(configFile),
    },
    weixinAccounts: {
      dir: weixinAccountsDir,
      exists: fs.existsSync(weixinAccountsDir),
      count: countHermesWeixinAccounts(weixinAccountsDir),
    },
    repoSkillAsset: {
      path: repoSkillAssetPath,
      exists: fs.existsSync(repoSkillAssetPath),
    },
    installedSkill: {
      path: installedSkillPath,
      exists: fs.existsSync(installedSkillPath),
    },
  };
}

export function resolveRepoHermesSkillAssetPath(): string {
  const packageRoot = resolvePackageRoot(__dirname);
  return path.join(packageRoot, "templates", "hermes", "skills", "codeksei-companion", "SKILL.md");
}

function normalizeRuntimeProvider(value: unknown): CodekseiRuntimeProvider | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "hermes") {
    return "hermes";
  }
  if (normalized === "openclaw-reserved") {
    return "openclaw-reserved";
  }
  return normalized === "codex" ? "codex" : "";
}

function normalizeChannelProvider(value: unknown): CodekseiChannelProvider | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "hermes") {
    return "hermes";
  }
  return normalized === "codeksei" ? "codeksei" : "";
}

function normalizeChannel(value: unknown): string {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || "weixin";
}

function resolveCommandOnPath(command: string): string {
  const locator = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(locator, [command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) {
    return "";
  }
  const firstLine = String(result.stdout || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || "";
}

function countHermesWeixinAccounts(accountsDir: string): number {
  try {
    return fs.readdirSync(accountsDir)
      .filter((entry) => entry.endsWith(".json"))
      .filter((entry) => !entry.endsWith(".context-tokens.json"))
      .filter((entry) => !entry.endsWith(".sync.json"))
      .length;
  } catch {
    return 0;
  }
}
