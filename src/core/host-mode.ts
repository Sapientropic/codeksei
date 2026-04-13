import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { resolvePackageRoot } from "../contracts/path-utils";
import { normalizeText } from "../contracts/text-normalization";

export type CodekseiRuntimeProvider = "codex" | "hermes" | "openclaw-reserved";
export type CodekseiChannelProvider = "codeksei" | "hermes";
export type CodekseiExecutionMode = "bridge" | "hosted" | "unsupported";
export type HostProfileId = "bridge-codex-weixin" | "hosted-hermes-weixin" | "unsupported";
export type ReviewSemanticHost = "auto" | "codex" | "hermes" | "deterministic";

export interface HostCapabilities {
  ownsBridgeLifecycle: boolean;
  ownsSharedThreadControl: boolean;
  ownsWeixinLogin: boolean;
  supportsHostedSkillInstall: boolean;
  supportsLiveHostedSmoke: boolean;
  supportsSemanticReviewHybrid: boolean;
}

export interface HostModeResolution {
  profile: HostProfileId;
  runtime: CodekseiRuntimeProvider;
  channelProvider: CodekseiChannelProvider;
  channel: string;
  mode: CodekseiExecutionMode;
  supported: boolean;
  reason: string;
  capabilities: HostCapabilities;
}

interface SkillAssetState {
  path: string;
  exists: boolean;
  hash: string;
  version: string;
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
  repoSkillAsset: SkillAssetState;
  installedSkill: SkillAssetState & {
    inSync: boolean;
  };
  semanticReview: {
    requestedHost: ReviewSemanticHost;
    activeHost: Exclude<ReviewSemanticHost, "auto">;
    available: boolean;
    reason: string;
  };
}

export interface HermesSkillInstallResult {
  installedPath: string;
  created: boolean;
  overwritten: boolean;
  backupPath: string;
  repoSkillAsset: SkillAssetState;
  installedSkill: SkillAssetState & {
    inSync: boolean;
  };
}

export interface HermesSkillCatalogProbe {
  command: string;
  available: boolean;
  listed: boolean;
  error: string;
  rawOutput: string;
}

export interface HermesHostedStatusReport {
  hostProfile: HostModeResolution;
  hermes: HermesHostedDoctorReport;
  skillCatalog: HermesSkillCatalogProbe;
}

export interface HermesHostedSmokeReport {
  ok: boolean;
  hostProfile: HostModeResolution;
  checks: {
    doctor: {
      ok: boolean;
      reason: string;
    };
    hermesCommand: {
      ok: boolean;
      reason: string;
    };
    weixinAccounts: {
      ok: boolean;
      reason: string;
    };
    installedSkill: {
      ok: boolean;
      reason: string;
    };
    skillCatalog: {
      ok: boolean;
      reason: string;
    };
    semanticReview: {
      ok: boolean;
      reason: string;
    };
  };
  next: string[];
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
    return createUnsupportedProfile({
      runtime,
      channelProvider,
      channel,
      reason: `当前首个 host-neutral cut 只支持 channel=weixin；当前值是 ${channel || "(empty)"}。`,
    });
  }

  if (runtime === "codex" && channelProvider === "codeksei") {
    return {
      profile: "bridge-codex-weixin",
      runtime,
      channelProvider,
      channel,
      mode: "bridge",
      supported: true,
      reason: "",
      capabilities: buildHostCapabilities("bridge-codex-weixin"),
    };
  }

  if (runtime === "hermes" && channelProvider === "hermes") {
    return {
      profile: "hosted-hermes-weixin",
      runtime,
      channelProvider,
      channel,
      mode: "hosted",
      supported: true,
      reason: "",
      capabilities: buildHostCapabilities("hosted-hermes-weixin"),
    };
  }

  if (runtime === "hermes" && channelProvider === "codeksei") {
    return createUnsupportedProfile({
      runtime,
      channelProvider,
      channel,
      reason: "当前组合尚未实现：runtime=hermes + channelProvider=codeksei。若要用 Hermes，请把 channelProvider 也切到 hermes，让 Hermes 官方 Weixin 托管消息面。",
    });
  }

  if (runtime === "codex" && channelProvider === "hermes") {
    return createUnsupportedProfile({
      runtime,
      channelProvider,
      channel,
      reason: "当前组合尚未实现：runtime=codex + channelProvider=hermes。若要复用 Hermes 官方 Weixin，请同时把 runtime 切到 hermes。",
    });
  }

  if (runtime === "openclaw-reserved") {
    return createUnsupportedProfile({
      runtime,
      channelProvider,
      channel,
      reason: "openclaw-reserved 目前只保留为未来兼容占位；这次 PR 不实现 OpenClaw host path。",
    });
  }

  return createUnsupportedProfile({
    runtime,
    channelProvider,
    channel,
    reason: `当前组合不受支持：runtime=${runtime} channelProvider=${channelProvider} channel=${channel}。`,
  });
}

