import type { TimelineRuntimeConfig } from "../../../runtime-config";
import { createTimelineSiteServer, listenTimelineSiteServer } from "../../infra/timeline/timeline-site-server";

interface TimelineSiteServerOptions {
  port?: number;
}

async function startTimelineSiteServer(
  config: TimelineRuntimeConfig,
  options: TimelineSiteServerOptions = {},
) {
  const port = Number.isFinite(options.port) && Number(options.port) >= 0
    ? Number(options.port)
    : config.timelinePort;
  const server = createTimelineSiteServer({ siteDir: config.timelineSiteDir });
  const info = await listenTimelineSiteServer(server, { port });
  return { server, info };
}

export { startTimelineSiteServer };
