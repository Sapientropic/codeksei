const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const { spawnSync }: typeof import("node:child_process") = require("node:child_process");
const {
  resolveRuntimeEntrypointAbsolute,
}: typeof import("../src/contracts/runtime-entrypoints") = require("../src/contracts/runtime-entrypoints");
const {
  createFakeHermesRepoLocalFixture,
  readFakeHermesRepoLocalLog,
} = require("./helpers/fake-hermes-repo-local.ts");

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
  assert.ok(actions.includes("host.manifest"));
  assert.ok(actions.includes("host.doctor"));
  assert.ok(!actions.includes("app.shared_start"));
  assert.ok(!actions.includes("background.install"));
});

test("schema splits public and operator surfaces", () => {
  const publicResult = runCli(["schema"]);
  assert.equal(publicResult.status, 0, publicResult.stderr || "expected public schema to succeed");
  const publicPayload = parseEnvelope(publicResult.stdout);
  const publicActions = asCommandList(asRecord(publicPayload.data).commands).map((entry) => entry.action);
  assert.ok(publicActions.includes("project.radar"));
  assert.ok(publicActions.includes("host.bootstrap"));
  assert.ok(publicActions.includes("host.claim_checkin"));
  assert.ok(!publicActions.includes("app.start"));

  const operatorResult = runCli(["operator", "schema"]);
  assert.equal(operatorResult.status, 0, operatorResult.stderr || "expected operator schema to succeed");
  const operatorPayload = parseEnvelope(operatorResult.stdout);
  const operatorActions = asCommandList(asRecord(operatorPayload.data).commands).map((entry) => entry.action);
  assert.ok(operatorActions.includes("app.start"));
  assert.ok(operatorActions.includes("app.shared_start"));
  assert.ok(operatorActions.includes("operator.hermes.install_skill"));
  assert.ok(operatorActions.includes("operator.hermes.status"));
  assert.ok(operatorActions.includes("operator.hermes.smoke"));
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

  const hermesResource = runCli(["operator", "hermes"]);
  assert.equal(hermesResource.status, 0, hermesResource.stderr || "expected operator hermes to succeed");
  const hermesResourcePayload = parseEnvelope(hermesResource.stdout);
  assert.equal(asRecord(hermesResourcePayload.data).topic, "operator hermes");
});

test("channel send-file schema exposes warned mutation flags", () => {
  const result = runCli(["schema", "channel", "send-file"]);
  assert.equal(result.status, 0, result.stderr || "expected channel send-file schema to succeed");

  const payload = parseEnvelope(result.stdout);
  assert.equal(asRecord(payload.data).hostSupportTier, "hosted_ready");
  assert.deepEqual(asRecord(payload.data).hostProfileIds, ["codex-mode", "hosted-mode"]);
  const args = asCommandArgs(asRecord(asRecord(payload.data).args).command);
  const argNames = args.map((entry) => entry.name);
  assert.ok(argNames.includes("dryRun"));
  assert.ok(argNames.includes("idempotencyKey"));
  assert.match(String(asRecord(payload.data).helpText || ""), /--dry-run/u);
});

test("reminder write schema no longer exposes proactive delivery routing", () => {
  const result = runCli(["schema", "reminder", "write"]);
  assert.equal(result.status, 0, result.stderr || "expected reminder write schema to succeed");

  const payload = parseEnvelope(result.stdout);
  const args = asCommandArgs(asRecord(asRecord(payload.data).args).command);
  const argNames = args.map((entry) => entry.name);
  assert.ok(!argNames.includes("delivery"));
  assert.doesNotMatch(String(asRecord(payload.data).helpText || ""), /proactive/u);
});

test("hosted mode channel send-file routes through Hermes repo-local shim", () => {
  const tempRoot = createCliFixture();
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-cli-hermes-repo-local-file-"))
  );
  const artifactPath = path.join(tempRoot.env.CODEKSEI_WORKSPACE_ROOT, "artifact.txt");
  fs.writeFileSync(artifactPath, "artifact", "utf8");

  const result = runCli([
    "channel",
    "send-file",
    "--path",
    artifactPath,
  ], {
    ...tempRoot.env,
    ...repoLocal.env,
  });

  assert.equal(result.status, 0, result.stderr || "expected hosted channel send-file to succeed");
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(asRecord(payload.data).filePath, artifactPath);
  assert.equal(asRecord(payload.data).platform, "weixin");

  const requests = readFakeHermesRepoLocalLog(repoLocal.logFile);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, "send_file");
  assert.equal(asRecord(requests[0].payload).file_path, artifactPath);
});

