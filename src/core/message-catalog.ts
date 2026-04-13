import { normalizeText } from "./text-normalization";

export const MESSAGE_POLICY = Object.freeze({
  userFacingLanguage: "zh-CN",
  operatorLanguage: "en",
  timelineDashboardLocaleOwner: "timeline-runtime-locale",
});

function joinNonEmptyLines(lines: Array<string | false | null | undefined>): string {
  return lines.filter((line): line is string => typeof line === "string" && line.length > 0).join("\n");
}

function joinReasons(reasons: unknown): string {
  return Array.isArray(reasons)
    ? reasons.map((reason) => normalizeText(reason)).filter(Boolean).join("; ")
    : normalizeText(reasons);
}

export const userFacingMessages = Object.freeze({
  fileMissingTargetUser: "无法确定文件要发送给哪个微信用户，先配置 CODEKSEI_ALLOWED_USER_IDS",
  screenshotMissingTargetUser: "无法确定时间轴截图要发送给哪个微信用户，先配置 CODEKSEI_ALLOWED_USER_IDS",
  runtimeSendFailed: (reason: unknown) => `处理失败：${normalizeText(reason) || "unknown error"}`,
  attachmentReceiveFailed: (reasons: unknown) => `图片/附件接收失败：${joinReasons(reasons) || "unknown error"}`,
  timelineScreenshotFailed: (reason: unknown) => `时间轴截图失败：${normalizeText(reason) || "unknown error"}`,
  executionFailed: (reason: unknown) => normalizeText(reason) || "执行失败",
  runtimeFirstEventNotice: (workspaceRoot: unknown, threadId: unknown) => joinNonEmptyLines([
    "这条消息已经发到 bridge，但当前 runtime 还没有返回首个事件。",
    "如果你看到 terminal 正在 reconnecting，这一轮大概率还卡在共享线程启动阶段。",
    "先不用一直空等；如果稍后连上，消息会继续往下跑。",
    `workspace: ${normalizeText(workspaceRoot) || "(unknown)"}`,
    `thread: ${normalizeText(threadId) || "(unknown)"}`,
  ]),
  runtimeFirstEventFailure: (workspaceRoot: unknown, threadId: unknown) => joinNonEmptyLines([
    "这条消息已经发到 bridge，但当前 runtime 直到现在都没有返回首个事件。",
    "如果 terminal 里的那轮 reconnecting 已经跑完 5 次，这条共享线程基本可以判定没有真正启动成功。",
    `workspace: ${normalizeText(workspaceRoot) || "(unknown)"}`,
    `thread: ${normalizeText(threadId) || "(unknown)"}`,
    "优先检查：共享 app-server 是否正常、当前终端是否接在同一个 thread、runtime 是否真的开始处理这条消息。",
    "如果你现在是在替这条线排查，直接按这套顺序做：",
    "1. 在项目目录执行 npm run shared:status",
    "2. 如果 bridge 不在，先执行 npm run shared:start",
    "3. 再开一个终端执行 npm run shared:open",
    "4. 确认 terminal 里打开的是上面这条 thread，而不是另一条私有线程",
  ]),
  screenshotMissingContextToken: (userId: unknown) =>
    `找不到用户 ${normalizeText(userId) || "(unknown)"} 的 context token，先让这个用户和 bot 聊过一次`,
});

export const operatorMessages = Object.freeze({
  bridgeHeartbeatWriteFailed: (reason: unknown) =>
    `[codeksei] bridge heartbeat write failed: ${normalizeText(reason) || "unknown error"}`,
  backstageMessageDeadLettered: (messageId: unknown, reason: unknown) =>
    `[codeksei] backstage message dead-lettered id=${normalizeText(messageId) || "(unknown)"} reason=${normalizeText(reason) || "dead_letter"}`,
  timelineScreenshotJobFailed: (jobId: unknown, reason: unknown) =>
    `[codeksei] timeline screenshot failed job=${normalizeText(jobId) || "(unknown)"} ${normalizeText(reason) || "unknown error"}`,
  runtimeSettlementWatchdogExpired: (threadId: unknown, turnId: unknown, workspaceRoot: unknown) =>
    `[codeksei] runtime settlement watchdog expired thread=${normalizeText(threadId) || "(unknown)"} turn=${normalizeText(turnId) || "(unknown)"} workspace=${normalizeText(workspaceRoot) || "(unknown)"}`,
  sharedStartAppServer: (status: unknown, pid: unknown, listenUrl: unknown) =>
    `shared app-server ${normalizeText(status) || "unknown"}${pid ? ` pid=${pid}` : ""} listen=${normalizeText(listenUrl) || "(unknown)"}`,
  sharedStartBridge: (status: unknown, pid: unknown) =>
    `shared codeksei ${normalizeText(status) || "unknown"} pid=${normalizeText(pid) || "(unknown)"}`,
  sharedStartSupervisor: (status: unknown, pid: unknown) =>
    `shared supervisor ${normalizeText(status) || "unknown"} pid=${normalizeText(pid) || "(unknown)"}`,
});
