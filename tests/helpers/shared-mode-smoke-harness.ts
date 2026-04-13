const fs: typeof import("node:fs") = require("node:fs");
const http: typeof import("node:http") = require("node:http");
const path: typeof import("node:path") = require("node:path");
const { spawn, spawnSync }: typeof import("node:child_process") = require("node:child_process");
const { WebSocketServer }: typeof import("ws") = require("ws");
const { resolveRuntimeEntrypointAbsolute }: typeof import("../../src/contracts/runtime-entrypoints") = require("../../src/contracts/runtime-entrypoints");
import type { IncomingMessage, Server } from "node:http";
import type { WebSocket } from "ws";

interface FakeWeixinMessage {
  from_user_id: string;
  context_token: string;
  session_id: string;
  message_id: string;
  seq: number;
  create_time_ms: number;
  message_type: number;
  item_list: Array<Record<string, unknown>>;
}

interface LoggedWeixinRequest {
  endpoint: string;
  body: Record<string, unknown>;
  at: string;
}

interface FakeTurnStart {
  requestId: string;
  threadId: string;
  turnId: string;
  text: string;
  params: Record<string, unknown>;
  socket: WebSocket;
}

interface ApprovalResponseLog {
  id: string;
  result: Record<string, unknown>;
  at: string;
}

type TurnHandler = (args: FakeTurnStart) => Promise<void> | void;
type ApprovalResponseHandler = (args: ApprovalResponseLog & { socket: WebSocket }) => Promise<void> | void;

async function createFakeWeixinServer(): Promise<{
  baseUrl: string;
  enqueueTextMessage(text: string, overrides?: Partial<FakeWeixinMessage>): void;
  clearOutbound(): void;
  getSentTexts(): string[];
  waitForSentText(predicate: (text: string) => boolean, timeoutMs?: number): Promise<string>;
  waitForSentCount(predicate: (texts: string[]) => boolean, timeoutMs?: number): Promise<string[]>;
  stop(): Promise<void>;
}> {
  const messageQueue: FakeWeixinMessage[] = [];
  const outbound: LoggedWeixinRequest[] = [];
  let messageSeq = 0;
  const server = http.createServer(async (req, res) => {
    const bodyText = await readRequestBody(req);
    const body = parseJson(bodyText);
    const endpoint = req.url || "/";
    if (endpoint.endsWith("/ilink/bot/getupdates")) {
      const nextMessages = messageQueue.splice(0, messageQueue.length);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ret: 0,
        get_updates_buf: `buf-${Date.now()}`,
        msgs: nextMessages,
      }));
      return;
    }

    if (endpoint.endsWith("/ilink/bot/getconfig")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ret: 0,
        typing_ticket: "typing-ticket",
      }));
      return;
    }

    if (endpoint.endsWith("/ilink/bot/sendmessage") || endpoint.endsWith("/ilink/bot/sendtyping")) {
      outbound.push({
        endpoint,
        body,
        at: new Date().toISOString(),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ret: 0, errcode: 0, errmsg: "" }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ret: 404, errcode: 404, errmsg: "not found" }));
  });
  await listenServer(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fake weixin server failed to bind");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    enqueueTextMessage(text, overrides = {}) {
      messageSeq += 1;
      messageQueue.push({
        from_user_id: "user-1",
        context_token: "ctx-1",
        session_id: "session-1",
        message_id: `msg-${messageSeq}`,
        seq: messageSeq,
        create_time_ms: Date.now(),
        message_type: 1,
        item_list: [{ type: 1, text_item: { text } }],
        ...overrides,
      });
    },
    clearOutbound() {
      outbound.splice(0, outbound.length);
    },
    getSentTexts() {
      return outbound
        .filter((entry) => entry.endpoint.endsWith("/ilink/bot/sendmessage"))
        .map(extractWeixinText)
        .filter(Boolean);
    },
    async waitForSentText(predicate, timeoutMs = 15_000) {
      await waitForCondition(() => {
        const matched = outbound
          .filter((entry) => entry.endpoint.endsWith("/ilink/bot/sendmessage"))
          .map(extractWeixinText)
          .find(predicate);
        return matched || "";
      }, timeoutMs);
      return outbound
        .filter((entry) => entry.endpoint.endsWith("/ilink/bot/sendmessage"))
        .map(extractWeixinText)
        .find(predicate) || "";
    },
    async waitForSentCount(predicate, timeoutMs = 15_000) {
      await waitForCondition(() => {
        const texts = outbound
          .filter((entry) => entry.endpoint.endsWith("/ilink/bot/sendmessage"))
          .map(extractWeixinText)
          .filter(Boolean);
        return predicate(texts) ? texts : null;
      }, timeoutMs);
      return outbound
        .filter((entry) => entry.endpoint.endsWith("/ilink/bot/sendmessage"))
        .map(extractWeixinText)
        .filter(Boolean);
    },
    async stop() {
      await closeServer(server);
    },
  };
}

