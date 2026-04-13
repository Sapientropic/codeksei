// @ts-check

import type {
  DiaryReviewEntry,
  NightlyReviewEntry,
  ReviewDraft,
  ReviewKind,
  ReviewProfile,
  ReviewSemanticPatch,
  ReviewWindow,
} from "./review-types";
import {
  buildReviewDraftInternal,
  mergeReviewDraftInternal,
} from "./review-draft-builders";
import { resolveReviewWindow as resolveReviewWindowInternal } from "./review-draft-window";

function buildReviewDraft(
  profile: ReviewProfile,
  window: ReviewWindow,
  diaryEntries: DiaryReviewEntry[],
  nightlyEntries: NightlyReviewEntry[] = [],
): ReviewDraft {
  return buildReviewDraftInternal(profile, window, diaryEntries, nightlyEntries);
}

function mergeReviewDraft(
  kind: ReviewKind,
  deterministicDraft: ReviewDraft,
  semanticData: ReviewSemanticPatch | null | undefined,
): ReviewDraft {
  return mergeReviewDraftInternal(kind, deterministicDraft, semanticData);
}

function resolveReviewWindow(kind: ReviewKind, options: { week?: unknown; month?: unknown; date?: unknown; timezone?: unknown } = {}): ReviewWindow {
  return resolveReviewWindowInternal(kind, options);
}

export {
  buildReviewDraft,
  mergeReviewDraft,
  resolveReviewWindow,
};
