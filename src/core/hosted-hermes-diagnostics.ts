import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeText } from "../contracts/text-normalization";
import { captureSubprocess, resolveCommandOnPath } from "./subprocess-capture";
import {
  collectHermesRepoLocalReport,
  resolveHermesHomePath,
  type HermesRepoLocalReport,
} from "./hermes-repo-local";
import { resolveHostMode, type HostModeResolution } from "./host-mode-resolution";
import {
  previewHermesCompanionSkillInstall,
  type HermesHostedSkillConfigInput,
} from "./hosted-hermes-skill";
import {
  buildSemanticReviewUnavailableReason,
  normalizeReviewSemanticHost,
  resolveActiveSemanticReviewHost,
  type ReviewSemanticHost,
  type ReviewSemanticHostConfigInput,
} from "./review-semantic-host-policy";

export interface HermesHostedDoctorReport {
  command: string;
  binaryPath: string;
  available: boolean;
  hermesHome: string;
  repoLocal: HermesRepoLocalReport;
  configFile: {
    path: string;
    exists: boolean;
  };
  weixinAccounts: {
    dir: string;
    exists: boolean;
    count: number;
  };
  repoSkillAsset: ReturnType<typeof previewHermesCompanionSkillInstall>["repoSkillAsset"];
  installedSkill: ReturnType<typeof previewHermesCompanionSkillInstall>["installedSkill"];
  semanticReview: {
    requestedHost: ReviewSemanticHost;
    activeHost: Exclude<ReviewSemanticHost, "auto">;
    available: boolean;
    reason: string;
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
    repoLocal: {
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

export interface HostedHermesDiagnosticsConfigInput
  extends HermesHostedSkillConfigInput, ReviewSemanticHostConfigInput {
  workspaceRoot?: unknown;
  hermesCommand?: unknown;
  CODEKSEI_HERMES_COMMAND?: unknown;
}

export function collectHermesHostedDoctorReport(
  config: HostedHermesDiagnosticsConfigInput = {},
): HermesHostedDoctorReport {
  const hermesCommand = resolveHermesCommand(config);
  const hermesHome = resolveHermesHomePath(config);
  const repoLocal = collectHermesRepoLocalReport(config);
  const skillPreview = previewHermesCompanionSkillInstall(config);
  const binaryPath = resolveCommandOnPath(hermesCommand);
  const requestedHost = normalizeReviewSemanticHost(
    config.reviewSemanticHost || config.CODEKSEI_REVIEW_SEMANTIC_HOST,
  );
  const activeHost = resolveActiveSemanticReviewHost(config);
  const semanticReviewAvailable = activeHost === "hermes"
    ? Boolean(binaryPath)
    : false;

  return {
    command: hermesCommand,
    binaryPath,
    available: Boolean(binaryPath),
    hermesHome,
    repoLocal,
    configFile: {
      path: path.join(hermesHome, "config.yaml"),
      exists: fs.existsSync(path.join(hermesHome, "config.yaml")),
    },
    weixinAccounts: {
      dir: path.join(hermesHome, "weixin", "accounts"),
      exists: fs.existsSync(path.join(hermesHome, "weixin", "accounts")),
      count: countHermesWeixinAccounts(path.join(hermesHome, "weixin", "accounts")),
    },
    repoSkillAsset: skillPreview.repoSkillAsset,
    installedSkill: skillPreview.installedSkill,
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
  config: HostedHermesDiagnosticsConfigInput = {},
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

export function runHermesHostedSmoke(
  config: HostedHermesDiagnosticsConfigInput = {},
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
    repoLocal: {
      ok: hermes.repoLocal.ready,
      reason: hermes.repoLocal.ready
        ? ""
        : hermes.repoLocal.reason || "Hermes repo-local checkout / shim 未就绪。",
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
  if (!checks.repoLocal.ok) {
    next.push("补上 Hermes sibling repo（或设置 CODEKSEI_HERMES_REPO_ROOT），并确认 repo-local shim 可见。");
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

  const result = captureSubprocess(command, ["skills", "list"], {
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

function formatHostedExpectation(resolved: HostModeResolution): string {
  return resolved.profile === "hosted-hermes-weixin"
    ? ""
    : `当前不是 Hermes Hosted Mode：profile=${resolved.profile}`;
}

function resolveHermesCommand(config: HostedHermesDiagnosticsConfigInput): string {
  return normalizeText(config.hermesCommand || config.CODEKSEI_HERMES_COMMAND) || "hermes";
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
