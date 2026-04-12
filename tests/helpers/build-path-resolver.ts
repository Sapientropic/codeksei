const Module = require("node:module");
const { resolveRuntimeRequest } = require("./runtime-paths.ts");

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function patchedResolveFilename(request: unknown, parent: { filename?: string } | null, ...rest: unknown[]) {
  const rewritten = resolveRuntimeRequest(request, {
    parentFilename: parent?.filename || "",
  });
  return originalResolveFilename.call(this, rewritten, parent, ...rest);
};
