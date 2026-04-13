const os = require("os");
const path = require("path");

function readConfig() {
  const mode = process.argv[2] || "";
  const defaultStateDir = path.join(os.homedir(), ".codeksei");
  const stateDir = process.env.CODEKSEI_TIMELINE_STATE_DIR
    || process.env.CODEKSEI_STATE_DIR
    || process.env.TIMELINE_FOR_AGENT_STATE_DIR
    || defaultStateDir;

  return {
    mode,
    stateDir,
    timelineDir: process.env.CODEKSEI_TIMELINE_DIR
      || process.env.TIMELINE_FOR_AGENT_DIR
      || path.join(stateDir, "timeline"),
    timelineWriteLockDir: process.env.CODEKSEI_TIMELINE_WRITE_LOCK_DIR
      || process.env.TIMELINE_FOR_AGENT_WRITE_LOCK_DIR
      || path.join(stateDir, "timeline", "timeline-write.lock"),
    timelineStateFile: process.env.CODEKSEI_TIMELINE_STATE_FILE
      || process.env.TIMELINE_FOR_AGENT_STATE_FILE
      || path.join(stateDir, "timeline", "timeline-state.json"),
    timelineDbFile: process.env.CODEKSEI_TIMELINE_DB_FILE
      || process.env.TIMELINE_FOR_AGENT_DB_FILE
      || path.join(stateDir, "timeline", "timeline-db.json"),
    timelineTaxonomyFile: process.env.CODEKSEI_TIMELINE_TAXONOMY_FILE
      || process.env.TIMELINE_FOR_AGENT_TAXONOMY_FILE
      || path.join(stateDir, "timeline", "timeline-taxonomy.json"),
    timelineFactsFile: process.env.CODEKSEI_TIMELINE_FACTS_FILE
      || process.env.TIMELINE_FOR_AGENT_FACTS_FILE
      || path.join(stateDir, "timeline", "timeline-facts.json"),
    timelineSiteDir: process.env.CODEKSEI_TIMELINE_SITE_DIR
      || process.env.TIMELINE_FOR_AGENT_SITE_DIR
      || path.join(stateDir, "timeline", "site"),
    timelinePort: readNumberEnv("CODEKSEI_TIMELINE_PORT", readNumberEnv("TIMELINE_FOR_AGENT_PORT", 4317)),
    chromeExecutablePath: process.env.CODEKSEI_SCREENSHOT_CHROME_PATH
      || process.env.TIMELINE_FOR_AGENT_CHROME_PATH
      || "",
  };
}

function readNumberEnv(name, fallback) {
  const rawValue = String(process.env[name] || "").trim();
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = { readConfig };
