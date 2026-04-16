import * as qrcodeTerminal from "qrcode-terminal";
import { writeStdoutLine } from "../../../core/terminal-output";
import {
  TENCENT_OPENCLAW_WEIXIN_PACKAGE,
  TENCENT_OPENCLAW_WEIXIN_VERSION,
} from "../../../contracts/weixin-official";

import {
  deleteWeixinAccount,
  listWeixinAccounts,
  saveWeixinAccount,
  type WeixinAccountConfig,
  type WeixinAccountRecord,
} from "./account-store";
import { clearPersistedContextTokens } from "./context-token-store";

const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
const MAX_QR_REFRESH_COUNT = 3;

interface WeixinLoginResult extends Partial<WeixinAccountRecord>, Record<string, unknown> {
  accountId: string;
  token: string;
  baseUrl: string;
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function printQrCode(url: string): void {
  try {
    qrcodeTerminal.generate(url, { small: true });
    writeStdoutLine("如果二维码未能成功展示，请用浏览器打开以下链接扫码：");
    writeStdoutLine(url);
  } catch {
    writeStdoutLine(url);
  }
}

function printLoginCompatibilityNotice(): void {
  writeStdoutLine(
    `[codeksei] 默认协议版本对齐腾讯官方包 ${TENCENT_OPENCLAW_WEIXIN_PACKAGE}@${TENCENT_OPENCLAW_WEIXIN_VERSION}。`
  );
  writeStdoutLine(
    "[codeksei] 海外/国际版 WeChat 当前可能受官方地域灰度限制；腾讯公开资料提到香港地域已支持，其他地域仍在逐步开放。若手机扫码直接报网络问题，优先核对账号与客户端资格。"
  );
}

function cleanupStaleAccountsForUserId(
  config: WeixinAccountConfig,
  activeAccount: WeixinAccountRecord,
): WeixinAccountRecord[] {
  const activeUserId = typeof activeAccount?.userId === "string" ? activeAccount.userId.trim() : "";
  if (!activeUserId) {
    return [];
  }
  const staleAccounts = listWeixinAccounts(config).filter((account: WeixinAccountRecord) => (
    account.accountId !== activeAccount.accountId
    && typeof account.userId === "string"
    && account.userId.trim() === activeUserId
  ));
  for (const staleAccount of staleAccounts) {
    deleteWeixinAccount(config, staleAccount.accountId);
    clearPersistedContextTokens(config, staleAccount.accountId);
    writeStdoutLine(`[codeksei] removed stale account ${staleAccount.accountId} for userId ${activeUserId}`);
  }
  return staleAccounts;
}

function finishWeixinLogin(config: WeixinAccountConfig, result: WeixinLoginResult): WeixinAccountRecord {
  const account = saveWeixinAccount(config, result.accountId, result);
  cleanupStaleAccountsForUserId(config, account);
  writeStdoutLine("\n✅ 与微信连接成功！");
  writeStdoutLine(`accountId: ${account.accountId}`);
  writeStdoutLine(`userId: ${account.userId || "(unknown)"}`);
  writeStdoutLine(`baseUrl: ${account.baseUrl}`);
  if (account.routeTag) {
    writeStdoutLine(`routeTag: ${account.routeTag}`);
  }
  return account;
}

export {
  ACTIVE_LOGIN_TTL_MS,
  MAX_QR_REFRESH_COUNT,
  ensureTrailingSlash,
  finishWeixinLogin,
  printLoginCompatibilityNotice,
  printQrCode,
  type WeixinLoginResult,
};