export function assertBridgeMode(config: Record<string, unknown>, commandLabel: string): HostModeResolution {
  const resolved = resolveHostMode(config);
  if (resolved.profile === "bridge-codex-weixin") {
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
      "请改用 Hermes gateway，并使用 Codeksei 的 Hermes operator / skill 入口。",
      `当前 profile: ${resolved.profile}`,
      `当前组合: runtime=${resolved.runtime}, channelProvider=${resolved.channelProvider}, channel=${resolved.channel}`,
    ].join("\n");
  }
  return [
    `${label} 当前不可用。`,
    resolved.reason || "当前 host 组合不受支持。",
    `当前 profile: ${resolved.profile}`,
    `当前组合: runtime=${resolved.runtime}, channelProvider=${resolved.channelProvider}, channel=${resolved.channel}`,
  ].join("\n");
}

export function resolveRepoHermesSkillAssetPath(): string {
  const packageRoot = resolvePackageRoot(__dirname);
  return path.join(packageRoot, "templates", "hermes", "skills", "codeksei-companion", "SKILL.md");
}

export function collectHermesHostedDoctorReport(
  config: Record<string, unknown> = {},
): HermesHostedDoctorReport {
  const hermesCommand = resolveHermesCommand(config);
  const hermesHome = resolveHermesHome(config);
  const repoSkillAsset = readSkillAssetState(resolveRepoHermesSkillAssetPath());
  const installedSkill = readSkillAssetState(resolveInstalledHermesSkillPath(hermesHome));
  const binaryPath = resolveCommandOnPath(hermesCommand);
  const requestedHost = normalizeReviewSemanticHost(config.reviewSemanticHost || config.CODEKSEI_REVIEW_SEMANTIC_HOST);
  const activeHost = resolveActiveSemanticReviewHost(config);
  const semanticReviewAvailable = activeHost === "hermes"
    ? Boolean(binaryPath)
    : false;

  return {
    command: hermesCommand,
    binaryPath,
    available: Boolean(binaryPath),
    hermesHome,
    configFile: {
      path: path.join(hermesHome, "config.yaml"),
      exists: fs.existsSync(path.join(hermesHome, "config.yaml")),
    },
    weixinAccounts: {
      dir: path.join(hermesHome, "weixin", "accounts"),
      exists: fs.existsSync(path.join(hermesHome, "weixin", "accounts")),
      count: countHermesWeixinAccounts(path.join(hermesHome, "weixin", "accounts")),
    },
    repoSkillAsset,
    installedSkill: {
      ...installedSkill,
      inSync: repoSkillAsset.exists && installedSkill.exists && repoSkillAsset.hash === installedSkill.hash,
    },
    semanticReview: {
      requestedHost,
      activeHost,
      available: semanticReviewAvailable,
      reason: semanticReviewAvailable
        ? ""
        : buildSemanticReviewUnavailableReason(requestedHost, activeHost, Boolean(binaryPath)),
    },
  };
}

export function collectHermesHostedStatusReport(
  config: Record<string, unknown> = {},
): HermesHostedStatusReport {
  const hostProfile = resolveHostMode(config);
  const hermes = collectHermesHostedDoctorReport(config);
  return {
    hostProfile,
    hermes,
    skillCatalog: collectHermesSkillCatalogProbe({
      command: hermes.command,
      cwd: normalizeText(config.workspaceRoot) || process.cwd(),
      available: hermes.available,
    }),
  };
}

export function installHermesCompanionSkill(
  config: Record<string, unknown> = {},
): HermesSkillInstallResult {
  const hermesHome = resolveHermesHome(config);
  const repoSkillAsset = readSkillAssetState(resolveRepoHermesSkillAssetPath());
  const installedPath = resolveInstalledHermesSkillPath(hermesHome);
  const installedBefore = readSkillAssetState(installedPath);
  const backupPath = shouldBackupInstalledSkill(repoSkillAsset, installedBefore)
    ? `${installedPath}.backup-${buildTimestampTag()}`
    : "";

  if (!repoSkillAsset.exists) {
    throw new Error(`repo Hermes skill asset not found: ${repoSkillAsset.path}`);
  }

  fs.mkdirSync(path.dirname(installedPath), { recursive: true });
  if (backupPath) {
    fs.copyFileSync(installedPath, backupPath);
  }
  if (!installedBefore.exists || installedBefore.hash !== repoSkillAsset.hash) {
    fs.writeFileSync(installedPath, fs.readFileSync(repoSkillAsset.path, "utf8"), "utf8");
  }

  const installedAfter = readSkillAssetState(installedPath);
  return {
    installedPath,
    created: !installedBefore.exists && installedAfter.exists,
    overwritten: Boolean(installedBefore.exists && installedBefore.hash !== repoSkillAsset.hash),
    backupPath,
    repoSkillAsset,
    installedSkill: {
      ...installedAfter,
      inSync: repoSkillAsset.hash !== "" && repoSkillAsset.hash === installedAfter.hash,
    },
  };
}

