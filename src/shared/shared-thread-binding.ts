import * as fs from "node:fs";
import * as accountStoreModule from "../adapters/channel/weixin/account-store";
import { SessionStore } from "../adapters/runtime/codex/session-store";
import { accountsDir, sessionFile } from "./shared-process";

const { loadWeixinAccount } = accountStoreModule as {
  loadWeixinAccount: (config: Record<string, unknown>, accountId: string) => Record<string, unknown>;
};

interface BoundThreadResult {
  threadId: string;
  workspaceRoot: string;
}

function resolveCurrentAccountId(): string {
  if (!fs.existsSync(accountsDir)) {
    return "";
  }
  const accountsConfig = {
    accountsDir,
    weixinBaseUrl: "",
    weixinRouteTag: "",
  };
  const entries = fs.readdirSync(accountsDir)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".context-tokens.json"))
    .map((name) => loadWeixinAccount(accountsConfig, name.slice(0, -5)))
    .map((account) => account ? {
      accountId: normalizeText(account.accountId),
      savedAt: parseTimestamp(account.savedAt),
    } : null)
    .filter((entry): entry is { accountId: string; savedAt: number } => Boolean(entry?.accountId));
  entries.sort((left, right) => right.savedAt - left.savedAt);
  return entries[0]?.accountId || "";
}

function resolveBoundThread(workspaceRoot: unknown): BoundThreadResult {
  const normalizedWorkspaceRoot = normalizeText(workspaceRoot) || process.cwd();
  const sessionStore = new SessionStore({ filePath: sessionFile });
  const currentAccountId = resolveCurrentAccountId();
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

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export {
  resolveBoundThread,
};
