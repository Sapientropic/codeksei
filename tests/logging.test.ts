const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { formatLogText } = require("../src/core/logging");

test("formatLogText redacts sensitive token-like fields", () => {
  const text = formatLogText([
    "request failed",
    {
      token: "demo",
      nested: {
        authorization: "Bearer test",
      },
    },
    "?context_token=demo",
  ]);

  assert.match(text, /request failed/);
  assert.match(text, /<redacted>/);
  assert.equal(text.includes("demo"), false);
  assert.equal(text.includes("Bearer test"), false);
});

test("formatLogText keeps useful error text while still redacting", () => {
  const error = new Error("boom Bearer test");
  const text = formatLogText([
    error,
    "upload_full_url=https://example.com/upload?encrypted_query_param=test",
  ]);

  assert.match(text, /boom Bearer <redacted>/);
  assert.equal(text.includes("encrypted_query_param=test"), false);
});
