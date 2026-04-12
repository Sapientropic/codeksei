const ROUTE_BY_COMMAND = new Map([
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
  controlHandlers: any;
  workspaceHandlers: any;

  constructor({
    workspaceHandlers,
    controlHandlers,
  }: any) {
    this.workspaceHandlers = workspaceHandlers;
    this.controlHandlers = controlHandlers;
  }

  async maybeDispatchCommand(normalized: any) {
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

function resolveRouteName(commandName: any) {
  const normalized = normalizeCommandName(commandName);
  if (!normalized) {
    return "help";
  }
  if (normalized === "yes" || normalized === "always" || normalized === "no") {
    return "approval";
  }
  return ROUTE_BY_COMMAND.get(normalized) || "help";
}

function parseChannelCommand(text: any) {
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

function normalizeCommandName(value: any) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export {
  ChannelCommandRouter,
  normalizeCommandName,
  parseChannelCommand,
  resolveRouteName,
};
