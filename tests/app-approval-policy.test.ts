const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRuntimeEntrypointArg }: typeof import("../src/contracts/runtime-entrypoints") = require("../src/contracts/runtime-entrypoints");

const {
  matchesBuiltInCommandPrefix,
  matchesCommandPrefix,
  splitCommandLine,
} = require("../src/core/approval-command-policy");

const PARITY_CASES = [
  {
    label: "note:auto",
    scriptName: "note:auto",
    terminalTokens: ["note", "auto", "--project", "demo"],
  },
  {
    label: "note:maybe",
    scriptName: "note:maybe",
    terminalTokens: ["note", "maybe", "--scope", "companion"],
  },
  {
    label: "review:weekly",
    scriptName: "review:weekly",
    terminalTokens: ["review", "weekly", "--week", "2026-W15"],
  },
  {
    label: "timeline:event",
    scriptName: "timeline:event",
    terminalTokens: ["timeline", "event", "--date", "2026-04-10"],
  },
];

test("approval command policy normalizes quoted shell commands once for every consumer", () => {
  assert.deepEqual(
    splitCommandLine("npm run note:auto -- --project \"My Project\" --kind recent"),
    ["npm", "run", "note:auto", "--", "--project", "My Project", "--kind", "recent"]
  );
});

test("approval command policy preserves allowlist prefix matching after normalization", () => {
  assert.equal(
    matchesCommandPrefix(
      [" npm ", " run ", "review:weekly", "--", "--week", "2026-W15"],
      [["npm", "run", "review:weekly"]]
    ),
    true
  );
  assert.equal(
    matchesCommandPrefix(
      ["codeksei", "system", "send"],
      [["npm", "run", "review:weekly"]]
    ),
    false
  );
});

test("approval command policy keeps npm scripts and direct CLI entrypoints in parity", () => {
  const cliArg = buildRuntimeEntrypointArg("cli");
  for (const entry of PARITY_CASES) {
    assert.equal(
      matchesBuiltInCommandPrefix(["npm", "run", entry.scriptName, "--", ...entry.terminalTokens.slice(2)]),
      true,
      `${entry.label} should auto-approve through npm run`
    );
    assert.equal(
      matchesBuiltInCommandPrefix(["node", cliArg, ...entry.terminalTokens]),
      true,
      `${entry.label} should auto-approve through node ${cliArg}`
    );
    assert.equal(
      matchesBuiltInCommandPrefix(["codeksei", ...entry.terminalTokens]),
      true,
      `${entry.label} should auto-approve through direct codeksei CLI`
    );
    assert.equal(
      matchesBuiltInCommandPrefix(["sh", "-lc", `codeksei ${entry.terminalTokens.join(" ")}`]),
      true,
      `${entry.label} should auto-approve through sh -lc wrapper`
    );
  }
});

test("approval command policy keeps non-whitelisted terminal commands blocked", () => {
  assert.equal(matchesBuiltInCommandPrefix(["codeksei", "system", "send"]), false);
  assert.equal(matchesBuiltInCommandPrefix(["npm", "run", "system:send"]), false);
  assert.equal(matchesBuiltInCommandPrefix(["codeksei", "channel", "send-file", "--path", "C:/tmp/file.txt"]), false);
});

test("approval command policy still recognizes the legacy timeline screenshot shell wrapper", () => {
  assert.equal(matchesBuiltInCommandPrefix(["bash", "./scripts/timeline-screenshot.sh"]), true);
  assert.equal(matchesBuiltInCommandPrefix(["sh", "-lc", "./scripts/timeline-screenshot.sh --send"]), true);
});

test("approval command policy keeps Windows executable aliases in parity with repo entrypoints", () => {
  const cliArg = buildRuntimeEntrypointArg("cli");
  assert.equal(
    matchesBuiltInCommandPrefix(["node.exe", cliArg.replace(/\//g, "\\"), "review", "weekly", "--week", "2026-W15"]),
    true
  );
  assert.equal(
    matchesBuiltInCommandPrefix(["codeksei.cmd", "review", "weekly", "--week", "2026-W15"]),
    true
  );
});
