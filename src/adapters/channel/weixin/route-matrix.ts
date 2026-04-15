export type WeixinRouteOperation = "getUpdates" | "login" | "sendFile" | "sendText" | "sendTyping";
export type WeixinRouteStack = "legacy" | "v2";

export interface WeixinRouteRule {
  automaticFallbackTo: WeixinRouteStack | "";
  diagnostics: string;
  exitCriteria: string;
  operation: WeixinRouteOperation;
  reason: string;
  stack: WeixinRouteStack;
}

export interface WeixinMediaGapDiagnostic {
  errorPattern: string;
  issueUrl: string;
  maintainerDocPath: string;
  summary: string;
}

const PRIMARY_ROUTE_MATRIX = Object.freeze<Record<WeixinRouteOperation, WeixinRouteRule>>({
  getUpdates: Object.freeze({
    operation: "getUpdates",
    stack: "v2",
    automaticFallbackTo: "",
    reason: "默认 bridge text stack 已迁到 v2；polling 要和 text send/login 走同一头信息栈，避免登录后路由分裂。",
    exitCriteria: "仅当 upstream 证实 v2 polling 不再可用，或 legacy 成为唯一受支持入口时，才允许整体退回 legacy。",
    diagnostics: "Use docs/maintainer/weixin-media-fallback.md#getupdates for current probe notes and fallback rationale.",
  }),
  login: Object.freeze({
    operation: "login",
    stack: "v2",
    automaticFallbackTo: "",
    reason: "当前默认二维码登录与 text stack 一起走 v2，保持 token/routeTag/clientVersion 语义一致。",
    exitCriteria: "仅当 upstream 证实 legacy login 重新成为唯一可用路径时，才允许默认 adapter 切回 legacy。",
    diagnostics: "Use docs/maintainer/weixin-media-fallback.md#login for current login path notes.",
  }),
  sendText: Object.freeze({
    operation: "sendText",
    stack: "v2",
    automaticFallbackTo: "",
    reason: "text/typing 已在 v2 delivery facade 下稳定工作，stream/settled 都以这条栈为默认真相。",
    exitCriteria: "仅当 upstream 证实 v2 text transport 失效，或仓内 live smoke 显示系统性回归时，才允许回退。",
    diagnostics: "Use docs/maintainer/weixin-media-fallback.md#sendtext for the current text-delivery contract.",
  }),
  sendTyping: Object.freeze({
    operation: "sendTyping",
    stack: "v2",
    automaticFallbackTo: "",
    reason: "typing 必须与 text send 共享同一协议栈，避免可见状态与真实 reply transport 分裂。",
    exitCriteria: "仅当 upstream 证实 v2 typing 不再受支持时，才允许跟随 text stack 一起切换。",
    diagnostics: "Use docs/maintainer/weixin-media-fallback.md#sendtyping for the current typing contract.",
  }),
  sendFile: Object.freeze({
    operation: "sendFile",
    stack: "v2",
    automaticFallbackTo: "legacy",
    reason: "正式对外只保留一个 v2 Weixin adapter。可见文件发送先走 v2 media upload；只有命中 issue #4 的 media gap 签名时，才在 upload 内部回落到 legacy media API。",
    exitCriteria: "只有当 v2 media upload 在真实 routed session 上被 source-backed 证实稳定，且仓内 send-file/media tests 不再依赖 internal legacy fallback 时，才能移除这条回落链。",
    diagnostics: "Use docs/maintainer/weixin-media-fallback.md#sendfile and tests/media-send.test.ts for the current upload gap and fallback contract.",
  }),
});

export const WEIXIN_MEDIA_GAP_DIAGNOSTIC = Object.freeze<WeixinMediaGapDiagnostic>({
  errorPattern: "getUploadUrl returned neither upload_full_url nor upload_param",
  issueUrl: "https://github.com/Sapientropic/codeksei/issues/4",
  maintainerDocPath: "docs/maintainer/weixin-media-fallback.md",
  summary: "Current routed-session media gap: the official v2 adapter stays primary, but media upload falls back to the legacy media API when upload_param/upload_full_url is missing.",
});

export function describeWeixinAdapterVariant(_value: unknown = "v2"): string {
  return "v2";
}

export function getWeixinRouteRule(
  operation: WeixinRouteOperation,
  _variant: unknown = "v2",
): WeixinRouteRule {
  return PRIMARY_ROUTE_MATRIX[operation];
}

export function listWeixinRouteRules(_variant: unknown = "v2"): WeixinRouteRule[] {
  return Object.values(PRIMARY_ROUTE_MATRIX);
}

export function isWeixinMediaGapError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes(WEIXIN_MEDIA_GAP_DIAGNOSTIC.errorPattern)
    || message.includes("getUploadUrl returned no upload_param");
}
