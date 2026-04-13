#!/usr/bin/env node

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildRuntimeEntrypointArg,
  resolveRuntimeEntrypointAbsolute,
} from "../contracts/runtime-entrypoints";
import { SessionStore } from "../adapters/runtime/codex/session-store";
import {
  ensureLogDir,
  ensureManagedAppServer,
  ensureManagedBridge,
  ensureManagedSupervisor,
  resolveBoundThread,
  resolveSharedProcessContext,
  stopManagedProcess,
  type SharedProcessContext,
} from "../shared/shared-common";
import { collectSharedStatusSnapshot } from "../shared/shared-status";
import { hashReplyText } from "../runtime/stream-delivery/trace-abandonment";
import { sanitizeSmokeText, writeLiveSmokeRecord } from "./live-smoke-records";

type SmokeKind = "approval" | "attach" | "reply";
type ReplyMode = "both" | "settled" | "stream";

interface SmokeOptions {
  notes: string;
  operator: string;
  record: boolean;
  replyMode: ReplyMode;
  timeoutMs: number;
  workspaceRoot: string;
}

interface SmokeRunEvidence {
  checkpoints: string[];
  evidenceSummary: string;
}

async function main(): Promise<void> {
  const kind = normalizeKind(process.argv[2]);
  if (!kind) {
    throw new Error(`用法: node ${buildRuntimeEntrypointArg("maintainerLiveSmoke")} <attach|reply|approval> [--timeout-ms 120000] [--workspace-root PATH] [--mode stream|settled|both] [--record] [--operator <name>] [--notes \"...\"]`);
  }

  const options = parseOptions(process.argv.slice(3));
  const recordingRoot = resolveRecordingRoot();
  try {
    const evidence = await runSmoke(kind, options);
    if (options.record) {
      const output = writeLiveSmokeRecord(recordingRoot, {
        checkpoints: evidence.checkpoints,
        commit: resolveGitCommit(recordingRoot),
        evidenceSummary: evidence.evidenceSummary,
        kind,
        mode: kind === "reply" ? options.replyMode : "",
        notes: options.notes,
        operator: options.operator,
        recordedAt: new Date().toISOString(),
        result: "passed",
      });
      console.log(`recorded live smoke: ${path.relative(recordingRoot, output.archivePath)}`);
    }
  } catch (error) {
    if (options.record) {
      const output = writeLiveSmokeRecord(recordingRoot, {
        commit: resolveGitCommit(recordingRoot),
        evidenceSummary: buildFailureSummary(error),
        kind,
        mode: kind === "reply" ? options.replyMode : "",
        notes: options.notes,
        operator: options.operator,
        recordedAt: new Date().toISOString(),
        result: "failed",
      });
      console.error(`recorded failed live smoke: ${path.relative(recordingRoot, output.archivePath)}`);
    }
    throw error;
  }
}

async function runSmoke(kind: SmokeKind, options: SmokeOptions): Promise<SmokeRunEvidence> {
  switch (kind) {
    case "attach":
      return runAttachSmoke(options);
    case "reply":
      return runReplySmoke(options);
    case "approval":
      return runApprovalSmoke(options);
  }
}

async function runAttachSmoke(options: SmokeOptions): Promise<SmokeRunEvidence> {
  const context = resolveSharedProcessContext();
  ensureLogDir(context);
  appendSmokeCheckpoint(context, "attach.prepare", { workspaceRoot: options.workspaceRoot || process.cwd() });
  await ensureSharedHealthy(context);

  const status = await collectSharedStatusSnapshot();
  assertSharedHealthy(status);
  const bound = resolveBoundThread(resolveWorkspaceRoot(options), { context });
  const openWrapper = createOpenProbeWrapper();
  try {
    const result = spawnSync(process.execPath, [resolveRuntimeEntrypointAbsolute(context.rootDir, "sharedOpen")], {
      cwd: context.rootDir,
      env: {
        ...process.env,
        CODEKSEI_CODEX_COMMAND: openWrapper.commandPath,
        CODEKSEI_WORKSPACE_ROOT: bound.workspaceRoot,
      },
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || "shared:open probe failed");
    }
    const invocation = fs.existsSync(openWrapper.logFile) ? fs.readFileSync(openWrapper.logFile, "utf8") : "";
    if (!invocation.includes(`resume ${bound.threadId}`) || !invocation.includes(status.listenUrl)) {
      throw new Error("shared:open probe did not record the expected resume invocation");
    }
    appendSmokeCheckpoint(context, "attach.ok", {
      threadId: bound.threadId,
      workspaceRoot: bound.workspaceRoot,
      listenUrl: status.listenUrl,
    });
    console.log(`shared attach smoke ok thread=${bound.threadId} workspace=${bound.workspaceRoot}`);
    return {
      checkpoints: ["attach.prepare", "attach.ok"],
      evidenceSummary: "shared:start / shared:status / shared:open 真实链路通过，一次性 open probe 记录到了当前绑定线程的 resume 调用。",
    };
  } finally {
    openWrapper.dispose();
  }
}

