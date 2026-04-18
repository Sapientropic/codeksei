import { normalizeText } from "../core/text-normalization";
import * as crypto from "node:crypto";
import * as path from "node:path";

import {
  resolveSelectedAccount,
  type WeixinAccountConfig,
} from "../adapters/channel/weixin/account-store";
import { loadPersistedContextTokens } from "../adapters/channel/weixin/context-token-store";
import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { parseCliArgs } from "../core/cli-args";
import {
  buildAuthRequiredError,
  buildTargetResolutionRequiredError,
} from "../core/cli-contract";
import { runCliMutation } from "../core/cli-mutation";
import {
  createReminderViaHermesRepoLocal,
  resolveHermesHomePath,
} from "../core/hermes-repo-local";
import { resolveHostMode } from "../core/host-mode";
import {
  LEGACY_TIMELINE_TIMEZONE,
  coerceLocalDateTimeToIso,
} from "../core/timezone";
import { parseCompactDurationMs } from "../core/duration";
import { ReminderQueueStore } from "../state/reminder-queue-store";
import { inspectPreferredSenderId } from "../workspace/default-targets";
import { createSessionStore } from "../session/session-store-factory";

export interface ReminderWriteConfig extends WeixinAccountConfig, Pick<
  AppRuntimeConfig,
  | "hermesHome"
  | "hermesPythonCommand"
  | "hermesRepoLocalShimPath"
  | "hermesRepoRoot"
  | "checkinConfigFile"
  | "checkinScheduleStateFile"
  | "reminderQueueFile"
  | "sessionsFile"
> {
  accountId?: string;
  cliIdempotencyLedgerFile?: string;
  allowedUserIds?: unknown;
  timezone?: unknown;
  workspaceRoot?: unknown;
  channel?: unknown;
  channelProvider?: unknown;
  runtime?: unknown;
}

interface ReminderWriteOptions extends Record<string, unknown> {
  dryRun?: boolean;
  help?: boolean;
  idempotencyKey?: string;
  delay?: unknown;
  at?: unknown;
  text?: unknown;
  user?: unknown;
  useStdin?: boolean;
}

interface HostedReminderWriteDryRunData {
  deliveryMode: "hermes_repo_local_origin";
  dueAtIso: string;
  dueAtMs: number;
  senderId: string;
  text: string;
  workspaceRoot: string;
}

interface HostedReminderWriteDirectResultData {
  chatId: string;
  deliveryMode: "hermes_repo_local_origin";
  dueAtMs: number;
  jobId: string;
  name: string;
  nextRunAt: string;
  platform: string;
  text: string;
  threadId: string;
}

interface BridgeReminderWriteDryRunData {
  dueAtMs: number;
  deliveryMode: "bridge_local_queue";
  senderId: string;
  text: string;
}

interface BridgeReminderWriteResultData {
  deliveryMode: "bridge_local_queue";
  dueAtMs: number;
  id: string;
  senderId: string;
  text: string;
}

