import type { JsonObject } from "../core/semantic-json";
import { asRecord, normalizeText } from "../core/semantic-json";
import type { CompanionMemorySource, CompanionMemorySlotId } from "./contracts";

interface CompanionMemoryProfile {
  userId?: unknown;
  workspaceRoot?: unknown;
}

interface OnboardingLikeState {
  coverage?: unknown;
  missingSlots?: unknown;
  status?: unknown;
  turnCount?: unknown;
}

interface CompanionRuntimeStateLike {
  lastSource?: unknown;
  lastUpdatedAt?: unknown;
  pendingPatternCandidates?: unknown;
  recentWrites?: unknown;
  slotFreshness?: unknown;
}

export interface CompanionMemorySemanticInput {
  currentMessage?: unknown;
  currentProfile?: unknown;
  deterministicWrites?: unknown;
  options?: JsonObject;
  profile?: CompanionMemoryProfile;
  source?: CompanionMemorySource | unknown;
  state?: OnboardingLikeState;
  runtimeState?: CompanionRuntimeStateLike;
}

export interface CompanionMemorySemanticConfig {
  hermesCommand?: unknown;
  companionSemanticGenerator?: ((input: CompanionMemorySemanticGeneratorInput) => Promise<unknown>) | null;
  companionSemanticHost?: unknown;
  companionSemanticModel?: unknown;
  companionSemanticMode?: unknown;
  companionSemanticTimeoutMs?: unknown;
  onboardingSemanticGenerator?: ((input: CompanionMemorySemanticGeneratorInput) => Promise<unknown>) | null;
  onboardingSemanticHost?: unknown;
  onboardingSemanticModel?: unknown;
  onboardingSemanticMode?: unknown;
  onboardingSemanticTimeoutMs?: unknown;
  reviewSemanticHost?: unknown;
  reviewSemanticMode?: unknown;
  reviewSemanticModel?: unknown;
  reviewSemanticTimeoutMs?: unknown;
  runtimeCommand?: unknown;
  runtimeEndpoint?: unknown;
  stateDir?: string;
  workspaceRoot?: unknown;
}

export interface CompanionMemorySemanticGeneratorInput {
  config: CompanionMemorySemanticConfig;
  currentMessage: string;
  lane: "companion" | "onboarding";
  options: JsonObject;
  profile: CompanionMemoryProfile | undefined;
  sourcePack: JsonObject;
  state: OnboardingLikeState | undefined;
}

export function buildCompanionMemorySemanticGeneratorInput(
  config: CompanionMemorySemanticConfig = {},
  input: CompanionMemorySemanticInput = {},
  lane: "companion" | "onboarding" = "companion",
): CompanionMemorySemanticGeneratorInput {
  return {
    config,
    currentMessage: normalizeText(input.currentMessage),
    lane,
    options: asRecord(input.options),
    profile: input.profile,
    sourcePack: buildCompanionMemorySemanticSourcePack(input, lane),
    state: input.state,
  };
}

export function buildCompanionMemorySemanticPrompt(
  input: CompanionMemorySemanticInput = {},
  lane: "companion" | "onboarding" = "companion",
): string {
  const sourcePack = buildCompanionMemorySemanticSourcePack(input, lane);
  return [
    "你是 Codeksei companion memory 背后的隐藏语义抽取层。",
    "你不负责写给用户看的回复，你只负责从本轮输入里提取可落盘事实、纠正、缺口和不安全推断。",
    "原则:",
    "1. 只写有证据的事实；如果不确定，就留空。",
    "2. 缺失事实不能靠常识补全。",
    "3. 用户明确纠正旧记忆时，要优先产出 correction，并尽量指出要替换的旧事实。",
    "4. social_circle 只有在会改变协作方式、边界或近期 follow-up 时才值得写。",
    "5. psychometrics 绝不能写诊断、人格判词或强标签；只有用户明确自述且直接影响协作方式时，才能转译成 preference/boundary。",
    "6. 玩笑、自嘲、引用别人评价、第三方转述、含糊猜测，都应进 unsafe_inferences 或直接忽略。",
    "7. 这是一个可被宿主高频调用的安全 over-call 提炼器；如果这一轮没有足够稳定、足够高价值的长期事实，就返回空 arrays。",
    "8. reminder_proactive 和 diary_supplement 更偏 backstage 语境；不要把一次性任务或普通时间线事实误写成长期人格结论。",
    lane === "onboarding"
      ? "9. onboarding lane 允许你优先关注当前仍缺的最小画像，但仍然不能暴露 slot/schema 这些内部概念。"
      : "9. companion lane 面向 ongoing memory；如果这轮只是普通闲聊、寒暄或一次性情绪波动，应优先不写。",
    "只返回 JSON，不要 Markdown，不要解释，不要代码块。",
    "",
    "JSON schema:",
    "{",
    '  "facts": [{"domain":"biography|experiences|preferences|social_circle|work|psychometrics","statement":"...","evidence":"...","confidence":0.0,"time_scope":"current|ongoing|near_term|stable|unknown","stability":"fleeting|current|stable|unknown","suggested_slot":"current_status|rhythm|preference|boundary|next","suggested_kind":"status|pattern|preference|boundary|next","is_correction":false}],',
    '  "corrections": [{"domain":"...","statement":"...","evidence":"...","confidence":0.0,"time_scope":"current|ongoing|near_term|stable|unknown","stability":"fleeting|current|stable|unknown","suggested_slot":"current_status|rhythm|preference|boundary|next","suggested_kind":"status|pattern|preference|boundary|next","replaces":["old fact 1","old fact 2"]}],',
    '  "gaps": [{"domain":"biography|experiences|preferences|social_circle|work|psychometrics","slot_id":"current_status|rhythm|preference|boundary|next","reason":"...","priority":"high|medium|low","tone_hint":"..."}],',
    '  "unsafe_inferences": [{"domain":"biography|experiences|preferences|social_circle|work|psychometrics","statement":"...","reason":"..."}]',
    "}",
    "",
    "Source pack:",
    JSON.stringify(sourcePack, null, 2),
  ].join("\n");
}

