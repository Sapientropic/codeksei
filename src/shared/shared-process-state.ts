import * as fs from "node:fs";
import * as path from "node:path";
import {
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
  writeTextFileAtomically,
} from "../state/json-state";

function isPidAlive(pid: unknown): boolean {
  const numeric = Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return false;
  }
  try {
    process.kill(numeric, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidFile(filePath: unknown): number {
  try {
    const raw = fs.readFileSync(String(filePath || ""), "utf8").trim();
    return raw ? Number.parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

function writePidFile(filePath: string, pid: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeTextFileAtomically(filePath, `${pid}\n`, { encoding: "utf8" });
}

function removePidFileIfMatches(filePath: string, pid: unknown): void {
  const current = readPidFile(filePath);
  if (current && current === Number(pid)) {
    fs.rmSync(filePath, { force: true });
  }
}

function readJsonFile(filePath: string): unknown {
  return readManagedJsonStateFile({
    filePath,
    fallback: null,
    label: "shared state",
  });
}

function writeJsonFile(filePath: string, payload: unknown): void {
  writeManagedJsonStateFile(filePath, payload);
}

export {
  isPidAlive,
  readJsonFile,
  readPidFile,
  removePidFileIfMatches,
  writeJsonFile,
  writePidFile,
};
