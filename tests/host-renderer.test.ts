const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  renderHermesCompanionSkill,
}: typeof import("../src/host/renderers/hermes-skill") = require("../src/host/renderers/hermes-skill");
const {
  resolveRepoHermesSkillAssetPath,
}: typeof import("../src/host/recipes/hermes/skill") = require("../src/host/recipes/hermes/skill");

test("Hermes companion skill template stays generated from the renderer truth", () => {
  const rendered = renderHermesCompanionSkill();
  const templatePath = resolveRepoHermesSkillAssetPath();
  const tracked = fs.readFileSync(templatePath, "utf8");

  assert.equal(tracked, rendered);
  assert.match(rendered, /host claim-checkin/u);
  assert.match(rendered, /host settle-checkin/u);
  assert.match(rendered, /operator hermes sync-checkin/u);
});

test("hostkit static assets stay shipped at the repo root", () => {
  const repoRoot = path.join(__dirname, "..");
  assert.equal(fs.existsSync(path.join(repoRoot, "CODEKSEI_HOSTKIT.json")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "codeksei.config.json")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "schemas", "hostkit-v1.json")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "schemas", "codeksei-config-v1.json")), true);
});
