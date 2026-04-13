import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logWarn } from "../../../core/logging";
import { getUploadUrl, sendMessage } from "./api";
import { getUploadUrlV2, sendMessageV2 } from "./api-v2";
import { getMimeFromFilename } from "./media-mime";
import type {
  SendWeixinMediaFileArgs,
  SendWeixinMediaFileResult,
  WeixinFileSendResult,
  WeixinMediaApi,
} from "./media-types";


const WEIXIN_MEDIA_TYPE = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
} as const;

interface UploadedMedia {
  downloadEncryptedQueryParam: string;
  aeskey: string;
  fileSize: number;
  fileSizeCiphertext: number;
}

interface UploadMediaArgs {
  filePath: string;
  toUserId: string;
  opts: {
    baseUrl: string;
    token: string;
    routeTag?: string;
    clientVersion?: string;
  };
  cdnBaseUrl: string;
  mediaType: number;
  getUploadUrlImpl: WeixinMediaApi["getUploadUrlImpl"];
}

interface SendMediaItemArgs {
  to: string;
  item: Record<string, unknown>;
  contextToken: string;
  baseUrl: string;
  token: string;
  routeTag?: string;
  clientVersion?: string;
  sendMessageImpl: WeixinMediaApi["sendMessageImpl"];
}

interface SendFileFallbackArgs {
  filePath: string;
  to: string;
  contextToken: string;
  baseUrl: string;
  token: string;
  routeTag: string;
  clientVersion: string;
  uploadOpts: {
    baseUrl: string;
    token: string;
    routeTag?: string;
    clientVersion?: string;
  };
  cdnBaseUrl: string;
  primaryMediaApi: WeixinMediaApi;
  fallbackMediaApi?: WeixinMediaApi | null;
  fallbackFrom?: "" | "image";
}

function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

function buildCdnUploadUrl({
  cdnBaseUrl,
  uploadParam,
  filekey,
}: {
  cdnBaseUrl: string;
  uploadParam: string;
  filekey: string;
}): string {
  return `${cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(uploadParam)}&filekey=${encodeURIComponent(filekey)}`;
}

function resolveCdnUploadUrl({
  cdnBaseUrl,
  uploadFullUrl,
  uploadParam,
  filekey,
}: {
  cdnBaseUrl: string;
  uploadFullUrl?: string | undefined;
  uploadParam?: string | undefined;
  filekey: string;
}): string {
  const normalizedFullUrl = String(uploadFullUrl || "").trim();
  if (normalizedFullUrl) {
    return normalizedFullUrl;
  }
  const normalizedUploadParam = String(uploadParam || "").trim();
  if (normalizedUploadParam) {
    return buildCdnUploadUrl({
      cdnBaseUrl,
      uploadParam: normalizedUploadParam,
      filekey,
    });
  }
  throw new Error("getUploadUrl returned neither upload_full_url nor upload_param");
}

async function uploadBufferToCdn({
  buf,
  uploadFullUrl,
  uploadParam,
  filekey,
  cdnBaseUrl,
  aeskey,
}: {
  buf: Buffer;
  uploadFullUrl?: string | undefined;
  uploadParam?: string | undefined;
  filekey: string;
  cdnBaseUrl: string;
  aeskey: Buffer;
}): Promise<{ downloadParam: string }> {
  const ciphertext = encryptAesEcb(buf, aeskey);
  const cdnUrl = resolveCdnUploadUrl({
    cdnBaseUrl,
    uploadFullUrl,
    uploadParam,
    filekey,
  });
  const response = await fetch(cdnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(ciphertext),
  });
  if (response.status !== 200) {
    const errMsg = response.headers.get("x-error-message") || await response.text();
    throw new Error(`CDN upload failed: ${errMsg || response.status}`);
  }
  const downloadParam = response.headers.get("x-encrypted-param") || "";
  if (!downloadParam) {
    throw new Error("CDN upload response missing x-encrypted-param header");
  }
  return { downloadParam };
}

