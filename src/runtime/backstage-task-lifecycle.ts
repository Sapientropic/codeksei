import type { ReminderQueueEntry, SystemMessage } from "../contracts/queue-items";
import type {
  AppRuntimeConfig,
  ChannelAdapterLike,
  ReminderQueueLike,
  RuntimeAdapterLike,
  SystemMessageDispatcherLike,
  SystemMessageQueueLike,
  ThreadStateStoreLike,
  TimelineScreenshotQueueLike,
} from "../core/app-service-contract";
import { ignoreBestEffortError } from "../core/error-handling";
import { operatorMessages, userFacingMessages } from "../core/message-catalog";
import type {
  HandlePreparedMessageOptions,
  NormalizedIncomingMessage,
  PendingApprovalState,
  SystemDispatchResult,
  TimelineScreenshotRequest,
} from "../core/runtime-types";

interface AccountRef {
  accountId: string;
}

interface ThreadStateSnapshot {
  status?: string;
  pendingApproval?: PendingApprovalState | null;
}

type FormatErrorMessage = (error: unknown) => string;
type GetSystemMessageDispatcher = () => SystemMessageDispatcherLike | null;
type GetSystemMessageFailureRetryDelayMs = (attemptCount: number) => number;
type HandlePreparedMessage = (
  normalized: NormalizedIncomingMessage,
  options: HandlePreparedMessageOptions,
) => Promise<{ status: string; reason?: string } | void>;
type HasRpcId = (requestId: unknown) => boolean;
type NormalizeText = (value: unknown) => string;
type SendTimelineScreenshot = (payload: TimelineScreenshotRequest) => Promise<unknown>;
type BuildReminderSystemTrigger = (reminder: ReminderQueueEntry, config: BackstageConfig) => string;
type ResolveWorkspaceRoot = (bindingKey: string) => string;

type BackstageConfig = AppRuntimeConfig;

interface BackstageTaskLifecycleDependencies {
  channelAdapter: ChannelAdapterLike;
  config: BackstageConfig;
  formatErrorMessage: FormatErrorMessage;
  getSystemMessageDispatcher: GetSystemMessageDispatcher;
  getSystemMessageFailureRetryDelayMs: GetSystemMessageFailureRetryDelayMs;
  handlePreparedMessage: HandlePreparedMessage;
  hasRpcId: HasRpcId;
  normalizeText: NormalizeText;
  reminderQueue: ReminderQueueLike;
  runtimeAdapter: RuntimeAdapterLike;
  sendTimelineScreenshot: SendTimelineScreenshot;
  systemMessageBusyRetryMs: number;
  systemMessageQueue: SystemMessageQueueLike;
  threadStateStore: ThreadStateStoreLike;
  timelineScreenshotQueue: TimelineScreenshotQueueLike;
  buildReminderSystemTrigger: BuildReminderSystemTrigger;
  resolveWorkspaceRoot: ResolveWorkspaceRoot;
}

export class BackstageTaskLifecycle {
  readonly buildReminderSystemTrigger: BuildReminderSystemTrigger;
  readonly channelAdapter: ChannelAdapterLike;
  readonly config: BackstageConfig;
  readonly formatErrorMessage: FormatErrorMessage;
  readonly getSystemMessageDispatcher: GetSystemMessageDispatcher;
  readonly getSystemMessageFailureRetryDelayMs: GetSystemMessageFailureRetryDelayMs;
  readonly handlePreparedMessage: HandlePreparedMessage;
  readonly hasRpcId: HasRpcId;
  readonly normalizeText: NormalizeText;
  readonly reminderQueue: ReminderQueueLike;
  readonly resolveWorkspaceRoot: ResolveWorkspaceRoot;
  readonly runtimeAdapter: RuntimeAdapterLike;
  readonly sendTimelineScreenshot: SendTimelineScreenshot;
  readonly systemMessageBusyRetryMs: number;
  readonly systemMessageQueue: SystemMessageQueueLike;
  readonly threadStateStore: ThreadStateStoreLike;
  readonly timelineScreenshotQueue: TimelineScreenshotQueueLike;

