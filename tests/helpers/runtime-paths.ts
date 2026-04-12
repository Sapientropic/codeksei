const fs = require("node:fs");
const path = require("node:path");

const repoRoot: string = path.resolve(__dirname, "..", "..");
const distRoot: string = path.join(repoRoot, "dist");
const sourceRoot: string = path.join(repoRoot, "src");

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
  const resolvedDistPath = resolveBuiltModulePath(distCandidate);
  return resolvedDistPath || distCandidate;
}

function resolveBuiltModulePath(distCandidate: string): string {
  const candidates = [
    distCandidate,
    `${distCandidate}.js`,
    path.join(distCandidate, "index.js"),
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
