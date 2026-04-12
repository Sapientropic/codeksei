const test = require("node:test");
const assert = require("node:assert/strict");

const { collectPublishedJsFiles } = require("../scripts/check-covered-js-entrypoints");

test("published JS syntax gate covers shipped bin, contracts, scripts, and adapter edges", () => {
  const files = collectPublishedJsFiles();

  assert.ok(files.includes("bin/codeksei.js"));
  assert.ok(files.includes("bin/cyberboss.js"));
  assert.ok(files.includes("src/contracts/command-surface.js"));
  assert.ok(files.includes("src/adapters/channel/weixin/media-receive.js"));
  assert.ok(files.includes("scripts/shared-open.js"));
});
