// @ts-check

import {
  LEGACY_TIMELINE_TIMEZONE,
  formatDateTimeInTimezone,
} from "./timezone";
import {
  resolveConfiguredPersonName,
  resolvePromptPersonEn,
} from "./person-reference";
import type { AppRuntimeConfig } from "./app-service-contract";
import type {
  PersistIncomingWeixinAttachmentsResult,
  PersistedIncomingWeixinAttachment,
} from "../contracts/weixin-media";

const SYSTEM_MESSAGE_FAILURE_RETRY_DELAYS_MS = [30_000, 2 * 60_000, 5 * 60_000];

type PersistedAttachmentResult = Partial<PersistIncomingWeixinAttachmentsResult>;

interface InboundMessageRef {
  text?: unknown;
  receivedAt?: unknown;
}

type ShutdownStopHandler = () => Promise<unknown> | unknown;

export function createShutdownController(onStop: ShutdownStopHandler) {
  let stopped = false;
  let stoppingPromise: Promise<unknown> | null = null;

  const stop = async () => {
    if (stopped) {
      return stoppingPromise;
    }
    stopped = true;
    stoppingPromise = Promise.resolve().then(onStop);
    return stoppingPromise;
  };

  const handleSignal = () => {
    stop().finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  return {
    get stopped() {
      return stopped;
    },
    dispose() {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
    },
  };
}

export function getSystemMessageFailureRetryDelayMs(attemptCount: unknown): number {
  const index = Math.max(0, Math.min(SYSTEM_MESSAGE_FAILURE_RETRY_DELAYS_MS.length - 1, Number(attemptCount) - 1));
  return SYSTEM_MESSAGE_FAILURE_RETRY_DELAYS_MS[index] || SYSTEM_MESSAGE_FAILURE_RETRY_DELAYS_MS[0] || 30_000;
}

export function buildReminderSystemTrigger(
  reminder: { text?: unknown } | null | undefined,
  config: Pick<AppRuntimeConfig, "userName"> = { userName: "" },
): string {
  const reminderText = String(reminder?.text || "").trim();
  const person = resolvePromptPersonEn(config);
  return [
    "A scheduled reminder is due.",
    `Decide the most useful next move for ${person} right now.`,
    "If a message is best, send one short and natural WeChat message.",
    "Do not mention internal triggers.",
    "Do not mechanically repeat the reminder text.",
    `Reminder: ${reminderText}`,
  ].join("\n");
}

export function buildRuntimeInboundText(
  normalized: InboundMessageRef,
  persisted: PersistedAttachmentResult = {},
  config: Pick<AppRuntimeConfig, "timezone" | "userName"> = {
    timezone: LEGACY_TIMELINE_TIMEZONE,
    userName: "",
  },
): string {
  const text = String(normalized?.text || "").trim();
  const saved = Array.isArray(persisted?.saved) ? persisted.saved : [];
  const failed = Array.isArray(persisted?.failed) ? persisted.failed : [];
  const configuredName = resolveConfiguredPersonName(config);
  const person = resolvePromptPersonEn(config);
  const localTime = formatWechatLocalTime(normalized?.receivedAt, config.timezone);
  const lines = [];
  if (localTime) {
    lines.push(`[${localTime}]`);
  }
  if (text) {
    if (lines.length) {
      lines.push("");
    }
    lines.push(text);
  }

  if (saved.length) {
    if (lines.length) {
      lines.push("");
    }
    if (configuredName) {
      lines.push(`${configuredName} sent image/file attachments. They were saved under the local data directory:`);
    } else {
      lines.push("The person in this thread sent image/file attachments. They were saved under the local data directory:");
    }
    for (const item of saved) {
      const attachment = item as PersistedIncomingWeixinAttachment;
      const sourceFileName = attachment.sourceFileName || "";
      const kind = attachment.kind || "attachment";
      const absolutePath = attachment.absolutePath || "";
      const suffix = sourceFileName ? ` (original name: ${sourceFileName})` : "";
      lines.push(`- [${kind}] ${absolutePath}${suffix}`);
    }
    lines.push(`You must read these files before replying to ${person}. Do not skip the read step.`);
    lines.push(`If the required local tool is missing, tell ${person} exactly what is missing and that you cannot read the file yet. Do not pretend you already read it.`);
  }

  if (failed.length) {
    if (lines.length) {
      lines.push("");
    }
    lines.push("Attachment intake errors:");
    for (const item of failed) {
      const label = item.sourceFileName || item.kind || "attachment";
      lines.push(`- ${label}: ${item.reason}`);
    }
  }

  return lines.join("\n").trim();
}

function formatWechatLocalTime(receivedAt: unknown, timezone: unknown = LEGACY_TIMELINE_TIMEZONE): string {
  const value = typeof receivedAt === "string" ? receivedAt.trim() : "";
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return formatDateTimeInTimezone(parsed, timezone).replace("T", " ");
}

function stringifyRpcId(value: unknown): string {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

export function hasRpcId(value: unknown): boolean {
  return stringifyRpcId(value) !== "";
}

export function resolveTimelineScreenshotOutput(args: unknown): string {
  const normalizedArgs = Array.isArray(args) ? args : [];
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    if (String(normalizedArgs[index] || "").trim() !== "--output") {
      continue;
    }
    return String(normalizedArgs[index + 1] || "").trim();
  }
  return "";
}
