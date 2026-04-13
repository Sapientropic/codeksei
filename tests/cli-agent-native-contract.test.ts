const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const { spawnSync }: typeof import("node:child_process") = require("node:child_process");
const {
  resolveRuntimeEntrypointAbsolute,
}: typeof import("../src/contracts/runtime-entrypoints") = require("../src/contracts/runtime-entrypoints");

const repoRoot = path.join(__dirname, "..");
const cliEntrypoint = resolveRuntimeEntrypointAbsolute(repoRoot, "cli");

test("non-tty help defaults to JSON envelope and hides operator scripts from public discovery", () => {
  const result = runCli(["help"]);

  assert.equal(result.status, 0, result.stderr || "expected help to succeed");
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, true);
  const data = asRecord(payload.data);
  assert.equal(data.type, "command_collection");
  const actions = asCommandList(data.commands).map((entry) => entry.action);
  assert.ok(actions.includes("app.schema"));
  assert.ok(!actions.includes("app.shared_start"));
  assert.ok(!actions.includes("background.install"));
});

test("schema splits public and operator surfaces", () => {
  const publicResult = runCli(["schema"]);
  assert.equal(publicResult.status, 0, publicResult.stderr || "expected public schema to succeed");
  const publicPayload = parseEnvelope(publicResult.stdout);
  const publicActions = asCommandList(asRecord(publicPayload.data).commands).map((entry) => entry.action);
  assert.ok(publicActions.includes("project.radar"));
  assert.ok(!publicActions.includes("app.start"));

  const operatorResult = runCli(["operator", "schema"]);
  assert.equal(operatorResult.status, 0, operatorResult.stderr || "expected operator schema to succeed");
  const operatorPayload = parseEnvelope(operatorResult.stdout);
  const operatorActions = asCommandList(asRecord(operatorPayload.data).commands).map((entry) => entry.action);
  assert.ok(operatorActions.includes("app.start"));
  assert.ok(operatorActions.includes("app.shared_start"));
});

test("operator discovery aliases return operator surface instead of internal errors", () => {
  const operatorRoot = runCli(["operator"]);
  assert.equal(operatorRoot.status, 0, operatorRoot.stderr || "expected bare operator command to succeed");
  const operatorRootPayload = parseEnvelope(operatorRoot.stdout);
  assert.equal(asRecord(operatorRootPayload.data).audience, "operator");

  const operatorHelp = runCli(["help", "operator"]);
  assert.equal(operatorHelp.status, 0, operatorHelp.stderr || "expected help operator to succeed");
  const operatorHelpPayload = parseEnvelope(operatorHelp.stdout);
  assert.equal(asRecord(operatorHelpPayload.data).audience, "operator");
});

test("channel send-file schema exposes warned mutation flags", () => {
  const result = runCli(["schema", "channel", "send-file"]);
  assert.equal(result.status, 0, result.stderr || "expected channel send-file schema to succeed");

  const payload = parseEnvelope(result.stdout);
  const args = asCommandArgs(asRecord(asRecord(payload.data).args).command);
  const argNames = args.map((entry) => entry.name);
  assert.ok(argNames.includes("dryRun"));
  assert.ok(argNames.includes("idempotencyKey"));
  assert.match(String(asRecord(payload.data).helpText || ""), /--dry-run/u);
});

test("unknown command returns fixed unknown_command routing", () => {
  const result = runCli(["bogus"]);

  assert.equal(result.status, 3);
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "unknown_command");
  assert.equal(result.stderr.trim(), "");
});

test("invalid flag returns validation_error without raw stack by default", () => {
  const result = runCli(["project", "radar", "--bogus"]);

  assert.equal(result.status, 3);
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "validation_error");
  assert.equal(result.stderr.trim(), "");
});

test("timeline read defaults to JSON envelope in non-tty mode", () => {
  const tempRoot = createCliFixture();
  const result = runCli(
    ["timeline", "read", "--date", "2026-04-05"],
    {
      CODEKSEI_STATE_DIR: tempRoot.stateDir,
      CODEKSEI_WORKSPACE_ROOT: tempRoot.workspaceRoot,
      CODEKSEI_TIMELINE_STATE_DIR: tempRoot.stateDir,
    },
  );

  assert.equal(result.status, 0, result.stderr || "expected timeline read to succeed");
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.date, "2026-04-05");
  assert.equal(payload.data.exists, false);
});

