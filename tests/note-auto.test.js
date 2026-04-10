const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ensureDurableNoteSections,
  inspectDurableNoteRouting,
  resolveDurableNoteRoute,
} = require("../src/core/durable-note-schema");
const { syncNoteFile } = require("../src/core/note-sync");

function setupWorkspaceFixture() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-note-auto-"));
  const codexDir = path.join(workspaceRoot, ".codex");
  const projectNotePath = path.join(workspaceRoot, "项目", "代码工程", "Cyberboss.md");
  const assistantNotePath = path.join(workspaceRoot, "项目", "Cyberboss 生活助理", "README.md");
  const inspirationNotePath = path.join(workspaceRoot, "项目", "Cyberboss 生活助理", "灵感收集.md");

  fs.mkdirSync(codexDir, { recursive: true });
  fs.mkdirSync(path.dirname(projectNotePath), { recursive: true });
  fs.mkdirSync(path.dirname(assistantNotePath), { recursive: true });
  fs.mkdirSync(path.dirname(inspirationNotePath), { recursive: true });

  fs.writeFileSync(projectNotePath, "# Cyberboss\n", "utf8");
  fs.writeFileSync(assistantNotePath, "# Cyberboss 生活助理\n", "utf8");
  fs.writeFileSync(inspirationNotePath, "# 灵感收集\n", "utf8");

  fs.writeFileSync(path.join(codexDir, "code-projects.json"), JSON.stringify({
    projects: [
      {
        slug: "cyberboss",
        title: "Cyberboss",
        aliases: ["微信桥"],
        repoRoot: workspaceRoot,
        notePath: "项目/代码工程/Cyberboss.md",
      },
    ],
  }, null, 2), "utf8");

  fs.writeFileSync(path.join(codexDir, "durable-note-schema.json"), JSON.stringify({
    workspaces: {
      [workspaceRoot.replace(/\\/g, "/")]: {
        projectDefaults: {
          sections: ["当前状态", "最近动作", "下一步", "决策与约束"],
          kinds: {
            status: { section: "当前状态", style: "paragraph", slot: "current-status" },
            recent: { section: "最近动作", style: "bullet", maxItems: 6 },
            next: { section: "下一步", style: "bullet", maxItems: 4 },
          },
        },
        notes: {
          assistant: {
            path: "项目/Cyberboss 生活助理/README.md",
            sections: ["当前定位", "协作节奏", "支持偏好", "能力边界", "当前实验"],
            kinds: {
              preference: { section: "支持偏好", style: "bullet", maxItems: 8 },
            },
          },
          inspiration: {
            path: "项目/Cyberboss 生活助理/灵感收集.md",
            sections: ["当前焦点", "最近灵感", "待孵化", "值得回看"],
            kinds: {
              idea: { section: "最近灵感", style: "bullet", maxItems: 10 },
              status: { section: "当前焦点", style: "paragraph", slot: "current-focus" },
            },
          },
        },
      },
    },
  }, null, 2), "utf8");

  return {
    workspaceRoot,
    projectNotePath,
    assistantNotePath,
    inspirationNotePath,
    config: {
      workspaceRoot,
      projectRadarConfigFile: path.join(codexDir, "code-projects.json"),
      durableNoteSchemaConfigFile: path.join(codexDir, "durable-note-schema.json"),
    },
  };
}

test("note:auto resolves assistant durable note routes from workspace schema", () => {
  const fixture = setupWorkspaceFixture();
  const route = resolveDurableNoteRoute(fixture.config, {
    scope: "assistant",
    kind: "preference",
  });

  assert.equal(route.family, "assistant");
  assert.equal(route.section, "支持偏好");
  assert.equal(route.style, "bullet");
  assert.equal(route.maxItems, 8);
  assert.equal(route.filePath.replace(/\\/g, "/"), fixture.assistantNotePath.replace(/\\/g, "/"));
});

test("note:auto ensures missing project sections before writing a status snapshot", () => {
  const fixture = setupWorkspaceFixture();
  const route = resolveDurableNoteRoute(fixture.config, {
    project: "cyberboss",
    kind: "status",
  });

  const schemaResult = ensureDurableNoteSections(route.filePath, route.sections);
  assert.equal(schemaResult.changed, true);
  assert.deepEqual(schemaResult.createdSections, ["当前状态", "最近动作", "下一步", "决策与约束"]);

  const writeResult = syncNoteFile({
    filePath: route.filePath,
    section: route.section,
    text: "shared bridge 正常，durable note schema 已接入。",
    style: route.style,
    slot: route.slot,
    maxItems: route.maxItems,
  });

  assert.equal(writeResult.changed, true);
  const content = fs.readFileSync(fixture.projectNotePath, "utf8");
  assert.match(content, /## 当前状态/u);
  assert.match(content, /current-status:start -->\nshared bridge 正常，durable note schema 已接入。\n<!-- cyberboss-note-sync:current-status:end -->/u);
  assert.match(content, /## 决策与约束/u);
});

test("note:maybe can inspect inspiration scope and list kinds without writing", () => {
  const fixture = setupWorkspaceFixture();
  const inspection = inspectDurableNoteRouting(fixture.config, {
    scope: "inspiration",
  });

  assert.equal(inspection.mode, "family");
  assert.equal(inspection.family, "inspiration");
  assert.deepEqual(inspection.kinds, ["idea", "status"]);
  assert.equal(inspection.filePath.replace(/\\/g, "/"), fixture.inspirationNotePath.replace(/\\/g, "/"));
});
