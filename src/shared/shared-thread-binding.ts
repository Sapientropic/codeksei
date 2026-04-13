import { normalizeText } from "../core/text-normalization";
import * as fs from "node:fs";
import { resolveSelectedAccount } from "../adapters/channel/weixin/account-store";
import { SessionStore } from "../adapters/runtime/codex/session-store";
import {
  normalizeDisplayPath,
  resolveCrossPlatformPath,
} from "../core/path-utils";
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
  const sessionStore = new SessionStore({ filePath: context.sessionFile });
  const currentAccountId = resolveSelectedAccountId(context);
  const bindings = sessionStore
    .listBindings()
    .filter((binding) => !currentAccountId || normalizeText(binding?.accountId) === currentAccountId)
    .sort((left, right) => parseTimestamp(right?.updatedAt) - parseTimestamp(left?.updatedAt));

  const exact = bindings.find((binding) => getThreadId(binding, normalizedWorkspaceRoot));
  const exactThreadId = exact ? getThreadId(exact, normalizedWorkspaceRoot) : "";
  if (exactThreadId) {
    return {
      threadId: exactThreadId,
      workspaceRoot: normalizedWorkspaceRoot,
    };
  }

  const active = bindings.find((binding) => {
    const activeRoot = normalizeText(binding?.activeWorkspaceRoot);
    return activeRoot && normalizeText(getThreadId(binding, activeRoot));
  });
  if (active) {
    const activeRoot = normalizeText(active.activeWorkspaceRoot);
    return {
      threadId: getThreadId(active, activeRoot),
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

function getThreadId(binding: unknown, workspaceRoot: unknown): string {
  const map = binding && typeof binding === "object" && "threadIdByWorkspaceRoot" in binding
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