async function createFakeCodexAppServer(): Promise<{
  listenUrl: string;
  setTurnHandler(handler: TurnHandler | null): void;
  setApprovalResponseHandler(handler: ApprovalResponseHandler | null): void;
  waitForTurnStart(predicate: (entry: FakeTurnStart) => boolean, timeoutMs?: number): Promise<FakeTurnStart>;
  emitTurnStarted(socket: WebSocket, threadId: string, turnId: string): void;
  emitReplyDelta(socket: WebSocket, threadId: string, turnId: string, itemId: string, text: string): void;
  emitReplyCompleted(socket: WebSocket, threadId: string, turnId: string, itemId: string, text: string): void;
  emitTurnCompleted(socket: WebSocket, threadId: string, turnId: string): void;
  emitApprovalRequest(socket: WebSocket, args: {
    approvalId: string;
    threadId: string;
    reason: string;
    command: string[];
  }): void;
  waitForApprovalResponse(predicate: (entry: ApprovalResponseLog) => boolean, timeoutMs?: number): Promise<ApprovalResponseLog>;
  stop(): Promise<void>;
}> {
  const approvalResponses: ApprovalResponseLog[] = [];
  const turnStarts: FakeTurnStart[] = [];
  let turnHandler: TurnHandler | null = null;
  let approvalResponseHandler: ApprovalResponseHandler | null = null;
  let threadCounter = 0;
  let turnCounter = 0;

  const server = http.createServer((req, res) => {
    if (req.url === "/readyz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const envelope = parseJson(String(raw || ""));
      if (!isRecord(envelope)) {
        return;
      }
      const method = normalizeText(envelope.method);
      const id = normalizeText(envelope.id);
      if (!method && id && isRecord(envelope.result)) {
        const logged = {
          id,
          result: envelope.result,
          at: new Date().toISOString(),
        };
        approvalResponses.push(logged);
        void approvalResponseHandler?.({ ...logged, socket });
        return;
      }
      if (!method) {
        return;
      }

      if (method === "initialize") {
        socket.send(JSON.stringify({ id: envelope.id, result: {} }));
        return;
      }
      if (method === "initialized") {
        return;
      }
      if (method === "model/list") {
        socket.send(JSON.stringify({
          id: envelope.id,
          result: {
            data: [{
              id: "gpt-5.4",
              model: "gpt-5.4",
              display_name: "GPT-5.4",
              supported_reasoning_efforts: ["low", "medium", "high"],
              default_reasoning_effort: "medium",
              is_default: true,
            }],
          },
        }));
        return;
      }
      if (method === "thread/start") {
        threadCounter += 1;
        const threadId = `thread-${threadCounter}`;
        socket.send(JSON.stringify({
          id: envelope.id,
          result: { thread: { id: threadId } },
        }));
        return;
      }
      if (method === "thread/resume") {
        const threadId = normalizeText(asRecord(envelope.params).threadId) || "thread-shared";
        socket.send(JSON.stringify({
          id: envelope.id,
          result: { thread: { id: threadId } },
        }));
        return;
      }
      if (method === "turn/start") {
        turnCounter += 1;
        const params = asRecord(envelope.params);
        const threadId = normalizeText(params.threadId) || "thread-shared";
        const turnId = `turn-${turnCounter}`;
        const text = extractTurnText(params);
        socket.send(JSON.stringify({
          id: envelope.id,
          result: { turn: { id: turnId } },
        }));
        const turnStart = {
          requestId: id,
          threadId,
          turnId,
          text,
          params,
          socket,
        };
        turnStarts.push(turnStart);
        void turnHandler?.(turnStart);
        return;
      }
      if (method === "turn/cancel") {
        socket.send(JSON.stringify({ id: envelope.id, result: {} }));
      }
    });
  });
  await listenServer(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fake codex app-server failed to bind");
  }

  return {
    listenUrl: `ws://127.0.0.1:${address.port}`,
    setTurnHandler(handler) {
      turnHandler = handler;
    },
    setApprovalResponseHandler(handler) {
      approvalResponseHandler = handler;
    },
    async waitForTurnStart(predicate, timeoutMs = 15_000) {
      await waitForCondition(() => turnStarts.find(predicate) || null, timeoutMs);
      const matched = turnStarts.find(predicate);
      if (!matched) {
        throw new Error("expected turn/start log");
      }
      return matched;
    },
    emitTurnStarted(socket, threadId, turnId) {
      socket.send(JSON.stringify({
        method: "turn/started",
        params: { threadId, turnId },
      }));
    },
    emitReplyDelta(socket, threadId, turnId, itemId, text) {
      socket.send(JSON.stringify({
        method: "item/agentMessage/delta",
        params: {
          threadId,
          turnId,
          itemId,
          delta: text,
          item: { id: itemId },
        },
      }));
    },
    emitReplyCompleted(socket, threadId, turnId, itemId, text) {
      socket.send(JSON.stringify({
        method: "item/completed",
        params: {
          threadId,
          turnId,
          item: {
            id: itemId,
            type: "agentMessage",
            text,
          },
        },
      }));
    },
    emitTurnCompleted(socket, threadId, turnId) {
      socket.send(JSON.stringify({
        method: "turn/completed",
        params: { threadId, turnId },
      }));
    },
    emitApprovalRequest(socket, { approvalId, threadId, reason, command }) {
      socket.send(JSON.stringify({
        id: approvalId,
        method: "shell/requestApproval",
        params: {
          threadId,
          reason,
          command,
        },
      }));
    },
    async waitForApprovalResponse(predicate, timeoutMs = 15_000) {
      await waitForCondition(() => approvalResponses.find(predicate) || null, timeoutMs);
      const matched = approvalResponses.find(predicate);
      if (!matched) {
        throw new Error("expected approval response log");
      }
      return matched;
    },
    async stop() {
      wss.close();
      await closeServer(server);
    },
  };
}

