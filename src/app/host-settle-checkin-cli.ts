import type { CommandExecutionResult } from "../contracts/cli-contract";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildValidationError } from "../core/cli-contract";
import { buildTerminalLeafHelp } from "../core/command-registry";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { settleDelegatedCheckin } from "../host/delegation/settle-checkin";
import { assertResidentDaemonConfig, resolveHostCheckinTarget, resolveHostProviderWithConfig } from "./host-cli-shared";
import type { CheckinBookkeepingAction } from "../checkin";
import { normalizeText } from "../core/text-normalization";

interface HostSettleOptions {
  bookkeepingActions: string[];
  config: string;
  createHandoff: boolean;
  decisionId: string;
  feedbackText: string;
  followupContext: string;
  help: boolean;
  lease: string;
  message: string;
  nextWakeAt: string;
  observedState: string;
  provider: string;
  responseOutcome: string;
  result: string;
  sleepFor: string;
  user: string;
  workspace: string;
}

type SettleCliConfig = Partial<Pick<
  AppRuntimeConfig,
  | "accountId"
  | "allowedUserIds"
  | "checkinConfigFile"
  | "checkinScheduleStateFile"
  | "sessionsFile"
  | "workspaceRoot"
  | "stateDir"
  | "runtime"
  | "channelProvider"
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
  | "stateDir"
>>;

export async function runHostSettleCheckinCommand(
  config: SettleCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<HostSettleOptions>(args, getCommandArgsSchema("hostSettleCheckin"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("host.settle_checkin"),
    };
  }
  assertResidentDaemonConfig(config);
  const target = resolveHostCheckinTarget(config, {
    user: options.user,
    workspace: options.workspace,
  });
  const resolvedProvider = resolveHostProviderWithConfig(config, {
    provider: options.provider,
    configFile: options.config,
    defaultProvider: "hermes",
  });
  const settled = settleDelegatedCheckin(config as Parameters<typeof settleDelegatedCheckin>[0], target, {
    bookkeepingActions: parseBookkeepingActions(options.bookkeepingActions),
    createHandoff: options.createHandoff,
    decisionId: options.decisionId,
    feedbackText: options.feedbackText,
    followupContext: options.followupContext,
    provider: resolvedProvider.provider,
    leaseId: options.lease,
    observedCurrentState: options.observedState,
    responseOutcome: options.responseOutcome,
    result: options.result as Parameters<typeof settleDelegatedCheckin>[2]["result"],
    nextWakeAt: options.nextWakeAt,
    sleepFor: options.sleepFor,
    userVisibleMessage: options.message,
  });
  return {
    ok: settled.ok as true | "partial",
    data: {
      provider: resolvedProvider.provider,
      ...settled,
    },
    text: [
      `provider: ${resolvedProvider.provider}`,
      `ok: ${settled.ok === "partial" ? "partial" : "true"}`,
      settled.handoff ? `handoff: ${settled.handoff.triggerId}` : "",
      `nextWakeAt: ${settled.nextWakeAt || "(none)"}`,
    ].join("\n"),
  };
}

function parseBookkeepingActions(values: string[]): CheckinBookkeepingAction[] {
  return values.map((value) => parseBookkeepingAction(value));
}

function parseBookkeepingAction(value: string): CheckinBookkeepingAction {
  const normalized = normalizeText(value);
  const [kind, status, ...summaryParts] = normalized.split("|");
  const summary = normalizeText(summaryParts.join("|"));
  if (!kind || !status || !summary) {
    throw buildValidationError(
      `非法的 --bookkeeping-action：${normalized || "(empty)"}`,
      { value: normalized },
      "使用 kind|done|summary 或 kind|suggested|summary，例如 timeline|done|记录了 14:00-15:00 的工作块。",
    );
  }
  if (
    kind !== "companion_memory"
    && kind !== "diary"
    && kind !== "note"
    && kind !== "project_note"
    && kind !== "review"
    && kind !== "timeline"
  ) {
    throw buildValidationError(
      `不支持的 bookkeeping action kind：${kind}`,
      { kind, value: normalized },
      "kind 只能是 companion_memory / diary / note / project_note / review / timeline。",
    );
  }
  if (status !== "done" && status !== "suggested") {
    throw buildValidationError(
      `不支持的 bookkeeping action status：${status}`,
      { status, value: normalized },
      "status 只能是 done 或 suggested。",
    );
  }
  return {
    kind,
    status,
    summary,
  } as CheckinBookkeepingAction;
}
