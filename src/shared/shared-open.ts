const { spawn } = require("child_process");
const { readPrefixedEnv } = require("../core/branding");
const { resolveCodexWorkspaceRoot } = require("../workspace/workspace-alias");
const {
  listenUrl,
  buildSpawnInvocation,
  ensureSharedAppServer,
  resolveBoundThread,
} = require("./shared-common");

async function main() {
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

  child.on("exit", (code: any, signal: any) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

module.exports = {
  main,
};

if (require.main === module) {
  main().catch((error: any) => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

export {};
