const fs = require("fs");
const path = require("path");
const { normalizeAccountId } = require("./account-store");
const {
  isPlainObject,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} = require("../../../state/json-state");

function ensureAccountsDir(config: any) {
  fs.mkdirSync(config.accountsDir, { recursive: true });
}

function resolveContextTokenPath(config: any, accountId: any) {
  ensureAccountsDir(config);
  return path.join(config.accountsDir, `${normalizeAccountId(accountId)}.context-tokens.json`);
}

function loadPersistedContextTokens(config: any, accountId: any) {
  const filePath = resolveContextTokenPath(config, accountId);
  const parsed = readManagedJsonStateFile({
    filePath,
    fallback: {},
    label: "context token store",
    validate: validateContextTokenMap,
  });
  if (!isPlainObject(parsed)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(/** @type {Record<string, string>} */ (parsed))
      .filter(([userId, token]: any) => typeof userId === "string" && userId.trim() && typeof token === "string" && token.trim())
      .map(([userId, token]: any) => [userId.trim(), token.trim()])
  );
}

function savePersistedContextTokens(config: any, accountId: any, tokens: any) {
  const normalizedTokens = Object.fromEntries(
    Object.entries(tokens || {})
      .filter(([userId, token]: any) => typeof userId === "string" && userId.trim() && typeof token === "string" && token.trim())
      .map(([userId, token]: any) => [userId.trim(), token.trim()])
  );
  const filePath = resolveContextTokenPath(config, accountId);
  writeManagedJsonStateFile(filePath, normalizedTokens, { mode: 0o600 });
  return normalizedTokens;
}

function persistContextToken(config: any, accountId: any, userId: any, token: any) {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  const normalizedToken = typeof token === "string" ? token.trim() : "";
  if (!normalizedUserId || !normalizedToken) {
    return loadPersistedContextTokens(config, accountId);
  }
  const existing = loadPersistedContextTokens(config, accountId);
  if (existing[normalizedUserId] === normalizedToken) {
    return existing;
  }
  return savePersistedContextTokens(config, accountId, {
    ...existing,
    [normalizedUserId]: normalizedToken,
  });
}

function clearPersistedContextTokens(config: any, accountId: any) {
  try {
    const filePath = resolveContextTokenPath(config, accountId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // best effort
  }
}

function validateContextTokenMap(value: any) {
  if (!isPlainObject(value)) {
    return "context token store must be an object";
  }
  for (const [userId, token] of Object.entries(value)) {
    if (typeof userId !== "string" || typeof token !== "string") {
      return "context token store entries must be string:string";
    }
  }
  return true;
}

module.exports = {
  clearPersistedContextTokens,
  loadPersistedContextTokens,
  persistContextToken,
  resolveContextTokenPath,
};

export {};
