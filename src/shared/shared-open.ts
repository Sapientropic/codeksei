import { spawn } from "node:child_process";
import { formatErrorMessage } from "../core/error-handling";
import { readPrefixedEnv } from "../core/branding";
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
    console.error(formatErrorMessage(error));
    process.exit(1);
  });
}

export { main };
