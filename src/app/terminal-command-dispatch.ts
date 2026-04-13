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
import type { CommandExecutionResult } from "../contracts/cli-contract";
import type {
  CommandRunnerId,
  TerminalCommandManifestEntry,
} from "../contracts/command-surface";
import type { TerminalCommandContext } from "./terminal-command-context";
import { buildCommandSchema } from "../core/command-schema";
import { buildOperatorHelpText, buildTerminalHelpText } from "../core/command-registry";
import { runTimelineBuildCommand } from "../timeline/runtime/app/timeline-build-cli";
import { runTimelineCategoriesCommand } from "../timeline/runtime/app/timeline-categories-cli";
import { runTimelineDevCommand } from "../timeline/runtime/app/timeline-dev-cli";
import { runTimelineProposalsCommand } from "../timeline/runtime/app/timeline-proposals-cli";
import { runTimelineReadCommand } from "../timeline/runtime/app/timeline-read-cli";
import { runTimelineServeCommand } from "../timeline/runtime/app/timeline-serve-cli";
import { runTimelineWriteCommand } from "../timeline/runtime/app/timeline-write-cli";
import { resolveTimelineRuntimeConfig } from "../timeline/runtime-config";

type ChannelSendFileApp = Parameters<typeof runChannelSendFileCommand>[0];
type NoteSyncConfig = Parameters<typeof runNoteSyncCommand>[0];
type NoteAutoConfig = Parameters<typeof runNoteAutoCommand>[0];
type ProjectRadarConfig = Parameters<typeof runProjectRadarCommand>[0];
type ReviewKind = Parameters<typeof runReviewCommand>[1];
type ReminderWriteConfig = Parameters<typeof runReminderWriteCommand>[0];
type DiaryWriteConfig = Parameters<typeof runDiaryWriteCommand>[0];
type SystemSendConfig = Parameters<typeof runSystemSendCommand>[0];
type TimelineEventConfig = Parameters<typeof runTimelineEventCommand>[0];


export type TerminalCommandHandler = (
  manifest: TerminalCommandManifestEntry,
  context: TerminalCommandContext,
) => Promise<CommandExecutionResult | void>;

export function listTerminalDispatchRunnerIds(): string[] {
  return Object.keys(RUNNERS).sort() as CommandRunnerId[];
}

export async function runTerminalManifestCommand(
  manifest: TerminalCommandManifestEntry,
  context: TerminalCommandContext,
): Promise<CommandExecutionResult | void> {
  const handler = RUNNERS[manifest.runner];
  if (!handler) {
    throw new Error(`未知命令: ${manifest.command}${manifest.subcommand ? ` ${manifest.subcommand}` : ""}`);
  }
  return handler(manifest, context);
}

