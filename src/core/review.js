const fs = require("fs");
const path = require("path");
const { maybeGenerateSemanticReview } = require("./review-semantic");
const {
  PRIMARY_REVIEW_MARKER_PREFIX,
  LEGACY_REVIEW_MARKER_PREFIX,
} = require("./branding");

const REVIEW_MARKER_PREFIX = PRIMARY_REVIEW_MARKER_PREFIX;
const REVIEW_MARKER_PREFIXES = [PRIMARY_REVIEW_MARKER_PREFIX, LEGACY_REVIEW_MARKER_PREFIX];

const DEFAULT_REVIEW_MODELS = {
  nightly: {
    cadenceLabel: "夜",
    titleSuffix: "睡前收口",
    carryLabel: "明天第一步",
    intro: "这是一份 Codeksei 睡前收口，不是学习项目模板。它只收今天真实推进了什么、现在还挂着什么、明天从哪里更容易接上，好把周/月复盘的原料先压成一层低摩擦摘要。",
    tags: ["codeksei", "cyberboss", "life-assistant", "review", "nightly"],
  },
  weekly: {
    cadenceLabel: "周",
    titleSuffix: "周复盘",
    carryLabel: "下周第一步",
    intro: "这是一份 Codeksei 生活助理周复盘，不是学习项目模板。它只关心这周真实推进了什么、摩擦在哪里、线头还挂着什么，以及下周如何更容易重新接上。",
    tags: ["codeksei", "cyberboss", "life-assistant", "review", "weekly"],
  },
  monthly: {
    cadenceLabel: "月",
    titleSuffix: "月复盘",
    carryLabel: "下月第一步",
    intro: "这是一份 Codeksei 生活助理月复盘，不是学习项目模板。它优先收口这个月真实推进的线、反复出现的摩擦、仍未解决的线头，以及下个月应该从哪里接上。",
    tags: ["codeksei", "cyberboss", "life-assistant", "review", "monthly"],
  },
};

function loadReviewSchemaConfig(config = {}) {
  const filePath = normalizeText(config.reviewSchemaConfigFile);
  if (!filePath) {
    return {};
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw new Error(`review schema 不是合法 JSON: ${filePath} (${formatErrorMessage(error)})`);
  }
}

function resolveReviewProfile(config = {}, kind, options = {}) {
  const normalizedKind = normalizeReviewKind(kind);
  const defaults = DEFAULT_REVIEW_MODELS[normalizedKind];
  const required = options.required !== false;
  const workspaceRoot = normalizeDisplayPath(path.resolve(String(config.workspaceRoot || process.cwd())));
  const schemaConfig = loadReviewSchemaConfig(config);
  const workspaceProfile = selectWorkspaceProfile(schemaConfig.workspaces, workspaceRoot);
  const reviews = workspaceProfile?.reviews && typeof workspaceProfile.reviews === "object"
    ? workspaceProfile.reviews
    : {};
  const rawProfile = reviews[normalizedKind];

  if ((!rawProfile || typeof rawProfile !== "object") && !required) {
    return null;
  }
  if (!rawProfile || typeof rawProfile !== "object") {
    throw new Error(`当前 workspace 没有 ${normalizedKind} review 配置: ${workspaceRoot}`);
  }

  const folder = normalizeRelativeOrAbsolutePath(rawProfile.folder);
  if (!folder) {
    throw new Error(`${normalizedKind} review 缺少 folder 配置`);
  }

  const carryLabel = normalizeText(rawProfile.carryLabel) || defaults.carryLabel;
  return {
    kind: normalizedKind,
    workspaceRoot,
    folderPath: resolveWorkspacePath(workspaceRoot, folder),
    intro: normalizeText(rawProfile.intro) || defaults.intro,
    cadenceLabel: normalizeText(rawProfile.cadenceLabel) || defaults.cadenceLabel,
    titleSuffix: normalizeText(rawProfile.titleSuffix) || defaults.titleSuffix,
    carryLabel,
    tags: normalizeTags(rawProfile.tags, defaults.tags),
    sections: buildReviewSections(normalizedKind, carryLabel),
  };
}

