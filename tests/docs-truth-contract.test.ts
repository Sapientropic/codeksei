const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const repoRoot = path.join(__dirname, "..");
const tasksDir = path.join(repoRoot, "docs", "tasks");
const maintainerDir = path.join(repoRoot, "docs", "maintainer");
// `docs/tasks` and `docs/maintainer` are repo-local truth surfaces that may be
// excluded from public history. Keep the contract test shippable by only
// asserting those local docs when the files are actually present.
const readOptionalDoc = (filePath: string): string | null =>
  fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;

const architectureDoc = fs.readFileSync(path.join(repoRoot, "docs", "architecture.md"), "utf8");
const commandsDoc = fs.readFileSync(path.join(repoRoot, "docs", "commands.md"), "utf8");
const releaseDoc = readOptionalDoc(path.join(repoRoot, "docs", "release.md"));
const tasksReadme = readOptionalDoc(path.join(tasksDir, "README.md"));
const hardeningPlan = readOptionalDoc(path.join(tasksDir, "archive", "runtime-and-state-hardening-plan.md"));
const liveSmokeDoc = readOptionalDoc(path.join(maintainerDir, "live-smoke.md"));
const weixinDualStackDoc = readOptionalDoc(path.join(maintainerDir, "weixin-dual-stack.md"));

test("docs/tasks keeps one active roadmap, one archived snapshot, and excludes local notes from the public index", (t) => {
  if (!tasksReadme || !hardeningPlan) {
    t.skip("repo-local docs/tasks truth surface is not present in this checkout");
    return;
  }

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

test("commands, release, and live smoke docs share the same recorded-result entry", (t) => {
  if (!liveSmokeDoc || !releaseDoc) {
    t.skip("repo-local release/live-smoke docs are not present in this checkout");
    return;
  }

  assert.match(commandsDoc, /\[docs\/maintainer\/live-smoke\.md\]\(\.\/maintainer\/live-smoke\.md\)/u);
  assert.match(releaseDoc, /\[`docs\/maintainer\/live-smoke\.md`\]\(\.\/maintainer\/live-smoke\.md\)/u);
  assert.match(liveSmokeDoc, /## 最新记录/u);
  assert.match(liveSmokeDoc, /- 结果：`(?:passed|failed)`/u);
  assert.match(liveSmokeDoc, /- 归档：\[`[^`]+\.md`\]\(\.\/live-smoke\/archive\/[^)]+\.md\)/u);
});

test("architecture doc and maintainer notes keep the Weixin dual-stack route matrix in one visible place", (t) => {
  if (!weixinDualStackDoc) {
    t.skip("repo-local maintainer dual-stack doc is not present in this checkout");
    return;
  }

  assert.match(architectureDoc, /route-matrix\.ts/u);
  assert.match(architectureDoc, /\[`docs\/maintainer\/weixin-dual-stack\.md`\]\(\.\/maintainer\/weixin-dual-stack\.md\)/u);
  assert.match(weixinDualStackDoc, /sendFile/u);
  assert.match(weixinDualStackDoc, /upload_param\/upload_full_url/u);
  assert.match(weixinDualStackDoc, /route-matrix\.ts/u);
});
