import {
  isRuntimeFirstProgressEventType,
  RUNTIME_EVENT_TYPES,
  type RuntimeEvent,
} from "../contracts/runtime-events";
import type {
  ChannelAdapterLike,
  RuntimeAdapterLike,
  SessionBindingSnapshot,
  SessionStoreLike,
  StreamDeliveryLike,
  ThreadStateStoreLike,
} from "../core/app-service-contract";
import type {
  PendingApprovalState,
  PreparedRuntimeMessage,
  ReplyTarget,
  ThreadBindingRef,
  UnknownRecord,
} from "../core/runtime-types";

interface DeliveryTarget {
  userId: string;
  contextToken: string;
}

interface RuntimeEventWatchdogEntry {
  noticeTimer: NodeJS.Timeout;
  failureTimer: NodeJS.Timeout;
  noticeSent: boolean;
}

interface TurnSettlementWatchdogEntry {
  timer: NodeJS.Timeout;
}

interface WorkspaceBootstrapEntry {
  bindingKey: string;
  workspaceRoot: string;
}

interface ThreadStateSnapshot {
  status?: string;
  turnId?: string;
  pendingApproval?: PendingApprovalState | null;
}

type BuildApprovalPromptSignature = (approval: PendingApprovalState) => string;
type BuildApprovalPromptText = (approval: PendingApprovalState) => string;
type MatchesBuiltInCommandPrefix = (commandTokens: unknown) => boolean;
type MatchesCommandPrefix = (commandTokens: unknown, allowlist: string[][]) => boolean;
type NormalizeCommandArgument = (value: unknown) => string;
type NormalizeText = (value: unknown) => string;
type ResolveReplyTargetForBinding = (bindingKey: string) => ReplyTarget | null;

interface RuntimeWatchdogLifecycleDependencies {
  buildApprovalPromptSignature: BuildApprovalPromptSignature;
  buildApprovalPromptText: BuildApprovalPromptText;
  channelAdapter: ChannelAdapterLike;
  matchesBuiltInCommandPrefix: MatchesBuiltInCommandPrefix;
  matchesCommandPrefix: MatchesCommandPrefix;
  normalizeCommandArgument: NormalizeCommandArgument;
  normalizeText: NormalizeText;
  resolveReplyTargetForBinding: ResolveReplyTargetForBinding;
  runtimeAdapter: RuntimeAdapterLike;
  streamDelivery: StreamDeliveryLike;
  streamSettlementTimeoutMs: number;
  threadStateStore: ThreadStateStoreLike;
  firstRuntimeEventFailureTimeoutMs: number;
  firstRuntimeEventNoticeTimeoutMs: number;
}

export class RuntimeWatchdogLifecycle {
  readonly buildApprovalPromptSignature: BuildApprovalPromptSignature;
  readonly buildApprovalPromptText: BuildApprovalPromptText;
  readonly channelAdapter: ChannelAdapterLike;
  readonly firstRuntimeEventFailureTimeoutMs: number;
  readonly firstRuntimeEventNoticeTimeoutMs: number;
  readonly matchesBuiltInCommandPrefix: MatchesBuiltInCommandPrefix;
  readonly matchesCommandPrefix: MatchesCommandPrefix;
  readonly normalizeCommandArgument: NormalizeCommandArgument;
  readonly normalizeText: NormalizeText;
  readonly pendingRuntimeEventWatchdogs: Map<string, RuntimeEventWatchdogEntry>;
  readonly pendingTurnSettlementWatchdogs: Map<string, TurnSettlementWatchdogEntry>;
  readonly pendingWorkspaceBootstrapByThreadId: Map<string, WorkspaceBootstrapEntry>;
  readonly resolveReplyTargetForBinding: ResolveReplyTargetForBinding;
  readonly runtimeAdapter: RuntimeAdapterLike;
  readonly streamDelivery: StreamDeliveryLike;
  readonly streamSettlementTimeoutMs: number;
  readonly threadStateStore: ThreadStateStoreLike;

