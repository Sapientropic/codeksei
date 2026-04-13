import {
  buildTerminalLeafHelpText,
  buildTerminalTopicHelpText,
  hasTerminalTopicHelp,
} from "../contracts/command-help-contract";
import { listCommandGroups as listCommandGroupsFromSurface } from "../contracts/command-surface";
import {
  buildTerminalEntryUsage,
} from "./terminal-command-usage";

export function listCommandGroups() {
  return listCommandGroupsFromSurface();
}

export function buildTerminalHelpText() {
  const lines = [
    "用法: codeksei <command> [subcommand]",
    "",
    "公共 CLI：",
  ];

  appendTerminalActionGroups(lines, {
    audience: "public",
    filter: (action) => action.entrypointType === "cli",
  });

  const hasRepoScripts = listCommandGroups().some((group) => group.actions.some(
    (action) => action.status === "active" && action.terminal.length && action.entrypointType === "script",
  ));
  if (hasRepoScripts) {
    lines.push("");
    lines.push("仓库脚本 / shared 模式：");
    appendTerminalActionGroups(lines, {
      audience: "repo",
      filter: (action) => action.entrypointType === "script",
    });
    lines.push("  这些入口需要在 clone 下来的仓库工作树里运行。");
  }

  lines.push("");
  lines.push("微信命令映射与更多场景说明请看 README / docs。");
  return lines.join("\n");
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
    filter,
  }: {
    audience: "public" | "repo";
    filter: (action: ReturnType<typeof listCommandGroups>[number]["actions"][number]) => boolean;
  },
): void {
  for (const group of listCommandGroups()) {
    const activeActions = group.actions.filter(
      (action) => action.status === "active" && action.terminal.length && filter(action),
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
