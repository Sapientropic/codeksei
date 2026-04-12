const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

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
