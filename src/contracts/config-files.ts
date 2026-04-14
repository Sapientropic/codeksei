import { normalizeText } from "./text-normalization";
type PlainObject = Record<string, unknown>;

export interface NormalizedBootstrapFileCandidate extends PlainObject {
  path: string;
  relativePath: string;
  role: string;
  when: string;
}

export interface NormalizedRecentFileSpec extends PlainObject {
  directory: string;
  pattern: string;
  role: string;
  maxCount: number;
}

export interface NormalizedBootstrapProfile extends PlainObject {
  primaryFiles: NormalizedBootstrapFileCandidate[];
  conditionalFiles: NormalizedBootstrapFileCandidate[];
  recentFiles: NormalizedRecentFileSpec[];
}

export interface NormalizedWorkspaceOverrideProfile extends NormalizedBootstrapProfile {
  defaults?: NormalizedBootstrapProfile;
  default?: NormalizedBootstrapProfile;
}

export interface NormalizedWorkspaceBootstrapConfig extends PlainObject {
  defaults?: NormalizedBootstrapProfile;
  default?: NormalizedBootstrapProfile;
  workspaces: Record<string, NormalizedWorkspaceOverrideProfile>;
}

export interface NormalizedWorkspaceAliasMapping extends PlainObject {
  slug: string;
  target_path: string;
  alias_path: string;
}

export interface NormalizedWorkspaceAliasManifest extends PlainObject {
  mappings: NormalizedWorkspaceAliasMapping[];
}

export interface NormalizedWorkspaceSchemaProfile extends PlainObject {
  defaults?: NormalizedBootstrapProfile;
  default?: NormalizedBootstrapProfile;
}

export interface NormalizedWorkspaceSchemaConfig extends PlainObject {
  workspaces: Record<string, NormalizedWorkspaceSchemaProfile>;
}

export interface NormalizedProjectRadarEntry extends PlainObject {
  slug: string;
  title: string;
  repoRoot: string;
  githubRepo: string;
  notePath: string;
  overviewFiles: string[];
  aliases: string[];
  graphReportPath: string;
  timelineLabel: string;
}

export interface NormalizedProjectRadarConfig extends PlainObject {
  projects: NormalizedProjectRadarEntry[];
}

export function normalizeWorkspaceBootstrapConfig(value: unknown): NormalizedWorkspaceBootstrapConfig {
  const source = expectPlainObject(value, "workspace bootstrap");
  return {
    ...source,
    ...(Object.prototype.hasOwnProperty.call(source, "defaults")
      ? { defaults: normalizeBootstrapProfileObject(source.defaults) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(source, "default")
      ? { default: normalizeBootstrapProfileObject(source.default) }
      : {}),
    workspaces: normalizeBootstrapWorkspaceProfileMap(source.workspaces),
  };
}

export function normalizeWorkspaceAliasManifest(value: unknown): NormalizedWorkspaceAliasManifest {
  const source = expectPlainObject(value, "workspace alias manifest");
  if ("mappings" in source && !Array.isArray(source.mappings)) {
    throw new Error("workspace alias manifest mappings must be an array");
  }
  return {
    ...source,
    mappings: Array.isArray(source.mappings)
      ? source.mappings
        .filter((entry: unknown): entry is PlainObject => isPlainObject(entry))
        .map((entry) => ({
          ...entry,
          slug: normalizeText(entry.slug),
          target_path: normalizeText(entry.target_path),
          alias_path: normalizeText(entry.alias_path),
        }))
      : [],
  };
}

export function normalizeReviewSchemaConfig(value: unknown): NormalizedWorkspaceSchemaConfig {
  const source = expectPlainObject(value, "review schema");
  if ("workspaces" in source && !isPlainObject(source.workspaces)) {
    throw new Error("review schema workspaces must be an object");
  }
  return {
    ...source,
    workspaces: normalizeWorkspaceSchemaProfileMap(source.workspaces),
  };
}

export function normalizeDurableNoteSchemaConfig(value: unknown): NormalizedWorkspaceSchemaConfig {
  const source = expectPlainObject(value, "durable note schema");
  if ("workspaces" in source && !isPlainObject(source.workspaces)) {
    throw new Error("durable note schema workspaces must be an object");
  }
  return {
    ...source,
    workspaces: normalizeWorkspaceSchemaProfileMap(source.workspaces),
  };
}

export function normalizeProjectRadarConfig(value: unknown): NormalizedProjectRadarConfig {
  const source = expectPlainObject(value, "project radar config");
  if ("projects" in source && !Array.isArray(source.projects)) {
    throw new Error("project radar config projects must be an array");
  }
  return {
    ...source,
    projects: Array.isArray(source.projects)
      ? source.projects
        .filter((entry: unknown): entry is PlainObject => isPlainObject(entry))
        .map((entry) => ({
          ...entry,
          slug: normalizeText(entry.slug),
          title: normalizeText(entry.title),
          repoRoot: normalizeText(entry.repoRoot),
          githubRepo: normalizeGithubRepo(entry.githubRepo),
          notePath: normalizeText(entry.notePath),
          overviewFiles: Array.isArray(entry.overviewFiles)
            ? entry.overviewFiles.map((item: unknown) => normalizeText(item)).filter(Boolean)
            : [],
          aliases: Array.isArray(entry.aliases)
            ? entry.aliases.map((item: unknown) => normalizeText(item)).filter(Boolean)
            : [],
          graphReportPath: normalizeText(entry.graphReportPath),
          timelineLabel: normalizeText(entry.timelineLabel),
        }))
      : [],
  };
}

function normalizeBootstrapProfileObject(value: unknown): NormalizedBootstrapProfile {
  if (!isPlainObject(value)) {
    return createEmptyBootstrapProfile();
  }
  return {
    ...value,
    primaryFiles: normalizeFileCandidateList(value.primaryFiles),
    conditionalFiles: normalizeFileCandidateList(value.conditionalFiles),
    recentFiles: normalizeRecentFileSpecList(value.recentFiles),
  };
}

function normalizeBootstrapWorkspaceProfileMap(value: unknown): Record<string, NormalizedWorkspaceOverrideProfile> {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, profile]: [string, unknown]) => isPlainObject(profile))
      .map(([workspaceRoot, profile]) => {
        const sourceProfile = profile as PlainObject;
        return [normalizeText(workspaceRoot), {
          ...sourceProfile,
          primaryFiles: normalizeFileCandidateList(sourceProfile.primaryFiles),
          conditionalFiles: normalizeFileCandidateList(sourceProfile.conditionalFiles),
          recentFiles: normalizeRecentFileSpecList(sourceProfile.recentFiles),
          ...(Object.prototype.hasOwnProperty.call(sourceProfile, "defaults")
            ? { defaults: normalizeBootstrapProfileObject(sourceProfile.defaults) }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(sourceProfile, "default")
            ? { default: normalizeBootstrapProfileObject(sourceProfile.default) }
            : {}),
        }];
      })
      .filter(([workspaceRoot]) => Boolean(workspaceRoot)),
  );
}

