const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  normalizeProjectRadarConfig,
  normalizeReviewSchemaConfig,
  normalizeWorkspaceAliasManifest,
  normalizeWorkspaceBootstrapConfig,
} = require("../src/contracts/config-files");

test("workspace bootstrap config normalizes top-level workspace override file candidates", () => {
  const config = normalizeWorkspaceBootstrapConfig({
    workspaces: {
      " E:/repo ": {
        primaryFiles: [{ path: " README.md ", role: " main " }],
        conditionalFiles: [{ relativePath: " docs/guide.md ", when: " docs " }],
        recentFiles: [{ directory: " docs ", pattern: ".*\\.md", maxCount: "3" }],
      },
    },
  });

  const profile = config.workspaces["E:/repo"];
  assert.ok(profile);
  assert.deepEqual(profile.primaryFiles, [{
    path: "README.md",
    relativePath: "README.md",
    role: "main",
    when: "",
  }]);
  assert.deepEqual(profile.conditionalFiles, [{
    path: "docs/guide.md",
    relativePath: "docs/guide.md",
    role: "",
    when: "docs",
  }]);
  assert.deepEqual(profile.recentFiles, [{
    directory: "docs",
    pattern: ".*\\.md",
    role: "",
    maxCount: 3,
  }]);
});

test("workspace alias manifest trims string fields without inventing extra mappings", () => {
  const manifest = normalizeWorkspaceAliasManifest({
    mappings: [{
      slug: " main ",
      target_path: " E:/repo ",
      alias_path: " C:/alias ",
    }],
  });

  assert.deepEqual(manifest.mappings, [{
    slug: "main",
    target_path: "E:/repo",
    alias_path: "C:/alias",
  }]);
});

test("project radar config normalizes arrays and trims string fields", () => {
  const config = normalizeProjectRadarConfig({
    projects: [{
      slug: " codeksei ",
      title: " Codeksei ",
      repoRoot: " E:/repo ",
      notePath: " notes/codeksei.md ",
      overviewFiles: [" README.md ", 123, ""],
      aliases: [" companion ", null, ""],
      graphReportPath: " graphify-out/GRAPH_REPORT.md ",
      timelineLabel: " work ",
    }],
  });

  assert.deepEqual(config.projects, [{
    slug: "codeksei",
    title: "Codeksei",
    repoRoot: "E:/repo",
    notePath: "notes/codeksei.md",
    overviewFiles: ["README.md"],
    aliases: ["companion"],
    graphReportPath: "graphify-out/GRAPH_REPORT.md",
    timelineLabel: "work",
  }]);
});

test("review schema rejects non-object workspaces", () => {
  assert.throws(
    () => normalizeReviewSchemaConfig({ workspaces: [] }),
    /review schema workspaces must be an object/u,
  );
});
