export type WeixinAdapterVariantKey = "legacy" | "v2";
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

const V2_ROUTE_MATRIX = Object.freeze<Record<WeixinRouteOperation, WeixinRouteRule>>({
  getUpdates: Object.freeze({
    operation: "getUpdates",
    stack: "v2",
    automaticFallbackTo: "",
    reason: "默认 bridge text stack 已迁到 v2；polling 要和 text send/login 走同一头信息栈，避免登录后路由分裂。",
    exitCriteria: "仅当 upstream 证实 v2 polling 不再可用，或 legacy 成为唯一受支持入口时，才允许整体退回 legacy。",
    diagnostics: "Use docs/maintainer/weixin-dual-stack.md#getupdates for current probe notes and fallback rationale.",
  }),
  login: Object.freeze({
    operation: "login",
    stack: "v2",
    automaticFallbackTo: "",
    reason: "当前默认二维码登录与 text stack 一起走 v2，保持 token/routeTag/clientVersion 语义一致。",
    exitCriteria: "仅当 upstream 证实 legacy login 重新成为唯一可用路径时，才允许默认 adapter 切回 legacy。",
    diagnostics: "Use docs/maintainer/weixin-dual-stack.md#login for current login path notes.",
  }),
  sendText: Object.freeze({
    operation: "sendText",
    stack: "v2",
    automaticFallbackTo: "",
    reason: "text/typing 已在 v2 delivery facade 下稳定工作，stream/settled 都以这条栈为默认真相。",
    exitCriteria: "仅当 upstream 证实 v2 text transport 失效，或仓内 live smoke 显示系统性回归时，才允许回退。",
    diagnostics: "Use docs/maintainer/weixin-dual-stack.md#sendtext for the current text-delivery contract.",
  }),
  sendTyping: Object.freeze({
    operation: "sendTyping",
    stack: "v2",
    automaticFallbackTo: "",
    reason: "typing 必须与 text send 共享同一协议栈，避免可见状态与真实 reply transport 分裂。",
    exitCriteria: "仅当 upstream 证实 v2 typing 不再受支持时，才允许跟随 text stack 一起切换。",
    diagnostics: "Use docs/maintainer/weixin-dual-stack.md#sendtyping for the current typing contract.",
  }),
  sendFile: Object.freeze({
    operation: "sendFile",
    stack: "legacy",
    automaticFallbackTo: "",
    reason: "当前默认 adapter 仍把可见文件发送固定留在 legacy media API。仓内已复现 routed sessions 在 v2 upload_url 路径上返回缺失 upload_param 的 media gap。",
    exitCriteria: "只有当 v2 media upload 在真实 routed session 上被 source-backed 证实稳定，且仓内 send-file/media tests 不再依赖 legacy fallback 时，才能移除这条 legacy route。",
    diagnostics: "Use docs/maintainer/weixin-dual-stack.md#sendfile and tests/media-send.test.ts for the current upload gap and fallback contract.",
  }),
});

const LEGACY_ROUTE_MATRIX = Object.freeze<Record<WeixinRouteOperation, WeixinRouteRule>>({
  getUpdates: Object.freeze({
    operation: "getUpdates",
    stack: "legacy",
    automaticFallbackTo: "",
    reason: "legacy adapter 选择时，poll/login/text/typing/file 全部固定在 legacy stack。",
    exitCriteria: "切回默认 v2 adapter 时，整体按 v2 matrix 管理。",
    diagnostics: "Use docs/maintainer/weixin-dual-stack.md#legacy-adapter for the legacy-only route contract.",
  }),
  login: Object.freeze({
    operation: "login",
    stack: "legacy",
    automaticFallbackTo: "",
    reason: "legacy adapter 选择时，登录固定走 legacy login flow。",
    exitCriteria: "切回默认 v2 adapter 时，整体按 v2 matrix 管理。",
    diagnostics: "Use docs/maintainer/weixin-dual-stack.md#legacy-adapter for the legacy-only route contract.",
  }),
  sendText: Object.freeze({
    operation: "sendText",
    stack: "legacy",
    automaticFallbackTo: "",
    reason: "legacy adapter 选择时，可见文本发送固定走 legacy sendMessage stack。",
    exitCriteria: "切回默认 v2 adapter 时，整体按 v2 matrix 管理。",
    diagnostics: "Use docs/maintainer/weixin-dual-stack.md#legacy-adapter for the legacy-only route contract.",
  }),
  sendTyping: Object.freeze({
    operation: "sendTyping",
    stack: "legacy",
    automaticFallbackTo: "",
    reason: "legacy adapter 选择时，typing 与 text send 保持同栈。",
    exitCriteria: "切回默认 v2 adapter 时，整体按 v2 matrix 管理。",
    diagnostics: "Use docs/maintainer/weixin-dual-stack.md#legacy-adapter for the legacy-only route contract.",
  }),
  sendFile: Object.freeze({
    operation: "sendFile",
    stack: "legacy",
    automaticFallbackTo: "",
    reason: "legacy adapter 选择时，文件发送固定走 legacy media API。",
    exitCriteria: "切回默认 v2 adapter 时，整体按 v2 matrix 管理。",
    diagnostics: "Use docs/maintainer/weixin-dual-stack.md#legacy-adapter for the legacy-only route contract.",
  }),
});

export const WEIXIN_MEDIA_GAP_DIAGNOSTIC = Object.freeze<WeixinMediaGapDiagnostic>({
  errorPattern: "getUploadUrl returned neither upload_full_url nor upload_param",
  issueUrl: "",
  maintainerDocPath: "docs/maintainer/weixin-dual-stack.md",
  summary: "Current routed-session media gap: v2 upload URL lookup can omit upload_param/upload_full_url, so visible file delivery stays on the legacy media stack by design.",
});

export function describeWeixinAdapterVariant(value: unknown): string {
  return normalizeWeixinAdapterVariantKey(value) === "legacy"
    ? "legacy"
    : "dual:v2-text+legacy-media";
}

export function getWeixinRouteRule(
  operation: WeixinRouteOperation,
  variant: unknown = "v2",
): WeixinRouteRule {
  const normalizedVariant = normalizeWeixinAdapterVariantKey(variant);
  return normalizedVariant === "legacy"
    ? LEGACY_ROUTE_MATRIX[operation]
    : V2_ROUTE_MATRIX[operation];
}

export function listWeixinRouteRules(variant: unknown = "v2"): WeixinRouteRule[] {
  const normalizedVariant = normalizeWeixinAdapterVariantKey(variant);
  const matrix = normalizedVariant === "legacy" ? LEGACY_ROUTE_MATRIX : V2_ROUTE_MATRIX;
  return Object.values(matrix);
}

export function isWeixinMediaGapError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes(WEIXIN_MEDIA_GAP_DIAGNOSTIC.errorPattern)
    || message.includes("getUploadUrl returned no upload_param");
}

export function normalizeWeixinAdapterVariantKey(value: unknown): WeixinAdapterVariantKey {
  return String(value || "").trim().toLowerCase() === "legacy" ? "legacy" : "v2";
}
