import { useEffect, useState } from "react";
import type {
  TimelineDashboardData,
  TimelineDashboardMetaOverrides,
  TimelineState,
} from "../../contracts";
import { buildTimelineViews } from "../../infra/timeline/timeline-analytics";

const EMPTY_DASHBOARD_DATA: TimelineDashboardData = {
  meta: {
    generatedAt: "",
    updatedAt: "",
    taxonomyUpdatedAt: "",
    factsUpdatedAt: "",
    isDemoData: false,
    timezone: "Asia/Shanghai",
    availableDates: [],
    latestDate: "",
  },
  ranges: { day: {}, week: {}, month: {} },
  timelines: { day: {}, week: {} },
  taxonomy: { categories: [], eventNodes: [] },
};

interface RuntimeTimelineSourcePayload {
  state: TimelineState;
  meta: TimelineDashboardMetaOverrides;
}

function useTimelineDashboardData() {
  const [data, setData] = useState<TimelineDashboardData>(EMPTY_DASHBOARD_DATA);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedWeek, setSelectedWeek] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");

  useEffect(() => {
    let cancelled = false;
    const version = typeof window !== "undefined" && window.__TIMELINE_DEV_VERSION__
      ? `?v=${window.__TIMELINE_DEV_VERSION__}`
      : "";

    loadTimelineDashboardData(version)
      .then((nextData) => {
        if (cancelled) {
          return;
        }
        const latestDate = nextData?.meta?.latestDate || "";
        const weekKeys = Object.keys(nextData?.ranges?.week || {}).sort();
        const monthKeys = Object.keys(nextData?.ranges?.month || {}).sort();
        setData(nextData);
        setSelectedDate(latestDate);
        setSelectedWeek(weekKeys[weekKeys.length - 1] || "");
        setSelectedMonth(monthKeys[monthKeys.length - 1] || "");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setData(EMPTY_DASHBOARD_DATA);
        setSelectedDate("");
        setSelectedWeek("");
        setSelectedMonth("");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    data,
    selectedDate,
    selectedMonth,
    selectedWeek,
    setSelectedDate,
    setSelectedMonth,
    setSelectedWeek,
  };
}

async function loadTimelineDashboardData(version: string): Promise<TimelineDashboardData> {
  const runtimeData = await fetchJson<RuntimeTimelineSourcePayload>(`./__timeline_source_data${version}`).catch(() => null);
  if (runtimeData?.state && runtimeData?.meta) {
    return buildTimelineViews(runtimeData.state, runtimeData.meta);
  }
  return fetchJson<TimelineDashboardData>(`./dashboard-data.json${version}`);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  return response.json() as Promise<T>;
}

export { useTimelineDashboardData };
