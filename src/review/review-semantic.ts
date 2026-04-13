import { mapCodexMessageToRuntimeEvent } from "../adapters/runtime/codex/events";
import { CodexRpcClient } from "../adapters/runtime/codex/rpc-client";
import {
  extractThreadId,
  extractThreadIdFromParams,
} from "../adapters/runtime/codex/message-utils";
import { RUNTIME_EVENT_TYPES } from "../contracts/runtime-events";
import { resolveCodexWorkspaceRoot } from "../workspace/workspace-alias";
import {
  collectReplyFragment,
  createReplyFragmentCollectorState,
  observeReplyFragmentTurnStart,
  resolveReplyFragmentCollectorText,
  shouldIgnoreReplyFragmentTurnCompletion,
} from "../adapters/runtime/codex/reply-fragment-collector";

const DEFAULT_TIMEOUT_MS = 120_000;

type JsonObject = Record<string, unknown>;

interface SemanticReviewProfile {
  kind?: unknown;
  workspaceRoot?: unknown;
}

interface SemanticReviewWindow {
  startDate?: unknown;
  endDate?: unknown;
}

interface SemanticReviewInput extends JsonObject {
  profile?: SemanticReviewProfile;
  window?: SemanticReviewWindow;
  diaryEntries?: unknown;
  nightlyEntries?: unknown;
  deterministicDraft?: unknown;
  options?: JsonObject;
}

interface SemanticReviewConfig extends JsonObject {
  reviewSemanticMode?: unknown;
  reviewSemanticTimeoutMs?: unknown;
  reviewSemanticModel?: unknown;
  reviewSemanticGenerator?: ((input: SemanticGeneratorInput) => Promise<unknown>) | unknown;
  codexEndpoint?: unknown;
  codexCommand?: unknown;
  stateDir?: unknown;
  workspaceRoot?: unknown;
}

interface SemanticGeneratorInput {
  config: SemanticReviewConfig;
  profile: SemanticReviewProfile | undefined;
  window: SemanticReviewWindow | undefined;
  diaryEntries: unknown;
  nightlyEntries: unknown;
  deterministicDraft: unknown;
  options: JsonObject;
  sourcePack: JsonObject;
}

interface RuntimeSemanticClient {
  onMessage(listener: (message: unknown) => void): () => void;
}

async function maybeGenerateSemanticReview(config: SemanticReviewConfig = {}, input: SemanticReviewInput = {}) {
  const kind = normalizeText(input?.profile?.kind);
  const mode = normalizeSemanticMode(
    input?.options?.deterministic ? "deterministic" : config.reviewSemanticMode
  );
  if (!kind || mode === "deterministic") {
    return {
      used: false,
      source: "deterministic",
      reason: mode === "deterministic" ? "disabled" : "missing-kind",
      data: null,
    };
  }

  const diaryEntries = Array.isArray(input.diaryEntries) ? input.diaryEntries : [];
  if (!diaryEntries.length) {
    return {
      used: false,
      source: "deterministic",
      reason: "no-diary",
      data: null,
    };
  }

  try {
    const raw = typeof config.reviewSemanticGenerator === "function"
      ? await config.reviewSemanticGenerator(buildSemanticGeneratorInput(config, input))
      : await runCodexSemanticReview(config, input);
    const data = normalizeSemanticResult(kind, raw);
    if (!data || !hasSemanticPayload(kind, data)) {
      return {
        used: false,
        source: "deterministic",
        reason: "empty-semantic",
        data: null,
      };
    }
    return {
      used: true,
      source: typeof config.reviewSemanticGenerator === "function" ? "injected" : "codex",
      reason: "",
      data,
    };
  } catch (error) {
    return {
      used: false,
      source: "deterministic",
      reason: formatErrorMessage(error),
      data: null,
    };
  }
}

async function runCodexSemanticReview(config: SemanticReviewConfig = {}, input: SemanticReviewInput = {}) {
  const prompt = buildSemanticPrompt(input);
  const timeoutMs = normalizeTimeout(config.reviewSemanticTimeoutMs) || DEFAULT_TIMEOUT_MS;
  const model = normalizeText(input?.options?.model || config.reviewSemanticModel);
  const workspaceRoot = resolveCodexWorkspaceRoot(input?.profile?.workspaceRoot || config.workspaceRoot || process.cwd());
  const client = new CodexRpcClient({
    endpoint: normalizeText(config.codexEndpoint),
    codexCommand: normalizeText(config.codexCommand),
    env: process.env,
    extraWritableRoots: normalizeText(config.stateDir) ? [normalizeText(config.stateDir)] : [],
  });

  try {
    await client.connect();
    await client.initialize();
    const response = await client.startThread({ cwd: workspaceRoot });
    const threadId = extractThreadId(
      response as Parameters<typeof extractThreadId>[0]
    );
    if (!threadId) {
      throw new Error("semantic review did not return a thread id");
    }
    const completion = waitForSemanticTurnCompletion(client, threadId, timeoutMs);
    await client.sendUserMessage({
      threadId,
      text: prompt,
      model: model || null,
      workspaceRoot,
    });
    const text = await completion;
    return parseSemanticJson(text);
  } finally {
    await client.close().catch(() => {});
  }
}

