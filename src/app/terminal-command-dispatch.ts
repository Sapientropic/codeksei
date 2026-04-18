import { runChannelSendFileCommand } from "./channel-send-file-cli";
import { runCompanionRememberCommand } from "./companion-remember-cli";
import { runContextBriefingCommand } from "./context-briefing-cli";
import { runDiaryWriteCommand } from "./diary-write-cli";
import {
  runHostBootstrapCommand,
} from "./host-bootstrap-cli";
import {
  runHostClaimCheckinCommand,
} from "./host-claim-checkin-cli";
import {
  runHostDoctorCommand,
} from "./host-doctor-cli";
import {
  runHostManifestCommand,
} from "./host-manifest-cli";
import {
  runHostRenderCommand,
} from "./host-render-cli";
import {
  runHostSeedProactiveCommand,
} from "./host-seed-proactive-cli";
import {
  runHostSettleCheckinCommand,
} from "./host-settle-checkin-cli";
import {
  runHostSmokeCommand,
} from "./host-smoke-cli";
import {
  runHermesInstallSkillCommand,
  runHermesSmokeCommand,
  runHermesStatusCommand,
  runHermesSyncCheckinCommand,
} from "./hermes-operator-cli";
import { runNoteAutoCommand, runNoteMaybeCommand } from "./note-auto-cli";
import { runNoteSyncCommand } from "./note-sync-cli";
import {
  runOnboardingResetCommand,
  runOnboardingStartCommand,
  runOnboardingStatusCommand,
  runOnboardingStepCommand,
} from "./onboarding-cli";
import { runProjectRadarCommand } from "./project-radar-cli";
import { runReminderWriteCommand } from "./reminder-write-cli";
import { runReviewCommand } from "./review-cli";
import { runSystemCheckinConfigCommand } from "./system-checkin-config-cli";
import { runSystemCheckinCompleteCommand } from "./system-checkin-complete-cli";
import { runSystemCheckinTickCommand } from "./system-checkin-tick-cli";
import { runSystemCheckinTriggerCommand } from "./system-checkin-trigger-cli";
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
import { buildUnsupportedHostCapabilityError } from "../core/cli-contract";
import { formatHostSupportTierHint, resolveHostMode } from "../core/host-mode";
import { runTimelineBuildCommand } from "../timeline/runtime/app/timeline-build-cli";
import { runTimelineCategoriesCommand } from "../timeline/runtime/app/timeline-categories-cli";
import { runTimelineDevCommand } from "../timeline/runtime/app/timeline-dev-cli";
import { runTimelineProposalsCommand } from "../timeline/runtime/app/timeline-proposals-cli";
import { runTimelineReadCommand } from "../timeline/runtime/app/timeline-read-cli";
import { runTimelineServeCommand } from "../timeline/runtime/app/timeline-serve-cli";
import { runTimelineWriteCommand } from "../timeline/runtime/app/timeline-write-cli";
import { resolveTimelineRuntimeConfig } from "../timeline/runtime-config";

