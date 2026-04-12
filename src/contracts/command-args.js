// @ts-check

function createCommandArgSchema({ flags, passthrough = null }) {
  return Object.freeze({
    flags: Object.freeze(flags.map((flag) => Object.freeze({ ...flag }))),
    passthrough: passthrough ? Object.freeze({ ...passthrough }) : null,
  });
}

const COMMON_HELP_FLAG = {
  name: "help",
  keys: ["--help", "-h"],
  type: "boolean",
  defaultValue: false,
};

const COMMAND_ARG_SCHEMAS = Object.freeze({
  channelSendFile: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "path", keys: ["--path"], type: "string", defaultValue: "" },
      { name: "user", keys: ["--user"], type: "string", defaultValue: "" },
    ],
  }),
  diaryWrite: createCommandArgSchema({
    flags: [
      { name: "text", keys: ["--text"], type: "string", defaultValue: "" },
      { name: "title", keys: ["--title"], type: "string", defaultValue: "" },
      { name: "date", keys: ["--date"], type: "string", defaultValue: "" },
      { name: "time", keys: ["--time"], type: "string", defaultValue: "" },
      { name: "section", keys: ["--section"], type: "string", defaultValue: "supplement" },
      { name: "state", keys: ["--state"], type: "string", defaultValue: "" },
      { name: "timelineText", keys: ["--timeline-text"], type: "string", defaultValue: "" },
      { name: "useStdin", keys: ["--stdin"], type: "boolean", defaultValue: false },
    ],
  }),
  noteAuto: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "json", keys: ["--json"], type: "boolean", defaultValue: false },
      { name: "project", keys: ["--project"], type: "string", defaultValue: "" },
      { name: "scope", keys: ["--scope"], type: "string", defaultValue: "" },
      { name: "kind", keys: ["--kind"], type: "string", defaultValue: "" },
      { name: "text", keys: ["--text"], type: "string", defaultValue: "" },
      { name: "useStdin", keys: ["--stdin"], type: "boolean", defaultValue: false },
    ],
  }),
  noteSync: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "project", keys: ["--project"], type: "string", defaultValue: "" },
      { name: "path", keys: ["--path"], type: "string", defaultValue: "" },
      { name: "section", keys: ["--section"], type: "string", defaultValue: "" },
      { name: "text", keys: ["--text"], type: "string", defaultValue: "" },
      { name: "style", keys: ["--style"], type: "string", defaultValue: "bullet" },
      { name: "slot", keys: ["--slot"], type: "string", defaultValue: "" },
      { name: "maxItems", keys: ["--max-items"], type: "string", defaultValue: "" },
      { name: "useStdin", keys: ["--stdin"], type: "boolean", defaultValue: false },
    ],
  }),
  projectRadar: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "list", keys: ["--list"], type: "boolean", defaultValue: false },
      { name: "json", keys: ["--json"], type: "boolean", defaultValue: false },
      { name: "project", keys: ["--project"], type: "string", defaultValue: "" },
      { name: "commits", keys: ["--commits"], type: "string", defaultValue: "5" },
      { name: "changes", keys: ["--changes"], type: "string", defaultValue: "20" },
    ],
  }),
  reminderWrite: createCommandArgSchema({
    flags: [
      { name: "delay", keys: ["--delay"], type: "string", defaultValue: "" },
      { name: "at", keys: ["--at"], type: "string", defaultValue: "" },
      { name: "text", keys: ["--text"], type: "string", defaultValue: "" },
      { name: "user", keys: ["--user"], type: "string", defaultValue: "" },
      { name: "useStdin", keys: ["--stdin"], type: "boolean", defaultValue: false },
    ],
  }),
  review: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "stdout", keys: ["--stdout"], type: "boolean", defaultValue: false },
      { name: "deterministic", keys: ["--deterministic"], type: "boolean", defaultValue: false },
      { name: "date", keys: ["--date"], type: "string", defaultValue: "" },
      { name: "week", keys: ["--week"], type: "string", defaultValue: "" },
      { name: "month", keys: ["--month"], type: "string", defaultValue: "" },
      { name: "model", keys: ["--model"], type: "string", defaultValue: "" },
    ],
  }),
  systemSend: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "" },
      { name: "text", keys: ["--text"], type: "string", defaultValue: "" },
      { name: "workspace", keys: ["--workspace"], type: "string", defaultValue: "" },
    ],
  }),
  timelineEvent: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "useStdin", keys: ["--stdin"], type: "boolean", defaultValue: false },
      { name: "finalize", keys: ["--finalize"], type: "boolean", defaultValue: false },
      { name: "date", keys: ["--date"], type: "string", defaultValue: "" },
      { name: "start", keys: ["--start"], type: "string", defaultValue: "" },
      { name: "end", keys: ["--end"], type: "string", defaultValue: "" },
      { name: "title", keys: ["--title"], type: "string", defaultValue: "" },
      { name: "note", keys: ["--note"], type: "string", defaultValue: "" },
      { name: "categoryId", keys: ["--category"], type: "string", defaultValue: "" },
      { name: "subcategoryId", keys: ["--subcategory"], type: "string", defaultValue: "" },
      { name: "eventNodeId", keys: ["--event-node"], type: "string", defaultValue: "" },
      { name: "mode", keys: ["--mode"], type: "string", defaultValue: "merge" },
      { name: "eventId", keys: ["--id"], type: "string", defaultValue: "" },
      { name: "tags", keys: ["--tag"], type: "string[]", defaultValue: [] },
    ],
  }),
  timelineScreenshot: createCommandArgSchema({
    flags: [
      COMMON_HELP_FLAG,
      { name: "user", keys: ["--user"], type: "string", defaultValue: "" },
      { name: "outputFile", keys: ["--output"], type: "string", defaultValue: "" },
    ],
    passthrough: {
      key: "forwardArgs",
      ignoreKeys: ["--send", "--demo"],
    },
  }),
});

function getCommandArgsSchema(name) {
  return COMMAND_ARG_SCHEMAS[name] || null;
}

module.exports = {
  COMMAND_ARG_SCHEMAS,
  getCommandArgsSchema,
};
