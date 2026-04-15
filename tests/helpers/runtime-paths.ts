const fs = require("node:fs");
const path = require("node:path");

const repoRoot: string = path.resolve(__dirname, "..", "..");
const distRoot: string = path.join(repoRoot, "dist");
const sourceRoot: string = path.join(repoRoot, "src");
const preferBuiltRuntime: boolean = process.env.CODEKSEI_TEST_RUNTIME_MODE === "built";

function resolveRuntimeRequest(request: unknown, { parentFilename = "" }: { parentFilename?: string } = {}): unknown {
  if (typeof request !== "string" || !request) {
    return request;
  }

  if (path.isAbsolute(request) || path.win32.isAbsolute(request)) {
    return remapSourceAbsolutePath(request) || request;
  }

  if (!request.startsWith(".")) {
    return request;
  }

  const parentDir = parentFilename ? path.dirname(parentFilename) : repoRoot;
  const absoluteRequest = path.resolve(parentDir, request);
  return remapSourceAbsolutePath(absoluteRequest) || request;
}

function resolveRepoRuntimePath(relativePath: string): string {
  const absolutePath = path.resolve(repoRoot, relativePath);
  return remapSourceAbsolutePath(absolutePath) || absolutePath;
}

function resolveRepoRuntimeModule(relativePath: string): string {
  return require.resolve(resolveRepoRuntimePath(relativePath));
}

function remapSourceAbsolutePath(absolutePath: string): string {
  const normalizedCandidate = normalizeForCompare(absolutePath);
  const normalizedSourceRoot = normalizeForCompare(sourceRoot);
  if (
    normalizedCandidate !== normalizedSourceRoot
    && !normalizedCandidate.startsWith(`${normalizedSourceRoot}${path.sep}`)
  ) {
    return "";
  }
  const distCandidate = path.join(distRoot, path.relative(repoRoot, absolutePath));
  const resolvedSourcePath = resolveSourceModulePath(absolutePath);
  const resolvedBuiltPath = resolveBuiltModulePath(distCandidate);
  if (preferBuiltRuntime && resolvedBuiltPath) {
    return resolvedBuiltPath;
  }
  if (resolvedSourcePath) {
    return resolvedSourcePath;
  }
  // Source-first is the default for targeted local test runs so refactors do
  // not accidentally exercise stale build output. The verify pipeline flips
  // this with CODEKSEI_TEST_RUNTIME_MODE=built to prove dist stays in sync.
  return resolvedBuiltPath || distCandidate;
}

function resolveBuiltModulePath(distCandidate: string): string {
  const normalizedCandidate = normalizeBuiltModuleCandidate(distCandidate);
  const candidates = [
    normalizedCandidate,
    `${normalizedCandidate}.js`,
    path.join(normalizedCandidate, "index.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function normalizeBuiltModuleCandidate(distCandidate: string): string {
  if (distCandidate.endsWith(".ts")) {
    return distCandidate.slice(0, -3);
  }
  if (distCandidate.endsWith(".tsx")) {
    return distCandidate.slice(0, -4);
  }
  if (distCandidate.endsWith(".jsx")) {
    return distCandidate.slice(0, -4);
  }
  if (distCandidate.endsWith(".js")) {
    return distCandidate.slice(0, -3);
  }
  return distCandidate;
}

function resolveSourceModulePath(sourceCandidate: string): string {
  const candidates = [
    sourceCandidate,
    `${sourceCandidate}.ts`,
    `${sourceCandidate}.tsx`,
    `${sourceCandidate}.js`,
    path.join(sourceCandidate, "index.ts"),
    path.join(sourceCandidate, "index.tsx"),
    path.join(sourceCandidate, "index.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function normalizeForCompare(targetPath: string): string {
  const normalized = path.normalize(targetPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

module.exports = {
  distRoot,
  repoRoot,
  resolveRepoRuntimeModule,
  resolveRepoRuntimePath,
  resolveRuntimeRequest,
};
