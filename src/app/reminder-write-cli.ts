import { normalizeText } from "../core/text-normalization";
import * as crypto from "node:crypto";

import { SessionStore } from "../adapters/runtime/codex/session-store";
import {
  resolveSelectedAccount,
  type WeixinAccountConfig,
} from "../adapters/channel/weixin/account-store";
import { loadPersistedContextTokens } from "../adapters/channel/weixin/context-token-store";
import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import {
  LEGACY_TIMELINE_TIMEZONE,
  coerceLocalDateTimeToIso,
} from "../core/timezone";
import { ReminderQueueStore } from "../state/reminder-queue-store";
import { resolvePreferredSenderId } from "../workspace/default-targets";

const DELAY_UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
} as const;

export interface ReminderWriteConfig extends WeixinAccountConfig {
  allowedUserIds?: unknown;
  reminderQueueFile: string;
  sessionsFile: string;
  timezone?: unknown;
}

interface ReminderWriteOptions extends Record<string, unknown> {
  delay?: unknown;
  at?: unknown;
  text?: unknown;
  user?: unknown;
  useStdin?: boolean;
}

async function runReminderWriteCommand(
  config: ReminderWriteConfig,
  args: readonly string[] = [],
): Promise<void> {
  const options = parseArgs(args);
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

  const account = resolveSelectedAccount(config);
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  const senderId = resolvePreferredSenderId({
    config,
    accountId: account.accountId,
    explicitUser: normalizeText(options.user),
    sessionStore,
  });
  if (!senderId) {
    throw new Error("无法确定 reminder 的微信用户，传 --user 或先让唯一活跃用户和 bot 聊过一次");
  }

  const contextTokens = loadPersistedContextTokens(config, account.accountId);
  const contextToken = normalizeText(contextTokens[senderId]);
  if (!contextToken) {
    throw new Error(`找不到 ${senderId} 的 context_token，先让这个用户和 bot 聊过一次`);
  }

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
  console.log(`reminder queued: ${reminder.id}`);
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
  const normalized = normalizeText(rawValue).toLowerCase();
  if (!normalized) {
    return 0;
  }

  let totalMs = 0;
  let index = 0;
  while (index < normalized.length) {
    while (index < normalized.length && /\s/.test(normalized[index] || "")) {
      index += 1;
    }
    if (index >= normalized.length) {
      break;
    }

    const match = normalized.slice(index).match(/^(\d+)\s*([smhd])/);
    if (!match) {
      return 0;
    }

    const amount = Number.parseInt(match[1] || "", 10);
    const unitKey = normalizeText(match[2]).toLowerCase() as keyof typeof DELAY_UNIT_MS;
    const unitMs = DELAY_UNIT_MS[unitKey] || 0;
    if (!Number.isFinite(amount) || amount <= 0 || !unitMs) {
      return 0;
    }

    totalMs += amount * unitMs;
    index += match[0].length;
  }

  return totalMs > 0 ? totalMs : 0;
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

export {
  buildAbsoluteTimeExample,
  normalizeAbsoluteTimeString,
  normalizeBody,
  parseAbsoluteTime,
  parseDelay,
  resolveDueAtMs,
  runReminderWriteCommand,
};

