import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { normalizeText } from "./text-normalization";

export interface CapturedSubprocessResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  error: string;
  resolvedCommand: string;
}

export function resolveCommandOnPath(command: string): string {
  const normalized = normalizeText(command);
  if (!normalized) {
    return "";
  }
  if ((path.isAbsolute(normalized) || normalized.includes(path.sep)) && fs.existsSync(normalized)) {
    return normalized;
  }

  const locator = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(locator, [normalized], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  if (result.status !== 0) {
    return "";
  }

  return String(result.stdout || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

export function captureSubprocess(
  command: string,
  args: string[],
  {
    cwd = process.cwd(),
    timeoutMs = 15_000,
  }: {
    cwd?: string;
    timeoutMs?: number;
  } = {},
): CapturedSubprocessResult {
  const resolvedCommand = resolveCommandOnPath(command) || normalizeText(command) || command;
  // Windows `.cmd`/`.bat` launchers need a shell hop; raw executables do not.
  const useShell = process.platform === "win32" && /\.(cmd|bat)$/iu.test(resolvedCommand);
  const result = spawnSync(resolvedCommand, args, {
    cwd,
    encoding: "utf8",
    shell: useShell,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    windowsHide: true,
  });

  return {
    ok: typeof result.status === "number" && result.status === 0 && !result.error,
    status: typeof result.status === "number" ? result.status : null,
    stdout: normalizeCommandOutput(result.stdout, false),
    stderr: normalizeCommandOutput(result.stderr || result.error?.message || "", true),
    error: result.error instanceof Error ? result.error.message : "",
    resolvedCommand,
  };
}

function normalizeCommandOutput(value: unknown, trimBothEnds: boolean): string {
  const normalized = String(value || "").replace(/\r\n/g, "\n");
  return trimBothEnds ? normalized.trim() : normalized.trimEnd();
}
