const TEXT_ITEM_TYPE = 1;
const IMAGE_ITEM_TYPE = 2;
const VOICE_ITEM_TYPE = 3;
const FILE_ITEM_TYPE = 4;
const VIDEO_ITEM_TYPE = 5;
const BOT_MESSAGE_TYPE = 2;

type LooseRecord = Record<string, unknown>;

interface WeixinIncomingConfig extends Record<string, unknown> {
  workspaceId?: unknown;
}

interface WeixinAttachmentPayload {
  kind: "image" | "file" | "video";
  body: LooseRecord;
  media: LooseRecord;
}

interface WeixinAttachmentItem {
  kind: "image" | "file" | "video";
  itemType: number;
  index: number;
  fileName: string;
  sizeBytes: number;
  directUrls: string[];
  mediaRef: {
    encryptQueryParam: string;
    aesKey: string;
    aesKeyHex: string;
    encryptType: number;
    fileKey: string;
  };
  rawItem: LooseRecord;
}

function normalizeWeixinIncomingMessage(
  message: unknown,
  config: WeixinIncomingConfig,
  accountId: unknown,
) {
  if (!isRecord(message)) {
    return null;
  }
  if (Number(message.message_type) === BOT_MESSAGE_TYPE) {
    return null;
  }

  const senderId = normalizeText(message.from_user_id);
  if (!senderId) {
    return null;
  }

  const text = extractTextBody(message.item_list);
  const attachments = extractAttachmentItems(message.item_list);
  if (!text && !attachments.length) {
    return null;
  }

  return {
    provider: "weixin",
    accountId: normalizeText(accountId),
    workspaceId: normalizeText(config.workspaceId),
    senderId,
    command: "message",
    chatId: senderId,
    messageId: normalizeText(message.message_id),
    threadKey: normalizeText(message.session_id),
    text,
    attachments,
    contextToken: normalizeText(message.context_token),
    receivedAt: resolveReceivedAt(message),
  };
}

function extractTextBody(itemList: unknown): string {
  if (!Array.isArray(itemList) || !itemList.length) {
    return "";
  }

  for (const item of itemList) {
    if (Number(item?.type) === TEXT_ITEM_TYPE && typeof item?.text_item?.text === "string") {
      return item.text_item.text.trim();
    }
    if (Number(item?.type) === VOICE_ITEM_TYPE && typeof item?.voice_item?.text === "string") {
      return item.voice_item.text.trim();
    }
  }

  return "";
}

function extractAttachmentItems(itemList: unknown): WeixinAttachmentItem[] {
  if (!Array.isArray(itemList) || !itemList.length) {
    return [];
  }

  const attachments: WeixinAttachmentItem[] = [];
  for (let index = 0; index < itemList.length; index += 1) {
    const normalized = normalizeAttachmentItem(itemList[index], index);
    if (normalized) {
      attachments.push(normalized);
    }
  }

  return attachments;
}

function normalizeAttachmentItem(item: unknown, index: number): WeixinAttachmentItem | null {
  const record = isRecord(item) ? item : null;
  if (!record) {
    return null;
  }
  const itemType = Number(record.type);
  const payload = resolveAttachmentPayload(itemType, record);
  if (!payload) {
    return null;
  }

  const media = payload.media;

  return {
    kind: payload.kind,
    itemType,
    index,
    fileName: normalizeText(
      payload.body?.file_name
      || payload.body?.filename
      || record.file_name
      || record.filename
    ),
    sizeBytes: parseOptionalInt(
      payload.body?.len
      || payload.body?.file_size
      || payload.body?.size
      || payload.body?.video_size
      || record.len
    ),
    directUrls: collectStringValues([
      payload.body?.url,
      payload.body?.download_url,
      payload.body?.cdn_url,
      media?.url,
      media?.download_url,
      media?.cdn_url,
    ]),
    mediaRef: {
      encryptQueryParam: normalizeText(
        media?.encrypt_query_param
        || media?.encrypted_query_param
        || payload.body?.encrypt_query_param
        || payload.body?.encrypted_query_param
        || record.encrypt_query_param
        || record.encrypted_query_param
      ),
      aesKey: normalizeText(
        media?.aes_key
        || payload.body?.aes_key
        || record.aes_key
      ),
      aesKeyHex: normalizeText(
        payload.body?.aeskey
        || payload.body?.aes_key_hex
        || record.aeskey
      ),
      encryptType: Number(
        media?.encrypt_type
        ?? payload.body?.encrypt_type
        ?? record.encrypt_type
        ?? 1
      ),
      fileKey: normalizeText(
        media?.filekey
        || payload.body?.filekey
        || record.filekey
      ),
    },
    rawItem: record,
  };
}

function resolveAttachmentPayload(itemType: number, item: LooseRecord): WeixinAttachmentPayload | null {
  if (itemType === IMAGE_ITEM_TYPE && isRecord(item.image_item)) {
    const imageItem = item.image_item as LooseRecord;
    return { kind: "image", body: imageItem, media: isRecord(imageItem.media) ? imageItem.media : {} };
  }
  if (itemType === FILE_ITEM_TYPE && isRecord(item.file_item)) {
    const fileItem = item.file_item as LooseRecord;
    return { kind: "file", body: fileItem, media: isRecord(fileItem.media) ? fileItem.media : {} };
  }
  if (itemType === VIDEO_ITEM_TYPE && isRecord(item.video_item)) {
    const videoItem = item.video_item as LooseRecord;
    return { kind: "video", body: videoItem, media: isRecord(videoItem.media) ? videoItem.media : {} };
  }
  return null;
}

function collectStringValues(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function parseOptionalInt(value: unknown): number {
  if (value == null || value === "") {
    return 0;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolveReceivedAt(message: LooseRecord): string {
  const rawMs = Number(message?.create_time_ms);
  if (Number.isFinite(rawMs) && rawMs > 0) {
    return new Date(rawMs).toISOString();
  }
  const rawSeconds = Number(message?.create_time);
  if (Number.isFinite(rawSeconds) && rawSeconds > 0) {
    return new Date(rawSeconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function isRecord(value: unknown): value is LooseRecord {
  return Boolean(value) && typeof value === "object";
}

export {
  normalizeWeixinIncomingMessage,
};
