import * as channelSendFileCliModule from "./channel-send-file-cli";
import * as diaryWriteCliModule from "./diary-write-cli";
import * as noteAutoCliModule from "./note-auto-cli";
import * as noteSyncCliModule from "./note-sync-cli";
import * as projectRadarCliModule from "./project-radar-cli";
import * as reminderWriteCliModule from "./reminder-write-cli";
import * as reviewCliModule from "./review-cli";
import * as systemCheckinPollerModule from "./system-checkin-poller";
import { runSystemSendCommand } from "./system-send-cli";
import * as timelineEventCliModule from "./timeline-event-cli";
import { runTimelineScreenshotCommand } from "./timeline-screenshot-cli";
import type { TerminalCommandManifestEntry } from "../contracts/command-surface";
import type { TerminalCommandContext } from "./terminal-command-context";
import { buildTerminalHelpText } from "../core/command-registry";

const { runChannelSendFileCommand } = channelSendFileCliModule as {
  runChannelSendFileCommand: (app: ReturnType<TerminalCommandContext["getApp"]>, args: string[]) => Promise<void>;
};
const { runDiaryWriteCommand } = diaryWriteCliModule as {
  runDiaryWriteCommand: (config: TerminalCommandContext["config"], args: string[]) => Promise<void>;
};
const { runNoteAutoCommand, runNoteMaybeCommand } = noteAutoCliModule as {
  runNoteAutoCommand: (config: TerminalCommandContext["config"], args: string[]) => Promise<void>;
  runNoteMaybeCommand: (config: TerminalCommandContext["config"], args: string[]) => void;
};
const { runNoteSyncCommand } = noteSyncCliModule as {
  runNoteSyncCommand: (config: TerminalCommandContext["config"], args: string[]) => Promise<void>;
};
const { runProjectRadarCommand } = projectRadarCliModule as {
  runProjectRadarCommand: (config: TerminalCommandContext["config"], args: string[]) => Promise<void>;
};
const { runReminderWriteCommand } = reminderWriteCliModule as {
  runReminderWriteCommand: (config: TerminalCommandContext["config"], args: string[]) => Promise<void>;
};
const { runReviewCommand } = reviewCliModule as {
  runReviewCommand: (config: TerminalCommandContext["config"], kind: string, args: string[]) => Promise<void>;
};
const { runSystemCheckinPoller } = systemCheckinPollerModule as {
  runSystemCheckinPoller: (config: TerminalCommandContext["config"]) => Promise<void>;
};
const { runTimelineEventCommand } = timelineEventCliModule as {
  runTimelineEventCommand: (
    timelineIntegration: ReturnType<TerminalCommandContext["getTimelineIntegration"]>,
    config: TerminalCommandContext["config"],
    args: string[],
  ) => Promise<void>;
};

export type TerminalCommandHandler = (
  manifest: TerminalCommandManifestEntry,
  context: TerminalCommandContext,
) => Promise<void>;

export function listTerminalDispatchRunnerIds(): string[] {
  return Object.keys(RUNNERS).sort();
}

export async function runTerminalManifestCommand(
  manifest: TerminalCommandManifestEntry,
  context: TerminalCommandContext,
): Promise<void> {
  const handler = RUNNERS[manifest.runner];
  if (!handler) {
    throw new Error(`未知命令: ${manifest.command}${manifest.subcommand ? ` ${manifest.subcommand}` : ""}`);
  }
  await handler(manifest, context);
}

const RUNNERS: Record<string, TerminalCommandHandler> = {
  help: async () => {
    console.log(buildTerminalHelpText());
  },
  login: async (_manifest, context) => {
    await context.getApp().login();
  },
  accounts: async (_manifest, context) => {
    context.getApp().printAccounts();
  },
  start: async (_manifest, context) => {
    await context.getApp().start();
  },
  doctor: async (_manifest, context) => {
    context.getApp().printDoctor();
  },
  "channel.send-file": async (_manifest, context) => {
    await runChannelSendFileCommand(context.getApp(), context.leafArgs);
  },
  "note.sync": async (_manifest, context) => {
    await runNoteSyncCommand(context.config, context.leafArgs);
  },
  "note.auto": async (_manifest, context) => {
    await runNoteAutoCommand(context.config, context.leafArgs);
  },
  "note.maybe": async (_manifest, context) => {
    runNoteMaybeCommand(context.config, context.leafArgs);
  },
  "project.radar": async (_manifest, context) => {
    await runProjectRadarCommand(context.config, context.leafArgs);
  },
  "review.command": async (manifest, context) => {
    await runReviewCommand(context.config, manifest.kind || "", context.leafArgs);
  },
  "reminder.write": async (_manifest, context) => {
    await runReminderWriteCommand(context.config, context.leafArgs);
  },
  "diary.write": async (_manifest, context) => {
    await runDiaryWriteCommand(context.config, context.leafArgs);
  },
  "system.send": async (_manifest, context) => {
    await runSystemSendCommand(context.config, context.leafArgs);
  },
  "system.checkin-poller": async (_manifest, context) => {
    await runSystemCheckinPoller(context.config);
  },
  "timeline.event": async (_manifest, context) => {
    await runTimelineEventCommand(context.getTimelineIntegration(), context.config, context.argv.slice(2));
  },
  "timeline.screenshot": async (_manifest, context) => {
    await runTimelineScreenshotCommand(context.config, context.argv.slice(2));
  },
  "timeline.subcommand": async (manifest, context) => {
    await context.getTimelineIntegration().runSubcommand(manifest.timelineSubcommand || "", context.argv.slice(2));
  },
};
