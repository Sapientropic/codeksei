import * as fs from "node:fs";
import * as path from "node:path";

import { normalizeText } from "./text-normalization";

interface ResolveRequiredFilePathMessages {
  empty: string;
  missingPrefix?: string;
  notFilePrefix?: string;
}

// Current send-file flows validate local artifacts in multiple places. Keep one
// canonical helper so bridge/runtime and hosted repo-local delivery keep the
// same user-facing guarantees when a path is empty, missing, or points at a
// directory.
export function resolveRequiredFilePath(
  value: unknown,
  {
    empty,
    missingPrefix = "文件不存在",
    notFilePrefix = "只能发送文件，不能发送目录",
  }: ResolveRequiredFilePathMessages,
): string {
  const requestedPath = normalizeText(value);
  if (!requestedPath) {
    throw new Error(empty);
  }
  const resolvedPath = path.resolve(requestedPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`${missingPrefix}: ${resolvedPath}`);
  }
  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    throw new Error(`${notFilePrefix}: ${resolvedPath}`);
  }
  return resolvedPath;
}
