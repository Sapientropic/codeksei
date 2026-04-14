import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { SessionStore } from "../adapters/runtime/codex/session-store";
import { parseCliArgs } from "../core/cli-args";
import { buildTargetResolutionRequiredError } from "../core/cli-contract";
import {
  buildCheckinTargetResolutionErrorMessage,
  buildCheckinTriggerPayload,
  resolveCheckinTarget,
} from "../core/checkin-core";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { normalizeText } from "../core/text-normalization";

interface SystemCheckinTriggerOptions {
  help: boolean;
  user: string;
  workspace: string;
}

interface RuntimeConfig extends Record<string, unknown> {
  accountId?: unknown;
  sessionsFile?: string;
}

export async function runSystemCheckinTriggerCommand(
  config: RuntimeConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<SystemCheckinTriggerOptions>(args, getCommandArgsSchema("systemCheckinTrigger"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("system.checkin_trigger"),
    };
  }

  const resolution = resolveCheckinTarget({
    accountId: normalizeText(config.accountId),
    config,
    explicitUser: options.user,
    explicitWorkspace: options.workspace,
    sessionStore: config.sessionsFile ? new SessionStore({ filePath: config.sessionsFile }) : null,
  });
  if (!resolution.ok || !resolution.value) {
    throw buildTargetResolutionRequiredError(
      buildCheckinTargetResolutionErrorMessage(resolution),
      {
        senderCandidates: resolution.senderResolution.candidates,
        senderSource: resolution.senderResolution.source,
        workspaceCandidates: resolution.workspaceResolution.candidates,
        workspaceSource: resolution.workspaceResolution.source,
      },
      "显式传 --user / --workspace，或先把唯一稳定默认值写进配置。"
    );
  }

  const payload = buildCheckinTriggerPayload(config, resolution.value);
  return {
    data: {
      payload,
      target: resolution.value,
    },
    text: [
      "checkin trigger ready",
      `user: ${resolution.value.senderId} [${resolution.value.senderSource || "unknown"}]`,
      `workspace: ${resolution.value.workspaceRoot} [${resolution.value.workspaceSource || "unknown"}]`,
      "",
      payload.text,
    ].join("\n"),
  };
}
