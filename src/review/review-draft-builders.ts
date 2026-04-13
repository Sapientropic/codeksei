import type {
  DiaryReviewEntry,
  NightlyReviewEntry,
  ReviewDatedLines,
  ReviewDraft,
  ReviewKind,
  ReviewProfile,
  ReviewSemanticPatch,
  ReviewWindow,
} from "./review-types";
import {
  dedupeStatements,
  looksLikeCarryForward,
  selectFrictionFromDiary,
  selectPeriodicCloseout,
  selectPeriodicFriction,
  selectPeriodicProgress,
  selectPeriodicSupplementGroups,
  selectProgressFromDiary,
  selectSignalFromSupplements,
} from "./review-draft-heuristics";
import {
  renderBulletList,
  renderDatedGroups,
  renderSupplementGroups,
} from "./review-draft-render";

export function buildReviewDraftInternal(
  profile: ReviewProfile,
  window: ReviewWindow,
  diaryEntries: DiaryReviewEntry[],
  nightlyEntries: NightlyReviewEntry[] = [],
): ReviewDraft {
  if (profile.kind === "nightly") {
    return buildNightlyDraft(profile, window, diaryEntries);
  }
  return buildPeriodicReviewDraft(profile, window, diaryEntries, nightlyEntries);
}

export function mergeReviewDraftInternal(
  kind: ReviewKind,
  deterministicDraft: ReviewDraft,
  semanticData: ReviewSemanticPatch | null | undefined,
): ReviewDraft {
  if (!semanticData || typeof semanticData !== "object") {
    return deterministicDraft;
  }

  const mergedInsights = {
    ...deterministicDraft.insights,
  };
  const semanticEntries = Object.entries(semanticData) as Array<
    [keyof ReviewSemanticPatch, ReviewSemanticPatch[keyof ReviewSemanticPatch]]
  >;
  for (const [key, value] of semanticEntries) {
    if (Array.isArray(value) && value.length) {
      (mergedInsights as Record<string, unknown>)[key] = value;
    }
  }

  const mergedDraft: ReviewDraft = {
    ...deterministicDraft,
    insights: mergedInsights,
    content: {
      ...deterministicDraft.content,
    },
  };

  if (kind === "nightly") {
    mergedDraft.content.progress = renderBulletList(mergedInsights.progress, "今天还没有收出可用的推进摘要。");
    mergedDraft.content.friction = renderBulletList(mergedInsights.friction, "今天还没有明显的摩擦摘要。");
    mergedDraft.content["open-loops"] = renderBulletList(mergedInsights.openLoops, "今晚没有明显还开着的线头。");
    mergedDraft.content["carry-forward"] = renderBulletList(mergedInsights.carryForward, "明天先从最小动作重新接上。");
    mergedDraft.content.closeout = renderBulletList(mergedInsights.closeout || [], "今天的睡前收口还没有写出来。");
    mergedDraft.content.signals = renderBulletList(mergedInsights.signals || [], "今天还没有稳定到值得带走的信号。");
    return mergedDraft;
  }

  mergedDraft.content.progress = renderBulletList(mergedInsights.progress, "这段时间还没有收出可用的推进摘要。");
  mergedDraft.content.friction = renderBulletList(mergedInsights.friction, "这段时间还没有明显的摩擦摘要。");
  mergedDraft.content["open-loops"] = renderBulletList(mergedInsights.openLoops, "这一周期末尾没有明显还开着的线头。");
  mergedDraft.content["carry-forward"] = renderBulletList(mergedInsights.carryForward, "下一次先从最小动作重新接上。");
  mergedDraft.content["daily-summaries"] = renderDatedGroups(mergedInsights.dailySummaries || [], "这段时间没有可引用的每日总结。");
  mergedDraft.content.supplements = renderSupplementGroups(mergedInsights.supplements || [], "这段时间没有值得回看的补充记录。");
  return mergedDraft;
}

