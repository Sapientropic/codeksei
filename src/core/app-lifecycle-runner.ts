import { runSystemCheckinPoller } from "../app/system-checkin-poller";
import type {
  AppRuntimeConfig,
  ChannelAdapterLike,
  RuntimeAdapterLike,
  SystemMessageDispatcherLike,
  SystemMessageQueueLike,
  TimelineIntegrationLike,
} from "./app-service-contract";
import { formatErrorMessage, runAppPollLoop } from "./app-poll-loop";
import { createShutdownController } from "./app-runtime-helpers";
import { SystemMessageDispatcher } from "./system-message-dispatcher";

const RETRY_DELAY_MS = 2_000;
const BACKOFF_DELAY_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 3;

interface AppLifecycleRunnerArgs {
  config: AppRuntimeConfig;
  channelAdapter: Pick<
    ChannelAdapterLike,
    "describe" | "getKnownContextTokens" | "loadSyncBuffer" | "resolveAccount" | "getUpdates"
  >;
  runtimeAdapter: Pick<RuntimeAdapterLike, "close" | "describe" | "initialize">;
  timelineIntegration: Pick<TimelineIntegrationLike, "describe">;
  systemMessageQueue: SystemMessageQueueLike;
  setActiveAccountId(accountId: string): void;
  setSystemMessageDispatcher(dispatcher: SystemMessageDispatcherLike | null): void;
  updateBridgeHeartbeat(patch: Record<string, unknown>): void;
  restoreBoundThreadSubscriptions(): Promise<void>;
  resolveLongPollTimeoutMs(): number;
  handleIncomingMessage(message: unknown): Promise<void>;
  flushDueReminders(account: { accountId: string }): Promise<void>;
  flushPendingSystemMessages(): Promise<void>;
  flushPendingTimelineScreenshots(account: { accountId: string }): Promise<void>;
}

export async function runCodekseiAppLifecycle({
  config,
  channelAdapter,
  runtimeAdapter,
  timelineIntegration,
  systemMessageQueue,
  setActiveAccountId,
  setSystemMessageDispatcher,
  updateBridgeHeartbeat,
  restoreBoundThreadSubscriptions,
  resolveLongPollTimeoutMs,
  handleIncomingMessage,
  flushDueReminders,
  flushPendingSystemMessages,
  flushPendingTimelineScreenshots,
}: AppLifecycleRunnerArgs): Promise<void> {
  const account = channelAdapter.resolveAccount();
  setActiveAccountId(account.accountId);
  updateBridgeHeartbeat({
    pid: process.pid,
    status: "starting",
    accountId: account.accountId,
    workspaceRoot: config.workspaceRoot,
    startedAt: new Date().toISOString(),
    consecutiveFailures: 0,
    lastError: "",
  });

  const systemMessageDispatcher = new SystemMessageDispatcher({
    queueStore: systemMessageQueue,
    config,
    accountId: account.accountId,
  });
  setSystemMessageDispatcher(systemMessageDispatcher);

  const runtimeState = await runtimeAdapter.initialize();
  const knownContextTokens = Object.keys(channelAdapter.getKnownContextTokens()).length;
  const syncBuffer = channelAdapter.loadSyncBuffer();
  await restoreBoundThreadSubscriptions();
  updateBridgeHeartbeat({
    pid: process.pid,
    status: "running",
    accountId: account.accountId,
    workspaceRoot: config.workspaceRoot,
    codexEndpoint: runtimeState.endpoint,
    consecutiveFailures: 0,
    lastError: "",
  });

  console.log("[codeksei] bootstrap ok");
  console.log(`[codeksei] channel=${channelAdapter.describe().id}`);
  console.log(`[codeksei] runtime=${runtimeAdapter.describe().id}`);
  console.log(`[codeksei] timeline=${timelineIntegration.describe().id}`);
  console.log(`[codeksei] account=${account.accountId}`);
  console.log(`[codeksei] baseUrl=${account.baseUrl}`);
  console.log(`[codeksei] workspaceRoot=${config.workspaceRoot}`);
  console.log(`[codeksei] knownContextTokens=${knownContextTokens}`);
  console.log(`[codeksei] syncBuffer=${syncBuffer ? "ready" : "empty"}`);
  console.log(`[codeksei] weixinReplyMode=${String(config.weixinReplyMode || "")}`);
  console.log(`[codeksei] weixinDeliveryTrace=${config.weixinDeliveryTrace ? "on" : "off"}`);
  console.log(`[codeksei] codexEndpoint=${runtimeState.endpoint}`);
  console.log(`[codeksei] codexModels=${runtimeState.models.length}`);
  console.log("[codeksei] 最小消息链路已启动，正在等待微信消息。");
  if (config.startWithCheckin) {
    console.log("[codeksei] checkin: enabled");
    void runSystemCheckinPoller(config).catch((error) => {
      console.error(`[codeksei] checkin poller stopped: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  const shutdown = createShutdownController(async () => {
    await runtimeAdapter.close();
  });

  try {
    await runAppPollLoop({
      account,
      runtimeState: {
        endpoint: runtimeState.endpoint,
        workspaceRoot: config.workspaceRoot,
      },
      shutdown,
      channelAdapter,
      flushDueReminders,
      flushPendingSystemMessages,
      flushPendingTimelineScreenshots,
      resolveLongPollTimeoutMs,
      handleIncomingMessage,
      updateBridgeHeartbeat,
      retryDelayMs: RETRY_DELAY_MS,
      backoffDelayMs: BACKOFF_DELAY_MS,
      maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
    });
  } finally {
    shutdown.dispose();
    setSystemMessageDispatcher(null);
    updateBridgeHeartbeat({
      pid: process.pid,
      status: "stopped",
      stoppedAt: new Date().toISOString(),
    });
    await runtimeAdapter.close();
  }
}

export {
  formatErrorMessage,
};