export function runHermesHostedSmoke(
  config: Record<string, unknown> = {},
): HermesHostedSmokeReport {
  const status = collectHermesHostedStatusReport(config);
  const profile = status.hostProfile;
  const hermes = status.hermes;
  const skillCatalog = status.skillCatalog;

  const checks = {
    doctor: {
      ok: profile.profile === "hosted-hermes-weixin" && profile.supported,
      reason: profile.profile === "hosted-hermes-weixin" && profile.supported
        ? ""
        : formatHostedExpectation(profile),
    },
    hermesCommand: {
      ok: hermes.available,
      reason: hermes.available ? "" : "找不到可执行的 Hermes 命令；先检查 CODEKSEI_HERMES_COMMAND 或本机安装。",
    },
    weixinAccounts: {
      ok: hermes.weixinAccounts.count > 0,
      reason: hermes.weixinAccounts.count > 0
        ? ""
        : `未发现 Hermes Weixin 账号：${hermes.weixinAccounts.dir}`,
    },
    installedSkill: {
      ok: hermes.installedSkill.inSync,
      reason: hermes.installedSkill.inSync
        ? ""
        : "Codeksei companion skill 尚未安装，或与当前仓内版本不同步。",
    },
    skillCatalog: {
      ok: skillCatalog.available && skillCatalog.listed,
      reason: skillCatalog.available
        ? (skillCatalog.listed ? "" : "Hermes skills list 里未看到 codeksei-companion。")
        : skillCatalog.error || "无法执行 Hermes skills list。",
    },
    semanticReview: {
      ok: hermes.semanticReview.available,
      reason: hermes.semanticReview.reason,
    },
  };

  const next: string[] = [];
  if (!checks.hermesCommand.ok) {
    next.push("先安装或修正 Hermes CLI 路径。");
  }
  if (!checks.weixinAccounts.ok) {
    next.push("先执行 `hermes gateway setup` 并完成 Weixin QR 登录。");
  }
  if (!checks.installedSkill.ok) {
    next.push("执行 `codeksei operator hermes install-skill` 同步 companion skill。");
  }
  if (checks.hermesCommand.ok && !checks.skillCatalog.ok) {
    next.push("执行 `hermes skills list` 确认 Hermes 已扫描到 codeksei-companion。");
  }
  if (!checks.semanticReview.ok && hermes.semanticReview.activeHost === "hermes") {
    next.push("先确保 Hermes CLI 可执行，再重试 hosted semantic review。");
  }
  if (!next.length) {
    next.push("前置检查已通过；下一步可做真实 Hermes gateway + Weixin assisted smoke。");
  }

  return {
    ok: Object.values(checks).every((entry) => entry.ok),
    hostProfile: profile,
    checks,
    next,
  };
}

export function collectHermesSkillCatalogProbe({
  command,
  cwd,
  available,
}: {
  command: string;
  cwd: string;
  available: boolean;
}): HermesSkillCatalogProbe {
  if (!available) {
    return {
      command,
      available: false,
      listed: false,
      error: "Hermes command unavailable",
      rawOutput: "",
    };
  }

  const result = captureCommand(command, ["skills", "list"], {
    cwd,
    timeoutMs: 30_000,
  });
  const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  const listed = /codeksei-companion/u.test(rawOutput);
  return {
    command,
    available: !result.error && result.status === 0,
    listed,
    error: result.error || (result.status === 0 ? "" : normalizeText(result.stderr) || `exit ${result.status}`),
    rawOutput,
  };
}

export function resolveActiveSemanticReviewHost(config: Record<string, unknown> = {}): Exclude<ReviewSemanticHost, "auto"> {
  const requestedHost = normalizeReviewSemanticHost(config.reviewSemanticHost || config.CODEKSEI_REVIEW_SEMANTIC_HOST);
  if (requestedHost === "deterministic" || requestedHost === "codex" || requestedHost === "hermes") {
    return requestedHost;
  }
  return resolveHostMode(config).profile === "hosted-hermes-weixin" ? "hermes" : "codex";
}

function createUnsupportedProfile({
  runtime,
  channelProvider,
  channel,
  reason,
}: {
  runtime: CodekseiRuntimeProvider;
  channelProvider: CodekseiChannelProvider;
  channel: string;
  reason: string;
}): HostModeResolution {
  return {
    profile: "unsupported",
    runtime,
    channelProvider,
    channel,
    mode: "unsupported",
    supported: false,
    reason,
    capabilities: buildHostCapabilities("unsupported"),
  };
}

