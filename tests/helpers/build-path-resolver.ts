// The runtime-path shim stays source-first for local targeted runs, but verify
// can flip it to built output with CODEKSEI_TEST_RUNTIME_MODE=built. Register a
// TS require hook once here so source-side tests can still execute either way.
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
