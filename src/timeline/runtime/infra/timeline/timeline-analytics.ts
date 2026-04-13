import type {
  TimelineCategoryDetail,
  TimelineDashboardData,
  TimelineLocale,
  TimelineDashboardMetaOverrides,
  TimelineDay,
  TimelineEvent,
  TimelineEventBlock,
  TimelineEventNode,
  TimelineRangeAggregate,
  TimelineSubcategoryDetail,
  TimelineTaxonomy,
  TimelineTrendPoint,
  TimelineView,
  TimelineViewItem,
  TimelineState,
} from "../../contracts";
import {
  getTimelineText,
  localizeTimelineTaxonomy,
  resolveTimelineLocale,
} from "../i18n/timeline-locale";

type TimelineCategoryLookup = {
  categoryId: string;
  label: string;
  color: string;
};

type TimelineWeekRange = {
  key: string;
  label: string;
  start: string;
  end: string;
  dates: string[];
};

type TimelineRangeAggregateInput = {
  key: string;
  label: string;
  unit: "day" | "hour";
  events: TimelineEvent[];
  categoryMap: Map<string, TimelineCategoryLookup>;
  eventNodeMap: Map<string, TimelineEventNode>;
  allDates: string[];
  timelineDates?: string[];
  locale: TimelineLocale;
};

const CATEGORY_THEME_COLORS: Record<string, string> = {
  life: "var(--cat-life)",
  work: "var(--cat-work)",
  study: "var(--cat-study)",
  exercise: "var(--cat-exercise)",
  entertainment: "var(--cat-entertainment)",
  health: "var(--cat-health)",
  social: "var(--cat-social)",
  care: "var(--cat-care)",
  travel: "var(--cat-travel)",
  rest: "var(--cat-rest)",
};

function buildTimelineViews(
  state: TimelineState,
  metaOverrides: TimelineDashboardMetaOverrides = {},
  options: { locale?: TimelineLocale | string } = {},
): TimelineDashboardData {
  const locale = resolveTimelineLocale(options.locale || metaOverrides.locale);
  const dates = Object.keys(state.facts || {}).sort();
  const localizedTaxonomy = localizeTimelineTaxonomy(state.taxonomy, locale);
  const categoryMap = buildCategoryMap(localizedTaxonomy);
  const eventNodeMap = buildEventNodeMap(localizedTaxonomy);
  const dayTimelines: Record<string, TimelineView> = {};
  for (const date of dates) {
    dayTimelines[date] = buildDayTimeline(date, state.facts[date], categoryMap, locale);
  }

  const weekRanges = buildWeekRanges(dates, locale);
  const weekTimelines: Record<string, TimelineView> = {};
  for (const weekRange of weekRanges) {
    weekTimelines[weekRange.key] = buildWeekTimeline(weekRange, state.facts, categoryMap, locale);
  }

  const rangeData = {
    day: buildDayRangeData(dates, state, categoryMap, eventNodeMap, locale),
    week: buildWeekRangeData(weekRanges, state, categoryMap, eventNodeMap, locale),
    month: buildMonthRangeData(dates, state, categoryMap, eventNodeMap, locale),
  };

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      updatedAt: metaOverrides.updatedAt || "",
      taxonomyUpdatedAt: metaOverrides.taxonomyUpdatedAt || "",
      factsUpdatedAt: metaOverrides.factsUpdatedAt || "",
      isDemoData: Boolean(metaOverrides.isDemoData),
      timezone: state.timezone || "Asia/Shanghai",
      locale,
      availableDates: dates,
      latestDate: dates[dates.length - 1] || "",
    },
    taxonomy: {
      categories: localizedTaxonomy.categories,
      eventNodes: localizedTaxonomy.eventNodes,
    },
    timelines: {
      day: dayTimelines,
      week: weekTimelines,
    },
    ranges: rangeData,
  };
}

function buildDayTimeline(
  date: string,
  day: TimelineDay | null | undefined,
  categoryMap: Map<string, TimelineCategoryLookup>,
  locale: TimelineLocale,
): TimelineView {
  const events = Array.isArray(day?.events) ? day.events : [];
  return {
    date,
    start: `${date}T00:00:00.000+08:00`,
    end: `${date}T23:59:59.999+08:00`,
    groups: [],
    items: events.map((event) => ({
      id: event.id,
      start: event.startAt,
      end: event.endAt,
      content: buildTimelineItemContent(event),
      style: buildItemStyle(categoryMap.get(event.subcategoryId)?.color || categoryMap.get(event.categoryId)?.color || "#4E79A7"),
      tooltip: {
        title: event.title,
        note: event.note || "",
        color: categoryMap.get(event.subcategoryId)?.color || categoryMap.get(event.categoryId)?.color || "var(--cat-life)",
        durationText: formatMinutes(durationMinutes(event.startAt, event.endAt), locale),
        timeText: `${formatShanghaiClockTime(event.startAt)} - ${formatShanghaiClockTime(event.endAt)}`,
      },
      className: `cat-${event.categoryId}`,
    })),
  };
}

