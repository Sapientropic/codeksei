import {
  buildTerminalLeafHelpText,
  buildTerminalTopicHelpText,
  hasTerminalTopicHelp,
} from "../contracts/command-help-contract";
import { listCommandGroups as listCommandGroupsFromSurface } from "../contracts/command-surface";
import type { CliAudience } from "../contracts/cli-contract";
import {
  buildTerminalEntryUsage,
} from "./terminal-command-usage";

export function listCommandGroups() {
  return listCommandGroupsFromSurface();
}

export function buildTerminalHelpText({ audience = "public" }: { audience?: CliAudience } = {}) {
  const lines = [
    audience === "operator" ? "用法: codeksei operator <help|schema>" : "用法: codeksei <command> [subcommand]",
    "",
    audience === "operator" ? "Operator / bootstrap CLI：" : "Public CLI：",
  ];

  appendTerminalActionGroups(lines, {
    audience: "public",
    actionAudience: audience,
    filter: (action) => action.entrypointType === "cli",
  });

  const hasRepoScripts = audience === "operator" && listCommandGroups().some((group) => group.actions.some(
    (action) =>
      action.status === "active"
      && action.terminal.length
      && action.entrypointType === "script"
      && action.audience === "operator",
  ));
  if (hasRepoScripts) {
    lines.push("");
    lines.push("仓库脚本 / operator mode：");
    appendTerminalActionGroups(lines, {
      audience: "repo",
      actionAudience: "operator",
      filter: (action) => action.entrypointType === "script",
    });
    lines.push("  这些入口需要在 clone 下来的仓库工作树里运行。");
  }

  lines.push("");
  if (audience === "operator") {
    lines.push("public 命令面请用 `codeksei help`；结构化合同请用 `codeksei operator schema`。");
  } else {
    lines.push("结构化合同请用 `codeksei schema`；operator/bootstrap 入口请用 `codeksei operator help`。");
  }
  return lines.join("\n");
}

export function buildOperatorHelpText() {
  return buildTerminalHelpText({ audience: "operator" });
}

export function buildWeixinHelpText() {
  const lines = ["当前可用命令："];
  for (const group of listCommandGroups()) {
    const activeActions = group.actions.filter((action) => action.status === "active" && action.weixin.length);
    if (!activeActions.length) {
      continue;
    }
    lines.push("");
    lines.push(`${group.label}：`);
    for (const action of activeActions) {
      lines.push(`- ${action.weixin.join(", ")}  ${action.summary}`);
    }
  }
  return lines.join("\n");
}

export function buildTerminalTopicHelp(topic: unknown, context: Record<string, unknown> = {}) {
  return buildTerminalTopicHelpText(topic, context);
}

export function buildTerminalLeafHelp(actionId: unknown, context: Record<string, unknown> = {}) {
  return buildTerminalLeafHelpText(actionId, context);
}

export function isPlannedTerminalTopic(topic: unknown) {
  return hasTerminalTopicHelp(topic);
}

function appendTerminalActionGroups(
  lines: string[],
  {
    audience,
    actionAudience,
    filter,
  }: {
    audience: "public" | "repo";
    actionAudience: CliAudience;
    filter: (action: ReturnType<typeof listCommandGroups>[number]["actions"][number]) => boolean;
  },
): void {
  for (const group of listCommandGroups()) {
    const activeActions = group.actions.filter(
      (action) =>
        action.status === "active"
        && action.audience === actionAudience
        && action.terminal.length
        && filter(action),
    );
    if (!activeActions.length) {
      continue;
    }
    lines.push(`- ${group.label}`);
    for (const action of activeActions) {
      const command = audience === "public"
        ? buildTerminalEntryUsage(action, "public")
        : buildTerminalEntryUsage(action, "repo");
      lines.push(`  ${command}  ${action.summary}`);
    }
  }
}