async function buildReview(config = {}, kind, options = {}) {
  const profile = resolveReviewProfile(config, kind);
  const window = resolveReviewWindow(profile.kind, options);
  const diaryEntries = collectDiaryEntries(config.diaryDir, window.startDate, window.endDate);
  const nightlyEntries = profile.kind === "nightly"
    ? []
    : collectNightlyEntries(config, window);
  const deterministicDraft = buildReviewDraft(profile, window, diaryEntries, nightlyEntries);
  // Review v2 keeps routing, windowing, and managed-block writes deterministic.
  // The semantic pass may upgrade the human-facing bullets, but it must never
  // become a hard dependency for file generation.
  const semantic = await maybeGenerateSemanticReview(config, {
    profile,
    window,
    diaryEntries,
    nightlyEntries,
    deterministicDraft,
    options,
  });
  const draft = mergeReviewDraft(profile.kind, deterministicDraft, semantic.data);
  const notePath = normalizeDisplayPath(path.join(profile.folderPath, `${draft.periodLabel}.md`));
  return {
    profile,
    window,
    diaryEntries,
    nightlyEntries,
    semantic,
    draft,
    notePath,
  };
}

async function writeReview(config = {}, kind, options = {}) {
  const review = await buildReview(config, kind, options);
  fs.mkdirSync(path.dirname(review.notePath), { recursive: true });
  const now = new Date();
  const current = fs.existsSync(review.notePath)
    ? normalizeLineEnding(fs.readFileSync(review.notePath, "utf8"))
    : buildReviewFileSkeleton(review, now);
  const next = syncReviewContent(current, review, now);
  const changed = ensureTrailingNewline(current) !== ensureTrailingNewline(next);
  if (changed) {
    fs.writeFileSync(review.notePath, ensureTrailingNewline(next), "utf8");
  }
  return {
    changed,
    filePath: review.notePath,
    periodLabel: review.draft.periodLabel,
    diaryCount: review.diaryEntries.length,
    nightlyCount: review.nightlyEntries.length,
    semanticUsed: !!review.semantic?.used,
    semanticReason: review.semantic?.reason || "",
  };
}

function buildReviewFileSkeleton(review, now = new Date()) {
  const createdAt = formatDateTime(now);
  const updated = formatDate(now);
  const frontmatter = [
    "---",
    `created: ${createdAt}`,
    `updated: ${updated}`,
    "type: review",
    `review_period: ${review.profile.kind}`,
    `period_label: ${review.draft.periodLabel}`,
    `period_start: ${review.window.startDate}`,
    `period_end: ${review.window.endDate}`,
    `source_diary_days: ${review.draft.sourceDiaryDays}`,
  ];

  if (review.profile.kind !== "nightly") {
    frontmatter.push(`source_nightly_days: ${review.draft.sourceNightlyDays}`);
  }

  frontmatter.push(
    "status: working",
    "tags:",
    ...review.profile.tags.map((tag) => `  - ${tag}`),
    "---",
    `# ${review.draft.periodTitle}`,
    "",
    `> ${review.profile.intro} `,
    ""
  );

  for (const section of review.profile.sections) {
    frontmatter.push(section.heading);
    if (section.slot) {
      frontmatter.push(buildManagedBlock(section.slot, ""));
    } else {
      frontmatter.push(section.staticBody || "");
    }
    frontmatter.push("");
  }

  return frontmatter.join("\n");
}

function syncReviewContent(content, review, now = new Date()) {
  let next = ensureReviewSections(normalizeLineEnding(content), review);
  next = updateFrontmatterValue(next, "updated", formatDate(now));
  next = updateFrontmatterValue(next, "period_label", review.draft.periodLabel);
  next = updateFrontmatterValue(next, "period_start", review.window.startDate);
  next = updateFrontmatterValue(next, "period_end", review.window.endDate);
  next = updateFrontmatterValue(next, "source_diary_days", String(review.diaryEntries.length));
  if (review.profile.kind !== "nightly") {
    next = updateFrontmatterValue(next, "source_nightly_days", String(review.nightlyEntries.length));
  }

  next = replaceHeading(next, 1, review.draft.periodTitle);
  for (const [slot, body] of Object.entries(review.draft.content)) {
    next = upsertManagedBlock(next, slot, body);
  }
  return ensureTrailingNewline(next);
}

