const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  resolveNoteSyncTarget,
  syncNoteContent,
} = require("../src/core/note-sync");

test("note sync prepends bullet entries and dedupes existing text", () => {
  const source = [
    "# Codeksei",
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
    "# Codeksei",
    "",
    "## 当前状态",
    "<!-- codeksei-note-sync:current-status:start -->",
    "旧状态",
    "<!-- codeksei-note-sync:current-status:end -->",
    "",
  ].join("\n");

  const result = syncNoteContent(source, {
    section: "当前状态",
    slot: "current-status",
    text: "新状态",
    style: "paragraph",
  });

  assert.match(result.content, /current-status:start -->\n新状态\n<!-- codeksei-note-sync:current-status:end/u);
  assert.doesNotMatch(result.content, /旧状态/u);
});

test("note sync can resolve tracked project notes by slug or alias", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-note-sync-"));
  const projectRadarConfigFile = path.join(workspaceRoot, ".codex", "code-projects.json");
  const repoRoot = path.join(workspaceRoot, "repos", "codeksei");
  fs.mkdirSync(path.dirname(projectRadarConfigFile), { recursive: true });
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.writeFileSync(projectRadarConfigFile, JSON.stringify({
    projects: [
      {
        slug: "codeksei",
        title: "Codeksei",
        aliases: ["微信桥"],
        repoRoot,
        notePath: "项目/代码工程/Codeksei.md",
      },
    ],
  }), "utf8");

  const config = {
    workspaceRoot,
    projectRadarConfigFile,
  };
  const target = resolveNoteSyncTarget(config, { project: "微信桥" });
  assert.equal(
    target.filePath,
    path.join(workspaceRoot, "项目", "代码工程", "Codeksei.md").replace(/\\/g, "/")
  );
});

test("note sync keeps Windows absolute note paths stable across platforms", () => {
  const target = resolveNoteSyncTarget(
    { workspaceRoot: "E:/workspace/Website" },
    { path: "E:/workspace/Website/项目/代码工程/Codeksei.md" }
  );

  assert.equal(target.filePath, "E:/workspace/Website/项目/代码工程/Codeksei.md");
});
