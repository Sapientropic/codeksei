// The runtime-path shim prefers built output, but targeted local test runs can
// intentionally fall back to source files before dist is refreshed. Register a
// TS require hook once here so those source-only modules still execute.
//
// This hook is intentionally scoped to the current test worker process. Under
// the default `node --test` per-file isolation, that lets in-process test
// imports follow `src/` while spawned CLI smoke checks still execute the real
// published `dist/` entrypoints. Do not treat it as a same-process
// `--test-isolation=none` shim or as a child-process runtime hook.
require("tsx/cjs");

const Module = require("node:module");
const { resolveRuntimeRequest } = require("./runtime-paths.ts");

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function patchedResolveFilename(request: unknown, parent: { filename?: string } | null, ...rest: unknown[]) {
  const rewritten = resolveRuntimeRequest(request, {
    parentFilename: parent?.filename || "",
  });
  return originalResolveFilename.call(this, rewritten, parent, ...rest);
};
