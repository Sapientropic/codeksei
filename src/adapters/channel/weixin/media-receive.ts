import { normalizeText } from "../../../core/text-normalization";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  IncomingWeixinAttachment,
  PersistIncomingWeixinAttachmentsArgs,
  PersistIncomingWeixinAttachmentsResult,
  PersistedIncomingWeixinAttachment,
  PersistedIncomingWeixinAttachmentFailure,
  WeixinMediaKind,
} from "./media-types";

const DEFAULT_INBOX_DIR = "inbox";
const MAX_FILE_NAME_LENGTH = 120;

interface DownloadedAttachmentPayload {
  bytes: Buffer;
  contentType: string;
}

async function persistIncomingWeixinAttachments({
  attachments,
  stateDir,
  cdnBaseUrl,
  messageId = "",
  receivedAt = "",
  workspaceRoot,
}: PersistIncomingWeixinAttachmentsArgs): Promise<PersistIncomingWeixinAttachmentsResult> {
  void workspaceRoot;

  const saved: PersistedIncomingWeixinAttachment[] = [];
  const failed: PersistedIncomingWeixinAttachmentFailure[] = [];

  for (const attachment of attachments) {
    try {
      const persisted = await persistSingleAttachment({
        attachment,
        stateDir,
        cdnBaseUrl,
        messageId,
        receivedAt,
      });
      saved.push(persisted);
    } catch (error) {
      failed.push({
        kind: normalizeAttachmentKind(attachment.kind),
        sourceFileName: normalizeText(attachment.fileName),
        reason: formatErrorMessage(error) || "unknown attachment error",
      });
    }
  }

  return { saved, failed };
}

async function persistSingleAttachment({
  attachment,
  stateDir,
  cdnBaseUrl,
  messageId,
  receivedAt,
}: {
  attachment: IncomingWeixinAttachment;
  stateDir: string;
  cdnBaseUrl: unknown;
  messageId: string;
  receivedAt: string;
}): Promise<PersistedIncomingWeixinAttachment> {
  const download = await downloadAttachmentPayload(attachment, cdnBaseUrl);
  const plaintext = decodeAttachmentPayload(download.bytes, attachment, download.contentType);
  const fileName = buildTargetFileName({
    attachment,
    plaintext,
    contentType: download.contentType,
    messageId,
  });
  const targetDir = buildInboxDirectory(stateDir, receivedAt);
  const absolutePath = await writeUniqueFile(targetDir, fileName, plaintext);
  const relativePath = path.relative(stateDir, absolutePath).replace(/\\/g, "/");

  return {
    kind: normalizeAttachmentKind(attachment.kind),
    sourceFileName: normalizeText(attachment.fileName),
    fileName: path.basename(absolutePath),
    absolutePath,
    relativePath,
    sizeBytes: plaintext.length,
  };
}

function buildInboxDirectory(stateDir: string, receivedAt: string): string {
  const day = normalizeDateFolder(receivedAt);
  return path.join(stateDir, DEFAULT_INBOX_DIR, day);
}

function normalizeDateFolder(receivedAt: unknown): string {
  const date = receivedAt ? new Date(String(receivedAt)) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

async function downloadAttachmentPayload(
  attachment: IncomingWeixinAttachment,
  cdnBaseUrl: unknown,
): Promise<DownloadedAttachmentPayload> {
  const candidates = buildDownloadCandidates(attachment, cdnBaseUrl);
  if (!candidates.length) {
    throw new Error("attachment did not include a supported download reference");
  }

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        method: "GET",
        headers: {
          Accept: "*/*",
        },
      });
      if (!response.ok) {
        lastError = new Error(`download failed with HTTP ${response.status}`);
        continue;
      }

      const arrayBuffer = await response.arrayBuffer();
      return {
        bytes: Buffer.from(arrayBuffer),
        contentType: normalizeContentType(response.headers.get("content-type")),
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("attachment download failed");
}

function buildDownloadCandidates(attachment: IncomingWeixinAttachment, cdnBaseUrl: unknown): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const directUrls = Array.isArray(attachment.directUrls) ? attachment.directUrls : [];
  for (const directUrl of directUrls) {
    addCandidate(candidates, seen, directUrl);
  }

  const encryptedQueryParam = normalizeText(attachment.mediaRef?.encryptQueryParam);
  if (encryptedQueryParam) {
    const normalizedCdnBaseUrl = String(cdnBaseUrl || "").replace(/\/+$/g, "");
    addCandidate(
      candidates,
      seen,
      `${normalizedCdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}`,
    );

    const fileKey = normalizeText(attachment.mediaRef?.fileKey);
    if (fileKey) {
      addCandidate(
        candidates,
        seen,
        `${normalizedCdnBaseUrl}/download?encrypted_query_param=${encodeURIComponent(encryptedQueryParam)}&filekey=${encodeURIComponent(fileKey)}`,
      );
    }
  }

  return candidates;
}

function addCandidate(candidates: string[], seen: Set<string>, rawUrl: unknown): void {
  const normalizedUrl = normalizeText(rawUrl);
  if (!normalizedUrl || seen.has(normalizedUrl)) {
    return;
  }
  seen.add(normalizedUrl);
  candidates.push(normalizedUrl);
}

