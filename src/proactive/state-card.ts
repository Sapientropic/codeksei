import { normalizeText } from "../contracts/text-normalization";
import type { ProactiveSourceThickness, ProactiveStateCard } from "./contracts";

export interface ProactiveStateCardInput {
  sections: {
    activeThreads: string;
    cautions: string;
    currentStatus: string;
    reentryPoints: string;
    todayFacts: string;
  };
  stale: boolean;
  staleReasons: string[];
}

export function buildProactiveStateCard(input: ProactiveStateCardInput): ProactiveStateCard {
  const sourceThickness = resolveSourceThickness(input);
  const activeThread = preferredThreadLine(input.sections.activeThreads)
    || firstMeaningfulLine(input.sections.activeThreads)
    || firstMeaningfulLine(input.sections.todayFacts)
    || "";
  const easiestReentryStep = preferredReentryLine(input.sections.reentryPoints)
    || firstMeaningfulLine(input.sections.reentryPoints)
    || firstMeaningfulLine(input.sections.activeThreads)
    || "";
  return {
    activeThread,
    currentLikelyState: firstMeaningfulLine(input.sections.currentStatus)
      || (input.stale ? "当前判断上下文偏薄，需要先确认用户此刻状态。" : "当前上下文可用于一次轻量主动判断。"),
    doNotDo: extractDoNotDo(input.sections.cautions),
    easiestReentryStep,
    likelyBlocker: resolveLikelyBlocker(input, activeThread, easiestReentryStep),
    sourceThickness,
    toneHint: resolveToneHint(input, sourceThickness),
  };
}

function resolveSourceThickness(input: ProactiveStateCardInput): ProactiveSourceThickness {
  if (input.stale || input.staleReasons.includes("missing_today_diary")) {
    return "thin";
  }
  const nonEmptySections = [
    input.sections.activeThreads,
    input.sections.currentStatus,
    input.sections.reentryPoints,
    input.sections.todayFacts,
  ].filter((section) => meaningfulLines(section).length > 0).length;
  return nonEmptySections >= 4 ? "strong" : "usable";
}

function firstMeaningfulLine(text: string): string {
  return meaningfulLines(text)[0] || "";
}

function preferredThreadLine(text: string): string {
  return meaningfulLines(text).find((line) => /(issue|project|repo|commit|workspace|PR|分支|项目|当前实验|下一步)/iu.test(line)) || "";
}

function preferredReentryLine(text: string): string {
  return meaningfulLines(text).find((line) => !line.includes("/") && !line.includes("\\") && /(下一步|继续|接|hosted|checkin|script|入口)/iu.test(line)) || "";
}

function meaningfulLines(text: string): string[] {
  return normalizeText(text)
    .split(/\r?\n/gu)
    .map((line) => normalizeText(line.replace(/^[-*]\s*/u, "")))
    .filter((line) => line && !line.includes("[⚠️ 需确认]"))
    .slice(0, 8);
}

function extractDoNotDo(text: string): string[] {
  const lines = meaningfulLines(text)
    .filter((line) => /(不要|别|不能|避免|少一点|别太|不该)/u.test(line))
    .slice(0, 4);
  return lines.length ? lines : ["不要像催债或任务经理；只做当前最轻的一步。"];
}

function resolveLikelyBlocker(
  input: ProactiveStateCardInput,
  activeThread: string,
  easiestReentryStep: string,
): string {
  if (input.stale) {
    return "上下文偏薄，最可能的卡点是还不知道用户此刻是否仍在同一条线。";
  }
  const status = firstMeaningfulLine(input.sections.currentStatus);
  if (/(卡|散|慢|休息|还没|pending|待处理|仍挂着)/iu.test(status)) {
    return status;
  }
  if (easiestReentryStep) {
    return `需要把线接回：${easiestReentryStep}`;
  }
  return activeThread ? `当前线头需要轻量确认：${activeThread}` : "";
}

function resolveToneHint(
  input: ProactiveStateCardInput,
  sourceThickness: ProactiveSourceThickness,
): string {
  const caution = firstMeaningfulLine(input.sections.cautions);
  if (caution) {
    return `短、自然、低压力；参考注意事项：${caution}`;
  }
  if (sourceThickness === "thin") {
    return "短、自然、先确认，不要假装知道。";
  }
  return "短、自然、带一个可接回的小入口。";
}
