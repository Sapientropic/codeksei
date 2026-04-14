import { SessionStore } from "../adapters/runtime/codex/session-store";
import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import {
  buildTargetResolutionRequiredError,
  buildValidationError,
} from "../core/cli-contract";
import {
  buildCheckinTargetResolutionErrorMessage,
  type CheckinResolvedTarget,
  normalizeCheckinCompleteResult,
  resolveCheckinTarget,
  runCheckinComplete,
} from "../core/checkin-core";
import { buildTerminalLeafHelp } from "../core/command-registry";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { resolveHostMode } from "../core/host-mode";
import { createHostedCheckinWakePlan } from "../core/hosted-checkin-cron";
import { syncCheckinCronViaHermesRepoLocal } from "../core/hermes-repo-local";
import { formatCheckinRange } from "../state/checkin-config";
import { normalizeText } from "../core/text-normalization";

interface SystemCheckinCompleteOptions {
  help: boolean;
  nextWakeAt: string;
  result: string;
  sleepFor: string;
  trigger: string;
  user: string;
  workspace: string;
}

type RuntimeConfig = Pick<AppRuntimeConfig, "checkinConfigFile" | "checkinScheduleStateFile"> & Partial<Pick<
  AppRuntimeConfig,
  | "accountId"
  | "allowedUserIds"
  | "channelProvider"
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
  | "runtime"
  | "sessionsFile"
  | "userName"
  | "workspaceId"
  | "workspaceRoot"
>>;

export async function runSystemCheckinCompleteCommand(
  config: RuntimeConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<SystemCheckinCompleteOptions>(args, getCommandArgsSchema("systemCheckinComplete"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("system.checkin_complete"),
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

  const normalizedResult = normalizeCheckinCompleteResult(options.result);
  if (!normalizedResult) {
    throw buildValidationError(
      "checkin complete 的 --result 必须是 sent_message | silent | backstage_only",
      { result: options.result },
      "按这轮 proactive pass 的真实结果传 --result。"
    );
  }
  if (!normalizeText(options.trigger)) {
    throw buildValidationError(
      "checkin complete 缺少 --trigger",
      {},
      "把当前 active wake 的 triggerId 传给 --trigger。"
    );
  }

  try {
    const completion = runCheckinComplete({
      config,
      nextWakeAt: options.nextWakeAt,
      result: normalizedResult,
      sleepFor: options.sleepFor,
      target: resolution.value,
      triggerId: options.trigger,
    });
    const hostMode = resolveHostMode(config);
    const hostedWakeSync = hostMode.profile === "hosted-hermes-weixin"
      ? syncHostedWakeAfterCompletion(config, resolution.value, completion.nextWakeAt)
      : null;
    return {
      ok: hostedWakeSync?.ok === "partial" ? "partial" : true,
      data: {
        completion: completion.completion,
        hostedWakeSync: hostedWakeSync?.data || null,
        interval: {
          range: formatCheckinRange(completion.intervalConfig),
          source: completion.intervalConfig.source,
        },
        nextDueAt: completion.nextDueAt,
        nextWakeAt: completion.nextWakeAt,
        target: completion.target,
      },
      text: [
        "checkin complete recorded",
        `result: ${completion.completion.result}`,
        `scheduleSource: ${completion.completion.scheduleSource}`,
        `nextWakeAt: ${completion.nextWakeAt}`,
        `nextDueAt: ${completion.nextDueAt}`,
        ...(hostedWakeSync?.text ? [hostedWakeSync.text] : []),
      ].join("\n"),
    };
  } catch (error) {
    throw buildValidationError(
      error instanceof Error ? error.message : String(error || "unknown error"),
      {
        nextWakeAt: options.nextWakeAt,
        result: normalizedResult,
        sleepFor: options.sleepFor,
        trigger: options.trigger,
      },
      "传合法的 --trigger / --result，并且在 --next-wake-at 与 --sleep-for 中二选一。"
    );
  }
}

function syncHostedWakeAfterCompletion(
  config: RuntimeConfig,
  target: CheckinResolvedTarget,
  nextWakeAt: string,
): CommandExecutionResult<Record<string, unknown>> | null {
  try {
    const plan = createHostedCheckinWakePlan(config, target, nextWakeAt);
    const sync = syncCheckinCronViaHermesRepoLocal(config, {
      due_at_iso: plan.plannedWakeAt,
      name: plan.name,
      prompt: plan.prompt,
      role: plan.role,
      sender_id: plan.senderId,
      target_key: plan.targetKey,
      workspace_root: plan.workspaceRoot,
    });
    return {
      data: {
        created: sync.created,
        deliver: sync.deliver,
        jobId: sync.jobId,
        name: sync.name,
        nextRunAt: sync.nextRunAt,
        removedJobIds: sync.removedJobIds,
        role: sync.role,
      },
      text: `hosted_next_wake: ${sync.nextRunAt} [${sync.role}] job=${sync.jobId}`,
    };
  } catch (error) {
    return {
      ok: "partial",
      data: {
        error: error instanceof Error ? error.message : String(error || "unknown error"),
      },
      text: `hosted_next_wake_sync_failed: ${error instanceof Error ? error.message : String(error || "unknown error")}`,
    };
  }
}
