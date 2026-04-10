const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveNoteSyncTarget,
  syncNoteContent,
} = require("../src/core/note-sync");

test("note sync prepends bullet entries and dedupes existing text", () => {
  const source = [
    "# Cyberboss",
    "",
    "## 最近动作",
    "- 老动作",
    "- 更老动作",
    "",
  ].join("\n");

  const first = syncNoteContent(source, {
    section: "最近动作",
    text: "新动作",
    style: "bullet",
    maxItems: 2,
  });
  assert.match(first.content, /## 最近动作\n\n- 新动作\n- 老动作/u);
  assert.doesNotMatch(first.content, /更老动作/u);

  const second = syncNoteContent(first.content, {
    section: "最近动作",
    text: "新动作",
    style: "bullet",
    maxItems: 2,
  });
  assert.equal(second.changed, false);
});

test("note sync replaces managed slot blocks inside a section", () => {
  const source = [
    "# Cyberboss",
    "",
    "## 当前状态",
    "<!-- cyberboss-note-sync:current-status:start -->",
    "旧状态",
    "<!-- cyberboss-note-sync:current-status:end -->",
    "",
  ].join("\n");

  const result = syncNoteContent(source, {
    section: "当前状态",
    slot: "current-status",
    text: "新状态",
    style: "paragraph",
  });

  assert.match(result.content, /current-status:start -->\n新状态\n<!-- cyberboss-note-sync:current-status:end/u);
  assert.doesNotMatch(result.content, /旧状态/u);
});

test("note sync can resolve tracked project notes by slug or alias", () => {
  const config = {
    workspaceRoot: "E:/SDY/website-content/Website",
    projectRadarConfigFile: "E:/SDY/website-content/Website/.codex/code-projects.json",
  };
  const target = resolveNoteSyncTarget(config, { project: "微信桥" });
  assert.equal(
    target.filePath,
    "E:/SDY/website-content/Website/项目/代码工程/Cyberboss.md"
  );
});