function buildWeekTimeline(
  weekRange: TimelineWeekRange,
  facts: Record<string, TimelineDay>,
  categoryMap: Map<string, TimelineCategoryLookup>,
  locale: TimelineLocale,
): TimelineView {
  const groups = weekRange.dates.map((date) => ({
    id: date,
    content: formatWeekday(date, locale),
  }));
  const items: TimelineViewItem[] = [];
  const anchorDate = "2000-01-01";
  for (const date of weekRange.dates) {
    const day = facts[date];
    for (const event of Array.isArray(day?.events) ? day.events : []) {
      const anchoredRange = anchorEventToReferenceDay(event.startAt, event.endAt, anchorDate);
      items.push({
        id: `${date}:${event.id}`,
        group: date,
        start: anchoredRange.start,
        end: anchoredRange.end,
        content: buildTimelineItemContent(event),
        style: buildItemStyle(categoryMap.get(event.subcategoryId)?.color || categoryMap.get(event.categoryId)?.color || "#4E79A7"),
        tooltip: {
          title: event.title,
          note: event.note || "",
          color: categoryMap.get(event.subcategoryId)?.color || categoryMap.get(event.categoryId)?.color || "var(--cat-life)",
          durationText: formatMinutes(durationMinutes(event.startAt, event.endAt), locale),
          timeText: `${formatShanghaiClockTime(event.startAt)} - ${formatShanghaiClockTime(event.endAt)}`,
          dateText: date,
        },
        className: `cat-${event.categoryId}`,
      });
    }
  }
  return {
    key: weekRange.key,
    label: weekRange.label,
    start: `${anchorDate}T00:00:00.000+08:00`,
    end: `${anchorDate}T23:59:59.999+08:00`,
    groups,
    items,
  };
}

function buildTimelineItemContent(event: TimelineEvent): string {
  const durationText = formatCompactDuration(durationMinutes(event.startAt, event.endAt));
  return `${event.title} | ${durationText}`;
}

function buildDayRangeData(
  dates: string[],
  state: TimelineState,
  categoryMap: Map<string, TimelineCategoryLookup>,
  eventNodeMap: Map<string, TimelineEventNode>,
  locale: TimelineLocale,
): Record<string, TimelineRangeAggregate> {
  const output: Record<string, TimelineRangeAggregate> = {};
  for (const date of dates) {
    output[date] = buildDayAggregate(date, state.facts[date]?.events || [], categoryMap, eventNodeMap, locale);
  }
  return output;
}

function buildWeekRangeData(
  weekRanges: TimelineWeekRange[],
  state: TimelineState,
  categoryMap: Map<string, TimelineCategoryLookup>,
  eventNodeMap: Map<string, TimelineEventNode>,
  locale: TimelineLocale,
): Record<string, TimelineRangeAggregate> {
  const output: Record<string, TimelineRangeAggregate> = {};
  for (const weekRange of weekRanges) {
    const events: TimelineEvent[] = [];
    for (const date of weekRange.dates) {
      events.push(...(state.facts[date]?.events || []));
    }
    output[weekRange.key] = buildRangeAggregate({
      key: weekRange.key,
      label: weekRange.label,
      unit: "day",
      events,
      categoryMap,
      eventNodeMap,
      allDates: weekRange.dates,
      locale,
    });
  }
  return output;
}

function buildMonthRangeData(
  dates: string[],
  state: TimelineState,
  categoryMap: Map<string, TimelineCategoryLookup>,
  eventNodeMap: Map<string, TimelineEventNode>,
  locale: TimelineLocale,
): Record<string, TimelineRangeAggregate> {
  const grouped = new Map<string, string[]>();
  for (const date of dates) {
    const monthKey = date.slice(0, 7);
    if (!grouped.has(monthKey)) {
      grouped.set(monthKey, []);
    }
    grouped.get(monthKey)!.push(date);
  }
  const output: Record<string, TimelineRangeAggregate> = {};
  for (const [monthKey, monthDates] of grouped.entries()) {
    const events: TimelineEvent[] = [];
    for (const date of monthDates) {
      events.push(...(state.facts[date]?.events || []));
    }
    output[monthKey] = buildRangeAggregate({
      key: monthKey,
      label: monthKey,
      unit: "day",
      events,
      categoryMap,
      eventNodeMap,
      allDates: monthDates,
      locale,
    });
  }
  return output;
}

