import type { buildContextInspectReport } from "../context/inspect";
import { collectDiaryEntries } from "../review/review-sources";
import type { PulseTask } from "./contracts";
import type { PulseCandidate } from "./candidate-contracts";
import {
  extractWhereaboutsReason,
  formatPulseStaleReason,
  sanitizePulseVisibleBlock,
  sanitizePulseVisibleInline,
} from "./sanitize";

export function buildPulseCandidates({
  date,
  diaryEntry,
  focus,
  inspection,
  localPaths,
  tasks,
}: {
  date: string;
  diaryEntry: ReturnType<typeof collectDiaryEntries>[number] | null;
  focus: string;
  inspection: ReturnType<typeof buildContextInspectReport>["report"];
  localPaths: string[];
  tasks: PulseTask[];
}): PulseCandidate[] {
  const candidates: PulseCandidate[] = [];
  const whereaboutsReason = extractWhereaboutsReason(inspection);
  if (focus) {
    candidates.push(createCandidate({
      date,
      detailsMarkdown: [
        `今天的显式 focus 是：${focus}`,
        whereaboutsReason ? `当前位置语义：${whereaboutsReason}` : "",
        "建议先把它收成一个可执行的 25 分钟推进块。",
      ].filter(Boolean).join("\n\n"),
      sourceRefs: [{ id: "focus", kind: "user_focus", title: "Pulse focus" }],
      suggestedPrompt: `围绕「${focus}」给我一个最小下一步。`,
      summary: "把今天主动给出的重点变成可以马上继续的一步。",
      title: `继续：${focus}`,
      topic: focus,
      type: "focus",
      why: "你刚刚明确给了今天的关注焦点。",
    }, { localPaths }));
  }
  for (const task of tasks.slice(-3)) {
    candidates.push(createCandidate({
      date,
      detailsMarkdown: task.text,
      sourceRefs: [{ id: task.cardId, kind: "pulse_task", title: task.topic }],
      suggestedPrompt: `继续推进这张 Pulse 任务：${task.text}`,
      summary: task.text,
      title: `接回 Pulse 任务：${task.topic}`,
      topic: task.topic,
      type: "task",
      why: "这张卡片之前被转成了未完成任务，应该跨天继续参与策展。",
    }, { localPaths }));
  }
  if (inspection.pendingHandoff.exists) {
    candidates.push(createCandidate({
      date,
      detailsMarkdown: [
        inspection.pendingHandoff.observedCurrentState,
        inspection.pendingHandoff.followupContext,
        ...inspection.pendingHandoff.bookkeepingActions,
      ].filter(Boolean).join("\n"),
      sourceRefs: [{ id: inspection.pendingHandoff.triggerId || "pending-handoff", kind: "proactive_handoff", title: "Pending proactive handoff" }],
      suggestedPrompt: "先吸收 pending proactive handoff，再决定今天第一步。",
      summary: inspection.pendingHandoff.observedCurrentState || inspection.pendingHandoff.followupContext,
      title: "吸收待收尾的主动 handoff",
      topic: "proactive handoff",
      type: "handoff",
      why: "当前有子会话留下的 proactive handoff，主会话应先处理它。",
    }, { localPaths }));
  }
  if (inspection.stateCard.easiestReentryStep || inspection.stateCard.activeThread) {
    candidates.push(createCandidate({
      date,
      detailsMarkdown: [
        whereaboutsReason ? `当前位置语义：${whereaboutsReason}` : "",
        inspection.stateCard.currentLikelyState,
        inspection.stateCard.activeThread,
        inspection.stateCard.easiestReentryStep,
        inspection.stateCard.likelyBlocker,
      ].filter(Boolean).join("\n"),
      sourceRefs: [{ id: "state-card", kind: "context_board", title: "Companion state card" }],
      suggestedPrompt: "按当前 state card 给我一个不超过 10 分钟的重入动作。",
      summary: inspection.stateCard.easiestReentryStep || inspection.stateCard.activeThread,
      title: "从当前重入入口继续",
      topic: inspection.stateCard.activeThread || inspection.stateCard.easiestReentryStep,
      type: "project",
      why: "context board 已经有可用的项目线头或重入入口。",
    }, { localPaths }));
  }
  if (diaryEntry) {
    candidates.push(createCandidate({
      date,
      detailsMarkdown: [
        whereaboutsReason ? `当前位置语义：${whereaboutsReason}` : "",
        ...diaryEntry.timeline.slice(0, 4),
        ...diaryEntry.todo.open.slice(0, 3).map((item) => `未完成：${item}`),
        ...diaryEntry.supplement.slice(-2).map((item) => `${item.time} ${item.title || item.body}`),
      ].join("\n"),
      sourceRefs: [{ id: date, kind: "diary", title: "Today diary" }],
      suggestedPrompt: "根据今天已经发生的事实，帮我选一件最值得继续的小事。",
      summary: "今天已有 diary/timeline 事实，可以从真实发生的内容继续。",
      title: "从今天已经留下的事实继续",
      topic: "today facts",
      type: "today",
      why: "今天的 diary 已经有结构化事实，适合变成可继续推进的卡片。",
    }, { localPaths }));
  }
  candidates.push(createCandidate({
    date,
    detailsMarkdown: "先看 capabilities status，确认哪些能力只是配置存在，哪些在当前 host/session 里真的可用。",
    sourceRefs: [{ id: "capabilities.status", kind: "capability", title: "Capability Governance" }],
    suggestedPrompt: "检查当前 Codeksei 能力状态，并解释最值得修的 blocked 能力。",
    summary: "把工具和宿主能力从“开关列表”升级成可解释的当前可用状态。",
    title: "检查当前能力治理状态",
    topic: "capability governance",
    type: "capability",
    why: "这能防止把“配置启用”误判成“当前会话可用”。",
  }, { localPaths }));
  if (inspection.staleReasons.length) {
    candidates.push(createCandidate({
      date,
      detailsMarkdown: inspection.staleReasons.map((reason) => `- ${formatPulseStaleReason(reason)}`).join("\n"),
      sourceRefs: [{ id: "context.inspect", kind: "context_inspector", title: "Context Inspector" }],
      suggestedPrompt: "帮我补齐当前 context board 里最薄的一块来源。",
      summary: "[⚠️ 需确认] 当前上下文偏薄，先补来源比继续推进更稳。",
      title: "补齐偏薄的上下文来源",
      topic: "context thin",
      type: "context",
      why: "context inspect 标记了 stale reasons，继续前应先确认事实。",
    }, { localPaths }));
  }
  return candidates;
}

function createCandidate(
  candidate: PulseCandidate,
  {
    localPaths,
  }: {
    localPaths: string[];
  },
): PulseCandidate {
  const sanitized = {
    ...candidate,
    detailsMarkdown: sanitizePulseVisibleBlock(candidate.detailsMarkdown, localPaths),
    suggestedPrompt: sanitizePulseVisibleInline(candidate.suggestedPrompt, localPaths),
    summary: sanitizePulseVisibleInline(candidate.summary, localPaths),
    title: sanitizePulseVisibleInline(candidate.title, localPaths),
    topic: sanitizePulseVisibleInline(candidate.topic, localPaths),
    why: sanitizePulseVisibleInline(candidate.why, localPaths),
  };
  return {
    ...sanitized,
    summary: sanitized.summary || sanitized.title,
    title: sanitized.title || sanitized.summary || "继续这条线",
    topic: sanitized.topic || sanitized.title || "pulse",
  };
}
