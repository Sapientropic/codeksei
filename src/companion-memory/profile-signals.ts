import * as fs from "node:fs";

import { normalizeText } from "../core/text-normalization";
import { resolveDurableNoteRoute } from "../notes/durable-note-schema";
import { findSectionRange } from "../notes/note-sync";
import {
  createCompanionMemoryRuntimeStateStore,
  type CompanionMemoryRuntimeStateConfig,
} from "./runtime-state";
import {
  createEmptyCompanionProfileSignals,
  mergeCompanionProfileSignals,
  normalizeCompanionProfileGender,
  normalizeCompanionProfileLanguage,
  type CompanionProfileSignals,
} from "./profile-signal-contracts";

interface CompanionProfileSignalConfig extends CompanionMemoryRuntimeStateConfig {
  allowedUserIds?: unknown;
  durableNoteSchemaConfigFile?: unknown;
  senderId?: unknown;
  userGender?: unknown;
  userLanguage?: unknown;
  workspaceRoot?: unknown;
}

const LANGUAGE_EN_RE = /\benglish\b|英文|英语/iu;
const LANGUAGE_ZH_RE = /\bchinese\b|\bmandarin\b|中文|汉语|普通话/iu;
const LANGUAGE_HINT_RE = /(回复|回答|说|讲|聊|交流|沟通|写|用|切换|改用|prefer|reply|respond|speak|talk|write|use|switch|keep)/iu;
const PREFERENCE_RE = /(更喜欢|希望|最好|请|prefer|would rather|please)/iu;

const GENDER_MALE_RE = /\bmale\b|\bman\b|我是男|男生|男性|叫我他|用他|称呼我.*他|\bhe\/him\b|\bhe him\b/iu;
const GENDER_FEMALE_RE = /\bfemale\b|\bwoman\b|我是女|女生|女性|叫我她|用她|称呼我.*她|\bshe\/her\b|\bshe her\b/iu;
const GENDER_NEUTRAL_RE = /\bnon-?binary\b|\bthey\/them\b|\bthey them\b|\bta\b|叫我ta|叫我TA|用ta|用TA|称呼我.*TA|中性|不要用他她/iu;

export function extractCompanionProfileSignalUpdatesFromText(
  text: unknown,
): Partial<CompanionProfileSignals> {
  const normalized = normalizeText(text);
  if (!normalized) {
    return {};
  }
  return {
    preferredLanguage: detectPreferredLanguageFromText(normalized),
    gender: detectGenderFromText(normalized),
  };
}

export function resolveCompanionProfileSignals(
  config: CompanionProfileSignalConfig = {},
  explicitUserId: unknown = "",
): CompanionProfileSignals {
  const fallback = mergeCompanionProfileSignals(createEmptyCompanionProfileSignals(), {
    preferredLanguage: normalizeCompanionProfileLanguage(config.userLanguage),
    gender: normalizeCompanionProfileGender(config.userGender),
  });
  const userId = resolveCompanionProfileUserId(config, explicitUserId);
  if (!userId) {
    return fallback;
  }

  const runtimeSignals = readRuntimeStateSignals(config, userId);
  const noteSignals = readCompanionNoteSignals(config, userId);
  return mergeCompanionProfileSignals(
    fallback,
    mergeCompanionProfileSignals(noteSignals, runtimeSignals),
  );
}

function resolveCompanionProfileUserId(
  config: CompanionProfileSignalConfig,
  explicitUserId: unknown,
): string {
  const explicit = normalizeText(explicitUserId);
  if (explicit) {
    return explicit;
  }
  const senderId = normalizeText(config.senderId);
  if (senderId) {
    return senderId;
  }
  const allowedUserIds = Array.isArray(config.allowedUserIds)
    ? config.allowedUserIds.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  return allowedUserIds.length === 1 ? allowedUserIds[0] || "" : "";
}

function readRuntimeStateSignals(
  config: CompanionProfileSignalConfig,
  userId: string,
): Partial<CompanionProfileSignals> {
  try {
    if (!normalizeText(config.stateDir)) {
      return {};
    }
    return createCompanionMemoryRuntimeStateStore(config, userId).getState().profileSignals;
  } catch {
    return {};
  }
}

function readCompanionNoteSignals(
  config: CompanionProfileSignalConfig,
  userId: string,
): Partial<CompanionProfileSignals> {
  const signals = createEmptyCompanionProfileSignals();
  for (const kind of ["preference", "boundary", "status", "pattern", "next"] as const) {
    for (const line of readCompanionSectionLines(config, userId, kind)) {
      const updates = extractCompanionProfileSignalUpdatesFromText(line);
      if (!signals.preferredLanguage && updates.preferredLanguage) {
        signals.preferredLanguage = updates.preferredLanguage;
      }
      if (!signals.gender && updates.gender) {
        signals.gender = updates.gender;
      }
      if (signals.preferredLanguage && signals.gender) {
        return signals;
      }
    }
  }
  return signals;
}

function readCompanionSectionLines(
  config: CompanionProfileSignalConfig,
  userId: string,
  kind: "preference" | "boundary" | "status" | "pattern" | "next",
): string[] {
  try {
    const route = resolveDurableNoteRoute({
      ...config,
      allowedUserIds: [userId],
      senderId: userId,
    }, {
      kind,
      scope: "companion",
    });
    if (!fs.existsSync(route.filePath)) {
      return [];
    }
    const content = fs.readFileSync(route.filePath, "utf8");
    const range = findSectionRange(content, route.section);
    if (!range) {
      return [];
    }
    return content
      .slice(range.contentStart, range.end)
      .replace(/<!--[\s\S]*?-->/gu, "\n")
      .split(/\r?\n/u)
      .map((line) => normalizeText(line).replace(/^[-*]\s+/u, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function detectPreferredLanguageFromText(
  text: string,
): CompanionProfileSignals["preferredLanguage"] {
  if (
    LANGUAGE_EN_RE.test(text)
    && (LANGUAGE_HINT_RE.test(text) || PREFERENCE_RE.test(text))
  ) {
    return "en";
  }
  if (
    LANGUAGE_ZH_RE.test(text)
    && (LANGUAGE_HINT_RE.test(text) || PREFERENCE_RE.test(text))
  ) {
    return "zh-CN";
  }
  return "";
}

function detectGenderFromText(
  text: string,
): CompanionProfileSignals["gender"] {
  if (GENDER_NEUTRAL_RE.test(text)) {
    return "neutral";
  }
  if (GENDER_MALE_RE.test(text)) {
    return "male";
  }
  if (GENDER_FEMALE_RE.test(text)) {
    return "female";
  }
  return "";
}
