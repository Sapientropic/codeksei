import type {
  IncomingWeixinAttachment,
  IncomingWeixinMediaRef,
  PersistIncomingWeixinAttachmentsArgs,
  PersistIncomingWeixinAttachmentsResult,
  PersistedIncomingWeixinAttachment,
  PersistedIncomingWeixinAttachmentFailure,
  WeixinMediaKind,
} from "../../../contracts/weixin-media";

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

export type {
  IncomingWeixinAttachment,
  IncomingWeixinMediaRef,
  PersistIncomingWeixinAttachmentsArgs,
  PersistIncomingWeixinAttachmentsResult,
  PersistedIncomingWeixinAttachment,
  PersistedIncomingWeixinAttachmentFailure,
  WeixinMediaKind,
};
