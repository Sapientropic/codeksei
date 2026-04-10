const fs = require("fs");
const path = require("path");

const REVIEW_MARKER_PREFIX = "cyberboss-review";

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

function resolveReviewProfile(config = {}, kind) {
  const normalizedKind = normalizeReviewKind(kind);
  const workspaceRoot = normalizeDisplayPath(path.resolve(String(config.workspaceRoot || process.cwd())));
  const schemaConfig = loadReviewSchemaConfig(config);
  const workspaceProfile = selectWorkspaceProfile(schemaConfig.workspaces, workspaceRoot);
  const reviews = workspaceProfile?.reviews && typeof workspaceProfile.reviews === "object"
    ? workspaceProfile.reviews
    : {};
  const rawProfile = reviews[normalizedKind];
  if (!rawProfile || typeof rawProfile !== "object") {
    throw new Error(`当前 workspace 没有 ${normalizedKind} review 配置: ${workspaceRoot}`);
  }

  const folder = normalizeRelativeOrAbsolutePath(rawProfile.folder);
  if (!folder) {
    throw new Error(`${normalizedKind} review 缺少 folder 配置`);
  }
  return {
    kind: normalizedKind,
    workspaceRoot,
    folderPath: resolveWorkspacePath(workspaceRoot, folder),
    intro: normalizeText(rawProfile.intro),
    cadenceLabel: normalizeText(rawProfile.cadenceLabel) || (normalizedKind === "weekly" ? "周" : "月"),
    titleSuffix: normalizeText(rawProfile.titleSuffix) || (normalizedKind === "weekly" ? "周复盘" : "月复盘"),
    carryLabel: normalizeText(rawProfile.carryLabel) || (normalizedKind === "weekly" ? "下周第一步" : "下月第一步"),
  };
}

function buildReview(config = {}, kind, options = {}) {
  const profile = resolveReviewProfile(config, kind);
  const window = resolveReviewWindow(profile.kind, options);
  const diaryEntries = collectDiaryEntries(config.diaryDir, window.startDate, window.endDate);
  const draft = buildReviewDraft(profile, window, diaryEntries);
  const notePath = normalizeDisplayPath(path.join(profile.folderPath, `${draft.periodLabel}.md`));
  return {
    profile,
    window,
    diaryEntries,
    draft,
    notePath,
  };
}

function writeReview(config = {}, kind, options = {}) {
  const review = buildReview(config, kind, options);
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
  };
}

function buildReviewFileSkeleton(review, now = new Date()) {
  const createdAt = formatDateTime(now);
  const updated = formatDate(now);
  const tags = review.profile.kind === "weekly"
    ? ["cyberboss", "life-assistant", "review", "weekly"]
    : ["cyberboss", "life-assistant", "review", "monthly"];
  return [
    "---",
    `created: ${createdAt}`,
    `updated: ${updated}`,
    "type: review",
    `review_period: ${review.profile.kind}`,
    `period_label: ${review.draft.periodLabel}`,
    `period_start: ${review.window.startDate}`,
    `period_end: ${review.window.endDate}`,
    `source_diary_days: ${review.diaryEntries.length}`,
    "status: working",
    "tags:",
    ...tags.map((tag) => `  - ${tag}`),
    "---",
    `# ${review.draft.periodTitle}`,
    "",
    `> ${review.profile.intro || "这是一份 Cyberboss 生活助理复盘，不是学习项目模板。它只关心这段时间真实推进了什么、摩擦在哪里、线头还挂着什么，以及下一次怎么更容易重新接上。"} `,
    "",
    "## 本周期窗口",
    buildManagedBlock("window", ""),
    "",
    "## 这段时间最真实的推进",
    buildManagedBlock("progress", ""),
    "",
    "## 消耗与摩擦",
    buildManagedBlock("friction", ""),
    "",
    "## 还开着的线头",
    buildManagedBlock("open-loops", ""),
    "",
    `## ${review.profile.carryLabel}`,
    buildManagedBlock("carry-forward", ""),
    "",
    "## 每天收口摘录",
    buildManagedBlock("daily-summaries", ""),
    "",
    "## 值得回看的补充记录",
    buildManagedBlock("supplements", ""),
    "",
    "## Agent 判断",
    "- ",
    "",
  ].join("\n");
}