async function runReplySmoke(options: SmokeOptions): Promise<SmokeRunEvidence> {
  const context = resolveSharedProcessContext();
  const modes = options.replyMode === "both" ? (["stream", "settled"] as const) : ([options.replyMode] as const);
  const checkpoints: string[] = [];
  const proofSummaries: string[] = [];

  for (const mode of modes) {
    const previousReplyMode = process.env.CODEKSEI_WEIXIN_REPLY_MODE;
    process.env.CODEKSEI_WEIXIN_REPLY_MODE = mode;
    try {
      await restartManagedBridge(context);
      await ensureSharedHealthy(context);
      const nonce = `codeksei-smoke-reply-${mode}-${crypto.randomUUID().slice(0, 8)}`;
      const expectedHash = hashReplyText(nonce);
      const marker = appendSmokeCheckpoint(context, "reply.prepare", { mode, nonce, hash: expectedHash });
      checkpoints.push(`reply.prepare:${mode}`);
      console.log(`reply smoke [${mode}]`);
      console.log(`1. 在当前绑定的微信聊天发送：请精确回复这串字符，不要加解释，不要加引号：${nonce}`);
      console.log(`2. 脚本会等待 shared-wechat.log 里出现 hash=${expectedHash} 的 delivered 记录。`);
      await waitForBridgeLog(context, marker, new RegExp(`delivered weixin reply .*mode=${mode} .*hash=${expectedHash}`), options.timeoutMs);
      appendSmokeCheckpoint(context, "reply.ok", { mode, nonce, hash: expectedHash });
      checkpoints.push(`reply.ok:${mode}`);
      proofSummaries.push(`${mode}=hash:${expectedHash}`);
      console.log(`reply smoke ok mode=${mode} hash=${expectedHash}`);
    } finally {
      restoreEnv("CODEKSEI_WEIXIN_REPLY_MODE", previousReplyMode);
    }
  }

  return {
    checkpoints,
    evidenceSummary: `真实桥接日志已观察到 delivered reply：${proofSummaries.join("；")}。`,
  };
}