type ReviewKind = Parameters<typeof runReviewCommand>[1];
type ChannelSendFileApp = Parameters<typeof runChannelSendFileCommand>[0];


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
  assertTerminalCommandSupportedForCurrentHost(manifest, context);
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
      target: context.leafArgs,
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
      target: context.leafArgs,
    });
    return {
      data,
      text: asPrettyJsonText(data),
    };
  },
  "host.manifest": async (_manifest, context) => {
    return runHostManifestCommand(context.config, context.leafArgs);
  },
  "host.bootstrap": async (_manifest, context) => {
    return runHostBootstrapCommand(context.config, context.leafArgs);
  },
  "host.doctor": async (_manifest, context) => {
    return runHostDoctorCommand(context.config, context.leafArgs);
  },
  "host.smoke": async (_manifest, context) => {
    return runHostSmokeCommand(context.config, context.leafArgs);
  },
  "host.seed_proactive": async (_manifest, context) => {
    return runHostSeedProactiveCommand(context.config, context.leafArgs);
  },
  "host.claim_checkin": async (_manifest, context) => {
    return runHostClaimCheckinCommand(context.config, context.leafArgs);
  },
  "host.settle_checkin": async (_manifest, context) => {
    return runHostSettleCheckinCommand(context.config, context.leafArgs);
  },
  "host.render": async (_manifest, context) => {
    return runHostRenderCommand(context.config, context.leafArgs);
  },
  "operator.hermes.install_skill": async (_manifest, context) => {
    return runHermesInstallSkillCommand(context.config, context.leafArgs);
  },
  "operator.hermes.status": async (_manifest, context) => {
    return runHermesStatusCommand(context.config, context.leafArgs);
  },
  "operator.hermes.smoke": async (_manifest, context) => {
    return runHermesSmokeCommand(context.config, context.leafArgs);
  },
  "operator.hermes.sync_checkin": async (_manifest, context) => {
    return runHermesSyncCheckinCommand(context.config, context.leafArgs);
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
  "companion.remember": async (_manifest, context) => {
    return runCompanionRememberCommand(context.config, context.leafArgs);
  },
  "onboarding.start": async (_manifest, context) => {
    return runOnboardingStartCommand(context.config, context.leafArgs);
  },
  "onboarding.step": async (_manifest, context) => {
    return runOnboardingStepCommand(context.config, context.leafArgs);
  },
  "onboarding.status": async (_manifest, context) => {
    return runOnboardingStatusCommand(context.config, context.leafArgs);
  },
  "onboarding.reset": async (_manifest, context) => {
    return runOnboardingResetCommand(context.config, context.leafArgs);
  },
  "context.briefing": async (_manifest, context) => {
    return runContextBriefingCommand(context.config, context.leafArgs);
  },
  "note.sync": async (_manifest, context) => {
    return runNoteSyncCommand(context.config, context.leafArgs);
  },
  "note.auto": async (_manifest, context) => {
    return runNoteAutoCommand(context.config, context.leafArgs);
  },
  "note.maybe": async (_manifest, context) => {
    return runNoteMaybeCommand(context.config, context.leafArgs);
  },
  "project.radar": async (_manifest, context) => {
    return runProjectRadarCommand(context.config, context.leafArgs);
  },
  "review.command": async (manifest, context) => {
    if (!manifest.kind) {
      throw new Error(`review command is missing review kind: ${manifest.command} ${manifest.subcommand}`.trim());
    }
    return runReviewCommand(context.config, manifest.kind as ReviewKind, context.leafArgs);
  },
  "reminder.write": async (_manifest, context) => {
    return runReminderWriteCommand(context.config, context.leafArgs);
  },
  "diary.write": async (_manifest, context) => {
    return runDiaryWriteCommand(context.config, context.leafArgs);
  },
  "system.send": async (_manifest, context) => {
    return runSystemSendCommand(context.config, context.leafArgs);
  },
  "system.checkin-config": async (_manifest, context) => {
    return runSystemCheckinConfigCommand(context.config, context.leafArgs);
  },
  "system.checkin-complete": async (_manifest, context) => {
    return runSystemCheckinCompleteCommand(context.config, context.leafArgs);
  },
  "system.checkin-tick": async (_manifest, context) => {
    return runSystemCheckinTickCommand(context.config, context.leafArgs);
  },
  "system.checkin-trigger": async (_manifest, context) => {
    return runSystemCheckinTriggerCommand(context.config, context.leafArgs);
  },
  "system.checkin-poller": async (_manifest, context) => {
    await runSystemCheckinPoller(context.config);
  },
  "timeline.event": async (_manifest, context) => {
    return runTimelineEventCommand(context.config, context.leafArgs);
  },
  "timeline.screenshot": async (_manifest, context) => {
    return runTimelineScreenshotCommand(context.config, context.leafArgs, context.getApp() as ChannelSendFileApp);
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

function assertTerminalCommandSupportedForCurrentHost(
  manifest: TerminalCommandManifestEntry,
  context: TerminalCommandContext,
): void {
  if (!manifest.hostProfileIds.length) {
    return;
  }
  const hostMode = resolveHostMode(context.config);
  const currentProfile = hostMode.profile === "unsupported" ? "" : hostMode.profile;
  if (currentProfile && manifest.hostProfileIds.includes(currentProfile)) {
    return;
  }
  throw buildUnsupportedHostCapabilityError(
    buildUnsupportedHostCapabilityMessage(manifest, hostMode.profile),
    {
      action: manifest.action,
      currentHostProfile: hostMode.profile,
      hostDependencies: [...manifest.hostDependencies],
      hostSupportTier: manifest.hostSupportTier,
      supportedHostProfiles: [...manifest.hostProfileIds],
    },
    formatHostSupportTierHint(manifest.hostSupportTier),
  );
}

function buildUnsupportedHostCapabilityMessage(
  manifest: TerminalCommandManifestEntry,
  currentProfile: string,
): string {
  const usage = manifest.entrypointType === "cli"
    ? ["codeksei", manifest.command, manifest.subcommand].filter(Boolean).join(" ")
    : (manifest.scriptName ? `npm run ${manifest.scriptName}` : manifest.action);
  const dependencyText = manifest.hostDependencies.length
    ? manifest.hostDependencies.join(", ")
    : "none";
  return [
    `${usage || manifest.action} 在当前宿主下不可用。`,
    `hostSupportTier: ${manifest.hostSupportTier}`,
    `currentProfile: ${currentProfile}`,
    `supportedProfiles: ${manifest.hostProfileIds.join(", ") || "(none)"}`,
    `hostDependencies: ${dependencyText}`,
  ].join("\n");
}
