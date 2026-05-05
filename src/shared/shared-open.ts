import { spawn } from "node:child_process";
import { readPrefixedEnv } from "../contracts/app-env";
import { formatErrorMessage } from "../core/error-handling";
import { assertBridgeMode } from "../core/host-mode";
import { writeStderrLine } from "../core/terminal-output";
import { resolveCodexWorkspaceRoot } from "../workspace/workspace-alias";
import {
  buildSpawnInvocation,
  ensureSharedAppServer,
  resolveBoundThread,
  resolveSharedProcessContext,
} from "./shared-common";

type ChildExitCode = number | null;
type ChildSignal = NodeJS.Signals | null;


async function main() {
  const hostMode = assertBridgeMode(process.env, "npm run shared:open");
  if (hostMode.runtimeProvider === "claudecode") {
    throw new Error("shared:open is Codex desktop attach only; Claude Code Mode is available through the Codeksei bridge but has no Codex remote attach target.");
  }
  const sharedContext = resolveSharedProcessContext();
  const workspaceRoot = readPrefixedEnv(process.env, "WORKSPACE_ROOT") || process.cwd();
  await ensureSharedAppServer();
  const { threadId, workspaceRoot: resolvedWorkspaceRoot } = resolveBoundThread(workspaceRoot);
  // Keep the session bound to the canonical workspace root, but launch the
  // local Codex client from the ASCII alias so desktop attach does not
  // reintroduce the non-ASCII workspace header bug on Windows.
  const runtimeWorkspaceRoot = resolveCodexWorkspaceRoot(resolvedWorkspaceRoot);
  const spawnSpec = buildSpawnInvocation(readPrefixedEnv(process.env, "CODEX_COMMAND") || "codex", [
    "resume",
    threadId,
    "--remote",
    sharedContext.listenUrl,
    "-C",
    runtimeWorkspaceRoot,
    ...process.argv.slice(2),
  ]);
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });

  child.on("exit", (code: ChildExitCode, signal: ChildSignal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    writeStderrLine(formatErrorMessage(error));
    process.exit(1);
  });
}

export { main };
