import { normalizeText } from "../contracts/text-normalization";
import type { PulseConfig } from "./generate";

const PULSE_STALE_REASON_LABELS = Object.freeze({
  missing_today_diary: "今天的 diary 还不够完整",
  stale_companion_and_checkin_handoff: "最近的 companion note / check-in handoff 还不够新",
} as const);

export function extractWhereaboutsReason(
  inspection: {
    layers: Array<{ id: string; included: boolean; reason: string }>;
  },
): string {
  return inspection.layers.find((layer) => (
    layer.id === "whereabouts"
    && layer.included
    && normalizeText(layer.reason)
  ))?.reason || "";
}

export function collectPulseLocalPaths(
  config: Pick<PulseConfig, "stateDir" | "workspaceRoot">,
  inspection: {
    target: { workspaceRoot: string };
  },
): string[] {
  return [
    normalizeText(config.stateDir),
    normalizeText(config.workspaceRoot),
    normalizeText(inspection.target.workspaceRoot),
  ].filter(Boolean);
}

export function sanitizePulseVisibleInline(value: unknown, localPaths: string[]): string {
  return sanitizePulseVisibleBlock(value, localPaths).replace(/\r?\n+/gu, " ").trim();
}

export function sanitizePulseVisibleBlock(value: unknown, localPaths: string[]): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const lines = normalized
    .split(/\r?\n/u)
    .map((line) => sanitizePulseVisibleLine(line, localPaths))
    .filter(Boolean);
  const uniqueLines: string[] = [];
  for (const line of lines) {
    if (uniqueLines.includes(line)) {
      continue;
    }
    uniqueLines.push(line);
  }
  return uniqueLines.join("\n").trim();
}

export function formatPulseStaleReason(reason: string): string {
  return PULSE_STALE_REASON_LABELS[reason as keyof typeof PULSE_STALE_REASON_LABELS] || reason;
}

function sanitizePulseVisibleLine(line: string, localPaths: string[]): string {
  let next = normalizeText(line);
  if (!next) {
    return "";
  }
  if (next.includes("whereabouts 还没有本地位置事件")) {
    return "";
  }
  next = next.replace(/stale_companion_and_checkin_handoff/gu, formatPulseStaleReason("stale_companion_and_checkin_handoff"));
  next = next.replace(/missing_today_diary/gu, formatPulseStaleReason("missing_today_diary"));
  for (const localPath of localPaths) {
    if (!localPath) {
      continue;
    }
    const escapedPath = escapeRegExp(localPath);
    next = next.replace(new RegExp(`${escapedPath}[^\\n]*?\\s+-\\s+`, "gu"), "");
    next = next.split(localPath).join("<local-path>");
  }
  next = next.replace(/\s{2,}/gu, " ").trim();
  return next === "<local-path>" ? "" : next;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
