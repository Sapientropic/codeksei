const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { CheckinConfigStore }: typeof import("../src/state/checkin-config-store") = require("../src/state/checkin-config-store");
const {
  formatCheckinRange,
  resolveCheckinConfig,
}: typeof import("../src/state/checkin-config") = require("../src/state/checkin-config");

function createTempCheckinFile() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-checkin-config-"));
  return {
    tempRoot,
    filePath: path.join(tempRoot, "checkin-config.json"),
  };
}

test("CheckinConfigStore persists and reloads checkin interval config", () => {
  const { filePath } = createTempCheckinFile();
  const store = new CheckinConfigStore({ filePath });

  store.setConfig({ minIntervalMs: 5 * 60_000, maxIntervalMs: 45 * 60_000 });

  const reloaded = new CheckinConfigStore({ filePath });
  const config = reloaded.getConfig();
  assert.ok(config);
  assert.equal(config.minIntervalMs, 5 * 60_000);
  assert.equal(config.maxIntervalMs, 45 * 60_000);
  assert.match(config.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("resolveCheckinConfig prefers stored config over env and default", () => {
  const { filePath } = createTempCheckinFile();
  const store = new CheckinConfigStore({ filePath });
  store.setConfig({ minIntervalMs: 7 * 60_000, maxIntervalMs: 21 * 60_000 });

  const resolved = resolveCheckinConfig({
    filePath,
    env: {
      CODEKSEI_CHECKIN_MIN_INTERVAL_MS: "600000",
      CODEKSEI_CHECKIN_MAX_INTERVAL_MS: "1200000",
    },
  });

  assert.equal(resolved.source, "stored");
  assert.equal(formatCheckinRange(resolved), "7m-21m");
});

test("CheckinConfigStore quarantines schema-invalid config", () => {
  const { filePath, tempRoot } = createTempCheckinFile();
  fs.writeFileSync(filePath, JSON.stringify({ minIntervalMs: "bad" }, null, 2), "utf8");

  const store = new CheckinConfigStore({ filePath });

  assert.equal(store.getConfig(), null);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(
    fs.readdirSync(tempRoot).some((entry) => /^checkin-config\.corrupt-.*\.json$/.test(entry)),
    true
  );
});