test("operator hermes install-skill schema exposes dry-run and side effects", () => {
  const result = runCli(["operator", "schema", "operator", "hermes", "install-skill"]);
  assert.equal(result.status, 0, result.stderr || "expected operator hermes install-skill schema to succeed");

  const payload = parseEnvelope(result.stdout);
  const data = asRecord(payload.data);
  const args = asCommandArgs(asRecord(data.args).command);
  const argNames = args.map((entry) => entry.name);
  assert.equal(data.action, "operator.hermes.install_skill");
  assert.equal(data.mutability, "write");
  assert.equal(data.supportsDryRun, true);
  assert.ok(argNames.includes("dryRun"));
  assert.ok(argNames.includes("idempotencyKey"));
  assert.equal(Array.isArray(data.sideEffects), true);
});

test("operator hermes prefix schema lists leaf actions progressively", () => {
  const result = runCli(["operator", "schema", "operator", "hermes"]);
  assert.equal(result.status, 0, result.stderr || "expected operator hermes schema topic to succeed");

  const payload = parseEnvelope(result.stdout);
  const data = asRecord(payload.data);
  const actions = asCommandList(data.commands).map((entry) => entry.action).sort();
  assert.equal(data.type, "command_topic");
  assert.deepEqual(actions, [
    "operator.hermes.install_skill",
    "operator.hermes.smoke",
    "operator.hermes.status",
  ]);
});

test("operator hermes install-skill dry-run previews without writing files", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-cli-hermes-dry-run-"));
  const hermesHome = path.join(tempRoot, ".hermes");
  const result = runCli([
    "operator",
    "hermes",
    "install-skill",
    "--dry-run",
  ], {
    CODEKSEI_HERMES_HOME: hermesHome,
    CODEKSEI_RUNTIME: "hermes",
    CODEKSEI_CHANNEL_PROVIDER: "hermes",
  });

  assert.equal(result.status, 0, result.stderr || "expected operator hermes install-skill dry-run to succeed");
  const payload = parseEnvelope(result.stdout);
  const meta = asRecord(payload.meta);
  assert.equal(meta.dryRun, true);
  assert.equal(fs.existsSync(path.join(hermesHome, "skills", "codeksei-companion", "SKILL.md")), false);
});

test("operator hermes invalid leaf returns validation_error instead of unknown_command", () => {
  const result = runCli(["operator", "hermes", "bogus"]);
  assert.equal(result.status, 3);
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "validation_error");
});

test("operator hermes sync-checkin now returns validation_error as a removed leaf", () => {
  const result = runCli(["operator", "hermes", "sync-checkin"]);
  assert.equal(result.status, 3);
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, false);
  const error = asRecord(payload.error);
  assert.equal(error.code, "validation_error");
  assert.match(String(error.hint || ""), /host seed-proactive/u);
  const context = asRecord(error.context);
  assert.equal(context.reason, "removed_public_surface");
  assert.equal(context.removed, true);
  assert.equal(context.requestedTarget, "operator hermes sync-checkin");
  assert.deepEqual(asStringList(context.relatedCommands), [
    "codeksei host seed-proactive --provider hermes",
    "codeksei host claim-checkin --provider hermes",
    "codeksei host settle-checkin --provider hermes",
  ]);
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

test("hosted mode reminder write routes through Hermes repo-local shim and skips local reminder queue", () => {
  const tempRoot = createCliFixture();
  const repoLocal = createFakeHermesRepoLocalFixture(
    fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-cli-hermes-repo-local-reminder-"))
  );
  const result = runCli([
    "reminder",
    "write",
    "--delay",
    "30m",
    "--text",
    "hello",
  ], {
    ...tempRoot.env,
    ...repoLocal.env,
  });

  assert.equal(result.status, 0, result.stderr || "expected hosted reminder write to succeed");
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(asRecord(payload.data).deliveryMode, "hermes_repo_local_origin");
  assert.equal(asRecord(payload.data).jobId, "cron-123");
  assert.equal(fs.existsSync(path.join(tempRoot.stateDir, "reminder-queue.json")), false);

  const requests = readFakeHermesRepoLocalLog(repoLocal.logFile);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, "create_reminder");
  assert.equal(asRecord(requests[0].payload).text, "hello");
});

