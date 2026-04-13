const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveRuntimeEntrypoint,
} = require("../src/contracts/runtime-entrypoints");
const {
  assertPublishedRuntimeArtifactBinTargetsUseDist,
  assertPublishedRuntimeArtifactWrappersDoNotRequireSource,
  collectPublishedRuntimeArtifacts,
} = require("../src/release/assert-published-runtime-artifacts");
const {
  assertNoLegacyJsTests,
  collectLegacyJsTests,
} = require("../src/release/assert-no-js-tests");

test("published runtime artifact guard covers dist-only shipped runtime", () => {
  const files = collectPublishedRuntimeArtifacts();

  assert.ok(files.includes(resolveRuntimeEntrypoint("cli")));
  assert.ok(files.includes(resolveBuiltModuleFromSource("src/contracts/command-surface.ts")));
  assert.ok(files.includes(resolveBuiltModuleFromSource("src/adapters/channel/weixin/media-receive.ts")));
  assert.ok(files.includes(resolveRuntimeEntrypoint("sharedOpen")));
});

test("published bin targets and wrappers resolve through dist implementations", () => {
  const files = collectPublishedRuntimeArtifacts();
  assert.doesNotThrow(() => assertPublishedRuntimeArtifactBinTargetsUseDist());
  assert.doesNotThrow(() => assertPublishedRuntimeArtifactWrappersDoNotRequireSource(files));
});

test("repo JS test guard rejects legacy .test.js files", () => {
  assert.deepEqual(collectLegacyJsTests(), []);
  assert.doesNotThrow(() => assertNoLegacyJsTests());
});

function resolveBuiltModuleFromSource(relativeSourcePath: string): string {
  return relativeSourcePath.replace(/^src\//u, "dist/src/").replace(/\.ts$/u, ".js");
}
