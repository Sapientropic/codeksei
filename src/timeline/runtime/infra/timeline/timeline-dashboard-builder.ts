import * as fs from "node:fs";
import * as path from "node:path";
import * as esbuild from "esbuild";

import type { TimelineDashboardData } from "../../contracts";
import { buildTimelineViews } from "./timeline-analytics";
import { loadTimelineSourceData } from "./timeline-source-data";
import type { TimelineStore } from "./timeline-store";

interface TimelineDashboardBuildInput {
  store: TimelineStore;
  siteDir: string;
  entryFile: string;
  cssFile: string;
}

async function buildTimelineDashboard({
  store,
  siteDir,
  entryFile,
  cssFile,
}: TimelineDashboardBuildInput): Promise<TimelineDashboardData> {
  const sourceData = loadTimelineSourceData({ store });
  const views = buildTimelineViews(sourceData.state, sourceData.meta);

  fs.mkdirSync(siteDir, { recursive: true });
  const assetsDir = path.join(siteDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  await esbuild.build({
    entryPoints: [entryFile],
    bundle: true,
    outfile: path.join(assetsDir, "dashboard.js"),
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    loader: {
      ".tsx": "tsx",
      ".ts": "ts",
      ".css": "css",
    },
    external: [],
    logLevel: "silent",
    target: ["chrome120", "safari17"],
  });

  const bundledCssPath = path.join(assetsDir, "dashboard.css");
  if (!fs.existsSync(bundledCssPath)) {
    fs.copyFileSync(cssFile, bundledCssPath);
  }

  fs.writeFileSync(
    path.join(siteDir, "dashboard-data.json"),
    JSON.stringify(views, null, 2),
    "utf8"
  );
  fs.writeFileSync(path.join(siteDir, "index.html"), buildIndexHtml(), "utf8");
  return views;
}

function buildIndexHtml(): string {
  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "<head>",
    "  <meta charset=\"utf-8\" />",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    "  <title>Codeksei Timeline</title>",
    "  <link rel=\"stylesheet\" href=\"./assets/dashboard.css\" />",
    "</head>",
    "<body>",
    "  <div id=\"root\"></div>",
    "  <script src=\"./assets/dashboard.js\"></script>",
    "</body>",
    "</html>",
  ].join("\n");
}

export {
  buildTimelineDashboard,
};
