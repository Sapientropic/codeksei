import type {
  CodekseiChannel,
  CodekseiChannelProvider,
  CodekseiRuntimeAccessMode,
  CodekseiRuntimeProvider,
  WeixinReplyMode,
} from "./config-value-types";
import type { ReviewSemanticHost } from "./review-semantic-host-policy";

export interface WorkspacePathsConfig {
  stateDir: string;
  codekseiHome: string;
  workspaceId: string;
  workspaceRoot: string;
  diaryDir: string;
  timelineStateDir: string;
  logDir: string;
  reminderQueueFile: string;
  timelineScreenshotQueueFile: string;
  cliIdempotencyLedgerFile: string;
  syncBufferDir: string;
  sessionsFile: string;
  sharedBridgeHeartbeatFile: string;
  sharedWatchdogStateFile: string;
}

export interface IdentityAndTimeConfig {
  timezone: string;
  timezoneSource: string;
  timezoneExplicit: boolean;
  timelineStateTimezone: string;
  userName: string;
  userGender: string;
  userLanguage?: string;
  allowedUserIds: string[];
}

export interface WeixinBridgeConfig {
  accountId: string;
  accountsDir: string;
  weixinBaseUrl: string;
  weixinCdnBaseUrl: string;
  weixinReplyMode: WeixinReplyMode;
  weixinDeliveryTrace: boolean;
  weixinQrBotType: string;
  weixinRouteTag: string;
  weixinProtocolClientVersion: string;
}

export interface RuntimeHostConfig {
  channel: CodekseiChannel;
  channelProvider: CodekseiChannelProvider;
  runtime: CodekseiRuntimeProvider;
  runtimeEndpoint: string;
  runtimeCommand: string;
  runtimeAccessMode: CodekseiRuntimeAccessMode;
  codexAccessMode: CodekseiRuntimeAccessMode;
  hermesCommand: string;
  hermesHome: string;
  hermesRepoRoot: string;
  hermesRepoLocalShimPath: string;
  hermesPythonCommand: string;
}

export interface SchemaAndTemplateConfig {
  weixinInstructionsFile: string;
  weixinInstructionsOverlayFile: string;
  weixinOperationsFile: string;
  weixinOperationsOverlayFile: string;
  workspaceBootstrapConfigFile: string;
  projectRadarConfigFile: string;
  durableNoteSchemaConfigFile: string;
  reviewSchemaConfigFile: string;
  reviewSemanticMode: string;
  reviewSemanticHost: ReviewSemanticHost;
  reviewSemanticModel: string;
  reviewSemanticTimeoutMs: number;
  companionSemanticMode: string;
  companionSemanticHost: ReviewSemanticHost | "";
  companionSemanticModel: string;
  companionSemanticTimeoutMs: number;
  onboardingSemanticMode: string;
  onboardingSemanticHost: ReviewSemanticHost | "";
  onboardingSemanticModel: string;
  onboardingSemanticTimeoutMs: number;
}

export interface CheckinRuntimeConfig extends Pick<WorkspacePathsConfig, "workspaceId" | "workspaceRoot">, Pick<IdentityAndTimeConfig, "allowedUserIds" | "userName"> {
  checkinConfigFile: string;
  checkinScheduleStateFile: string;
  systemMessageQueueFile: string;
  systemMessageDeadLetterFile: string;
  startWithCheckin: boolean;
}

export interface AppRuntimeConfigSlices {
  workspacePaths: WorkspacePathsConfig;
  identityAndTime: IdentityAndTimeConfig;
  weixinBridge: WeixinBridgeConfig;
  runtimeHost: RuntimeHostConfig;
  schemaAndTemplate: SchemaAndTemplateConfig;
  checkinRuntime: CheckinRuntimeConfig;
}

export type CombinedAppRuntimeConfig =
  & WorkspacePathsConfig
  & IdentityAndTimeConfig
  & WeixinBridgeConfig
  & RuntimeHostConfig
  & SchemaAndTemplateConfig
  & CheckinRuntimeConfig;

export function composeAppRuntimeConfig(slices: AppRuntimeConfigSlices): CombinedAppRuntimeConfig {
  return {
    ...slices.workspacePaths,
    ...slices.identityAndTime,
    ...slices.weixinBridge,
    ...slices.runtimeHost,
    ...slices.schemaAndTemplate,
    ...slices.checkinRuntime,
  };
}
