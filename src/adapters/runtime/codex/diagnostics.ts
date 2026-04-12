import * as fs from "node:fs";
import {
  RUNTIME_EVENT_TYPES,
  type RuntimeEvent,
} from "../../../contracts/runtime-events";
import type { UnknownRecord } from "../../../core/runtime-types";
import * as eventsModule from "./events";
import * as messageUtilsModule from "./message-utils";

const { mapCodexMessageToRuntimeEvent } = eventsModule as {
  mapCodexMessageToRuntimeEvent: (message: RpcMessage) => RuntimeEvent<UnknownRecord> | null;
};
const { extractThreadIdFromParams } = messageUtilsModule as {
  extractThreadIdFromParams: (params: Record<string, unknown>) => string;
};

interface RpcMessageParams extends UnknownRecord {
  threadId?: unknown;
}

interface RpcMessage extends UnknownRecord {
  params?: RpcMessageParams;
}

export interface RuntimeClientLike {
  listModels(): Promise<Record<string, unknown> | null>;
  connect(): Promise<void>;
  initialize(): Promise<void>;
  close(): Promise<void>;
  isConnected(): boolean;
  onMessage(listener: (message: RpcMessage) => void): () => void;
  sendResponse(id: string | number, result: Record<string, unknown>): Promise<void>;
  cancelTurn(args: { threadId: string; turnId: string }): Promise<void>;
  resumeThread(args: { threadId: string }): Promise<unknown>;
  sendUserMessage(params: Record<string, unknown>): Promise<unknown>;
  startThread(args: { cwd?: string }): Promise<unknown>;
}

interface StartThreadWithWorkspaceDiagnosticsArgs {
  runtimeClient: RuntimeClientLike;
  cwd: string;
  bindingKey?: string;
  workspaceRoot?: string;
  runtimeWorkspaceRoot?: string;
  threadId?: string;
}

interface SendUserMessageWithDiagnosticsArgs {
  runtimeClient: RuntimeClientLike;
  params: Record<string, unknown>;
  operation: string;
  bindingKey?: string;
  threadId?: string;
  workspaceRoot?: string;
  runtimeWorkspaceRoot?: string;
}

interface LogInvalidWorkspaceErrorArgs {
  operation: string;
  bindingKey?: string;
  threadId?: string;
  workspaceRoot?: string;
  runtimeWorkspaceRoot?: string;
  error: unknown;
}

export interface WaitForTurnCompletionResult {
  turnId: string;
  text: string;
}

export async function startThreadWithWorkspaceDiagnostics({
  runtimeClient,
  cwd,
  bindingKey = "",
  workspaceRoot = "",
  runtimeWorkspaceRoot = "",
  threadId = "",
}: StartThreadWithWorkspaceDiagnosticsArgs): Promise<unknown> {
  try {
    return await runtimeClient.startThread({ cwd });
  } catch (error) {
    logInvalidWorkspaceError({
      operation: "thread/start",
      bindingKey,
      threadId,
      workspaceRoot,
      runtimeWorkspaceRoot,
      error,
    });
    throw error;
  }
}

export async function sendUserMessageWithWorkspaceDiagnostics({
  runtimeClient,
  params,
  operation,
  bindingKey = "",
  threadId = "",
  workspaceRoot = "",
  runtimeWorkspaceRoot = "",
}: SendUserMessageWithDiagnosticsArgs): Promise<unknown> {
  try {
    return await runtimeClient.sendUserMessage(params);
  } catch (error) {
    logInvalidWorkspaceError({
      operation,
      bindingKey,
      threadId: threadId || normalizeText(params.threadId),
      workspaceRoot,
      runtimeWorkspaceRoot,
      error,
    });
    throw error;
  }
}

