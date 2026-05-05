import type { NormalizedIncomingMessage } from "./runtime-types";

type WorkspaceRouteName = "bind" | "status" | "new" | "reread" | "switch" | "stop" | "compact" | "page";
type ControlRouteName = "approval" | "model" | "effort" | "checkin" | "reply" | "help";

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
  compact(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  new: (normalized: ChannelCommandMessage, command: ParsedChannelCommand) => Promise<unknown>;
  page(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  reread(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  status(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  stop(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  switch(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  hasActivePagePointer?(normalized: ChannelCommandMessage): Promise<boolean> | boolean;
}

export interface ControlCommandHandlerSet {
  approval(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  checkin(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  effort(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  help(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  model(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
  reply(normalized: ChannelCommandMessage, command: ParsedChannelCommand): Promise<unknown>;
}

const ROUTE_BY_COMMAND = new Map<string, WorkspaceRouteName | Exclude<ControlRouteName, "approval">>([
  ["bind", "bind"],
  ["compact", "compact"],
  ["done", "page"],
  ["full", "page"],
  ["more", "page"],
  ["next", "page"],
  ["page", "page"],
  ["prev", "page"],
  ["status", "status"],
  ["new", "new"],
  ["reread", "reread"],
  ["switch", "switch"],
  ["stop", "stop"],
  ["model", "model"],
  ["effort", "effort"],
  ["checkin", "checkin"],
  ["reply", "reply"],
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
      const implicitPageCommand = parseImplicitPaginationCommand(normalized?.text);
      if (!implicitPageCommand) {
        return false;
      }
      const hasActivePointer = typeof this.workspaceHandlers.hasActivePagePointer === "function"
        ? await this.workspaceHandlers.hasActivePagePointer(normalized)
        : false;
      if (!hasActivePointer) {
        return false;
      }
      await this.workspaceHandlers.page(normalized, implicitPageCommand);
      return true;
    }

    const routeName = resolveRouteName(command.name);
    switch (routeName) {
      case "bind":
      case "compact":
      case "page":
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
      case "effort":
        await this.controlHandlers.effort(normalized, command);
        return true;
      case "checkin":
        await this.controlHandlers.checkin(normalized, command);
        return true;
      case "reply":
        await this.controlHandlers.reply(normalized, command);
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

function parseImplicitPaginationCommand(text: unknown): ParsedChannelCommand | null {
  const normalized = typeof text === "string" ? text.trim() : "";
  if (!normalized) {
    return null;
  }
  if (normalized === "更多" || normalized === "下一页") {
    return { name: "more", args: "" };
  }
  if (normalized === "上一页" || normalized === "上页") {
    return { name: "prev", args: "" };
  }
  if (normalized === "全文") {
    return { name: "full", args: "" };
  }
  if (normalized === "收起") {
    return { name: "done", args: "" };
  }
  const pageMatch = /^第?\s*(\d{1,4})\s*页$/u.exec(normalized);
  if (pageMatch) {
    return { name: "page", args: pageMatch[1] || "" };
  }
  return null;
}

function normalizeCommandName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export {
  ChannelCommandRouter,
  normalizeCommandName,
  parseChannelCommand,
  parseImplicitPaginationCommand,
  resolveRouteName,
};
