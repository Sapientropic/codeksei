import { normalizeText } from "../core/text-normalization";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  normalizeWorkspaceBootstrapConfig,
  type NormalizedBootstrapProfile,
  type NormalizedWorkspaceBootstrapConfig,
  type NormalizedWorkspaceOverrideProfile,
} from "../contracts/config-files";
import { loadJsonConfig } from "../core/config-loader";

interface WorkspaceBootstrapOptions {
  workspaceBootstrapConfigFile?: unknown;
}

interface FileCandidate {
  relativePath: string;
  role: string;
  when: string;
}

interface RecentFileSpec {
  directory: string;
  pattern: RegExp;
  role: string;
  maxCount: number;
}

interface WorkspaceBootstrapProfile {
  primaryFiles: FileCandidate[];
  conditionalFiles: FileCandidate[];
  recentFiles: RecentFileSpec[];
}

interface CollectedFile {
  absolutePath: string;
  role: string;
  when: string;
}

const DEFAULT_BOOTSTRAP_PROFILE: WorkspaceBootstrapProfile = Object.freeze({
  primaryFiles: [
    {
      relativePath: "AGENTS.md",
      role: "workspace routing and boundary contract",
      when: "",
    },
    {
      relativePath: "AGENTS.local.md",
      role: "private operator overlay for this workspace",
      when: "",
    },
    {
      relativePath: "README.md",
      role: "workspace overview and operating instructions",
      when: "",
    },
    {
      relativePath: "Home.md",
      role: "workspace home and current control page",
      when: "",
    },
    {
      relativePath: ".codex/AGENT_GUIDE.md",
      role: "agent write/update rules for this workspace",
      when: "",
    },
    {
      relativePath: ".codex/AGENT_GUIDE.local.md",
      role: "private agent write/update overlay for this workspace",
      when: "",
    },
  ],
  conditionalFiles: [
    {
      relativePath: ".codex/timeline/README.md",
      role: "timeline write/read contract for this workspace",
      when: "timeline read/write/build/screenshot work, or cutover/closeout bookkeeping that may append timeline facts/events",
    },
  ],
  recentFiles: [],
});

export function buildWorkspaceContinuityInstructions(
  workspaceRoot: unknown,
  config: WorkspaceBootstrapOptions = {},
): string {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return "";
  }

  const profile = resolveWorkspaceBootstrapProfile(normalizedWorkspaceRoot, config);
  // Keep the bootstrap read set intentionally narrow and curated. This path is
  // supposed to rehydrate durable context for a thread, not silently turn a
  // workspace switch into a broad vault scan.
  const primaryFiles = collectExistingFiles(normalizedWorkspaceRoot, profile.primaryFiles);
  const recentFiles = collectRecentFiles(normalizedWorkspaceRoot, profile.recentFiles);
  const conditionalFiles = collectExistingFiles(normalizedWorkspaceRoot, profile.conditionalFiles);

  const primarySequence = [...primaryFiles, ...recentFiles];
  if (!primarySequence.length && !conditionalFiles.length) {
    return "";
  }

  const lines = [
    "This workspace keeps durable continuity in local notes.",
    `Current workspace root: ${normalizedWorkspaceRoot}`,
  ];

  if (primarySequence.length) {
    lines.push(
      "Before your first substantive reply in this workspace, recover context from these files in order:",
    );
    for (const [index, file] of primarySequence.entries()) {
      lines.push(`${index + 1}. ${file.absolutePath} - ${file.role}`);
    }
  }

  for (const group of groupConditionalFiles(conditionalFiles)) {
    lines.push("");
    lines.push(`If the current user request touches ${group.when}, also read:`);
    for (const file of group.files) {
      lines.push(`- ${file.absolutePath} - ${file.role}`);
    }
  }

  lines.push("");
  lines.push("Use AGENTS / Home / workspace README as durable truth.");
  if (recentFiles.length) {
    lines.push("Treat any auto-discovered recent note only as recent context, not as a permanent rulebook.");
  }
  lines.push("Do not paste these file paths or summarize them back unless the user explicitly asks.");
  return lines.join("\n").trim();
}

function resolveWorkspaceBootstrapProfile(
  workspaceRoot: string,
  config: WorkspaceBootstrapOptions = {},
): WorkspaceBootstrapProfile {
  const externalConfig = loadWorkspaceBootstrapConfig(config);
  const externalDefaults = externalConfig.defaults || externalConfig.default;
  const baseProfile = mergeProfiles(DEFAULT_BOOTSTRAP_PROFILE, externalDefaults);
  const workspaceOverrides = selectWorkspaceOverrides(externalConfig.workspaces, workspaceRoot);
  return mergeProfiles(baseProfile, workspaceOverrides);
}

function loadWorkspaceBootstrapConfig(config: WorkspaceBootstrapOptions = {}): NormalizedWorkspaceBootstrapConfig {
  const filePath = normalizeText(config.workspaceBootstrapConfigFile);
  if (!filePath) {
    return { workspaces: {} };
  }
  return loadJsonConfig<NormalizedWorkspaceBootstrapConfig>({
    filePath,
    label: "workspace bootstrap",
    normalize: normalizeWorkspaceBootstrapConfig,
    fallback: { workspaces: {} },
    missing: "fallback",
    invalid: "fallback",
  });
}

