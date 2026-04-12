// @ts-check

const {
  LEGACY_TIMELINE_TIMEZONE,
  formatDateTimeInTimezone,
}: {
  LEGACY_TIMELINE_TIMEZONE: string;
  formatDateTimeInTimezone(date: Date, timezone?: unknown): string;
} = require("./timezone");
const {
  resolveConfiguredPersonName,
  resolvePromptPersonEn,
}: {
  resolveConfiguredPersonName(config?: Record<string, unknown>): string;
  resolvePromptPersonEn(config?: Record<string, unknown>): string;
} = require("./person-reference");

const SYSTEM_MESSAGE_FAILURE_RETRY_DELAYS_MS = [30_000, 2 * 60_000, 5 * 60_000];

interface PersistedAttachmentResult {
  saved?: unknown[];
  failed?: Array<{ reason: string } & Record<string, unknown>>;
}

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
  return SYSTEM_MESSAGE_FAILURE_RETRY_DELAYS_MS[index];
}

export function buildReminderSystemTrigger(
  reminder: { text?: unknown } | null | undefined,
  config: Record<string, unknown> = {},
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

export function buildCodexInboundText(
  normalized: InboundMessageRef,
  persisted: PersistedAttachmentResult = {},
  config: Record<string, unknown> = {},
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
      const attachment = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const sourceFileName = typeof attachment.sourceFileName === "string" ? attachment.sourceFileName : "";
      const kind = typeof attachment.kind === "string" ? attachment.kind : "attachment";
      const absolutePath = typeof attachment.absolutePath === "string" ? attachment.absolutePath : "";
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
