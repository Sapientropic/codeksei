import type { ReviewDatedLines, ReviewSupplementGroup } from "./review-types";
import { normalizeLineItem } from "./review-draft-heuristics";

export function renderBulletList(items: string[], fallbackText: string): string {
  const lines = items.length
    ? items.map((item) => `- ${normalizeLineItem(item)}`)
    : [`- ${fallbackText}`];
  return lines.join("\n");
}

export function renderDatedGroups(groups: ReviewDatedLines[], fallbackText: string): string {
  if (!groups.length) {
    return `- ${fallbackText}`;
  }
  const parts: string[] = [];
  for (const group of groups) {
    parts.push(`### ${group.date}`);
    for (const line of group.lines) {
      parts.push(`- ${normalizeLineItem(line)}`);
    }
  }
  return parts.join("\n");
}

export function renderSupplementGroups(items: ReviewSupplementGroup[], fallbackText: string): string {
  if (!items.length) {
    return `- ${fallbackText}`;
  }
  const parts: string[] = [];
  for (const item of items) {
    const heading = item.title
      ? `### ${item.date} ${item.title}`
      : `### ${item.date}`;
    parts.push(heading);
    parts.push(item.body || "-");
  }
  return parts.join("\n\n");
}
