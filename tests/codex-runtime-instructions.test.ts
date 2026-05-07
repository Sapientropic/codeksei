const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");

const { loadWechatInstructions }: typeof import("../src/adapters/runtime/codex") = require("../src/adapters/runtime/codex");
const { parseEnvConfig }: typeof import("../src/core/config") = require("../src/core/config");
const {
  createCompanionMemoryRuntimeStateStore,
  createDefaultCompanionMemoryRuntimeState,
}: typeof import("../src/companion-memory/runtime-state") = require("../src/companion-memory/runtime-state");

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

test("weixin persona switches to english when the companion profile prefers english", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-instructions-english-"));
  const stateDir = path.join(tempRoot, ".codeksei-state");
  fs.mkdirSync(stateDir, { recursive: true });
  createCompanionMemoryRuntimeStateStore({ stateDir }, "wx-user").setState({
    ...createDefaultCompanionMemoryRuntimeState(),
    profileSignals: {
      preferredLanguage: "en",
      gender: "neutral",
    },
  });

  const content = loadWechatInstructions({
    allowedUserIds: ["wx-user"],
    codekseiHome: "E:/workspace/codeksei",
    stateDir,
    workspaceRoot: tempRoot,
    weixinInstructionsFile: path.join(__dirname, "..", "templates", "weixin-instructions.md"),
    weixinOperationsFile: path.join(__dirname, "..", "templates", "weixin-operations.md"),
  });

  assert.match(content, /You are with the person you're with on WeChat right now\./u);
  assert.match(content, /Use diary, timeline, review, reminder, and durable notes as active tools/u);
  assert.match(content, /open loop or real follow-up commitment -> today's diary `Todo`/u);
  assert.doesNotMatch(content, /你现在是在微信里陪/u);
});

test("weixin persona treats CODEKSEI_LOCALE=en as the default user language", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-instructions-locale-english-"));
  const stateDir = path.join(tempRoot, ".codeksei-state");
  fs.mkdirSync(stateDir, { recursive: true });

  const config = parseEnvConfig({
    CODEKSEI_LOCALE: "en",
    CODEKSEI_STATE_DIR: stateDir,
    CODEKSEI_WORKSPACE_ROOT: tempRoot,
  });
  const content = loadWechatInstructions(config);

  assert.equal(config.locale, "en");
  assert.equal(config.userLanguage, "en");
  assert.match(content, /You are with the person you're with on WeChat right now\./u);
  assert.doesNotMatch(content, /你现在是在微信里陪/u);
});

test("weixin persona prefers companion-profile gender over stale config defaults", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-instructions-gender-"));
  const stateDir = path.join(tempRoot, ".codeksei-state");
  fs.mkdirSync(stateDir, { recursive: true });
  createCompanionMemoryRuntimeStateStore({ stateDir }, "wx-user").setState({
    ...createDefaultCompanionMemoryRuntimeState(),
    profileSignals: {
      preferredLanguage: "zh-CN",
      gender: "male",
    },
  });

  const content = loadWechatInstructions({
    allowedUserIds: ["wx-user"],
    stateDir,
    userGender: "female",
    workspaceRoot: tempRoot,
    weixinInstructionsFile: path.join(__dirname, "..", "templates", "weixin-instructions.md"),
  });

  assert.match(content, /当他在整理灵感、回看近况、做复盘/u);
  assert.doesNotMatch(content, /当她在整理灵感、回看近况、做复盘/u);
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