export function waitForTurnCompletion(
  client: RuntimeClientLike,
  threadId: string,
): Promise<WaitForTurnCompletionResult> {
  return new Promise((resolve, reject) => {
    let activeTurnId = "";
    const itemOrder: string[] = [];
    const textByItemId = new Map<string, string>();

    const cleanup = () => {
      unsubscribe();
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("codex turn timed out"));
    }, 10 * 60_000);

    const unsubscribe = client.onMessage((message) => {
      const runtimeEvent = mapCodexMessageToRuntimeEvent(message) as RuntimeEvent<UnknownRecord> | null;
      const params = isRecord(message?.params) ? message.params : {};
      const messageThreadId = normalizeLogValue(runtimeEvent?.payload?.threadId)
        || normalizeText(extractThreadIdFromParams(params));
      if (messageThreadId !== threadId) {
        return;
      }

      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.TURN_STARTED && !activeTurnId) {
        activeTurnId = normalizeLogValue(runtimeEvent.payload.turnId);
        return;
      }

      if (
        runtimeEvent?.type === RUNTIME_EVENT_TYPES.REPLY_DELTA
        || runtimeEvent?.type === RUNTIME_EVENT_TYPES.REPLY_COMPLETED
      ) {
        const itemId = normalizeLogValue(runtimeEvent.payload.itemId) || `item-${itemOrder.length + 1}`;
        if (!textByItemId.has(itemId)) {
          itemOrder.push(itemId);
          textByItemId.set(itemId, "");
        }
        const nextText = normalizeLogValue(runtimeEvent.payload.text);
        if (nextText) {
          if (runtimeEvent.type === RUNTIME_EVENT_TYPES.REPLY_DELTA) {
            textByItemId.set(itemId, `${textByItemId.get(itemId) || ""}${nextText}`);
          } else {
            textByItemId.set(itemId, nextText);
          }
        }
        return;
      }

      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.TURN_FAILED) {
        cleanup();
        reject(new Error(normalizeLogValue(runtimeEvent.payload.text) || "执行失败"));
        return;
      }

      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.TURN_COMPLETED) {
        const completedTurnId = normalizeLogValue(runtimeEvent.payload.turnId);
        if (activeTurnId && completedTurnId && completedTurnId !== activeTurnId) {
          return;
        }
        cleanup();
        const text = itemOrder
          .slice()
          .reverse()
          .map((itemId) => textByItemId.get(itemId) || "")
          .find((value) => String(value || "").trim()) || "";
        resolve({
          turnId: completedTurnId || activeTurnId,
          text: String(text || "").trim() || "已完成。",
        });
      }
    });
  });
}

export function normalizeLogValue(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\\/g, "/") : "";
}

export function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function logInvalidWorkspaceError({
  operation,
  bindingKey = "",
  threadId = "",
  workspaceRoot = "",
  runtimeWorkspaceRoot = "",
  error,
}: LogInvalidWorkspaceErrorArgs): void {
  if (!isInvalidWorkspaceError(error)) {
    return;
  }
  console.error(
    `[codeksei] codex ${operation} invalid workspace cwd `
    + `thread=${normalizeLogValue(threadId) || "(new)"} `
    + `binding=${normalizeLogValue(bindingKey) || "(none)"} `
    + `workspaceRoot=${normalizeLogValue(workspaceRoot) || "(empty)"} `
    + `workspaceState=${describeWorkspaceState(workspaceRoot)} `
    + `runtimeWorkspaceRoot=${normalizeLogValue(runtimeWorkspaceRoot) || "(empty)"} `
    + `runtimeWorkspaceState=${describeWorkspaceState(runtimeWorkspaceRoot)} `
    + `error=${formatErrorMessage(error)}`
  );
}

function isInvalidWorkspaceError(error: unknown): boolean {
  const message = formatErrorMessage(error).toLowerCase();
  return message.includes("os error 267")
    || message.includes("notadirectory")
    || message.includes("目录名称无效");
}

function describeWorkspaceState(workspaceRoot: unknown): string {
  const normalized = normalizeLogValue(workspaceRoot);
  if (!normalized) {
    return "empty";
  }
  try {
    return fs.statSync(normalized).isDirectory() ? "directory" : "not-directory";
  } catch {
    return "missing";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