async function runReminderWriteCommand(
  config: ReminderWriteConfig,
  args: readonly string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseArgs(args);
  if (options.help) {
    return {
      data: null,
      text: buildReminderWriteHelp(timezoneLabel(config.timezone)),
    };
  }
  const body = await resolveBody(options);
  if (!body) {
    throw new Error("提醒内容不能为空，传 --text 或通过 stdin 输入");
  }

  const timezone = normalizeTimezone(config.timezone);
  const dueAtMs = resolveDueAtMs(options, timezone);
  if (!Number.isFinite(dueAtMs) || dueAtMs <= Date.now()) {
    throw new Error(
      `缺少有效时间，使用 --delay 30s|10m|1h30m|2d4h20m 或 --at ${buildAbsoluteTimeExample(timezone)}`
    );
  }
  const hostMode = resolveHostMode(config);
  if (hostMode.mode === "hosted") {
    const dueAtIso = new Date(dueAtMs).toISOString();
    const workspaceRoot = normalizeText(config.workspaceRoot) || process.cwd();
    const jobsFile = path.join(resolveHermesHomePath(config), "cron", "jobs.json");
    return runCliMutation<
      HostedReminderWriteDryRunData | HostedReminderWriteDirectResultData
    >({
      commandKey: "reminder.write",
      config,
      configSource: {
        hermesHome: resolveHermesHomePath(config),
        timezone,
        workspaceRoot,
      },
      dryRun: Boolean(options.dryRun),
      dryRunResult: {
        data: {
          deliveryMode: "hermes_repo_local_origin",
          dueAtIso,
          dueAtMs,
          senderId: normalizeText(options.user) || "",
          text: body,
          workspaceRoot,
        },
        text: [
          "reminder dry-run",
          "delivery: hermes_repo_local_origin",
          `dueAt: ${dueAtIso}`,
          `workspace: ${workspaceRoot}`,
        ].join("\n"),
      },
      execute: async () => {
        const reminder = createReminderViaHermesRepoLocal(config, {
          due_at_iso: dueAtIso,
          sender_id: normalizeText(options.user),
          text: body,
          workspace_root: workspaceRoot,
        });
        return {
          data: {
            chatId: reminder.chatId,
            deliveryMode: "hermes_repo_local_origin",
            dueAtMs,
            jobId: reminder.jobId,
            name: reminder.name,
            nextRunAt: reminder.nextRunAt,
            platform: reminder.platform,
            text: body,
            threadId: reminder.threadId,
          },
          text: `reminder scheduled via Hermes cron: ${reminder.jobId}`,
        };
      },
      idempotencyKey: normalizeText(options.idempotencyKey),
      request: {
        at: options.at,
        delay: options.delay,
        deliveryMode: "hermes_repo_local_origin",
        dueAtIso,
        senderId: normalizeText(options.user),
        text: body,
        workspaceRoot,
      },
      resolvedTargets: {
        deliver: "origin",
        jobsFile,
        senderId: normalizeText(options.user) || "(active-session)",
        workspaceRoot,
      },
      sideEffects: [
        {
          kind: "create_hermes_cron_job",
          target: jobsFile,
        },
      ],
    });
  }

  const account = resolveSelectedAccount(config);
  const sessionStore = createSessionStore(config.sessionsFile);
  const senderResolution = inspectPreferredSenderId({
    config,
    accountId: account.accountId,
    explicitUser: normalizeText(options.user),
    sessionStore,
  });
  if (!senderResolution.value) {
    throw buildTargetResolutionRequiredError(
      senderResolution.ambiguous
        ? "reminder write 无法确定唯一 sender；请显式传 --user"
        : "reminder write 缺少可用 sender；请显式传 --user 或先完成 bootstrap",
      { candidates: senderResolution.candidates, source: senderResolution.source },
      "显式传 --user，或让唯一目标用户先和 bot 聊过一次。"
    );
  }
  const senderId = senderResolution.value;

  const contextTokens = loadPersistedContextTokens(config, account.accountId);
  const contextToken = normalizeText(contextTokens[senderId]);
  if (!contextToken) {
    throw buildAuthRequiredError(
      `找不到 ${senderId} 的 context_token，先让这个用户和 bot 聊过一次`,
      "让目标用户先和 bot 聊过一次，或检查当前账号的 context token 持久化状态。"
    );
  }

  return runCliMutation<
    BridgeReminderWriteDryRunData | BridgeReminderWriteResultData
  >({
    commandKey: "reminder.write",
    config,
    configSource: {
      reminderQueueFile: config.reminderQueueFile,
      sessionsFile: config.sessionsFile,
      timezone,
    },
    dryRun: Boolean(options.dryRun),
    dryRunResult: {
      data: {
        dueAtMs,
        deliveryMode: "bridge_local_queue",
        senderId,
        text: body,
      },
      text: [
        "reminder dry-run",
        `sender: ${senderId}`,
        `dueAt: ${new Date(dueAtMs).toISOString()}`,
      ].join("\n"),
    },
    execute: async () => {
      const queue = new ReminderQueueStore({ filePath: config.reminderQueueFile });
      const reminder = queue.enqueue({
        id: crypto.randomUUID(),
        accountId: account.accountId,
        senderId,
        contextToken,
        text: body,
        dueAtMs,
        createdAt: new Date().toISOString(),
      });
      return {
        data: {
          deliveryMode: "bridge_local_queue",
          dueAtMs: reminder.dueAtMs,
          id: reminder.id,
          senderId: reminder.senderId,
          text: reminder.text,
        },
        text: `reminder queued: ${reminder.id}`,
      };
    },
    idempotencyKey: normalizeText(options.idempotencyKey),
    request: {
      at: options.at,
      delay: options.delay,
      senderId,
      text: body,
    },
    resolvedTargets: {
      senderId,
      senderSource: senderResolution.source,
    },
    sideEffects: [
      {
        kind: "enqueue_reminder",
        target: config.reminderQueueFile,
      },
    ],
  });
}

