export type WeixinMediaKind = "image" | "video" | "file";

export interface WeixinUploadUrlRequest extends Record<string, unknown> {
  baseUrl: string;
  token: string;
  filekey?: string;
  media_type?: number;
  to_user_id?: string;
  rawsize?: number;
  rawfilemd5?: string;
  filesize?: number;
  thumb_rawsize?: number;
  thumb_rawfilemd5?: string;
  thumb_filesize?: number;
  no_need_thumb?: boolean;
  aeskey?: string;
  timeoutMs?: number;
  routeTag?: string;
  clientVersion?: string;
}

export interface WeixinSendMessageRequest extends Record<string, unknown> {
  baseUrl: string;
  token: string;
  body: Record<string, unknown>;
  timeoutMs?: number;
  routeTag?: string;
  clientVersion?: string;
}

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
  getUploadUrlImpl: (args: WeixinUploadUrlRequest) => Promise<Record<string, unknown>>;
  sendMessageImpl: (args: WeixinSendMessageRequest) => Promise<unknown>;
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
