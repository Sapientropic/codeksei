import type { TimelineLocale, TimelineTaxonomy } from "../../contracts";

const TIMELINE_TEXT: Record<TimelineLocale, Record<string, string>> = {
  en: {
    blocksSuffix: "blocks",
    breakdown: "Breakdown",
    categories: "Categories",
    currentRange: "Current range",
    dateTimeNA: "N/A",
    day: "Day",
    daysCovered: "Days covered",
    daysSuffix: "days",
    demoData: "Demo Data",
    distribution: "Distribution",
    distributionAcrossRange: "Distribution across the selected range",
    events: "Events",
    hourUnit: "hr",
    lastUpdated: "Last updated",
    lifeTracking: "Life Tracking",
    minuteUnit: "min",
    month: "Month",
    noBreakdown: "No subcategory breakdown is available for this category yet.",
    noData: "No data",
    noDistribution: "No distribution data is available for this range yet.",
    noEventDetails: "No event details are available at this level yet.",
    noTimeline: "No timeline is available for this range yet. Generate data for the selected period first.",
    notSelected: "Not selected",
    personalTimeline: "Personal Timeline",
    selectCategoryFirst: "Select a category first",
    selectCategoryOrSubcategoryFirst: "Select a category or subcategory first",
    selectTimeRange: "Select a time range",
    startWithCategory: "Start by selecting a category above.",
    timeBlocks: "Time blocks",
    totalTime: "Total time",
    trend: "Trend",
    week: "Week",
    weekOf: "Week of",
  },
  "zh-CN": {
    blocksSuffix: "条",
    breakdown: "明细",
    categories: "分类数",
    currentRange: "当前范围",
    dateTimeNA: "暂无",
    day: "日",
    daysCovered: "覆盖天数",
    daysSuffix: "天",
    demoData: "示例数据",
    distribution: "分布",
    distributionAcrossRange: "当前范围内的分布情况",
    events: "事件",
    hourUnit: "小时",
    lastUpdated: "最近更新",
    lifeTracking: "生活追踪",
    minuteUnit: "分钟",
    month: "月",
    noBreakdown: "这个分类暂时还没有明细拆分。",
    noData: "暂无数据",
    noDistribution: "当前范围还没有分布数据。",
    noEventDetails: "当前层级下还没有事件明细。",
    noTimeline: "这个范围没有可渲染的时间轴，先生成当天数据。",
    notSelected: "未选择",
    personalTimeline: "生活轨迹",
    selectCategoryFirst: "先选一个类别",
    selectCategoryOrSubcategoryFirst: "先选一个类别或子类",
    selectTimeRange: "选择时间范围",
    startWithCategory: "先从上面的类别里选一个。",
    timeBlocks: "时间块",
    totalTime: "总时长",
    trend: "趋势",
    week: "周",
    weekOf: "当周",
  },
};

const TIMELINE_TAXONOMY_LABELS: Record<TimelineLocale, Record<string, string>> = {
  en: {
    care: "Care",
    "care.household": "Household Care",
    "care.other": "Other Care",
    "care.pet": "Pet Care",
    "care.self": "Self Care",
    entertainment: "Entertainment",
    "entertainment.game": "Games",
    "entertainment.music": "Music",
    "entertainment.other": "Other Entertainment",
    "entertainment.social_media": "Social Media",
    "entertainment.video": "Video",
    exercise: "Exercise",
    "exercise.other": "Other Exercise",
    "exercise.stretch": "Stretching",
    "exercise.walk": "Walks",
    "exercise.workout": "Workouts",
    health: "Health",
    "health.hospital": "Medical Visit",
    "health.medication": "Medication",
    "health.other": "Other Health",
    "health.pain": "Symptom Care",
    "health.rest": "Recovery",
    life: "Life",
    "life.chores": "Chores",
    "life.errand": "Errands",
    "life.hygiene": "Hygiene",
    "life.meal": "Meals",
    "life.other": "Other Life",
    "life.shopping": "Shopping",
    rest: "Rest",
    "rest.idle": "Idle Time",
    "rest.nap": "Nap",
    "rest.other": "Other Rest",
    "rest.sleep": "Sleep",
    social: "Social",
    "social.call": "Calls",
    "social.chat": "Chat",
    "social.family": "Family Time",
    "social.other": "Other Social",
    study: "Study",
    "study.course": "Courses",
    "study.other": "Other Study",
    "study.practice": "Practice",
    "study.reading": "Reading",
    "study.review": "Review",
    travel: "Travel",
    "travel.commute": "Commute",
    "travel.other": "Other Travel",
    "travel.transit": "Transit",
    work: "Work",
    "work.coding": "Coding",
    "work.communication": "Communication",
    "work.meeting": "Meetings",
    "work.other": "Other Work",
    "work.writing": "Writing",
  },
  "zh-CN": {},
};

function resolveTimelineLocale(rawValue: unknown): TimelineLocale {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!normalized) {
    return "zh-CN";
  }
  if (normalized === "zh" || normalized === "zh-cn" || normalized.startsWith("zh-")) {
    return "zh-CN";
  }
  return "en";
}

function getTimelineText(locale: unknown, key: string): string {
  const resolvedLocale = resolveTimelineLocale(locale);
  return TIMELINE_TEXT[resolvedLocale]?.[key]
    || TIMELINE_TEXT["zh-CN"][key]
    || key;
}

function localizeTimelineTaxonomy(taxonomy: TimelineTaxonomy, locale: unknown): TimelineTaxonomy {
  const resolvedLocale = resolveTimelineLocale(locale);
  const labels = TIMELINE_TAXONOMY_LABELS[resolvedLocale] || {};
  return {
    categories: Array.isArray(taxonomy?.categories)
      ? taxonomy.categories.map((category) => ({
        ...category,
        label: labels[category.id] || category.label,
        children: Array.isArray(category.children)
          ? category.children.map((child) => ({
            ...child,
            label: labels[child.id] || child.label,
          }))
          : [],
      }))
      : [],
    eventNodes: Array.isArray(taxonomy?.eventNodes)
      ? taxonomy.eventNodes.map((node) => ({
        ...node,
        aliases: Array.isArray(node.aliases) ? [...node.aliases] : [],
      }))
      : [],
  };
}

function resolveTimelineIntlLocale(locale: unknown): string {
  return resolveTimelineLocale(locale) === "zh-CN" ? "zh-CN" : "en-US";
}

export {
  getTimelineText,
  localizeTimelineTaxonomy,
  resolveTimelineIntlLocale,
  resolveTimelineLocale,
};
