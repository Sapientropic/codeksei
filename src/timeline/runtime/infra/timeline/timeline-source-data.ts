import * as fs from "node:fs";
import * as path from "node:path";

import type { TimelineDashboardMetaOverrides, TimelineDay, TimelineState } from "../../contracts";
import type { TimelineStore } from "./timeline-store";

const DEMO_FACTS_PATH = path.join(__dirname, "..", "..", "..", "examples", "demo-facts.json");

interface TimelineSourceData {
  state: TimelineState;
  meta: TimelineDashboardMetaOverrides;
}

function loadTimelineSourceData({ store }: { store: TimelineStore }): TimelineSourceData {
  const baseState = store.getState();
  const taxonomyUpdatedAt = readFileUpdatedAt(store.taxonomyFilePath);
  const factsUpdatedAt = readFileUpdatedAt(store.factsFilePath);
  const facts = baseState?.facts && typeof baseState.facts === "object" ? baseState.facts : {};

  if (Object.keys(facts).length > 0) {
    return {
      state: baseState,
      meta: {
        updatedAt: factsUpdatedAt || taxonomyUpdatedAt || "",
        factsUpdatedAt,
        taxonomyUpdatedAt,
        isDemoData: false,
      },
    };
  }

  const demoFacts = readDemoFacts(DEMO_FACTS_PATH);
  const demoFactsUpdatedAt = readFileUpdatedAt(DEMO_FACTS_PATH);
  if (!demoFacts || !Object.keys(demoFacts).length) {
    return {
      state: baseState,
      meta: {
        updatedAt: factsUpdatedAt || taxonomyUpdatedAt || "",
        factsUpdatedAt,
        taxonomyUpdatedAt,
        isDemoData: false,
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
    },
  };
}

function getTimelineDemoFactsPath(): string {
  return DEMO_FACTS_PATH;
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
