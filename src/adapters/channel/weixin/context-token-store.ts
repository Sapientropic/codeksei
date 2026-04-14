import * as fs from "node:fs";
import * as path from "node:path";

import { normalizeAccountId, type WeixinAccountConfig } from "./account-store";
import {
  isPlainObject,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} from "../../../state/json-state";

function ensureAccountsDir(config: WeixinAccountConfig): void {
  fs.mkdirSync(resolveAccountsDir(config), { recursive: true });
}

function resolveContextTokenPath(config: WeixinAccountConfig, accountId: unknown): string {
  ensureAccountsDir(config);
  return path.join(resolveAccountsDir(config), `${normalizeAccountId(accountId)}.context-tokens.json`);
}

function loadPersistedContextTokens(config: WeixinAccountConfig, accountId: unknown): Record<string, string> {
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
    Object.entries(parsed as Record<string, string>)
      .filter((entry): entry is [string, string] => (
        typeof entry[0] === "string"
        && entry[0].trim().length > 0
        && typeof entry[1] === "string"
        && entry[1].trim().length > 0
      ))
      .map(([userId, token]) => [userId.trim(), token.trim()])
  );
}

function savePersistedContextTokens(
  config: WeixinAccountConfig,
  accountId: unknown,
  tokens: Record<string, unknown>,
): Record<string, string> {
  const normalizedTokens = Object.fromEntries(
    Object.entries(tokens || {})
      .filter((entry): entry is [string, string] => (
        typeof entry[0] === "string"
        && entry[0].trim().length > 0
        && typeof entry[1] === "string"
        && entry[1].trim().length > 0
      ))
      .map(([userId, token]) => [userId.trim(), token.trim()])
  );
  const filePath = resolveContextTokenPath(config, accountId);
  writeManagedJsonStateFile(filePath, normalizedTokens, { mode: 0o600 });
  return normalizedTokens;
}

function persistContextToken(
  config: WeixinAccountConfig,
  accountId: unknown,
  userId: unknown,
  token: unknown,
): Record<string, string> {
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

function clearPersistedContextTokens(config: WeixinAccountConfig, accountId: unknown): void {
  try {
    const filePath = resolveContextTokenPath(config, accountId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // best effort
  }
}

function validateContextTokenMap(value: unknown): true | string {
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

function resolveAccountsDir(config: WeixinAccountConfig): string {
  return config.accountsDir || "";
}

export {
  clearPersistedContextTokens,
  loadPersistedContextTokens,
  persistContextToken,
  resolveContextTokenPath,
};