test("system send dry-run resolves explicit targets without writing queue state", () => {
  const tempRoot = createCliFixture({
    contextTokens: { "user-1": "ctx-1" },
  });
  const result = runCli(
    [
      "system",
      "send",
      "--text",
      "hello",
      "--user",
      "user-1",
      "--workspace",
      tempRoot.workspaceRoot,
      "--dry-run",
    ],
    tempRoot.env,
  );

  assert.equal(result.status, 0, result.stderr || "expected dry-run to succeed");
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, true);
  const meta = asRecord(payload.meta);
  assert.equal(meta.dryRun, true);
  const resolvedTargets = asRecord(meta.resolvedTargets);
  assert.equal(resolvedTargets.senderId, "user-1");
  assert.equal(resolvedTargets.workspaceRoot, tempRoot.workspaceRoot.replace(/\\/g, "/"));
  assert.equal(fs.existsSync(path.join(tempRoot.stateDir, "system-message-queue.json")), false);
});

test("system send replays identical idempotent requests and avoids duplicate queue writes", () => {
  const tempRoot = createCliFixture({
    contextTokens: { "user-1": "ctx-1" },
  });
  const args = [
    "system",
    "send",
    "--text",
    "hello",
    "--idempotency-key",
    "system-send-1",
  ];

  const first = runCli(args, tempRoot.env);
  assert.equal(first.status, 0, first.stderr || "expected first enqueue to succeed");
  const firstPayload = parseEnvelope(first.stdout);
  assert.equal(firstPayload.ok, true);

  const second = runCli(args, tempRoot.env);
  assert.equal(second.status, 0, second.stderr || "expected second enqueue to succeed");
  const secondPayload = parseEnvelope(second.stdout);
  assert.equal(secondPayload.ok, true);
  const secondMeta = asRecord(secondPayload.meta);
  assert.equal(asRecord(secondMeta.idempotency).replayed, true);
  assert.equal(asRecord(secondPayload.data).id, asRecord(firstPayload.data).id);

  const queueState = JSON.parse(fs.readFileSync(path.join(tempRoot.stateDir, "system-message-queue.json"), "utf8"));
  assert.equal(Array.isArray(queueState.messages), true);
  assert.equal(queueState.messages.length, 1);
});

test("system send surfaces target_resolution_required when sender defaults are ambiguous", () => {
  const tempRoot = createCliFixture({
    contextTokens: {
      "user-1": "ctx-1",
      "user-2": "ctx-2",
    },
  });
  const result = runCli([
    "system",
    "send",
    "--text",
    "hello",
  ], tempRoot.env);

  assert.equal(result.status, 4);
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "target_resolution_required");
  assert.deepEqual(payload.error.context?.candidates, ["user-1", "user-2"]);
});

test("system send surfaces auth_required when sender lacks context token", () => {
  const tempRoot = createCliFixture();
  const result = runCli([
    "system",
    "send",
    "--text",
    "hello",
    "--user",
    "user-1",
  ], tempRoot.env);

  assert.equal(result.status, 2);
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "auth_required");
});

function createCliFixture({
  contextTokens = {},
}: {
  contextTokens?: Record<string, string>;
} = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-cli-contract-"));
  const stateDir = path.join(tempRoot, "state");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const accountsDir = path.join(stateDir, "accounts");
  fs.mkdirSync(accountsDir, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });

  fs.writeFileSync(path.join(accountsDir, "acct-1.json"), JSON.stringify({
    accountId: "acct-1",
    rawAccountId: "acct-1",
    token: "token-1",
    baseUrl: "http://127.0.0.1",
    userId: "bot-user",
    routeTag: "",
    savedAt: "2026-04-13T00:00:00.000Z",
  }, null, 2));
  fs.writeFileSync(path.join(accountsDir, "acct-1.context-tokens.json"), JSON.stringify(contextTokens, null, 2));

  return {
    env: {
      CODEKSEI_STATE_DIR: stateDir,
      CODEKSEI_WORKSPACE_ROOT: workspaceRoot,
    },
    stateDir,
    workspaceRoot: workspaceRoot.replace(/\\/g, "/"),
  };
}

function parseEnvelope(stdout: string) {
  return JSON.parse(stdout) as {
    ok: boolean | string;
    data: Record<string, unknown>;
    error: { code: string; context?: Record<string, unknown> };
    meta: Record<string, unknown>;
  };
}

function asCommandList(value: unknown): Array<{ action: string }> {
  return Array.isArray(value)
    ? value.filter((entry): entry is { action: string } => Boolean(entry && typeof entry === "object" && "action" in entry))
    : [];
}

function asCommandArgs(value: unknown): Array<{ name: string }> {
  return Array.isArray(value)
    ? value.filter((entry): entry is { name: string } => Boolean(entry && typeof entry === "object" && "name" in entry))
    : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function runCli(args: string[], extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [cliEntrypoint, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
  return {
    status: result.status,
    stderr: typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? ""),
    stdout: typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? ""),
  };
}
