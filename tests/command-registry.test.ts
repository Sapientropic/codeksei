const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTerminalHelpText,
  buildTerminalLeafHelp,
  buildTerminalTopicHelp,
  listCommandGroups,
} = require("../src/core/command-registry");

test("terminal help prefers codeksei CLI syntax and keeps repo scripts in a separate section", () => {
  const help = buildTerminalHelpText();

  assert.match(help, /用法: codeksei <command> \[subcommand\]/u);
  assert.match(help, /codeksei review weekly/u);
  assert.match(help, /仓库脚本 \/ shared 模式/u);
  assert.match(help, /npm run shared:start/u);
  assert.doesNotMatch(help, /用法: npm run/u);
});

test("timeline write help labels the command as a low-level batch/json entry", () => {
  const action = listCommandGroups()
    .flatMap((group: any) => group.actions)
    .find((item: any) => item.action === "timeline.write");

  assert.ok(action);
  assert.match(action.summary, /批量/u);
  assert.match(action.summary, /JSON/u);
  assert.match(action.summary, /低层入口/u);
});

test("timeline topic help still prefers timeline:event for single events", () => {
  const help = buildTerminalTopicHelp("timeline");

  assert.match(help, /单条事件优先用 codeksei timeline event/u);
  assert.match(help, /timeline 查分类先用 codeksei timeline categories/u);
  assert.match(help, /完整 JSON 对象/u);
  assert.match(help, /当前 timezone/u);
});

test("reminder topic help explains local-time interpretation", () => {
  const help = buildTerminalTopicHelp("reminder");

  assert.match(help, /不带 offset 的本地时间按当前 runtime timezone 解释/u);
});

test("reminder topic help clarifies sender id and context token requirements", () => {
  const help = buildTerminalTopicHelp("reminder");

  assert.match(help, /sender id/u);
  assert.match(help, /codeksei accounts/u);
  assert.match(help, /context_token/u);
});

test("review leaf help uses codeksei syntax", () => {
  const help = buildTerminalLeafHelp("review.weekly");

  assert.match(help, /codeksei review weekly/u);
  assert.doesNotMatch(help, /npm run review:weekly/u);
});

test("diary topic help explains captured Todo start time for later timeline accuracy", () => {
  const help = buildTerminalTopicHelp("diary");

  assert.match(help, /todo open 时也会把它记成这条 live block 的开始时间/u);
  assert.match(help, /优先复用同一 Todo 已捕获的开始时间/u);
  assert.match(help, /open loop .*-> todo/u);
  assert.match(help, /事后完成块 -> timeline/u);
  assert.match(help, /灵感碎片 -> fragment/u);
  assert.match(help, /如果只是补记一条已经完成的事实，直接写 timeline 会更顺手/u);
});