test("reminder write rejects removed --delivery flag with validation_error", () => {
  const tempRoot = createCliFixture();
  const result = runCli([
    "reminder",
    "write",
    "--delay",
    "2h",
    "--delivery",
    "proactive",
    "--text",
    "hello",
  ], tempRoot.env);
  assert.equal(result.status, 3);
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "validation_error");
});

test("system send now returns unknown_command after public surface removal", () => {
  const tempRoot = createCliFixture();
  const result = runCli([
    "system",
    "send",
    "--text",
    "hello",
  ], tempRoot.env);
  assert.equal(result.status, 3);
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, false);
  const error = asRecord(payload.error);
  assert.equal(error.code, "unknown_command");
  assert.match(String(error.hint || ""), /channel send-file/u);
  const context = asRecord(error.context);
  assert.equal(context.reason, "removed_public_surface");
  assert.equal(context.removed, true);
  assert.equal(context.requestedTarget, "system send");
  assert.deepEqual(asStringList(context.relatedCommands), [
    "codeksei channel send-file --path /absolute/path/to/file",
    "codeksei host seed-proactive --provider hermes",
    "codeksei host claim-checkin --provider hermes",
    "codeksei host settle-checkin --provider hermes",
  ]);
});

test("schema system send returns validation_error with removed command guidance", () => {
  const result = runCli(["schema", "system", "send"]);
  assert.equal(result.status, 3);
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, false);
  const error = asRecord(payload.error);
  assert.equal(error.code, "validation_error");
  assert.match(String(error.hint || ""), /channel send-file/u);
  const context = asRecord(error.context);
  assert.equal(context.reason, "removed_public_surface");
  assert.equal(context.removed, true);
  assert.equal(context.requestedTarget, "system send");
  assert.deepEqual(asStringList(context.relatedCommands), [
    "codeksei channel send-file --path /absolute/path/to/file",
    "codeksei host seed-proactive --provider hermes",
    "codeksei host claim-checkin --provider hermes",
    "codeksei host settle-checkin --provider hermes",
  ]);
});

test("operator schema removed sync-checkin returns validation_error with removed command guidance", () => {
  const result = runCli(["operator", "schema", "operator", "hermes", "sync-checkin"]);
  assert.equal(result.status, 3);
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, false);
  const error = asRecord(payload.error);
  assert.equal(error.code, "validation_error");
  assert.match(String(error.hint || ""), /host claim-checkin/u);
  const context = asRecord(error.context);
  assert.equal(context.reason, "removed_public_surface");
  assert.equal(context.removed, true);
  assert.equal(context.requestedTarget, "operator hermes sync-checkin");
  assert.deepEqual(asStringList(context.relatedCommands), [
    "codeksei host seed-proactive --provider hermes",
    "codeksei host claim-checkin --provider hermes",
    "codeksei host settle-checkin --provider hermes",
  ]);
});

test("generic schema target miss returns validation_error with discoverable context", () => {
  const result = runCli(["schema", "system", "bogus"]);
  assert.equal(result.status, 3);
  const payload = parseEnvelope(result.stdout);
  assert.equal(payload.ok, false);
  const error = asRecord(payload.error);
  assert.equal(error.code, "validation_error");
  assert.match(String(error.hint || ""), /codeksei schema/u);
  const context = asRecord(error.context);
  assert.equal(context.reason, "schema_target_not_found");
  assert.equal(context.audience, "public");
  assert.equal(context.requestedTarget, "system bogus");
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
      CODEKSEI_CHANNEL: "weixin",
      CODEKSEI_CHANNEL_PROVIDER: "codeksei",
      CODEKSEI_RUNTIME: "codex",
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
    error: { code: string; context?: Record<string, unknown>; hint?: string };
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

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
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
