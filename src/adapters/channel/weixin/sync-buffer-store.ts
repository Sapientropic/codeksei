const fs = require("fs");
const path = require("path");
const { normalizeAccountId } = require("./account-store");
const { writeManagedTextStateFile } = require("../../../core/json-state");

function ensureSyncBufferDir(config: any) {
  fs.mkdirSync(config.syncBufferDir, { recursive: true });
}

function resolveSyncBufferPath(config: any, accountId: any) {
  ensureSyncBufferDir(config);
  return path.join(config.syncBufferDir, `${normalizeAccountId(accountId)}.txt`);
}

function loadSyncBuffer(config: any, accountId: any) {
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

function saveSyncBuffer(config: any, accountId: any, buffer: any) {
  const filePath = resolveSyncBufferPath(config, accountId);
  writeManagedTextStateFile(filePath, String(buffer || ""), { encoding: "utf8" });
}

module.exports = {
  loadSyncBuffer,
  resolveSyncBufferPath,
  saveSyncBuffer,
};

export {};
