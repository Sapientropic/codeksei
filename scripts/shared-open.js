const { spawn } = require("child_process");
const { resolveCodexWorkspaceRoot } = require("../src/core/workspace-alias");
const {
  listenUrl,
  buildSpawnInvocation,
  ensureSharedAppServer,
  resolveBoundThread,
} = require("./shared-common");

async function main() {
  const workspaceRoot = process.env.CYBERBOSS_WORKSPACE_ROOT || process.cwd();
  await ensureSharedAppServer();
  const { threadId, workspaceRoot: resolvedWorkspaceRoot } = resolveBoundThread(workspaceRoot);
  // Keep the session bound to the canonical workspace root, but launch the
  // local Codex client from the ASCII alias so desktop attach does not
  // reintroduce the non-ASCII workspace header bug on Windows.
  const runtimeWorkspaceRoot = resolveCodexWorkspaceRoot(resolvedWorkspaceRoot);
  const spawnSpec = buildSpawnInvocation(process.env.CYBERBOSS_CODEX_COMMAND || "codex", [
    "resume",
    threadId,
    "--remote",
    listenUrl,
    "-C",
    runtimeWorkspaceRoot,
    ...process.argv.slice(2),
  ]);
  const child = spawn(spawnSpec.command, spawnSpec.args, {
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
