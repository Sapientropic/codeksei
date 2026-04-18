import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function normalizeCandidatePath(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function listTimelineSystemBrowserCandidates(
  {
    env = process.env,
    homeDir = os.homedir(),
    platform = process.platform,
  }: {
    env?: Record<string, unknown>;
    homeDir?: string;
    platform?: string;
  } = {},
): string[] {
  if (platform === "darwin") {
    return dedupePaths([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(homeDir, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      path.join(homeDir, "Applications/Chromium.app/Contents/MacOS/Chromium"),
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      path.join(homeDir, "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
    ]);
  }

  if (platform === "win32") {
    const localAppData = normalizeCandidatePath(env.LOCALAPPDATA);
    const programFiles = normalizeCandidatePath(env.PROGRAMFILES);
    const programFilesX86 = normalizeCandidatePath(env["PROGRAMFILES(X86)"]);
    return dedupePaths([
      path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(localAppData, "Chromium", "Application", "chrome.exe"),
      path.join(programFiles, "Chromium", "Application", "chrome.exe"),
      path.join(programFilesX86, "Chromium", "Application", "chrome.exe"),
      path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    ]);
  }

  return dedupePaths([
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
    "/opt/google/chrome/chrome",
    "/opt/microsoft/msedge/msedge",
  ]);
}

export function listTimelineBrowserCandidates(
  {
    configuredPath = "",
    playwrightManagedPath = "",
    env = process.env,
    homeDir = os.homedir(),
    platform = process.platform,
  }: {
    configuredPath?: unknown;
    playwrightManagedPath?: unknown;
    env?: Record<string, unknown>;
    homeDir?: string;
    platform?: string;
  } = {},
): string[] {
  return dedupePaths([
    normalizeCandidatePath(configuredPath),
    normalizeCandidatePath(playwrightManagedPath),
    ...listTimelineSystemBrowserCandidates({ env, homeDir, platform }),
  ]);
}

export function resolvePreferredSystemTimelineBrowserPath(options: {
  env?: Record<string, unknown>;
  fileExists?: (filePath: string) => boolean;
  homeDir?: string;
  platform?: string;
} = {}): string {
  const fileExists = options.fileExists || fs.existsSync;
  return listTimelineSystemBrowserCandidates(options).find((candidate) => fileExists(candidate)) || "";
}

export function resolveTimelineBrowserExecutablePath(
  options: {
    configuredPath?: unknown;
    playwrightManagedPath?: unknown;
    env?: Record<string, unknown>;
    fileExists?: (filePath: string) => boolean;
    homeDir?: string;
    platform?: string;
  } = {},
): string {
  const fileExists = options.fileExists || fs.existsSync;
  const available = listTimelineBrowserCandidates(options).find((candidate) => fileExists(candidate));
  if (available) {
    return available;
  }
  throw new Error(buildTimelineBrowserNotFoundMessage());
}

export function buildTimelineBrowserNotFoundMessage(): string {
  return "找不到可用的 Chromium/Chrome/Edge，可设置 CODEKSEI_SCREENSHOT_CHROME_PATH 或先安装 Playwright 浏览器";
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const candidate of paths) {
    const normalized = normalizeCandidatePath(candidate);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}
