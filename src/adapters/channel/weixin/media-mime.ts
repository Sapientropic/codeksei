import * as path from "node:path";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
};

function getMimeFromFilename(filePath: unknown): string {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

export { getMimeFromFilename };
