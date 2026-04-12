// @ts-nocheck
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

test("actual weixin operations contract stays flexible about Todo vs timeline vs fragment routing", () => {
  const operationsPath = path.join(__dirname, "..", "templates", "weixin-operations.md");
  const content = loadWechatInstructions({
    codekseiHome: "E:/workspace/codeksei",
    userName: "单道杨",
    weixinOperationsFile: operationsPath,
  });

  assert.match(content, /open loop or real follow-up commitment -> today's diary `Todo`/u);
  assert.match(content, /already-finished time block -> `timeline` hard fact/u);
  assert.match(content, /spark \/ idea \/ observation \/ mood -> `fragment`/u);
  assert.match(content, /do not backfill a fake Todo just to close it/u);
  assert.match(content, /The order depends on what kind of thing you are closing, not on a hard Todo-first ritual/u);
  assert.doesNotMatch(content, /state-check|body-double|chief of staff/u);
  assert.doesNotMatch(content, /第一物理动作|先接住，再定向，再推进/u);
});

test("weixin persona template keeps a natural collaboration contract without old prompt-shape slogans", () => {
  const personaPath = path.join(__dirname, "..", "templates", "weixin-instructions.md");
  const content = loadWechatInstructions({
    userName: "单道杨",
    userGender: "male",
    weixinInstructionsFile: personaPath,
  });

  assert.match(content, /默认像微信聊天，不像说明书/u);
  assert.match(content, /当他在整理灵感、回看近况、做复盘/u);
  assert.doesNotMatch(content, /chief of staff|body double/u);
  assert.doesNotMatch(content, /第一物理动作|先接住，再定向，再推进/u);
});

test("wechat instructions fall back to a warm generic person reference instead of 用户", () => {
  const personaPath = path.join(__dirname, "..", "templates", "weixin-instructions.md");
  const operationsPath = path.join(__dirname, "..", "templates", "weixin-operations.md");
  const content = loadWechatInstructions({
    codekseiHome: "E:/workspace/codeksei",
    weixinInstructionsFile: personaPath,
    weixinOperationsFile: operationsPath,
  });

  assert.match(content, /你现在是在微信里陪 眼前这个人/u);
  assert.match(content, /the person you're with/u);
  assert.match(content, /companion note family/u);
  assert.doesNotMatch(content, /用户/u);
  assert.doesNotMatch(content, /life-assistant note family|scope assistant/u);
});
