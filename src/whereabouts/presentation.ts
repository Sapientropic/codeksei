import { normalizeText } from "../contracts/text-normalization";
import type {
  WhereaboutsMove,
  WhereaboutsSnapshot,
  WhereaboutsStay,
  WhereaboutsSummary,
} from "./contracts";

export function buildWhereaboutsStatusLine(summary: WhereaboutsSummary): string {
  return [
    summary.locationSummary,
    summary.mobilitySummary,
    summary.batterySummary,
    summary.freshnessSummary,
  ].filter(Boolean).join("；");
}

export function buildWhereaboutsLayerReason(summary: WhereaboutsSummary): string {
  const trigger = normalizeText(summary.snapshot.lastContext?.trigger);
  return [
    buildWhereaboutsStatusLine(summary),
    trigger ? `trigger:${trigger}` : "",
  ].filter(Boolean).join("；");
}

export function renderWhereaboutsSnapshotText(snapshot: WhereaboutsSnapshot): string {
  const lines = [
    "Codeksei whereabouts snapshot",
    `位置：${snapshot.locationSummary || "位置未知"}`,
    `移动：${snapshot.recentMove ? "刚移动过" : snapshot.motion?.state === "stationary" ? "静止中" : snapshot.motion?.state || "移动状态未知"}`,
    `电量：${describeBattery(snapshot)}`,
    `新鲜度：${snapshot.freshnessSummary || "未知"}`,
  ];
  const trigger = normalizeText(snapshot.lastContext?.trigger);
  const source = normalizeText(snapshot.lastContext?.source);
  if (trigger || source) {
    lines.push(`最近上报：${[trigger, source].filter(Boolean).join(" / ")}`);
  }
  if (snapshot.lastEventAt) {
    lines.push(`最后事件：${snapshot.lastEventAt}`);
  }
  return lines.join("\n");
}

export function renderWhereaboutsSummaryText(summary: WhereaboutsSummary): string {
  const lines = [
    "Codeksei whereabouts summary",
    `位置：${summary.locationSummary || "位置未知"}`,
    `移动：${summary.mobilitySummary || "移动状态未知"}`,
    `电量：${summary.batterySummary || "电量未知"}`,
    `新鲜度：${summary.freshnessSummary || "未知"}`,
  ];
  const trigger = normalizeText(summary.snapshot.lastContext?.trigger);
  if (trigger) {
    lines.push(`触发原因：${trigger}`);
  }
  return lines.join("\n");
}

export function renderWhereaboutsStaysText(stays: WhereaboutsStay[]): string {
  if (!stays.length) {
    return "Codeksei whereabouts recent-stays\n暂无停留记录。";
  }
  return [
    "Codeksei whereabouts recent-stays",
    ...stays.map((stay, index) => (
      `${index + 1}. ${stay.place?.label || stay.locationSummary || "位置未知"} | ${stay.startedAt} -> ${stay.endedAt} | ${stay.durationMinutes} 分钟`
    )),
  ].join("\n");
}

export function renderWhereaboutsMovesText(moves: WhereaboutsMove[]): string {
  if (!moves.length) {
    return "Codeksei whereabouts recent-moves\n暂无移动记录。";
  }
  return [
    "Codeksei whereabouts recent-moves",
    ...moves.map((move, index) => (
      `${index + 1}. ${move.fromPlace?.label || "未知"} -> ${move.toPlace?.label || "未知"} | ${move.startedAt} -> ${move.endedAt} | ${move.durationMinutes} 分钟`
    )),
  ].join("\n");
}

function describeBattery(snapshot: WhereaboutsSnapshot): string {
  if (!snapshot.battery) {
    return "电量未知";
  }
  if (snapshot.battery.charging) {
    return "充电中";
  }
  if (snapshot.battery.isLow) {
    return "低电";
  }
  return "电量正常";
}
