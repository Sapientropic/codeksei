import * as crypto from "node:crypto";

import { SessionStore } from "../adapters/runtime/codex/session-store";
import { getCommandArgsSchema } from "../contracts/command-args";
import {
  LEGACY_TIMELINE_TIMEZONE,
  coerceLocalDateTimeToIso,
} from "../core/timezone";
import { resolvePreferredSenderId } from "../workspace/default-targets";
import * as accountStoreModule from "../adapters/channel/weixin/account-store";
import * as contextTokenStoreModule from "../adapters/channel/weixin/context-token-store";
import * as cliArgsModule from "../core/cli-args";
import * as reminderQueueStoreModule from "../state/reminder-queue-store";

const DELAY_UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
};

interface ReminderWriteOptions extends Record<string, unknown> {
  delay?: unknown;
  at?: unknown;
  text?: unknown;
  user?: unknown;
  useStdin?: boolean;
}

const { resolveSelectedAccount } = accountStoreModule as {
  resolveSelectedAccount(config: Record<string, unknown>): { accountId: string };
};

const { loadPersistedContextTokens } = contextTokenStoreModule as {
  loadPersistedContextTokens(config: Record<string, unknown>, accountId: string): Record<string, string>;
};

const { parseCliArgs } = cliArgsModule as {
  parseCliArgs(args: string[], schema: unknown): ReminderWriteOptions;
};

const { ReminderQueueStore } = reminderQueueStoreModule as {
  ReminderQueueStore: new (args: { filePath: string }) => {
    enqueue(reminder: Record<string, unknown>): { id: string };
  };
};

async function runReminderWriteCommand(config: any, args: any[] = []) {
  const options = parseArgs(args);
  const body = await resolveBody(options);
  if (!body) {
    throw new Error("提醒内容不能为空，传 --text 或通过 stdin 输入");
  }

  const timezone = config?.timezone || LEGACY_TIMELINE_TIMEZONE;
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
    explicitUser: typeof options.user === "string" ? options.user : "",
    sessionStore,
  });
  if (!senderId) {
    throw new Error("无法确定 reminder 的微信用户，传 --user 或先让唯一活跃用户和 bot 聊过一次");
  }

  const contextTokens = loadPersistedContextTokens(config, account.accountId);
  const contextToken = String(contextTokens[senderId] || "").trim();
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

function parseArgs(args: string[]): ReminderWriteOptions {
  return parseCliArgs(args, getCommandArgsSchema("reminderWrite"));
}

function resolveDueAtMs(options: any, timezone: any = LEGACY_TIMELINE_TIMEZONE) {
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

function parseDelay(rawValue: any) {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!normalized) {
    return 0;
  }

  let totalMs = 0;
  let index = 0;
  while (index < normalized.length) {
    while (index < normalized.length && /\s/.test(normalized[index])) {
      index += 1;
    }
    if (index >= normalized.length) {
      break;
    }

    const match = normalized.slice(index).match(/^(\d+)\s*([smhd])/);
    if (!match) {
      return 0;
    }

    const amount = Number.parseInt(match[1], 10);
    const unitMs = DELAY_UNIT_MS[match[2] as keyof typeof DELAY_UNIT_MS] || 0;
    if (!Number.isFinite(amount) || amount <= 0 || !unitMs) {
      return 0;
    }

    totalMs += amount * unitMs;
    index += match[0].length;
  }

  return totalMs > 0 ? totalMs : 0;
}

function parseAbsoluteTime(rawValue: any, timezone: any = LEGACY_TIMELINE_TIMEZONE) {
  const normalized = String(rawValue || "").trim();
  if (!normalized) {
    return 0;
  }

  const normalizedIso = normalizeAbsoluteTimeString(normalized, timezone);
  const parsed = Date.parse(normalizedIso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAbsoluteTimeString(value: any, timezone: any = LEGACY_TIMELINE_TIMEZONE) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return coerceLocalDateTimeToIso(normalized, {
    timeZone: timezone,
    defaultTime: "09:00:00",
  }) || normalized;
}

async function resolveBody(options: any) {
  const inlineText = normalizeBody(options.text);
  if (inlineText) {
    return inlineText;
  }
  if (!options.useStdin && process.stdin.isTTY) {
    return "";
  }
  return normalizeBody(await readStdin());
}

function readStdin() {
  return new Promise((resolve: any, reject: any) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: any) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", reject);
  });
}

function normalizeBody(value: any) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function buildAbsoluteTimeExample(timezone: any = LEGACY_TIMELINE_TIMEZONE) {
  const explicit = normalizeAbsoluteTimeString("2026-04-07 21:30", timezone);
  return `${explicit || "2026-04-07T21:30+08:00"} 或 2026-04-07 21:30（后者按当前 timezone 解释）`;
}

export {
  buildAbsoluteTimeExample,
  normalizeAbsoluteTimeString,
  parseAbsoluteTime,
  resolveDueAtMs,
  runReminderWriteCommand,
};
