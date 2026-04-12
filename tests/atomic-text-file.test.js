const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { writeTextFileAtomically } = require("../src/state/json-state");

test("writeTextFileAtomically replaces text without leaving tmp files behind", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-atomic-text-"));
  const filePath = path.join(tempRoot, "note.md");

  writeTextFileAtomically(filePath, "hello\n", { encoding: "utf8" });
  writeTextFileAtomically(filePath, "world\n", { encoding: "utf8" });

  assert.equal(fs.readFileSync(filePath, "utf8"), "world\n");
  assert.deepEqual(
    fs.readdirSync(tempRoot).filter((entry) => entry.endsWith(".tmp")),
    []
  );
});