  constructor({
    buildApprovalPromptSignature,
    buildApprovalPromptText,
    channelAdapter,
    matchesBuiltInCommandPrefix,
    matchesCommandPrefix,
    normalizeCommandArgument,
    normalizeText,
    resolveReplyTargetForBinding,
    runtimeAdapter,
    streamDelivery,
    streamSettlementTimeoutMs,
    threadStateStore,
    firstRuntimeEventFailureTimeoutMs,
    firstRuntimeEventNoticeTimeoutMs,
  }: RuntimeWatchdogLifecycleDependencies) {
    this.buildApprovalPromptSignature = buildApprovalPromptSignature;
    this.buildApprovalPromptText = buildApprovalPromptText;
    this.channelAdapter = channelAdapter;
    this.matchesBuiltInCommandPrefix = matchesBuiltInCommandPrefix;
    this.matchesCommandPrefix = matchesCommandPrefix;
    this.normalizeCommandArgument = normalizeCommandArgument;
    this.normalizeText = normalizeText;
    this.resolveReplyTargetForBinding = resolveReplyTargetForBinding;
    this.runtimeAdapter = runtimeAdapter;
    this.streamDelivery = streamDelivery;
    this.streamSettlementTimeoutMs = streamSettlementTimeoutMs;
    this.threadStateStore = threadStateStore;
    this.firstRuntimeEventFailureTimeoutMs = firstRuntimeEventFailureTimeoutMs;
    this.firstRuntimeEventNoticeTimeoutMs = firstRuntimeEventNoticeTimeoutMs;
    this.pendingRuntimeEventWatchdogs = new Map();
    this.pendingTurnSettlementWatchdogs = new Map();
    this.pendingWorkspaceBootstrapByThreadId = new Map();
  }

  observeRuntimeEvent(event: RuntimeEvent<UnknownRecord>): void {
    this.confirmPendingWorkspaceBootstrap(event);
    if (isRuntimeFirstProgressEventType(event?.type)) {
      this.clearRuntimeEventWatchdog(event?.payload?.threadId);
    }
    this.refreshTurnSettlementWatchdog(event);
  }

