const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  loadSyncBuffer,
  saveSyncBuffer,
} = require("../src/adapters/channel/weixin/sync-buffer-store");

test("sync buffer store writes through the shared atomic text helper", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-sync-buffer-"));
  const config = {
    syncBufferDir: tempRoot,
  };

  saveSyncBuffer(config, "acct-1", "cursor-1");

  assert.equal(loadSyncBuffer(config, "acct-1"), "cursor-1");
  assert.deepEqual(
    fs.readdirSync(tempRoot).filter((entry) => entry.endsWith(".tmp")),
    []
  );
});
