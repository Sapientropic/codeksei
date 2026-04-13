export type TimelineStatus = "draft" | "final";
export type TimelineNodeStatus = "official" | "provisional";
export type TimelineRangeKey = "day" | "week" | "month";
export type TimelineLocale = "zh-CN" | "en";

export interface TimelineSubcategory {
  id: string;
  label: string;
}

export interface TimelineCategory {
  id: string;
  label: string;
  color: string;
  children: TimelineSubcategory[];
}

export interface TimelineEventNode {
  id: string;
  label: string;
  aliases: string[];
  parentId: string;
  status: TimelineNodeStatus;
}

export interface TimelineSource {
  threadId: string;
  workspaceRoot: string;
  transcriptMessageCount: number;
}

export interface TimelineEvent {
  id: string;
  startAt: string;
  endAt: string;
  title: string;
  note: string;
  categoryId: string;
  subcategoryId: string;
  eventNodeId: string;
  tags: string[];
  confidence: number;
  sourceMessageIds: string[];
}

export interface TimelineDay {
  status: TimelineStatus;
  updatedAt: string;
  source: TimelineSource | null;
  events: TimelineEvent[];
}

export interface TimelineProposal {
  id: string;
  date: string;
  proposedNodeId: string;
  label: string;
  parentId: string;
  sourceMessageIds: string[];
  createdAt: string;
}

export interface TimelineTaxonomy {
  categories: TimelineCategory[];
  eventNodes: TimelineEventNode[];
}

export interface TimelineState {
  version: number;
  timezone: string;
  taxonomy: TimelineTaxonomy;
  facts: Record<string, TimelineDay>;
  proposals: TimelineProposal[];
}

export interface TimelineEventInput extends Partial<TimelineEvent> {
  remark?: string;
}

export interface TimelineEventNodeInput extends Partial<TimelineEventNode> {}

export interface TimelineSourceInput extends Partial<TimelineSource> {}

export interface TimelineReplaceDayInput {
  date: string;
  status?: TimelineStatus;
  source?: TimelineSourceInput | null;
  events?: TimelineEventInput[];
  newEventNodes?: TimelineEventNodeInput[];
}

export interface TimelineMergeDayInput extends TimelineReplaceDayInput {
  dropEventIds?: string[];
}

export interface TimelineStorePaths {
  stateFilePath?: string;
  taxonomyFilePath: string;
  factsFilePath: string;
  legacyFilePath?: string;
}

export interface TimelineCategorySummaryNode {
  id: string;
  label: string;
  aliases: string[];
  status: TimelineNodeStatus;
}

export interface TimelineCategorySummaryChild {
  id: string;
  label: string;
  eventNodes: TimelineCategorySummaryNode[];
}

export interface TimelineCategorySummary {
  id: string;
  label: string;
  children: TimelineCategorySummaryChild[];
}

export interface TimelineCategoriesResult {
  categoryCount: number;
  categories: TimelineCategorySummary[];
}

export interface TimelineProposalsResult {
  date: string;
  proposalCount: number;
  proposals: TimelineProposal[];
}

export interface TimelineReadDayResult {
  date: string;
  exists: boolean;
  status: "missing" | TimelineStatus;
  updatedAt: string;
  eventCount: number;
  events: TimelineEvent[];
}

export interface TimelineTooltip {
  title: string;
  note: string;
  color: string;
  durationText: string;
  timeText: string;
  dateText?: string;
}

export interface TimelineViewGroup {
  id: string;
  content: string;
}

export interface TimelineViewItem {
  id: string;
  start: string;
  end: string;
  content: string;
  style: string;
  tooltip: TimelineTooltip;
  className: string;
  group?: string;
}

export interface TimelineView {
  date?: string;
  key?: string;
  label?: string;
  start: string;
  end: string;
  groups: TimelineViewGroup[];
  items: TimelineViewItem[];
}

export interface TimelineTrendPoint {
  key: string;
  label: string;
  minutes: number;
}

export interface TimelineCategoryBucket {
  categoryId: string;
  label: string;
  color: string;
  minutes: number;
  percent: number;
}

export interface TimelineSubcategoryBucket {
  subcategoryId: string;
  categoryId: string;
  label: string;
  color: string;
  minutes: number;
  percent: number;
}

export interface TimelineEventBlock {
  eventNodeId: string;
  label: string;
  dateLabel: string;
  timeLabel: string;
  compactDuration: string;
  fullLabel: string;
  note: string;
  status: "official" | "derived";
  categoryId: string;
  subcategoryId: string;
  subcategoryLabel: string;
  minutes: number;
}

export interface TimelineCategoryDetail {
  categoryId: string;
  label: string;
  color: string;
  trend: TimelineTrendPoint[];
  subcategories: TimelineSubcategoryBucket[];
  events: TimelineEventBlock[];
}

export interface TimelineSubcategoryDetail {
  subcategoryId: string;
  categoryId: string;
  label: string;
  color: string;
  trend: TimelineTrendPoint[];
  events: TimelineEventBlock[];
}

export interface TimelineRangeAggregate {
  key: string;
  label: string;
  unit: "day" | "hour";
  totalMinutes: number;
  categories: TimelineCategoryBucket[];
  categoryDetails: Record<string, TimelineCategoryDetail>;
  subcategoryDetails: Record<string, TimelineSubcategoryDetail>;
}

export interface TimelineDashboardMeta {
  generatedAt: string;
  updatedAt: string;
  taxonomyUpdatedAt: string;
  factsUpdatedAt: string;
  isDemoData: boolean;
  timezone: string;
  locale: TimelineLocale;
  availableDates: string[];
  latestDate: string;
}

export interface TimelineDashboardData {
  meta: TimelineDashboardMeta;
  taxonomy: TimelineTaxonomy;
  timelines: {
    day: Record<string, TimelineView>;
    week: Record<string, TimelineView>;
  };
  ranges: {
    day: Record<string, TimelineRangeAggregate>;
    week: Record<string, TimelineRangeAggregate>;
    month: Record<string, TimelineRangeAggregate>;
  };
}

export interface TimelineDashboardMetaOverrides {
  updatedAt?: string;
  taxonomyUpdatedAt?: string;
  factsUpdatedAt?: string;
  isDemoData?: boolean;
  locale?: TimelineLocale;
}

export interface TimelineScreenshotOptions {
  outputFile: string;
  selector: string;
  range: TimelineRangeKey | "";
  rangeValue: string;
  date: string;
  week: string;
  month: string;
  category: string;
  subcategory: string;
  detail?: string;
  width: number;
  height: number;
  sidePadding: number;
}

export interface TimelineScreenshotSelectionOptions {
  range?: string;
  date?: string;
  week?: string;
  month?: string;
  category?: string;
  subcategory?: string;
  detail?: string;
}
