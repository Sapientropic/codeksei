import type { NormalizedIncomingMessage } from "./runtime-types";

type WorkspaceRouteName = "bind" | "status" | "new" | "reread" | "switch" | "stop";
type ControlRouteName = "approval" | "model" | "help";

export interface ParsedChannelCommand {
  args: string;
  name: string;
}

export type ChannelCommandMessage = Pick<
  NormalizedIncomingMessage,
  "accountId" | "contextToken" | "provider" | "senderId" | "text" | "workspaceId"
>;

export interface WorkspaceCommandHandlerSet {
  bind(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  new: (normalized: ChannelCommandMessage, command: ParsedChannelCommand) => Promise<unknown>;
  reread(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  status(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  stop(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  switch(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
}

export interface ControlCommandHandlerSet {
  approval(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  help(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  model(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
}

const ROUTE_BY_COMMAND = new Map<string, WorkspaceRouteName | Exclude<ControlRouteName, "approval">>([
  ["bind", "bind"],
  ["status", "status"],
  ["new", "new"],
  ["reread", "reread"],
  ["switch", "switch"],
  ["stop", "stop"],
  ["model", "model"],
  ["help", "help"],
]);

class ChannelCommandRouter {
  controlHandlers: ControlCommandHandlerSet;
  workspaceHandlers: WorkspaceCommandHandlerSet;

  constructor({
    workspaceHandlers,
    controlHandlers,
  }: {
    workspaceHandlers: WorkspaceCommandHandlerSet;
    controlHandlers: ControlCommandHandlerSet;
  }) {
    this.workspaceHandlers = workspaceHandlers;
    this.controlHandlers = controlHandlers;
  }

  async maybeDispatchCommand(normalized: ChannelCommandMessage): Promise<boolean> {
    const command = parseChannelCommand(normalized?.text);
    if (!command) {
      return false;
    }

    const routeName = resolveRouteName(command.name);
    switch (routeName) {
      case "bind":
      case "status":
      case "new":
      case "reread":
      case "switch":
      case "stop":
        await this.workspaceHandlers[routeName](normalized, command);
        return true;
      case "approval":
        await this.controlHandlers.approval(normalized, command);
        return true;
      case "model":
        await this.controlHandlers.model(normalized, command);
        return true;
      case "help":
      default:
        await this.controlHandlers.help(normalized, command);
        return true;
    }
  }
}

function resolveRouteName(commandName: unknown): WorkspaceRouteName | ControlRouteName {
  const normalized = normalizeCommandName(commandName);
  if (!normalized) {
    return "help";
  }
  if (normalized === "yes" || normalized === "always" || normalized === "no") {
    return "approval";
  }
  return ROUTE_BY_COMMAND.get(normalized) || "help";
}

function parseChannelCommand(text: unknown): ParsedChannelCommand | null {
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized.startsWith("/")) {
    return null;
  }
  const [rawName, ...rest] = normalized.slice(1).split(/\s+/);
  const name = normalizeCommandName(rawName);
  if (!name) {
    return null;
  }
  return {
    name,
    args: rest.join(" ").trim(),
  };
}

function normalizeCommandName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export {
  ChannelCommandRouter,
  normalizeCommandName,
  parseChannelCommand,
  resolveRouteName,
};
