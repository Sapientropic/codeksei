#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { CodekseiApp } from "./core/app";
import * as brandingModule from "./core/branding";
import * as envLoaderModule from "./core/env-loader";
import * as configModule from "./core/config";
import * as instructionsTemplateModule from "./core/instructions-template";
import * as timelineIntegrationModule from "./integrations/timeline";
import * as diaryWriteCliModule from "./app/diary-write-cli";
import * as reminderWriteCliModule from "./app/reminder-write-cli";
import * as channelSendFileCliModule from "./app/channel-send-file-cli";
import * as noteAutoCliModule from "./app/note-auto-cli";
import * as noteSyncCliModule from "./app/note-sync-cli";
import * as projectRadarCliModule from "./app/project-radar-cli";
import * as reviewCliModule from "./app/review-cli";
import * as timelineEventCliModule from "./app/timeline-event-cli";
import * as timelineScreenshotCliModule from "./app/timeline-screenshot-cli";
import * as systemCheckinPollerModule from "./app/system-checkin-poller";
import * as systemSendCliModule from "./app/system-send-cli";
import * as commandSurfaceModule from "./contracts/command-surface";
import * as cliArgsModule from "./core/cli-args";
import * as commandRegistryModule from "./core/command-registry";
import * as jsonStateModule from "./state/json-state";
import * as pathUtilsModule from "./core/path-utils";
import * as personReferenceModule from "./core/person-reference";

const {
  PACKAGE_NAME,
  ensureCodekseiHomeEnv,
  ensureStateDirectory,
} = brandingModule as {
  PACKAGE_NAME: string;
  ensureCodekseiHomeEnv: (args: { fallbackRoot: string }) => void;
  ensureStateDirectory: () => void;
};
const { loadEnvStack } = envLoaderModule as {
  loadEnvStack: () => void;
};
const { readConfig } = configModule as {
  readConfig: () => RuntimeConfig;
};
const { renderInstructionTemplate } = instructionsTemplateModule as {
  renderInstructionTemplate: (template: string, values: Record<string, unknown>) => string;
};
const { createTimelineIntegration } = timelineIntegrationModule as {
  createTimelineIntegration: (config: RuntimeConfig) => TimelineIntegrationLike;
};
const { runDiaryWriteCommand } = diaryWriteCliModule as {
  runDiaryWriteCommand: (config: RuntimeConfig, args: string[]) => Promise<void>;
};
const { runReminderWriteCommand } = reminderWriteCliModule as {
  runReminderWriteCommand: (config: RuntimeConfig, args: string[]) => Promise<void>;
};
const { runChannelSendFileCommand } = channelSendFileCliModule as {
  runChannelSendFileCommand: (app: CodekseiApp, args: string[]) => Promise<void>;
};
const { runNoteAutoCommand, runNoteMaybeCommand } = noteAutoCliModule as {
  runNoteAutoCommand: (config: RuntimeConfig, args: string[]) => Promise<void>;
  runNoteMaybeCommand: (config: RuntimeConfig, args: string[]) => void;
};
const { runNoteSyncCommand } = noteSyncCliModule as {
  runNoteSyncCommand: (config: RuntimeConfig, args: string[]) => Promise<void>;
};
const { runProjectRadarCommand } = projectRadarCliModule as {
  runProjectRadarCommand: (config: RuntimeConfig, args: string[]) => Promise<void>;
};
const { runReviewCommand } = reviewCliModule as {
  runReviewCommand: (config: RuntimeConfig, kind: string, args: string[]) => Promise<void>;
};
const { runTimelineEventCommand } = timelineEventCliModule as {
  runTimelineEventCommand: (
    timelineIntegration: TimelineIntegrationLike,
    config: RuntimeConfig,
    args: string[],
  ) => Promise<void>;
};
const { runTimelineScreenshotCommand } = timelineScreenshotCliModule as {
  runTimelineScreenshotCommand: (config: RuntimeConfig, args: string[]) => Promise<void>;
};
const { runSystemCheckinPoller } = systemCheckinPollerModule as {
  runSystemCheckinPoller: (config: RuntimeConfig) => Promise<void>;
};
const { runSystemSendCommand } = systemSendCliModule as {
  runSystemSendCommand: (config: RuntimeConfig, args: string[]) => Promise<void>;
};
const { findTerminalCommandManifest } = commandSurfaceModule as {
  findTerminalCommandManifest: (command: string, subcommand: string) => TerminalCommandManifest | null;
};
const { sliceLeafCommandArgs } = cliArgsModule as {
  sliceLeafCommandArgs: (argv: string[], maxDepth: number) => string[];
};
const {
  buildTerminalHelpText,
  buildTerminalTopicHelp,
  isPlannedTerminalTopic,
} = commandRegistryModule as {
  buildTerminalHelpText: () => string;
  buildTerminalTopicHelp: (topic: string) => string;
  isPlannedTerminalTopic: (command: string) => boolean;
};
const { writeForeignTextDocument } = jsonStateModule as {
  writeForeignTextDocument: (filePath: string, text: string, options: { encoding: BufferEncoding }) => void;
};
const { resolvePackageRoot } = pathUtilsModule as {
  resolvePackageRoot: (baseDir: string) => string;
};
const { resolveConfiguredPersonName } = personReferenceModule as {
  resolveConfiguredPersonName: (config: RuntimeConfig) => string;
};