function buildRangeAggregate({
  key,
  label,
  unit,
  events,
  categoryMap,
  eventNodeMap: _eventNodeMap,
  allDates,
  locale,
}: TimelineRangeAggregateInput): TimelineRangeAggregate {
  const totalMinutes = events.reduce((sum, event) => sum + durationMinutes(event.startAt, event.endAt), 0);
  const categoryBuckets = new Map<string, { categoryId: string; label: string; color: string; minutes: number }>();
  const subcategoryBuckets = new Map<string, { subcategoryId: string; categoryId: string; label: string; color: string; minutes: number }>();
  const subcategoryTrendBuckets = new Map<string, Map<string, { subcategoryId: string; minutes: number }>>();

  for (const date of allDates) {
    subcategoryTrendBuckets.set(date, new Map());
  }

  for (const event of events) {
    const minutes = durationMinutes(event.startAt, event.endAt);
    const category = categoryMap.get(event.categoryId);
    const subcategory = categoryMap.get(event.subcategoryId);
    const categoryId = event.categoryId;
    const dateKey = formatShanghaiDate(Date.parse(event.startAt));

    upsertBucket(categoryBuckets, categoryId, {
      categoryId,
      label: category?.label || categoryId,
      color: category?.color || buildCategoryThemeColor(categoryId),
      minutes: 0,
    }).minutes += minutes;

    if (event.subcategoryId) {
      upsertBucket(subcategoryBuckets, event.subcategoryId, {
        subcategoryId: event.subcategoryId,
        categoryId,
        label: subcategory?.label || event.subcategoryId,
        color: category?.color || buildCategoryThemeColor(categoryId),
        minutes: 0,
      }).minutes += minutes;
    }

    if (event.subcategoryId && subcategoryTrendBuckets.has(dateKey)) {
      const bucket = subcategoryTrendBuckets.get(dateKey)!;
      upsertBucket(bucket, event.subcategoryId, {
        subcategoryId: event.subcategoryId,
        minutes: 0,
      }).minutes += minutes;
    }
  }

  const categories = [...categoryBuckets.values()]
    .sort((left, right) => right.minutes - left.minutes)
    .map((bucket) => ({
      ...bucket,
      percent: totalMinutes > 0 ? Number((bucket.minutes / totalMinutes).toFixed(4)) : 0,
    }));

  const categoryDetails: Record<string, TimelineCategoryDetail> = {};
  for (const category of categories) {
    const relatedSubcategories = [...subcategoryBuckets.values()]
      .filter((subcategoryBucket) => subcategoryBucket.categoryId === category.categoryId)
      .sort((left, right) => right.minutes - left.minutes)
      .map((subcategoryBucket) => ({
        ...subcategoryBucket,
        percent: category.minutes > 0 ? Number((subcategoryBucket.minutes / category.minutes).toFixed(4)) : 0,
      }));
    const relatedEvents = buildEventBlocks(
      events.filter((event) => event.categoryId === category.categoryId),
      allDates.length > 1,
      categoryMap,
    );
    const trend = allDates.map((date) => {
      let minutes = 0;
      for (const event of events) {
        if (event.categoryId === category.categoryId && formatShanghaiDate(Date.parse(event.startAt)) === date) {
          minutes += durationMinutes(event.startAt, event.endAt);
        }
      }
      return { label: date.slice(5), key: date, minutes };
    });
    categoryDetails[category.categoryId] = {
      categoryId: category.categoryId,
      label: category.label,
      color: category.color,
      trend,
      subcategories: relatedSubcategories,
      events: relatedEvents,
    };
  }

  const subcategoryDetails: Record<string, TimelineSubcategoryDetail> = {};
  for (const subcategoryBucket of subcategoryBuckets.values()) {
    subcategoryDetails[subcategoryBucket.subcategoryId] = {
      subcategoryId: subcategoryBucket.subcategoryId,
      categoryId: subcategoryBucket.categoryId,
      label: subcategoryBucket.label,
      color: subcategoryBucket.color,
      trend: allDates.map((date) => ({
        key: date,
        label: date.slice(5),
        minutes: subcategoryTrendBuckets.get(date)?.get(subcategoryBucket.subcategoryId)?.minutes || 0,
      })),
      events: buildEventBlocks(
        events.filter((event) => event.subcategoryId === subcategoryBucket.subcategoryId),
        allDates.length > 1,
        categoryMap,
      ),
    };
  }

  return {
    key,
    label,
    unit,
    totalMinutes,
    categories,
    categoryDetails,
    subcategoryDetails,
  };
}