function buildSemanticGeneratorInput(
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

function buildSemanticPrompt(input: SemanticReviewInput = {}) {
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

function compactDiaryDays(entries: unknown): Array<JsonObject> {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    date: normalizeText(entry?.date),
    openTodos: normalizeStringList(entry?.todo?.open, 5, 140),
    doneTodos: normalizeStringList(entry?.todo?.done, 5, 140),
    summary: normalizeStringList(entry?.summary, 6, 180),
    timeline: normalizeStringList(entry?.timeline, 4, 160),
    fragment: normalizeStringList(entry?.fragment, 4, 180),
    supplement: normalizeSupplementGroups(
      (Array.isArray(entry?.supplement) ? entry.supplement : []).map((item: unknown) => ({
        date: normalizeText(entry?.date),
        title: normalizeText(asRecord(item).title),
        body_lines: compactBodyLines(asRecord(item).body, 3, 180),
      })),
      5,
      3,
      180
    ),
  }));
}

function compactNightlyDays(entries: unknown): Array<JsonObject> {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    date: normalizeText(entry?.date),
    progress: normalizeStringList(entry?.progress, 4, 160),
    friction: normalizeStringList(entry?.friction, 4, 180),
    open_loops: normalizeStringList(entry?.openLoops, 4, 140),
    carry_forward: normalizeStringList(entry?.carryForward, 4, 140),
    closeout: normalizeStringList(entry?.closeout, 4, 160),
    signals: normalizeStringList(entry?.signals, 4, 160),
  }));
}

