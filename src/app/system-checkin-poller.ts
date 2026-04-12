import * as crypto from "node:crypto";

import { SessionStore } from "../adapters/runtime/codex/session-store";
import { resolvePromptPersonEn } from "../core/person-reference";
import { resolvePreferredSenderId, resolvePreferredWorkspaceRoot } from "../workspace/default-targets";
import * as accountStoreModule from "../adapters/channel/weixin/account-store";
import * as brandingModule from "../core/branding";
import * as systemMessageQueueStoreModule from "../state/system-message-queue-store";

const DEFAULT_MIN_INTERVAL_MS = 3 * 60_000;
const DEFAULT_MAX_INTERVAL_MS = 60 * 60_000;
const INTERNAL_CHECKIN_TRIGGER_TEMPLATE = "Take a quiet look at whether now is a good moment to reach out to %PERSON%. You may stay silent, send one short WeChat message, update diary/timeline, or take another useful backstage action. If no user-visible message should be sent, output exactly SILENT. If you do send a message, output only the message text.";

const { resolveSelectedAccount } = accountStoreModule as {
  resolveSelectedAccount(config: Record<string, unknown>): { accountId: string };
};

const { PACKAGE_NAME, readPrefixedEnv } = brandingModule as {
  PACKAGE_NAME: string;
  readPrefixedEnv(env: NodeJS.ProcessEnv, suffix: string): string;
};

const { SystemMessageQueueStore } = systemMessageQueueStoreModule as {
  SystemMessageQueueStore: new (args: { filePath: string; deadLetterFilePath?: string }) => {
    hasPendingForAccount(accountId: string): boolean;
    enqueue(message: Record<string, unknown>): { id: string };
  };
};

async function runSystemCheckinPoller(config: any) {
  const account = resolveSelectedAccount(config);
  const queue = new SystemMessageQueueStore({
    filePath: config.systemMessageQueueFile,
    deadLetterFilePath: config.systemMessageDeadLetterFile,
  });
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  const target = resolvePollerTarget({ config, account, sessionStore });
  const minIntervalMs = readIntervalMs(readPrefixedEnv(process.env, "CHECKIN_MIN_INTERVAL_MS"), DEFAULT_MIN_INTERVAL_MS);
  const maxIntervalMs = Math.max(
    minIntervalMs,
    readIntervalMs(readPrefixedEnv(process.env, "CHECKIN_MAX_INTERVAL_MS"), DEFAULT_MAX_INTERVAL_MS)
  );

  console.log(`[${PACKAGE_NAME}] checkin poller ready user=${target.senderId} workspace=${target.workspaceRoot}`);
  console.log(`[${PACKAGE_NAME}] checkin interval range ${Math.round(minIntervalMs / 60000)}m-${Math.round(maxIntervalMs / 60000)}m`);

  while (true) {
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

function resolvePollerTarget({ config, account, sessionStore }: any) {
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

function readIntervalMs(rawValue: any, fallback: any) {
  const parsed = Number.parseInt(String(rawValue || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pickRandomDelayMs(minIntervalMs: any, maxIntervalMs: any) {
  if (maxIntervalMs <= minIntervalMs) {
    return minIntervalMs;
  }
  return minIntervalMs + Math.floor(Math.random() * (maxIntervalMs - minIntervalMs + 1));
}

function sleep(ms: any) {
  return new Promise((resolve: any) => setTimeout(resolve, ms));
}

function buildCheckinTrigger(config: any) {
  const person = resolvePromptPersonEn(config);
  return INTERNAL_CHECKIN_TRIGGER_TEMPLATE.replace("%PERSON%", person);
}

export { runSystemCheckinPoller };
