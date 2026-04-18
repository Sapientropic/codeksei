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
import { logError, logInfo } from "./logging";
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
    runtimeEndpoint: runtimeState.endpoint,
    consecutiveFailures: 0,
    lastError: "",
  });

  logInfo("[codeksei] bootstrap ok");
  logInfo(`[codeksei] channel=${channelAdapter.describe().id}`);
  logInfo(`[codeksei] runtime=${runtimeAdapter.describe().id}`);
  logInfo(`[codeksei] timeline=${timelineIntegration.describe().id}`);
  logInfo(`[codeksei] account=${account.accountId}`);
  logInfo(`[codeksei] baseUrl=${account.baseUrl}`);
  logInfo(`[codeksei] workspaceRoot=${config.workspaceRoot}`);
  logInfo(`[codeksei] knownContextTokens=${knownContextTokens}`);
  logInfo(`[codeksei] syncBuffer=${syncBuffer ? "ready" : "empty"}`);
  logInfo(`[codeksei] weixinReplyMode=${String(config.weixinReplyMode || "")}`);
  logInfo(`[codeksei] weixinDeliveryTrace=${config.weixinDeliveryTrace ? "on" : "off"}`);
  logInfo(`[codeksei] runtimeEndpoint=${runtimeState.endpoint}`);
  logInfo(`[codeksei] runtimeModels=${runtimeState.models.length}`);
  logInfo("[codeksei] 最小消息链路已启动，正在等待微信消息。");
  if (config.startWithCheckin) {
    logInfo("[codeksei] checkin: enabled");
    void runSystemCheckinPoller(config).catch((error) => {
      logError(`[codeksei] checkin poller stopped: ${error instanceof Error ? error.message : String(error)}`);
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
