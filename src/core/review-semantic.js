const { CodexRpcClient } = require("../adapters/runtime/codex/rpc-client");
const {
  extractAssistantText,
  extractFailureText,
  extractThreadId,
  extractThreadIdFromParams,
  extractTurnIdFromParams,
  isAssistantItemCompleted,
} = require("../adapters/runtime/codex/message-utils");
const { resolveCodexWorkspaceRoot } = require("./workspace-alias");

const DEFAULT_TIMEOUT_MS = 120_000;

async function maybeGenerateSemanticReview(config = {}, input = {}) {
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

async function runCodexSemanticReview(config = {}, input = {}) {
  const prompt = buildSemanticPrompt(input);
  const timeoutMs = normalizeTimeout(config.reviewSemanticTimeoutMs) || DEFAULT_TIMEOUT_MS;
  const model = normalizeText(input?.options?.model || config.reviewSemanticModel);
  const workspaceRoot = resolveCodexWorkspaceRoot(input?.profile?.workspaceRoot || config.workspaceRoot || process.cwd());
  const client = new CodexRpcClient({
    endpoint: config.codexEndpoint,
    codexCommand: config.codexCommand,
    env: process.env,
    extraWritableRoots: [config.stateDir],
  });

  try {
    await client.connect();
    await client.initialize();
    const response = await client.startThread({ cwd: workspaceRoot });
    const threadId = extractThreadId(response);
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

function buildSemanticGeneratorInput(config = {}, input = {}) {
  return {
    config,
    profile: input.profile,
    window: input.window,
    diaryEntries: input.diaryEntries,
    nightlyEntries: input.nightlyEntries,
    deterministicDraft: input.deterministicDraft,
    options: input.options || {},
    sourcePack: buildSemanticSourcePack(input),
  };
}

function buildSemanticPrompt(input = {}) {
  const kind = normalizeText(input?.profile?.kind);
  const schema = kind === "nightly"
    ? NIGHTLY_SCHEMA_PROMPT
    : PERIODIC_SCHEMA_PROMPT;
  const sourcePack = buildSemanticSourcePack(input);

  return [
    "你在做 Codeksei 生活助理复盘的语义提炼。",
    "你已经拿到了全部需要的源材料，不要调用工具，不要读文件，不要追问，不要补充不存在的事实。",
    "目标不是覆盖所有事件，而是压出高信号复盘：真正的推进、值得记住的摩擦、仍开着的线头、下一次更容易接上的入口。",
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

function buildSemanticSourcePack(input = {}) {
  const deterministicDraft = input.deterministicDraft || {};
  const kind = normalizeText(input?.profile?.kind);
  return {
    kind,
    periodLabel: deterministicDraft.periodLabel || "",
    window: {
      startDate: input?.window?.startDate || "",
      endDate: input?.window?.endDate || "",
    },
    windowFacts: Array.isArray(deterministicDraft.windowFacts) ? deterministicDraft.windowFacts : [],
    deterministicBaseline: buildDeterministicBaseline(kind, deterministicDraft.insights || {}),
    diaryDays: compactDiaryDays(input.diaryEntries),
    nightlyDays: compactNightlyDays(input.nightlyEntries),
  };
}

function buildDeterministicBaseline(kind, insights = {}) {
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

function compactDiaryDays(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    date: normalizeText(entry?.date),
    openTodos: normalizeStringList(entry?.todo?.open, 5, 140),
    doneTodos: normalizeStringList(entry?.todo?.done, 5, 140),
    summary: normalizeStringList(entry?.summary, 6, 180),
    timeline: normalizeStringList(entry?.timeline, 4, 160),
    fragment: normalizeStringList(entry?.fragment, 4, 180),
    supplement: normalizeSupplementGroups(
      (Array.isArray(entry?.supplement) ? entry.supplement : []).map((item) => ({
        date: normalizeText(entry?.date),
        title: normalizeText(item?.title),
        body_lines: compactBodyLines(item?.body, 3, 180),
      })),
      5,
      3,
      180
    ),
  }));
}

function compactNightlyDays(entries) {
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

function waitForSemanticTurnCompletion(client, threadId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let activeTurnId = "";
    const textByItemId = new Map();
    const itemOrder = [];

    const cleanup = () => {
      unsubscribe();
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`semantic review timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const unsubscribe = client.onMessage((message) => {
      const params = message?.params || {};
      const messageThreadId = extractThreadIdFromParams(params);
      if (messageThreadId && messageThreadId !== threadId) {
        return;
      }

      if (message?.method === "turn/started" || message?.method === "turn/start") {
        activeTurnId = extractTurnIdFromParams(params) || activeTurnId;
        return;
      }

      // Review summarization is meant to be a pure thinking pass over the
      // provided source pack. If Codex wants tools or escalation here, the
      // safe behavior is to abort and fall back to deterministic extraction.
      if (isApprovalRequest(message)) {
        cleanup();
        reject(new Error("semantic review requested approval"));
        return;
      }

      if (message?.method === "item/agentMessage/delta" || isAssistantItemCompleted(message)) {
        const itemId = normalizeText(params?.itemId || params?.item?.id) || `item-${itemOrder.length + 1}`;
        const nextText = extractAssistantText(params);
        if (!textByItemId.has(itemId)) {
          itemOrder.push(itemId);
          textByItemId.set(itemId, "");
        }
        if (nextText) {
          if (message?.method === "item/agentMessage/delta") {
            textByItemId.set(itemId, `${textByItemId.get(itemId) || ""}${nextText}`);
          } else {
            textByItemId.set(itemId, nextText);
          }
        }
        return;
      }

      if (message?.method === "turn/failed") {
        cleanup();
        reject(new Error(extractFailureText(params)));
        return;
      }

      if (message?.method === "turn/completed") {
        const completedTurnId = extractTurnIdFromParams(params);
        if (activeTurnId && completedTurnId && completedTurnId !== activeTurnId) {
          return;
        }
        cleanup();
        // Semantic review expects the terminal JSON payload. Codex can emit
        // multiple assistant messages within one turn, so concatenating every
        // message here risks mixing progress chatter into the final JSON blob.
        const text = itemOrder
          .slice()
          .reverse()
          .map((itemId) => textByItemId.get(itemId) || "")
          .find((value) => String(value || "").trim()) || "";
        if (!text) {
          reject(new Error("semantic review returned empty text"));
          return;
        }
        resolve(String(text).trim());
      }
    });
  });
}

function isApprovalRequest(message) {
  return typeof message?.method === "string" && message.method.endsWith("requestApproval");
}

function parseSemanticJson(text) {
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

function normalizeSemanticResult(kind, raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (kind === "nightly") {
    return {
      progress: normalizeStringList(raw.progress, 5, 160),
      friction: normalizeStringList(raw.friction, 5, 220),
      openLoops: normalizeStringList(raw.open_loops || raw.openLoops, 6, 160),
      carryForward: normalizeStringList(raw.carry_forward || raw.carryForward, 4, 160),
      closeout: normalizeStringList(raw.closeout, 5, 180),
      signals: normalizeStringList(raw.signals, 5, 160),
    };
  }
  return {
    progress: normalizeStringList(raw.progress, 6, 180),
    friction: normalizeStringList(raw.friction, 6, 220),
    openLoops: normalizeStringList(raw.open_loops || raw.openLoops, 6, 160),
    carryForward: normalizeStringList(raw.carry_forward || raw.carryForward, 4, 160),
    dailySummaries: normalizeDayGroups(raw.daily_summaries || raw.dailySummaries, 31, 3, 160),
    supplements: normalizeSupplementGroups(raw.supplement_groups || raw.supplements, 8, 4, 180),
  };
}

function hasSemanticPayload(kind, data) {
  if (!data || typeof data !== "object") {
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

function normalizeDayGroups(value, maxGroups, maxLines, maxLength) {
  const groups = [];
  const seen = new Set();
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

function normalizeSupplementGroups(value, maxGroups, maxLines, maxLength) {
  const groups = [];
  const seen = new Set();
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

function normalizeStringList(value, maxItems, maxLength) {
  const items = [];
  const seen = new Set();
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

function compactBodyLines(value, maxLines, maxLength) {
  return normalizeStringList(splitLines(String(value || "")), maxLines, maxLength);
}

function splitLines(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function truncateSentence(value, maxLength) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).replace(/[，。；,;:\s]+$/u, "")}…`;
}

function tryParseJson(text) {
  try {
    const parsed = JSON.parse(String(text || "").trim());
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text) {
  const input = String(text || "");
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return "";
  }
  return input.slice(start, end + 1);
}

function normalizeSemanticMode(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "deterministic" ? "deterministic" : "hybrid";
}

function normalizeTimeout(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

module.exports = {
  maybeGenerateSemanticReview,
};