function ensureReviewSections(content, review) {
  let next = content;
  for (const section of review.profile.sections) {
    const headingPattern = new RegExp(`^${escapeRegExp(section.heading)}\\s*$`, "m");
    const hasHeading = headingPattern.test(next);
    const hasBlock = !section.slot || hasManagedBlock(next, section.slot);
    if (hasHeading && hasBlock) {
      continue;
    }

    const sectionBody = section.slot
      ? buildManagedBlock(section.slot, "")
      : (section.staticBody || "");

    if (!hasHeading) {
      next = `${next.replace(/\s*$/u, "")}\n\n${section.heading}\n${sectionBody}\n`;
      continue;
    }

    if (section.slot && !hasBlock) {
      next = next.replace(
        headingPattern,
        `${section.heading}\n${buildManagedBlock(section.slot, "")}`
      );
    }
  }
  return next;
}

function buildReviewDraft(profile, window, diaryEntries, nightlyEntries = []) {
  if (profile.kind === "nightly") {
    return buildNightlyDraft(profile, window, diaryEntries);
  }
  return buildPeriodicReviewDraft(profile, window, diaryEntries, nightlyEntries);
}

function buildNightlyDraft(profile, window, diaryEntries) {
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
    entry && entry.summary.length ? entry.summary : progress
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

function buildPeriodicReviewDraft(profile, window, diaryEntries, nightlyEntries = []) {
  const latestEntry = diaryEntries[diaryEntries.length - 1] || null;
  const nightlyByDate = new Map(
    nightlyEntries.map((entry) => [entry.date, entry])
  );
  const totalOpenTodos = diaryEntries.reduce((sum, entry) => sum + entry.todo.open.length, 0);
  const totalDoneTodos = diaryEntries.reduce((sum, entry) => sum + entry.todo.done.length, 0);
  const totalTimelineFacts = diaryEntries.reduce((sum, entry) => sum + entry.timeline.length, 0);

  const progress = dedupeStatements(
    diaryEntries.flatMap((entry) => selectPeriodicProgress(entry, nightlyByDate.get(entry.date)))
  ).slice(0, 8);

  const friction = dedupeStatements(
    diaryEntries.flatMap((entry) => selectPeriodicFriction(entry, nightlyByDate.get(entry.date)))
  ).slice(0, 8);

  const latestNightly = latestEntry ? nightlyByDate.get(latestEntry.date) || null : null;
  const openLoops = dedupeStatements(
    latestNightly?.openLoops?.length
      ? latestNightly.openLoops
      : (latestEntry ? latestEntry.todo.open : [])
  ).slice(0, 8);

  const carryForward = dedupeStatements([
    ...(latestNightly?.carryForward || []),
    ...(latestEntry ? latestEntry.summary.filter(looksLikeCarryForward) : []),
    ...openLoops,
  ]).slice(0, 5);

  const dailySummaries = diaryEntries
    .map((entry) => ({
      date: entry.date,
      lines: dedupeStatements(
        selectPeriodicCloseout(entry, nightlyByDate.get(entry.date))
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

function mergeReviewDraft(kind, deterministicDraft, semanticData) {
  if (!semanticData || typeof semanticData !== "object") {
    return deterministicDraft;
  }

  const mergedInsights = {
    ...deterministicDraft.insights,
  };
  for (const [key, value] of Object.entries(semanticData)) {
    if (Array.isArray(value) && value.length) {
      mergedInsights[key] = value;
    }
  }

  const mergedDraft = {
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
    mergedDraft.content.closeout = renderBulletList(mergedInsights.closeout, "今天的睡前收口还没有写出来。");
    mergedDraft.content.signals = renderBulletList(mergedInsights.signals, "今天还没有稳定到值得带走的信号。");
    return mergedDraft;
  }

  mergedDraft.content.progress = renderBulletList(mergedInsights.progress, "这段时间还没有收出可用的推进摘要。");
  mergedDraft.content.friction = renderBulletList(mergedInsights.friction, "这段时间还没有明显的摩擦摘要。");
  mergedDraft.content["open-loops"] = renderBulletList(mergedInsights.openLoops, "这一周期末尾没有明显还开着的线头。");
  mergedDraft.content["carry-forward"] = renderBulletList(mergedInsights.carryForward, "下一次先从最小动作重新接上。");
  mergedDraft.content["daily-summaries"] = renderDatedGroups(mergedInsights.dailySummaries, "这段时间没有可引用的每日总结。");
  mergedDraft.content.supplements = renderSupplementGroups(mergedInsights.supplements, "这段时间没有值得回看的补充记录。");
  return mergedDraft;
}

function collectDiaryEntries(diaryDir, startDate, endDate) {
  const normalizedDiaryDir = normalizeText(diaryDir);
  if (!normalizedDiaryDir || !fs.existsSync(normalizedDiaryDir)) {
    return [];
  }
  return fs.readdirSync(normalizedDiaryDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(name))
    .map((name) => name.replace(/\.md$/u, ""))
    .filter((date) => date >= startDate && date <= endDate)
    .sort()
    .map((date) => parseDiaryFile(path.join(normalizedDiaryDir, `${date}.md`), date))
    .filter(Boolean);
}

function collectNightlyEntries(config, window) {
  const nightlyProfile = resolveReviewProfile(config, "nightly", { required: false });
  if (!nightlyProfile || !fs.existsSync(nightlyProfile.folderPath)) {
    return [];
  }
  return fs.readdirSync(nightlyProfile.folderPath)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/u.test(name))
    .map((name) => name.replace(/\.md$/u, ""))
    .filter((date) => date >= window.startDate && date <= window.endDate)
    .sort()
    .map((date) => parseNightlyReviewFile(path.join(nightlyProfile.folderPath, `${date}.md`), date))
    .filter(Boolean);
}

function parseDiaryFile(filePath, date) {
  const content = normalizeLineEnding(fs.readFileSync(filePath, "utf8"));
  return {
    date,
    filePath: normalizeDisplayPath(filePath),
    todo: parseTodoSection(readSectionBody(content, "Todo")),
    timeline: parseBulletSection(readSectionBody(content, "时间线事实")),
    fragment: parseBulletSection(readSectionBody(content, "今日碎片")),
    supplement: parseSupplementSection(readSectionBody(content, "补充记录")),
    summary: parseSummarySection(readSectionBody(content, "总结")),
  };
}

function parseNightlyReviewFile(filePath, date) {
  const content = normalizeLineEnding(fs.readFileSync(filePath, "utf8"));
  return {
    date,
    filePath: normalizeDisplayPath(filePath),
    progress: parseManagedBulletList(content, "progress"),
    friction: parseManagedBulletList(content, "friction"),
    openLoops: parseManagedBulletList(content, "open-loops"),
    carryForward: parseManagedBulletList(content, "carry-forward"),
    closeout: parseManagedBulletList(content, "closeout"),
    signals: parseManagedBulletList(content, "signals"),
  };
}

function readSectionBody(content, headingText) {
  const startPattern = new RegExp(`^##\\s+${escapeRegExp(headingText)}\\s*$`, "m");
  const startMatch = startPattern.exec(content);
  if (!startMatch) {
    return "";
  }
  const headingEnd = content.indexOf("\n", startMatch.index);
  const contentStart = headingEnd >= 0 ? headingEnd + 1 : content.length;
  const rest = content.slice(contentStart);
  const nextHeading = /^\##\s+/m.exec(rest);
  if (!nextHeading) {
    return rest.trim();
  }
  return rest.slice(0, nextHeading.index).trim();
}

function parseTodoSection(body) {
  const open = [];
  const done = [];
  for (const line of splitLines(body)) {
    const match = /^- \[( |x|X)\] (.*)$/u.exec(line);
    if (!match) {
      continue;
    }
    const text = normalizeLineItem(match[2]);
    if (!text) {
      continue;
    }
    if (match[1].toLowerCase() === "x") {
      done.push(text);
    } else {
      open.push(text);
    }
  }
  return { open, done };
}

function parseBulletSection(body) {
  return splitLines(body)
    .map((line) => {
      const match = /^-\s+(.*)$/u.exec(line);
      return normalizeLineItem(match ? match[1] : "");
    })
    .filter(Boolean);
}

function parseSummarySection(body) {
  return splitLines(body)
    .map((line) => {
      if (/^-\s+/u.test(line)) {
        return normalizeLineItem(line.replace(/^-\s+/u, ""));
      }
      return normalizeLineItem(line);
    })
    .filter((line) => line && !isReviewLeadIn(line));
}

function parseSupplementSection(body) {
  const normalized = normalizeLineEnding(body).trim();
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/\n(?=###\s)/u)
    .map((block) => {
      const lines = block.split("\n");
      const heading = normalizeLineItem(lines.shift());
      const match = /^###\s+(\d{2}:\d{2})(?:\s+(.*))?$/u.exec(heading);
      return {
        time: match?.[1] || "",
        title: normalizeLineItem(match?.[2] || ""),
        body: normalizeBody(lines.join("\n")),
      };
    })
    .filter((item) => item.title || item.body);
}

function selectProgressFromDiary(entry) {
  if (!entry) {
    return [];
  }
  const progressFromSummary = entry.summary.filter(
    (line) => !looksLikeCarryForward(line) && !hasFrictionSignal(line)
  );
  return progressFromSummary.length ? progressFromSummary : entry.timeline;
}

function selectFrictionFromDiary(entry) {
  if (!entry) {
    return [];
  }
  return [
    ...entry.fragment.filter(hasFrictionSignal),
    ...selectFrictionFromSupplements(entry.supplement),
    ...entry.summary.filter((line) => hasFrictionSignal(line)),
  ];
}

function selectPeriodicProgress(entry, nightlyEntry) {
  if (nightlyEntry?.progress?.length) {
    return nightlyEntry.progress;
  }
  return selectProgressFromDiary(entry);
}

function selectPeriodicFriction(entry, nightlyEntry) {
  if (nightlyEntry?.friction?.length) {
    return nightlyEntry.friction;
  }
  return selectFrictionFromDiary(entry);
}

function selectPeriodicCloseout(entry, nightlyEntry) {
  if (nightlyEntry?.closeout?.length) {
    return nightlyEntry.closeout;
  }
  if (entry?.summary?.length) {
    return entry.summary;
  }
  return selectProgressFromDiary(entry);
}

function selectPeriodicSupplementGroups(entry, nightlyEntry) {
  if (nightlyEntry?.signals?.length) {
    return [{
      date: entry.date,
      title: "夜间收口提炼",
      body: nightlyEntry.signals.map((line) => `- ${normalizeLineItem(line)}`).join("\n"),
    }];
  }
  return entry.supplement
    .map((item) => ({
      date: entry.date,
      title: item.title,
      body: toCompactSentence(item.body),
    }))
    .filter((item) => item.body);
}

function selectFrictionFromSupplements(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const seed = item.title || toCompactSentence(item.body);
      if (!hasFrictionSignal(seed) && !hasFrictionSignal(item.body)) {
        return "";
      }
      const body = toCompactSentence(item.body);
      if (item.title && body) {
        return `${item.title}：${body}`;
      }
      return item.title || body;
    })
    .filter(Boolean);
}

function selectSignalFromSupplements(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const title = normalizeLineItem(item.title);
      if (title) {
        return title;
      }
      return truncateSentence(toCompactSentence(item.body), 140);
    })
    .filter(Boolean);
}

function renderBulletList(items, fallbackText) {
  const lines = Array.isArray(items) && items.length
    ? items.map((item) => `- ${normalizeLineItem(item)}`)
    : [`- ${fallbackText}`];
  return lines.join("\n");
}

function renderDatedGroups(groups, fallbackText) {
  if (!Array.isArray(groups) || !groups.length) {
    return `- ${fallbackText}`;
  }
  const parts = [];
  for (const group of groups) {
    parts.push(`### ${group.date}`);
    for (const line of group.lines) {
      parts.push(`- ${normalizeLineItem(line)}`);
    }
  }
  return parts.join("\n");
}

function renderSupplementGroups(items, fallbackText) {
  if (!Array.isArray(items) || !items.length) {
    return `- ${fallbackText}`;
  }
  const parts = [];
  for (const item of items) {
    const heading = item.title
      ? `### ${item.date} ${item.title}`
      : `### ${item.date}`;
    parts.push(heading);
    parts.push(item.body || "-");
  }
  return parts.join("\n\n");
}

function upsertManagedBlock(content, slot, body) {
  const block = buildManagedBlock(slot, body);
  const pattern = buildManagedBlockPattern(slot);
  if (pattern.test(content)) {
    return content.replace(pattern, block);
  }
  return `${content.replace(/\s*$/u, "")}\n\n${block}\n`;
}

function buildManagedBlock(slot, body) {
  return [
    `<!-- ${REVIEW_MARKER_PREFIX}:${slot}:start -->`,
    String(body || "").trim(),
    `<!-- ${REVIEW_MARKER_PREFIX}:${slot}:end -->`,
  ].join("\n");
}

function hasManagedBlock(content, slot) {
  return REVIEW_MARKER_PREFIXES.some((prefix) => {
    const markerStart = `<!-- ${prefix}:${slot}:start -->`;
    const markerEnd = `<!-- ${prefix}:${slot}:end -->`;
    return content.includes(markerStart) && content.includes(markerEnd);
  });
}

function readManagedBlock(content, slot) {
  const pattern = buildManagedBlockPattern(slot, true);
  const match = pattern.exec(content);
  return match?.[1] || "";
}

function buildManagedBlockPattern(slot, captureBody = false) {
  const prefixPattern = REVIEW_MARKER_PREFIXES.map(escapeRegExp).join("|");
  const normalizedSlot = escapeRegExp(slot);
  const bodyPattern = captureBody ? "([\\s\\S]*?)" : "[\\s\\S]*?";
  return new RegExp(
    `<!--\\s*(?:${prefixPattern}):${normalizedSlot}:start\\s*-->\\n?${bodyPattern}\\n?<!--\\s*(?:${prefixPattern}):${normalizedSlot}:end\\s*-->`,
    "u"
  );
}

function parseManagedBulletList(content, slot) {
  return splitLines(readManagedBlock(content, slot))
    .map((line) => {
      if (/^###\s+/u.test(line)) {
        return "";
      }
      if (/^-\s+/u.test(line)) {
        return normalizeLineItem(line.replace(/^-\s+/u, ""));
      }
      return normalizeLineItem(line);
    })
    .filter((line) => line && !isGeneratedFallbackLine(line));
}

function replaceHeading(content, level, title) {
  const pattern = new RegExp(`^${"#".repeat(level)}\\s+.*$`, "m");
  if (!pattern.test(content)) {
    return content;
  }
  return content.replace(pattern, `${"#".repeat(level)} ${title}`);
}

function updateFrontmatterValue(content, key, value) {
  if (!content.startsWith("---\n")) {
    return content;
  }
  const end = content.indexOf("\n---\n", 4);
  if (end < 0) {
    return content;
  }
  const frontmatter = content.slice(4, end);
  const rest = content.slice(end + 5);
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*.*$`, "m");
  const nextFrontmatter = pattern.test(frontmatter)
    ? frontmatter.replace(pattern, `${key}: ${value}`)
    : `${frontmatter}\n${key}: ${value}`;
  return `---\n${nextFrontmatter}\n---\n${rest.replace(/^\n*/u, "")}`;
}

function resolveReviewWindow(kind, options = {}) {
  const normalizedKind = normalizeReviewKind(kind);
  if (normalizedKind === "nightly") {
    return resolveNightlyWindow(options);
  }
  if (normalizedKind === "weekly") {
    return resolveWeeklyWindow(options);
  }
  return resolveMonthlyWindow(options);
}

function resolveNightlyWindow(options = {}) {
  const baseDate = normalizeText(options.date)
    ? parseDateString(normalizeText(options.date))
    : getCurrentUtcDateInShanghai();
  const label = formatUtcDate(baseDate);
  return {
    label,
    startDate: label,
    endDate: label,
  };
}

function resolveWeeklyWindow(options = {}) {
  if (normalizeText(options.week)) {
    const match = /^(\d{4})-W(\d{2})$/u.exec(normalizeText(options.week));
    if (!match) {
      throw new Error(`--week 格式应为 YYYY-Www: ${options.week}`);
    }
    const year = Number.parseInt(match[1], 10);
    const week = Number.parseInt(match[2], 10);
    const weekOneStart = startOfIsoWeek(createUtcDate(year, 1, 4));
    const start = addDays(weekOneStart, (week - 1) * 7);
    const end = addDays(start, 6);
    return {
      label: `${year}-W${String(week).padStart(2, "0")}`,
      startDate: formatUtcDate(start),
      endDate: formatUtcDate(end),
    };
  }

  const baseDate = normalizeText(options.date)
    ? parseDateString(normalizeText(options.date))
    : getCurrentUtcDateInShanghai();
  const start = startOfIsoWeek(baseDate);
  const end = addDays(start, 6);
  const week = isoWeekNumber(baseDate);
  return {
    label: `${baseDate.getUTCFullYear()}-W${String(week).padStart(2, "0")}`,
    startDate: formatUtcDate(start),
    endDate: formatUtcDate(end),
  };
}

function resolveMonthlyWindow(options = {}) {
  let year = 0;
  let month = 0;
  if (normalizeText(options.month)) {
    const match = /^(\d{4})-(\d{2})$/u.exec(normalizeText(options.month));
    if (!match) {
      throw new Error(`--month 格式应为 YYYY-MM: ${options.month}`);
    }
    year = Number.parseInt(match[1], 10);
    month = Number.parseInt(match[2], 10);
  } else {
    const baseDate = normalizeText(options.date)
      ? parseDateString(normalizeText(options.date))
      : getCurrentUtcDateInShanghai();
    year = baseDate.getUTCFullYear();
    month = baseDate.getUTCMonth() + 1;
  }
  const start = createUtcDate(year, month, 1);
  const end = addDays(createUtcDate(year, month + 1, 1), -1);
  return {
    label: `${year}-${String(month).padStart(2, "0")}`,
    startDate: formatUtcDate(start),
    endDate: formatUtcDate(end),
  };
}

function buildReviewSections(kind, carryLabel) {
  if (kind === "nightly") {
    return [
      { heading: "## 今晚窗口", slot: "window" },
      { heading: "## 今天最真实的推进", slot: "progress" },
      { heading: "## 今天的消耗与摩擦", slot: "friction" },
      { heading: "## 今晚还开着的线头", slot: "open-loops" },
      { heading: `## ${carryLabel}`, slot: "carry-forward" },
      { heading: "## 睡前收口摘录", slot: "closeout" },
      { heading: "## 值得带走的信号", slot: "signals" },
      { heading: "## Agent 判断", staticBody: "- " },
    ];
  }
  return [
    { heading: "## 本周期窗口", slot: "window" },
    { heading: "## 这段时间最真实的推进", slot: "progress" },
    { heading: "## 消耗与摩擦", slot: "friction" },
    { heading: "## 还开着的线头", slot: "open-loops" },
    { heading: `## ${carryLabel}`, slot: "carry-forward" },
    { heading: "## 每天收口摘录", slot: "daily-summaries" },
    { heading: "## 值得回看的补充记录", slot: "supplements" },
    { heading: "## Agent 判断", staticBody: "- " },
  ];
}

