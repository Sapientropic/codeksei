const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  readJsonStateFile,
  writeJsonStateFile,
} = require("../src/core/json-state");

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
      if (!value.bindings || typeof value.bindings !== "object" || Array.isArray(value.bindings)) {
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
