import type { AppRuntimeConfig } from "../../../../core/app-service-contract";
import { buildFrameSite } from "./build-site";
import { createFrameSiteServer, listenFrameSiteServer } from "../../infra/frame/frame-site-server";
import type { FrameRuntimeConfig } from "../../../runtime-config";

interface FrameSiteServerOptions {
  port?: number;
}

async function startFrameSiteServer(
  config: FrameRuntimeConfig & Partial<AppRuntimeConfig>,
  options: FrameSiteServerOptions = {},
) {
  buildFrameSite(config);
  const port = Number.isFinite(options.port) && Number(options.port) >= 0
    ? Number(options.port)
    : config.framePort;
  const server = createFrameSiteServer({ config });
  const info = await listenFrameSiteServer(server, { port });
  return { server, info };
}

export { startFrameSiteServer };
