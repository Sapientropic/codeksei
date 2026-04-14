import { createAppServices } from "./app-runtime-factory";
import type {
  AppRuntimeConfig,
  AppServiceFactory,
  AppServices,
  RuntimeAdapterLike,
  SystemMessageDispatcherLike,
  SystemMessageDispatcherRef,
} from "./app-service-contract";
import type {
  DeliveryFailurePayload,
  HandlePreparedMessageOptions,
  NormalizedIncomingMessage,
  RuntimeTurnSendResult,
  SendLocalFileRequest,
  TimelineScreenshotRequest,
} from "./runtime-types";
import { runCodekseiAppLifecycle } from "./app-lifecycle-runner";
import { attachRuntimeEventPipeline } from "./app-runtime-event-pipeline";
import {
  collectDoctorReport,
  loginChannel,
  printChannelAccounts,
  printDoctorReport,
  updateBridgeHeartbeatFile,
} from "./app-admin-actions";
import {
  handleIncomingRuntimeMessage,
  handlePreparedRuntimeMessage,
  handleReplyDeliveryFailureDelegate,
  resolveAppLongPollWindow,
  sendRuntimeLocalFile,
  sendRuntimeTimelineScreenshot,
} from "./app-runtime-delegates";
import {
  resolveAppDefaultTerminalUser,
  resolveAppWorkspaceRoot,
  resolveReplyTargetForBinding,
} from "./app-target-resolution";
import { assertBridgeMode } from "./host-mode";
import { logError } from "./logging";

type AppConfig = AppRuntimeConfig;

interface CodekseiAppOptions {
  createAppServices?: AppServiceFactory;
}

export class CodekseiApp {
  activeAccountId = "";
  readonly config: AppConfig;
  runtimeEventChain: Promise<void> = Promise.resolve();
  readonly services: AppServices;
  systemMessageDispatcher: SystemMessageDispatcherLike | null = null;

  constructor(
    config: AppConfig,
    { createAppServices: createAppServicesOverride = createAppServices }: CodekseiAppOptions = {},
  ) {
    this.config = config;
    this.services = createAppServicesOverride({
      config,
      resolveDefaultTerminalUser: () => resolveAppDefaultTerminalUser({
        config: this.config,
        channelAdapter: this.channelAdapter,
        runtimeAdapter: this.runtimeAdapter,
      }),
      resolveReplyTargetForBinding: (bindingKey: string) => resolveReplyTargetForBinding({
        bindingKey,
        channelAdapter: this.channelAdapter,
        runtimeAdapter: this.runtimeAdapter,
      }),
      resolveWorkspaceRoot: (bindingKey: string) => resolveAppWorkspaceRoot({
        bindingKey,
        config: this.config,
        runtimeAdapter: this.runtimeAdapter,
      }),
      handlePreparedMessage: (
        normalized: NormalizedIncomingMessage,
        options: HandlePreparedMessageOptions,
      ) => handlePreparedRuntimeMessage({
        normalized,
        options,
        runtimeTurnLifecycle: this.runtimeTurnLifecycle,
      }),
      sendTimelineScreenshot: (payload: TimelineScreenshotRequest) => sendRuntimeTimelineScreenshot({
        payload,
        runtimeTurnLifecycle: this.runtimeTurnLifecycle,
      }),
      handleReplyDeliveryFailure: (payload: DeliveryFailurePayload) => this.handleReplyDeliveryFailure(payload),
    });

    attachRuntimeEventPipeline({
      runtimeAdapter: this.runtimeAdapter,
      runtimeWatchdogLifecycle: this.runtimeWatchdogLifecycle,
      threadStateStore: this.threadStateStore,
      getRuntimeEventChain: () => this.runtimeEventChain,
      setRuntimeEventChain: (chain) => {
        this.runtimeEventChain = chain;
      },
      logRuntimeEventFailure: (event, error) => {
        const message = error instanceof Error ? error.stack || error.message : String(error);
        logError(`[codeksei] runtime event handling failed type=${event?.type || "(unknown)"} ${message}`);
      },
    });
  }

  get backstageTaskLifecycle(): AppServices["backstageTaskLifecycle"] {
    return this.services.backstageTaskLifecycle;
  }

  get channelAdapter(): AppServices["channelAdapter"] {
    return this.services.channelAdapter;
  }

  get channelCommandRouter(): AppServices["channelCommandRouter"] {
    return this.services.channelCommandRouter;
  }

  get reminderQueue(): AppServices["reminderQueue"] {
    return this.services.reminderQueue;
  }

  get runtimeAdapter(): AppServices["runtimeAdapter"] {
    return this.services.runtimeAdapter;
  }

  get runtimeTurnLifecycle(): AppServices["runtimeTurnLifecycle"] {
    return this.services.runtimeTurnLifecycle;
  }

  get runtimeWatchdogLifecycle(): AppServices["runtimeWatchdogLifecycle"] {
    return this.services.runtimeWatchdogLifecycle;
  }

  get sessionWriter(): AppServices["sessionWriter"] {
    return this.services.sessionWriter;
  }

  get streamDelivery(): AppServices["streamDelivery"] {
    return this.services.streamDelivery;
  }

