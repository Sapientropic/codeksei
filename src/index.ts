#!/usr/bin/env node

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
const { writeForeignTextDocument } = require("./core/json-state");
const { resolvePackageRoot } = require("./core/path-utils");
const { resolveConfiguredPersonName } = require("./core/person-reference");

function ensureDefaultStateDirectory() {
  ensureStateDirectory();
}

function loadEnv() {
  loadEnvStack();
  ensureDefaultStateDirectory();
}

function ensureRuntimeEnv() {
  ensureCompatHomeEnv({ fallbackRoot: resolvePackageRoot(__dirname) });
}

function ensureBootstrapFiles(config: any) {
  ensureInstructionsTemplate(config);
}

function ensureInstructionsTemplate(config: any) {
  const filePath = typeof config?.weixinInstructionsFile === "string"
    ? config.weixinInstructionsFile.trim()
    : "";
  if (!filePath || fs.existsSync(filePath)) {
    return;
  }

  // The repo template is now the default persona source. Keep this bootstrap
  // path only for explicit custom file paths that may still need seeding.
  const templatePath = path.join(resolvePackageRoot(__dirname), "templates", "weixin-instructions.md");
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
  writeForeignTextDocument(filePath, content, { encoding: "utf8" });
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

  process.on("unhandledRejection", (reason: any) => {
    const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
    console.error(`[${PACKAGE_NAME}] unhandled rejection ${message}`);
  });

  process.on("uncaughtException", (error: any) => {
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
  const baseConfig = readConfig();
  const command = argv[0] || "help";
  const subcommand = argv[1] || "";
  const config = {
    ...baseConfig,
    startWithCheckin: baseConfig.startWithCheckin || hasArgFlag(argv, "--checkin"),
  };
  ensureBootstrapFiles(config);
  let app: any = null;
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

  throw new Error(`未知命令: ${command}`);
}

module.exports = { main };

async function runTerminalManifestCommand(manifest: any, {
  argv,
  config,
  getApp,
  leafArgs,
}: any) {
  const handlers = {
    help: async () => {
      printHelp();
    },
    login: async () => {
      await getApp().login();
    },
    accounts: async () => {
      getApp().printAccounts();
    },
    start: async () => {
      await getApp().start();
    },
    doctor: async () => {
      getApp().printDoctor();
    },
    "channel.send-file": async () => {
      await runChannelSendFileCommand(getApp(), leafArgs);
    },
    "note.sync": async () => {
      await runNoteSyncCommand(config, leafArgs);
    },
    "note.auto": async () => {
      await runNoteAutoCommand(config, leafArgs);
    },
    "note.maybe": async () => {
      runNoteMaybeCommand(config, leafArgs);
    },
    "project.radar": async () => {
      await runProjectRadarCommand(config, leafArgs);
    },
    "review.command": async () => {
      await runReviewCommand(config, manifest.kind, leafArgs);
    },
    "reminder.write": async () => {
      await runReminderWriteCommand(config, leafArgs);
    },
    "diary.write": async () => {
      await runDiaryWriteCommand(config, leafArgs);
    },
    "system.send": async () => {
      await runSystemSendCommand(config, leafArgs);
    },
    "system.checkin-poller": async () => {
      await runSystemCheckinPoller(config);
    },
    "timeline.event": async () => {
      const timelineIntegration = createTimelineIntegration(config);
      await runTimelineEventCommand(timelineIntegration, config, argv.slice(2));
    },
    "timeline.screenshot": async () => {
      await runTimelineScreenshotCommand(config, argv.slice(2));
    },
    "timeline.subcommand": async () => {
      const timelineIntegration = createTimelineIntegration(config);
      await timelineIntegration.runSubcommand(manifest.timelineSubcommand, argv.slice(2));
    },
  };

  const handler = handlers[manifest.runner as keyof typeof handlers];
  if (!handler) {
    throw new Error(`未知命令: ${manifest.command}${manifest.subcommand ? ` ${manifest.subcommand}` : ""}`);
  }
  await handler();
}

function hasArgFlag(argv: any, flag: any) {
  return Array.isArray(argv) && argv.some((item: any) => String(item || "").trim() === flag);
}

export {};
