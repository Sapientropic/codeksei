import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolvePackageRoot } from "../contracts/path-utils";
import { normalizeText } from "../contracts/text-normalization";
import { resolveHermesHomePath } from "./hermes-repo-local";

interface SkillAssetState {
  path: string;
  exists: boolean;
  hash: string;
  version: string;
}

export interface HermesHostedSkillConfigInput {
  hermesHome?: unknown;
  CODEKSEI_HERMES_HOME?: unknown;
  hermesRepoRoot?: unknown;
  hermesRepoLocalShimPath?: unknown;
  hermesPythonCommand?: unknown;
  CODEKSEI_HERMES_REPO_ROOT?: unknown;
  CODEKSEI_HERMES_REPO_LOCAL_SHIM_PATH?: unknown;
  CODEKSEI_HERMES_PYTHON_COMMAND?: unknown;
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

export interface HermesSkillInstallPreview {
  installedPath: string;
  backupPath: string;
  repoSkillAsset: SkillAssetState;
  installedSkill: SkillAssetState & {
    inSync: boolean;
  };
  willBackup: boolean;
  willCreate: boolean;
  willOverwrite: boolean;
  willWrite: boolean;
}

export function resolveRepoHermesSkillAssetPath(): string {
  const packageRoot = resolvePackageRoot(__dirname);
  return path.join(packageRoot, "templates", "hermes", "skills", "codeksei-companion", "SKILL.md");
}

export function installHermesCompanionSkill(
  config: HermesHostedSkillConfigInput = {},
): HermesSkillInstallResult {
  const preview = previewHermesCompanionSkillInstall(config);
  if (!preview.repoSkillAsset.exists) {
    throw new Error(`repo Hermes skill asset not found: ${preview.repoSkillAsset.path}`);
  }

  fs.mkdirSync(path.dirname(preview.installedPath), { recursive: true });
  if (preview.willBackup) {
    fs.copyFileSync(preview.installedPath, preview.backupPath);
  }
  if (preview.willWrite) {
    fs.writeFileSync(preview.installedPath, fs.readFileSync(preview.repoSkillAsset.path, "utf8"), "utf8");
  }

  const installedAfter = readSkillAssetState(preview.installedPath);
  return {
    installedPath: preview.installedPath,
    created: preview.willCreate && installedAfter.exists,
    overwritten: preview.willOverwrite,
    backupPath: preview.willBackup ? preview.backupPath : "",
    repoSkillAsset: preview.repoSkillAsset,
    installedSkill: {
      ...installedAfter,
      inSync: preview.repoSkillAsset.hash !== "" && preview.repoSkillAsset.hash === installedAfter.hash,
    },
  };
}

export function previewHermesCompanionSkillInstall(
  config: HermesHostedSkillConfigInput = {},
): HermesSkillInstallPreview {
  const hermesHome = resolveHermesHomePath(config);
  const repoSkillAsset = readSkillAssetState(resolveRepoHermesSkillAssetPath());
  const installedPath = resolveInstalledHermesSkillPath(hermesHome);
  const installedBefore = readSkillAssetState(installedPath);
  const backupPath = shouldBackupInstalledSkill(repoSkillAsset, installedBefore)
    ? `${installedPath}.backup-${buildTimestampTag()}`
    : "";
  const willWrite = Boolean(repoSkillAsset.exists && (!installedBefore.exists || installedBefore.hash !== repoSkillAsset.hash));

  return {
    installedPath,
    backupPath,
    repoSkillAsset,
    installedSkill: {
      ...installedBefore,
      inSync: repoSkillAsset.exists && installedBefore.exists && repoSkillAsset.hash === installedBefore.hash,
    },
    willBackup: Boolean(backupPath),
    willCreate: !installedBefore.exists && willWrite,
    willOverwrite: Boolean(installedBefore.exists && willWrite && installedBefore.hash !== repoSkillAsset.hash),
    willWrite,
  };
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
