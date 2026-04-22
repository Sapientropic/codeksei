const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { maybeGenerateSemanticReview } = require("../src/review/review-semantic");
const { runHermesSemanticJson } = require("../src/runtime/semantic-json-runtime");
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

test("Hermes semantic JSON sends long prompts through a Hermes @file reference", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-prompt-file-"));
  const { commandPath } = createFakeHermesCommand(tempRoot);
  const logFile = path.join(tempRoot, "fake-hermes-log.json");
  const sentinel = "不要把这段长 prompt 放进 argv";
  const prompt = `${sentinel}\n${"长文本🙂".repeat(4000)}`;

  const result = await withPatchedEnv({
    FAKE_HERMES_CHAT_STDOUT: "{\"ok\":true}",
    FAKE_HERMES_LOG_FILE: logFile,
  }, async () => {
    return runHermesSemanticJson({
      hermesCommand: commandPath,
    }, {
      label: "semantic prompt-file test",
      prompt,
      timeoutMs: 5000,
      workspaceRoot: tempRoot,
    });
  });

  const invocation = JSON.parse(fs.readFileSync(logFile, "utf8")) as {
    args: string[];
    promptFile: string;
    promptText: string;
  };
  const queryArg = invocation.args[invocation.args.indexOf("-q") + 1] || "";
  assert.deepEqual(result, { ok: true });
  assert.equal(invocation.promptText, prompt);
  assert.equal(invocation.args.includes("-q"), true);
  assert.equal(invocation.args.includes("--prompt-file"), false);
  assert.match(queryArg, /^@file:/u);
  assert.equal(queryArg.includes(" "), false);
  assert.equal(invocation.args.some((arg) => arg.includes(sentinel)), false);
  assert.equal(fs.existsSync(invocation.promptFile), false);
});

test("Hermes semantic JSON cleans up the temporary prompt file when Hermes fails", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-hermes-prompt-file-fail-"));
  const { commandPath } = createFakeHermesCommand(tempRoot);
  const logFile = path.join(tempRoot, "fake-hermes-log.json");

  await withPatchedEnv({
    FAKE_HERMES_CHAT_STATUS: "1",
    FAKE_HERMES_CHAT_STDERR: "provider missing",
    FAKE_HERMES_LOG_FILE: logFile,
  }, async () => {
    await assert.rejects(
      async () => runHermesSemanticJson({
        hermesCommand: commandPath,
      }, {
        label: "semantic prompt-file failure test",
        prompt: "失败路径也要清理 prompt file",
        timeoutMs: 5000,
        workspaceRoot: tempRoot,
      }),
      /provider missing/u,
    );
  });

  const invocation = JSON.parse(fs.readFileSync(logFile, "utf8")) as { promptFile: string };
  assert.equal(fs.existsSync(invocation.promptFile), false);
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
