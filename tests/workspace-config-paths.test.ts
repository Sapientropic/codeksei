const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  listWorkspaceScopedRelativePathCandidates,
  resolveWorkspaceScopedConfigFile,
} = require("../src/core/workspace-config-paths");

test("workspace config paths prefer .codeksei and keep .codex as fallback", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-workspace-config-"));
  const primaryDir = path.join(tempRoot, ".codeksei");
  const legacyDir = path.join(tempRoot, ".codex");
  fs.mkdirSync(primaryDir, { recursive: true });
  fs.mkdirSync(legacyDir, { recursive: true });

  const primaryPath = path.join(primaryDir, "code-projects.json");
  const legacyPath = path.join(legacyDir, "code-projects.json");
  fs.writeFileSync(primaryPath, "{\"projects\":[{\"slug\":\"primary\"}]}", "utf8");
  fs.writeFileSync(legacyPath, "{\"projects\":[{\"slug\":\"legacy\"}]}", "utf8");

  assert.equal(
    resolveWorkspaceScopedConfigFile(tempRoot, "code-projects.json").replace(/\\/g, "/"),
    primaryPath.replace(/\\/g, "/"),
  );
});

test("workspace config paths fall back to legacy .codex files when .codeksei is absent", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-workspace-config-legacy-"));
  const legacyDir = path.join(tempRoot, ".codex");
  fs.mkdirSync(legacyDir, { recursive: true });

  const legacyPath = path.join(legacyDir, "review-schema.json");
  fs.writeFileSync(legacyPath, "{\"defaults\":{}}", "utf8");

  assert.equal(
    resolveWorkspaceScopedConfigFile(tempRoot, "review-schema.json").replace(/\\/g, "/"),
    legacyPath.replace(/\\/g, "/"),
  );
});

test("workspace continuity candidates normalize .codeksei first even from legacy-relative input", () => {
  assert.deepEqual(
    listWorkspaceScopedRelativePathCandidates(".codex/timeline/README.md"),
    [".codeksei/timeline/README.md", ".codex/timeline/README.md"],
  );
});

