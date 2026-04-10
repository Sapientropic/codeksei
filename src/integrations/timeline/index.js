const path = require("path");
const { spawn } = require("child_process");

function createTimelineIntegration(config) {
  const binPath = resolveTimelineBinPath();

  return {
    describe() {
      return {
        id: "timeline-for-agent",
        kind: "integration",
        command: `${process.execPath} ${binPath}`,
        stateDir: config.timelineStateDir,
      };
    },
    async runSubcommand(subcommand, args = []) {
      const normalizedSubcommand = normalizeText(subcommand);
      if (!normalizedSubcommand) {
        throw new Error("timeline 子命令不能为空");
      }
      return runTimelineCommand(binPath, [normalizedSubcommand, ...normalizeTimelineArgs(normalizedSubcommand, args)], {
        TIMELINE_FOR_AGENT_STATE_DIR: config.timelineStateDir,
        TIMELINE_FOR_AGENT_CHROME_PATH: resolveTimelineChromePath(),
      }, {
        subcommand: normalizedSubcommand,
      });
    },
  };
}

function resolveTimelineBinPath() {
  const packageJsonPath = require.resolve("timeline-for-agent/package.json");
  return path.join(path.dirname(packageJsonPath), "bin", "timeline-for-agent.js");
}

function runTimelineCommand(binPath, args, extraEnv = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const spawnSpec = buildTimelineSpawnSpec(binPath, args);
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...process.env,
        ...extraEnv,
      },
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      process.stderr.write(text);
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`timeline 进程被信号中断: ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`timeline 命令执行失败，退出码 ${code}`));
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

function buildTimelineSpawnSpec(binPath, args = []) {
  // Windows `cmd.exe /c "<node> <script>"` double-quotes the inner command and
  // breaks when `process.execPath` contains spaces. Spawn Node directly so the
  // timeline CLI behaves the same on Windows and Unix.
  return {
    command: process.execPath,
    args: [binPath, ...args],
  };
}

function normalizeArgs(args) {
  return Array.isArray(args)
    ? args
      .map((value) => String(value ?? ""))
      .filter((value) => value.length > 0)
    : [];
}

function normalizeTimelineArgs(subcommand, args) {
  const normalizedArgs = normalizeArgs(args).filter((value) => value !== "--");
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
  if (!hasDateFlag && rewritten.length && isIsoDateToken(rewritten[0])) {
    return ["--date", rewritten[0], ...rewritten.slice(1)];
  }

  return rewritten;
}

function isIsoDateToken(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeText(value));
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveTimelineChromePath() {
  const configured = normalizeText(process.env.TIMELINE_FOR_AGENT_CHROME_PATH)
    || normalizeText(process.env.CYBERBOSS_SCREENSHOT_CHROME_PATH);
  if (configured) {
    return configured;
  }
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  return "";
}

function detectTimelineWriteFailure(stdout, stderr) {
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

module.exports = { createTimelineIntegration };
