const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

const {
  ensureDurableNoteSections,
  inspectDurableNoteRouting,
  resolveDurableNoteRoute,
} = require("../src/notes/durable-note-schema");

function setupDurableNoteFixture() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-durable-note-"));
  const codexDir = path.join(workspaceRoot, ".codex");
  const companionNotePath = path.join(workspaceRoot, "notes", "Companion.md");
  fs.mkdirSync(codexDir, { recursive: true });
  fs.mkdirSync(path.dirname(companionNotePath), { recursive: true });
  fs.writeFileSync(companionNotePath, "# Companion\n", "utf8");

  const config = {
    workspaceRoot,
    durableNoteSchemaConfigFile: path.join(codexDir, "durable-note-schema.json"),
    projectRadarConfigFile: path.join(codexDir, "code-projects.json"),
  };
  fs.writeFileSync(config.projectRadarConfigFile, JSON.stringify({
    projects: [
      {
        slug: "codeksei",
        title: "Codeksei",
        repoRoot: workspaceRoot,
        notePath: "notes/project.md",
      },
    ],
  }, null, 2), "utf8");
  fs.writeFileSync(config.durableNoteSchemaConfigFile, JSON.stringify({
    workspaces: {
      [workspaceRoot.replace(/\\/g, "/")]: {
        projectDefaults: {
          sections: ["当前状态", "最近动作", "下一步"],
          kinds: {
            status: { section: "当前状态", style: "paragraph", slot: "status-slot" },
          },
        },
        notes: {
          companion: {
            label: "Companion",
            path: "notes\\Companion.md",
            sections: ["当前定位", "支持偏好"],
            kinds: {
              preference: { section: "支持偏好", style: "bullet", maxItems: 8 },
            },
          },
        },
      },
      "E:/other-workspace": {
        projectDefaults: {
          sections: ["Wrong"],
          kinds: {},
        },
      },
    },
  }, null, 2), "utf8");

  return {
    companionNotePath,
    config,
    workspaceRoot,
  };
}

test("resolveDurableNoteRoute matches workspace profiles after path normalization", () => {
  const fixture = setupDurableNoteFixture();
  const route = resolveDurableNoteRoute({
    ...fixture.config,
    workspaceRoot: fixture.workspaceRoot.replace(/\//g, "\\"),
  }, {
    scope: "companion",
    kind: "preference",
  });

  assert.equal(route.family, "companion");
  assert.equal(route.section, "支持偏好");
  assert.equal(route.maxItems, 8);
  assert.equal(route.filePath.replace(/\\/g, "/"), fixture.companionNotePath.replace(/\\/g, "/"));
});

test("inspectDurableNoteRouting rejects unknown scopes with the available-scope hint", () => {
  const fixture = setupDurableNoteFixture();

  assert.throws(
    () => inspectDurableNoteRouting(fixture.config, { scope: "missing" }),
    /找不到 durable note scope: missing/u,
  );
});

test("resolveDurableNoteRoute rejects unresolved tracked projects", () => {
  const fixture = setupDurableNoteFixture();

  assert.throws(
    () => resolveDurableNoteRoute(fixture.config, {
      project: "missing-project",
      kind: "status",
    }),
    /找不到代码项目/u,
  );
});

test("ensureDurableNoteSections is idempotent once every required section exists", () => {
  const fixture = setupDurableNoteFixture();

  const first = ensureDurableNoteSections(fixture.companionNotePath, ["当前定位", "支持偏好"]);
  const second = ensureDurableNoteSections(fixture.companionNotePath, ["当前定位", "支持偏好"]);

  assert.equal(first.changed, true);
  assert.deepEqual(first.createdSections, ["当前定位", "支持偏好"]);
  assert.equal(second.changed, false);
  assert.deepEqual(second.createdSections, []);
  const content = fs.readFileSync(fixture.companionNotePath, "utf8");
  assert.match(content, /## 当前定位/u);
  assert.match(content, /## 支持偏好/u);
});

test("resolveDurableNoteRoute falls back to a state-dir companion profile when schema is missing", () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-durable-note-fallback-"));
  const stateDir = path.join(workspaceRoot, ".codeksei-state");
  const route = resolveDurableNoteRoute({
    allowedUserIds: ["wx-user"],
    stateDir,
    workspaceRoot,
  }, {
    scope: "companion",
    kind: "preference",
  });

  assert.equal(route.family, "companion");
  assert.equal(route.section, "支持偏好");
  assert.equal(route.createIfMissing, true);
  assert.match(route.filePath.replace(/\\/g, "/"), /\/\.codeksei-state\/companions\/wx-user\/profile\.md$/u);
});
