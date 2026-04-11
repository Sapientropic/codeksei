function resolveUserPronoun(gender) {
  const normalized = String(gender || "").trim().toLowerCase();
  if (normalized === "male" || normalized === "man" || normalized === "m" || normalized === "男") {
    return "他";
  }
  if (normalized === "neutral" || normalized === "nonbinary" || normalized === "nb" || normalized === "ta") {
    return "TA";
  }
  return "她";
}

function renderInstructionTemplate(template, config = {}) {
  const userName = String(config?.userName || "").trim() || "用户";
  const pronoun = resolveUserPronoun(config?.userGender);
  const codekseiHome = String(
    config?.codekseiHome
    || config?.cyberbossHome
    || process.env.CODEKSEI_HOME
    || process.env.CYBERBOSS_HOME
    || ""
  ).trim();
  return String(template || "")
    .replaceAll("{{USER_NAME}}", userName)
    .replaceAll("{{CODEKSEI_HOME}}", codekseiHome)
    .replaceAll("{{CYBERBOSS_HOME}}", codekseiHome)
    .replaceAll("她", pronoun);
}

module.exports = {
  renderInstructionTemplate,
  resolveUserPronoun,
};