function buildNightlyDraft(
  profile: ReviewProfile,
  window: ReviewWindow,
  diaryEntries: DiaryReviewEntry[],
): ReviewDraft {
  const entry = diaryEntries[0] || null;
  const openTodos = entry ? entry.todo.open.length : 0;
  const doneTodos = entry ? entry.todo.done.length : 0;
  const timelineCount = entry ? entry.timeline.length : 0;
  const supplementCount = entry ? entry.supplement.length : 0;

  const progress = dedupeStatements(selectProgressFromDiary(entry)).slice(0, 6);
  const friction = dedupeStatements(selectFrictionFromDiary(entry)).slice(0, 6);
  const openLoops = dedupeStatements(entry ? entry.todo.open : []).slice(0, 8);
  const carryForward = dedupeStatements([
    ...(entry ? entry.summary.filter(looksLikeCarryForward) : []),
    ...openLoops,
  ]).slice(0, 5);
  const closeout = dedupeStatements(
    entry && entry.summary.length ? entry.summary : progress,
  ).slice(0, 6);
  const signals = dedupeStatements([
    ...(entry ? entry.fragment : []),
    ...selectSignalFromSupplements(entry ? entry.supplement : []),
    ...carryForward,
  ]).slice(0, 6);
  const windowFacts = [
    `日期：${window.startDate}`,
    `覆盖日记：${diaryEntries.length} 天`,
    `Todo 完成 / 未完成：${doneTodos} / ${openTodos}`,
    `时间线事实条数：${timelineCount}`,
    `补充记录条数：${supplementCount}`,
  ];

  return {
    periodLabel: window.label,
    periodTitle: `${window.label} ${profile.titleSuffix}`,
    sourceDiaryDays: diaryEntries.length,
    sourceNightlyDays: 0,
    windowFacts,
    insights: {
      progress,
      friction,
      openLoops,
      carryForward,
      closeout,
      signals,
    },
    content: {
      window: renderBulletList(windowFacts, "今天还没有可用的日记事实。"),
      progress: renderBulletList(progress, "今天还没有收出可用的推进摘要。"),
      friction: renderBulletList(friction, "今天还没有明显的摩擦摘要。"),
      "open-loops": renderBulletList(openLoops, "今晚没有明显还开着的线头。"),
      "carry-forward": renderBulletList(carryForward, "明天先从最小动作重新接上。"),
      closeout: renderBulletList(closeout, "今天的睡前收口还没有写出来。"),
      signals: renderBulletList(signals, "今天还没有稳定到值得带走的信号。"),
    },
  };
}

function buildPeriodicReviewDraft(
  profile: ReviewProfile,
  window: ReviewWindow,
  diaryEntries: DiaryReviewEntry[],
  nightlyEntries: NightlyReviewEntry[] = [],
): ReviewDraft {
  const latestEntry = diaryEntries[diaryEntries.length - 1] || null;
  const nightlyByDate = new Map(nightlyEntries.map((entry) => [entry.date, entry]));
  const totalOpenTodos = diaryEntries.reduce((sum, entry) => sum + entry.todo.open.length, 0);
  const totalDoneTodos = diaryEntries.reduce((sum, entry) => sum + entry.todo.done.length, 0);
  const totalTimelineFacts = diaryEntries.reduce((sum, entry) => sum + entry.timeline.length, 0);

  const progress = dedupeStatements(
    diaryEntries.flatMap((entry) => selectPeriodicProgress(entry, nightlyByDate.get(entry.date))),
  ).slice(0, 8);

  const friction = dedupeStatements(
    diaryEntries.flatMap((entry) => selectPeriodicFriction(entry, nightlyByDate.get(entry.date))),
  ).slice(0, 8);

  const latestNightly = latestEntry ? nightlyByDate.get(latestEntry.date) || null : null;
  const openLoops = dedupeStatements(
    latestNightly?.openLoops?.length
      ? latestNightly.openLoops
      : (latestEntry ? latestEntry.todo.open : []),
  ).slice(0, 8);

  const carryForward = dedupeStatements([
    ...(latestNightly?.carryForward || []),
    ...(latestEntry ? latestEntry.summary.filter(looksLikeCarryForward) : []),
    ...openLoops,
  ]).slice(0, 5);

  const dailySummaries = diaryEntries
    .map((entry): ReviewDatedLines => ({
      date: entry.date,
      lines: dedupeStatements(
        selectPeriodicCloseout(entry, nightlyByDate.get(entry.date)),
      ).slice(0, 6),
    }))
    .filter((entry) => entry.lines.length);

  const supplements = diaryEntries
    .flatMap((entry) => selectPeriodicSupplementGroups(entry, nightlyByDate.get(entry.date)))
    .slice(-8);
  const windowFacts = [
    `时间范围：${window.startDate} ~ ${window.endDate}`,
    `覆盖日记：${diaryEntries.length} 天`,
    `夜间收口：${nightlyEntries.length} 天`,
    `Todo 完成 / 未完成：${totalDoneTodos} / ${totalOpenTodos}`,
    `时间线事实条数：${totalTimelineFacts}`,
    `周期末尾仍开着的线头：${openLoops.length}`,
  ];

  return {
    periodLabel: window.label,
    periodTitle: `${window.label} ${profile.titleSuffix}`,
    sourceDiaryDays: diaryEntries.length,
    sourceNightlyDays: nightlyEntries.length,
    windowFacts,
    insights: {
      progress,
      friction,
      openLoops,
      carryForward,
      dailySummaries,
      supplements,
    },
    content: {
      window: renderBulletList(windowFacts, "这一段时间还没有可用日记事实。"),
      progress: renderBulletList(progress, "这段时间还没有收出可用的推进摘要。"),
      friction: renderBulletList(friction, "这段时间还没有明显的摩擦摘要。"),
      "open-loops": renderBulletList(openLoops, "这一周期末尾没有明显还开着的线头。"),
      "carry-forward": renderBulletList(carryForward, "下一次先从最小动作重新接上。"),
      "daily-summaries": renderDatedGroups(dailySummaries, "这段时间没有可引用的每日总结。"),
      supplements: renderSupplementGroups(supplements, "这段时间没有值得回看的补充记录。"),
    },
  };
}
