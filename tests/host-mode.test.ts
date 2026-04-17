const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { readConfig } = require("../src/core/config");
const { createTerminalAppFacade } = require("../src/core/app-terminal-facade");
const { main: runSharedStart } = require("../src/shared/shared-start");

function withPatchedEnv<T>(patch: Record<string, string>, fn: () => T): T {
  const original = { ...process.env };
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, original, patch);
  try {
    return fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, original);
  }
}

async function withPatchedEnvAsync<T>(patch: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const original = { ...process.env };
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, original, patch);
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, original);
  }
}

test("codeksei start fails fast in Hermes hosted mode", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hosted-start-"));
  const config = withPatchedEnv({
    CODEKSEI_STATE_DIR: stateDir,
    CODEKSEI_RUNTIME: "hermes",
    CODEKSEI_CHANNEL_PROVIDER: "hermes",
  }, () => readConfig());

  await assert.rejects(
    createTerminalAppFacade(config).start(),
    /Hosted Mode/u,
  );
});

test("shared:start rejects in Hermes hosted mode", async () => {
  await assert.rejects(
    withPatchedEnvAsync({
      CODEKSEI_RUNTIME: "hermes",
      CODEKSEI_CHANNEL_PROVIDER: "hermes",
    }, async () => runSharedStart()),
    /Hosted Mode/u,
  );
});
