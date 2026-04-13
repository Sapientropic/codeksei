import { normalizeText } from "../core/text-normalization";
import * as crypto from "node:crypto";

import { SessionStore } from "../adapters/runtime/codex/session-store";
import { resolvePromptPersonEn } from "../core/person-reference";
import type { AppRuntimeConfig } from "../core/app-service-contract";
import { resolvePreferredSenderId, resolvePreferredWorkspaceRoot } from "../workspace/default-targets";
import { resolveSelectedAccount } from "../adapters/channel/weixin/account-store";
import { PACKAGE_NAME, readPrefixedEnv } from "../core/branding";
import { SystemMessageQueueStore } from "../state/system-message-queue-store";
import { formatCheckinRange, resolveCheckinConfig } from "../state/checkin-config";
const INTERNAL_CHECKIN_TRIGGER_TEMPLATE = "Take a quiet look at whether now is a good moment to reach out to %PERSON%. You may stay silent, send one short WeChat message, update diary/timeline, or take another useful backstage action. If no user-visible message should be sent, output exactly SILENT. If you do send a message, output only the message text.";

type CheckinPollerConfig = AppRuntimeConfig;
type SelectedAccount = ReturnType<typeof resolveSelectedAccount>;
type PollerIntervalConfig = ReturnType<typeof resolveCheckinConfig>;

async function runSystemCheckinPoller(config: CheckinPollerConfig) {
  const account = resolveSelectedAccount(config);
  const queue = new SystemMessageQueueStore({
    filePath: normalizeText(config.systemMessageQueueFile),
    deadLetterFilePath: normalizeText(config.systemMessageDeadLetterFile),
  });
  const sessionStore = new SessionStore({ filePath: normalizeText(config.sessionsFile) });
  const target = resolvePollerTarget({ config, account, sessionStore });
  let lastRangeLabel = "";

  console.log(`[${PACKAGE_NAME}] checkin poller ready user=${target.senderId} workspace=${target.workspaceRoot}`);

  while (true) {
    const intervalConfig = resolvePollerIntervalConfig(config);
    const rangeLabel = `${formatCheckinRange(intervalConfig)} source=${intervalConfig.source}`;
    if (rangeLabel !== lastRangeLabel) {
      console.log(`[${PACKAGE_NAME}] checkin interval range ${rangeLabel}`);
      lastRangeLabel = rangeLabel;
    }
    const minIntervalMs = intervalConfig.minIntervalMs;
    const maxIntervalMs = intervalConfig.maxIntervalMs;
    const delayMs = pickRandomDelayMs(minIntervalMs, maxIntervalMs);
    const wakeAt = new Date(Date.now() + delayMs).toISOString();
    console.log(`[${PACKAGE_NAME}] next checkin in ${Math.round(delayMs / 60000)}m at ${wakeAt}`);
    await sleep(delayMs);

    if (queue.hasPendingForAccount(account.accountId)) {
      console.log(`[${PACKAGE_NAME}] checkin skipped: pending system message still in queue`);
      continue;
    }

    const queued = queue.enqueue({
      id: crypto.randomUUID(),
      accountId: account.accountId,
      senderId: target.senderId,
      workspaceRoot: target.workspaceRoot,
      text: buildCheckinTrigger(config),
      kind: "checkin",
      createdAt: new Date().toISOString(),
    });
    console.log(`[${PACKAGE_NAME}] checkin queued id=${queued.id}`);
  }
}

function resolvePollerTarget({
  config,
  account,
  sessionStore,
}: {
  config: CheckinPollerConfig;
  account: SelectedAccount;
  sessionStore: SessionStore;
}) {
  const senderId = resolvePreferredSenderId({
    config,
    accountId: account.accountId,
    explicitUser: readPrefixedEnv(process.env, "CHECKIN_USER_ID") || "",
    sessionStore,
  });
  const workspaceRoot = resolvePreferredWorkspaceRoot({
    config,
    accountId: account.accountId,
    senderId,
    explicitWorkspace: readPrefixedEnv(process.env, "CHECKIN_WORKSPACE") || "",
    sessionStore,
  });

  if (!senderId) {
    throw new Error("无法确定 checkin poller 的微信用户，先配置 CODEKSEI_CHECKIN_USER_ID，或让唯一活跃用户先和 bot 聊过一次");
  }
  if (!workspaceRoot) {
    throw new Error("无法确定 checkin poller 的 workspace，先设置 CODEKSEI_WORKSPACE_ROOT");
  }

  return { senderId, workspaceRoot };
}

function resolvePollerIntervalConfig(config: CheckinPollerConfig): PollerIntervalConfig {
  const filePath = normalizeText(config.checkinConfigFile);
  if (filePath) {
    return resolveCheckinConfig({ filePath });
  }
  const envMin = Number.parseInt(String(readPrefixedEnv(process.env, "CHECKIN_MIN_INTERVAL_MS") || ""), 10);
  const envMax = Number.parseInt(String(readPrefixedEnv(process.env, "CHECKIN_MAX_INTERVAL_MS") || ""), 10);
  const minIntervalMs = Number.isFinite(envMin) && envMin > 0 ? envMin : 3 * 60_000;
  const maxIntervalMs = Math.max(minIntervalMs, Number.isFinite(envMax) && envMax > 0 ? envMax : 60 * 60_000);
  return {
    minIntervalMs,
    maxIntervalMs,
    source: envMin || envMax ? "env" : "default",
    storedConfig: null,
  };
}

function pickRandomDelayMs(minIntervalMs: number, maxIntervalMs: number): number {
  if (maxIntervalMs <= minIntervalMs) {
    return minIntervalMs;
  }
  return minIntervalMs + Math.floor(Math.random() * (maxIntervalMs - minIntervalMs + 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildCheckinTrigger(config: CheckinPollerConfig): string {
  const person = resolvePromptPersonEn(config);
  return INTERNAL_CHECKIN_TRIGGER_TEMPLATE.replace("%PERSON%", person);
}

export { runSystemCheckinPoller };