function selectWorkspaceOverrides(
  workspaces: Record<string, NormalizedWorkspaceOverrideProfile> | undefined,
  workspaceRoot: string,
): NormalizedWorkspaceOverrideProfile | null {
  if (!workspaces || typeof workspaces !== "object") {
    return null;
  }
  const normalizedWorkspaceRoot = normalizeDisplayPath(workspaceRoot);
  for (const [candidateRoot, profile] of Object.entries(workspaces)) {
    if (normalizeDisplayPath(candidateRoot) === normalizedWorkspaceRoot) {
      return profile;
    }
  }
  return null;
}

function mergeProfiles(
  baseProfile: WorkspaceBootstrapProfile,
  overrideProfile: Partial<NormalizedBootstrapProfile> | null | undefined,
): WorkspaceBootstrapProfile {
  const override = isRecord(overrideProfile) ? overrideProfile : {};
  return {
    primaryFiles: hasOwn(override, "primaryFiles")
      ? normalizeFileCandidates(override.primaryFiles)
      : normalizeFileCandidates(baseProfile.primaryFiles),
    conditionalFiles: hasOwn(override, "conditionalFiles")
      ? normalizeFileCandidates(override.conditionalFiles)
      : normalizeFileCandidates(baseProfile.conditionalFiles),
    recentFiles: hasOwn(override, "recentFiles")
      ? normalizeRecentFileSpecs(override.recentFiles)
      : normalizeRecentFileSpecs(baseProfile.recentFiles),
  };
}

function normalizeFileCandidates(rawCandidates: unknown): FileCandidate[] {
  const candidates = Array.isArray(rawCandidates) ? rawCandidates : [];
  return candidates
    .map((candidate) => normalizeFileCandidate(candidate))
    .filter((candidate): candidate is FileCandidate => Boolean(candidate));
}

function normalizeFileCandidate(rawCandidate: unknown): FileCandidate | null {
  const candidate = isRecord(rawCandidate) ? rawCandidate : {};
  const relativePath = normalizeRelativePath(candidate.path || candidate.relativePath);
  if (!relativePath) {
    return null;
  }
  return {
    relativePath,
    role: normalizeText(candidate.role) || "workspace entry file",
    when: normalizeText(candidate.when),
  };
}

function normalizeRecentFileSpecs(rawSpecs: unknown): RecentFileSpec[] {
  const specs = Array.isArray(rawSpecs) ? rawSpecs : [];
  return specs
    .map((spec) => normalizeRecentFileSpec(spec))
    .filter((spec): spec is RecentFileSpec => Boolean(spec));
}

function normalizeRecentFileSpec(rawSpec: unknown): RecentFileSpec | null {
  const spec = isRecord(rawSpec) ? rawSpec : {};
  const directory = normalizeRelativePath(spec.directory);
  const patternText = normalizeText(spec.pattern);
  if (!directory || !patternText) {
    return null;
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(patternText);
  } catch {
    return null;
  }
  const maxCount = Math.max(1, Number.parseInt(String(spec.maxCount ?? ""), 10) || 1);
  return {
    directory,
    pattern,
    role: normalizeText(spec.role) || "newest workspace note",
    maxCount,
  };
}

function collectExistingFiles(workspaceRoot: string, candidates: FileCandidate[]): CollectedFile[] {
  const files: CollectedFile[] = [];
  for (const candidate of candidates) {
    const relativePath = normalizeRelativePath(candidate.relativePath);
    if (!relativePath) {
      continue;
    }
    const absolutePath = path.join(workspaceRoot, ...relativePath.split("/"));
    if (!isReadableFile(absolutePath)) {
      continue;
    }
    files.push({
      absolutePath: normalizeDisplayPath(absolutePath),
      role: normalizeText(candidate.role) || "workspace entry file",
      when: normalizeText(candidate.when),
    });
  }
  return files;
}

function collectRecentFiles(workspaceRoot: string, specs: RecentFileSpec[]): CollectedFile[] {
  const files: CollectedFile[] = [];
  for (const spec of specs) {
    const directoryPath = path.join(workspaceRoot, ...String(spec.directory || "").split("/"));
    if (!isReadableDirectory(directoryPath)) {
      continue;
    }
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && spec.pattern.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))
      .slice(0, spec.maxCount);
    for (const entryName of entries) {
      files.push({
        absolutePath: normalizeDisplayPath(path.join(directoryPath, entryName)),
        role: spec.role,
        when: "",
      });
    }
  }
  return files;
}

function groupConditionalFiles(files: CollectedFile[]): Array<{ when: string; files: CollectedFile[] }> {
  const groups: Array<{ when: string; files: CollectedFile[] }> = [];
  const byWhen = new Map<string, CollectedFile[]>();
  for (const file of files) {
    const when = normalizeText(file.when);
    if (!when) {
      continue;
    }
    if (!byWhen.has(when)) {
      byWhen.set(when, []);
      groups.push({
        when,
        files: byWhen.get(when)!,
      });
    }
    byWhen.get(when)!.push(file);
  }
  return groups;
}

function isReadableFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isReadableDirectory(directoryPath: string): boolean {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function normalizeWorkspaceRoot(workspaceRoot: unknown): string {
  const normalized = normalizeText(workspaceRoot);
  if (!normalized) {
    return "";
  }
  return normalizeDisplayPath(normalized);
}

function normalizeRelativePath(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((segment) => normalizeText(segment))
      .filter(Boolean)
      .join("/");
  }
  return normalizeText(value)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function normalizeDisplayPath(targetPath: unknown): string {
  return normalizeText(targetPath).replace(/\\/g, "/");
}

function hasOwn(value: unknown, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