function waitForSemanticTurnCompletion(
  client: RuntimeSemanticClient,
  threadId: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const collector = createReplyFragmentCollectorState();

    const cleanup = () => {
      unsubscribe();
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`semantic review timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const unsubscribe = client.onMessage((message: unknown) => {
      const params = asRecord(asRecord(message).params);
      // Keep semantic review on the same normalized runtime event contract as
      // the main chat/runtime path. Otherwise upstream RPC drift gets fixed in
      // one place and silently reintroduced here.
      const runtimeEvent = mapCodexMessageToRuntimeEvent(
        message as Parameters<typeof mapCodexMessageToRuntimeEvent>[0]
      );
      const messageThreadId = normalizeText(runtimeEvent?.payload?.threadId)
        || extractThreadIdFromParams(params);
      if (messageThreadId && messageThreadId !== threadId) {
        return;
      }

      if (observeReplyFragmentTurnStart(collector, runtimeEvent)) {
        return;
      }

      // Review summarization is meant to be a pure thinking pass over the
      // provided source pack. If Codex wants tools or escalation here, the
      // safe behavior is to abort and fall back to deterministic extraction.
      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED) {
        cleanup();
        reject(new Error("semantic review requested approval"));
        return;
      }

      if (collectReplyFragment(collector, runtimeEvent)) {
        return;
      }

      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.TURN_FAILED) {
        cleanup();
        reject(new Error(normalizeText(runtimeEvent.payload.text) || "semantic review failed"));
        return;
      }

      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.TURN_COMPLETED) {
        if (shouldIgnoreReplyFragmentTurnCompletion(collector, runtimeEvent)) {
          return;
        }
        cleanup();
        // Semantic review expects the terminal JSON payload. Codex can emit
        // multiple assistant messages within one turn, so concatenating every
        // message here risks mixing progress chatter into the final JSON blob.
        const text = resolveReplyFragmentCollectorText(collector);
        if (!text) {
          reject(new Error("semantic review returned empty text"));
          return;
        }
        resolve(String(text).trim());
      }
    });
  });
}

function parseSemanticJson(text: unknown): JsonObject {
  const direct = tryParseJson(text);
  if (direct) {
    return direct;
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(String(text || ""));
  if (fenced?.[1]) {
    const parsed = tryParseJson(fenced[1]);
    if (parsed) {
      return parsed;
    }
  }

  const objectCandidate = extractFirstJsonObject(text);
  const parsed = tryParseJson(objectCandidate);
  if (parsed) {
    return parsed;
  }

  throw new Error("semantic review did not return valid JSON");
}

function normalizeSemanticResult(kind: string, raw: unknown): JsonObject | null {
  const normalizedRaw = asRecord(raw);
  if (!Object.keys(normalizedRaw).length) {
    return null;
  }
  if (kind === "nightly") {
    return {
      progress: normalizeStringList(normalizedRaw.progress, 5, 160),
      friction: normalizeStringList(normalizedRaw.friction, 5, 220),
      openLoops: normalizeStringList(normalizedRaw.open_loops || normalizedRaw.openLoops, 6, 160),
      carryForward: normalizeStringList(normalizedRaw.carry_forward || normalizedRaw.carryForward, 4, 160),
      closeout: normalizeStringList(normalizedRaw.closeout, 5, 180),
      signals: normalizeStringList(normalizedRaw.signals, 5, 160),
    };
  }
  return {
    progress: normalizeStringList(normalizedRaw.progress, 6, 180),
    friction: normalizeStringList(normalizedRaw.friction, 6, 220),
    openLoops: normalizeStringList(normalizedRaw.open_loops || normalizedRaw.openLoops, 6, 160),
    carryForward: normalizeStringList(normalizedRaw.carry_forward || normalizedRaw.carryForward, 4, 160),
    dailySummaries: normalizeDayGroups(normalizedRaw.daily_summaries || normalizedRaw.dailySummaries, 31, 3, 160),
    supplements: normalizeSupplementGroups(normalizedRaw.supplement_groups || normalizedRaw.supplements, 8, 4, 180),
  };
}

function hasSemanticPayload(kind: string, data: JsonObject | null): boolean {
  if (!data) {
    return false;
  }
  if (kind === "nightly") {
    return [
      data.progress,
      data.friction,
      data.openLoops,
      data.carryForward,
      data.closeout,
      data.signals,
    ].some((items) => Array.isArray(items) && items.length);
  }
  return [
    data.progress,
    data.friction,
    data.openLoops,
    data.carryForward,
    data.dailySummaries,
    data.supplements,
  ].some((items) => Array.isArray(items) && items.length);
}

function normalizeDayGroups(value: unknown, maxGroups: number, maxLines: number, maxLength: number) {
  const groups: Array<{ date: string; lines: string[] }> = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const date = normalizeText(item?.date);
    const lines = normalizeStringList(item?.lines, maxLines, maxLength);
    if (!date || !lines.length) {
      continue;
    }
    const signature = `${date}:${lines.join("|").toLowerCase()}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    groups.push({ date, lines });
    if (groups.length >= maxGroups) {
      break;
    }
  }
  return groups;
}

function normalizeSupplementGroups(value: unknown, maxGroups: number, maxLines: number, maxLength: number) {
  const groups: Array<{ date: string; title: string; body: string }> = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    const date = normalizeText(item?.date);
    const title = normalizeText(item?.title);
    const bodyLines = normalizeStringList(item?.body_lines || item?.bodyLines || item?.body, maxLines, maxLength);
    if (!date || !bodyLines.length) {
      continue;
    }
    const signature = `${date}:${title}:${bodyLines.join("|").toLowerCase()}`;
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    groups.push({
      date,
      title,
      body: bodyLines.join("\n"),
    });
    if (groups.length >= maxGroups) {
      break;
    }
  }
  return groups;
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? splitLines(value)
      : [];
  for (const raw of rawItems) {
    const normalized = truncateSentence(normalizeText(String(raw || "").replace(/^\s*-\s*/u, "")), maxLength);
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

function compactBodyLines(value: unknown, maxLines: number, maxLength: number): string[] {
  return normalizeStringList(splitLines(String(value || "")), maxLines, maxLength);
}

function splitLines(value: unknown): string[] {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function truncateSentence(value: unknown, maxLength: number): string {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).replace(/[，。；,;:\s]+$/u, "")}…`;
}

function tryParseJson(text: unknown): JsonObject | null {
  try {
    const parsed = JSON.parse(String(text || "").trim());
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text: unknown): string {
  const input = String(text || "");
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return "";
  }
  return input.slice(start, end + 1);
}

function normalizeSemanticMode(value: unknown): "deterministic" | "hybrid" {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "deterministic" ? "deterministic" : "hybrid";
}

function normalizeTimeout(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

const __testing = {
  waitForSemanticTurnCompletion,
};

export {
  maybeGenerateSemanticReview,
  __testing,
};
