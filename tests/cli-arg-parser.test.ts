const test = require("node:test");
const assert = require("node:assert/strict");

const { getCommandArgsSchema } = require("../src/contracts/command-args");
const { parseCliArgs } = require("../src/core/cli-args");

test("cli arg parser handles boolean, string, and repeated string flags", () => {
  const parsed = parseCliArgs([
    "--date", "2026-04-12",
    "--title", "复盘",
    "--tag", "one",
    "--tag", "two",
    "--finalize",
  ], getCommandArgsSchema("timelineEvent"));

  assert.deepEqual(parsed, {
    help: false,
    dryRun: false,
    idempotencyKey: "",
    useStdin: false,
    finalize: true,
    date: "2026-04-12",
    start: "",
    end: "",
    title: "复盘",
    note: "",
    categoryId: "",
    subcategoryId: "",
    eventNodeId: "",
    mode: "merge",
    eventId: "",
    tags: ["one", "two"],
  });
});

test("cli arg parser preserves passthrough timeline screenshot args while ignoring bridge-only flags", () => {
  const parsed = parseCliArgs([
    "--send",
    "--user", "wx-user",
    "--selector", "timeline",
    "--demo",
    "--output", "shot.png",
  ], getCommandArgsSchema("timelineScreenshot"));

  assert.deepEqual(parsed, {
    help: false,
    dryRun: false,
    idempotencyKey: "",
    send: true,
    user: "wx-user",
    outputFile: "shot.png",
    forwardArgs: ["--selector", "timeline"],
  });
});

test("cli arg parser reports missing values consistently", () => {
  assert.throws(
    () => parseCliArgs(["--project"], getCommandArgsSchema("noteAuto")),
    /参数缺少值: --project/u
  );
});
