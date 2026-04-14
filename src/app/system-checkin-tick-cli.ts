import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { SessionStore } from "../adapters/runtime/codex/session-store";
import { parseCliArgs } from "../core/cli-args";
import {
  buildTargetResolutionRequiredError,
  buildValidationError,
} from "../core/cli-contract";
import {
  buildCheckinTargetResolutionErrorMessage,
  resolveCheckinTarget,
  runCheckinTick,
} from "../core/checkin-core";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { formatCheckinRange } from "../state/checkin-config";
import { normalizeText } from "../core/text-normalization";

interface SystemCheckinTickOptions {
  ack: string;
  help: boolean;
  user: string;
  workspace: string;
}

interface RuntimeConfig extends Record<string, unknown> {
  accountId?: unknown;
  checkinConfigFile?: string;
  checkinScheduleStateFile?: string;
  sessionsFile?: string;
}

export async function runSystemCheckinTickCommand(
  config: RuntimeConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<SystemCheckinTickOptions>(args, getCommandArgsSchema("systemCheckinTick"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("system.checkin_tick"),
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

  let tickResult;
  try {
    tickResult = runCheckinTick({
      ack: options.ack,
      config,
      target: resolution.value,
    });
  } catch (error) {
    throw buildValidationError(
      error instanceof Error ? error.message : String(error || "unknown error"),
      { ack: options.ack },
      "未 ack 时先轮询一次拿到 triggerId；ack 时必须传当前 pending trigger 的 id。"
    );
  }

  return {
    data: {
      acknowledged: tickResult.acknowledged,
      due: tickResult.due,
      interval: {
        range: formatCheckinRange(tickResult.intervalConfig),
        source: tickResult.intervalConfig.source,
      },
      nextDueAt: tickResult.nextDueAt,
      payload: tickResult.payload,
      target: tickResult.target,
    },
    text: renderCheckinTickText(tickResult),
  };
}

function renderCheckinTickText(tickResult: ReturnType<typeof runCheckinTick>): string {
  const lines = [
    `interval: ${formatCheckinRange(tickResult.intervalConfig)} [${tickResult.intervalConfig.source}]`,
    `user: ${tickResult.target.senderId} [${tickResult.target.senderSource || "unknown"}]`,
    `workspace: ${tickResult.target.workspaceRoot} [${tickResult.target.workspaceSource || "unknown"}]`,
  ];

  if (tickResult.acknowledged) {
    lines.unshift("checkin tick acked");
    lines.push(`nextDueAt: ${tickResult.nextDueAt}`);
    return lines.join("\n");
  }

  if (tickResult.due && tickResult.payload) {
    lines.unshift(`checkin due: ${tickResult.payload.triggerId}`);
    lines.push(`dueAt: ${tickResult.payload.dueAt}`);
    lines.push("");
    lines.push(tickResult.payload.text);
    return lines.join("\n");
  }

  lines.unshift("checkin scheduled");
  lines.push(`nextDueAt: ${tickResult.nextDueAt}`);
  return lines.join("\n");
}
