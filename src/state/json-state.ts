import * as fs from "node:fs";
import * as path from "node:path";
import type { ZodType } from "zod";

type JsonValidationResult = true | string | Error | undefined;
type JsonValidator = ((value: unknown) => JsonValidationResult) | null;

interface ReadManagedJsonStateFileOptions<T> {
  filePath: string;
  fallback: T;
  label?: string;
  validate?: JsonValidator;
  schema?: ZodType<T>;
}

interface ReadForeignJsonDocumentOptions<T> {
  fallback?: T;
}

interface WriteTextFileOptions {
  mode?: number | null;
  encoding?: BufferEncoding;
}

interface WriteJsonFileOptions {
  mode?: number | null;
}

export function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function cloneJsonValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function readManagedJsonStateFile<T>({
  filePath,
  fallback,
  label = "json state",
  validate = null,
  schema,
}: ReadManagedJsonStateFileOptions<T>): T {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const validationOptions: { validate?: JsonValidator; schema?: ZodType<T> } = {};
    if (validate !== null) {
      validationOptions.validate = validate;
    }
    if (schema) {
      validationOptions.schema = schema;
    }
    return validateJsonState(parsed, validationOptions);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
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

export function readForeignJsonDocument<T = null>(
  filePath: string,
  { fallback = null as T }: ReadForeignJsonDocumentOptions<T> = {},
): T {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return cloneFallback(fallback);
    }
    return cloneFallback(fallback);
  }
}

export function writeManagedJsonStateFile(
  filePath: string,
  payload: unknown,
  { mode = null }: WriteJsonFileOptions = {},
): void {
  writeJsonFileAtomically(filePath, payload, { mode });
}

export function writeForeignJsonDocument(
  filePath: string,
  payload: unknown,
  { mode = null }: WriteJsonFileOptions = {},
): void {
  writeJsonFileAtomically(filePath, payload, { mode });
}

export function writeManagedTextStateFile(
  filePath: string,
  content: unknown,
  { mode = null, encoding = "utf8" }: WriteTextFileOptions = {},
): void {
  writeTextFileAtomically(filePath, content, { mode, encoding });
}

export function writeForeignTextDocument(
  filePath: string,
  content: unknown,
  { mode = null, encoding = "utf8" }: WriteTextFileOptions = {},
): void {
  writeTextFileAtomically(filePath, content, { mode, encoding });
}

export function writeTextFileAtomically(
  filePath: string,
  content: unknown,
  { mode = null, encoding = "utf8" }: WriteTextFileOptions = {},
): void {
  ensureParentDirectory(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, String(content ?? ""), { encoding });
  fs.renameSync(tempPath, filePath);
  if (mode !== null && mode !== undefined) {
    try {
      fs.chmodSync(filePath, mode);
    } catch {
      // best effort
    }
  }
}

function isolateCorruptStateFile(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) {
      return "";
    }
    ensureParentDirectory(filePath);
    const parsedPath = path.parse(filePath);
    const timestamp = new Date().toISOString().replace(/[-:.]/gu, "").replace(/\.\d+Z$/u, "Z");
    const backupPath = path.join(
      parsedPath.dir,
      `${parsedPath.name}.corrupt-${timestamp}${parsedPath.ext || ".json"}`,
    );
    fs.renameSync(filePath, backupPath);
    return backupPath;
  } catch {
    return "";
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function cloneFallback<T>(fallback: T): T {
  return cloneJsonValue(fallback);
}

function validateJsonState<T>(
  value: unknown,
  { validate = null, schema }: { validate?: JsonValidator; schema?: ZodType<T> },
): T {
  if (schema) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message || "schema validation failed");
    }
    return parsed.data;
  }

  if (typeof validate === "function") {
    const result = validate(value);
    if (result === true || typeof result === "undefined") {
      return value as T;
    }
    if (result instanceof Error) {
      throw result;
    }
    if (typeof result === "string" && result.trim()) {
      throw new Error(result.trim());
    }
    throw new Error("schema validation failed");
  }

  return value as T;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export const readJsonStateFile = readManagedJsonStateFile;
export const writeJsonStateFile = writeManagedJsonStateFile;

function writeJsonFileAtomically(
  filePath: string,
  payload: unknown,
  { mode = null }: WriteJsonFileOptions = {},
): void {
  writeTextFileAtomically(filePath, JSON.stringify(payload, null, 2), {
    mode,
    encoding: "utf8",
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error) && typeof error === "object";
}
