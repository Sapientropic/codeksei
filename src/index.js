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
const {
  buildTerminalHelpText,
  buildTerminalTopicHelp,
  isPlannedTerminalTopic,
} = require("./core/command-registry");
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
  fs.writeFileSync(filePath, content, "utf8");
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
    const topicHelp = buildTerminalTopicHelp(command);
    const subcommandArgs = argv.slice(2);
    const wantsSubcommandHelp = subcommandArgs.includes("--help") || subcommandArgs.includes("-h");
    if (subcommand === "help" || !subcommand) {
      console.log(topicHelp);
      return;
    }
    if (command === "diary" && subcommand === "write") {
      if (wantsSubcommandHelp) {
        console.log(topicHelp);
        return;
      }
      await runDiaryWriteCommand(config);
      return;
    }
    if (command === "reminder" && subcommand === "write") {
      if (wantsSubcommandHelp) {
        console.log(topicHelp);
        return;
      }
      await runReminderWriteCommand(config);
      return;
    }
    if (command === "system" && subcommand === "send") {
      await runSystemSendCommand(config);
      return;
    }
    if (command === "system" && subcommand === "checkin-poller") {
      await runSystemCheckinPoller(config);
      return;
    }
    if (command === "channel" && subcommand === "send-file") {
      await runChannelSendFileCommand(getApp());
      return;
    }
    if (command === "note" && subcommand === "sync") {
      if (wantsSubcommandHelp) {
        console.log(topicHelp);
        return;
      }
      await runNoteSyncCommand(config);
      return;
    }
    if (command === "note" && subcommand === "auto") {
      if (wantsSubcommandHelp) {
        console.log(topicHelp);
        return;
      }
      await runNoteAutoCommand(config);
      return;
    }
    if (command === "note" && subcommand === "maybe") {
      if (wantsSubcommandHelp) {
        console.log(topicHelp);
        return;
      }
      runNoteMaybeCommand(config);
      return;
    }
    if (command === "project" && subcommand === "radar") {
      if (wantsSubcommandHelp) {
        console.log(topicHelp);
        return;
      }
      await runProjectRadarCommand(config);
      return;
    }
    if (command === "review" && subcommand === "weekly") {
      if (wantsSubcommandHelp) {
        console.log(topicHelp);
        return;
      }
      await runReviewCommand(config, "weekly");
      return;
    }
    if (command === "review" && subcommand === "nightly") {
      if (wantsSubcommandHelp) {
        console.log(topicHelp);
        return;
      }
      await runReviewCommand(config, "nightly");
      return;
    }
    if (command === "review" && subcommand === "monthly") {
      if (wantsSubcommandHelp) {
        console.log(topicHelp);
        return;
      }
      await runReviewCommand(config, "monthly");
      return;
    }
  }

  if (command === "timeline") {
    const timelineIntegration = createTimelineIntegration(config);
    if (!subcommand || subcommand === "help") {
      console.log(buildTerminalTopicHelp("timeline"));
      return;
    }
    if (subcommand === "event") {
      await runTimelineEventCommand(timelineIntegration, config, argv.slice(2));
      return;
    }
    if (subcommand === "screenshot") {
      const screenshotArgs = argv.slice(2);
      if (screenshotArgs.includes("--help") || screenshotArgs.includes("-h")) {
        await timelineIntegration.runSubcommand(subcommand, screenshotArgs);
        return;
      }
      await runTimelineScreenshotCommand(config, argv.slice(2));
      return;
    }
    await timelineIntegration.runSubcommand(subcommand, argv.slice(2));
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
