const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const repoRoot = path.join(__dirname, "..");
const tasksDir = path.join(repoRoot, "docs", "tasks");
const architectureDoc = fs.readFileSync(path.join(repoRoot, "docs", "architecture.md"), "utf8");
const commandsDoc = fs.readFileSync(path.join(repoRoot, "docs", "commands.md"), "utf8");
const releaseDoc = fs.readFileSync(path.join(repoRoot, "docs", "release.md"), "utf8");
const tasksReadme = fs.readFileSync(path.join(tasksDir, "README.md"), "utf8");
const hardeningPlan = fs.readFileSync(path.join(tasksDir, "archive", "runtime-and-state-hardening-plan.md"), "utf8");
const liveSmokeDoc = fs.readFileSync(path.join(repoRoot, "docs", "maintainer", "live-smoke.md"), "utf8");

test("docs/tasks keeps one active roadmap, one archived snapshot, and excludes local notes from the public index", () => {
  const activePlanPath = path.join(tasksDir, "architecture-and-quality-upgrade-plan.md");
  const archivePlanPath = path.join(tasksDir, "archive", "runtime-and-state-hardening-plan.md");

  assert.equal(fs.existsSync(activePlanPath), true);
  assert.equal(fs.existsSync(archivePlanPath), true);
  assert.match(tasksReadme, /\[`architecture-and-quality-upgrade-plan\.md`\]\(\.\/architecture-and-quality-upgrade-plan\.md\)/u);
  assert.match(tasksReadme, /\[`archive\/runtime-and-state-hardening-plan\.md`\]\(\.\/archive\/runtime-and-state-hardening-plan\.md\)/u);
  assert.match(tasksReadme, /\*\.local\.md/u);
  assert.match(hardeningPlan, /Archived snapshot/u);
  assert.match(
    hardeningPlan,
    /\[`\.\.\/architecture-and-quality-upgrade-plan\.md`\]\(\.\.\/architecture-and-quality-upgrade-plan\.md\)/u,
  );
});

test("architecture and commands docs keep fake-harness smoke distinct from maintainer live smoke", () => {
  assert.match(architectureDoc, /fake Codex app-server \/ fake Weixin HTTP server/u);
  assert.match(architectureDoc, /integration surface/u);
  assert.match(architectureDoc, /maintainer `smoke:shared:real:\*` assisted smoke/u);

  assert.match(commandsDoc, /fake Codex app-server \+ fake Weixin HTTP server/u);
  assert.match(commandsDoc, /fake-harness integration surface/u);
  assert.match(commandsDoc, /maintainer 仍需额外补一次真实账号 smoke/u);
});

test("commands, release, and live smoke docs share the same recorded-result entry", () => {
  assert.match(commandsDoc, /\[docs\/maintainer\/live-smoke\.md\]\(\.\/maintainer\/live-smoke\.md\)/u);
  assert.match(releaseDoc, /\[`docs\/maintainer\/live-smoke\.md`\]\(\.\/maintainer\/live-smoke\.md\)/u);
  assert.match(liveSmokeDoc, /尚无 recorded live smoke 证据/u);
});