  constructor({
    channelAdapter,
    config,
    formatErrorMessage,
    getSystemMessageDispatcher,
    getSystemMessageFailureRetryDelayMs,
    handlePreparedMessage,
    hasRpcId,
    normalizeText,
    reminderQueue,
    runtimeAdapter,
    sendTimelineScreenshot,
    systemMessageBusyRetryMs,
    systemMessageQueue,
    threadStateStore,
    timelineScreenshotQueue,
    buildReminderSystemTrigger,
    resolveWorkspaceRoot,
  }: BackstageTaskLifecycleDependencies) {
    this.channelAdapter = channelAdapter;
    this.config = config;
    this.formatErrorMessage = formatErrorMessage;
    this.getSystemMessageDispatcher = getSystemMessageDispatcher;
    this.getSystemMessageFailureRetryDelayMs = getSystemMessageFailureRetryDelayMs;
    this.handlePreparedMessage = handlePreparedMessage;
    this.hasRpcId = hasRpcId;
    this.normalizeText = normalizeText;
    this.reminderQueue = reminderQueue;
    this.runtimeAdapter = runtimeAdapter;
    this.sendTimelineScreenshot = sendTimelineScreenshot;
    this.systemMessageBusyRetryMs = systemMessageBusyRetryMs;
    this.systemMessageQueue = systemMessageQueue;
    this.threadStateStore = threadStateStore;
    this.timelineScreenshotQueue = timelineScreenshotQueue;
    this.buildReminderSystemTrigger = buildReminderSystemTrigger;
    this.resolveWorkspaceRoot = resolveWorkspaceRoot;
  }

  async flushPendingSystemMessages(): Promise<void> {
    const dispatcher = this.getSystemMessageDispatcher();
    const pendingMessages = dispatcher?.takeReadyPending(Date.now()) || [];
    for (const message of pendingMessages) {
      let dispatchResult: SystemDispatchResult | null = null;
      try {
        // Backstage scheduling needs an explicit result enum so busy deferrals,
        // retryable runtime failures, and terminal dead-letters do not collapse
        // into the same boolean/throw path.
        dispatchResult = await this.dispatchSystemMessage(message);
      } catch (error) {
        dispatchResult = {
          status: "retryable_error",
          reason: this.formatErrorMessage(error),
        };
      }

      switch (dispatchResult?.status) {
        case "sent":
          dispatcher?.complete(message);
          break;
        case "deferred_busy": {
          const deferred = dispatcher?.defer(message, {
            delayMs: this.systemMessageBusyRetryMs,
            reason: dispatchResult.reason,
            countAttempt: false,
          });
          if (deferred?.status === "dead_letter") {
            console.warn(
              `[codeksei] backstage message dead-lettered id=${message.id} reason=${dispatchResult.reason}`,
            );
          }
          break;
        }
        case "dead_letter":
          dispatcher?.deadLetter(message, { reason: dispatchResult.reason });
          console.warn(
            `[codeksei] backstage message dead-lettered id=${message.id} reason=${dispatchResult.reason || "dead_letter"}`,
          );
          break;
        case "retryable_error":
        default: {
          const deferred = dispatcher?.defer(message, {
            delayMs: this.getSystemMessageFailureRetryDelayMs((Number(message?.attemptCount) || 0) + 1),
            reason: this.normalizeText(dispatchResult?.reason) || "runtime_send_failed",
            countAttempt: true,
          });
          if (deferred?.status === "dead_letter") {
            console.warn(
              `[codeksei] backstage message dead-lettered id=${message.id} reason=${this.normalizeText(dispatchResult?.reason) || "runtime_send_failed"}`,
            );
          }
          break;
        }
      }
    }
  }

