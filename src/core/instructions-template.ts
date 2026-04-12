const {
  resolveConfiguredPersonName,
  resolvePromptPersonEn,
  resolvePromptPersonZh,
} = require("./person-reference");

function resolveUserPronoun(gender: any) {
  const normalized = String(gender || "").trim().toLowerCase();
  if (normalized === "male" || normalized === "man" || normalized === "m" || normalized === "男") {
    return "他";
  }
  if (normalized === "neutral" || normalized === "nonbinary" || normalized === "nb" || normalized === "ta") {
    return "TA";
  }
  return "她";
}

function renderInstructionTemplate(template: any, config: any = {}) {
  const userName = resolveConfiguredPersonName(config);
  const pronoun = resolveUserPronoun(config?.userGender);
  const personZh = resolvePromptPersonZh(config);
  const personEn = resolvePromptPersonEn(config);
  const codekseiHome = String(
    config?.codekseiHome
    || process.env.CODEKSEI_HOME
    || ""
  ).trim();
  return String(template || "")
    .replaceAll("{{USER_NAME}}", userName)
    .replaceAll("{{PERSON_ZH}}", personZh)
    .replaceAll("{{PERSON_EN}}", personEn)
    .replaceAll("{{CODEKSEI_HOME}}", codekseiHome)
    .replaceAll("她", pronoun);
}

module.exports = {
  renderInstructionTemplate,
  resolveUserPronoun,
};

export {};
