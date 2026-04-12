const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  readForeignJsonDocument,
  readJsonStateFile,
  writeForeignTextDocument,
  writeManagedTextStateFile,
  writeJsonStateFile,
}: typeof import("../src/state/json-state") = require("../src/state/json-state");

test("readJsonStateFile returns a cloned fallback when the file is missing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-json-state-"));
  const filePath = path.join(tempRoot, "missing.json");
  const fallback = { bindings: {} };

  const result = readJsonStateFile({
    filePath,
    fallback,
    label: "missing test",
  });

  assert.deepEqual(result, fallback);
  assert.notStrictEqual(result, fallback);
});

test("readJsonStateFile isolates unreadable JSON into a corrupt backup", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-json-corrupt-"));
  const filePath = path.join(tempRoot, "sessions.json");
  fs.writeFileSync(filePath, "{not json", "utf8");

  const result = readJsonStateFile({
    filePath,
    fallback: { bindings: {} },
    label: "session store",
  });

  assert.deepEqual(result, { bindings: {} });
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(
    fs.readdirSync(tempRoot).some((entry) => /^sessions\.corrupt-.*\.json$/.test(entry)),
    true
  );
});

test("readJsonStateFile isolates schema-invalid JSON even when JSON.parse succeeds", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-json-schema-"));
  const filePath = path.join(tempRoot, "sessions.json");
  fs.writeFileSync(filePath, JSON.stringify({ bindings: [] }, null, 2), "utf8");

  const result = readJsonStateFile({
    filePath,
    fallback: { bindings: {} },
    label: "session store",
    validate(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return "session store must be an object";
      }
      const candidate = value as { bindings?: unknown };
      if (!candidate.bindings || typeof candidate.bindings !== "object" || Array.isArray(candidate.bindings)) {
        return "session store bindings must be an object";
      }
      return true;
    },
  });

  assert.deepEqual(result, { bindings: {} });
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(
    fs.readdirSync(tempRoot).some((entry) => /^sessions\.corrupt-.*\.json$/.test(entry)),
    true
  );
});

test("readForeignJsonDocument falls back without quarantining foreign files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-json-foreign-"));
  const filePath = path.join(tempRoot, "timeline-state.json");
  fs.writeFileSync(filePath, "{broken", "utf8");

  const result = readForeignJsonDocument(filePath, { fallback: { ok: false } });

  assert.deepEqual(result, { ok: false });
  assert.equal(fs.existsSync(filePath), true);
  assert.equal(
    fs.readdirSync(tempRoot).some((entry) => entry.includes(".corrupt-")),
    false
  );
});

test("writeJsonStateFile writes the final JSON payload without leaving temp files behind", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-json-write-"));
  const filePath = path.join(tempRoot, "state.json");

  writeJsonStateFile(filePath, {
    ok: true,
    nested: { value: 1 },
  });

  assert.deepEqual(
    JSON.parse(fs.readFileSync(filePath, "utf8")),
    {
      ok: true,
      nested: { value: 1 },
    }
  );
  assert.equal(
    fs.readdirSync(tempRoot).some((entry) => entry.endsWith(".tmp")),
    false
  );
});

test("managed and foreign text helpers both write atomically without leaving temp files behind", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-json-text-write-"));
  const managedFilePath = path.join(tempRoot, "managed.txt");
  const foreignFilePath = path.join(tempRoot, "foreign.md");

  writeManagedTextStateFile(managedFilePath, "managed\n");
  writeForeignTextDocument(foreignFilePath, "# foreign\n");

  assert.equal(fs.readFileSync(managedFilePath, "utf8"), "managed\n");
  assert.equal(fs.readFileSync(foreignFilePath, "utf8"), "# foreign\n");
  assert.equal(
    fs.readdirSync(tempRoot).some((entry) => entry.endsWith(".tmp")),
    false
  );
});