function syncReviewContent(content, review, now = new Date()) {
  let next = ensureReviewSections(normalizeLineEnding(content), review);
  next = updateFrontmatterValue(next, "updated", formatDate(now));
  next = updateFrontmatterValue(next, "period_label", review.draft.periodLabel);
  next = updateFrontmatterValue(next, "period_start", review.window.startDate);
  next = updateFrontmatterValue(next, "period_end", review.window.endDate);
  next = updateFrontmatterValue(next, "source_diary_days", String(review.diaryEntries.length));

  next = replaceHeading(next, 1, review.draft.periodTitle);
  next = upsertManagedBlock(next, "window", renderBulletList(review.draft.windowFacts, "这一段时间还没有可用日记事实。"));
  next = upsertManagedBlock(next, "progress", renderBulletList(review.draft.progress, "这段时间还没有收出可用的推进摘要。"));
  next = upsertManagedBlock(next, "friction", renderBulletList(review.draft.friction, "这段时间还没有明显的摩擦摘要。"));
  next = upsertManagedBlock(next, "open-loops", renderBulletList(review.draft.openLoops, "这一周期末尾没有明显还开着的线头。"));
  next = upsertManagedBlock(next, "carry-forward", renderBulletList(review.draft.carryForward, "下一次先从最小动作重新接上。"));
  next = upsertManagedBlock(next, "daily-summaries", renderDatedGroups(review.draft.dailySummaries, "这段时间没有可引用的每日总结。"));
  next = upsertManagedBlock(next, "supplements", renderSupplementGroups(review.draft.supplements, "这段时间没有值得回看的补充记录。"));
  return ensureTrailingNewline(next);
}

function ensureReviewSections(content, review) {
  let next = content;
  const requiredHeadings = [
    "## 本周期窗口",
    "## 这段时间最真实的推进",
    "## 消耗与摩擦",
    "## 还开着的线头",
    `## ${review.profile.carryLabel}`,
    "## 每天收口摘录",
    "## 值得回看的补充记录",
    "## Agent 判断",
  ];
  for (const heading of requiredHeadings) {
    if (new RegExp(`^${escapeRegExp(heading)}\\s*$`, "m").test(next)) {
      continue;
    }
    next = `${next.replace(/\s*$/u, "")}\n\n${heading}\n`;
  }
  return next;
}

function buildReviewDraft(profile, window, diaryEntries) {
  const latestEntry = diaryEntries[diaryEntries.length - 1] || null;
  const totalOpenTodos = diaryEntries.reduce((sum, entry) => sum + entry.todo.open.length, 0);
  const totalDoneTodos = diaryEntries.reduce((sum, entry) => sum + entry.todo.done.length, 0);
  const totalTimelineFacts = diaryEntries.reduce((sum, entry) => sum + entry.timeline.length, 0);

  const progressFromSummary = diaryEntries.flatMap((entry) =>
    entry.summary.filter((line) => !looksLikeCarryForward(line) && !hasFrictionSignal(line))
  );
  const progress = dedupeStatements(
    progressFromSummary.length
      ? progressFromSummary
      : diaryEntries.flatMap((entry) => entry.timeline)
  ).slice(0, 8);

  const friction = dedupeStatements([
    ...diaryEntries.flatMap((entry) => entry.fragment.filter(hasFrictionSignal)),
    ...diaryEntries.flatMap((entry) => selectFrictionFromSupplements(entry.supplement)),
    ...diaryEntries.flatMap((entry) => entry.summary.filter((line) => hasFrictionSignal(line))),
  ]).slice(0, 8);

  const openLoops = dedupeStatements(latestEntry ? latestEntry.todo.open : []).slice(0, 8);

  const carryForward = dedupeStatements([
    ...(latestEntry ? latestEntry.summary.filter(looksLikeCarryForward) : []),
    ...openLoops,
  ]).slice(0, 5);

  const dailySummaries = diaryEntries
    .map((entry) => ({
      date: entry.date,
      lines: dedupeStatements(entry.summary).slice(0, 6),
    }))
    .filter((entry) => entry.lines.length);

  const supplements = diaryEntries
    .flatMap((entry) => entry.supplement.map((item) => ({
      date: entry.date,
      title: item.title,
      body: toCompactSentence(item.body),
    })))
    .filter((item) => item.body)
    .slice(-8);

  return {
    periodLabel: window.label,
    periodTitle: `${window.label} ${profile.titleSuffix}`,
    windowFacts: [
      `时间范围：${window.startDate} ~ ${window.endDate}`,
      `覆盖日记：${diaryEntries.length} 天`,
      `Todo 完成 / 未完成：${totalDoneTodos} / ${totalOpenTodos}`,
      `时间线事实条数：${totalTimelineFacts}`,
      `周期末尾仍开着的线头：${openLoops.length}`,
    ],
    progress,
    friction,
    openLoops,
    carryForward,
    dailySummaries,
    supplements,
  };
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
  const markerStart = `<!-- ${REVIEW_MARKER_PREFIX}:${slot}:start -->`;
  const markerEnd = `<!-- ${REVIEW_MARKER_PREFIX}:${slot}:end -->`;
  const block = buildManagedBlock(slot, body);
  const pattern = new RegExp(
    `${escapeRegExp(markerStart)}[\\s\\S]*?${escapeRegExp(markerEnd)}`,
    "u"
  );
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
  if (normalizedKind === "weekly") {
    return resolveWeeklyWindow(options);
  }
  return resolveMonthlyWindow(options);
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

function normalizeReviewKind(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "weekly" || normalized === "monthly") {
    return normalized;
  }
  throw new Error(`不支持的 review kind: ${value}`);
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
