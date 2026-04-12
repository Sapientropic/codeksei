const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

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
