const MESSAGE_TYPE_USER = 1;
const MESSAGE_TYPE_BOT = 2;
const MESSAGE_ITEM_TEXT = 1;
const MESSAGE_ITEM_IMAGE = 2;
const MESSAGE_ITEM_VOICE = 3;
const MESSAGE_ITEM_FILE = 4;
const MESSAGE_ITEM_VIDEO = 5;
const DEDUP_TTL_MS = 5 * 60_000;

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

function createInboundFilter() {
  const seen = new Map<string, number>();

  return {
    normalize(message: unknown, config: WeixinIncomingConfig, accountId: unknown) {
      if (!isRecord(message)) {
        return null;
      }
      const messageType = Number(message.message_type);
      if (messageType === MESSAGE_TYPE_BOT) {
        return null;
      }
      if (messageType !== 0 && messageType !== MESSAGE_TYPE_USER) {
        return null;
      }

      const senderId = normalizeText(message.from_user_id);
      if (!senderId) {
        return null;
      }

      const createdAtMs = normalizeMessageTimestampMs(message);

      const dedupKey = buildDedupKey(message, senderId, createdAtMs);
      pruneSeen(seen);
      if (dedupKey && seen.has(dedupKey)) {
        return null;
      }
      if (dedupKey) {
        seen.set(dedupKey, Date.now());
      }

      const itemList = Array.isArray(message.item_list) ? message.item_list : [];
      const text = bodyFromItemList(itemList);
      const attachments = extractAttachmentItems(itemList);
      if (!text && !attachments.length) {
        return null;
      }

      return {
        provider: "weixin",
        accountId,
        workspaceId: config.workspaceId,
        senderId,
        chatId: senderId,
        messageId: normalizeMessageId(message),
        threadKey: normalizeText(message.session_id),
        text,
        attachments,
        contextToken: normalizeText(message.context_token),
        receivedAt: createdAtMs > 0 ? new Date(createdAtMs).toISOString() : new Date().toISOString(),
      };
    },
  };
}

function bodyFromItemList(items: unknown): string {
  if (!Array.isArray(items) || !items.length) {
    return "";
  }
  for (const item of items) {
    const itemType = Number(item?.type);
    if (itemType === MESSAGE_ITEM_TEXT) {
      const text = normalizeText(item?.text_item?.text);
      if (!text) {
        continue;
      }
      const ref = item?.ref_msg;
      if (!ref || !ref.message_item || isMediaItemType(Number(ref.message_item.type))) {
        return text;
      }
      const parts: string[] = [];
      const refTitle = normalizeText(ref.title);
      if (refTitle) {
        parts.push(refTitle);
      }
      const refBody = bodyFromItemList([ref.message_item]);
      if (refBody) {
        parts.push(refBody);
      }
      if (!parts.length) {
        return text;
      }
      return `[引用: ${parts.join(" | ")}]\n${text}`;
    }
    if (itemType === MESSAGE_ITEM_VOICE) {
      const voiceText = normalizeText(item?.voice_item?.text);
      if (voiceText) {
        return voiceText;
      }
    }
  }
  return "";
}

function isMediaItemType(type: number): boolean {
  return type === MESSAGE_ITEM_IMAGE || type === MESSAGE_ITEM_VOICE || type === MESSAGE_ITEM_FILE || type === MESSAGE_ITEM_VIDEO;
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
  if (itemType === MESSAGE_ITEM_IMAGE && isRecord(item.image_item)) {
    const imageItem = item.image_item as LooseRecord;
    return { kind: "image", body: imageItem, media: isRecord(imageItem.media) ? imageItem.media : {} };
  }
  if (itemType === MESSAGE_ITEM_FILE && isRecord(item.file_item)) {
    const fileItem = item.file_item as LooseRecord;
    return { kind: "file", body: fileItem, media: isRecord(fileItem.media) ? fileItem.media : {} };
  }
  if (itemType === MESSAGE_ITEM_VIDEO && isRecord(item.video_item)) {
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

function normalizeMessageId(message: LooseRecord): string {
  const raw = message?.message_id;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  if (typeof raw === "string") {
    return raw.trim();
  }
  return "";
}

function normalizeMessageTimestampMs(message: LooseRecord): number {
  const rawMs = Number(message?.create_time_ms);
  if (Number.isFinite(rawMs) && rawMs > 0) {
    return rawMs;
  }
  const rawSeconds = Number(message?.create_time);
  if (Number.isFinite(rawSeconds) && rawSeconds > 0) {
    return rawSeconds * 1000;
  }
  return 0;
}

function buildDedupKey(message: LooseRecord, senderId: string, createdAtMs: number): string {
  const seq = normalizeNumeric(message?.seq);
  const messageId = normalizeNumeric(message?.message_id);
  const clientId = normalizeText(message?.client_id);
  const parts = [senderId, messageId, seq, createdAtMs || 0, clientId];
  return parts.join("|");
}

function normalizeNumeric(value: unknown): string {
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : "0";
}

function pruneSeen(seen: Map<string, number>): void {
  const now = Date.now();
  for (const [key, timestamp] of seen.entries()) {
    if (now - timestamp > DEDUP_TTL_MS) {
      seen.delete(key);
    }
  }
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is LooseRecord {
  return Boolean(value) && typeof value === "object";
}

export {
  createInboundFilter,
  bodyFromItemList,
};
