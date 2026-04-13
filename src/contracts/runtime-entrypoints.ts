import * as path from "node:path";

// This file is the single source of truth for concrete published runtime
// filenames. Most repo code should consume these helpers instead of scattering
// `dist/src/*.js` knowledge across source, tests, or maintainer scripts.
const RUNTIME_ENTRYPOINTS = Object.freeze({
  cli: "dist/src/index.js",
  sharedStart: "dist/src/shared/shared-start.js",
  sharedOpen: "dist/src/shared/shared-open.js",
  sharedStatus: "dist/src/shared/shared-status.js",
  sharedSupervisor: "dist/src/shared/shared-supervisor.js",
  sharedWatchdog: "dist/src/shared/shared-watchdog.js",
  maintainerLiveSmoke: "dist/src/maintainer/shared-real-smoke.js",
  timelineCli: "dist/src/timeline/index.js",
  timelineDashboardAppModule: "dist/src/timeline/runtime/timeline/dashboard-app.js",
} as const);

const PUBLISHED_ASSET_FILES = Object.freeze({
  timelineDashboardBundle: "dashboard.js",
  timelineDashboardStylesheet: "dashboard.css",
} as const);

type RuntimeEntrypointMap = typeof RUNTIME_ENTRYPOINTS;
type PublishedAssetMap = typeof PUBLISHED_ASSET_FILES;

export type RuntimeEntrypointId = keyof RuntimeEntrypointMap;
export type PublishedAssetId = keyof PublishedAssetMap;

function listRuntimeEntrypoints(): Array<{ id: RuntimeEntrypointId; relativePath: string }> {
  return Object.entries(RUNTIME_ENTRYPOINTS).map(([id, relativePath]) => ({
    id: id as RuntimeEntrypointId,
    relativePath,
  }));
}

function listPublishedAssetFiles(): Array<{ id: PublishedAssetId; fileName: string }> {
  return Object.entries(PUBLISHED_ASSET_FILES).map(([id, fileName]) => ({
    id: id as PublishedAssetId,
    fileName,
  }));
}

function resolveRuntimeEntrypoint(id: RuntimeEntrypointId): string {
  return RUNTIME_ENTRYPOINTS[id];
}

function resolveRuntimeEntrypointBasename(id: RuntimeEntrypointId): string {
  return path.posix.basename(resolveRuntimeEntrypoint(id));
}

function buildRuntimeEntrypointArg(id: RuntimeEntrypointId): string {
  return `./${resolveRuntimeEntrypoint(id)}`;
}

function resolveRuntimeEntrypointAbsolute(rootDir: string, id: RuntimeEntrypointId): string {
  return path.resolve(rootDir, resolveRuntimeEntrypoint(id));
}

function buildNodeRuntimeInvocation(
  id: RuntimeEntrypointId,
  args: readonly string[] = [],
): string {
  return ["node", buildRuntimeEntrypointArg(id), ...normalizeStringList(args)].join(" ");
}

function matchesRuntimeEntrypoint(candidatePath: unknown, id: RuntimeEntrypointId): boolean {
  const normalizedCandidate = normalizeComparablePath(candidatePath);
  if (!normalizedCandidate) {
    return false;
  }
  return buildComparableRuntimePaths(id).some((expectedPath) => (
    normalizedCandidate === expectedPath
    || normalizedCandidate.endsWith(`/${expectedPath}`)
  ));
}

function commandLineMentionsRuntimeEntrypoint(commandLine: unknown, id: RuntimeEntrypointId): boolean {
  const normalizedCommandLine = normalizeComparablePath(commandLine);
  if (!normalizedCommandLine) {
    return false;
  }
  return buildComparableRuntimePaths(id).some((expectedPath) => normalizedCommandLine.includes(expectedPath));
}

function resolvePublishedAssetFile(id: PublishedAssetId): string {
  return PUBLISHED_ASSET_FILES[id];
}

function normalizeStringList(values: readonly string[]): string[] {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function buildComparableRuntimePaths(id: RuntimeEntrypointId): string[] {
  const normalized = normalizeComparablePath(resolveRuntimeEntrypoint(id));
  return normalized ? [normalized, `./${normalized}`] : [];
}

function normalizeComparablePath(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase()
    : "";
}

export {
  buildNodeRuntimeInvocation,
  buildRuntimeEntrypointArg,
  commandLineMentionsRuntimeEntrypoint,
  listPublishedAssetFiles,
  listRuntimeEntrypoints,
  matchesRuntimeEntrypoint,
  resolvePublishedAssetFile,
  resolveRuntimeEntrypoint,
  resolveRuntimeEntrypointAbsolute,
  resolveRuntimeEntrypointBasename,
};
