import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

interface TimelineSiteServerInput {
  siteDir: string;
}

function createTimelineSiteServer({ siteDir }: TimelineSiteServerInput): http.Server {
  fs.mkdirSync(siteDir, { recursive: true });
  return http.createServer((request, response) => {
    const requestPath = normalizeRequestPath(request.url || "/");
    const filePath = path.resolve(siteDir, requestPath);
    const siteRoot = path.resolve(siteDir);
    const safePath = filePath.startsWith(siteRoot) ? filePath : path.join(siteRoot, "index.html");
    const resolvedPath = fs.existsSync(safePath) && fs.statSync(safePath).isFile()
      ? safePath
      : path.join(siteRoot, "index.html");
    if (!fs.existsSync(resolvedPath)) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("timeline site not built");
      return;
    }
    response.writeHead(200, { "content-type": detectMimeType(resolvedPath) });
    fs.createReadStream(resolvedPath).pipe(response);
  });
}

async function listenTimelineSiteServer(
  server: http.Server,
  { port }: { port: number },
): Promise<{ port: number; url: string }> {
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
  const address = server.address();
  const resolvedPort = typeof address === "object" && address ? address.port : port;
  return {
    port: resolvedPort,
    url: `http://127.0.0.1:${resolvedPort}`,
  };
}

function closeTimelineSiteServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function normalizeRequestPath(url: string): string {
  const pathname = String(url || "/").split("?")[0];
  if (!pathname || pathname === "/") {
    return "index.html";
  }
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
  return "text/html; charset=utf-8";
}

export {
  createTimelineSiteServer,
  listenTimelineSiteServer,
  closeTimelineSiteServer,
};
