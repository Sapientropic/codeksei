import * as fs from "node:fs";
import * as path from "node:path";

import { normalizeAccountId, type WeixinAccountConfig } from "./account-store";
import { writeManagedTextStateFile } from "../../../state/json-state";

interface SyncBufferConfig extends WeixinAccountConfig {
  syncBufferDir?: string;
}

function ensureSyncBufferDir(config: SyncBufferConfig): void {
  fs.mkdirSync(resolveSyncBufferDir(config), { recursive: true });
}

function resolveSyncBufferPath(config: SyncBufferConfig, accountId: unknown): string {
  ensureSyncBufferDir(config);
  return path.join(resolveSyncBufferDir(config), `${normalizeAccountId(accountId)}.txt`);
}

function loadSyncBuffer(config: SyncBufferConfig, accountId: unknown): string {
  try {
    const filePath = resolveSyncBufferPath(config, accountId);
    if (!fs.existsSync(filePath)) {
      return "";
    }
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function saveSyncBuffer(config: SyncBufferConfig, accountId: unknown, buffer: unknown): void {
  const filePath = resolveSyncBufferPath(config, accountId);
  writeManagedTextStateFile(filePath, String(buffer || ""), { encoding: "utf8" });
}

function resolveSyncBufferDir(config: SyncBufferConfig): string {
  return String(config.syncBufferDir || "");
}

export {
  loadSyncBuffer,
  resolveSyncBufferPath,
  saveSyncBuffer,
};