function normalizeReviewKind(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "nightly" || normalized === "weekly" || normalized === "monthly") {
    return normalized;
  }
  throw new Error(`不支持的 review kind: ${value}`);
}

function normalizeTags(value, fallback) {
  const tags = Array.isArray(value) ? value : fallback;
  return tags
    .map((tag) => normalizeText(tag))
    .filter(Boolean);
}

function hasFrictionSignal(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }
  return /(偏重|头痛|忘|烦|卡|累|耗|断开|岔开|拖|收不住|重复发送|截断|低电量|羞耻|分心)/u.test(normalized);
}

function looksLikeCarryForward(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }
  return /^(明天|下周|下个月|后面|下一步|后续)/u.test(normalized);
}

function isReviewLeadIn(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return true;
  }
  return /^今天有\d+条主线[:：]?$/u.test(normalized)
    || /^[^：:]{1,20}[：:]$/u.test(normalized);
}

function isGeneratedFallbackLine(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return true;
  }
  return /还没有可用|还没有明显|没有明显还开着|没有明显的摩擦|下一次先从最小动作|明天先从最小动作|没有可引用的每日总结|没有值得回看的补充记录|睡前收口还没有写出来|还没有稳定到值得带走的信号/u.test(normalized);
}

function dedupeStatements(items) {
  const seen = new Set();
  const result = [];
  for (const rawItem of Array.isArray(items) ? items : []) {
    const item = normalizeLineItem(rawItem);
    if (!item) {
      continue;
    }
    const comparable = item.toLowerCase();
    if (seen.has(comparable)) {
      continue;
    }
    seen.add(comparable);
    result.push(item);
  }
  return result;
}

