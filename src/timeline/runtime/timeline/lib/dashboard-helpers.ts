import type {
  TimelineDashboardData,
  TimelineRangeKey,
  TimelineView,
} from "../../contracts";

interface TimelineViewItemLike {
  id: string;
  start: string;
  end: string;
  content: string;
  style: string;
  className: string;
  tooltip: {
    title: string;
    note: string;
    color: string;
    durationText: string;
    timeText: string;
    dateText?: string;
  };
}

function buildMonthTimeline(data: TimelineDashboardData, monthKey: string): TimelineView | null {
  if (!data || !monthKey) {
    return null;
  }
  const dates = (data?.meta?.availableDates || []).filter((date) => date.startsWith(monthKey)).sort();
  if (!dates.length) {
    return null;
  }
  const anchorDate = "2000-01-01";
  return {
    key: monthKey,
    label: monthKey,
    start: `${anchorDate}T00:00:00.000+08:00`,
    end: `${anchorDate}T23:59:59.999+08:00`,
    groups: dates.map((date) => ({
      id: date,
      content: formatMonthGroupLabel(date),
    })),
    items: dates.flatMap((date) => {
      const dayTimeline = data?.timelines?.day?.[date];
      const dayItems = Array.isArray(dayTimeline?.items) ? dayTimeline.items : [];
      return dayItems.map((item: TimelineViewItemLike) => {
        const anchored = anchorItemRangeToReferenceDay(item.start, item.end, anchorDate);
        return {
          ...item,
          id: `${date}:${item.id}`,
          group: date,
          start: anchored.start,
          end: anchored.end,
          tooltip: {
            ...(item.tooltip || {}),
            dateText: date,
          },
        };
      });
    }),
  };
}

function anchorItemRangeToReferenceDay(startAt: string, endAt: string, anchorDate: string): { start: string; end: string } {
  const startClock = formatClockFromIso(startAt);
  const endClock = formatClockFromIso(endAt);
  let anchoredStart = `${anchorDate}T${startClock}:00+08:00`;
  let anchoredEnd = `${anchorDate}T${endClock}:00+08:00`;
  if (Date.parse(anchoredEnd) <= Date.parse(anchoredStart)) {
    anchoredEnd = `${offsetShanghaiDate(anchorDate, 1)}T${endClock}:00+08:00`;
  }
  return { start: anchoredStart, end: anchoredEnd };
}

function formatMonthGroupLabel(date: string): string {
  const weekday = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  }).format(Date.parse(`${date}T00:00:00+08:00`));
  return `${date.slice(5)} ${weekday}`;
}

function formatClockFromIso(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(Date.parse(value));
}

function offsetShanghaiDate(date: string, dayDelta: number): string {
  const timestamp = Date.parse(`${date}T00:00:00+08:00`);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp + dayDelta * 24 * 60 * 60 * 1000);
}

function formatDateTime(value: string): string {
  if (!value) {
    return "暂无";
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function formatRangeSelection(range: TimelineRangeKey, value: string): string {
  if (!value) {
    return "";
  }
  if (range === "day") {
    return value;
  }
  if (range === "week") {
    return `周 ${value}`;
  }
  return `${value} 月`;
}

function formatMinutes(value: number): string {
  const minutes = Number(value || 0);
  if (!Number.isFinite(minutes)) {
    return "0 分钟";
  }
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours} 小时 ${remaining} 分钟` : `${hours} 小时`;
}

function formatMinutesTick(value: number): string {
  const minutes = Number(value || 0);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

function formatCompactDuration(value: number): string {
  const minutes = Math.max(0, Number(value || 0));
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (hours <= 0) {
    return `${remaining}m`;
  }
  if (remaining <= 0) {
    return `${hours}h`;
  }
  return `${hours}h${remaining}m`;
}

function formatPercent(value: number): string {
  const percent = Number(value || 0) * 100;
  if (!Number.isFinite(percent)) {
    return "0%";
  }
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function buildScaledDepthColor(color: string, ratio: number): string {
  const normalized = Math.max(0, Math.min(1, Number(ratio || 0)));
  const curved = normalized ** 1.8;
  const colorWeight = Math.round(22 + (curved * 70));
  const whiteWeight = 100 - colorWeight;
  return `color-mix(in srgb, ${color} ${colorWeight}%, white ${whiteWeight}%)`;
}

export {
  buildMonthTimeline,
  buildScaledDepthColor,
  formatCompactDuration,
  formatDateTime,
  formatMinutes,
  formatMinutesTick,
  formatPercent,
  formatRangeSelection,
};
