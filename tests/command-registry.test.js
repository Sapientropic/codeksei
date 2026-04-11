const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTerminalTopicHelp,
  listCommandGroups,
} = require("../src/core/command-registry");

test("timeline write help labels the command as a low-level batch/json entry", () => {
  const action = listCommandGroups()
    .flatMap((group) => group.actions)
    .find((item) => item.action === "timeline.write");

  assert.ok(action);
  assert.match(action.summary, /批量/u);
  assert.match(action.summary, /JSON/u);
  assert.match(action.summary, /低层入口/u);
});

test("timeline topic help still prefers timeline:event for single events", () => {
  const help = buildTerminalTopicHelp("timeline");

  assert.match(help, /单条事件优先用 npm run timeline:event/u);
  assert.match(help, /完整 JSON 对象/u);
  assert.match(help, /timeline 查分类先用 npm run timeline:categories/u);
  assert.match(help, /当前 timezone/u);
});

test("reminder topic help explains local-time interpretation", () => {
  const help = buildTerminalTopicHelp("reminder");

  assert.match(help, /不带 offset 的本地时间按当前 runtime timezone 解释/u);
});

test("reminder topic help clarifies sender id and context token requirements", () => {
  const help = buildTerminalTopicHelp("reminder");

  assert.match(help, /sender id/u);
  assert.match(help, /npm run accounts/u);
  assert.match(help, /context_token/u);
});
