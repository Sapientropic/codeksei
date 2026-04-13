const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { SessionStore }: typeof import("../src/adapters/runtime/codex/session-store") = require("../src/adapters/runtime/codex/session-store");
const { SessionStoreWriter }: typeof import("../src/adapters/runtime/codex/session-store-writer") = require("../src/adapters/runtime/codex/session-store-writer");
const { persistContextToken }: typeof import("../src/adapters/channel/weixin/context-token-store") = require("../src/adapters/channel/weixin/context-token-store");
const { saveWeixinAccount }: typeof import("../src/adapters/channel/weixin/account-store") = require("../src/adapters/channel/weixin/account-store");

interface FakeTurnStart {
  requestId: string;
  threadId: string;
  turnId: string;
  text: string;
  params: Record<string, unknown>;
  socket: import("ws").WebSocket;
}

interface ApprovalResponseLog {
  id: string;
  result: Record<string, unknown>;
  at: string;
}

interface FakeWeixinHarness {
  baseUrl: string;
  enqueueTextMessage(text: string, overrides?: Record<string, unknown>): void;
  clearOutbound(): void;
  getSentTexts(): string[];
  waitForSentText(predicate: (text: string) => boolean, timeoutMs?: number): Promise<string>;
  waitForSentCount(predicate: (texts: string[]) => boolean, timeoutMs?: number): Promise<string[]>;
  stop(): Promise<void>;
}

interface FakeCodexHarness {
  listenUrl: string;
  setTurnHandler(handler: ((args: FakeTurnStart) => Promise<void> | void) | null): void;
  setApprovalResponseHandler(handler: ((args: ApprovalResponseLog & { socket: import("ws").WebSocket }) => Promise<void> | void) | null): void;
  waitForTurnStart(predicate: (entry: FakeTurnStart) => boolean, timeoutMs?: number): Promise<FakeTurnStart>;
  emitTurnStarted(socket: import("ws").WebSocket, threadId: string, turnId: string): void;
  emitReplyDelta(socket: import("ws").WebSocket, threadId: string, turnId: string, itemId: string, text: string): void;
  emitReplyCompleted(socket: import("ws").WebSocket, threadId: string, turnId: string, itemId: string, text: string): void;
  emitTurnCompleted(socket: import("ws").WebSocket, threadId: string, turnId: string): void;
  emitApprovalRequest(socket: import("ws").WebSocket, args: {
    approvalId: string;
    threadId: string;
    reason: string;
    command: string[];
  }): void;
  waitForApprovalResponse(predicate: (entry: ApprovalResponseLog) => boolean, timeoutMs?: number): Promise<ApprovalResponseLog>;
  stop(): Promise<void>;
}

interface SharedSmokeHarnessModule {
  buildSharedModeEnv(base: NodeJS.ProcessEnv, overrides: Record<string, string>): NodeJS.ProcessEnv;
  createFakeCodexAppServer(): Promise<FakeCodexHarness>;
  createFakeCodexCommandWrapper(tempRoot: string): { commandPath: string; logFile: string };
  createFakeWeixinServer(): Promise<FakeWeixinHarness>;
  readPidFileValue(filePath: string): number;
  runPackageScript(
    repoRoot: string,
    scriptName: string,
    env: NodeJS.ProcessEnv,
    timeoutMs?: number,
  ): Promise<{ status: number | null; stdout: string; stderr: string }>;
  terminatePid(pid: number): Promise<void>;
  waitForCondition<T>(producer: () => T, timeoutMs?: number, intervalMs?: number): Promise<T>;
}

const {
  buildSharedModeEnv,
  createFakeCodexAppServer,
  createFakeCodexCommandWrapper,
  createFakeWeixinServer,
  readPidFileValue,
  runPackageScript,
  terminatePid,
  waitForCondition,
}: SharedSmokeHarnessModule = require("./helpers/shared-mode-smoke-harness.ts");

const repoRoot = path.join(__dirname, "..");

