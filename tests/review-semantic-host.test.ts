const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { maybeGenerateSemanticReview } = require("../src/review/review-semantic");
const { createFakeHermesCommand } = require("./helpers/fake-hermes-command.ts");

function buildSemanticInput(workspaceRoot: string) {
  return {
    profile: {
      kind: "nightly",
      workspaceRoot,
    },
    diaryEntries: [
      {
        date: "2026-04-14",
        todo: {
          open: ["继续收口 host-neutral 方案"],
          done: ["补了 Hermes hosted 诊断"],
        },
        summary: ["今天把 host profile 和 operator surface 接上了。"],
        timeline: ["10:00-11:00 review semantic host"],
      },
    ],
    nightlyEntries: [],
    deterministicDraft: {
      periodLabel: "2026-04-14",
      insights: {
        progress: ["先用 deterministic draft 兜底。"],
      },
    },
    options: {},
  };
}

function withPatchedEnv<T>(patch: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const original = { ...process.env };
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, original, patch);
  return fn().finally(() => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, original);
  });
}

test("semantic review uses Hermes host in hosted mode", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-review-hermes-"));
  const { commandPath } = createFakeHermesCommand(tempRoot);

  const result = await maybeGenerateSemanticReview({
    hermesCommand: commandPath,
    reviewSemanticHost: "auto",
    reviewSemanticMode: "hybrid",
    runtime: "hermes",
    channelProvider: "hermes",
    workspaceRoot: tempRoot,
  }, buildSemanticInput(tempRoot));

  assert.equal(result.used, true);
  assert.equal(result.source, "hermes");
  assert.deepEqual(result.data.progress, ["done"]);
});

test("semantic review falls back to deterministic when Hermes returns invalid JSON", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-review-hermes-badjson-"));
  const { commandPath } = createFakeHermesCommand(tempRoot);

  const result = await withPatchedEnv({
    FAKE_HERMES_CHAT_STDOUT: "not-json",
  }, async () => {
    return maybeGenerateSemanticReview({
      hermesCommand: commandPath,
      reviewSemanticHost: "hermes",
      reviewSemanticMode: "hybrid",
      workspaceRoot: tempRoot,
    }, buildSemanticInput(tempRoot));
  });

  assert.equal(result.used, false);
  assert.equal(result.source, "deterministic");
  assert.match(result.reason, /valid JSON/u);
});

test("semantic review falls back to deterministic when Hermes host fails", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-review-hermes-fail-"));
  const { commandPath } = createFakeHermesCommand(tempRoot);

  const result = await withPatchedEnv({
    FAKE_HERMES_CHAT_STATUS: "1",
    FAKE_HERMES_CHAT_STDERR: "provider missing",
  }, async () => {
    return maybeGenerateSemanticReview({
      hermesCommand: commandPath,
      reviewSemanticHost: "hermes",
      reviewSemanticMode: "hybrid",
      workspaceRoot: tempRoot,
    }, buildSemanticInput(tempRoot));
  });

  assert.equal(result.used, false);
  assert.equal(result.source, "deterministic");
  assert.match(result.reason, /provider missing/u);
});