function splitLines(body) {
  return normalizeLineEnding(body)
    .split("\n")
    .map((line) => String(line || "").trim())
    .filter(Boolean);
}

function truncateSentence(value, maxLength) {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).replace(/[，。；,;:\s]+$/u, "")}…`;
}

function toCompactSentence(value) {
  return normalizeBody(value).replace(/\s*\n+\s*/gu, " ").replace(/\s{2,}/gu, " ").trim();
}

function selectWorkspaceProfile(workspaces, workspaceRoot) {
  if (!workspaces || typeof workspaces !== "object") {
    return {};
  }
  const normalizedWorkspaceRoot = normalizeDisplayPath(workspaceRoot);
  for (const [candidateRoot, profile] of Object.entries(workspaces)) {
    if (normalizeDisplayPath(candidateRoot) === normalizedWorkspaceRoot) {
      return profile && typeof profile === "object" ? profile : {};
    }
  }
  return {};
}

function resolveWorkspacePath(workspaceRoot, targetPath) {
  if (path.isAbsolute(targetPath)) {
    return normalizeDisplayPath(path.resolve(targetPath));
  }
  return normalizeDisplayPath(path.resolve(workspaceRoot, ...String(targetPath || "").split("/")));
}

function normalizeRelativeOrAbsolutePath(value) {
  return normalizeText(value).replace(/\\/g, "/");
}

function createUtcDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date, offset) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + offset);
  return next;
}

function parseDateString(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) {
    throw new Error(`日期格式应为 YYYY-MM-DD: ${value}`);
  }
  return createUtcDate(
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3], 10)
  );
}

function startOfIsoWeek(date) {
  const day = date.getUTCDay() || 7;
  return addDays(date, 1 - day);
}

function isoWeekNumber(date) {
  const thursday = addDays(startOfIsoWeek(date), 3);
  const firstThursday = addDays(startOfIsoWeek(createUtcDate(thursday.getUTCFullYear(), 1, 4)), 3);
  return Math.round((thursday - firstThursday) / 604800000) + 1;
}

function formatUtcDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentUtcDateInShanghai() {
  const now = new Date();
  const shanghai = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parseDateString(shanghai);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDateTime(date) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(date).replace(" ", "T");
}

function normalizeBody(value) {
  return normalizeLineEnding(value).trim();
}

function normalizeLineItem(value) {
  return normalizeBody(value).replace(/\s*\n+\s*/gu, " ").replace(/\s{2,}/gu, " ").trim();
}

function normalizeLineEnding(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function ensureTrailingNewline(value) {
  const normalized = normalizeLineEnding(value);
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function normalizeDisplayPath(targetPath) {
  return normalizeText(targetPath).replace(/\\/g, "/");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

module.exports = {
  buildReview,
  loadReviewSchemaConfig,
  resolveReviewProfile,
  resolveReviewWindow,
  writeReview,
};