const RUNNERS: Record<CommandRunnerId, TerminalCommandHandler> = {
  help: async () => {
    return {
      data: buildCommandSchema({ audience: "public", command: "", subcommand: "" }),
      text: buildTerminalHelpText(),
    };
  },
  schema: async (_manifest, context) => {
    const data = buildCommandSchema({
      audience: "public",
      command: context.leafArgs[0] || "",
      subcommand: context.leafArgs[1] || "",
    });
    return {
      data,
      text: asPrettyJsonText(data),
    };
  },
  "operator.help": async () => {
    return {
      data: buildCommandSchema({ audience: "operator", command: "", subcommand: "" }),
      text: buildOperatorHelpText(),
    };
  },
  "operator.schema": async (_manifest, context) => {
    const data = buildCommandSchema({
      audience: "operator",
      command: context.leafArgs[0] || "",
      subcommand: context.leafArgs[1] || "",
    });
    return {
      data,
      text: asPrettyJsonText(data),
    };
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
    const data = context.getApp().getDoctorReport();
    return {
      data,
      text: asPrettyJsonText(data),
    };
  },
  "channel.send-file": async (_manifest, context) => {
    return runChannelSendFileCommand(context.getApp() as ChannelSendFileApp, context.leafArgs, context.config);
  },
  "note.sync": async (_manifest, context) => {
    return runNoteSyncCommand(context.config as NoteSyncConfig, context.leafArgs);
  },
  "note.auto": async (_manifest, context) => {
    return runNoteAutoCommand(context.config as NoteAutoConfig, context.leafArgs);
  },
  "note.maybe": async (_manifest, context) => {
    return runNoteMaybeCommand(context.config as NoteAutoConfig, context.leafArgs);
  },
  "project.radar": async (_manifest, context) => {
    return runProjectRadarCommand(context.config as ProjectRadarConfig, context.leafArgs);
  },
  "review.command": async (manifest, context) => {
    if (!manifest.kind) {
      throw new Error(`review command is missing review kind: ${manifest.command} ${manifest.subcommand}`.trim());
    }
    return runReviewCommand(context.config, manifest.kind as ReviewKind, context.leafArgs);
  },
  "reminder.write": async (_manifest, context) => {
    return runReminderWriteCommand(context.config as unknown as ReminderWriteConfig, context.leafArgs);
  },
  "diary.write": async (_manifest, context) => {
    return runDiaryWriteCommand(context.config as DiaryWriteConfig, context.leafArgs);
  },
  "system.send": async (_manifest, context) => {
    return runSystemSendCommand(context.config as SystemSendConfig, context.leafArgs);
  },
  "system.checkin-config": async (_manifest, context) => {
    return runSystemCheckinConfigCommand(context.config, context.leafArgs);
  },
  "system.checkin-poller": async (_manifest, context) => {
    await runSystemCheckinPoller(context.config);
  },
  "timeline.event": async (_manifest, context) => {
    return runTimelineEventCommand(
      context.config as TimelineEventConfig,
      context.leafArgs,
    );
  },
  "timeline.screenshot": async (_manifest, context) => {
    return runTimelineScreenshotCommand(context.config, context.leafArgs);
  },
  "timeline.subcommand": async (manifest, context) => {
    if (!manifest.timelineSubcommand) {
      throw new Error(`timeline command is missing subcommand: ${manifest.command} ${manifest.subcommand}`.trim());
    }
    const timelineConfig = resolveTimelineRuntimeConfig(context.config);
    switch (manifest.timelineSubcommand) {
      case "build": {
        const data = await runTimelineBuildCommand(timelineConfig);
        return {
          data,
          text: `timeline dashboard built: ${String(data.siteDir || "")}`,
        };
      }
      case "categories": {
        const data = await runTimelineCategoriesCommand(timelineConfig, context.leafArgs);
        return data
          ? { data, text: asPrettyJsonText(data) }
          : undefined;
      }
      case "dev": {
        const data = await runTimelineDevCommand(timelineConfig, context.leafArgs);
        return data
          ? { data, text: `timeline dev: ${String(data.url || "")}` }
          : undefined;
      }
      case "proposals": {
        const data = await runTimelineProposalsCommand(timelineConfig, context.leafArgs);
        return data
          ? { data, text: asPrettyJsonText(data) }
          : undefined;
      }
      case "read": {
        const data = await runTimelineReadCommand(timelineConfig, context.leafArgs);
        return data
          ? { data, text: asPrettyJsonText(data) }
          : undefined;
      }
      case "serve": {
        const data = await runTimelineServeCommand(timelineConfig, context.leafArgs);
        return data
          ? { data, text: `timeline dashboard: ${String(data.url || "")}` }
          : undefined;
      }
      case "write": {
        const data = await runTimelineWriteCommand(timelineConfig, context.leafArgs);
        return data
          ? {
            data,
            text: [
              `timeline written: ${String(data.date || "")}`,
              `mode: ${String(data.mode || "")}`,
              `events: ${String(data.eventCount || 0)}`,
              `status: ${String(data.status || "")}`,
            ].join("\n"),
          }
          : undefined;
      }
      default:
        await context.getTimelineIntegration().runSubcommand(manifest.timelineSubcommand, context.leafArgs);
        return undefined;
    }
  },
};

function asPrettyJsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
