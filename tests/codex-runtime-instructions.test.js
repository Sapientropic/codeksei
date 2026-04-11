const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { loadWechatInstructions } = require("../src/adapters/runtime/codex");

test("loadWechatInstructions appends local overlays after public defaults", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-instructions-"));
  const personaPath = path.join(tempRoot, "weixin-instructions.md");
  const operationsPath = path.join(tempRoot, "weixin-operations.md");
  const operationsOverlayPath = path.join(tempRoot, "weixin-operations.local.md");

  fs.writeFileSync(personaPath, "PUBLIC PERSONA", "utf8");
  fs.writeFileSync(operationsPath, "PUBLIC OPS {{CODEKSEI_HOME}}", "utf8");
  fs.writeFileSync(operationsOverlayPath, "LOCAL OPS {{CODEKSEI_HOME}}", "utf8");

  const repoHome = "E:/workspace/codeksei";
  const content = loadWechatInstructions({
    codekseiHome: repoHome,
    weixinInstructionsFile: personaPath,
    weixinOperationsFile: operationsPath,
    weixinInstructionsOverlayFile: path.join(tempRoot, "missing-persona.local.md"),
    weixinOperationsOverlayFile: operationsOverlayPath,
  });

  assert.match(content, /^PUBLIC PERSONA/u);
  assert.match(content, /PUBLIC OPS E:\/workspace\/codeksei/u);
  assert.match(content, /LOCAL OPS E:\/workspace\/codeksei/u);
  assert.ok(content.indexOf("LOCAL OPS") > content.indexOf("PUBLIC OPS"));
});