interface RuntimeConfig extends Record<string, unknown> {
  sessionsFile: string;
  stateDir: string;
  workspaceId: string;
  workspaceRoot: string;
  startWithCheckin?: boolean;
  weixinInstructionsFile?: string;
}

interface TimelineIntegrationLike {
  runSubcommand(command: string, args: string[]): Promise<unknown>;
}

interface TerminalCommandManifest {
  command: string;
  subcommand?: string;
  runner: string;
  kind?: string;
  timelineSubcommand?: string;
}

function ensureDefaultStateDirectory(): void {
  ensureStateDirectory();
}

function loadEnv(): void {
  loadEnvStack();
  ensureDefaultStateDirectory();
}

function ensureRuntimeEnv(): void {
  ensureCodekseiHomeEnv({ fallbackRoot: resolvePackageRoot(__dirname) });
}

function ensureBootstrapFiles(config: RuntimeConfig): void {
  ensureInstructionsTemplate(config);
}

function ensureInstructionsTemplate(config: RuntimeConfig): void {
  const filePath = typeof config.weixinInstructionsFile === "string"
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
  const content = `${renderInstructionTemplate(template, {
    ...config,
    userName,
  }).trimEnd()}\n`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeForeignTextDocument(filePath, content, { encoding: "utf8" });
}

function printHelp(): void {
  console.log(buildTerminalHelpText());
}

let runtimeErrorHooksInstalled = false;

function installRuntimeErrorHooks(): void {
  if (runtimeErrorHooksInstalled) {
    return;
  }
  runtimeErrorHooksInstalled = true;

  process.on("unhandledRejection", (reason: unknown) => {
    const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
    console.error(`[${PACKAGE_NAME}] unhandled rejection ${message}`);
  });

  process.on("uncaughtException", (error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[${PACKAGE_NAME}] uncaught exception ${message}`);
    process.exitCode = 1;
  });
}

export async function main(): Promise<void> {
  loadEnv();
  ensureRuntimeEnv();
  installRuntimeErrorHooks();
  const argv = process.argv.slice(2);
  const leafArgs = sliceLeafCommandArgs(process.argv, 4);
  const baseConfig = readConfig();
  const command = argv[0] || "help";
  const subcommand = argv[1] || "";
  const config: RuntimeConfig = {
    ...baseConfig,
    startWithCheckin: Boolean(baseConfig.startWithCheckin || hasArgFlag(argv, "--checkin")),
  };
  ensureBootstrapFiles(config);
  let app: CodekseiApp | null = null;
  const getApp = (): CodekseiApp => {
    if (!app) {
      app = new CodekseiApp(config);
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

  const manifest = resolveTerminalCommandManifest(command, subcommand);
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

export function resolveTerminalCommandManifest(command: unknown, subcommand: unknown): TerminalCommandManifest | null {
  const normalizedCommand = String(command || "").trim();
  const normalizedSubcommand = String(subcommand || "").trim();
  const exact = findTerminalCommandManifest(normalizedCommand, normalizedSubcommand);
  if (exact) {
    return exact;
  }
  if (normalizedSubcommand.startsWith("-")) {
    return findTerminalCommandManifest(normalizedCommand, "");
  }
  return null;
}

async function runTerminalManifestCommand(
  manifest: TerminalCommandManifest,
  {
    argv,
    config,
    getApp,
    leafArgs,
  }: {
    argv: string[];
    config: RuntimeConfig;
    getApp: () => CodekseiApp;
    leafArgs: string[];
  },
): Promise<void> {
  const handlers: Record<string, () => Promise<void>> = {
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
      await runReviewCommand(config, manifest.kind || "", leafArgs);
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
      await timelineIntegration.runSubcommand(manifest.timelineSubcommand || "", argv.slice(2));
    },
  };

  const handler = handlers[manifest.runner];
  if (!handler) {
    throw new Error(`未知命令: ${manifest.command}${manifest.subcommand ? ` ${manifest.subcommand}` : ""}`);
  }
  await handler();
}

function hasArgFlag(argv: string[], flag: string): boolean {
  return Array.isArray(argv) && argv.some((item) => String(item || "").trim() === flag);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[${PACKAGE_NAME}] ${message}`);
    process.exitCode = 1;
  });
}
