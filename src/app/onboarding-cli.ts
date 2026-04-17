import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import { runCliMutation } from "../core/cli-mutation";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { normalizeText } from "../core/text-normalization";
import {
  getOnboardingStatus,
  resetOnboardingState,
  startOnboardingConversation,
  stepOnboardingConversation,
  type OnboardingRuntimeConfig,
} from "../onboarding/flow";

interface OnboardingStartOptions {
  dryRun: boolean;
  help: boolean;
  idempotencyKey: string;
  user: string;
}

interface OnboardingStatusOptions {
  help: boolean;
  user: string;
}

interface OnboardingResetOptions {
  dryRun: boolean;
  help: boolean;
  idempotencyKey: string;
  user: string;
}

interface OnboardingStepOptions {
  dryRun: boolean;
  help: boolean;
  idempotencyKey: string;
  session: string;
  text: string;
  useStdin: boolean;
  user: string;
}

type OnboardingCliConfig = OnboardingRuntimeConfig;

export async function runOnboardingStartCommand(
  config: OnboardingCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<OnboardingStartOptions>(args, getCommandArgsSchema("onboardingStart"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("onboarding.start"),
    };
  }
  const userId = requireUserId(options.user);
  return runCliMutation<Record<string, unknown>>({
    commandKey: "onboarding.start",
    config,
    configSource: {
      stateDir: normalizeText(config.stateDir),
      workspaceRoot: normalizeText(config.workspaceRoot),
    },
    dryRun: options.dryRun,
    dryRunResult: {
      data: {
        state: getOnboardingStatus(config, userId),
        userId,
      },
      text: [
        "onboarding start dry-run",
        `user: ${userId}`,
      ].join("\n"),
    },
    execute: async () => {
      const result = startOnboardingConversation(config, userId);
      return {
        data: {
          assistantMessage: result.assistantMessage,
          noteFiles: result.noteFiles,
          state: result.state,
          userId,
          writes: result.writes,
        },
        text: result.assistantMessage,
      };
    },
    idempotencyKey: normalizeText(options.idempotencyKey),
    request: {
      userId,
    },
    resolvedTargets: {
      stateFile: normalizeText(config.stateDir),
      userId,
    },
    sideEffects: [
      {
        kind: "write_onboarding_state",
        target: `${normalizeText(config.stateDir)}/onboarding/<user>.json`,
      },
    ],
  });
}

export async function runOnboardingStepCommand(
  config: OnboardingCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<OnboardingStepOptions>(args, getCommandArgsSchema("onboardingStep"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("onboarding.step"),
    };
  }
  const userId = requireUserId(options.user);
  const text = await resolveBody(options.text, options.useStdin);
  if (!text) {
    throw new Error("onboarding step 需要输入用户最新回复，传 --text 或 --stdin。");
  }
  return runCliMutation<Record<string, unknown>>({
    commandKey: "onboarding.step",
    config,
    configSource: {
      stateDir: normalizeText(config.stateDir),
      workspaceRoot: normalizeText(config.workspaceRoot),
    },
    dryRun: options.dryRun,
    dryRunResult: {
      data: {
        sessionId: normalizeText(options.session),
        text,
        userId,
      },
      text: [
        "onboarding step dry-run",
        `user: ${userId}`,
        `session: ${normalizeText(options.session)}`,
      ].join("\n"),
    },
    execute: async () => {
      const result = await stepOnboardingConversation(config, {
        sessionId: options.session,
        text,
        userId,
      });
      return {
        data: {
          assistantMessage: result.assistantMessage,
          noteFiles: result.noteFiles,
          state: result.state,
          userId,
          writes: result.writes,
        },
        text: result.assistantMessage,
      };
    },
    idempotencyKey: normalizeText(options.idempotencyKey),
    request: {
      sessionId: normalizeText(options.session),
      text,
      userId,
    },
    resolvedTargets: {
      companionScope: "companion",
      userId,
    },
    sideEffects: [
      {
        kind: "write_onboarding_state",
        target: `${normalizeText(config.stateDir)}/onboarding/<user>.json`,
      },
      {
        kind: "write_note",
        target: "companion scope",
      },
    ],
  });
}

export async function runOnboardingStatusCommand(
  config: OnboardingCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<OnboardingStatusOptions>(args, getCommandArgsSchema("onboardingStatus"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("onboarding.status"),
    };
  }
  const userId = requireUserId(options.user);
  const state = getOnboardingStatus(config, userId);
  return {
    data: {
      state,
      userId,
    },
    text: renderOnboardingState(state, userId),
  };
}

export async function runOnboardingResetCommand(
  config: OnboardingCliConfig,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseCliArgs<OnboardingResetOptions>(args, getCommandArgsSchema("onboardingReset"));
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("onboarding.reset"),
    };
  }
  const userId = requireUserId(options.user);
  return runCliMutation<Record<string, unknown>>({
    commandKey: "onboarding.reset",
    config,
    configSource: {
      stateDir: normalizeText(config.stateDir),
    },
    dryRun: options.dryRun,
    dryRunResult: {
      data: {
        userId,
      },
      text: [
        "onboarding reset dry-run",
        `user: ${userId}`,
      ].join("\n"),
    },
    execute: async () => {
      const state = resetOnboardingState(config, userId);
      return {
        data: {
          state,
          userId,
        },
        text: "onboarding 已重置；长期 companion note 不会被清空。",
      };
    },
    idempotencyKey: normalizeText(options.idempotencyKey),
    request: {
      userId,
    },
    resolvedTargets: {
      stateFile: `${normalizeText(config.stateDir)}/onboarding/<user>.json`,
      userId,
    },
    sideEffects: [
      {
        kind: "write_onboarding_state",
        target: `${normalizeText(config.stateDir)}/onboarding/<user>.json`,
      },
    ],
  });
}

async function resolveBody(text: string, useStdin: boolean): Promise<string> {
  const inline = normalizeText(text);
  if (inline) {
    return inline;
  }
  if (!useStdin && process.stdin.isTTY) {
    return "";
  }
  return readStdin();
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer.trim()));
    process.stdin.on("error", reject);
  });
}

function requireUserId(userId: string): string {
  const normalized = normalizeText(userId);
  if (!normalized) {
    throw new Error("缺少 --user <id>。");
  }
  return normalized;
}

function renderOnboardingState(state: {
  missingSlots: string[];
  sessionId: string;
  status: string;
  turnCount: number;
  updatedAt: string;
}, userId: string): string {
  return [
    `user: ${userId}`,
    `status: ${state.status}`,
    `session: ${state.sessionId || "(none)"}`,
    `missing: ${state.missingSlots.join(", ") || "(none)"}`,
    `turnCount: ${state.turnCount}`,
    `updatedAt: ${state.updatedAt || "(none)"}`,
  ].join("\n");
}