async function runApprovalSmoke(options: SmokeOptions): Promise<SmokeRunEvidence> {
  const context = resolveSharedProcessContext();
  await ensureSharedHealthy(context);
  const bound = resolveBoundThread(resolveWorkspaceRoot(options), { context });
  const nonce = crypto.randomUUID().slice(0, 8);
  const commandNonce = `codeksei-smoke-approval-${nonce}`;
  const expectedReply = `codeksei-smoke-approval-ok-${nonce}`;
  const expectedHash = hashReplyText(expectedReply);
  const marker = appendSmokeCheckpoint(context, "approval.prepare", {
    threadId: bound.threadId,
    workspaceRoot: bound.workspaceRoot,
    expectedReply,
    hash: expectedHash,
  });

  console.log("approval smoke");
  console.log(`1. 在当前绑定的微信聊天发送：你必须先运行 shell 命令 \`node -e "console.log('${commandNonce}')"\`，然后只回复 \`${expectedReply}\`。`);
  console.log("2. 脚本会等待 pending approval 出现，随后自动重启 bridge。");
  console.log("3. bridge 重启后，请在同一聊天发送 /yes，脚本会继续等待 approval 清除和最终 delivered hash。");

  const approval = await waitForPendingApproval(context, bound.threadId, options.timeoutMs);
  appendSmokeCheckpoint(context, "approval.pending", {
    threadId: bound.threadId,
    requestId: approval.requestId,
    command: approval.command,
  });
  await restartManagedBridge(context);
  appendSmokeCheckpoint(context, "approval.restarted", {
    threadId: bound.threadId,
    requestId: approval.requestId,
  });

  await waitForPendingApprovalClear(context, bound.threadId, options.timeoutMs);
  await waitForBridgeLog(context, marker, new RegExp(`delivered weixin reply .*hash=${expectedHash}`), options.timeoutMs);
  appendSmokeCheckpoint(context, "approval.ok", {
    threadId: bound.threadId,
    expectedReply,
    hash: expectedHash,
  });
  console.log(`approval smoke ok thread=${bound.threadId} hash=${expectedHash}`);

  return {
    checkpoints: ["approval.prepare", "approval.pending", "approval.restarted", "approval.ok"],
    evidenceSummary: `已观察到 pending approval、bridge restart、approval clear，以及最终 delivered reply hash:${expectedHash}。`,
  };
}

async function ensureSharedHealthy(context: SharedProcessContext): Promise<void> {
  await ensureManagedAppServer({ restartUnhealthy: true });
  await ensureManagedBridge({ restartUnhealthy: true });
  await ensureManagedSupervisor({ intervalMinutes: 5 });
  const status = await collectSharedStatusSnapshot();
  assertSharedHealthy(status);
}

async function restartManagedBridge(context: SharedProcessContext): Promise<void> {
  await stopManagedProcess(context.supervisorPidFile, {
    expectedSubstrings: ["shared-supervisor"],
    label: "shared supervisor",
  }).catch(() => {});
  await stopManagedProcess(context.bridgePidFile, {
    expectedSubstrings: ["start", "checkin"],
    label: "shared codeksei bridge",
  }).catch(() => {});
  await ensureManagedBridge({ restartUnhealthy: true });
  await ensureManagedSupervisor({ intervalMinutes: 5 });
}

function assertSharedHealthy(status: Awaited<ReturnType<typeof collectSharedStatusSnapshot>>): void {
  if (!status.ready) {
    throw new Error("shared status is not ready; expected readyz=ok");
  }
  if (!status.bridgeHealth.healthy) {
    throw new Error(`shared bridge heartbeat is not healthy: ${status.bridgeHealth.classification.status}`);
  }
}

async function waitForPendingApproval(
  context: SharedProcessContext,
  threadId: string,
  timeoutMs: number,
): Promise<{ requestId: string; command: string }> {
  return waitForValue(() => {
    const sessionStore = new SessionStore({ filePath: context.sessionFile });
    const pending = sessionStore.getPendingApprovalForThread(threadId);
    if (!pending?.requestId) {
      return null;
    }
    return {
      requestId: String(pending.requestId),
      command: String(pending.command || ""),
    };
  }, timeoutMs, `pending approval for thread=${threadId}`);
}

async function waitForPendingApprovalClear(
  context: SharedProcessContext,
  threadId: string,
  timeoutMs: number,
): Promise<void> {
  await waitForValue(() => {
    const sessionStore = new SessionStore({ filePath: context.sessionFile });
    return sessionStore.getPendingApprovalForThread(threadId) ? null : true;
  }, timeoutMs, `approval clear for thread=${threadId}`);
}

async function waitForBridgeLog(
  context: SharedProcessContext,
  marker: string,
  pattern: RegExp,
  timeoutMs: number,
): Promise<void> {
  await waitForValue(() => {
    const content = fs.existsSync(context.bridgeLogFile) ? fs.readFileSync(context.bridgeLogFile, "utf8") : "";
    const markerIndex = content.lastIndexOf(marker);
    const slice = markerIndex >= 0 ? content.slice(markerIndex) : content;
    return pattern.test(slice) ? true : null;
  }, timeoutMs, `bridge log pattern ${pattern}`);
}

