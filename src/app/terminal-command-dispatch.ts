import { runChannelSendFileCommand } from "./channel-send-file-cli";
import { runDiaryWriteCommand } from "./diary-write-cli";
import { runNoteAutoCommand, runNoteMaybeCommand } from "./note-auto-cli";
import { runNoteSyncCommand } from "./note-sync-cli";
import { runProjectRadarCommand } from "./project-radar-cli";
import { runReminderWriteCommand } from "./reminder-write-cli";
import { runReviewCommand } from "./review-cli";
import { runSystemCheckinConfigCommand } from "./system-checkin-config-cli";
import { runSystemCheckinPoller } from "./system-checkin-poller";
import { runSystemSendCommand } from "./system-send-cli";
import { runTimelineEventCommand } from "./timeline-event-cli";
import { runTimelineScreenshotCommand } from "./timeline-screenshot-cli";
import type {
  CommandRunnerId,
  TerminalCommandManifestEntry,
} from "../contracts/command-surface";
import type { TerminalCommandContext } from "./terminal-command-context";
import { buildTerminalHelpText } from "../core/command-registry";

type ChannelSendFileApp = Parameters<typeof runChannelSendFileCommand>[0];
type NoteSyncConfig = Parameters<typeof runNoteSyncCommand>[0];
type NoteAutoConfig = Parameters<typeof runNoteAutoCommand>[0];
type ProjectRadarConfig = Parameters<typeof runProjectRadarCommand>[0];
type ReviewKind = Parameters<typeof runReviewCommand>[1];
type ReminderWriteConfig = Parameters<typeof runReminderWriteCommand>[0];
type DiaryWriteConfig = Parameters<typeof runDiaryWriteCommand>[0];
type SystemSendConfig = Parameters<typeof runSystemSendCommand>[0];
type TimelineEventConfig = Exclude<Parameters<typeof runTimelineEventCommand>[1], string[]>;


export type TerminalCommandHandler = (
  manifest: TerminalCommandManifestEntry,
  context: TerminalCommandContext,
) => Promise<void>;

export function listTerminalDispatchRunnerIds(): string[] {
  return Object.keys(RUNNERS).sort() as CommandRunnerId[];
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

const RUNNERS: Record<CommandRunnerId, TerminalCommandHandler> = {
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
    await runChannelSendFileCommand(context.getApp() as ChannelSendFileApp, context.leafArgs);
  },
  "note.sync": async (_manifest, context) => {
    await runNoteSyncCommand(context.config as NoteSyncConfig, context.leafArgs);
  },
  "note.auto": async (_manifest, context) => {
    await runNoteAutoCommand(context.config as NoteAutoConfig, context.leafArgs);
  },
  "note.maybe": async (_manifest, context) => {
    runNoteMaybeCommand(context.config as NoteAutoConfig, context.leafArgs);
  },
  "project.radar": async (_manifest, context) => {
    await runProjectRadarCommand(context.config as ProjectRadarConfig, context.leafArgs);
  },
  "review.command": async (manifest, context) => {
    if (!manifest.kind) {
      throw new Error(`review command is missing review kind: ${manifest.command} ${manifest.subcommand}`.trim());
    }
    await runReviewCommand(context.config, manifest.kind as ReviewKind, context.leafArgs);
  },
  "reminder.write": async (_manifest, context) => {
    await runReminderWriteCommand(context.config as unknown as ReminderWriteConfig, context.leafArgs);
  },
  "diary.write": async (_manifest, context) => {
    await runDiaryWriteCommand(context.config as DiaryWriteConfig, context.leafArgs);
  },
  "system.send": async (_manifest, context) => {
    await runSystemSendCommand(context.config as SystemSendConfig, context.leafArgs);
  },
  "system.checkin-config": async (_manifest, context) => {
    await runSystemCheckinConfigCommand(context.config, context.leafArgs);
  },
  "system.checkin-poller": async (_manifest, context) => {
    await runSystemCheckinPoller(context.config);
  },
  "timeline.event": async (_manifest, context) => {
    await runTimelineEventCommand(
      context.getTimelineIntegration(),
      context.config as TimelineEventConfig,
      context.leafArgs,
    );
  },
  "timeline.screenshot": async (_manifest, context) => {
    await runTimelineScreenshotCommand(context.config, context.leafArgs);
  },
  "timeline.subcommand": async (manifest, context) => {
    if (!manifest.timelineSubcommand) {
      throw new Error(`timeline command is missing subcommand: ${manifest.command} ${manifest.subcommand}`.trim());
    }
    await context.getTimelineIntegration().runSubcommand(manifest.timelineSubcommand, context.leafArgs);
  },
};