async function uploadMediaToWeixin({
  filePath,
  toUserId,
  opts,
  cdnBaseUrl,
  mediaType,
  getUploadUrlImpl,
}: UploadMediaArgs): Promise<UploadedMedia> {
  const plaintext = await fs.readFile(filePath);
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString("hex");
  const aeskey = crypto.randomBytes(16);

  const uploadUrlResp = await getUploadUrlImpl({
    ...opts,
    filekey,
    media_type: mediaType,
    to_user_id: toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString("hex"),
  });

  const uploadFullUrl = typeof uploadUrlResp?.upload_full_url === "string"
    ? uploadUrlResp.upload_full_url
    : "";
  const uploadParam = typeof uploadUrlResp?.upload_param === "string" ? uploadUrlResp.upload_param : "";
  if (!uploadFullUrl && !uploadParam) {
    throw new Error("getUploadUrl returned neither upload_full_url nor upload_param");
  }

  const { downloadParam } = await uploadBufferToCdn({
    buf: plaintext,
    uploadFullUrl,
    uploadParam,
    filekey,
    cdnBaseUrl,
    aeskey,
  });

  return {
    downloadEncryptedQueryParam: downloadParam,
    aeskey: aeskey.toString("hex"),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
  };
}

function buildMediaRef(uploaded: UploadedMedia): Record<string, unknown> {
  return {
    encrypt_query_param: uploaded.downloadEncryptedQueryParam,
    aes_key: Buffer.from(uploaded.aeskey).toString("base64"),
    encrypt_type: 1,
  };
}

async function sendMediaItem({
  to,
  item,
  contextToken,
  baseUrl,
  token,
  routeTag = "",
  clientVersion = "",
  sendMessageImpl,
}: SendMediaItemArgs): Promise<void> {
  await sendMessageImpl({
    baseUrl,
    token,
    routeTag,
    clientVersion,
    body: {
      msg: {
        from_user_id: "",
        to_user_id: to,
        client_id: crypto.randomUUID(),
        message_type: 2,
        message_state: 2,
        item_list: [item],
        context_token: contextToken,
      },
    },
  });
}

function resolveWeixinMediaApi(apiVariant: unknown): WeixinMediaApi {
  if (String(apiVariant || "").trim().toLowerCase() === "v2") {
    // Upload URL lookup and the final sendmessage call must stay on the same
    // v2 header stack as text polling/sending, or routed sessions may split
    // across gateways after login and fail only on attachments.
    return {
      getUploadUrlImpl: getUploadUrlV2,
      sendMessageImpl: sendMessageV2,
    };
  }
  return {
    getUploadUrlImpl: getUploadUrl,
    sendMessageImpl: sendMessage,
  };
}

async function sendWeixinMediaFile({
  filePath,
  to,
  contextToken,
  baseUrl,
  token,
  cdnBaseUrl,
  apiVariant = "legacy",
  routeTag = "",
  clientVersion = "",
  mediaApiOverride = null,
  mediaApiFallbackOverride = null,
}: SendWeixinMediaFileArgs): Promise<SendWeixinMediaFileResult> {
  if (!contextToken) {
    throw new Error("sendWeixinMediaFile requires contextToken");
  }

  const mime = getMimeFromFilename(filePath);
  const uploadOpts = { baseUrl, token, routeTag, clientVersion };
  const primaryMediaApi = mediaApiOverride || resolveWeixinMediaApi(apiVariant);
  const fallbackMediaApi = mediaApiFallbackOverride
    || (mediaApiOverride ? null : resolveFallbackWeixinMediaApi(apiVariant));
  const { getUploadUrlImpl, sendMessageImpl } = primaryMediaApi;

  if (mime.startsWith("image/")) {
    try {
      const uploaded = await uploadMediaToWeixin({
        filePath,
        toUserId: to,
        opts: uploadOpts,
        cdnBaseUrl,
        mediaType: WEIXIN_MEDIA_TYPE.IMAGE,
        getUploadUrlImpl,
      });
      await sendMediaItem({
        to,
        contextToken,
        baseUrl,
        token,
        routeTag,
        clientVersion,
        sendMessageImpl,
        item: {
          type: 2,
          image_item: {
            media: buildMediaRef(uploaded),
            aeskey: uploaded.aeskey,
            mid_size: uploaded.fileSizeCiphertext,
            hd_size: uploaded.fileSizeCiphertext,
          },
        },
      });
      return { kind: "image", fileName: path.basename(filePath) };
    } catch (error) {
      if (!isMissingUploadParamError(error)) {
        throw error;
      }
      // Some routed sessions refuse image upload params but still accept
      // generic file uploads. Falling back keeps screenshot delivery alive
      // instead of failing the whole "send back the screenshot" flow.
      return sendFileFallback({
        filePath,
        to,
        contextToken,
        baseUrl,
        token,
        routeTag,
        clientVersion,
        uploadOpts,
        cdnBaseUrl,
        primaryMediaApi,
        fallbackMediaApi,
        fallbackFrom: "image",
      });
    }
  }

  if (mime.startsWith("video/")) {
    const uploaded = await uploadMediaToWeixin({
      filePath,
      toUserId: to,
      opts: uploadOpts,
      cdnBaseUrl,
      mediaType: WEIXIN_MEDIA_TYPE.VIDEO,
      getUploadUrlImpl,
    });
    await sendMediaItem({
      to,
      contextToken,
      baseUrl,
      token,
      routeTag,
      clientVersion,
      sendMessageImpl,
      item: {
        type: 5,
        video_item: {
          media: buildMediaRef(uploaded),
          video_size: uploaded.fileSizeCiphertext,
        },
      },
    });
    return { kind: "video", fileName: path.basename(filePath) };
  }

  return sendFileFallback({
    filePath,
    to,
    contextToken,
    baseUrl,
    token,
    routeTag,
    clientVersion,
    uploadOpts,
    cdnBaseUrl,
    primaryMediaApi,
    fallbackMediaApi,
    fallbackFrom: "",
  });
}

