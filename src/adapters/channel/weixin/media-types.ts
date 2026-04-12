export type WeixinMediaKind = "image" | "video" | "file";

export interface IncomingWeixinMediaRef {
  encryptQueryParam?: string;
  fileKey?: string;
  encryptType?: number;
  aesKeyHex?: string;
  aesKey?: string;
}

export interface IncomingWeixinAttachment {
  kind?: WeixinMediaKind;
  fileName?: string;
  directUrls?: string[];
  mediaRef?: IncomingWeixinMediaRef | null;
  index?: number;
}

export interface PersistedIncomingWeixinAttachment {
  kind: WeixinMediaKind;
  sourceFileName: string;
  fileName: string;
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
}

export interface PersistedIncomingWeixinAttachmentFailure {
  kind: WeixinMediaKind;
  sourceFileName: string;
  reason: string;
}

export interface PersistIncomingWeixinAttachmentsArgs {
  attachments: IncomingWeixinAttachment[];
  stateDir: string;
  cdnBaseUrl: unknown;
  messageId?: string;
  receivedAt?: string;
  workspaceRoot: string;
}

export interface PersistIncomingWeixinAttachmentsResult {
  saved: PersistedIncomingWeixinAttachment[];
  failed: PersistedIncomingWeixinAttachmentFailure[];
}

export interface WeixinMediaApi {
  getUploadUrlImpl: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  sendMessageImpl: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface SendWeixinMediaFileArgs {
  filePath: string;
  to: string;
  contextToken: string;
  baseUrl: string;
  token: string;
  cdnBaseUrl: string;
  apiVariant?: string;
  routeTag?: string;
  clientVersion?: string;
  mediaApiOverride?: WeixinMediaApi | null;
  mediaApiFallbackOverride?: WeixinMediaApi | null;
}

export interface WeixinImageSendResult {
  kind: "image";
  fileName: string;
}

export interface WeixinVideoSendResult {
  kind: "video";
  fileName: string;
}

export interface WeixinFileSendResult {
  kind: "file";
  fileName: string;
  fallbackFrom?: "image";
  uploadStrategy?: "primary" | "fallback";
}

export type SendWeixinMediaFileResult =
  | WeixinImageSendResult
  | WeixinVideoSendResult
  | WeixinFileSendResult;
