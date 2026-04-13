import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { buildSpawnInvocation, normalizeCommandText } from "../../../core/codex-spawn";

export interface CodexCapabilityDiagnosis {
  code:
    | "ok"
    | "spawn_not_found"
    | "app_server_unavailable"
    | "app_server_listen_unsupported"
    | "request_policy_unsupported"
    | "runtime_transport_error";
  detail: string;
  hint: string;
}

export interface CodexAppServerCapabilityProbe {
  attempted: string;
  canInvokeAppServer: boolean;
  command: string;
  diagnosis: CodexCapabilityDiagnosis;
  helpExcerpt: string;
  rawOutput: string;
  supportsListen: boolean | null;
}

export function probeCodexAppServerCapabilities(
  codexCommand: unknown,
  {
    env = process.env,
    spawnSyncImpl = spawnSync,
    timeoutMs = 10_000,
  }: {
    env?: NodeJS.ProcessEnv;
    spawnSyncImpl?: typeof spawnSync;
    timeoutMs?: number;
  } = {},
): CodexAppServerCapabilityProbe {
  const spawnSpec = buildSpawnInvocation(codexCommand, ["app-server", "--help"]);
  const attempted = [spawnSpec.command, ...spawnSpec.args].filter(Boolean).join(" ");
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSyncImpl(spawnSpec.command, spawnSpec.args, {
      encoding: "utf8",
      env: { ...env },
      shell: false,
      timeout: timeoutMs,
      windowsHide: true,
    });
  } catch (error) {
    const diagnosis = diagnoseCodexCapabilityIssue(error);
    return {
      attempted,
      canInvokeAppServer: false,
      command: normalizeCommandText(codexCommand),
      diagnosis,
      helpExcerpt: "",
      rawOutput: "",
      supportsListen: null,
    };
  }

  const rawOutput = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  const diagnosis = diagnoseCodexCapabilityIssue(result.error || rawOutput || result.status);
  const supportsListen = rawOutput
    ? rawOutput.includes("--listen")
    : null;
  return {
    attempted,
    canInvokeAppServer: diagnosis.code !== "spawn_not_found" && diagnosis.code !== "app_server_unavailable",
    command: normalizeCommandText(codexCommand),
    diagnosis: supportsListen === false && diagnosis.code === "ok"
      ? {
        code: "app_server_listen_unsupported",
        detail: rawOutput,
        hint: "当前 Codex app-server --help 没有暴露 --listen；shared:start 继续使用旧主路径会失败。",
      }
      : diagnosis,
    helpExcerpt: summarizeCapabilityOutput(rawOutput),
    rawOutput,
    supportsListen,
  };
}

export function diagnoseCodexCapabilityIssue(value: unknown): CodexCapabilityDiagnosis {
  const detail = normalizeDetail(value).toLowerCase();
  if (!detail) {
    return {
      code: "ok",
      detail: "",
      hint: "",
    };
  }
  if (
    detail.includes("enoent")
    || detail.includes("not recognized")
    || detail.includes("unable to spawn codex app-server")
  ) {
    return {
      code: "spawn_not_found",
      detail,
      hint: "当前环境找不到可执行的 codex / app-server，先检查 CODEX_COMMAND 或本机安装。",
    };
  }
  if (
    detail.includes("unknown argument '--listen'")
    || detail.includes("unexpected argument '--listen'")
    || detail.includes("unrecognized option '--listen'")
    || detail.includes("no such option: --listen")
  ) {
    return {
      code: "app_server_listen_unsupported",
      detail,
      hint: "当前 Codex build 不支持 app-server --listen，shared:start 不应静默切到别的模式。",
    };
  }
  if (
    detail.includes("unknown command 'app-server'")
    || detail.includes("unrecognized subcommand 'app-server'")
    || detail.includes("no such command")
  ) {
    return {
      code: "app_server_unavailable",
      detail,
      hint: "当前 Codex build 看起来没有 app-server 子命令，先用 doctor / --help 确认本机能力面。",
    };
  }
  if (
    detail.includes("approvalpolicy")
    || detail.includes("sandboxpolicy")
    || detail.includes("approval policy")
    || detail.includes("sandbox policy")
  ) {
    return {
      code: "request_policy_unsupported",
      detail,
      hint: "当前 runtime 似乎不接受 approvalPolicy / sandboxPolicy 形状；需要先确认本机协议再决定是否加兼容分支。",
    };
  }
  return {
    code: "ok",
    detail,
    hint: "",
  };
}

export function appendCodexCapabilityHint(message: string, detail: unknown): string {
  const diagnosis = diagnoseCodexCapabilityIssue(detail);
  if (diagnosis.code === "ok" || !diagnosis.hint) {
    return message;
  }
  return `${message} [${diagnosis.code}] ${diagnosis.hint}`;
}

function normalizeDetail(value: unknown): string {
  if (value instanceof Error) {
    return value.message || String(value);
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
}

function summarizeCapabilityOutput(output: string): string {
  const normalized = String(output || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(" | ");
  return normalized.length > 320 ? `${normalized.slice(0, 317)}...` : normalized;
}
