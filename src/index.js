const fs = require("fs");
const path = require("path");

const {
  PACKAGE_NAME,
  ensureCompatHomeEnv,
  ensureStateDirectory,
} = require("./core/branding");
const { loadEnvStack } = require("./core/env-loader");
const { readConfig } = require("./core/config");
const { renderInstructionTemplate } = require("./core/instructions-template");
const { CyberbossApp } = require("./core/app");
const { createTimelineIntegration } = require("./integrations/timeline");
const { runDiaryWriteCommand } = require("./app/diary-write-cli");
const { runReminderWriteCommand } = require("./app/reminder-write-cli");
const { runChannelSendFileCommand } = require("./app/channel-send-file-cli");
const { runNoteAutoCommand, runNoteMaybeCommand } = require("./app/note-auto-cli");
const { runNoteSyncCommand } = require("./app/note-sync-cli");
const { runProjectRadarCommand } = require("./app/project-radar-cli");
const { runReviewCommand } = require("./app/review-cli");
const { runTimelineEventCommand } = require("./app/timeline-event-cli");
const { runTimelineScreenshotCommand } = require("./app/timeline-screenshot-cli");
const { runSystemCheckinPoller } = require("./app/system-checkin-poller");
const { runSystemSendCommand } = require("./app/system-send-cli");
const { findTerminalCommandManifest } = require("./contracts/command-surface");
const { sliceLeafCommandArgs } = require("./core/cli-args");
const {
  buildTerminalHelpText,
  buildTerminalTopicHelp,
  isPlannedTerminalTopic,
} = require("./core/command-registry");
const { writeTextFileAtomically } = require("./core/json-state");
const { resolveConfiguredPersonName } = require("./core/person-reference");

function ensureDefaultStateDirectory() {
  ensureStateDirectory();
}

function loadEnv() {
  loadEnvStack();
  ensureDefaultStateDirectory();
}

function ensureRuntimeEnv() {
  ensureCompatHomeEnv({ fallbackRoot: path.resolve(__dirname, "..") });
}

function ensureBootstrapFiles(config) {
  ensureInstructionsTemplate(config);
}

function ensureInstructionsTemplate(config) {
  const filePath = typeof config?.weixinInstructionsFile === "string"
    ? config.weixinInstructionsFile.trim()
    : "";
  if (!filePath || fs.existsSync(filePath)) {
    return;
  }

  // The repo template is now the default persona source. Keep this bootstrap
  // path only for explicit custom file paths that may still need seeding.
  const templatePath = path.resolve(__dirname, "..", "templates", "weixin-instructions.md");
  let template = "";
  try {
    template = fs.readFileSync(templatePath, "utf8");
  } catch {
    return;
  }

  const userName = resolveConfiguredPersonName(config);
  const content = renderInstructionTemplate(template, {
    ...config,
    userName,
  }).trimEnd() + "\n";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeTextFileAtomically(filePath, content, { encoding: "utf8" });
}

function printHelp() {
  console.log(buildTerminalHelpText());
}

let runtimeErrorHooksInstalled = false;

function installRuntimeErrorHooks() {
  if (runtimeErrorHooksInstalled) {
    return;
  }
  runtimeErrorHooksInstalled = true;

  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
    console.error(`[${PACKAGE_NAME}] unhandled rejection ${message}`);
  });

  process.on("uncaughtException", (error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[${PACKAGE_NAME}] uncaught exception ${message}`);
    process.exitCode = 1;
  });
}

async function main() {
  loadEnv();
  ensureRuntimeEnv();
  installRuntimeErrorHooks();
  const argv = process.argv.slice(2);
  const leafArgs = sliceLeafCommandArgs(process.argv, 4);
  const config = readConfig();
  ensureBootstrapFiles(config);
  const command = config.mode || "help";
  const subcommand = argv[1] || "";
  let app = null;
  const getApp = () => {
    if (!app) {
      app = new CyberbossApp(config);
    }
    return app;
  };

  if (command === "help" || command === "--help" || command === "-h") {
    const topicHelp = subcommand ? buildTerminalTopicHelp(subcommand) : "";
    console.log(topicHelp || buildTerminalHelpText());
    return;
  }

  if (isPlannedTerminalTopic(command)) {
    if (subcommand === "help" || !subcommand) {
      console.log(buildTerminalTopicHelp(command));
      return;
    }
  }

  const manifest = findTerminalCommandManifest(command, subcommand);
  if (manifest) {
    await runTerminalManifestCommand(manifest, {
      argv,
      config,
      getApp,
      leafArgs,
    });
    return;
  }

  if (command === "doctor") {
    getApp().printDoctor();
    return;
  }

  if (command === "login") {
    await getApp().login();
    return;
  }

  if (command === "accounts") {
    getApp().printAccounts();
    return;
  }

  if (command === "start") {
    await getApp().start();
    return;
  }

  throw new Error(`未知命令: ${command}`);
}

module.exports = { main };

async function runTerminalManifestCommand(manifest, {
  argv,
  config,
  getApp,
  leafArgs,
}) {
  switch (manifest.runner) {
    case "help":
      printHelp();
      return;
    case "login":
      await getApp().login();
      return;
    case "accounts":
      getApp().printAccounts();
      return;
    case "start":
      await getApp().start();
      return;
    case "doctor":
      getApp().printDoctor();
      return;
    case "channel.send-file":
      await runChannelSendFileCommand(getApp(), leafArgs);
      return;
    case "note.sync":
      await runNoteSyncCommand(config, leafArgs);
      return;
    case "note.auto":
      await runNoteAutoCommand(config, leafArgs);
      return;
    case "note.maybe":
      runNoteMaybeCommand(config, leafArgs);
      return;
    case "project.radar":
      await runProjectRadarCommand(config, leafArgs);
      return;
    case "review.command":
      await runReviewCommand(config, manifest.kind, leafArgs);
      return;
    case "reminder.write":
      await runReminderWriteCommand(config, leafArgs);
      return;
    case "diary.write":
      await runDiaryWriteCommand(config, leafArgs);
      return;
    case "system.send":
      await runSystemSendCommand(config, leafArgs);
      return;
    case "system.checkin-poller":
      await runSystemCheckinPoller(config);
      return;
    case "timeline.event": {
      const timelineIntegration = createTimelineIntegration(config);
      await runTimelineEventCommand(timelineIntegration, config, argv.slice(2));
      return;
    }
    case "timeline.screenshot":
      await runTimelineScreenshotCommand(config, argv.slice(2));
      return;
    case "timeline.subcommand": {
      const timelineIntegration = createTimelineIntegration(config);
      await timelineIntegration.runSubcommand(manifest.timelineSubcommand, argv.slice(2));
      return;
    }
    default:
      throw new Error(`未知命令: ${manifest.command}${manifest.subcommand ? ` ${manifest.subcommand}` : ""}`);
  }
}