  get systemMessageDispatcherState(): SystemMessageDispatcherRef {
    return this.services.systemMessageDispatcherState;
  }

  get systemMessageQueue(): AppServices["systemMessageQueue"] {
    return this.services.systemMessageQueue;
  }

  get threadStateStore(): AppServices["threadStateStore"] {
    return this.services.threadStateStore;
  }

  get timelineIntegration(): AppServices["timelineIntegration"] {
    return this.services.timelineIntegration;
  }

  get timelineScreenshotQueue(): AppServices["timelineScreenshotQueue"] {
    return this.services.timelineScreenshotQueue;
  }

  printDoctor(): void {
    printDoctorReport({
      config: this.config,
      channelAdapter: this.channelAdapter,
      runtimeAdapter: this.runtimeAdapter,
      timelineIntegration: this.timelineIntegration,
      threadStateStore: this.threadStateStore,
    });
  }

  getDoctorReport(): Record<string, unknown> {
    return collectDoctorReport({
      config: this.config,
      channelAdapter: this.channelAdapter,
      runtimeAdapter: this.runtimeAdapter,
      timelineIntegration: this.timelineIntegration,
      threadStateStore: this.threadStateStore,
    });
  }

  async login(): Promise<void> {
    assertBridgeMode(this.config, "codeksei login");
    await loginChannel(this.channelAdapter);
  }

  printAccounts(): void {
    assertBridgeMode(this.config, "codeksei accounts");
    printChannelAccounts(this.channelAdapter);
  }

  async start(): Promise<void> {
    assertBridgeMode(this.config, "codeksei start");
    await runCodekseiAppLifecycle({
      config: this.config,
      channelAdapter: this.channelAdapter,
      runtimeAdapter: this.runtimeAdapter,
      timelineIntegration: this.timelineIntegration,
      systemMessageQueue: this.systemMessageQueue,
      setActiveAccountId: (accountId: string) => {
        this.activeAccountId = accountId;
      },
      setSystemMessageDispatcher: (dispatcher) => {
        this.systemMessageDispatcher = dispatcher;
        this.systemMessageDispatcherState.current = dispatcher;
      },
      updateBridgeHeartbeat: (patch: Record<string, unknown>) => updateBridgeHeartbeatFile({
        config: this.config,
        patch,
      }),
      restoreBoundThreadSubscriptions: () => this.runtimeWatchdogLifecycle.restoreBoundThreadSubscriptions(),
      resolveLongPollTimeoutMs: () => resolveAppLongPollWindow({
        activeAccountId: this.activeAccountId,
        reminderQueue: this.reminderQueue,
        systemMessageDispatcher: this.systemMessageDispatcher,
        timelineScreenshotQueue: this.timelineScreenshotQueue,
      }),
      handleIncomingMessage: (message: unknown) => this.handleIncomingMessage(message),
      flushDueReminders: (currentAccount: { accountId: string }) => {
        return this.backstageTaskLifecycle.flushDueReminders(currentAccount);
      },
      flushPendingSystemMessages: () => this.backstageTaskLifecycle.flushPendingSystemMessages(),
      flushPendingTimelineScreenshots: (currentAccount: { accountId: string }) => {
        return this.backstageTaskLifecycle.flushPendingTimelineScreenshots(currentAccount);
      },
    });
  }

  async sendTimelineScreenshot({
    senderId = "",
    args = [],
    outputFile = "",
  }: TimelineScreenshotRequest = {}): Promise<unknown> {
    assertBridgeMode(this.config, "Codeksei bridge timeline screenshot");
    return sendRuntimeTimelineScreenshot({
      payload: { senderId, args, outputFile },
      runtimeTurnLifecycle: this.runtimeTurnLifecycle,
    });
  }

  async sendLocalFileToCurrentChat({
    senderId = "",
    filePath = "",
  }: SendLocalFileRequest = {}): Promise<unknown> {
    assertBridgeMode(this.config, "Codeksei bridge local file send");
    return sendRuntimeLocalFile({
      payload: { senderId, filePath },
      runtimeTurnLifecycle: this.runtimeTurnLifecycle,
    });
  }

  async handleIncomingMessage(message: unknown): Promise<void> {
    await handleIncomingRuntimeMessage({
      channelAdapter: this.channelAdapter,
      message,
      runtimeTurnLifecycle: this.runtimeTurnLifecycle,
    });
  }

  async handlePreparedMessage(
    normalized: NormalizedIncomingMessage,
    options: HandlePreparedMessageOptions,
  ): Promise<void | RuntimeTurnSendResult> {
    return handlePreparedRuntimeMessage({
      normalized,
      options,
      runtimeTurnLifecycle: this.runtimeTurnLifecycle,
    });
  }

  async handleReplyDeliveryFailure(payload: DeliveryFailurePayload): Promise<void> {
    await handleReplyDeliveryFailureDelegate({
      payload,
      runtimeAdapter: this.runtimeAdapter as RuntimeAdapterLike,
      runtimeWatchdogLifecycle: this.runtimeWatchdogLifecycle,
      sessionWriter: this.sessionWriter,
      threadStateStore: this.threadStateStore,
    });
  }
}