function createFakeCodexCommandWrapper(tempRoot: string): { commandPath: string; logFile: string } {
  const logFile = path.join(tempRoot, "fake-codex-resume.log");
  const commandPath = process.platform === "win32"
    ? path.join(tempRoot, "fake-codex.cmd")
    : path.join(tempRoot, "fake-codex");
  if (process.platform === "win32") {
    fs.writeFileSync(commandPath, [
      "@echo off",
      `echo %*>>\"${logFile}\"`,
      "exit /b 0",
      "",
    ].join("\r\n"), "utf8");
  } else {
    fs.writeFileSync(commandPath, [
      "#!/usr/bin/env sh",
      `printf '%s\\n' \"$*\" >> \"${logFile}\"`,
      "exit 0",
      "",
    ].join("\n"), "utf8");
    fs.chmodSync(commandPath, 0o755);
  }
  return { commandPath, logFile };
}

function buildSharedModeEnv(base: NodeJS.ProcessEnv, overrides: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...base,
    ...overrides,
  };
}

function runPackageScript(
  repoRoot: string,
  scriptName: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 60_000,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const sharedEntrypoint = resolveSharedEntrypoint(repoRoot, scriptName);
  const command = sharedEntrypoint ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
  const args = sharedEntrypoint ? [sharedEntrypoint] : ["run", "--silent", scriptName];
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // best effort
      }
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr.on("data", (chunk) => {
      stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        status: code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        status: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}${String(error)}`,
      });
    });
  });
}

function readPidFileValue(filePath: string): number {
  try {
    return Number.parseInt(fs.readFileSync(filePath, "utf8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

async function terminatePid(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return;
  }
  try {
    process.kill(pid);
  } catch {
    return;
  }
  await waitForCondition(() => !isPidAlive(pid), 10_000).catch(async () => {
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // best effort
      }
    }
    await waitForCondition(() => !isPidAlive(pid), 10_000);
  });
}

async function waitForCondition<T>(
  producer: () => T,
  timeoutMs = 15_000,
  intervalMs = 100,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const value = producer();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
}

function extractWeixinText(request: LoggedWeixinRequest): string {
  const msg = asRecord(request.body.msg);
  const itemList = Array.isArray(msg.item_list) ? msg.item_list : [];
  return itemList
    .map((entry) => asRecord(entry))
    .map((entry) => normalizeText(asRecord(entry.text_item).text))
    .filter(Boolean)
    .join("\n");
}

function extractTurnText(params: Record<string, unknown>): string {
  const input = Array.isArray(params.input) ? params.input : [];
  return input
    .map((entry) => asRecord(entry))
    .map((entry) => normalizeText(entry.text))
    .filter(Boolean)
    .join("\n");
}

function parseJson(rawText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawText || "{}");
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listenServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function resolveSharedEntrypoint(repoRoot: string, scriptName: string): string {
  const entrypointMap: Record<string, string> = {
    "shared:start": resolveRuntimeEntrypointAbsolute(repoRoot, "sharedStart"),
    "shared:status": resolveRuntimeEntrypointAbsolute(repoRoot, "sharedStatus"),
    "shared:open": resolveRuntimeEntrypointAbsolute(repoRoot, "sharedOpen"),
    "shared:watchdog": resolveRuntimeEntrypointAbsolute(repoRoot, "sharedWatchdog"),
  };
  return entrypointMap[scriptName] || "";
}

module.exports = {
  buildSharedModeEnv,
  createFakeCodexAppServer,
  createFakeCodexCommandWrapper,
  createFakeWeixinServer,
  readPidFileValue,
  runPackageScript,
  terminatePid,
  waitForCondition,
};