function appendSmokeCheckpoint(
  context: SharedProcessContext,
  stage: string,
  fields: Record<string, unknown>,
): string {
  ensureLogDir(context);
  const marker = [
    "[codeksei-smoke]",
    `stage=${stage}`,
    `at=${new Date().toISOString()}`,
    ...Object.entries(fields).map(([key, value]) => `${key}=${String(value ?? "")}`),
  ].join(" ");
  fs.appendFileSync(context.bridgeLogFile, `${marker}\n`, "utf8");
  fs.appendFileSync(context.appServerLogFile, `${marker}\n`, "utf8");
  return marker;
}

function createOpenProbeWrapper(): { commandPath: string; logFile: string; dispose(): void } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-open-probe-"));
  const logFile = path.join(tempDir, "shared-open.log");
  const commandPath = process.platform === "win32"
    ? path.join(tempDir, "codex-open-probe.cmd")
    : path.join(tempDir, "codex-open-probe.sh");
  const script = process.platform === "win32"
    ? `@echo off\r\necho %*>> "${logFile.replace(/\\/g, "\\\\")}"\r\nexit /b 0\r\n`
    : `#!/bin/sh\nprintf '%s\n' "$*" >> "${logFile}"\nexit 0\n`;
  fs.writeFileSync(commandPath, script, { encoding: "utf8" });
  if (process.platform !== "win32") {
    fs.chmodSync(commandPath, 0o755);
  }
  return {
    commandPath,
    logFile,
    dispose(): void {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function parseOptions(args: string[]): SmokeOptions {
  let timeoutMs = 120_000;
  let workspaceRoot = "";
  let replyMode: ReplyMode = "both";
  let record = false;
  let operator = "";
  let notes = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || "");
    if (arg === "--timeout-ms") {
      timeoutMs = Number(args[index + 1] || timeoutMs);
      index += 1;
      continue;
    }
    if (arg === "--workspace-root") {
      workspaceRoot = String(args[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--mode") {
      const candidate = normalizeReplyMode(args[index + 1]);
      if (candidate) {
        replyMode = candidate;
      }
      index += 1;
      continue;
    }
    if (arg === "--record") {
      record = true;
      continue;
    }
    if (arg === "--operator") {
      operator = String(args[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg === "--notes") {
      notes = String(args[index + 1] || "");
      index += 1;
    }
  }
  return {
    notes,
    operator,
    record,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120_000,
    workspaceRoot,
    replyMode,
  };
}

function resolveWorkspaceRoot(options: SmokeOptions): string {
  return options.workspaceRoot || process.env.CODEKSEI_WORKSPACE_ROOT || process.cwd();
}

function resolveRecordingRoot(): string {
  try {
    return resolveSharedProcessContext().rootDir;
  } catch {
    return process.cwd();
  }
}

function resolveGitCommit(rootDir: string): string {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: rootDir,
    encoding: "utf8",
    windowsHide: true,
  });
  const normalized = typeof result.stdout === "string" ? result.stdout.trim() : "";
  return normalized || "unknown";
}

function buildFailureSummary(error: unknown): string {
  const summary = error instanceof Error
    ? error.message || error.stack || "unknown error"
    : String(error || "unknown error");
  return `run failed: ${sanitizeSmokeText(summary) || "unknown error"}`;
}

function normalizeKind(value: unknown): SmokeKind | "" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "attach" || normalized === "reply" || normalized === "approval"
    ? normalized
    : "";
}

function normalizeReplyMode(value: unknown): ReplyMode | "" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "stream" || normalized === "settled" || normalized === "both"
    ? normalized
    : "";
}

function restoreEnv(key: string, value: string | undefined): void {
  if (typeof value === "string") {
    process.env[key] = value;
    return;
  }
  delete process.env[key];
}

async function waitForValue<T>(
  producer: () => T | null,
  timeoutMs: number,
  description: string,
): Promise<T> {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) <= timeoutMs) {
    const value = producer();
    if (value != null) {
      return value;
    }
    await sleep(1_000);
  }
  throw new Error(`timed out waiting for ${description}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}

export {
  main,
};