test("shared mode long-chain smoke covers status/open, approval continuity, and stream vs settled replies", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-shared-smoke-"));
  const stateDir = path.join(tempRoot, "state");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const accountsDir = path.join(stateDir, "accounts");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(accountsDir, { recursive: true });

  const fakeCodex = await createFakeCodexAppServer();
  const fakeWeixin = await createFakeWeixinServer();
  const { commandPath, logFile } = createFakeCodexCommandWrapper(tempRoot);
  const sharedPort = new URL(fakeCodex.listenUrl).port;

  saveWeixinAccount({
    accountsDir,
    weixinBaseUrl: fakeWeixin.baseUrl,
    accountId: "acct-1",
  }, "acct-1", {
    baseUrl: fakeWeixin.baseUrl,
    token: "token-1",
    userId: "user-1",
  });
  persistContextToken({ accountsDir }, "acct-1", "user-1", "ctx-1");

  const sessionsFile = path.join(stateDir, "sessions.json");
  const sessionStore = new SessionStore({ filePath: sessionsFile });
  const sessionWriter = new SessionStoreWriter(sessionStore);
  const bindingKey = sessionStore.buildBindingKey({
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
  });
  await sessionWriter.setThreadIdForWorkspace(bindingKey, workspaceRoot, "thread-shared", {
    workspaceId: "workspace-1",
    accountId: "acct-1",
    senderId: "user-1",
  });
  await sessionWriter.rememberWorkspaceBootstrapForThread(bindingKey, workspaceRoot, "thread-shared");

  const baseEnv = buildSharedModeEnv(process.env, {
    CODEKSEI_STATE_DIR: stateDir,
    CODEKSEI_WORKSPACE_ROOT: workspaceRoot,
    CODEKSEI_WORKSPACE_ID: "workspace-1",
    CODEKSEI_ACCOUNT_ID: "acct-1",
    CODEKSEI_WEIXIN_BASE_URL: fakeWeixin.baseUrl,
    CODEKSEI_WEIXIN_ADAPTER: "v2",
    CODEKSEI_ALLOWED_USER_IDS: "user-1",
    CODEKSEI_CODEX_COMMAND: commandPath,
    CODEKSEI_SHARED_USE_BUNDLED_CODEX_BINARY: "0",
    CODEKSEI_SHARED_PORT: sharedPort,
    CODEKSEI_ENABLE_CHECKIN: "0",
  });

  const bridgePidFile = path.join(stateDir, "logs", "shared-wechat.pid");
  const supervisorPidFile = path.join(stateDir, "logs", "shared-supervisor.pid");
  const appServerPidFile = path.join(stateDir, "logs", "shared-app-server.pid");

  try {
    const start = await runPackageScript(repoRoot, "shared:start", withReplyMode(baseEnv, "stream"));
    assert.equal(start.status, 0, start.stderr || start.stdout || "shared:start failed");
    assert.match(start.stdout, /shared app-server (already_running|started|started_adopted|restarted)/u);

    const status = await runPackageScript(repoRoot, "shared:status", withReplyMode(baseEnv, "stream"));
    assert.equal(status.status, 0, status.stderr || status.stdout || "shared:status failed");
    assert.match(status.stdout, /readyz=ok/u);
    assert.match(status.stdout, /shared_bridge_heartbeat=(ok|missing|stopped|missing_process|pid_mismatch|stale)/u);

    const open = await runPackageScript(repoRoot, "shared:open", withReplyMode(baseEnv, "stream"));
    assert.equal(open.status, 0, open.stderr || open.stdout || "shared:open failed");
    const resumeLine = await waitForCondition(() => {
      try {
        return fs.readFileSync(logFile, "utf8").split(/\r?\n/).find((line) => line.includes("resume thread-shared")) || "";
      } catch {
        return "";
      }
    }, 10_000);
    assert.match(resumeLine, /resume thread-shared/u);
    assert.match(resumeLine, new RegExp(sharedPort.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    fakeCodex.setTurnHandler(async ({ socket, text, threadId, turnId }) => {
      if (!text.includes("stream-case")) {
        return;
      }
      fakeCodex.emitTurnStarted(socket, threadId, turnId);
      fakeCodex.emitReplyDelta(socket, threadId, turnId, "item-stream", "第一句。");
      await delay(700);
      fakeCodex.emitReplyDelta(socket, threadId, turnId, "item-stream", "第二句。");
      await delay(700);
      fakeCodex.emitReplyCompleted(socket, threadId, turnId, "item-stream", "第一句。第二句。");
      fakeCodex.emitTurnCompleted(socket, threadId, turnId);
    });
    fakeWeixin.clearOutbound();
    fakeWeixin.enqueueTextMessage("stream-case");
    await fakeCodex.waitForTurnStart((entry) => entry.text.includes("stream-case"), 15_000);
    const streamedTexts = await fakeWeixin.waitForSentCount((texts) => texts.length >= 1, 15_000);
    assert.equal(streamedTexts.some((text) => text.includes("第一句") || text.includes("第二句")), true);

    const approvalId = "approval-1";
    fakeCodex.setTurnHandler(async ({ socket, text, threadId, turnId }) => {
      if (!text.includes("approval-case")) {
        return;
      }
      fakeCodex.emitTurnStarted(socket, threadId, turnId);
      await delay(100);
      fakeCodex.emitApprovalRequest(socket, {
        approvalId,
        threadId,
        reason: "Need shell",
        command: ["python", "dangerous.py"],
      });
    });
    fakeWeixin.clearOutbound();
    fakeWeixin.enqueueTextMessage("approval-case");
    await fakeCodex.waitForTurnStart((entry) => entry.text.includes("approval-case"), 15_000);
    const promptText = await fakeWeixin.waitForSentText((text) => (
      text.includes("/yes") && text.includes("python dangerous.py")
    ), 15_000);
    assert.match(promptText, /Need shell|dangerous\.py/u);
    const pendingBeforeRestart = new SessionStore({ filePath: sessionsFile }).getPendingApprovalForThread("thread-shared");
    assert.equal(pendingBeforeRestart?.requestId, approvalId);

    await restartBridge(repoRoot, withReplyMode(baseEnv, "stream"), bridgePidFile, supervisorPidFile);

    fakeCodex.setApprovalResponseHandler(async ({ id, result, socket }) => {
      if (id !== approvalId || result.decision !== "accept") {
        return;
      }
      fakeCodex.emitReplyCompleted(socket, "thread-shared", "turn-approved", "item-approved", "审批已通过。");
      fakeCodex.emitTurnCompleted(socket, "thread-shared", "turn-approved");
    });
    fakeWeixin.clearOutbound();
    fakeWeixin.enqueueTextMessage("/yes");
    const approvalResponse = await fakeCodex.waitForApprovalResponse(
      (entry) => entry.id === approvalId && entry.result.decision === "accept",
      15_000,
    );
    assert.equal(approvalResponse.result.decision, "accept");
    const confirmText = await fakeWeixin.waitForSentText((text) => text.includes("已允许本次请求"), 15_000);
    assert.match(confirmText, /已允许本次请求/u);

    await restartBridge(repoRoot, withReplyMode(baseEnv, "settled"), bridgePidFile, supervisorPidFile);
    fakeCodex.setTurnHandler(async ({ socket, text, threadId, turnId }) => {
      if (!text.includes("settled-case")) {
        return;
      }
      fakeCodex.emitTurnStarted(socket, threadId, turnId);
      fakeCodex.emitReplyDelta(socket, threadId, turnId, "item-settled", "甲段。");
      await delay(700);
      fakeCodex.emitReplyDelta(socket, threadId, turnId, "item-settled", "乙段。");
      await delay(700);
      fakeCodex.emitReplyCompleted(socket, threadId, turnId, "item-settled", "甲段。乙段。");
      fakeCodex.emitTurnCompleted(socket, threadId, turnId);
    });
    fakeWeixin.clearOutbound();
    fakeWeixin.enqueueTextMessage("settled-case");
    await fakeCodex.waitForTurnStart((entry) => entry.text.includes("settled-case"), 15_000);
    await fakeWeixin.waitForSentCount((texts) => texts.length >= 1, 15_000);
    await delay(1200);
    assert.deepEqual(fakeWeixin.getSentTexts(), ["甲段。乙段。"]);

    const finalStatus = await runPackageScript(repoRoot, "shared:status", withReplyMode(baseEnv, "settled"));
    assert.equal(finalStatus.status, 0);
    assert.match(finalStatus.stdout, /readyz=ok/u);
  } finally {
    await terminatePid(readPidFileValue(bridgePidFile));
    await terminatePid(readPidFileValue(supervisorPidFile));
    const appServerPid = readPidFileValue(appServerPidFile);
    if (appServerPid === process.pid && fs.existsSync(appServerPidFile)) {
      fs.rmSync(appServerPidFile, { force: true });
    } else {
      await terminatePid(appServerPid);
    }
    await fakeCodex.stop();
    await fakeWeixin.stop();
  }
});

async function restartBridge(
  repoRootPath: string,
  env: NodeJS.ProcessEnv,
  bridgePidFile: string,
  supervisorPidFile: string,
): Promise<void> {
  await terminatePid(readPidFileValue(supervisorPidFile));
  await terminatePid(readPidFileValue(bridgePidFile));
  const restart = await runPackageScript(repoRootPath, "shared:start", env);
  assert.equal(restart.status, 0, restart.stderr || restart.stdout || "shared:start restart failed");
}

function withReplyMode(env: NodeJS.ProcessEnv, mode: "stream" | "settled"): NodeJS.ProcessEnv {
  return {
    ...env,
    CODEKSEI_WEIXIN_REPLY_MODE: mode,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
