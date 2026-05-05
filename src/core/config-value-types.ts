import { normalizeText } from "../contracts/text-normalization";

export type CodekseiChannel = string;
export type CodekseiRuntimeProvider = "codex" | "claudecode" | "hermes" | "openclaw-reserved";
export type CodekseiChannelProvider = "codeksei" | "hermes" | "host";
export type CodekseiExecutionMode = "codex" | "claudecode" | "hosted" | "unsupported";
export type WeixinReplyMode = "settled" | "stream";
export type CodekseiRuntimeAccessMode = "" | "current" | "full-access" | "workspace-write";
export type ReviewSemanticHost = "auto" | "codex" | "hermes" | "deterministic";

export function normalizeCodekseiRuntimeProvider(value: unknown): CodekseiRuntimeProvider | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "hermes") {
    return "hermes";
  }
  if (normalized === "claudecode" || normalized === "claude-code" || normalized === "claude_code") {
    return "claudecode";
  }
  if (normalized === "openclaw-reserved") {
    return "openclaw-reserved";
  }
  return normalized === "codex" ? "codex" : "";
}

export function normalizeCodekseiChannelProvider(value: unknown): CodekseiChannelProvider | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "hermes") {
    return "hermes";
  }
  if (normalized === "host" || normalized === "generic-host") {
    return "host";
  }
  return normalized === "codeksei" ? "codeksei" : "";
}

export function normalizeCodekseiChannel(value: unknown): CodekseiChannel | "" {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || "";
}

export function normalizeWeixinReplyMode(value: unknown): WeixinReplyMode {
  return normalizeText(value).toLowerCase() === "settled" ? "settled" : "stream";
}

export function normalizeCodekseiRuntimeAccessMode(value: unknown): CodekseiRuntimeAccessMode {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "default") {
    return "current";
  }
  if (normalized === "current" || normalized === "full-access" || normalized === "workspace-write") {
    return normalized;
  }
  return "";
}

export function normalizeReviewSemanticHost(value: unknown): ReviewSemanticHost {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "codex" || normalized === "hermes" || normalized === "deterministic") {
    return normalized;
  }
  return "auto";
}

export function normalizeOptionalReviewSemanticHost(value: unknown): ReviewSemanticHost | "" {
  const normalized = normalizeText(value);
  return normalized ? normalizeReviewSemanticHost(normalized) : "";
}