function buildHostCapabilities(profile: HostProfileId): HostCapabilities {
  if (profile === "bridge-codex-weixin") {
    return {
      ownsBridgeLifecycle: true,
      ownsSharedThreadControl: true,
      ownsWeixinLogin: true,
      supportsHostedSkillInstall: false,
      supportsLiveHostedSmoke: false,
      supportsSemanticReviewHybrid: true,
    };
  }
  if (profile === "hosted-hermes-weixin") {
    return {
      ownsBridgeLifecycle: false,
      ownsSharedThreadControl: false,
      ownsWeixinLogin: false,
      supportsHostedSkillInstall: true,
      supportsLiveHostedSmoke: true,
      supportsSemanticReviewHybrid: true,
    };
  }
  return {
    ownsBridgeLifecycle: false,
    ownsSharedThreadControl: false,
    ownsWeixinLogin: false,
    supportsHostedSkillInstall: false,
    supportsLiveHostedSmoke: false,
    supportsSemanticReviewHybrid: false,
  };
}

function buildSemanticReviewUnavailableReason(
  requestedHost: ReviewSemanticHost,
  activeHost: Exclude<ReviewSemanticHost, "auto">,
  hermesAvailable: boolean,
): string {
  if (activeHost === "deterministic") {
    return "semantic review host 已显式固定为 deterministic。";
  }
  if (activeHost === "codex") {
    return requestedHost === "codex"
      ? "semantic review host 已显式固定为 codex。"
      : "当前 host profile 默认仍走 codex semantic host。";
  }
  return hermesAvailable
    ? ""
    : "当前需要 Hermes semantic host，但找不到可执行的 Hermes 命令。";
}

function formatHostedExpectation(resolved: HostModeResolution): string {
  return resolved.profile === "hosted-hermes-weixin"
    ? ""
    : `当前不是 Hermes Hosted Mode：profile=${resolved.profile}`;
}

function resolveHermesCommand(config: Record<string, unknown>): string {
  return normalizeText(config.hermesCommand || config.CODEKSEI_HERMES_COMMAND) || "hermes";
}

function resolveHermesHome(config: Record<string, unknown>): string {
  return normalizeText(config.hermesHome || config.CODEKSEI_HERMES_HOME)
    || path.join(os.homedir(), ".hermes");
}

function resolveInstalledHermesSkillPath(hermesHome: string): string {
  return path.join(hermesHome, "skills", "codeksei-companion", "SKILL.md");
}

function shouldBackupInstalledSkill(repoSkillAsset: SkillAssetState, installedSkill: SkillAssetState): boolean {
  return Boolean(repoSkillAsset.exists && installedSkill.exists && repoSkillAsset.hash !== installedSkill.hash);
}

function buildTimestampTag(): string {
  return new Date().toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

function readSkillAssetState(filePath: string): SkillAssetState {
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      exists: false,
      hash: "",
      version: "",
    };
  }

  const content = fs.readFileSync(filePath, "utf8");
  return {
    path: filePath,
    exists: true,
    hash: crypto.createHash("sha256").update(content, "utf8").digest("hex"),
    version: extractFrontmatterVersion(content),
  };
}

function extractFrontmatterVersion(content: string): string {
  const match = /^version:\s*(.+)$/mu.exec(content);
  return normalizeText(match?.[1]);
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

function normalizeReviewSemanticHost(value: unknown): ReviewSemanticHost {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "codex" || normalized === "hermes" || normalized === "deterministic") {
    return normalized;
  }
  return "auto";
}

function resolveCommandOnPath(command: string): string {
  const normalized = normalizeText(command);
  if (!normalized) {
    return "";
  }
  if ((path.isAbsolute(normalized) || normalized.includes(path.sep)) && fs.existsSync(normalized)) {
    return normalized;
  }

  const locator = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(locator, [normalized], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
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

function captureCommand(
  command: string,
  args: string[],
  {
    cwd,
    timeoutMs,
  }: {
    cwd: string;
    timeoutMs: number;
  },
): {
  status: number | null;
  stdout: string;
  stderr: string;
  error: string;
} {
  const resolvedCommand = resolveCommandOnPath(command) || command;
  const useShell = process.platform === "win32" && /\.(cmd|bat)$/iu.test(resolvedCommand);
  const result = spawnSync(resolvedCommand, args, {
    cwd,
    encoding: "utf8",
    shell: useShell,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    status: typeof result.status === "number" ? result.status : null,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    error: result.error instanceof Error ? result.error.message : "",
  };
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
