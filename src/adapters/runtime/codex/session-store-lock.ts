import * as fs from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const SESSION_STORE_LOCK_TIMEOUT_MS = 5_000;
const SESSION_STORE_LOCK_STALE_MS = 30_000;
const SESSION_STORE_LOCK_RETRY_DELAY_MS = 25;

export async function withSessionStoreLock<T>(lockFilePath: string, work: () => Promise<T> | T): Promise<T> {
  const startedAt = Date.now();
  while (true) {
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      handle = await fs.open(lockFilePath, "wx");
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`, { encoding: "utf8" });
      try {
        return await work();
      } finally {
        await closeFileHandle(handle);
        await fs.rm(lockFilePath, { force: true }).catch(() => {});
      }
    } catch (error) {
      await closeFileHandle(handle);
      if (!isSessionStoreLockConflict(error)) {
        throw error;
      }
      if (await shouldBreakStaleSessionStoreLock(lockFilePath)) {
        await fs.rm(lockFilePath, { force: true }).catch(() => {});
        continue;
      }
      if (Date.now() - startedAt >= SESSION_STORE_LOCK_TIMEOUT_MS) {
        throw new Error(`timed out waiting for session store lock: ${lockFilePath}`);
      }
      await delay(SESSION_STORE_LOCK_RETRY_DELAY_MS);
    }
  }
}

async function shouldBreakStaleSessionStoreLock(lockFilePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(lockFilePath);
    return Date.now() - stats.mtimeMs >= SESSION_STORE_LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function isSessionStoreLockConflict(error: unknown): error is NodeJS.ErrnoException {
  return error !== null
    && typeof error === "object"
    && "code" in error
    && (error.code === "EEXIST" || error.code === "EACCES" || error.code === "EPERM");
}

async function closeFileHandle(handle: Awaited<ReturnType<typeof fs.open>> | null): Promise<void> {
  if (!handle) {
    return;
  }
  try {
    await handle.close();
  } catch {
    // best effort
  }
}
