import { normalizeText } from "../core/text-normalization";

export const COMPANION_PROFILE_LANGUAGE_VALUES = [
  "zh-CN",
  "en",
] as const;

export const COMPANION_PROFILE_GENDER_VALUES = [
  "female",
  "male",
  "neutral",
] as const;

export type CompanionProfileLanguage = typeof COMPANION_PROFILE_LANGUAGE_VALUES[number];
export type CompanionProfileGender = typeof COMPANION_PROFILE_GENDER_VALUES[number];

export interface CompanionProfileSignals {
  preferredLanguage: CompanionProfileLanguage | "";
  gender: CompanionProfileGender | "";
}

export function createEmptyCompanionProfileSignals(): CompanionProfileSignals {
  return {
    preferredLanguage: "",
    gender: "",
  };
}

export function normalizeCompanionProfileLanguage(
  value: unknown,
): CompanionProfileLanguage | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized === "zh"
    || normalized === "zh-cn"
    || normalized === "cn"
    || normalized === "chinese"
    || normalized === "mandarin"
    || normalized === "中文"
    || normalized === "汉语"
    || normalized === "普通话"
    || normalized === "中文回复"
  ) {
    return "zh-CN";
  }
  if (
    normalized === "en"
    || normalized === "en-us"
    || normalized === "en-gb"
    || normalized === "english"
    || normalized === "英文"
    || normalized === "英语"
  ) {
    return "en";
  }
  return "";
}

export function normalizeCompanionProfileGender(
  value: unknown,
): CompanionProfileGender | "" {
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized === "male"
    || normalized === "man"
    || normalized === "m"
    || normalized === "男"
    || normalized === "男生"
    || normalized === "男性"
    || normalized === "he"
    || normalized === "he/him"
    || normalized === "him"
  ) {
    return "male";
  }
  if (
    normalized === "female"
    || normalized === "woman"
    || normalized === "f"
    || normalized === "女"
    || normalized === "女生"
    || normalized === "女性"
    || normalized === "she"
    || normalized === "she/her"
    || normalized === "her"
  ) {
    return "female";
  }
  if (
    normalized === "neutral"
    || normalized === "nonbinary"
    || normalized === "non-binary"
    || normalized === "nb"
    || normalized === "ta"
    || normalized === "they"
    || normalized === "they/them"
    || normalized === "them"
    || normalized === "中性"
  ) {
    return "neutral";
  }
  return "";
}

export function mergeCompanionProfileSignals(
  base: Partial<CompanionProfileSignals> | null | undefined,
  override: Partial<CompanionProfileSignals> | null | undefined,
): CompanionProfileSignals {
  return {
    preferredLanguage: normalizeCompanionProfileLanguage(
      override?.preferredLanguage || base?.preferredLanguage,
    ),
    gender: normalizeCompanionProfileGender(
      override?.gender || base?.gender,
    ),
  };
}
