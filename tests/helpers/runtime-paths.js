const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const distRoot = path.join(repoRoot, "dist");
const sourceRoot = path.join(repoRoot, "src");

function resolveRuntimeRequest(request, { parentFilename = "" } = {}) {
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

function resolveRepoRuntimePath(relativePath) {
  const absolutePath = path.resolve(repoRoot, relativePath);
  return remapSourceAbsolutePath(absolutePath) || absolutePath;
}

function resolveRepoRuntimeModule(relativePath) {
  return require.resolve(resolveRepoRuntimePath(relativePath));
}

function remapSourceAbsolutePath(absolutePath) {
  const normalizedCandidate = normalizeForCompare(absolutePath);
  const normalizedSourceRoot = normalizeForCompare(sourceRoot);
  if (
    normalizedCandidate !== normalizedSourceRoot
    && !normalizedCandidate.startsWith(`${normalizedSourceRoot}${path.sep}`)
  ) {
    return "";
  }
  return path.join(distRoot, path.relative(repoRoot, absolutePath));
}

function normalizeForCompare(targetPath) {
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
