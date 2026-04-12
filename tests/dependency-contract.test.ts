const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const repoRoot = path.join(__dirname, "..");

test("timeline-for-agent dependency stays pinned to the maintained fork tag", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const packageLock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8")) as {
    packages?: Record<string, { resolved?: string }>;
  };

  assert.equal(
    packageJson.dependencies?.["timeline-for-agent"],
    "github:Sapientropic/timeline-for-agent#codeksei-2026-04-13-17ff1f2",
  );
  assert.match(
    String(packageLock.packages?.["node_modules/timeline-for-agent"]?.resolved || ""),
    /Sapientropic\/timeline-for-agent\.git#17ff1f2f6684a20eb5da216f4e4c41a2d778c5db/u,
  );
});
