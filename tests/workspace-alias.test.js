const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { resolveCodexWorkspaceRoot } = require("../src/workspace/workspace-alias");

test("resolveCodexWorkspaceRoot falls back to the real workspace when alias path is stale", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-alias-"));
  const targetPath = path.join(tempRoot, "工程问题");
  fs.mkdirSync(targetPath);

  const manifestPath = path.join(tempRoot, "aliases.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    mappings: [
      {
        slug: "engineering-issues",
        target_path: targetPath,
        alias_path: path.join(tempRoot, "missing-alias"),
      },
    ],
  }));

  assert.equal(
    resolveCodexWorkspaceRoot(targetPath, { manifestPath }),
    targetPath.replace(/\\/g, "/")
  );
});

test("resolveCodexWorkspaceRoot keeps using an alias when the alias directory exists", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-alias-"));
  const targetPath = path.join(tempRoot, "工程问题");
  const aliasPath = path.join(tempRoot, "ws-engineering-issues");
  fs.mkdirSync(targetPath);
  fs.mkdirSync(aliasPath);

  const manifestPath = path.join(tempRoot, "aliases.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    mappings: [
      {
        slug: "engineering-issues",
        target_path: targetPath,
        alias_path: aliasPath,
      },
    ],
  }));

  assert.equal(
    resolveCodexWorkspaceRoot(targetPath, { manifestPath }),
    aliasPath.replace(/\\/g, "/")
  );
});
