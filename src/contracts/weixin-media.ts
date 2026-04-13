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
