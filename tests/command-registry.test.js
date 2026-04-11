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
  assert.match(help, /timeline 查分类先用 npm run timeline:categories/u);
});
