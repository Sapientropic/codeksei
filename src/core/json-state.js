// @ts-check

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

function readManagedJsonStateFile({
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

function readForeignJsonDocument(filePath, { fallback = null } = {}) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return cloneFallback(fallback);
    }
    return cloneFallback(fallback);
  }
}

function writeManagedJsonStateFile(filePath, payload, { mode = null } = {}) {
  writeJsonFileAtomically(filePath, payload, { mode });
}

function writeForeignJsonDocument(filePath, payload, { mode = null } = {}) {
  writeJsonFileAtomically(filePath, payload, { mode });
}

function writeManagedTextStateFile(filePath, content, { mode = null, encoding = "utf8" } = {}) {
  // Managed runtime state is allowed to validate/quarantine on read, but its
  // write path should still be one stable atomic primitive.
  writeTextFileAtomically(filePath, content, { mode, encoding });
}

function writeForeignTextDocument(filePath, content, { mode = null, encoding = "utf8" } = {}) {
  // User-facing notes/reviews/diaries are foreign documents. We preserve atomic
  // replacement here, but intentionally avoid the managed-state quarantine
  // semantics that would otherwise rename user documents on read failure.
  writeTextFileAtomically(filePath, content, { mode, encoding });
}

function writeTextFileAtomically(filePath, content, {
  mode = null,
  encoding = "utf8",
} = {}) {
  ensureParentDirectory(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, String(content ?? ""), {
    encoding: /** @type {BufferEncoding} */ (encoding),
  });
  fs.renameSync(tempPath, filePath);
  if (mode !== null && mode !== undefined) {
    try {
      fs.chmodSync(filePath, mode);
    } catch {
      // best effort
    }
  }
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

function cloneFallback(fallback) {
  if (typeof fallback === "undefined") {
    return null;
  }
  return cloneJsonValue(fallback);
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

function writeJsonFileAtomically(filePath, payload, { mode = null } = {}) {
  writeTextFileAtomically(filePath, JSON.stringify(payload, null, 2), { mode, encoding: "utf8" });
}

const readJsonStateFile = readManagedJsonStateFile;
const writeJsonStateFile = writeManagedJsonStateFile;

module.exports = {
  cloneJsonValue,
  ensureParentDirectory,
  isPlainObject,
  readForeignJsonDocument,
  readManagedJsonStateFile,
  readJsonStateFile,
  writeForeignTextDocument,
  writeManagedTextStateFile,
  writeTextFileAtomically,
  writeForeignJsonDocument,
  writeManagedJsonStateFile,
  writeJsonStateFile,
};
