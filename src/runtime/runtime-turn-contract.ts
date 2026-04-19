import type {
  CheckinRuntimeConfig,
  IdentityAndTimeConfig,
  RuntimeHostConfig,
  WeixinBridgeConfig,
  WorkspacePathsConfig,
} from "../core/config-slices";
import type {
  ChannelAdapterLike,
  RuntimeAdapterLike,
  StreamDeliveryLike,
  TimelineIntegrationLike,
} from "../core/app-service-contract";
import type {
  NormalizedIncomingMessage,
  PreparedRuntimeMessage,
  RuntimeTurnSendResult,
  UserTypingOptions,
} from "../core/runtime-types";
import type {
  IncomingWeixinAttachment,
  PersistIncomingWeixinAttachmentsResult,
} from "../contracts/weixin-media";

export type PersistedAttachmentResult = PersistIncomingWeixinAttachmentsResult;

export type RuntimeTurnConfig =
  & Pick<WorkspacePathsConfig, "stateDir" | "workspaceId" | "workspaceRoot">
  & Pick<RuntimeHostConfig, "runtimeAccessMode">
  & Pick<WeixinBridgeConfig, "weixinCdnBaseUrl">
  & Partial<Pick<CheckinRuntimeConfig, "checkinScheduleStateFile">>
  & Partial<Pick<IdentityAndTimeConfig, "timezone" | "userName">>;

export type FormatErrorMessage = (error: unknown) => string;
export type MaybeDispatchCommand = (normalized: NormalizedIncomingMessage) => Promise<boolean>;
export type NormalizeText = (value: unknown) => string;
export type PersistIncomingWeixinAttachments = (args: {
  attachments: IncomingWeixinAttachment[];
  stateDir: string;
  cdnBaseUrl: unknown;
  messageId: string;
  receivedAt: string;
  workspaceRoot: string;
}) => Promise<PersistedAttachmentResult>;
export type QueuePendingWorkspaceBootstrap = (payload: {
  bindingKey: string;
  workspaceRoot: string;
  threadId: string;
}) => void;
export type ResolveDefaultTerminalUser = () => string;
export type ResolveWorkspaceRoot = (bindingKey: string) => string;
export type ScheduleRuntimeEventWatchdog = (payload: {
  bindingKey: string;
  workspaceRoot: string;
  normalized: PreparedRuntimeMessage;
  threadId?: string;
}) => void;
export type BuildRuntimeInboundText = (
  normalized: NormalizedIncomingMessage,
  persisted: PersistedAttachmentResult,
  config: RuntimeTurnConfig,
) => string;
export type HandlePreparedMessageResult = RuntimeTurnSendResult | void;
export type WithUserTyping = <T>(
  options: UserTypingOptions,
  work: (() => Promise<T>) | null | undefined,
) => Promise<T>;

export interface RuntimeTurnActionDependencies {
  channelAdapter: ChannelAdapterLike;
  normalizeText: NormalizeText;
  resolveDefaultTerminalUser: ResolveDefaultTerminalUser;
}

export interface RuntimeTurnPreparationDependencies {
  buildRuntimeInboundText: BuildRuntimeInboundText;
  channelAdapter: ChannelAdapterLike;
  config: RuntimeTurnConfig;
  persistIncomingWeixinAttachments: PersistIncomingWeixinAttachments;
}

export interface RuntimeTurnSendDependencies {
  config: RuntimeTurnConfig;
  formatErrorMessage: FormatErrorMessage;
  normalizeText: NormalizeText;
  queuePendingWorkspaceBootstrap: QueuePendingWorkspaceBootstrap;
  runtimeAdapter: RuntimeAdapterLike;
  scheduleRuntimeEventWatchdog: ScheduleRuntimeEventWatchdog;
  streamDelivery: StreamDeliveryLike;
  withUserTyping: WithUserTyping;
}

export interface RuntimeTurnLifecycleDependencies {
  buildRuntimeInboundText: BuildRuntimeInboundText;
  channelAdapter: ChannelAdapterLike;
  config: RuntimeTurnConfig;
  formatErrorMessage: FormatErrorMessage;
  maybeDispatchCommand: MaybeDispatchCommand;
  normalizeText: NormalizeText;
  persistIncomingWeixinAttachments: PersistIncomingWeixinAttachments;
  queuePendingWorkspaceBootstrap: QueuePendingWorkspaceBootstrap;
  resolveDefaultTerminalUser: ResolveDefaultTerminalUser;
  resolveWorkspaceRoot: ResolveWorkspaceRoot;
  runtimeAdapter: RuntimeAdapterLike;
  scheduleRuntimeEventWatchdog: ScheduleRuntimeEventWatchdog;
  streamDelivery: StreamDeliveryLike;
}
