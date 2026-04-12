export type ReviewKind = "nightly" | "weekly" | "monthly";

export interface ReviewWindow {
  label: string;
  startDate: string;
  endDate: string;
  timezone: string;
}

export interface ReviewProfile {
  kind: ReviewKind;
  titleSuffix: string;
  workspaceRoot?: string;
  folderPath?: string;
  intro?: string;
  cadenceLabel?: string;
  carryLabel?: string;
  tags?: string[];
  sections?: unknown[];
}

export interface DiaryReviewTodo {
  open: string[];
  done: string[];
}

export interface DiarySupplementEntry {
  time: string;
  title: string;
  body: string;
}

export interface DiaryReviewEntry {
  date: string;
  filePath?: string;
  todo: DiaryReviewTodo;
  timeline: string[];
  fragment: string[];
  supplement: DiarySupplementEntry[];
  summary: string[];
}

export interface NightlyReviewEntry {
  date: string;
  filePath?: string;
  progress: string[];
  friction: string[];
  openLoops: string[];
  carryForward: string[];
  closeout: string[];
  signals: string[];
}

export interface ReviewDatedLines {
  date: string;
  lines: string[];
}

export interface ReviewSupplementGroup {
  date: string;
  title: string;
  body: string;
}

export interface ReviewDraftInsights {
  progress: string[];
  friction: string[];
  openLoops: string[];
  carryForward: string[];
  closeout?: string[];
  signals?: string[];
  dailySummaries?: ReviewDatedLines[];
  supplements?: ReviewSupplementGroup[];
}

export interface ReviewDraftContent {
  window: string;
  progress: string;
  friction: string;
  "open-loops": string;
  "carry-forward": string;
  closeout?: string;
  signals?: string;
  "daily-summaries"?: string;
  supplements?: string;
}

export interface ReviewDraft {
  periodLabel: string;
  periodTitle: string;
  sourceDiaryDays: number;
  sourceNightlyDays: number;
  windowFacts: string[];
  insights: ReviewDraftInsights;
  content: ReviewDraftContent;
}

export type ReviewSemanticPatch = Partial<ReviewDraftInsights>;
