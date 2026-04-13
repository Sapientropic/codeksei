const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const repoRoot = path.join(__dirname, "..");

test("timeline runtime stays first-party and no external timeline dependency regresses", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  const packageLock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8")) as {
    packages?: Record<string, { resolved?: string }>;
  };
  const integrationSource = fs.readFileSync(
    path.join(repoRoot, "src", "integrations", "timeline", "index.ts"),
    "utf8",
  );

  assert.equal(packageJson.dependencies?.["timeline-for-agent"], undefined);
  assert.equal(packageLock.packages?.["node_modules/timeline-for-agent"], undefined);
  assert.equal(fs.existsSync(path.join(repoRoot, "src", "timeline", "runtime", "index.js")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "dist", "src", "timeline", "runtime", "index.js")), true);
  assert.match(integrationSource, /codeksei-timeline/u);
  assert.doesNotMatch(integrationSource, /require\.resolve\("timeline-for-agent\/package\.json"\)/u);
});
