import type { JsonObject } from "../core/semantic-json";
import { asRecord, normalizeText } from "../core/semantic-json";
import type { OnboardingSlotId } from "./state";
import type { ExtractedOnboardingWrite } from "./flow";

interface OnboardingSemanticProfile {
  sessionId?: unknown;
  userId?: unknown;
  workspaceRoot?: unknown;
}

interface OnboardingSemanticState {
  coverage?: unknown;
  missingSlots?: unknown;
  status?: unknown;
  turnCount?: unknown;
}

export interface OnboardingSemanticInput {
  currentMessage?: unknown;
  currentProfile?: unknown;
  deterministicWrites?: unknown;
  options?: JsonObject;
  profile?: OnboardingSemanticProfile;
  state?: OnboardingSemanticState;
}

export interface OnboardingSemanticConfig {
  hermesCommand?: unknown;
  onboardingSemanticGenerator?: ((input: OnboardingSemanticGeneratorInput) => Promise<unknown>) | null;
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

export interface OnboardingSemanticGeneratorInput {
  config: OnboardingSemanticConfig;
  currentMessage: string;
  options: JsonObject;
  profile: OnboardingSemanticProfile | undefined;
  sourcePack: JsonObject;
  state: OnboardingSemanticState | undefined;
}

export function buildOnboardingSemanticGeneratorInput(
  config: OnboardingSemanticConfig = {},
  input: OnboardingSemanticInput = {},
): OnboardingSemanticGeneratorInput {
  return {
    config,
    currentMessage: normalizeText(input.currentMessage),
    options: asRecord(input.options),
    profile: input.profile,
    sourcePack: buildOnboardingSemanticSourcePack(input),
    state: input.state,
  };
}

export function buildOnboardingSemanticPrompt(input: OnboardingSemanticInput = {}): string {
  const sourcePack = buildOnboardingSemanticSourcePack(input);
  return [
    "你是 Codeksei 激活访谈背后的隐藏语义抽取层。",
    "你不负责写给用户看的回复，你只负责从本轮用户原话里提取可落盘事实、纠正、缺口和不安全推断。",
    "原则:",
    "1. 只写有证据的事实；如果不确定，就留空。",
    "2. 缺失事实不能靠常识补全。",
    "3. 用户明确纠正旧记忆时，要优先产出 correction，并尽量指出要替换的旧事实。",
    "4. social_circle 只有在会改变协作方式、边界或近期 follow-up 时才值得写。",
    "5. psychometrics 绝不能写诊断、人格判词或强标签；只有用户明确自述且直接影响协作方式时，才能转译成 preference/boundary。",
    "6. 玩笑、自嘲、引用别人评价、第三方转述、含糊猜测，都应进 unsafe_inferences 或直接忽略。",
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

function buildOnboardingSemanticSourcePack(input: OnboardingSemanticInput = {}): JsonObject {
  const profile = asRecord(input.currentProfile);
  const state = asRecord(input.state);
  return {
    user_reply: normalizeText(input.currentMessage),
    current_profile: {
      current_status: normalizeStringList(profile.current_status, 4, 180),
      rhythm: normalizeStringList(profile.rhythm, 5, 160),
      preference: normalizeStringList(profile.preference, 5, 160),
      boundary: normalizeStringList(profile.boundary, 5, 180),
      next: normalizeStringList(profile.next, 4, 160),
    },
    onboarding_state: {
      status: normalizeText(state.status),
      turn_count: normalizeCounter(state.turnCount),
      missing_slots: normalizeSlotList(state.missingSlots),
      slot_coverage: summarizeCoverage(asRecord(state.coverage).slots || state.coverage),
      domain_coverage: summarizeCoverage(asRecord(state.coverage).domains),
    },
    deterministic_candidates: normalizeDeterministicWrites(input.deterministicWrites),
  };
}

function normalizeDeterministicWrites(value: unknown): Array<JsonObject> {
  const writes = Array.isArray(value) ? value as ExtractedOnboardingWrite[] : [];
  return writes.slice(0, 8).map((write) => ({
    slot: normalizeText(write.slotId),
    kind: normalizeText(write.kind),
    text: normalizeText(write.text),
  })).filter((entry) => entry.text);
}

function summarizeCoverage(value: unknown): JsonObject {
  const record = asRecord(value);
  const summary: JsonObject = {};
  for (const [key, raw] of Object.entries(record)) {
    const counter = normalizeCounter(raw);
    if (counter > 0) {
      summary[key] = counter;
    }
  }
  return summary;
}

function normalizeSlotList(value: unknown): OnboardingSlotId[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => normalizeText(entry))
    .filter((entry): entry is OnboardingSlotId => (
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
