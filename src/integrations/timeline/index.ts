import { normalizeText } from "../../core/text-normalization";
import { spawn } from "node:child_process";

import { resolveTimelineStateFiles } from "../../core/timezone";
import { ensureTimelineStateTimezone } from "./state-sync";
import { readPrefixedEnv } from "../../contracts/app-env";
import { resolvePackageRoot } from "../../core/path-utils";
import { resolveRuntimeEntrypointAbsolute } from "../../contracts/runtime-entrypoints";
import { resolvePreferredSystemTimelineBrowserPath } from "../../timeline/runtime/application/timeline/browser-paths";


interface TimelineIntegrationConfig {
  stateDir?: unknown;
  timelineStateDir?: string;
}

interface TimelineRunOptions {
  subcommand?: string;
}

function createTimelineIntegration(config: TimelineIntegrationConfig) {
  const binPath = resolveTimelineBinPath();
  const timelineFiles = resolveTimelineStateFiles(config.timelineStateDir);

  return {
    describe() {
      return {
        id: "codeksei-timeline",
        kind: "integration",
        command: `${process.execPath} ${binPath}`,
        stateDir: config.timelineStateDir,
        timelineDir: timelineFiles.dir,
      };
    },
    async runSubcommand(subcommand: unknown, args: unknown[] = []) {
      const normalizedSubcommand = normalizeText(subcommand);
      if (!normalizedSubcommand) {
        throw new Error("timeline 子命令不能为空");
      }
      ensureTimelineStateTimezone(config);
      // Pass the resolved state root into the first-party timeline runtime so
      // direct commands, screenshot workers, and timezone sync all stay on the
      // same nested timeline/*.json layout.
      return runTimelineCommand(binPath, [normalizedSubcommand, ...normalizeTimelineArgs(normalizedSubcommand, args)], {
        CODEKSEI_STATE_DIR: normalizeText(config.stateDir),
        CODEKSEI_TIMELINE_STATE_DIR: String(config.timelineStateDir || ""),
        CODEKSEI_SCREENSHOT_CHROME_PATH: resolveTimelineChromePath(),
      }, {
        subcommand: normalizedSubcommand,
      });
    },
  };
}

function resolveTimelineBinPath() {
  return resolveRuntimeEntrypointAbsolute(resolvePackageRoot(__dirname), "timelineCli");
}

function runTimelineCommand(
  binPath: string,
  args: string[],
  extraEnv: Record<string, string> = {},
  options: TimelineRunOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const spawnSpec = buildTimelineSpawnSpec(binPath, args);
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...extraEnv,
      },
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString("utf8");
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString("utf8");
      stderr += text;
      process.stderr.write(text);
    });

    wireTimelineStdin(child, args);

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`timeline 进程被信号中断: ${signal}`));
        return;
      }
      if (code !== 0) {
        const detail = extractTimelineCommandFailure(stdout, stderr);
        reject(new Error(detail || `timeline 命令执行失败，退出码 ${code}`));
        return;
      }
      if (options.subcommand === "write") {
        const failure = detectTimelineWriteFailure(stdout, stderr);
        if (failure) {
          reject(new Error(failure));
          return;
        }
      }
      resolve();
    });
  });
}

function buildTimelineSpawnSpec(binPath: string, args: string[] = []) {
  // Windows `cmd.exe /c "<node> <script>"` double-quotes the inner command and
  // breaks when `process.execPath` contains spaces. Spawn Node directly so the
  // timeline CLI behaves the same on Windows and Unix.
  return {
    command: process.execPath,
    args: [binPath, ...args],
  };
}

function normalizeArgs(args: unknown): string[] {
  return Array.isArray(args)
    ? args
      .map((value) => String(value ?? ""))
      .filter((value) => value.length > 0)
    : [];
}