  async flushPendingTimelineScreenshots(account: AccountRef): Promise<void> {
    const pendingJobs = this.timelineScreenshotQueue.drainForAccount(account.accountId);
    for (const job of pendingJobs) {
      try {
        await this.sendTimelineScreenshot({
          senderId: job.senderId,
          args: job.args,
          outputFile: job.outputFile,
        });
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error || "unknown error");
        console.error(operatorMessages.timelineScreenshotJobFailed(job.id, messageText));
        // The job has already failed locally. Clearing typing state and sending
        // the user-facing failure notice are best-effort cleanup steps only.
        await ignoreBestEffortError(this.channelAdapter.sendTyping({
          userId: job.senderId,
          status: 0,
        }), {
          label: "backstage timeline screenshot typing stop",
          reason: "typing stop is best-effort cleanup after the screenshot job already failed locally",
        });
        await ignoreBestEffortError(this.channelAdapter.sendText({
          userId: job.senderId,
          text: userFacingMessages.timelineScreenshotFailed(messageText),
          preserveBlock: true,
        }), {
          label: "backstage timeline screenshot failure notice",
          reason: "failure notice should not mask the original screenshot job failure",
        });
      }
    }
  }

  async flushDueReminders(account: AccountRef): Promise<void> {
    const dueReminders = this.reminderQueue
      .listDue(Date.now())
      .filter((reminder) => reminder.accountId === account.accountId);

    for (const reminder of dueReminders) {
      try {
        this.systemMessageQueue.enqueue({
          id: `reminder:${reminder.id}`,
          accountId: reminder.accountId,
          senderId: reminder.senderId,
          workspaceRoot: this.resolveReminderWorkspaceRoot(reminder),
          text: this.buildReminderSystemTrigger(reminder, this.config),
          kind: "reminder",
          createdAt: new Date().toISOString(),
        });
      } catch {
        this.reminderQueue.enqueue({
          ...reminder,
          dueAtMs: Date.now() + 5_000,
        });
      }
    }
  }

  resolveReminderWorkspaceRoot(reminder: ReminderQueueEntry): string {
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: this.config.workspaceId,
      accountId: reminder.accountId,
      senderId: reminder.senderId,
    });
    return this.runtimeAdapter.getSessionStore().getActiveWorkspaceRoot(bindingKey) || this.config.workspaceRoot;
  }

  async dispatchSystemMessage(message: SystemMessage): Promise<SystemDispatchResult> {
    const dispatcher = this.getSystemMessageDispatcher();
    const prepared = dispatcher?.buildPreparedMessage(
      message,
      this.channelAdapter.getKnownContextTokens()[message.senderId] || "",
    );
    if (!prepared) {
      return { status: "dead_letter", reason: "invalid_system_message" };
    }
    const bindingKey = this.runtimeAdapter.getSessionStore().buildBindingKey({
      workspaceId: prepared.workspaceId,
      accountId: prepared.accountId,
      senderId: prepared.senderId,
    });
    const workspaceRoot = prepared.workspaceRoot || this.resolveWorkspaceRoot(bindingKey);
    const threadId = this.runtimeAdapter.getSessionStore().getThreadIdForWorkspace(bindingKey, workspaceRoot);
    const threadState = threadId ? this.threadStateStore.getThreadState(threadId) : null;
    const persistedPendingApproval = threadId
      ? this.runtimeAdapter.getSessionStore().getPendingApprovalForThread(threadId)
      : null;
    const pendingApproval = threadState?.pendingApproval || persistedPendingApproval;
    if (threadState?.status === "running") {
      return { status: "deferred_busy", reason: "thread_running" };
    }
    if (this.hasRpcId(pendingApproval?.requestId)) {
      return { status: "deferred_busy", reason: "waiting_approval" };
    }
    const sendResult = await this.handlePreparedMessage(prepared, {
      allowCommands: false,
      reportFailureToUser: false,
      throwOnFailure: false,
    });
    if (sendResult?.status === "sent") {
      return { status: "sent", reason: "" };
    }
    return {
      status: "retryable_error",
      reason: this.normalizeText(sendResult?.reason) || "runtime_send_failed",
    };
  }
}
