const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const repoRoot = path.join(__dirname, "..");
const tasksDir = path.join(repoRoot, "docs", "tasks");
const architectureDoc = fs.readFileSync(path.join(repoRoot, "docs", "architecture.md"), "utf8");
const commandsDoc = fs.readFileSync(path.join(repoRoot, "docs", "commands.md"), "utf8");
const hardeningPlan = fs.readFileSync(path.join(tasksDir, "runtime-and-state-hardening-plan.md"), "utf8");

test("docs/tasks keeps the active roadmap link live and the old hardening plan archived", () => {
  const activePlanPath = path.join(tasksDir, "architecture-and-quality-upgrade-plan.md");
  assert.equal(fs.existsSync(activePlanPath), true);
  assert.match(hardeningPlan, /Archived snapshot/u);
  assert.match(
    hardeningPlan,
    /\[`architecture-and-quality-upgrade-plan\.md`\]\(\.\/architecture-and-quality-upgrade-plan\.md\)/u,
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
