import * as fs from "node:fs";
import * as path from "node:path";

import type { TimelineDashboardMetaOverrides, TimelineDay, TimelineLocale, TimelineState } from "../../contracts";
import type { TimelineStore } from "./timeline-store";
import { resolveTimelineLocale } from "../i18n/timeline-locale";

const DEMO_FACTS_ZH_PATH = path.join(__dirname, "..", "..", "..", "examples", "demo-facts.json");
const DEMO_FACTS_EN_PATH = path.join(__dirname, "..", "..", "..", "examples", "demo-facts.en.json");

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
  const demoFacts = readDemoFacts(demoFactsPath);
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
  // Keep English demo data optional at runtime so local builds still work if the
  // asset is missing, while tests assert the published dist includes it.
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

export {
  getTimelineDemoFactsPath,
  loadTimelineSourceData,
};