function normalizeTimelineArgs(subcommand: string, args: unknown): string[] {
  const normalizedArgs = normalizeArgs(args).filter((value: string) => value !== "--");
  if (!["read", "write"].includes(subcommand)) {
    return normalizedArgs;
  }

  const rewritten = [];
  let hasDateFlag = false;

  for (const token of normalizedArgs) {
    const trimmed = normalizeText(token);
    if (!trimmed) {
      continue;
    }
    if (trimmed === "--date") {
      hasDateFlag = true;
      rewritten.push(trimmed);
      continue;
    }
    if (trimmed.startsWith("--date=")) {
      const value = normalizeText(trimmed.slice("--date=".length));
      if (value) {
        hasDateFlag = true;
        rewritten.push("--date", value);
      }
      continue;
    }
    if (trimmed.startsWith("--mode=")) {
      const value = normalizeText(trimmed.slice("--mode=".length));
      if (value) {
        rewritten.push("--mode", value);
      }
      continue;
    }
    if (trimmed.startsWith("--json=")) {
      const value = trimmed.slice("--json=".length);
      if (value) {
        rewritten.push("--json", value);
      }
      continue;
    }
    rewritten.push(trimmed);
  }

  // When an agent forgets npm's passthrough `--`, npm swallows `--date` and the
  // script only receives a bare YYYY-MM-DD token. Recover that common intent so
  // bridge-owned timeline commands fail less often on formatting slips.
  const firstToken = rewritten[0];
  if (!hasDateFlag && firstToken && isIsoDateToken(firstToken)) {
    return ["--date", firstToken, ...rewritten.slice(1)];
  }

  return rewritten;
}

function isIsoDateToken(value: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeText(value));
}

function resolveTimelineChromePath() {
  const configured = normalizeText(readPrefixedEnv(process.env, "SCREENSHOT_CHROME_PATH"))
    || normalizeText(process.env.TIMELINE_FOR_AGENT_CHROME_PATH);
  if (configured) {
    return configured;
  }
  return resolvePreferredSystemTimelineBrowserPath();
}

function detectTimelineWriteFailure(stdout: string, stderr: string): string {
  const output = `${stdout}\n${stderr}`;
  const statusMatch = output.match(/^\s*status:\s*(.+)\s*$/m);
  const eventsMatch = output.match(/^\s*events:\s*(\d+)\s*$/m);
  const status = normalizeText(statusMatch?.[1]);
  const events = Number.parseInt(eventsMatch?.[1] || "", 10);
  if (status === "missing" && Number.isFinite(events) && events <= 0) {
    return "timeline write 没有写入任何事件；当前结果是 events: 0 且 status: missing。请检查是否真的传入了有效 JSON events。";
  }
  return "";
}

function extractTimelineCommandFailure(stdout: string, stderr: string): string {
  const output = `${stderr}\n${stdout}`;
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.find((line) => line.includes("timeline 事件无效"))
    || lines.find((line) => line.includes("timeline 事件不能跨天"))
    || lines.find((line) => line.includes("timeline-write"))
    || lines.find((line) => /^(?:Error|TypeError|ReferenceError|SyntaxError|RangeError|AggregateError):/u.test(line))
    || lines.find((line) => line.includes("Cannot find module"))
    || lines.findLast((line) => isMeaningfulTimelineFailureLine(line))
    || lines.at(-1)
    || "";
}

function isMeaningfulTimelineFailureLine(line: string): boolean {
  const normalized = normalizeText(line);
  if (!normalized) {
    return false;
  }
  if (normalized === "^" || normalized === "{" || normalized === "}") {
    return false;
  }
  if (/^at\s+/u.test(normalized)) {
    return false;
  }
  if (/^node:/u.test(normalized)) {
    return false;
  }
  if (/^Node\.js v\d+/u.test(normalized)) {
    return false;
  }
  return true;
}

function shouldForwardTimelineStdin(
  args: string[] = [],
  stdin: NodeJS.ReadStream | NodeJS.Process["stdin"] = process.stdin,
): boolean {
  return Array.isArray(args)
    && args.some((value) => String(value || "").trim() === "--stdin")
    && stdin
    && stdin.isTTY === false;
}

function wireTimelineStdin(
  child: ReturnType<typeof spawn>,
  args: string[] = [],
  stdin: NodeJS.ReadStream | NodeJS.Process["stdin"] = process.stdin,
): void {
  if (!child?.stdin) {
    return;
  }
  if (!shouldForwardTimelineStdin(args, stdin)) {
    child.stdin.end();
    return;
  }
  stdin.pipe(child.stdin);
}

export {
  createTimelineIntegration,
  detectTimelineWriteFailure,
  extractTimelineCommandFailure,
  isMeaningfulTimelineFailureLine,
  normalizeTimelineArgs,
  shouldForwardTimelineStdin,
};