  scheduleRuntimeEventWatchdog({
    bindingKey,
    workspaceRoot,
    normalized,
    threadId = "",
  }: {
    bindingKey: string;
    workspaceRoot: string;
    normalized: PreparedRuntimeMessage;
    threadId?: string;
  }): void {
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const candidateThreadId = this.normalizeCommandArgument(threadId)
      || sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
    const normalizedThreadId = this.normalizeCommandArgument(candidateThreadId);
    if (!normalizedThreadId) {
      return;
    }

    this.clearRuntimeEventWatchdog(normalizedThreadId);
    const noticeTimer = setTimeout(async () => {
      const watchdog = this.pendingRuntimeEventWatchdogs.get(normalizedThreadId);
      if (!watchdog) {
        return;
      }
      const currentThreadState = this.threadStateStore.getThreadState(normalizedThreadId);
      if (hasObservedInitialRuntimeProgress(currentThreadState)) {
        return;
      }
      watchdog.noticeSent = true;
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        contextToken: normalized.contextToken,
        preserveBlock: true,
        text: [
          "这条消息已经发到 bridge，但 Codex runtime 还没有返回首个事件。",
          "如果你看到 terminal 正在 reconnecting，这一轮大概率还卡在共享线程启动阶段。",
          "先不用一直空等；如果稍后连上，消息会继续往下跑。",
          `workspace: ${workspaceRoot}`,
          `thread: ${normalizedThreadId}`,
        ].join("\n"),
      }).catch(() => {});
    }, this.firstRuntimeEventNoticeTimeoutMs);
    const failureTimer = setTimeout(async () => {
      this.pendingRuntimeEventWatchdogs.delete(normalizedThreadId);
      const currentThreadState = this.threadStateStore.getThreadState(normalizedThreadId);
      if (hasObservedInitialRuntimeProgress(currentThreadState)) {
        return;
      }
      await this.channelAdapter.sendTyping({
        userId: normalized.senderId,
        status: 0,
        contextToken: normalized.contextToken,
      }).catch(() => {});
      await this.channelAdapter.sendText({
        userId: normalized.senderId,
        contextToken: normalized.contextToken,
        preserveBlock: true,
        text: [
          "这条消息已经发到 bridge，但 Codex runtime 直到现在都没有返回首个事件。",
          "如果 terminal 里的那轮 reconnecting 已经跑完 5 次，这条共享线程基本可以判定没有真正启动成功。",
          `workspace: ${workspaceRoot}`,
          `thread: ${normalizedThreadId}`,
          "优先检查：共享 app-server 是否正常、当前终端是否接在同一个 thread、runtime 是否真的开始处理这条消息。",
          "如果你现在是在替这条线排查，直接按这套顺序做：",
          "1. 在项目目录执行 npm run shared:status",
          "2. 如果 bridge 不在，先执行 npm run shared:start",
          "3. 再开一个终端执行 npm run shared:open",
          "4. 确认 terminal 里打开的是上面这条 thread，而不是另一条私有线程",
        ].join("\n"),
      }).catch(() => {});
    }, this.firstRuntimeEventFailureTimeoutMs);
    this.pendingRuntimeEventWatchdogs.set(normalizedThreadId, {
      noticeTimer,
      failureTimer,
      noticeSent: false,
    });
  }

  clearRuntimeEventWatchdog(threadId: unknown): void {
    const normalizedThreadId = this.normalizeCommandArgument(threadId);
    if (!normalizedThreadId) {
      return;
    }
    const watchdog = this.pendingRuntimeEventWatchdogs.get(normalizedThreadId);
    if (!watchdog) {
      return;
    }
    clearTimeout(watchdog.noticeTimer);
    clearTimeout(watchdog.failureTimer);
    this.pendingRuntimeEventWatchdogs.delete(normalizedThreadId);
  }

  refreshTurnSettlementWatchdog(event: RuntimeEvent<UnknownRecord>): void {
    const threadId = this.normalizeCommandArgument(event?.payload?.threadId);
    const turnId = this.normalizeCommandArgument(event?.payload?.turnId);
    if (!threadId || !turnId) {
      return;
    }

    if (
      event.type === RUNTIME_EVENT_TYPES.TURN_COMPLETED
      || event.type === RUNTIME_EVENT_TYPES.TURN_FAILED
      || event.type === RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED
    ) {
      this.clearTurnSettlementWatchdog(threadId, turnId);
      return;
    }
    if (
      event.type !== RUNTIME_EVENT_TYPES.REPLY_DELTA
      && event.type !== RUNTIME_EVENT_TYPES.REPLY_COMPLETED
    ) {
      return;
    }

    const watchdogKey = buildTurnSettlementWatchdogKey(threadId, turnId, this.normalizeCommandArgument);
    this.clearTurnSettlementWatchdog(threadId, turnId);
    const timer = setTimeout(async () => {
      this.pendingTurnSettlementWatchdogs.delete(watchdogKey);
      const currentThreadState = this.threadStateStore.getThreadState(threadId);
      if (!currentThreadState || currentThreadState.turnId !== turnId || currentThreadState.status !== "running") {
        return;
      }

      const linked = this.runtimeAdapter.getSessionStore().findBindingForThreadId(threadId);
      const workspaceRoot = this.normalizeText(linked?.workspaceRoot);
      // Once a reply has already started streaming, hanging forever is worse
      // than surfacing a partial answer. We only trip this guard after a long
      // quiet period to avoid fighting normal long-running tool calls.
      console.error(
        `[codeksei] runtime settlement watchdog expired `
        + `thread=${threadId} turn=${turnId} workspace=${workspaceRoot || "(unknown)"}`
      );
      await this.streamDelivery.finalizeAbandonedTurn({
        threadId,
        turnId,
        trailingText: [
          "【系统提示】",
          "这一轮回复已经开始输出，但 Codex runtime 一直没有发回完成或失败事件。",
          "我先把目前拿到的内容停在这里，避免你继续看到假 typing。",
          "如果 runtime 稍后恢复并补发完成事件，我会自动续发剩下的内容。",
          "只有在长时间都没有新内容时，再发一句“继续刚才那条未完回复”就行。",
        ].join("\n"),
      });
      this.threadStateStore.markTurnFailed(
        threadId,
        turnId,
        "这轮回复已经开始输出，但 Codex runtime 一直没有发回完成或失败事件。",
      );
      clearPendingApproval(this.runtimeAdapter.getSessionStore(), threadId);
      await this.stopTypingForThread(threadId);
    }, this.streamSettlementTimeoutMs);
    this.pendingTurnSettlementWatchdogs.set(watchdogKey, { timer });
  }

  clearTurnSettlementWatchdog(threadId: unknown, turnId: unknown): void {
    const watchdogKey = buildTurnSettlementWatchdogKey(threadId, turnId, this.normalizeCommandArgument);
    if (!watchdogKey) {
      return;
    }
    const watchdog = this.pendingTurnSettlementWatchdogs.get(watchdogKey);
    if (!watchdog) {
      return;
    }
    clearTimeout(watchdog.timer);
    this.pendingTurnSettlementWatchdogs.delete(watchdogKey);
  }

  queuePendingWorkspaceBootstrap({
    bindingKey,
    workspaceRoot,
    threadId,
  }: {
    bindingKey: string;
    workspaceRoot: string;
    threadId: string;
  }): void {
    const normalizedBindingKey = this.normalizeText(bindingKey);
    const normalizedWorkspaceRoot = this.normalizeText(workspaceRoot);
    const normalizedThreadId = this.normalizeText(threadId);
    if (!normalizedBindingKey || !normalizedWorkspaceRoot || !normalizedThreadId) {
      return;
    }
    this.pendingWorkspaceBootstrapByThreadId.set(normalizedThreadId, {
      bindingKey: normalizedBindingKey,
      workspaceRoot: normalizedWorkspaceRoot,
    });
  }

  confirmPendingWorkspaceBootstrap(event: RuntimeEvent<UnknownRecord>): void {
    if (!event || event.type === RUNTIME_EVENT_TYPES.USAGE_UPDATED) {
      return;
    }
    const threadId = this.normalizeText(event?.payload?.threadId);
    if (!threadId) {
      return;
    }
    const pending = this.pendingWorkspaceBootstrapByThreadId.get(threadId);
    if (!pending?.bindingKey || !pending?.workspaceRoot) {
      return;
    }
    // Do not mark workspace bootstrap as done when sendUserMessage merely
    // returns. In shared mode the runtime can still stall before emitting the
    // first real thread event, and prematurely persisting success would skip the
    // next retry's continuity bootstrap.
    this.runtimeAdapter.getSessionStore().rememberWorkspaceBootstrapForThread(
      pending.bindingKey,
      pending.workspaceRoot,
      threadId,
    );
    this.pendingWorkspaceBootstrapByThreadId.delete(threadId);
  }

  async handleRuntimeEvent(event: RuntimeEvent<UnknownRecord>): Promise<void> {
    await this.streamDelivery.handleRuntimeEvent(event);
    if (!event) {
      return;
    }
    if (event.type === RUNTIME_EVENT_TYPES.TURN_COMPLETED || event.type === RUNTIME_EVENT_TYPES.TURN_FAILED) {
      clearPendingApproval(this.runtimeAdapter.getSessionStore(), event.payload.threadId);
      await this.stopTypingForThread(event.payload.threadId);
      if (event.type === RUNTIME_EVENT_TYPES.TURN_FAILED) {
        await this.sendFailureToThread(event.payload.threadId, event.payload.text || "执行失败");
      }
      return;
    }
    if (event.type !== RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED) {
      return;
    }
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const linked = sessionStore.findBindingForThreadId(event.payload.threadId);
    if (!linked?.workspaceRoot) {
      return;
    }
    const eventThreadId = this.normalizeCommandArgument(event.payload.threadId);
    const approval = normalizePendingApprovalState(event.payload, eventThreadId, this.normalizeText);
    if (!eventThreadId || !approval.requestId) {
      return;
    }
    const allowlist = sessionStore.getApprovalCommandAllowlistForWorkspace(linked.workspaceRoot);
    const shouldAutoApprove = this.matchesBuiltInCommandPrefix(event.payload.commandTokens)
      || this.matchesCommandPrefix(event.payload.commandTokens, allowlist);
    if (!shouldAutoApprove) {
      const promptState = sessionStore.getPendingApprovalForThread(eventThreadId);
      const promptSignature = this.buildApprovalPromptSignature(approval);
      if (promptState?.signature && promptState.signature === promptSignature) {
        sessionStore.rememberPendingApprovalForThread(eventThreadId, approval, {
          signature: promptSignature,
          promptedAt: promptState.promptedAt || new Date().toISOString(),
        });
        console.log(
          `[codeksei] approval prompt deduped thread=${eventThreadId} requestId=${approval.requestId}`,
        );
        return;
      }
      sessionStore.rememberPendingApprovalForThread(eventThreadId, approval, {
        signature: promptSignature,
      });
      await this.sendApprovalPrompt({
        bindingKey: linked.bindingKey,
        approval,
      });
      return;
    }
    clearPendingApproval(sessionStore, eventThreadId);
    await this.runtimeAdapter.respondApproval({
      requestId: approval.requestId,
      decision: "accept",
    }).catch(() => {});
    this.threadStateStore.resolveApproval(eventThreadId, "running");
  }

  async stopTypingForThread(threadId: unknown): Promise<void> {
    const linked = this.runtimeAdapter.getSessionStore().findBindingForThreadId(threadId);
    const target = linked?.bindingKey ? this.resolveReplyTargetForBinding(linked.bindingKey) : null;
    if (!target) {
      return;
    }
    await this.channelAdapter.sendTyping({
      userId: target.userId,
      status: 0,
      contextToken: target.contextToken,
    }).catch(() => {});
  }

  async sendFailureToThread(threadId: unknown, text: unknown): Promise<void> {
    const linked = this.runtimeAdapter.getSessionStore().findBindingForThreadId(threadId);
    const target = linked?.bindingKey ? this.resolveReplyTargetForBinding(linked.bindingKey) : null;
    if (!target) {
      return;
    }
    await this.channelAdapter.sendText({
      userId: target.userId,
      text: this.normalizeText(text) || "执行失败",
      contextToken: target.contextToken,
    }).catch(() => {});
  }

  async sendApprovalPrompt({
    bindingKey,
    approval,
  }: {
    bindingKey: string;
    approval: PendingApprovalState;
  }): Promise<void> {
    const target = this.resolveReplyTargetForBinding(bindingKey);
    if (!target) {
      console.warn(
        `[codeksei] approval prompt skipped binding=${bindingKey} requestId=${approval?.requestId || ""} reason=no_reply_target`,
      );
      return;
    }
    console.log(
      `[codeksei] approval prompt sending binding=${bindingKey} user=${target.userId} requestId=${approval?.requestId || ""}`,
    );
    await this.channelAdapter.sendTyping({
      userId: target.userId,
      status: 0,
      contextToken: target.contextToken,
    }).catch(() => {});
    await this.channelAdapter.sendText({
      userId: target.userId,
      text: this.buildApprovalPromptText(approval),
      contextToken: target.contextToken,
      preserveBlock: true,
    });
    console.log(
      `[codeksei] approval prompt delivered binding=${bindingKey} user=${target.userId} requestId=${approval?.requestId || ""}`,
    );
  }

  async restoreBoundThreadSubscriptions(): Promise<void> {
    const sessionStore = this.runtimeAdapter.getSessionStore();
    const bindings = sessionStore.listBindings();
    const seenThreadIds = new Set<string>();

    for (const binding of bindings) {
      const bindingKey = this.normalizeText(binding?.bindingKey);
      if (!bindingKey) {
        continue;
      }

      const target = this.resolveReplyTargetForBinding(bindingKey);
      if (target) {
        this.streamDelivery.setReplyTarget(bindingKey, target);
      }

      const threadIdByWorkspaceRoot = binding?.threadIdByWorkspaceRoot && typeof binding.threadIdByWorkspaceRoot === "object"
        ? binding.threadIdByWorkspaceRoot
        : {};
      for (const threadId of Object.values(threadIdByWorkspaceRoot)) {
        const normalizedThreadId = this.normalizeCommandArgument(threadId);
        if (!normalizedThreadId || seenThreadIds.has(normalizedThreadId)) {
          continue;
        }
        seenThreadIds.add(normalizedThreadId);
        await this.runtimeAdapter.resumeThread({ threadId: normalizedThreadId }).catch(() => {});
      }
    }

    for (const entry of sessionStore.listPendingApprovals()) {
      this.threadStateStore.hydratePendingApproval(entry.threadId, entry.approval);
    }
  }
}

