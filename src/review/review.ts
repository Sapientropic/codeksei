import * as fs from "node:fs";
import * as path from "node:path";

import { normalizeReviewSchemaConfig } from "../contracts/config-files";
import { loadJsonConfig } from "../core/config-loader";
import { LEGACY_TIMELINE_TIMEZONE } from "../core/timezone";
import {
  normalizeDisplayPath,
  resolveCrossPlatformPath,
  resolveCrossPlatformPathFromRoot,
} from "../core/path-utils";
import { writeForeignTextDocument } from "../state/json-state";
import {
  buildReviewDraft,
  mergeReviewDraft,
  resolveReviewWindow,
} from "./review-draft";
import {
  buildReviewFileSkeleton,
  buildReviewSections,
  syncReviewContent,
} from "./review-document";
import { maybeGenerateSemanticReview } from "./review-semantic";
import {
  collectDiaryEntries,
  collectNightlyEntries,
} from "./review-sources";
import type {
  DiaryReviewEntry,
  NightlyReviewEntry,
  ReviewDraft,
  ReviewKind,
  ReviewProfile,
} from "./review-types";

const DEFAULT_REVIEW_MODELS = {
  nightly: {
    cadenceLabel: "夜",
    titleSuffix: "睡前收口",
    carryLabel: "明天第一步",
    intro: "这是一份 Codeksei 睡前收口。它只收今天真实推进了什么、现在还挂着什么、明天从哪里更容易接上，好把周/月复盘的原料先压成一层低摩擦摘要。",
    tags: ["codeksei", "companion", "review", "nightly"],
  },
  weekly: {
    cadenceLabel: "周",
    titleSuffix: "周复盘",
    carryLabel: "下周第一步",
    intro: "这是一份 Codeksei 周复盘。它关心这周真实推进了什么、摩擦在哪里、线头还挂着什么，以及下周如何更容易重新接上。",
    tags: ["codeksei", "companion", "review", "weekly"],
  },
  monthly: {
    cadenceLabel: "月",
    titleSuffix: "月复盘",
    carryLabel: "下月第一步",
    intro: "这是一份 Codeksei 月复盘。它优先收口这个月真实推进的线、反复出现的摩擦、仍未解决的线头，以及下个月应该从哪里接上。",
    tags: ["codeksei", "companion", "review", "monthly"],
  },
};

function loadReviewSchemaConfig(config: any = {}) {
  const filePath = normalizeText(config.reviewSchemaConfigFile);
  if (!filePath) {
    return {};
  }
  return loadJsonConfig({
    filePath,
    label: "review schema",
    normalize: normalizeReviewSchemaConfig,
    fallback: {},
    missing: "fallback",
    invalid: "throw",
  });
}

function resolveReviewProfile(
  config: Record<string, unknown> = {},
  kind: unknown,
  options: { required?: boolean } = {},
): ReviewProfile | null {
  const normalizedKind = normalizeReviewKind(kind);
  const defaults = DEFAULT_REVIEW_MODELS[normalizedKind];
  const required = options.required !== false;
  const workspaceRoot = resolveCrossPlatformPath(String(config.workspaceRoot || process.cwd()));
  const schemaConfig = loadReviewSchemaConfig(config);
  const workspaceProfile: any = selectWorkspaceProfile(schemaConfig.workspaces, workspaceRoot);
  const reviews = workspaceProfile?.reviews && typeof workspaceProfile.reviews === "object"
    ? (workspaceProfile.reviews as Record<string, any>)
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

async function buildReview(config: Record<string, unknown> = {}, kind: unknown, options: Record<string, unknown> = {}) {
  const profile = resolveReviewProfile(config, kind)!;
  const timezone = config.timezone || LEGACY_TIMELINE_TIMEZONE;
  const window = resolveReviewWindow(profile.kind, {
    ...options,
    timezone,
  });
  const diaryEntries = collectDiaryEntries(config.diaryDir, window.startDate, window.endDate) as DiaryReviewEntry[];
  const nightlyProfile = profile.kind === "nightly"
    ? null
    : resolveReviewProfile(config, "nightly", { required: false });
  const nightlyEntries = profile.kind === "nightly"
    ? []
    : collectNightlyEntries(nightlyProfile?.folderPath || "", window.startDate, window.endDate) as NightlyReviewEntry[];
  const deterministicDraft: ReviewDraft = buildReviewDraft(profile, window, diaryEntries, nightlyEntries);
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
  const notePath = normalizeDisplayPath(path.join(String(profile.folderPath || ""), `${draft.periodLabel}.md`));
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

async function writeReview(config: any = {}, kind: any, options: any = {}) {
  const review = await buildReview(config, kind, options);
  fs.mkdirSync(path.dirname(review.notePath), { recursive: true });
  const now = new Date();
  const current = fs.existsSync(review.notePath)
    ? normalizeLineEnding(fs.readFileSync(review.notePath, "utf8"))
    : buildReviewFileSkeleton(review, now);
  const next = syncReviewContent(current, review, now);
  const changed = ensureTrailingNewline(current) !== ensureTrailingNewline(next);
  if (changed) {
    writeForeignTextDocument(review.notePath, ensureTrailingNewline(next), { encoding: "utf8" });
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

function normalizeReviewKind(value: unknown): ReviewKind {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "nightly" || normalized === "weekly" || normalized === "monthly") {
    return normalized;
  }
  throw new Error(`不支持的 review kind: ${value}`);
}

function normalizeTags(value: unknown, fallback: string[]): string[] {
  const tags = Array.isArray(value) ? value : fallback;
  return tags
    .map((tag) => normalizeText(tag))
    .filter(Boolean);
}

function selectWorkspaceProfile(workspaces: any, workspaceRoot: any) {
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

function resolveWorkspacePath(workspaceRoot: any, targetPath: any) {
  if (path.isAbsolute(targetPath) || path.win32.isAbsolute(targetPath)) {
    return resolveCrossPlatformPath(targetPath);
  }
  return resolveCrossPlatformPathFromRoot(workspaceRoot, ...String(targetPath || "").split("/"));
}

function normalizeRelativeOrAbsolutePath(value: any) {
  return normalizeText(value).replace(/\\/g, "/");
}

function normalizeLineEnding(value: any) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

function ensureTrailingNewline(value: any) {
  const normalized = normalizeLineEnding(value);
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export {
  buildReview,
  loadReviewSchemaConfig,
  resolveReviewProfile,
  resolveReviewWindow,
  writeReview,
};
