type PlainObject = Record<string, unknown>;

export function normalizeWorkspaceBootstrapConfig(value: unknown): PlainObject {
  const source = expectPlainObject(value, "workspace bootstrap");
  return {
    ...source,
    defaults: normalizeBootstrapProfileObject(source.defaults),
    default: normalizeBootstrapProfileObject(source.default),
    workspaces: normalizeWorkspaceProfileMap(source.workspaces),
  };
}

export function normalizeWorkspaceAliasManifest(value: unknown): PlainObject {
  const source = expectPlainObject(value, "workspace alias manifest");
  if ("mappings" in source && !Array.isArray(source.mappings)) {
    throw new Error("workspace alias manifest mappings must be an array");
  }
  return {
    ...source,
    mappings: Array.isArray(source.mappings)
      ? source.mappings
        .filter((entry: any) => isPlainObject(entry))
        .map((entry: any) => ({
          ...entry,
          slug: normalizeText(entry.slug),
          target_path: normalizeText(entry.target_path),
          alias_path: normalizeText(entry.alias_path),
        }))
      : [],
  };
}

export function normalizeReviewSchemaConfig(value: unknown): PlainObject {
  const source = expectPlainObject(value, "review schema");
  if ("workspaces" in source && !isPlainObject(source.workspaces)) {
    throw new Error("review schema workspaces must be an object");
  }
  return {
    ...source,
    workspaces: normalizeWorkspaceProfileMap(source.workspaces),
  };
}

export function normalizeDurableNoteSchemaConfig(value: unknown): PlainObject {
  const source = expectPlainObject(value, "durable note schema");
  if ("workspaces" in source && !isPlainObject(source.workspaces)) {
    throw new Error("durable note schema workspaces must be an object");
  }
  return {
    ...source,
    workspaces: normalizeWorkspaceProfileMap(source.workspaces),
  };
}

export function normalizeProjectRadarConfig(value: unknown): PlainObject {
  const source = expectPlainObject(value, "project radar config");
  if ("projects" in source && !Array.isArray(source.projects)) {
    throw new Error("project radar config projects must be an array");
  }
  return {
    ...source,
    projects: Array.isArray(source.projects)
      ? source.projects
        .filter((entry: any) => isPlainObject(entry))
        .map((entry: any) => ({
          ...entry,
          slug: normalizeText(entry.slug),
          title: normalizeText(entry.title),
          repoRoot: normalizeText(entry.repoRoot),
          notePath: normalizeText(entry.notePath),
          overviewFiles: Array.isArray(entry.overviewFiles)
            ? entry.overviewFiles.map((item: any) => normalizeText(item)).filter(Boolean)
            : [],
          aliases: Array.isArray(entry.aliases)
            ? entry.aliases.map((item: any) => normalizeText(item)).filter(Boolean)
            : [],
          graphReportPath: normalizeText(entry.graphReportPath),
          timelineLabel: normalizeText(entry.timelineLabel),
        }))
      : [],
  };
}

function normalizeBootstrapProfileObject(value: unknown): PlainObject {
  if (!isPlainObject(value)) {
    return {};
  }
  return {
    ...value,
    primaryFiles: normalizeFileCandidateList(value.primaryFiles),
    conditionalFiles: normalizeFileCandidateList(value.conditionalFiles),
    recentFiles: normalizeRecentFileSpecList(value.recentFiles),
  };
}

function normalizeWorkspaceProfileMap(value: unknown): Record<string, PlainObject> {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, profile]: any) => isPlainObject(profile))
      .map(([workspaceRoot, profile]: any) => {
        const sourceProfile = profile as PlainObject;
        return [normalizeText(workspaceRoot), {
          ...sourceProfile,
          defaults: normalizeBootstrapProfileObject(sourceProfile.defaults),
          default: normalizeBootstrapProfileObject(sourceProfile.default),
        }];
      })
      .filter(([workspaceRoot]: any) => Boolean(workspaceRoot)),
  );
}

function normalizeFileCandidateList(value: unknown): PlainObject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry: any) => isPlainObject(entry))
    .map((entry: any) => ({
      ...entry,
      path: normalizeText(entry.path || entry.relativePath),
      relativePath: normalizeText(entry.relativePath || entry.path),
      role: normalizeText(entry.role),
      when: normalizeText(entry.when),
    }))
    .filter((entry: any) => Boolean(entry.path || entry.relativePath));
}

function normalizeRecentFileSpecList(value: unknown): PlainObject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry: any) => isPlainObject(entry))
    .map((entry: any) => ({
      ...entry,
      directory: normalizeText(entry.directory),
      pattern: normalizeText(entry.pattern),
      role: normalizeText(entry.role),
      maxCount: normalizePositiveInteger(entry.maxCount),
    }))
    .filter((entry: any) => Boolean(entry.directory && entry.pattern));
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

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
