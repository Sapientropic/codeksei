import {
  normalizeReviewSemanticHost,
  type ReviewSemanticHost,
} from "./config-value-types";
import { resolveHostMode, type HostModeConfigInput } from "./host-mode-resolution";
export type { ReviewSemanticHost } from "./config-value-types";

export interface ReviewSemanticHostConfigInput extends HostModeConfigInput {
  reviewSemanticHost?: unknown;
  CODEKSEI_REVIEW_SEMANTIC_HOST?: unknown;
}

export function resolveActiveSemanticReviewHost(
  config: ReviewSemanticHostConfigInput = {},
): Exclude<ReviewSemanticHost, "auto"> {
  const requestedHost = normalizeReviewSemanticHost(
    config.reviewSemanticHost || config.CODEKSEI_REVIEW_SEMANTIC_HOST,
  );
  if (requestedHost === "deterministic" || requestedHost === "codex" || requestedHost === "hermes") {
    return requestedHost;
  }
  return resolveHostMode(config).profile === "hosted-hermes-weixin" ? "hermes" : "codex";
}

export function buildSemanticReviewUnavailableReason(
  requestedHost: ReviewSemanticHost,
  activeHost: Exclude<ReviewSemanticHost, "auto">,
  hermesAvailable: boolean,
): string {
  if (activeHost === "deterministic") {
    return "semantic review host 已显式固定为 deterministic。";
  }
  if (activeHost === "codex") {
    return requestedHost === "codex"
      ? "semantic review host 已显式固定为 codex。"
      : "当前 host profile 默认仍走 codex semantic host。";
  }
  return hermesAvailable
    ? ""
    : "当前需要 Hermes semantic host，但找不到可执行的 Hermes 命令。";
}

export { normalizeReviewSemanticHost };
