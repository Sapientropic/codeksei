const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertBinTargetsUseDist,
  assertPublishedWrappersDoNotRequireSource,
  collectPublishedJsFiles,
} = require("../dist/src/release/check-covered-js-entrypoints.js");
const {
  assertNoLegacyJsTests,
  collectLegacyJsTests,
} = require("../dist/src/release/assert-no-js-tests.js");

test("published JS syntax gate covers dist-only shipped runtime", () => {
  const files = collectPublishedJsFiles();

  assert.ok(files.includes("dist/src/index.js"));
  assert.ok(files.includes("dist/src/contracts/command-surface.js"));
  assert.ok(files.includes("dist/src/adapters/channel/weixin/media-receive.js"));
  assert.ok(files.includes("dist/src/shared/shared-open.js"));
});

test("published bin targets and wrappers resolve through dist implementations", () => {
  const files = collectPublishedJsFiles();
  assert.doesNotThrow(() => assertBinTargetsUseDist());
  assert.doesNotThrow(() => assertPublishedWrappersDoNotRequireSource(files));
});

test("repo JS test guard rejects legacy .test.js files", () => {
  assert.deepEqual(collectLegacyJsTests(), []);
  assert.doesNotThrow(() => assertNoLegacyJsTests());
});
