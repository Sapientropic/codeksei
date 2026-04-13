import type { JsonObject } from "./review-semantic-normalize";
import {
  asRecord,
  compactDiaryDays,
  compactNightlyDays,
  normalizeDayGroups,
  normalizeStringList,
  normalizeSupplementGroups,
  normalizeText,
} from "./review-semantic-normalize";

export interface SemanticReviewProfile {
  kind?: unknown;
  workspaceRoot?: unknown;
}

export interface SemanticReviewWindow {
  startDate?: unknown;
  endDate?: unknown;
}

export interface SemanticReviewInput extends JsonObject {
  profile?: SemanticReviewProfile;
  window?: SemanticReviewWindow;
  diaryEntries?: unknown;
  nightlyEntries?: unknown;
  deterministicDraft?: unknown;
  options?: JsonObject;
}

export interface SemanticReviewConfig extends JsonObject {
  reviewSemanticMode?: unknown;
  reviewSemanticTimeoutMs?: unknown;
  reviewSemanticModel?: unknown;
  reviewSemanticGenerator?: ((input: SemanticGeneratorInput) => Promise<unknown>) | unknown;
  runtimeEndpoint?: unknown;
  runtimeCommand?: unknown;
  stateDir?: unknown;
  workspaceRoot?: unknown;
}

export interface SemanticGeneratorInput {
  config: SemanticReviewConfig;
  profile: SemanticReviewProfile | undefined;
  window: SemanticReviewWindow | undefined;
  diaryEntries: unknown;
  nightlyEntries: unknown;
  deterministicDraft: unknown;
  options: JsonObject;
  sourcePack: JsonObject;
}

export function buildSemanticGeneratorInput(
  config: SemanticReviewConfig = {},
  input: SemanticReviewInput = {},
): SemanticGeneratorInput {
  return {
    config,
    profile: input.profile,
    window: input.window,
    diaryEntries: input.diaryEntries,
    nightlyEntries: input.nightlyEntries,
    deterministicDraft: input.deterministicDraft || {},
    options: asRecord(input.options),
    sourcePack: buildSemanticSourcePack(input),
  };
}

export function buildSemanticPrompt(input: SemanticReviewInput = {}) {
  const kind = normalizeText(input?.profile?.kind);
  const schema = kind === "nightly"
    ? NIGHTLY_SCHEMA_PROMPT
    : PERIODIC_SCHEMA_PROMPT;
  const sourcePack = buildSemanticSourcePack(input);

  return [
    "你在做 Codeksei 生活助理复盘的语义提炼。",
    "你已经拿到了全部需要的源材料，不要调用工具，不要读文件，不要追问，不要补充不存在的事实。",
    "目标是压出高信号复盘：真正的推进、值得记住的摩擦、仍开着的线头、下一次更容易接上的入口。",
    "排除微小切换、机械流水账、睡前洗漱/短暂浏览/无后果的小动作，除非它明显改变了解释。",
    "如果证据不够强，就宁可少写，不要凑数。",
    "每条尽量短、具体、非评判。",
    "只返回 JSON，不要 Markdown，不要代码块，不要解释。",
    "",
    "JSON schema:",
    schema,
    "",
    "Source pack:",
    JSON.stringify(sourcePack, null, 2),
  ].join("\n");
}

function buildSemanticSourcePack(input: SemanticReviewInput = {}): JsonObject {
  const deterministicDraft = asRecord(input.deterministicDraft);
  const kind = normalizeText(input?.profile?.kind);
  return {
    kind,
    periodLabel: deterministicDraft.periodLabel || "",
    window: {
      startDate: input?.window?.startDate || "",
      endDate: input?.window?.endDate || "",
    },
    windowFacts: Array.isArray(deterministicDraft.windowFacts) ? deterministicDraft.windowFacts : [],
    deterministicBaseline: buildDeterministicBaseline(kind, asRecord(deterministicDraft.insights)),
    diaryDays: compactDiaryDays(input.diaryEntries),
    nightlyDays: compactNightlyDays(input.nightlyEntries),
  };
}

function buildDeterministicBaseline(kind: string, insights: JsonObject = {}): JsonObject {
  if (kind === "nightly") {
    return {
      progress: normalizeStringList(insights.progress, 6, 160),
      friction: normalizeStringList(insights.friction, 6, 220),
      open_loops: normalizeStringList(insights.openLoops, 6, 160),
      carry_forward: normalizeStringList(insights.carryForward, 6, 160),
      closeout: normalizeStringList(insights.closeout, 6, 180),
      signals: normalizeStringList(insights.signals, 6, 180),
    };
  }
  return {
    progress: normalizeStringList(insights.progress, 8, 180),
    friction: normalizeStringList(insights.friction, 8, 220),
    open_loops: normalizeStringList(insights.openLoops, 8, 160),
    carry_forward: normalizeStringList(insights.carryForward, 6, 160),
    daily_summaries: normalizeDayGroups(insights.dailySummaries, 14, 3, 160),
    supplement_groups: normalizeSupplementGroups(insights.supplements, 8, 4, 180),
  };
}

const NIGHTLY_SCHEMA_PROMPT = [
  "{",
  '  "progress": ["..."],',
  '  "friction": ["..."],',
  '  "open_loops": ["..."],',
  '  "carry_forward": ["..."],',
  '  "closeout": ["..."],',
  '  "signals": ["..."]',
  "}",
].join("\n");

const PERIODIC_SCHEMA_PROMPT = [
  "{",
  '  "progress": ["..."],',
  '  "friction": ["..."],',
  '  "open_loops": ["..."],',
  '  "carry_forward": ["..."],',
  '  "daily_summaries": [{"date": "YYYY-MM-DD", "lines": ["..."]}],',
  '  "supplement_groups": [{"date": "YYYY-MM-DD", "title": "...", "body_lines": ["..."]}]',
  "}",
].join("\n");
