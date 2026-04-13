import * as fs from "node:fs";
import * as path from "node:path";

import type { TimelineDashboardMetaOverrides, TimelineDay, TimelineLocale, TimelineState } from "../../contracts";
import type { TimelineStore } from "./timeline-store";
import { resolveTimelineLocale } from "../i18n/timeline-locale";

const DEMO_FACTS_ZH_PATH = path.join(__dirname, "..", "..", "..", "examples", "demo-facts.json");
const DEMO_FACTS_EN_PATH = path.join(__dirname, "..", "..", "..", "examples", "demo-facts.en.json");
const DEMO_TITLE_TRANSLATIONS: Record<string, string> = {
  "上午编码": "Morning coding",
  "下午收口开发": "Afternoon implementation wrap-up",
  "下午沟通": "Afternoon sync",
  "专注编码": "Focused coding",
  "出去走走": "Walk outside",
  "出门通勤": "Commute out",
  "刷手机": "Phone scrolling",
  "刷手机和放空": "Phone scrolling and zoning out",
  "刷短视频": "Short videos",
  "午饭": "Lunch",
  "午饭和放空": "Lunch and reset",
  "和家人通话": "Call with family",
  "和朋友聊天": "Catch up with a friend",
  "学一门小课程": "Small course block",
  "家务和整理": "Chores and reset",
  "小睡": "Nap",
  "推进核心开发": "Core implementation",
  "收拾家里": "Reset the apartment",
  "收拾房间": "Tidy the room",
  "收拾整理": "Tidy up",
  "散步买点东西": "Walk and pick up supplies",
  "早餐": "Breakfast",
  "早餐和收拾出门": "Breakfast and get ready",
  "晚饭": "Dinner",
  "晨间同步": "Morning sync",
  "洗漱和简单整理": "Wash up and reset",
  "洗澡": "Shower",
  "洗澡收尾": "Shower and close out",
  "看剧放松": "Watch a show",
  "看点视频": "Watch something light",
  "看点视频放松": "Videos to unwind",
  "看课程补知识点": "Course review",
  "睡前阅读": "Bedtime reading",
  "睡觉（凌晨）": "Sleep (early morning)",
  "睡觉（夜间）": "Sleep (night block)",
  "简单锻炼": "Light workout",
  "继续写代码": "Keep coding",
  "继续开发": "Continue implementation",
  "继续看剧": "Keep watching the show",
  "聊天": "Chat",
  "聊天和回消息": "Messages and replies",
  "通勤": "Commute",
  "阅读和做笔记": "Reading and notes",
  "阅读和复盘": "Reading and review",
  "阅读和整理想法": "Reading and sorting ideas",
  "项目对齐": "Project sync",
  "饭后走一圈": "Post-lunch walk",
};

interface TimelineSourceData {
  state: TimelineState;
  meta: TimelineDashboardMetaOverrides;
}

function loadTimelineSourceData({
  store,
  locale = "zh-CN",
}: {
  store: TimelineStore;
  locale?: TimelineLocale | string;
}): TimelineSourceData {
  const baseState = store.getState();
  const taxonomyUpdatedAt = readFileUpdatedAt(store.taxonomyFilePath);
  const factsUpdatedAt = readFileUpdatedAt(store.factsFilePath);
  const resolvedLocale = resolveTimelineLocale(locale);
  const facts = baseState?.facts && typeof baseState.facts === "object" ? baseState.facts : {};

  if (Object.keys(facts).length > 0) {
    return {
      state: baseState,
      meta: {
        updatedAt: factsUpdatedAt || taxonomyUpdatedAt || "",
        factsUpdatedAt,
        taxonomyUpdatedAt,
        isDemoData: false,
        locale: resolvedLocale,
      },
    };
  }

  const demoFactsPath = getTimelineDemoFactsPath(resolvedLocale);
  const demoFacts = localizeDemoFacts(readDemoFacts(demoFactsPath), resolvedLocale, {
    sourcePath: demoFactsPath,
  });
  const demoFactsUpdatedAt = readFileUpdatedAt(demoFactsPath);
  if (!demoFacts || !Object.keys(demoFacts).length) {
    return {
      state: baseState,
      meta: {
        updatedAt: factsUpdatedAt || taxonomyUpdatedAt || "",
        factsUpdatedAt,
        taxonomyUpdatedAt,
        isDemoData: false,
        locale: resolvedLocale,
      },
    };
  }

  return {
      state: {
        ...baseState,
        facts: demoFacts,
      },
    meta: {
      updatedAt: demoFactsUpdatedAt || taxonomyUpdatedAt || "",
      factsUpdatedAt: demoFactsUpdatedAt,
      taxonomyUpdatedAt,
      isDemoData: true,
      locale: resolvedLocale,
    },
  };
}

function getTimelineDemoFactsPath(locale: TimelineLocale | string = "zh-CN"): string {
  const resolvedLocale = resolveTimelineLocale(locale);
  if (resolvedLocale === "en" && fs.existsSync(DEMO_FACTS_EN_PATH)) {
    return DEMO_FACTS_EN_PATH;
  }
  return DEMO_FACTS_ZH_PATH;
}

function readFileUpdatedAt(filePath: string): string {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return "";
    }
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return "";
  }
}

function readDemoFacts(filePath: string): Record<string, TimelineDay> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed?.facts && typeof parsed.facts === "object"
      ? (parsed.facts as Record<string, TimelineDay>)
      : {};
  } catch {
    return null;
  }
}

function localizeDemoFacts(
  facts: Record<string, TimelineDay> | null,
  locale: TimelineLocale,
  { sourcePath = "" }: { sourcePath?: string } = {},
): Record<string, TimelineDay> | null {
  if (!facts) {
    return null;
  }
  if (locale !== "en" || sourcePath !== DEMO_FACTS_ZH_PATH) {
    return facts;
  }
  const localized: Record<string, TimelineDay> = {};
  for (const [date, day] of Object.entries(facts)) {
    localized[date] = {
      ...day,
      events: Array.isArray(day?.events)
        ? day.events.map((event) => ({
          ...event,
          note: "",
          title: DEMO_TITLE_TRANSLATIONS[event.title] || event.title,
        }))
        : [],
    };
  }
  return localized;
}

export {
  getTimelineDemoFactsPath,
  loadTimelineSourceData,
};
