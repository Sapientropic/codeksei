import {
  findCommandAction,
  listCommandActions,
  type CommandAction,
  type CommandActionId,
  type CommandEntrypointType,
} from "../contracts/command-surface";
import { CHECKIN_COMPLETION_SLEEP_FOR_PLACEHOLDER } from "../checkin/completion-guidance";

type TerminalAudience = "public" | "repo";

type CommandActionLike = Pick<
  CommandAction,
  "action" | "command" | "entrypointType" | "scriptName" | "subcommand" | "terminal"
>;


const ACTION_USAGE_ARGS: Readonly<Partial<Record<CommandActionId, string>>> = Object.freeze({
  "channel.send_file": "--path /绝对路径",
  "companion.remember": "--user <wechat_user_id> --workspace /绝对路径 --source host_user_turn [--text \"内容\" | --stdin]",
  "context.briefing": "--user <wechat_user_id> --workspace /绝对路径 [--mode proactive|review]",
  "diary.append": "--section todo --state open --text \"内容\"",
  "host.bootstrap": "--provider hermes [--ensure-daemon] [--workspace /绝对路径]",
  "host.doctor": "--provider hermes",
  "host.smoke": "--provider hermes",
  "host.seed_proactive": "--provider hermes --user <wechat_user_id> --workspace /绝对路径 [--sleep-for 2h]",
  "host.claim_checkin": "--provider hermes --user <wechat_user_id> --workspace /绝对路径",
  "host.settle_checkin": `--provider hermes --user <wechat_user_id> --workspace /绝对路径 --lease <leaseId> --result silent --sleep-for ${CHECKIN_COMPLETION_SLEEP_FOR_PLACEHOLDER}`,
  "host.render": "--provider hermes --target skill [--validate]",
  "onboarding.start": "--user <wechat_user_id>",
  "onboarding.step": "--user <wechat_user_id> --session <sessionId> [--text \"内容\" | --stdin]",
  "onboarding.status": "--user <wechat_user_id>",
  "onboarding.reset": "--user <wechat_user_id>",
  "note.auto": "(--project <slug> | --scope <name>) --kind <kind> [--text \"内容\" | --stdin]",
  "note.maybe": "[--project <slug> | --scope <name>] [--kind <kind>] [--json]",
  "note.sync": "(--project <slug> | --path <path>) --section <标题> [--text \"内容\" | --stdin] [--style bullet|paragraph] [--slot <id>] [--max-items N]",
  "operator.hermes.install_skill": "[--dry-run] [--idempotency-key <key>]",
  "operator.hermes.smoke": "",
  "operator.hermes.status": "",
  "project.radar": "[--list] [--project <slug>] [--json] [--commits 5] [--changes 20]",
  "reminder.create": "--delay 30m --text \"提醒内容\" [--delivery direct|proactive]",
  "review.monthly": "[--month YYYY-MM] [--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
  "review.nightly": "[--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
  "review.weekly": "[--week YYYY-Www] [--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
  "system.checkin_config": "[--show] [--range 3-60] [--reset]",
  "system.checkin_tick": "[--user <wechat_user_id>] [--workspace /绝对路径] [--ack <triggerId>]",
  "system.checkin_complete": `[--user <wechat_user_id>] [--workspace /绝对路径] --trigger <triggerId> --result sent_message|silent|backstage_only (--next-wake-at <ISO8601> | --sleep-for ${CHECKIN_COMPLETION_SLEEP_FOR_PLACEHOLDER})`,
  "system.checkin_trigger": "[--user <wechat_user_id>] [--workspace /绝对路径]",
  "system.send": "--text \"<message>\" [--user <wechat_user_id>] [--workspace /绝对路径]",
  "timeline.event": "--date YYYY-MM-DD --start HH:mm --end HH:mm --title \"标题\" (--event-node <id> | --subcategory <id>) [其他参数]",
  "timeline.write": "--date YYYY-MM-DD [--mode merge|replace] [--json '{\"events\":[...]}'] [--stdin]",
  "timeline.read": "--date YYYY-MM-DD",
  "timeline.categories": "",
  "timeline.proposals": "[--date YYYY-MM-DD]",
  "timeline.serve": "[--port 4317]",
  "timeline.dev": "[--port 4317]",
  "timeline.screenshot": "[--output /绝对路径] [其他 timeline screenshot 参数]",
});

export function buildTerminalEntryUsage(action: CommandActionLike | CommandActionId | string, audience: TerminalAudience): string {
  const resolved = resolveAction(action);
  if (!resolved) {
    return audience === "repo" ? "npm run <script>" : "codeksei <command> [subcommand]";
  }
  return audience === "repo"
    ? buildRepoScriptAlias(resolved)
    : buildPublicTerminalCommand(resolved);
}

export function buildTerminalActionExample(
  action: CommandActionLike | CommandActionId | string,
  {
    audience = "public",
    includeArgs = false,
  }: {
    audience?: TerminalAudience;
    includeArgs?: boolean;
  } = {},
): string {
  const resolved = resolveAction(action);
  if (!resolved) {
    return buildTerminalEntryUsage("", audience);
  }

  const command = buildTerminalEntryUsage(resolved, audience);
  const argSuffix = ACTION_USAGE_ARGS[resolved.action] || "";
  if (!includeArgs || !argSuffix || !command) {
    return command;
  }

  if (audience === "repo") {
    return `${command}${resolved.entrypointType === "cli" ? " -- " : " "}${argSuffix}`;
  }
  return `${command} ${argSuffix}`;
}

export function listRepoScriptActions(): CommandActionLike[] {
  return listCommandActions().filter((action) => action.entrypointType === "script" && action.terminal.length && action.scriptName);
}

function buildPublicTerminalCommand(action: CommandActionLike): string {
  if ((action.entrypointType as CommandEntrypointType) !== "cli" || !action.command) {
    return "";
  }
  return ["codeksei", action.command, action.subcommand].filter(Boolean).join(" ");
}

function buildRepoScriptAlias(action: CommandActionLike): string {
  return action.scriptName ? `npm run ${action.scriptName}` : "";
}

function resolveAction(action: CommandActionLike | CommandActionId | string): CommandActionLike | null {
  if (typeof action === "string") {
    return findCommandAction(action);
  }
  return action && typeof action === "object" ? action : null;
}
