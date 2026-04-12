const fs = require("fs");
const path = require("path");
const { normalizeRouteTag } = require("./protocol");
const {
  isPlainObject,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} = require("../../../core/json-state");

function normalizeAccountId(raw: any) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function ensureAccountsDir(config: any) {
  fs.mkdirSync(config.accountsDir, { recursive: true });
}

function resolveAccountPath(config: any, accountId: any) {
  return path.join(config.accountsDir, `${normalizeAccountId(accountId)}.json`);
}

function deleteWeixinAccount(config: any, accountId: any) {
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

function saveWeixinAccount(config: any, rawAccountId: any, update: any) {
  ensureAccountsDir(config);
  const accountId = normalizeAccountId(rawAccountId);
  const filePath = resolveAccountPath(config, accountId);
  const existing = loadWeixinAccount(config, accountId);
  const hasRouteTag = Object.prototype.hasOwnProperty.call(update || {}, "routeTag");
  const next = {
    accountId,
    rawAccountId: String(rawAccountId || "").trim() || existing?.rawAccountId || "",
    token: typeof update.token === "string" && update.token.trim() ? update.token.trim() : existing?.token || "",
    baseUrl: typeof update.baseUrl === "string" && update.baseUrl.trim() ? update.baseUrl.trim() : existing?.baseUrl || config.weixinBaseUrl,
    userId: typeof update.userId === "string" ? update.userId.trim() : existing?.userId || "",
    routeTag: hasRouteTag
      ? normalizeRouteTag(update.routeTag)
      : normalizeRouteTag(existing?.routeTag || config.weixinRouteTag),
    savedAt: new Date().toISOString(),
  };
  writeManagedJsonStateFile(filePath, next, { mode: 0o600 });
  return next;
}

function loadWeixinAccount(config: any, accountId: any) {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) {
    return null;
  }
  const parsed = readManagedJsonStateFile({
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
    baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : config.weixinBaseUrl,
    userId: typeof parsed.userId === "string" ? parsed.userId : "",
    routeTag: Object.prototype.hasOwnProperty.call(parsed, "routeTag")
      ? normalizeRouteTag(parsed.routeTag)
      : normalizeRouteTag(config.weixinRouteTag),
    savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
  };
}

function listWeixinAccounts(config: any) {
  ensureAccountsDir(config);
  const files = fs.readdirSync(config.accountsDir, { withFileTypes: true });
  return files
    .filter((entry: any) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".context-tokens.json"))
    .map((entry: any) => loadWeixinAccount(config, entry.name.slice(0, -5)))
    .filter(Boolean)
    .sort((left: any, right: any) => String(right.savedAt || "").localeCompare(String(left.savedAt || "")));
}

function resolveSelectedAccount(config: any) {
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
    const accountIds = accounts.map((account: any) => account.accountId).join(", ");
    throw new Error(`检测到多个微信账号，请设置 CODEKSEI_ACCOUNT_ID（或旧的 CYBERBOSS_ACCOUNT_ID）。可选值: ${accountIds}`);
  }
  if (!accounts[0].token) {
    throw new Error(`微信账号缺少 token: ${accounts[0].accountId}，请重新执行 login`);
  }
  return accounts[0];
}

function validateWeixinAccountRecord(value: any) {
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

module.exports = {
  deleteWeixinAccount,
  listWeixinAccounts,
  loadWeixinAccount,
  normalizeAccountId,
  resolveAccountPath,
  resolveSelectedAccount,
  saveWeixinAccount,
};

export {};
