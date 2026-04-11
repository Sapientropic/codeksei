function extractThreadId(response) {
  return response?.result?.thread?.id || null;
}

function extractThreadIdFromParams(params) {
  return normalizeIdentifier(params?.threadId);
}

function extractTurnIdFromParams(params) {
  return normalizeIdentifier(params?.turnId || params?.turn?.id);
}

function isAssistantItemCompleted(message) {
  return message?.method === "item/completed"
    && normalizeIdentifier(message?.params?.item?.type).toLowerCase() === "agentmessage";
}

function extractAssistantText(params) {
  const directText = [
    params?.delta,
    params?.item?.text,
  ];
  for (const value of directText) {
    if (typeof value === "string" && value.length > 0) {
      return normalizeLineEndings(value);
    }
  }

  const contentObjects = [
    params?.item?.content,
    params?.content,
  ];
  for (const content of contentObjects) {
    const extracted = extractRawTextFromContent(content);
    if (extracted) {
      return extracted;
    }
  }

  return "";
}

function extractAssistantPhase(params) {
  const candidates = [
    params?.phase,
    params?.item?.phase,
    params?.item?.metadata?.phase,
    params?.metadata?.phase,
  ];
  for (const value of candidates) {
    const normalized = normalizeAssistantPhase(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function extractFailureText(params) {
  const rawMessage = normalizeIdentifier(params?.turn?.error?.message || params?.error?.message);
  return rawMessage ? `执行失败：${rawMessage}` : "执行失败";
}

function normalizeIdentifier(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLineEndings(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function normalizeAssistantPhase(value) {
  const normalized = normalizeIdentifier(value).toLowerCase();
  if (normalized === "commentary") {
    return "commentary";
  }
  // Raw Codex sessions currently emit `commentary` and `final_answer`.
  // Keep this alias list here so stream-delivery does not fall back to fragile
  // text heuristics just because the upstream phase label changed shape.
  if (normalized === "final" || normalized === "final_answer") {
    return "final";
  }
  return "";
}

function extractRawTextFromContent(content) {
  if (typeof content === "string" && content.length > 0) {
    return normalizeLineEndings(content);
  }

  if (!content) {
    return "";
  }

  if (Array.isArray(content)) {
    const parts = [];
    for (const entry of content) {
      if (typeof entry === "string" && entry.length > 0) {
        parts.push(normalizeLineEndings(entry));
        continue;
      }
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const entryType = String(entry.type || "").toLowerCase();
      if (entryType === "text" && typeof entry.text === "string" && entry.text.length > 0) {
        parts.push(normalizeLineEndings(entry.text));
        continue;
      }
      if (typeof entry.text === "string" && entry.text.length > 0) {
        parts.push(normalizeLineEndings(entry.text));
        continue;
      }
      if (typeof entry.value === "string" && entry.value.length > 0) {
        parts.push(normalizeLineEndings(entry.value));
      }
    }
    return parts.join("");
  }

  if (typeof content !== "object") {
    return "";
  }

  if (typeof content.text === "string" && content.text.length > 0) {
    return normalizeLineEndings(content.text);
  }

  return "";
}

module.exports = {
  extractAssistantPhase,
  extractAssistantText,
  extractFailureText,
  extractThreadId,
  extractThreadIdFromParams,
  extractTurnIdFromParams,
  isAssistantItemCompleted,
  normalizeAssistantPhase,
};
