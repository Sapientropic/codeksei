const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveRepoRuntimePath } = require("./helpers/runtime-paths.ts");

const { buildWorkspaceContinuityInstructions } = require(resolveRepoRuntimePath("src/workspace/workspace-bootstrap.ts"));

test("workspace bootstrap includes local overlay files when present", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-bootstrap-"));
  const codexDir = path.join(tempRoot, ".codex");
  fs.mkdirSync(codexDir, { recursive: true });

  fs.writeFileSync(path.join(tempRoot, "AGENTS.md"), "# Public\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, "AGENTS.local.md"), "# Local\n", "utf8");
  fs.writeFileSync(path.join(tempRoot, "README.md"), "# Readme\n", "utf8");
  fs.writeFileSync(path.join(codexDir, "AGENT_GUIDE.local.md"), "# Local Guide\n", "utf8");

  const instructions = buildWorkspaceContinuityInstructions(tempRoot, {});

  assert.match(instructions, /AGENTS\.md - workspace routing and boundary contract/u);
  assert.match(instructions, /AGENTS\.local\.md - private operator overlay for this workspace/u);
  assert.match(instructions, /\.codex\/AGENT_GUIDE\.local\.md - private agent write\/update overlay for this workspace/u);
});

test("workspace bootstrap treats timeline contract as relevant for cutover bookkeeping too", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-bootstrap-timeline-"));
  const timelineDir = path.join(tempRoot, ".codex", "timeline");
  fs.mkdirSync(timelineDir, { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "AGENTS.md"), "# Public\n", "utf8");
  fs.writeFileSync(path.join(timelineDir, "README.md"), "# Timeline\n", "utf8");

  const instructions = buildWorkspaceContinuityInstructions(tempRoot, {});

  assert.match(
    instructions,
    /If the current user request touches timeline read\/write\/build\/screenshot work, or cutover\/closeout bookkeeping that may append timeline facts\/events, also read:/u
  );
  assert.match(instructions, /\.codex\/timeline\/README\.md - timeline write\/read contract for this workspace/u);
});