function isMissingUploadParamError(error: unknown): boolean {
  const message = formatErrorMessage(error);
  return message.includes("getUploadUrl returned no upload_param")
    || message.includes("getUploadUrl returned neither upload_full_url nor upload_param");
}

function resolveFallbackWeixinMediaApi(apiVariant: unknown): WeixinMediaApi | null {
  const normalized = String(apiVariant || "").trim().toLowerCase();
  return normalized === "legacy" ? null : resolveWeixinMediaApi("legacy");
}

async function sendFileFallback({
  filePath,
  to,
  contextToken,
  baseUrl,
  token,
  routeTag,
  clientVersion,
  uploadOpts,
  cdnBaseUrl,
  primaryMediaApi,
  fallbackMediaApi = null,
  fallbackFrom = "",
}: SendFileFallbackArgs): Promise<WeixinFileSendResult> {
  const strategies = [
    { label: "primary" as const, api: primaryMediaApi },
    { label: "fallback" as const, api: fallbackMediaApi },
  ].filter((entry): entry is { label: "primary" | "fallback"; api: WeixinMediaApi } => Boolean(entry.api));

  let lastError: unknown = null;
  for (let index = 0; index < strategies.length; index += 1) {
    const strategy = strategies[index];
    if (!strategy) {
      continue;
    }
    const { label, api } = strategy;
    try {
      const uploaded = await uploadMediaToWeixin({
        filePath,
        toUserId: to,
        opts: uploadOpts,
        cdnBaseUrl,
        mediaType: WEIXIN_MEDIA_TYPE.FILE,
        getUploadUrlImpl: api.getUploadUrlImpl,
      });
      await sendMediaItem({
        to,
        contextToken,
        baseUrl,
        token,
        routeTag,
        clientVersion,
        sendMessageImpl: api.sendMessageImpl,
        item: {
          type: 4,
          file_item: {
            media: buildMediaRef(uploaded),
            file_name: path.basename(filePath),
            len: String(uploaded.fileSize),
          },
        },
      });
      const result: WeixinFileSendResult = {
        kind: "file",
        fileName: path.basename(filePath),
        uploadStrategy: label,
      };
      if (fallbackFrom) {
        result.fallbackFrom = "image";
      }
      return result;
    } catch (error) {
      lastError = error;
      if (!isMissingUploadParamError(error) || index >= strategies.length - 1) {
        throw error;
      }
      logWarn(
        `[codeksei] weixin media upload fallback `
        + `file=${path.basename(filePath)} reason=${formatErrorMessage(error)}`,
      );
    }
  }

  throw lastError || new Error("weixin media upload failed");
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || String(error);
  }
  return String(error || "");
}

export {
  sendWeixinMediaFile,
};
