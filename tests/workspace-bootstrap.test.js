const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildWorkspaceContinuityInstructions } = require("../src/core/workspace-bootstrap");

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
