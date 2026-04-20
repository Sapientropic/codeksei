import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

import type { AppRuntimeConfig } from "../../../../core/app-service-contract";
import { normalizeText } from "../../../../contracts/text-normalization";
import { runDiaryWriteCommand } from "../../../../app/diary-write-cli";
import { buildFrameState } from "../../application/frame/state";
import type { FrameRuntimeConfig } from "../../../runtime-config";

type FrameServerRuntimeConfig = FrameRuntimeConfig & Partial<AppRuntimeConfig>;

interface FrameSiteServerInput {
  config: FrameServerRuntimeConfig;
}

type JsonObject = Record<string, unknown>;

function createFrameSiteServer({ config }: FrameSiteServerInput): http.Server {
  fs.mkdirSync(config.frameSiteDir, { recursive: true });
  fs.mkdirSync(config.frameAssetsDir, { recursive: true });
  return http.createServer((request, response) => {
    handleFrameRequest(config, request, response).catch((error) => {
      writeJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error || "unknown error"),
      });
    });
  });
}

async function handleFrameRequest(
  config: FrameServerRuntimeConfig,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const method = normalizeText(request.method).toUpperCase() || "GET";
  const requestPath = normalizeRequestPath(request.url || "/");
  if (method === "GET" && (requestPath === "frame/state" || requestPath === "frame-state.json")) {
    writeJson(response, 200, buildFrameState(config));
    return;
  }
  if (method === "POST" && requestPath === "frame/input") {
    await handleQuickInput(config, request, response, "supplement");
    return;
  }
  if (method === "POST" && requestPath === "frame/diary/quick") {
    await handleQuickInput(config, request, response, "fragment");
    return;
  }
  if (method === "POST" && requestPath === "frame/reminder/action") {
    writeJson(response, 501, {
      ok: false,
      error: "frame reminder actions are not wired in V0; no reminder state was changed",
    });
    return;
  }
  if (method === "POST" && requestPath === "frame/checkin/action") {
    writeJson(response, 501, {
      ok: false,
      error: "frame check-in actions require the host check-in lease flow; no schedule state was changed",
    });
    return;
  }
  if (method !== "GET" && method !== "HEAD") {
    writeJson(response, 405, { ok: false, error: "method not allowed" });
    return;
  }
  serveFrameAsset(config, requestPath, response, method === "HEAD");
}

async function handleQuickInput(
  config: FrameServerRuntimeConfig,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  section: "fragment" | "supplement",
): Promise<void> {
  const body = await readJsonBody(request);
  const text = normalizeText(body.text);
  if (!text) {
    writeJson(response, 400, { ok: false, error: "text is required" });
    return;
  }
  const result = await runDiaryWriteCommand(config, [
    "--section",
    section,
    "--title",
    section === "supplement" ? "Frame quick input" : "",
    "--text",
    text,
  ]);
  writeJson(response, 200, {
    ok: true,
    data: result.data,
  });
}

function serveFrameAsset(
  config: FrameServerRuntimeConfig,
  requestPath: string,
  response: http.ServerResponse,
  headOnly: boolean,
): void {
  const frameRoot = path.resolve(config.frameRootDir);
  const normalizedPath = requestPath === "" || requestPath === "frame" || requestPath === "frame/"
    ? "site/index.html"
    : requestPath.replace(/^frame\/?/u, "site/");
  const rawFilePath = normalizedPath.startsWith("assets/")
    ? path.resolve(config.frameRootDir, normalizedPath)
    : path.resolve(config.frameRootDir, normalizedPath);
  const safePath = rawFilePath.startsWith(frameRoot) ? rawFilePath : path.join(frameRoot, "site", "index.html");
  const resolvedPath = fs.existsSync(safePath) && fs.statSync(safePath).isFile()
    ? safePath
    : path.join(frameRoot, "site", "index.html");
  if (!fs.existsSync(resolvedPath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("frame site not built");
    return;
  }
  response.writeHead(200, {
    "content-type": detectMimeType(resolvedPath),
    "cache-control": resolvedPath.endsWith(".html") ? "no-store" : "public, max-age=300",
  });
  if (headOnly) {
    response.end();
    return;
  }
  fs.createReadStream(resolvedPath).pipe(response);
}

async function listenFrameSiteServer(
  server: http.Server,
  { port }: { port: number },
): Promise<{ port: number; url: string }> {
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;
  return {
    port: resolvedPort,
    url: `http://127.0.0.1:${resolvedPort}/frame`,
  };
}

function closeFrameSiteServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function readJsonBody(request: http.IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
}

function writeJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function normalizeRequestPath(url: string): string {
  const pathname = String(url || "/").split("?")[0] || "/";
  return pathname.replace(/^\/+/, "");
}

function detectMimeType(filePath: string): string {
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (filePath.endsWith(".png")) {
    return "image/png";
  }
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return "text/html; charset=utf-8";
}

export {
  closeFrameSiteServer,
  createFrameSiteServer,
  listenFrameSiteServer,
};