function buildDayAggregate(
  date: string,
  events: TimelineEvent[],
  categoryMap: Map<string, TimelineCategoryLookup>,
  eventNodeMap: Map<string, TimelineEventNode>,
  locale: TimelineLocale,
): TimelineRangeAggregate {
  const base = buildRangeAggregate({
    key: date,
    label: date,
    unit: "hour",
    events,
    categoryMap,
    eventNodeMap,
    allDates: [date],
    locale,
  });

  const categoryDetails: Record<string, TimelineCategoryDetail> = {};
  for (const category of base.categories) {
    const detail = base.categoryDetails[category.categoryId]!;
    categoryDetails[category.categoryId] = {
      ...detail,
      trend: buildHourlyDistribution(events.filter((event) => event.categoryId === category.categoryId)),
    };
  }

  const subcategoryDetails: Record<string, TimelineSubcategoryDetail> = {};
  for (const subcategoryId of Object.keys(base.subcategoryDetails || {})) {
    const detail = base.subcategoryDetails[subcategoryId]!;
    subcategoryDetails[subcategoryId] = {
      ...detail,
      trend: buildHourlyDistribution(events.filter((event) => event.subcategoryId === subcategoryId)),
    };
  }

  return {
    ...base,
    categoryDetails,
    subcategoryDetails,
  };
}

function buildCategoryMap(taxonomy: TimelineTaxonomy): Map<string, TimelineCategoryLookup> {
  const map = new Map<string, TimelineCategoryLookup>();
  for (const category of Array.isArray(taxonomy?.categories) ? taxonomy.categories : []) {
    map.set(category.id, {
      categoryId: category.id,
      label: category.label,
      color: buildCategoryThemeColor(category.id, category.color),
    });
    for (const child of Array.isArray(category.children) ? category.children : []) {
      map.set(child.id, {
        categoryId: category.id,
        label: child.label,
        color: buildCategoryThemeColor(category.id, category.color),
      });
    }
  }
  return map;
}

function buildEventNodeMap(taxonomy: TimelineTaxonomy): Map<string, TimelineEventNode> {
  const map = new Map<string, TimelineEventNode>();
  for (const node of Array.isArray(taxonomy?.eventNodes) ? taxonomy.eventNodes : []) {
    map.set(node.id, node);
  }
  return map;
}

function buildWeekRanges(dates: string[], locale: TimelineLocale): TimelineWeekRange[] {
  const grouped = new Map<string, string[]>();
  for (const date of dates) {
    const startDate = getWeekStart(date);
    if (!grouped.has(startDate)) {
      grouped.set(startDate, []);
    }
    grouped.get(startDate)!.push(date);
  }
  return [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([startDate, groupedDates]) => ({
      key: startDate,
      label: locale === "zh-CN"
        ? `${startDate} ${getTimelineText(locale, "weekOf")}`
        : `${getTimelineText(locale, "weekOf")} ${startDate}`,
      start: `${startDate}T00:00:00.000+08:00`,
      end: `${offsetDate(startDate, 7)}T00:00:00.000+08:00`,
      dates: fillWeekDates(startDate, groupedDates),
    }));
}

function fillWeekDates(startDate: string, existingDates: string[]): string[] {
  const existing = new Set(existingDates);
  const dates: string[] = [];
  for (let index = 0; index < 7; index += 1) {
    const date = offsetDate(startDate, index);
    dates.push(existing.has(date) ? date : date);
  }
  return dates;
}

function getWeekStart(date: string): string {
  const timestamp = Date.parse(`${date}T00:00:00+08:00`);
  const weekdayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  }).format(timestamp);
  const weekdayMap: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const offset = weekdayMap[weekdayLabel] ?? 0;
  return offsetDate(date, -offset);
}

function offsetDate(date: string, dayDelta: number): string {
  const timestamp = Date.parse(`${date}T00:00:00+08:00`);
  return formatShanghaiDate(timestamp + dayDelta * 24 * 60 * 60 * 1000);
}

function formatShanghaiDate(timestampMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestampMs);
}

function formatWeekday(date: string, locale: TimelineLocale): string {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  }).format(Date.parse(`${date}T00:00:00+08:00`));
}

function buildItemStyle(color: string): string {
  return `background:${color};border-color:${color};color:var(--text);`;
}

