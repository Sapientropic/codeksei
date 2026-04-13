const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { formatLogText } = require("../src/core/logging");

test("formatLogText redacts sensitive token-like fields", () => {
  const text = formatLogText([
    "request failed",
    {
      token: "secret-token",
      nested: {
        authorization: "Bearer super-secret",
      },
    },
    "?context_token=abc123",
  ]);

  assert.match(text, /request failed/);
  assert.match(text, /<redacted>/);
  assert.equal(text.includes("secret-token"), false);
  assert.equal(text.includes("super-secret"), false);
  assert.equal(text.includes("abc123"), false);
});

test("formatLogText keeps useful error text while still redacting", () => {
  const error = new Error("boom Bearer super-secret");
  const text = formatLogText([
    error,
    "upload_full_url=https://example.com/upload?encrypted_query_param=raw-secret",
  ]);

  assert.match(text, /boom Bearer <redacted>/);
  assert.equal(text.includes("raw-secret"), false);
});
