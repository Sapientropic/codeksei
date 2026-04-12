function normalizePersonName(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveConfiguredPersonName(config: any = {}) {
  return normalizePersonName(config?.userName);
}

function resolvePromptPersonZh(config: any = {}) {
  return resolveConfiguredPersonName(config) || "眼前这个人";
}

function resolvePromptPersonEn(config: any = {}) {
  return resolveConfiguredPersonName(config) || "the person you're with";
}

module.exports = {
  normalizePersonName,
  resolveConfiguredPersonName,
  resolvePromptPersonEn,
  resolvePromptPersonZh,
};

export {};