function durationMinutes(startAt: string, endAt: string): number {
  return Math.max(0, Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60_000));
}

function anchorEventToReferenceDay(startAt: string, endAt: string, anchorDate: string): { start: string; end: string } {
  const startClock = formatShanghaiClockTime(startAt);
  const endClock = formatShanghaiClockTime(endAt);
  let anchoredStart = `${anchorDate}T${startClock}:00+08:00`;
  let anchoredEnd = `${anchorDate}T${endClock}:00+08:00`;
  if (Date.parse(anchoredEnd) <= Date.parse(anchoredStart)) {
    anchoredEnd = `${offsetDate(anchorDate, 1)}T${endClock}:00+08:00`;
  }
  return {
    start: anchoredStart,
    end: anchoredEnd,
  };
}

function formatMinutes(minutes: number, locale: TimelineLocale): string {
  if (minutes < 60) {
    return locale === "zh-CN"
      ? `${minutes}${getTimelineText(locale, "minuteUnit")}`
      : `${minutes} ${getTimelineText(locale, "minuteUnit")}`;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (locale === "zh-CN") {
    return remaining
      ? `${hours}${getTimelineText(locale, "hourUnit")}${remaining}${getTimelineText(locale, "minuteUnit")}`
      : `${hours}${getTimelineText(locale, "hourUnit")}`;
  }
  return remaining
    ? `${hours} ${getTimelineText(locale, "hourUnit")} ${remaining} ${getTimelineText(locale, "minuteUnit")}`
    : `${hours} ${getTimelineText(locale, "hourUnit")}`;
}

function formatCompactDuration(minutes: number): string {
  const safeMinutes = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(safeMinutes / 60);
  const remaining = safeMinutes % 60;
  if (hours <= 0) {
    return `${remaining}m`;
  }
  if (remaining <= 0) {
    return `${hours}h`;
  }
  return `${hours}h${remaining}m`;
}

function formatShanghaiClockTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(Date.parse(value));
}

function upsertBucket<T extends { minutes: number }>(map: Map<string, T>, key: string, createValue: T): T {
  if (!map.has(key)) {
    map.set(key, createValue);
  }
  return map.get(key)!;
}

function buildHourlyDistribution(events: TimelineEvent[]): TimelineTrendPoint[] {
  const buckets = Array.from({ length: 24 }, (_, index) => ({
    key: String(index),
    label: `${String(index).padStart(2, "0")}:00`,
    minutes: 0,
  }));
  for (const event of events) {
    const start = Date.parse(event.startAt);
    const end = Date.parse(event.endAt);
    for (let index = 0; index < 24; index += 1) {
      const hourStart = Date.parse(`${formatShanghaiDate(start)}T${String(index).padStart(2, "0")}:00:00+08:00`);
      const hourEnd = hourStart + 60 * 60 * 1000;
      const overlap = Math.max(0, Math.min(end, hourEnd) - Math.max(start, hourStart));
      buckets[index]!.minutes += Math.round(overlap / 60_000);
    }
  }
  return buckets;
}

function buildEventBlocks(
  events: TimelineEvent[],
  includeDate: boolean,
  categoryMap: Map<string, TimelineCategoryLookup>,
): TimelineEventBlock[] {
  return [...events]
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt))
    .map((event) => ({
      eventNodeId: event.id,
      label: event.title,
      dateLabel: includeDate ? formatShanghaiDate(Date.parse(event.startAt)).slice(5) : "",
      timeLabel: `${formatShanghaiClockTime(event.startAt)} - ${formatShanghaiClockTime(event.endAt)}`,
      compactDuration: formatCompactDuration(durationMinutes(event.startAt, event.endAt)),
      fullLabel: includeDate
        ? `${formatShanghaiDate(Date.parse(event.startAt)).slice(5)} ${formatShanghaiClockTime(event.startAt)} - ${formatShanghaiClockTime(event.endAt)} ${event.title}`
        : `${formatShanghaiClockTime(event.startAt)} - ${formatShanghaiClockTime(event.endAt)} ${event.title}`,
      note: event.note || "",
      status: event.eventNodeId ? "official" : "derived",
      categoryId: event.categoryId,
      subcategoryId: event.subcategoryId,
      subcategoryLabel: categoryMap.get(event.subcategoryId)?.label || event.subcategoryId,
      minutes: durationMinutes(event.startAt, event.endAt),
    }));
}

function buildCategoryThemeColor(categoryId: string, fallback = "var(--cat-life)"): string {
  return CATEGORY_THEME_COLORS[categoryId] || fallback;
}

export {
  buildTimelineViews,
};
