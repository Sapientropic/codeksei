import {
  findCommandAction,
  listCommandActions,
  type CommandAction,
  type CommandActionId,
  type CommandEntrypointType,
} from "../contracts/command-surface";

type TerminalAudience = "public" | "repo";

type CommandActionLike = Pick<
  CommandAction,
  "action" | "command" | "entrypointType" | "scriptName" | "subcommand" | "terminal"
>;


const ACTION_USAGE_ARGS: Readonly<Partial<Record<CommandActionId, string>>> = Object.freeze({
  "channel.send_file": "--path /绝对路径",
  "diary.append": "--section todo --state open --text \"内容\"",
  "note.auto": "(--project <slug> | --scope <name>) --kind <kind> [--text \"内容\" | --stdin]",
  "note.maybe": "[--project <slug> | --scope <name>] [--kind <kind>] [--json]",
  "note.sync": "(--project <slug> | --path <path>) --section <标题> [--text \"内容\" | --stdin] [--style bullet|paragraph] [--slot <id>] [--max-items N]",
  "project.radar": "[--list] [--project <slug>] [--json] [--commits 5] [--changes 20]",
  "reminder.create": "--delay 30m --text \"提醒内容\"",
  "review.monthly": "[--month YYYY-MM] [--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
  "review.nightly": "[--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
  "review.weekly": "[--week YYYY-Www] [--date YYYY-MM-DD] [--stdout] [--deterministic] [--model <id>]",
  "system.checkin_config": "[--show] [--range 3-60] [--reset]",
  "system.send": "--text \"<message>\" [--user <wechat_user_id>] [--workspace /绝对路径]",
  "timeline.event": "--date YYYY-MM-DD --start HH:mm --end HH:mm --title \"标题\" (--event-node <id> | --subcategory <id>) [其他参数]",
  "timeline.screenshot": "--send [--user <wechatUserId>] [--output /绝对路径] [其他 timeline screenshot 参数]",
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
