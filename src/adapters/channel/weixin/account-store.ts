import * as fs from "node:fs";
import * as path from "node:path";

import { normalizeRouteTag } from "./protocol";
import {
  isPlainObject,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} from "../../../state/json-state";

interface WeixinAccountConfig extends Record<string, unknown> {
  accountsDir?: string;
  weixinBaseUrl?: string;
  weixinRouteTag?: string;
  accountId?: string;
}

interface WeixinAccountRecord extends Record<string, unknown> {
  accountId: string;
  rawAccountId: string;
  token: string;
  baseUrl: string;
  userId: string;
  routeTag: string;
  savedAt: string;
}

type WeixinAccountUpdate = Partial<WeixinAccountRecord> & Record<string, unknown>;

function normalizeAccountId(raw: unknown): string {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensureAccountsDir(config: WeixinAccountConfig): void {
  fs.mkdirSync(resolveAccountsDir(config), { recursive: true });
}

function resolveAccountPath(config: WeixinAccountConfig, accountId: unknown): string {
  return path.join(resolveAccountsDir(config), `${normalizeAccountId(accountId)}.json`);
}

function deleteWeixinAccount(config: WeixinAccountConfig, accountId: unknown): boolean {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) {
    return false;
  }
  try {
    const filePath = resolveAccountPath(config, normalized);
    if (!fs.existsSync(filePath)) {
      return false;
    }
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function saveWeixinAccount(
  config: WeixinAccountConfig,
  rawAccountId: unknown,
  update: WeixinAccountUpdate,
): WeixinAccountRecord {
  ensureAccountsDir(config);
  const accountId = normalizeAccountId(rawAccountId);
  const filePath = resolveAccountPath(config, accountId);
  const existing = loadWeixinAccount(config, accountId);
  const hasRouteTag = Object.prototype.hasOwnProperty.call(update || {}, "routeTag");
  const next = {
    accountId,
    rawAccountId: String(rawAccountId || "").trim() || existing?.rawAccountId || "",
    token: typeof update.token === "string" && update.token.trim() ? update.token.trim() : existing?.token || "",
    baseUrl: typeof update.baseUrl === "string" && update.baseUrl.trim()
      ? update.baseUrl.trim()
      : existing?.baseUrl || resolveWeixinBaseUrl(config),
    userId: typeof update.userId === "string" ? update.userId.trim() : existing?.userId || "",
    routeTag: hasRouteTag
      ? normalizeRouteTag(update.routeTag)
      : normalizeRouteTag(existing?.routeTag || config.weixinRouteTag),
    savedAt: new Date().toISOString(),
  };
  writeManagedJsonStateFile(filePath, next, { mode: 0o600 });
  return next;
}

function loadWeixinAccount(config: WeixinAccountConfig, accountId: unknown): WeixinAccountRecord | null {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) {
    return null;
  }
  const parsed = readManagedJsonStateFile<Record<string, unknown> | null>({
    filePath: resolveAccountPath(config, normalized),
    fallback: null,
    label: "weixin account",
    validate: validateWeixinAccountRecord,
  });
  if (!parsed || !isPlainObject(parsed)) {
    return null;
  }
  return {
    accountId: normalized,
    rawAccountId: typeof parsed.rawAccountId === "string" ? parsed.rawAccountId : "",
    token: typeof parsed.token === "string" ? parsed.token : "",
    baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl.trim()
      ? parsed.baseUrl.trim()
      : resolveWeixinBaseUrl(config),
    userId: typeof parsed.userId === "string" ? parsed.userId : "",
    routeTag: Object.prototype.hasOwnProperty.call(parsed, "routeTag")
      ? normalizeRouteTag(parsed.routeTag)
      : normalizeRouteTag(config.weixinRouteTag),
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
  };
}

function listWeixinAccounts(config: WeixinAccountConfig): WeixinAccountRecord[] {
  ensureAccountsDir(config);
  const files = fs.readdirSync(resolveAccountsDir(config), { withFileTypes: true });
  return files
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".context-tokens.json"))
    .map((entry) => loadWeixinAccount(config, entry.name.slice(0, -5)))
    .filter(Boolean)
    .sort((left, right) => String(right?.savedAt || "").localeCompare(String(left?.savedAt || ""))) as WeixinAccountRecord[];
}

function resolveSelectedAccount(config: WeixinAccountConfig): WeixinAccountRecord {
  if (config.accountId) {
    const account = loadWeixinAccount(config, config.accountId);
    if (!account) {
      throw new Error(`未找到微信账号: ${config.accountId}`);
    }
    if (!account.token) {
      throw new Error(`微信账号缺少 token: ${account.accountId}，请重新执行 login`);
    }
    return account;
  }
  const accounts = listWeixinAccounts(config);
  if (!accounts.length) {
    throw new Error("当前没有已保存的微信账号，请先执行 `npm run login`");
  }
  if (accounts.length > 1) {
    const accountIds = accounts.map((account) => account.accountId).join(", ");
    throw new Error(`检测到多个微信账号，请设置 CODEKSEI_ACCOUNT_ID。可选值: ${accountIds}`);
  }
  const selectedAccount = accounts[0];
  if (!selectedAccount) {
    throw new Error("当前没有已保存的微信账号，请先执行 `npm run login`");
  }
  if (!selectedAccount.token) {
    throw new Error(`微信账号缺少 token: ${selectedAccount.accountId}，请重新执行 login`);
  }
  return selectedAccount;
}

function resolveAccountsDir(config: WeixinAccountConfig): string {
  return typeof config.accountsDir === "string" ? config.accountsDir : "";
}

function resolveWeixinBaseUrl(config: WeixinAccountConfig): string {
  return typeof config.weixinBaseUrl === "string" ? config.weixinBaseUrl : "";
}

function validateWeixinAccountRecord(value: unknown): true | string {
  if (!isPlainObject(value)) {
    return "weixin account state must be an object";
  }
  if ("accountId" in value && typeof value.accountId !== "string") {
    return "weixin account accountId must be a string";
  }
  if ("rawAccountId" in value && typeof value.rawAccountId !== "string") {
    return "weixin account rawAccountId must be a string";
  }
  if ("token" in value && typeof value.token !== "string") {
    return "weixin account token must be a string";
  }
  if ("baseUrl" in value && typeof value.baseUrl !== "string") {
    return "weixin account baseUrl must be a string";
  }
  if ("userId" in value && typeof value.userId !== "string") {
    return "weixin account userId must be a string";
  }
  if ("routeTag" in value && typeof value.routeTag !== "string") {
    return "weixin account routeTag must be a string";
  }
  if ("savedAt" in value && typeof value.savedAt !== "string") {
    return "weixin account savedAt must be a string";
  }
  return true;
}

export {
  deleteWeixinAccount,
  listWeixinAccounts,
  loadWeixinAccount,
  normalizeAccountId,
  resolveAccountPath,
  resolveSelectedAccount,
  saveWeixinAccount,
  type WeixinAccountConfig,
  type WeixinAccountRecord,
};
