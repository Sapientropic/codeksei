const fs = require("fs");
const path = require("path");

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function cloneJsonValue(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function readJsonStateFile({
  filePath,
  fallback,
  label = "json state",
  validate = null,
}) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    // Continuity-critical stores must reject both unreadable JSON and
    // structurally invalid payloads. Silently coercing an arbitrary object back
    // into runtime state can erase thread bindings or queued backstage work.
    validateJsonState(parsed, validate);
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return cloneJsonValue(fallback);
    }
    const backupPath = isolateCorruptStateFile(filePath);
    console.warn(
      `[codeksei] ${label} invalid; ${backupPath ? `moved to ${backupPath}` : "kept original file in place"}`
      + ` (${formatErrorMessage(error)})`
    );
    return cloneJsonValue(fallback);
  }
}

function writeJsonStateFile(filePath, payload) {
  ensureParentDirectory(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(payload, null, 2);
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

function isolateCorruptStateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return "";
    }
    ensureParentDirectory(filePath);
    const parsedPath = path.parse(filePath);
    const timestamp = new Date().toISOString().replace(/[-:.]/g, "").replace(/\.\d+Z$/, "Z");
    const backupPath = path.join(
      parsedPath.dir,
      `${parsedPath.name}.corrupt-${timestamp}${parsedPath.ext || ".json"}`
    );
    fs.renameSync(filePath, backupPath);
    return backupPath;
  } catch {
    return "";
  }
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function validateJsonState(value, validate) {
  if (typeof validate !== "function") {
    return;
  }

  const result = validate(value);
  if (result === true || typeof result === "undefined") {
    return;
  }
  if (result instanceof Error) {
    throw result;
  }
  if (typeof result === "string" && result.trim()) {
    throw new Error(result.trim());
  }
  throw new Error("schema validation failed");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  cloneJsonValue,
  ensureParentDirectory,
  isPlainObject,
  readJsonStateFile,
  writeJsonStateFile,
};
