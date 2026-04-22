const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  listTerminalCommandManifest,
}: typeof import("../src/contracts/command-surface") = require("../src/contracts/command-surface");
const {
  listTerminalDispatchRunnerIds,
}: typeof import("../src/app/terminal-command-dispatch") = require("../src/app/terminal-command-dispatch");

test("terminal dispatch exposes handlers for every manifest runner", () => {
  const supportedRunners = new Set(listTerminalDispatchRunnerIds());
  const missing = Array.from(new Set(
    listTerminalCommandManifest()
      .map((entry) => entry.runner)
      .filter((runner) => runner && !supportedRunners.has(runner))
  )).sort();

  assert.deepEqual(missing, []);
});

test("terminal dispatch runners are all referenced by the command manifest", () => {
  const referenced = new Set<string>(listTerminalCommandManifest().map((entry) => entry.runner));
  const unreferenced = listTerminalDispatchRunnerIds()
    .filter((runner) => !referenced.has(runner))
    .sort();

  assert.deepEqual(unreferenced, []);
});
