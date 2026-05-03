import * as http from "node:http";

import {
  DEFAULT_WHEREABOUTS_HTTP_MAX_BODY_BYTES,
  normalizeWhereaboutsServerConfig,
  type WhereaboutsIngestEvent,
  type WhereaboutsStateConfig,
} from "./contracts";
import { ingestWhereaboutsEvent } from "./ingest";

export function createWhereaboutsHttpServer(config: WhereaboutsStateConfig): http.Server {
  const serverConfig = normalizeWhereaboutsServerConfig(config);
  if (!serverConfig.token) {
    throw new Error("whereabouts serve 缺少 CODEKSEI_WHEREABOUTS_TOKEN。");
  }
  return http.createServer(async (request, response) => {
    try {
      const route = normalizeRoute(request.url);
      if (request.method === "GET" && route === "/healthz") {
        writeJson(response, 200, { ok: true, service: "whereabouts" });
        return;
      }
      if (request.method === "POST" && route === "/whereabouts/ingest") {
        if (!hasValidBearerToken(request, serverConfig.token)) {
          writeJson(response, 401, { ok: false, error: "missing or invalid bearer token" });
          return;
        }
        if (!hasJsonContentType(request)) {
          throw new WhereaboutsHttpError(415, "whereabouts ingest 只接受 application/json 请求体。");
        }
        const payload = await readJsonBody(request, {
          maxBytes: DEFAULT_WHEREABOUTS_HTTP_MAX_BODY_BYTES,
        }) as WhereaboutsIngestEvent;
        const nextState = await ingestWhereaboutsEvent(config, payload);
        writeJson(response, 202, {
          ok: true,
          snapshot: nextState.snapshot,
          summary: nextState.summary,
        });
        return;
      }
      if (route === "/whereabouts/ingest" || route === "/healthz") {
        writeJson(response, 405, { ok: false, error: "method not allowed" });
        return;
      }
      writeJson(response, 404, { ok: false, error: "not found" });
    } catch (error) {
      const statusCode = error instanceof WhereaboutsHttpError ? error.statusCode : 400;
      const message = error instanceof Error ? error.message : String(error || "unknown error");
      writeJson(response, statusCode, { ok: false, error: message });
    }
  });
}

export async function listenWhereaboutsHttpServer(
  server: http.Server,
  {
    host,
    port,
  }: {
    host: string;
    port: number;
  },
): Promise<{
  baseUrl: string;
  close(): Promise<void>;
  host: string;
  port: number;
}> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("whereabouts server failed to bind to a TCP address.");
  }
  const actualHost = address.address === "::" ? "127.0.0.1" : address.address;
  return {
    baseUrl: `http://${actualHost}:${address.port}`,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    host: actualHost,
    port: address.port,
  };
}

class WhereaboutsHttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "WhereaboutsHttpError";
    this.statusCode = statusCode;
  }
}

async function readJsonBody(
  request: http.IncomingMessage,
  {
    maxBytes,
  }: {
    maxBytes: number;
  },
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new WhereaboutsHttpError(413, `whereabouts ingest 请求体过大，最大允许 ${maxBytes} 字节。`);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    throw new Error("请求体不能为空。");
  }
  return JSON.parse(raw);
}

function hasJsonContentType(request: http.IncomingMessage): boolean {
  return String(request.headers["content-type"] || "").trim().toLowerCase().startsWith("application/json");
}

function hasValidBearerToken(request: http.IncomingMessage, token: string): boolean {
  const header = String(request.headers.authorization || "").trim();
  return header === `Bearer ${token}`;
}

function normalizeRoute(requestUrl: string | undefined): string {
  return String(requestUrl || "").split("?")[0] || "/";
}

function writeJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}