function clearPendingApproval(sessionStore: SessionStoreLike, threadId: unknown): void {
  if (typeof sessionStore.clearPendingApprovalForThread === "function") {
    sessionStore.clearPendingApprovalForThread(threadId);
    return;
  }
  if (typeof sessionStore.clearApprovalPrompt === "function") {
    sessionStore.clearApprovalPrompt(threadId);
  }
}

function buildTurnSettlementWatchdogKey(
  threadId: unknown,
  turnId: unknown,
  normalizeCommandArgument: NormalizeCommandArgument,
): string {
  const normalizedThreadId = normalizeCommandArgument(threadId);
  const normalizedTurnId = normalizeCommandArgument(turnId);
  if (!normalizedThreadId || !normalizedTurnId) {
    return "";
  }
  return `${normalizedThreadId}:${normalizedTurnId}`;
}

function hasObservedInitialRuntimeProgress(
  threadState: ThreadStateSnapshot | null | undefined,
): boolean {
  // The "first runtime event" watchdog is only meant to answer one question:
  // did this new send receive any live runtime progress yet? Old terminal turn
  // ids linger in thread state after completion/failure, so using a non-empty
  // historical turnId here suppresses the watchdog on every later send for the
  // same thread. Only live, non-terminal states should short-circuit it.
  return threadState?.status === "running" || threadState?.status === "waiting_approval";
}

function normalizePendingApprovalState(
  payload: UnknownRecord,
  threadId: string,
  normalizeText: NormalizeText,
): PendingApprovalState {
  const commandTokens = Array.isArray(payload.commandTokens)
    ? payload.commandTokens
      .map((token) => normalizeText(token))
      .filter(Boolean)
    : [];
  return {
    threadId,
    requestId: normalizeText(payload.requestId),
    reason: normalizeText(payload.reason),
    command: normalizeText(payload.command),
    commandTokens,
    signature: normalizeText(payload.signature),
    promptedAt: normalizeText(payload.promptedAt),
  };
}
