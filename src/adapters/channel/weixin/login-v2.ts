import {
  buildCommonHeaders,
  normalizeProtocolClientVersion,
  normalizeRouteTag,
} from "./protocol";
import { redactSensitiveText } from "./redact";
import {
  ACTIVE_LOGIN_TTL_MS,
  MAX_QR_REFRESH_COUNT,
  ensureTrailingSlash,
  finishWeixinLogin,
  printQrCode,
} from "./login-common";
import type { WeixinAccountConfig } from "./account-store";

const QR_LONG_POLL_TIMEOUT_MS = 35_000;

interface V2QrResponse {
  qrcode_img_content: string;
  qrcode: string;
}

interface V2LoginStatusResponse extends Record<string, unknown> {
  status?: string;
  redirect_host?: string;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

interface V2LoginConfig extends WeixinAccountConfig {
  weixinBaseUrl?: string;
  weixinQrBotType?: string;
  weixinRouteTag?: string;
  weixinProtocolClientVersion?: string;
}

interface FetchQrCodeArgs {
  apiBaseUrl: string;
  botType: string;
  routeTag?: string;
  clientVersion?: string;
}

async function fetchQrCode({ apiBaseUrl, botType, routeTag = "", clientVersion = "" }: FetchQrCodeArgs): Promise<V2QrResponse> {
  const base = ensureTrailingSlash(apiBaseUrl);
  const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, base);
  const response = await fetch(url.toString(), {
    headers: buildCommonHeaders({ routeTag, clientVersion }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "(unreadable)");
    throw new Error(`二维码获取失败: ${response.status} ${response.statusText} ${redactSensitiveText(body)}`);
  }
  return response.json() as Promise<V2QrResponse>;
}

async function pollQrStatus({
  apiBaseUrl,
  qrcode,
  routeTag = "",
  clientVersion = "",
}: {
  apiBaseUrl: string;
  qrcode: string;
  routeTag?: string;
  clientVersion?: string;
}): Promise<V2LoginStatusResponse> {
  const base = ensureTrailingSlash(apiBaseUrl);
  const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      headers: buildCommonHeaders({ routeTag, clientVersion }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`二维码状态轮询失败: ${response.status} ${response.statusText} ${redactSensitiveText(rawText)}`);
    }
    return JSON.parse(rawText);
  } catch (error) {
    clearTimeout(timer);
    if (isTransientLongPollError(error)) {
      return { status: "wait" };
    }
    throw error;
  }
}

async function waitForV2WeixinLogin({
  apiBaseUrl,
  botType,
  routeTag = "",
  clientVersion = "",
  timeoutMs,
}: {
  apiBaseUrl: string;
  botType: string;
  routeTag?: string;
  clientVersion?: string;
  timeoutMs: number;
}) {
  let qrResponse = await fetchQrCode({ apiBaseUrl, botType, routeTag, clientVersion });
  let startedAt = Date.now();
  let refreshCount = 0;
  let scannedPrinted = false;
  let pollBaseUrl = apiBaseUrl;

  console.log("使用微信扫描以下二维码，以完成连接：\n");
  printQrCode((qrResponse as any).qrcode_img_content);
  console.log("\n等待连接结果...\n");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (Date.now() - startedAt > ACTIVE_LOGIN_TTL_MS) {
      ({ qrResponse, startedAt, refreshCount, scannedPrinted, pollBaseUrl } = await refreshQrCode({
        reason: "二维码已过期，正在刷新...",
        apiBaseUrl,
        botType,
        routeTag,
        clientVersion,
        refreshCount,
      }));
    }

    const statusResponse = await pollQrStatus({
      apiBaseUrl: pollBaseUrl,
      qrcode: (qrResponse as any).qrcode,
      routeTag,
      clientVersion,
    });

    switch (statusResponse.status) {
      case "wait":
        process.stdout.write(".");
        await sleep(1_000);
        break;
      case "scaned":
        if (!scannedPrinted) {
          process.stdout.write("\n已扫码，请在微信中确认授权...\n");
          scannedPrinted = true;
        }
        await sleep(1_000);
        break;
      case "scaned_but_redirect":
        // V2 login can hand the QR polling phase off to a redirected host.
        // If we keep polling the gateway after this point, login looks "stuck"
        // even though the user already confirmed in WeChat.
        if (typeof statusResponse.redirect_host === "string" && statusResponse.redirect_host.trim()) {
          pollBaseUrl = `https://${statusResponse.redirect_host.trim()}`;
        }
        await sleep(1_000);
        break;
      case "expired":
        ({ qrResponse, startedAt, refreshCount, scannedPrinted, pollBaseUrl } = await refreshQrCode({
          reason: "二维码已过期，正在刷新...",
          apiBaseUrl,
          botType,
          routeTag,
          clientVersion,
          refreshCount,
        }));
        break;
      case "confirmed":
        if (!statusResponse.bot_token || !statusResponse.ilink_bot_id) {
          throw new Error("登录成功但缺少 bot token 或账号 ID");
        }
        return {
          accountId: statusResponse.ilink_bot_id,
          token: statusResponse.bot_token,
          baseUrl: statusResponse.baseurl || pollBaseUrl || apiBaseUrl,
          userId: statusResponse.ilink_user_id || "",
          routeTag,
        };
      default:
        throw new Error(`二维码状态异常: ${redactSensitiveText(JSON.stringify(statusResponse))}`);
    }
  }

  throw new Error("登录超时，请重新执行 login");
}

async function refreshQrCode({
  reason,
  apiBaseUrl,
  botType,
  routeTag,
  clientVersion,
  refreshCount,
}: {
  reason: string;
  apiBaseUrl: string;
  botType: string;
  routeTag: string;
  clientVersion: string;
  refreshCount: number;
}) {
  const nextRefreshCount = refreshCount + 1;
  if (nextRefreshCount > MAX_QR_REFRESH_COUNT) {
    throw new Error("二维码多次过期，请重新执行 login");
  }
  const qrResponse = await fetchQrCode({ apiBaseUrl, botType, routeTag, clientVersion });
  console.log(`${reason}(${nextRefreshCount}/${MAX_QR_REFRESH_COUNT})\n`);
  printQrCode((qrResponse as any).qrcode_img_content);
  return {
    qrResponse,
    startedAt: Date.now(),
    refreshCount: nextRefreshCount,
    scannedPrinted: false,
    pollBaseUrl: apiBaseUrl,
  };
}

function isTransientLongPollError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
  return message.includes("aborted")
    || message.includes("fetch failed")
    || message.includes("networkerror")
    || message.includes("timed out")
    || error instanceof TypeError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runV2LoginFlow(config: V2LoginConfig): Promise<void> {
  const routeTag = normalizeRouteTag(config.weixinRouteTag);
  const clientVersion = normalizeProtocolClientVersion(config.weixinProtocolClientVersion);
  const routeTagLabel = routeTag ? ` routeTag=${routeTag}` : "";
  console.log(`[codeksei] 正在启动微信扫码登录（v2）...${routeTagLabel}`);
  const result = await waitForV2WeixinLogin({
    apiBaseUrl: String(config.weixinBaseUrl || ""),
    botType: String(config.weixinQrBotType || ""),
    routeTag,
    clientVersion,
    timeoutMs: 480_000,
  });
  finishWeixinLogin(config, result);
}

export {
  runV2LoginFlow,
};
