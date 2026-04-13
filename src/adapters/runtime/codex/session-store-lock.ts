import * as fs from "node:fs";

const SESSION_STORE_LOCK_TIMEOUT_MS = 5_000;
const SESSION_STORE_LOCK_STALE_MS = 30_000;
const SESSION_STORE_LOCK_RETRY_DELAY_MS = 25;
const SESSION_STORE_SLEEP_BUFFER = typeof SharedArrayBuffer === "function"
  ? new Int32Array(new SharedArrayBuffer(4))
  : null;

export function withSessionStoreLock<T>(lockFilePath: string, work: () => T): T {
  const startedAt = Date.now();
  while (true) {
    let fd = -1;
    try {
      fd = fs.openSync(lockFilePath, "wx");
      fs.writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`, { encoding: "utf8" });
      try {
        return work();
      } finally {
        closeFileDescriptor(fd);
        fs.rmSync(lockFilePath, { force: true });
      }
    } catch (error) {
      closeFileDescriptor(fd);
      if (!isSessionStoreLockConflict(error)) {
        throw error;
      }
      if (shouldBreakStaleSessionStoreLock(lockFilePath)) {
        fs.rmSync(lockFilePath, { force: true });
        continue;
      }
      if (Date.now() - startedAt >= SESSION_STORE_LOCK_TIMEOUT_MS) {
        throw new Error(`timed out waiting for session store lock: ${lockFilePath}`);
      }
      sleepSync(SESSION_STORE_LOCK_RETRY_DELAY_MS);
    }
  }
}

function shouldBreakStaleSessionStoreLock(lockFilePath: string): boolean {
  try {
    const stats = fs.statSync(lockFilePath);
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

function closeFileDescriptor(fd: number): void {
  if (!Number.isInteger(fd) || fd < 0) {
    return;
  }
  try {
    fs.closeSync(fd);
  } catch {
    // best effort
  }
}

function sleepSync(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }
  if (SESSION_STORE_SLEEP_BUFFER && typeof Atomics.wait === "function") {
    Atomics.wait(SESSION_STORE_SLEEP_BUFFER, 0, 0, ms);
    return;
  }
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy wait fallback for runtimes without Atomics.wait
  }
}