function parseArgs(args: readonly string[]): ReminderWriteOptions {
  return parseCliArgs<ReminderWriteOptions>(args, getCommandArgsSchema("reminderWrite"));
}

function resolveDueAtMs(
  options: ReminderWriteOptions,
  timezone: string = LEGACY_TIMELINE_TIMEZONE,
): number {
  const delayMs = parseDelay(options.delay);
  const scheduledAtMs = parseAbsoluteTime(options.at, timezone);
  if (delayMs && scheduledAtMs) {
    throw new Error("--delay 和 --at 不能同时传");
  }
  if (delayMs) {
    return Date.now() + delayMs;
  }
  if (scheduledAtMs) {
    return scheduledAtMs;
  }
  return 0;
}

function parseDelay(rawValue: unknown): number {
  return parseCompactDurationMs(rawValue);
}

function parseAbsoluteTime(rawValue: unknown, timezone: string = LEGACY_TIMELINE_TIMEZONE): number {
  const normalized = normalizeText(rawValue);
  if (!normalized) {
    return 0;
  }

  const normalizedIso = normalizeAbsoluteTimeString(normalized, timezone);
  const parsed = Date.parse(normalizedIso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAbsoluteTimeString(value: unknown, timezone: string = LEGACY_TIMELINE_TIMEZONE): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  return coerceLocalDateTimeToIso(normalized, {
    timeZone: timezone,
    defaultTime: "09:00:00",
  }) || normalized;
}

async function resolveBody(options: ReminderWriteOptions): Promise<string> {
  const inlineText = normalizeBody(options.text);
  if (inlineText) {
    return inlineText;
  }
  if (!options.useStdin && process.stdin.isTTY) {
    return "";
  }
  return normalizeBody(await readStdin());
}

function readStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", reject);
  });
}

function normalizeBody(value: unknown): string {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function buildAbsoluteTimeExample(timezone: string = LEGACY_TIMELINE_TIMEZONE): string {
  const explicit = normalizeAbsoluteTimeString("2026-04-07 21:30", timezone);
  return `${explicit || "2026-04-07T21:30+08:00"} 或 2026-04-07 21:30（后者按当前 timezone 解释）`;
}

function normalizeTimezone(value: unknown): string {
  return normalizeText(value) || LEGACY_TIMELINE_TIMEZONE;
}

function buildReminderWriteHelp(timezone: string): string {
  return [
    "用法: codeksei reminder write --delay 30m --text \"提醒内容\"",
    "  或: codeksei reminder write --at 2026-04-07 21:30 --text \"提醒内容\"",
    "",
    "说明：",
    "  这条命令只负责创建提醒，不再兼做 proactive 调度入口。",
    "  Hosted Mode 下会通过当前 Hermes session 把提醒绑定回 origin chat。",
    `  不带 offset 的本地时间按 ${timezone} 解释。`,
    "  默认会解析唯一稳定 sender；若不唯一会直接返回 target_resolution_required。",
  ].join("\n");
}

function timezoneLabel(value: unknown): string {
  return normalizeTimezone(value);
}

export {
  buildAbsoluteTimeExample,
  normalizeAbsoluteTimeString,
  normalizeBody,
  parseAbsoluteTime,
  parseDelay,
  resolveDueAtMs,
  runReminderWriteCommand,
};