function buildCompanionMemorySemanticSourcePack(
  input: CompanionMemorySemanticInput = {},
  lane: "companion" | "onboarding" = "companion",
): JsonObject {
  const profile = asRecord(input.currentProfile);
  const state = asRecord(input.state);
  const runtimeState = asRecord(input.runtimeState);
  return {
    lane,
    source: normalizeSource(input.source),
    user_reply: normalizeText(input.currentMessage),
    current_profile: {
      current_status: normalizeStringList(profile.current_status, 4, 180),
      rhythm: normalizeStringList(profile.rhythm, 5, 160),
      preference: normalizeStringList(profile.preference, 5, 160),
      boundary: normalizeStringList(profile.boundary, 5, 180),
      next: normalizeStringList(profile.next, 4, 160),
    },
    interaction_state: {
      status: normalizeText(state.status),
      turn_count: normalizeCounter(state.turnCount),
      missing_slots: normalizeSlotList(state.missingSlots),
      slot_coverage: summarizeCoverage(asRecord(state.coverage).slots || state.coverage),
      last_source: normalizeText(runtimeState.lastSource),
      last_updated_at: normalizeText(runtimeState.lastUpdatedAt),
      slot_freshness: summarizeCoverage(runtimeState.slotFreshness),
      pending_pattern_candidates: summarizePatternCandidates(runtimeState.pendingPatternCandidates),
      recent_writes: normalizeRecentWrites(runtimeState.recentWrites),
    },
    deterministic_candidates: normalizeDeterministicWrites(input.deterministicWrites),
    extra_context: asRecord(input.options),
  };
}

function normalizeDeterministicWrites(value: unknown): Array<JsonObject> {
  return (Array.isArray(value) ? value : []).slice(0, 8).map((write) => {
    const record = asRecord(write);
    return {
      slot: normalizeText(record.slotId),
      kind: normalizeText(record.kind),
      text: normalizeText(record.text),
      source: normalizeText(record.source),
    };
  }).filter((entry) => entry.text);
}

function summarizeCoverage(value: unknown): JsonObject {
  const record = asRecord(value);
  const summary: JsonObject = {};
  for (const [key, raw] of Object.entries(record)) {
    const normalized = normalizeText(raw);
    if (normalized) {
      summary[key] = normalized;
    } else {
      const counter = normalizeCounter(raw);
      if (counter > 0) {
        summary[key] = counter;
      }
    }
  }
  return summary;
}

function summarizePatternCandidates(value: unknown): JsonObject {
  const record = asRecord(value);
  const summary: JsonObject = {};
  for (const [slotId, rawItems] of Object.entries(record)) {
    const items = Array.isArray(rawItems) ? rawItems : [];
    if (!items.length) {
      continue;
    }
    summary[slotId] = items.slice(0, 4).map((item) => {
      const recordItem = asRecord(item);
      return {
        count: normalizeCounter(recordItem.count),
        text: normalizeText(recordItem.text),
      };
    }).filter((item) => item.text);
  }
  return summary;
}

function normalizeRecentWrites(value: unknown): JsonObject[] {
  return (Array.isArray(value) ? value : []).slice(0, 4).map((item) => {
    const record = asRecord(item);
    return {
      slot: normalizeText(record.slotId),
      source: normalizeText(record.source),
      text: normalizeText(record.text),
      updated_at: normalizeText(record.updatedAt),
    };
  }).filter((item) => item.text);
}

function normalizeSlotList(value: unknown): CompanionMemorySlotId[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => normalizeText(entry))
    .filter((entry): entry is CompanionMemorySlotId => (
      entry === "current_status"
      || entry === "rhythm"
      || entry === "preference"
      || entry === "boundary"
      || entry === "next"
    ));
}

function normalizeCounter(value: unknown): number {
  const numeric = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/gu)
      : [];
  for (const raw of rawItems) {
    const normalized = truncateSentence(String(raw || "").replace(/^\s*-\s*/u, ""), maxLength);
    if (!normalized) {
      continue;
    }
    const signature = normalized.toLowerCase();
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    items.push(normalized);
    if (items.length >= maxItems) {
      break;
    }
  }
  return items;
}

function truncateSentence(value: unknown, maxLength: number): string {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).replace(/[，。；,;:\s]+$/u, "")}…`;
}

function normalizeSource(value: unknown): string {
  const normalized = normalizeText(value);
  return normalized || "host_user_turn";
}
