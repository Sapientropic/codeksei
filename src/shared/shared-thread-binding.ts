import { normalizeText } from "../contracts/text-normalization";
import * as fs from "node:fs";
import { resolveSelectedAccount } from "../adapters/channel/weixin/account-store";
import { SessionStore } from "../adapters/runtime/codex/session-store";
import { readPrefixedEnv } from "../contracts/app-env";
import { normalizeCodekseiRuntimeProvider } from "../core/config-value-types";
import {
  normalizeDisplayPath,
  resolveCrossPlatformPath,
} from "../contracts/path-utils";
import {
  resolveSharedProcessContext,
  type SharedProcessContext,
} from "./shared-process";

interface BoundThreadResult {
  threadId: string;
  workspaceRoot: string;
}

function resolveSelectedAccountId(context: SharedProcessContext): string {
  return normalizeText(resolveSelectedAccount({
    accountsDir: context.accountsDir,
    accountId: process.env.CODEKSEI_ACCOUNT_ID || "",
  }).accountId);
}

function resolveBoundThread(
  workspaceRoot: unknown,
  { context = resolveSharedProcessContext() }: { context?: SharedProcessContext } = {},
): BoundThreadResult {
  const normalizedWorkspaceRoot = normalizeWorkspaceLookupRoot(workspaceRoot || process.cwd());
  const runtimeId = normalizeCodekseiRuntimeProvider(readPrefixedEnv(process.env, "RUNTIME")) || "codex";
  const sessionStore = new SessionStore({ filePath: context.sessionFile, runtimeId });
  const currentAccountId = resolveSelectedAccountId(context);
  const bindings = sessionStore
    .listBindings()
    .filter((binding) => !currentAccountId || normalizeText(binding?.accountId) === currentAccountId)
    .sort((left, right) => parseTimestamp(right?.updatedAt) - parseTimestamp(left?.updatedAt));

  const exact = bindings.find((binding) => getThreadId(binding, normalizedWorkspaceRoot, runtimeId));
  const exactThreadId = exact ? getThreadId(exact, normalizedWorkspaceRoot, runtimeId) : "";
  if (exactThreadId) {
    return {
      threadId: exactThreadId,
      workspaceRoot: normalizedWorkspaceRoot,
    };
  }

  const active = bindings.find((binding) => {
    const activeRoot = normalizeText(binding?.activeWorkspaceRoot);
    return activeRoot && normalizeText(getThreadId(binding, activeRoot, runtimeId));
  });
  if (active) {
    const activeRoot = normalizeText(active.activeWorkspaceRoot);
    return {
      threadId: getThreadId(active, activeRoot, runtimeId),
      workspaceRoot: activeRoot,
    };
  }

  throw new Error(`没有找到与 workspace 绑定的共享 thread: ${normalizedWorkspaceRoot}`);
}

function normalizeWorkspaceLookupRoot(workspaceRoot: unknown): string {
  const normalizedWorkspaceRoot = resolveCrossPlatformPath(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return "";
  }
  try {
    const realpath = typeof fs.realpathSync.native === "function"
      ? fs.realpathSync.native(normalizedWorkspaceRoot)
      : fs.realpathSync(normalizedWorkspaceRoot);
    return normalizeDisplayPath(realpath);
  } catch {
    return normalizeDisplayPath(normalizedWorkspaceRoot);
  }
}

function getThreadId(binding: unknown, workspaceRoot: unknown, runtimeId: string): string {
  const runtimeMap = binding && typeof binding === "object" && "threadIdByWorkspaceRootByRuntime" in binding
    && binding.threadIdByWorkspaceRootByRuntime && typeof binding.threadIdByWorkspaceRootByRuntime === "object"
    ? binding.threadIdByWorkspaceRootByRuntime as Record<string, Record<string, unknown>>
    : {};
  const scoped = runtimeMap[runtimeId] && typeof runtimeMap[runtimeId] === "object"
    ? normalizeText(runtimeMap[runtimeId]?.[normalizeText(workspaceRoot)])
    : "";
  if (scoped) {
    return scoped;
  }
  const map = runtimeId === "codex" && binding && typeof binding === "object" && "threadIdByWorkspaceRoot" in binding
    && binding.threadIdByWorkspaceRoot && typeof binding.threadIdByWorkspaceRoot === "object"
    ? binding.threadIdByWorkspaceRoot as Record<string, unknown>
    : {};
  return normalizeText(map[normalizeText(workspaceRoot)]);
}

function parseTimestamp(value: unknown): number {
  const parsed = Date.parse(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export {
  resolveBoundThread,
};