function normalizeWorkspaceSchemaProfileMap(value: unknown): Record<string, NormalizedWorkspaceSchemaProfile> {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, profile]: [string, unknown]) => isPlainObject(profile))
      .map(([workspaceRoot, profile]) => {
        const sourceProfile = profile as PlainObject;
        return [normalizeText(workspaceRoot), {
          ...sourceProfile,
          ...(Object.prototype.hasOwnProperty.call(sourceProfile, "defaults")
            ? { defaults: normalizeBootstrapProfileObject(sourceProfile.defaults) }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(sourceProfile, "default")
            ? { default: normalizeBootstrapProfileObject(sourceProfile.default) }
            : {}),
        }];
      })
      .filter(([workspaceRoot]) => Boolean(workspaceRoot)),
  );
}

function normalizeFileCandidateList(value: unknown): NormalizedBootstrapFileCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry: unknown): entry is PlainObject => isPlainObject(entry))
    .map((entry) => ({
      ...entry,
      path: normalizeText(entry.path || entry.relativePath),
      relativePath: normalizeText(entry.relativePath || entry.path),
      role: normalizeText(entry.role),
      when: normalizeText(entry.when),
    }))
    .filter((entry) => Boolean(entry.path || entry.relativePath));
}

function normalizeRecentFileSpecList(value: unknown): NormalizedRecentFileSpec[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry: unknown): entry is PlainObject => isPlainObject(entry))
    .map((entry) => ({
      ...entry,
      directory: normalizeText(entry.directory),
      pattern: normalizeText(entry.pattern),
      role: normalizeText(entry.role),
      maxCount: normalizePositiveInteger(entry.maxCount),
    }))
    .filter((entry) => Boolean(entry.directory && entry.pattern));
}

function createEmptyBootstrapProfile(): NormalizedBootstrapProfile {
  return {
    primaryFiles: [],
    conditionalFiles: [],
    recentFiles: [],
  };
}

function expectPlainObject(value: unknown, label: string): PlainObject {
  if (!isPlainObject(value)) {
    throw new Error(`${label} config must be an object`);
  }
  return value;
}

function normalizePositiveInteger(value: unknown): number {
  const numeric = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeGithubRepo(value: unknown): string {
  const normalized = normalizeText(value)
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  return /^[^/\s]+\/[^/\s]+$/u.test(normalized) ? normalized : "";
}

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

