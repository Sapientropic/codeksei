const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const { resolveTimelineRuntimeConfig } = require("../src/timeline/runtime-config");

test("timeline runtime config defaults locale to zh-CN", () => {
  delete process.env.CODEKSEI_TIMELINE_LOCALE;
  delete process.env.TIMELINE_FOR_AGENT_LOCALE;

  const config = resolveTimelineRuntimeConfig({ stateDir: "E:/timeline-state" });

  assert.equal(config.timelineLocale, "zh-CN");
});

test("timeline runtime config honors CODEKSEI_TIMELINE_LOCALE over legacy locale env", () => {
  process.env.CODEKSEI_TIMELINE_LOCALE = "en";
  process.env.TIMELINE_FOR_AGENT_LOCALE = "zh-CN";

  try {
    const config = resolveTimelineRuntimeConfig({ stateDir: "E:/timeline-state" });
    assert.equal(config.timelineLocale, "en");
  } finally {
    delete process.env.CODEKSEI_TIMELINE_LOCALE;
    delete process.env.TIMELINE_FOR_AGENT_LOCALE;
  }
});

test("timeline runtime config still accepts legacy TIMELINE_FOR_AGENT_LOCALE when new env is absent", () => {
  delete process.env.CODEKSEI_TIMELINE_LOCALE;
  process.env.TIMELINE_FOR_AGENT_LOCALE = "en";

  try {
    const config = resolveTimelineRuntimeConfig({ stateDir: "E:/timeline-state" });
    assert.equal(config.timelineLocale, "en");
  } finally {
    delete process.env.TIMELINE_FOR_AGENT_LOCALE;
  }
});
