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

export function resolveHermesHostedCheckinScriptPath(
  config: HermesRepoLocalConfigInput = {},
): string {
  return path.join(resolveHermesHomePath(config), "scripts", "codeksei_hosted_checkin.py");
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

export function ensureHermesHostedCheckinScript(
  config: HermesRepoLocalConfigInput = {},
): string {
  const scriptPath = resolveHermesHostedCheckinScriptPath(config);
  const nextContent = buildHermesHostedCheckinScriptSource();
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

function buildHermesHostedCheckinScriptSource(): string {
  return [
    "#!/usr/bin/env python3",
    "from __future__ import annotations",
    "import json",
    "import os",
    "import subprocess",
    "import sys",
    "",
    "def _emit(message: str) -> int:",
    "    sys.stdout.write(message.strip())",
    "    sys.stdout.flush()",
    "    return 0",
    "",
    "def _run(command: list[str]) -> tuple[int, str, str]:",
    "    result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8')",
    "    return result.returncode, (result.stdout or '').strip(), (result.stderr or '').strip()",
    "",
    "def _build_cli_command(node: str, entrypoint: str, workspace: str, args: list[str]) -> list[str]:",
    "    return [node or 'node', entrypoint, '--workspace-root', workspace, *args]",
    "",
    "def main() -> int:",
    "    node = (os.environ.get('CODEKSEI_CONTEXT_BRIEFING_NODE') or '').strip()",
    "    entrypoint = (os.environ.get('CODEKSEI_CONTEXT_BRIEFING_ENTRYPOINT') or '').strip()",
    "    user_id = (os.environ.get('CODEKSEI_CONTEXT_BRIEFING_USER') or os.environ.get('CODEKSEI_ALLOWED_USER_IDS') or '').strip()",
    "    workspace = (os.environ.get('CODEKSEI_CONTEXT_BRIEFING_WORKSPACE') or os.environ.get('CODEKSEI_WORKSPACE_ROOT') or '').strip()",
    "    if not workspace:",
    "        return _emit('[Codeksei hosted proactive unavailable: missing workspace root]')",
    "    if not user_id:",
    "        return _emit('[Codeksei hosted proactive unavailable: missing sender id]')",
    "    if not entrypoint:",
    "        return _emit('[Codeksei hosted proactive unavailable: missing CLI entrypoint]')",
    "    claim_command = _build_cli_command(node, entrypoint, workspace, ['host', 'claim-checkin', '--provider', 'hermes', '--user', user_id, '--workspace', workspace, '--format', 'json'])",
    "    try:",
    "        claim_code, claim_stdout, claim_stderr = _run(claim_command)",
    "    except Exception as exc:",
    "        return _emit(f'[Codeksei hosted proactive unavailable: {exc}]')",
    "    if claim_code != 0:",
    "        detail = claim_stderr or claim_stdout or f'exit {claim_code}'",
    "        return _emit(f'[Codeksei hosted proactive unavailable: {detail}]')",
    "    try:",
    "        claim_envelope = json.loads(claim_stdout or '{}')",
    "    except Exception:",
    "        return _emit('[Codeksei hosted proactive unavailable: invalid claim-checkin JSON]')",
    "    claim_data = claim_envelope.get('data') if isinstance(claim_envelope, dict) else None",
    "    if not isinstance(claim_data, dict):",
    "        return _emit('[Codeksei hosted proactive unavailable: missing claim payload]')",
    "    status = str(claim_data.get('status') or '').strip()",
    "    lines: list[str] = ['Codeksei hosted proactive handoff', f'claim_status: {status or \"unknown\"}']",
    "    lease = claim_data.get('lease') if isinstance(claim_data.get('lease'), dict) else {}",
    "    payload = claim_data.get('payload') if isinstance(claim_data.get('payload'), dict) else {}",
    "    context_briefing = claim_data.get('contextBriefing') if isinstance(claim_data.get('contextBriefing'), dict) else {}",
    "    pending_handoff = claim_data.get('pendingHandoff') if isinstance(claim_data.get('pendingHandoff'), dict) else {}",
    "    if status in {'idle', 'in_progress'}:",
    "        lines.extend([",
    "            'If claim_status is idle or in_progress, do not fabricate presence. Output exactly SILENT.',",
    "            'The main session still owns continuity; this child run should stay quiet.',",
    "        ])",
    "        return _emit('\\n'.join(lines))",
    "    if status != 'claimed':",
    "        lines.append('Claim did not return a usable delegated wake. Output exactly SILENT.')",
    "        return _emit('\\n'.join(lines))",
    "    lease_id = str(lease.get('id') or '').strip()",
    "    lines.extend([",
    "        f'lease_id: {lease_id}',",
    "        'Observer contract:',",
    "        '- First regain a truthful sense of what the user is doing now; if you do not know, prefer one short check-in question over guessing.',",
    "        '- SILENT is only for clearly bad moments to interrupt, not as a default escape hatch.',",
    "        '- Even if you stay silent, decide whether you should still leave continuity behind through timeline / diary / project note / companion memory / review.',",
    "        '',",
    "        'Default decision order:',",
    "    ])",
    "    for entry in payload.get('decisionOrder', []) if isinstance(payload.get('decisionOrder'), list) else []:",
    "        lines.append(f'- {str(entry).strip()}')",
    "    lines.extend(['', 'Default bookkeeping priorities:'])",
    "    for entry in payload.get('bookkeepingPriorities', []) if isinstance(payload.get('bookkeepingPriorities'), list) else []:",
    "        lines.append(f'- {str(entry).strip()}')",
    "    if pending_handoff.get('exists'):",
    "        lines.extend([",
    "            '',",
    "            'Pending proactive handoff already waiting for the main session:',",
    "            f'- outcome: {str(pending_handoff.get(\"outcome\") or \"\").strip()}',",
    "            f'- observed_current_state: {str(pending_handoff.get(\"observedCurrentState\") or \"\").strip()}',",
    "            f'- followup_context: {str(pending_handoff.get(\"followupContext\") or \"\").strip()}',",
    "        ])",
    "    briefing_text = str(context_briefing.get('briefingText') or '').strip()",
    "    if briefing_text:",
    "        lines.extend(['', 'Current context board:', briefing_text])",
    "    task_text = str(payload.get('text') or '').strip()",
    "    if task_text:",
    "        lines.extend(['', 'Delegated task instruction:', task_text])",
    "    lines.extend([",
    "        '',",
    "        'Before you finish, you must persist exactly one structured handoff with host settle-checkin --create-handoff.',",
    "        'Use --message only when you actually sent a user-visible message. Use --observed-state for the best current-state summary you recovered.',",
    "        'Repeat --bookkeeping-action with kind|done|summary or kind|suggested|summary for every continuity action you already took or think the main session should take next.',",
    "        'Your final text response to the user must be either SILENT or one short natural WeChat message. Do not expose lease ids, scheduling, commands, or internal reasoning.',",
    "    ])",
    "    return _emit('\\n'.join(lines))",
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
