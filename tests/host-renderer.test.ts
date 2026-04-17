const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const { normalizeLineEndings } = require("../src/core/text-normalization");

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

  assert.equal(normalizeLineEndings(tracked), normalizeLineEndings(rendered));
  assert.match(rendered, /host claim-checkin/u);
  assert.match(rendered, /host settle-checkin/u);
  assert.match(rendered, /companion remember/u);
  assert.match(rendered, /context briefing/u);
  assert.match(rendered, /## Default Routing/u);
  assert.match(rendered, /onboarding status/u);
  assert.match(rendered, /operator hermes sync-checkin/u);
});

test("hostkit static assets stay shipped at the repo root", () => {
  const repoRoot = path.join(__dirname, "..");
  assert.equal(fs.existsSync(path.join(repoRoot, "CODEKSEI_HOSTKIT.json")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "codeksei.config.json")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "schemas", "hostkit-v2.json")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "schemas", "codeksei-config-v2.json")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "schemas", "hostkit-v1.json")), true);
  assert.equal(fs.existsSync(path.join(repoRoot, "schemas", "codeksei-config-v1.json")), true);
});

test("hostkit static asset carries onboarding and ongoing companion workflow hints", () => {
  const repoRoot = path.join(__dirname, "..");
  const hostkit = JSON.parse(fs.readFileSync(path.join(repoRoot, "CODEKSEI_HOSTKIT.json"), "utf8"));

  assert.deepEqual(hostkit.entrypoints.onboardingStart, ["codeksei", "onboarding", "start", "--format", "json"]);
  assert.deepEqual(hostkit.entrypoints.companionRemember, ["codeksei", "companion", "remember", "--format", "json"]);
  assert.deepEqual(hostkit.entrypoints.contextBriefing, ["codeksei", "context", "briefing", "--format", "json"]);
  assert.equal(hostkit.recommendedWorkflows.some((entry: { id: string }) => entry.id === "first_activation_onboarding"), true);
  assert.equal(hostkit.recommendedWorkflows.some((entry: { id: string }) => entry.id === "ongoing_companion_memory"), true);
});
