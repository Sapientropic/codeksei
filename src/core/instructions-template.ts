import { normalizeText } from "./text-normalization";
import {
  resolveConfiguredPersonName,
  resolvePromptPersonEn,
  resolvePromptPersonZh,
} from "../contracts/person-reference";
import { resolveCompanionProfileSignals } from "../companion-memory/profile-signals";
import { normalizeCompanionProfileLanguage } from "../companion-memory/profile-signal-contracts";

interface InstructionTemplateConfigInput {
  allowedUserIds?: unknown;
  codekseiHome?: unknown;
  durableNoteSchemaConfigFile?: unknown;
  senderId?: unknown;
  stateDir?: unknown;
  userGender?: unknown;
  userLanguage?: unknown;
  userName?: unknown;
  workspaceRoot?: unknown;
}

function resolveUserPronoun(gender: unknown): string {
  const normalized = normalizeText(gender).toLowerCase();
  if (normalized === "male" || normalized === "man" || normalized === "m" || normalized === "男") {
    return "他";
  }
  if (normalized === "neutral" || normalized === "nonbinary" || normalized === "nb" || normalized === "ta") {
    return "TA";
  }
  return "TA";
}

function resolveInstructionSignals(
  config: InstructionTemplateConfigInput = {},
) {
  return resolveCompanionProfileSignals(config, normalizeText(config.senderId));
}

function resolveInstructionLanguage(config: InstructionTemplateConfigInput = {}): "zh-CN" | "en" {
  const signals = resolveInstructionSignals(config);
  return normalizeCompanionProfileLanguage(
    signals.preferredLanguage || config.userLanguage,
  ) || "zh-CN";
}

function renderInstructionTemplate(template: unknown, config: InstructionTemplateConfigInput = {}): string {
  const userName = resolveConfiguredPersonName(config);
  const signals = resolveInstructionSignals(config);
  const pronoun = resolveUserPronoun(signals.gender || config?.userGender);
  const personZh = resolvePromptPersonZh(config);
  const personEn = resolvePromptPersonEn(config);
  const language = resolveInstructionLanguage(config);
  const codekseiHome = String(
    config?.codekseiHome
    || process.env.CODEKSEI_HOME
    || ""
  ).trim();
  return String(template || "")
    .replaceAll("{{USER_NAME}}", userName)
    .replaceAll("{{PERSON_ZH}}", personZh)
    .replaceAll("{{PERSON_EN}}", personEn)
    .replaceAll("{{PRONOUN_ZH}}", pronoun)
    .replaceAll("{{USER_LANGUAGE}}", language)
    .replaceAll("{{CODEKSEI_HOME}}", codekseiHome)
    .replaceAll("她", pronoun);
}

export {
  renderInstructionTemplate,
  resolveInstructionLanguage,
  resolveUserPronoun,
};
