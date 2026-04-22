import { resolveCodekseiLocale, type CodekseiLocale } from "./locale";

export const DIARY_SECTION_HEADING_REGISTRY = Object.freeze({
  todo: {
    headings: { "zh-CN": "Todo", en: "Todo" },
    aliases: ["Todo"],
  },
  timeline: {
    headings: { "zh-CN": "时间线事实", en: "Timeline Facts" },
    aliases: ["时间线事实", "Timeline Facts"],
  },
  fragment: {
    headings: { "zh-CN": "今日碎片", en: "Daily Fragments" },
    aliases: ["今日碎片", "Daily Fragments", "Fragments"],
  },
  supplement: {
    headings: { "zh-CN": "补充记录", en: "Supplement" },
    aliases: ["补充记录", "Supplement", "Supplemental Notes"],
  },
  summary: {
    headings: { "zh-CN": "总结", en: "Summary" },
    aliases: ["总结", "Summary"],
  },
});

export type DiarySection = keyof typeof DIARY_SECTION_HEADING_REGISTRY;

export function getDiarySectionHeading(section: DiarySection, locale?: unknown): string {
  return DIARY_SECTION_HEADING_REGISTRY[section].headings[resolveCodekseiLocale(locale)];
}

export function getDiarySectionHeadingAliases(section: DiarySection): string[] {
  return [...DIARY_SECTION_HEADING_REGISTRY[section].aliases];
}

export function resolveDiaryLocale(locale?: unknown): CodekseiLocale {
  return resolveCodekseiLocale(locale);
}