function decodeAttachmentPayload(bytes: Buffer, attachment: IncomingWeixinAttachment, contentType: string): Buffer {
  const encryptType = Number(attachment.mediaRef?.encryptType);
  const keyCandidates = buildAesKeyCandidates(attachment);
  if (encryptType !== 1 || keyCandidates.length === 0) {
    return bytes;
  }

  for (const key of keyCandidates) {
    try {
      return decryptAesEcb(bytes, key);
    } catch {
      // Try the next key encoding variant.
    }
  }

  if (looksLikePlainMedia(bytes, contentType)) {
    return bytes;
  }

  throw new Error("failed to decrypt attachment payload");
}

function buildAesKeyCandidates(attachment: IncomingWeixinAttachment): Buffer[] {
  const candidates: Buffer[] = [];
  const seen = new Set<string>();
  const rawValues = [
    attachment.mediaRef?.aesKeyHex,
    attachment.mediaRef?.aesKey,
  ];

  for (const rawValue of rawValues) {
    const variants = decodeAesKeyVariants(rawValue);
    for (const variant of variants) {
      const signature = variant.toString("hex");
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      candidates.push(variant);
    }
  }

  return candidates;
}

function decodeAesKeyVariants(value: unknown): Buffer[] {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }

  const candidates: Buffer[] = [];
  if (/^[0-9a-f]{32}$/i.test(normalized)) {
    candidates.push(Buffer.from(normalized, "hex"));
  }
  if (normalized.length === 16) {
    candidates.push(Buffer.from(normalized, "utf8"));
  }

  try {
    const decoded = Buffer.from(normalized, "base64");
    if (decoded.length === 16) {
      candidates.push(decoded);
    } else {
      const decodedText = decoded.toString("utf8").trim();
      if (/^[0-9a-f]{32}$/i.test(decodedText)) {
        candidates.push(Buffer.from(decodedText, "hex"));
      }
    }
  } catch {
    // Ignore invalid base64 variants.
  }

  return candidates.filter((candidate) => candidate.length === 16);
}

function decryptAesEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(true);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function looksLikePlainMedia(bytes: Buffer, contentType: string): boolean {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    return false;
  }

  if (contentType.startsWith("text/")) {
    return true;
  }

  return detectExtensionFromBuffer(bytes) !== "";
}

function buildTargetFileName({
  attachment,
  plaintext,
  contentType,
  messageId,
}: {
  attachment: IncomingWeixinAttachment;
  plaintext: Buffer;
  contentType: string;
  messageId: string;
}): string {
  const sourceName = sanitizeFileName(attachment.fileName);
  if (sourceName) {
    const existingExt = path.extname(sourceName);
    if (existingExt) {
      return sourceName;
    }

    const inferredExt = inferExtension(attachment.kind
      ? {
        contentType,
        plaintext,
        kind: attachment.kind,
      }
      : {
        contentType,
        plaintext,
      });
    return `${sourceName}${inferredExt}`;
  }

  const baseName = sanitizeFileName([
    normalizeAttachmentKind(attachment.kind),
    messageId || Date.now(),
    String((Number(attachment.index) || 0) + 1),
  ].join("-"));
  const inferredExt = inferExtension(attachment.kind
    ? {
      contentType,
      plaintext,
      kind: attachment.kind,
    }
    : {
      contentType,
      plaintext,
    });
  return `${baseName || "attachment"}${inferredExt}`;
}

function inferExtension({
  contentType,
  plaintext,
  kind,
}: {
  contentType: string;
  plaintext: Buffer;
  kind?: WeixinMediaKind;
}): string {
  const contentTypeExt = extensionFromContentType(contentType);
  if (contentTypeExt) {
    return contentTypeExt;
  }

  const bufferExt = detectExtensionFromBuffer(plaintext);
  if (bufferExt) {
    return bufferExt;
  }

  if (kind === "image") {
    return ".png";
  }
  if (kind === "video") {
    return ".mp4";
  }
  return ".bin";
}

function extensionFromContentType(contentType: string): string {
  const normalized = normalizeContentType(contentType);
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
  };
  return map[normalized] || "";
}

function detectExtensionFromBuffer(buffer: Buffer): string {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return "";
  }

  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
    return ".png";
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([0xFF, 0xD8, 0xFF]))) {
    return ".jpg";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "GIF8") {
    return ".gif";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return ".webp";
  }
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    return ".mp4";
  }
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return ".pdf";
  }
  return "";
}

function sanitizeFileName(value: unknown): string {
  const parsed = path.parse(String(value || "").trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-"));
  const safeBaseName = parsed.name || "attachment";
  const safeExt = parsed.ext || "";
  return `${safeBaseName.slice(0, MAX_FILE_NAME_LENGTH)}${safeExt.slice(0, 16)}`;
}

async function writeUniqueFile(targetDir: string, fileName: string, plaintext: Buffer): Promise<string> {
  await fs.mkdir(targetDir, { recursive: true });
  const parsed = path.parse(fileName);
  const baseName = parsed.name || "attachment";
  const extension = parsed.ext || "";
  for (let index = 0; index < 50; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = path.join(targetDir, `${baseName}${suffix}${extension}`);
    try {
      await fs.writeFile(candidate, plaintext, { flag: "wx" });
      return candidate;
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error;
      }
    }
  }

  throw new Error("unable to allocate a unique attachment file name");
}

function normalizeAttachmentKind(value: unknown): WeixinMediaKind {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "image" || normalized === "video" || normalized === "file") {
    return normalized;
  }
  return "file";
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error)
    && typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "EEXIST";
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || String(error);
  }
  return String(error || "");
}

function normalizeContentType(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const [firstPart = ""] = value.split(";");
  return firstPart.trim().toLowerCase();
}

export {
  persistIncomingWeixinAttachments,
};

