const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  inspectPreferredSenderId,
}: typeof import("../src/workspace/default-targets") = require("../src/workspace/default-targets");

test("preferred sender can use a unique neutral context-token candidate", () => {
  const resolution = inspectPreferredSenderId({
    accountId: "acct-1",
    config: {},
    contextTokenSenderIds: [" wx-user "],
  });

  assert.deepEqual(resolution, {
    ambiguous: false,
    candidates: ["wx-user"],
    reason: "unique_context_token",
    source: "context_tokens",
    value: "wx-user",
  });
});

test("preferred sender reports ambiguous neutral context-token candidates", () => {
  const resolution = inspectPreferredSenderId({
    accountId: "acct-1",
    config: {},
    contextTokenSenderIds: ["wx-b", "wx-a", "wx-a", ""],
  });

  assert.deepEqual(resolution, {
    ambiguous: true,
    candidates: ["wx-a", "wx-b"],
    reason: "multiple_context_tokens",
    source: "context_tokens",
    value: "",
  });
});

test("preferred sender does not touch adapter state when neutral candidates are absent", () => {
  const resolution = inspectPreferredSenderId({
    accountId: "acct-1",
    config: {},
  });

  assert.deepEqual(resolution, {
    ambiguous: false,
    candidates: [],
    reason: "missing_sender",
    source: "",
    value: "",
  });
});
