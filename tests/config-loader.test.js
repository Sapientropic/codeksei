const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeReviewSchemaConfig,
  normalizeWorkspaceBootstrapConfig,
} = require("../src/contracts/config-files");
const { loadJsonConfig } = require("../src/core/config-loader");

test("config loader falls back for missing optional workspace bootstrap config", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-config-loader-"));
  const filePath = path.join(tempRoot, "missing-bootstrap.json");

  const loaded = loadJsonConfig({
    filePath,
    label: "workspace bootstrap",
    normalize: normalizeWorkspaceBootstrapConfig,
    fallback: {},
    missing: "fallback",
    invalid: "fallback",
  });

  assert.deepEqual(loaded, {});
});

test("config loader throws for invalid review schema json", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-config-loader-"));
  const filePath = path.join(tempRoot, "review-schema.json");
  fs.writeFileSync(filePath, "{bad json", "utf8");

  assert.throws(
    () => loadJsonConfig({
      filePath,
      label: "review schema",
      normalize: normalizeReviewSchemaConfig,
      fallback: {},
      missing: "fallback",
      invalid: "throw",
    }),
    /review schema is not valid JSON/u
  );
});

test("config loader re-reads cached json after the file changes", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-config-loader-"));
  const filePath = path.join(tempRoot, "review-schema.json");
  fs.writeFileSync(filePath, JSON.stringify({ workspaces: { "E:/repo": {} } }, null, 2), "utf8");

  const first = loadJsonConfig({
    filePath,
    label: "review schema",
    normalize: normalizeReviewSchemaConfig,
    fallback: {},
    missing: "fallback",
    invalid: "throw",
  });
  assert.deepEqual(Object.keys(first.workspaces), ["E:/repo"]);

  await new Promise((resolve) => setTimeout(resolve, 20));
  fs.writeFileSync(filePath, JSON.stringify({ workspaces: { "E:/repo-2": {} } }, null, 2), "utf8");

  const second = loadJsonConfig({
    filePath,
    label: "review schema",
    normalize: normalizeReviewSchemaConfig,
    fallback: {},
    missing: "fallback",
    invalid: "throw",
  });
  assert.deepEqual(Object.keys(second.workspaces), ["E:/repo-2"]);
});
