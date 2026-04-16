import * as fs from "node:fs";
import * as path from "node:path";

import { resolveRuntimeEntrypointAbsolute } from "../contracts/runtime-entrypoints";
import { resolvePackageRoot } from "../core/path-utils";
import { resolveHermesHomePath, type HermesRepoLocalConfigInput } from "../core/hermes-repo-local";
import { normalizeText } from "../core/text-normalization";
import { writeForeignTextDocument } from "../state/json-state";

export function resolveHermesContextBriefingScriptPath(
  config: HermesRepoLocalConfigInput = {},
): string {
  return path.join(resolveHermesHomePath(config), "scripts", "codeksei_context_briefing.py");
}

export function ensureHermesContextBriefingScript(
  config: HermesRepoLocalConfigInput = {},
): string {
  const scriptPath = resolveHermesContextBriefingScriptPath(config);
  const nextContent = buildHermesContextBriefingScriptSource();
  if (fs.existsSync(scriptPath)) {
    const current = fs.readFileSync(scriptPath, "utf8");
    if (current === nextContent) {
      return scriptPath;
    }
  }
  writeForeignTextDocument(scriptPath, nextContent, { encoding: "utf8" });
  return scriptPath;
}

function buildHermesContextBriefingScriptSource(): string {
  return [
    "#!/usr/bin/env python3",
    "import os",
    "import subprocess",
    "import sys",
    "",
    "def _emit(message: str) -> int:",
    "    sys.stdout.write(message.strip())",
    "    sys.stdout.flush()",
    "    return 0",
    "",
    "def main() -> int:",
    "    node = (os.environ.get('CODEKSEI_CONTEXT_BRIEFING_NODE') or '').strip()",
    "    entrypoint = (os.environ.get('CODEKSEI_CONTEXT_BRIEFING_ENTRYPOINT') or '').strip()",
    "    mode = (os.environ.get('CODEKSEI_CONTEXT_BRIEFING_MODE') or 'proactive').strip() or 'proactive'",
    "    user_id = (os.environ.get('CODEKSEI_CONTEXT_BRIEFING_USER') or os.environ.get('CODEKSEI_ALLOWED_USER_IDS') or '').strip()",
    "    workspace = (os.environ.get('CODEKSEI_CONTEXT_BRIEFING_WORKSPACE') or os.environ.get('CODEKSEI_WORKSPACE_ROOT') or '').strip()",
    "    if not workspace:",
    "        return _emit('[Codeksei context board unavailable: missing workspace root]')",
    "    if not user_id:",
    "        return _emit('[Codeksei context board unavailable: missing sender id]')",
    "    if not entrypoint:",
    "        return _emit('[Codeksei context board unavailable: missing CLI entrypoint]')",
    "    command = [node or 'node', entrypoint, '--format', 'text', '--workspace-root', workspace, 'context', 'briefing', '--user', user_id, '--workspace', workspace, '--mode', mode]",
    "    try:",
    "        result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8')",
    "    except Exception as exc:",
    "        return _emit(f'[Codeksei context board unavailable: {exc}]')",
    "    stdout = (result.stdout or '').strip()",
    "    stderr = (result.stderr or '').strip()",
    "    if result.returncode != 0:",
    "        detail = stderr or stdout or f'exit {result.returncode}'",
    "        return _emit(f'[Codeksei context board unavailable: {detail}]')",
    "    if not stdout:",
    "        return _emit('[Codeksei context board unavailable: empty output]')",
    "    return _emit(stdout)",
    "",
    "if __name__ == '__main__':",
    "    raise SystemExit(main())",
    "",
  ].join("\n");
}

export function buildContextBriefingJobEnv(): Record<string, string> {
  const packageRoot = resolvePackageRoot(__dirname);
  const nodePath = normalizeText(process.execPath) || "node";
  return {
    CODEKSEI_CONTEXT_BRIEFING_ENTRYPOINT: resolveRuntimeEntrypointAbsolute(packageRoot, "cli"),
    CODEKSEI_CONTEXT_BRIEFING_NODE: nodePath,
  };
}

