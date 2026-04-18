/// <reference lib="dom" />

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { chromium, type Browser, type Page } from "playwright-core";
import { ignoreCleanupError } from "../../../../core/error-handling";
import {
  buildTimelineBrowserNotFoundMessage,
  resolveTimelineBrowserExecutablePath,
} from "./browser-paths";

import type {
  TimelineRangeKey,
  TimelineScreenshotOptions,
  TimelineScreenshotSelectionOptions,
} from "../../contracts";
import type { TimelineRuntimeConfig } from "../../../runtime-config";
import { closeTimelineSiteServer } from "../../infra/timeline/timeline-site-server";
import { buildTimelineSite } from "./build-dashboard";
import { startTimelineSiteServer } from "./serve-site";

const SCREENSHOT_SELECTOR_MAP: Record<string, string> = {
  main: ".page",
  page: ".page",
  "main-view": ".page",
  "主视图": ".page",
  "整页": ".page",
  timeline: ".screenshot-target-timeline",
  "时间轴": ".screenshot-target-timeline",
  analytics: ".screenshot-target-analytics",
  "分析区": ".screenshot-target-analytics",
  "类别明细趋势": ".screenshot-target-analytics",
  events: ".screenshot-target-events",
  "事件": ".screenshot-target-events",
  "事件列表": ".screenshot-target-events",
};

const SCREENSHOT_RANGE_MAP: Record<string, TimelineRangeKey> = {
  day: "day",
  daily: "day",
  "日": "day",
  "天": "day",
  week: "week",
  weekly: "week",
  "周": "week",
  month: "month",
  monthly: "month",
  "月": "month",
};

interface CaptureTimelineScreenshotResult {
  outputFile: string;
  selector: string;
  url: string;
  width: number;
  height: number;
}

type TimelineScreenshotInput = TimelineScreenshotSelectionOptions & {
  outputFile?: string;
  selector?: string;
  range?: string;
  date?: string;
  week?: string;
  month?: string;
  category?: string;
  subcategory?: string;
  detail?: string;
  width?: string | number;
  height?: string | number;
  sidePadding?: string | number;
};

interface TimelineItemMatch {
  id: string;
  label: string;
}

interface TimelineItemMatchAttributes {
  idAttribute: string;
  labelAttribute: string;
}

type TimelineSiteServerHandle = Awaited<ReturnType<typeof startTimelineSiteServer>>;

interface CaptureTimelineScreenshotDeps {
  applyScreenshotControls?: typeof applyScreenshotControls;
  buildTimelineSite?: typeof buildTimelineSite;
  closeTimelineSiteServer?: typeof closeTimelineSiteServer;
  launchBrowser?: (
    config: TimelineRuntimeConfig,
    resolveChromePath: typeof resolveChromeExecutablePath,
  ) => Promise<Browser>;
  resolveChromeExecutablePath?: typeof resolveChromeExecutablePath;
  startTimelineSiteServer?: typeof startTimelineSiteServer;
  waitForDashboardReady?: typeof waitForDashboardReady;
}

async function captureTimelineScreenshot(
  config: TimelineRuntimeConfig,
  options: TimelineScreenshotInput = {},
  deps: CaptureTimelineScreenshotDeps = {},
): Promise<CaptureTimelineScreenshotResult> {
  const buildSite = deps.buildTimelineSite || buildTimelineSite;
  const startSiteServer = deps.startTimelineSiteServer || startTimelineSiteServer;
  const stopSiteServer = deps.closeTimelineSiteServer || closeTimelineSiteServer;
  const waitUntilDashboardReady = deps.waitForDashboardReady || waitForDashboardReady;
  const applyControls = deps.applyScreenshotControls || applyScreenshotControls;
  const resolveChromePath = deps.resolveChromeExecutablePath || resolveChromeExecutablePath;
  const launchBrowser = deps.launchBrowser || (async (
    runtimeConfig: TimelineRuntimeConfig,
    resolveChromePathForRuntime: typeof resolveChromeExecutablePath,
  ) => chromium.launch({
    executablePath: resolveChromePathForRuntime(runtimeConfig),
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
    ],
  }));
  const screenshotOptions = resolveTimelineScreenshotOptions(config, options);
  fs.mkdirSync(path.dirname(screenshotOptions.outputFile), { recursive: true });

  await buildSite(config);

  let server: TimelineSiteServerHandle["server"] | null = null;
  let serverInfo: TimelineSiteServerHandle["info"] | null = null;
  let browser: Browser | null = null;
  try {
    const started = await startSiteServer(config, { port: 0 });
    server = started.server;
    serverInfo = started.info;

    browser = await launchBrowser(config, resolveChromePath);
    const page = await browser.newPage({
      viewport: { width: screenshotOptions.width, height: screenshotOptions.height },
      deviceScaleFactor: 2,
    });
    await page.goto(serverInfo.url, { waitUntil: "networkidle" });
    await page.emulateMedia({ colorScheme: "light" });
    await page.addStyleTag({
      content: buildPageScreenshotStyles(screenshotOptions.sidePadding),
    });
    await waitForDashboardShell(page);
    await applyControls(page, screenshotOptions);
    await waitUntilDashboardReady(page, screenshotOptions.selector);
    await page.locator(screenshotOptions.selector).screenshot({
      path: screenshotOptions.outputFile,
      type: "png",
      animations: "disabled",
    });

    return {
      outputFile: screenshotOptions.outputFile,
      selector: screenshotOptions.selector,
      url: serverInfo.url,
      width: screenshotOptions.width,
      height: screenshotOptions.height,
    };
  } finally {
    if (browser) {
      await ignoreCleanupError(browser.close(), {
        label: "timeline screenshot browser close",
        reason: "screenshot teardown should not fail after capture has already completed",
      });
    }
    if (server && serverInfo) {
      await stopSiteServer(server);
    }
  }
}

function resolveTimelineScreenshotOptions(
  config: TimelineRuntimeConfig,
  options: TimelineScreenshotInput = {},
): TimelineScreenshotOptions {
  const rangeSelection = resolveScreenshotRangeSelection(options);
  const detail = resolveSelectionText(options.detail || options.subcategory);
  const explicitSubcategory = resolveSelectionText(options.subcategory);
  if (detail && explicitSubcategory && detail !== explicitSubcategory) {
    throw new Error("screenshot 的 detail 和 subcategory 不能同时传不同值");
  }

  return {
    outputFile: resolveOutputFile(config, options.outputFile),
    selector: resolveScreenshotSelector(options.selector),
    width: parsePositiveInt(options.width, 1680),
    height: parsePositiveInt(options.height, 1400),
    sidePadding: parseNonNegativeInt(options.sidePadding, 32),
    range: rangeSelection.range,
    rangeValue: rangeSelection.value,
    date: rangeSelection.range === "day" ? rangeSelection.value : "",
    week: rangeSelection.range === "week" ? rangeSelection.value : "",
    month: rangeSelection.range === "month" ? rangeSelection.value : "",
    category: resolveSelectionText(options.category),
    subcategory: detail,
  };
}

function resolveScreenshotSelector(selector: string | undefined): string {
  const normalized = String(selector || "").trim();
  if (!normalized) {
    return ".page";
  }
  return SCREENSHOT_SELECTOR_MAP[normalized] || SCREENSHOT_SELECTOR_MAP[normalizeLookupValue(normalized)] || normalized;
}

function resolveOutputFile(config: TimelineRuntimeConfig, outputFile: string | undefined): string {
  const normalized = String(outputFile || "").trim();
  if (normalized) {
    return path.resolve(normalized);
  }
  const shotsDir = path.join(config.timelineDir, "shots");
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return path.join(shotsDir, `timeline-${stamp}.png`);
}

function parsePositiveInt(value: string | number | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string | number | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveScreenshotRangeSelection(
  options: TimelineScreenshotInput = {},
): { range: TimelineRangeKey | ""; value: string } {
  const explicitRange = resolveScreenshotRange(options.range);
  const date = resolveSelectionText(options.date);
  const week = resolveSelectionText(options.week);
  const month = resolveSelectionText(options.month);
  const provided = [date ? "day" : "", week ? "week" : "", month ? "month" : ""].filter(Boolean) as Array<TimelineRangeKey>;

  if (provided.length > 1) {
    throw new Error("screenshot 只能指定一种范围值：date、week、month 三选一");
  }

  const inferredRange = provided[0] || "";
  const range: TimelineRangeKey | "" = explicitRange || inferredRange || "";
  if (range === "day" && week) {
    throw new Error("range=day 时不能再传 week");
  }
  if (range === "day" && month) {
    throw new Error("range=day 时不能再传 month");
  }
  if (range === "week" && date) {
    throw new Error("range=week 时不能再传 date");
  }
  if (range === "week" && month) {
    throw new Error("range=week 时不能再传 month");
  }
  if (range === "month" && date) {
    throw new Error("range=month 时不能再传 date");
  }
  if (range === "month" && week) {
    throw new Error("range=month 时不能再传 week");
  }

  return {
    range,
    value: range === "day" ? date : range === "week" ? week : range === "month" ? month : "",
  };
}

function resolveScreenshotRange(range: string | undefined): TimelineRangeKey | "" {
  const normalized = normalizeLookupValue(range);
  if (!normalized) {
    return "";
  }
  return SCREENSHOT_RANGE_MAP[normalized] || "";
}

function resolveSelectionText(value: string | undefined): string {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function normalizeLookupValue(value: string | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function resolveChromeExecutablePath(config: TimelineRuntimeConfig): string {
  const playwrightManagedPath = resolvePlaywrightExecutablePath();
  try {
    return resolveTimelineBrowserExecutablePath({
      configuredPath: config.chromeExecutablePath,
      playwrightManagedPath,
    });
  } catch {
    throw new Error(buildTimelineBrowserNotFoundMessage());
  }
}

function resolvePlaywrightExecutablePath(): string {
  try {
    if (typeof chromium.executablePath !== "function") {
      return "";
    }
    return String(chromium.executablePath() || "").trim();
  } catch {
    return "";
  }
}

async function waitForDashboardReady(page: Page, selector: string = ".page"): Promise<void> {
  await waitForDashboardShell(page);
  await waitForTargetVisible(page, selector);
  const targetKind = resolveScreenshotTargetKind(selector);
  if (targetKind === "timeline") {
    await waitForTimelineSection(page);
    await page.waitForTimeout(1500);
    return;
  }
  if (targetKind === "events") {
    await waitForEventsSection(page);
    await page.waitForTimeout(1500);
    return;
  }
  if (targetKind === "analytics") {
    await waitForAnalyticsSection(page);
    await page.waitForTimeout(1500);
    return;
  }

  const hasTimeline = await page.locator(".timeline-canvas .vis-timeline").isVisible().catch(() => false);
  if (!hasTimeline) {
    await page.waitForFunction(() => {
      const emptyState = document.querySelector(".empty-state");
      const heroStats = document.querySelectorAll(".hero-stat-card").length;
      return !!emptyState || heroStats > 0;
    }, { timeout: 15_000 });
    await page.waitForTimeout(2400);
    return;
  }

  await waitForTimelineSection(page);
  await page.waitForTimeout(2000);
}

function resolveScreenshotTargetKind(selector: string): "timeline" | "events" | "analytics" | "page" {
  const normalized = String(selector || "").trim();
  if (normalized.includes("screenshot-target-timeline")) {
    return "timeline";
  }
  if (normalized.includes("screenshot-target-events")) {
    return "events";
  }
  if (normalized.includes("screenshot-target-analytics")) {
    return "analytics";
  }
  return "page";
}

async function waitForTargetVisible(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 15_000 });
}

async function waitForTimelineSection(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const timelineRoot = document.querySelector(".screenshot-target-timeline");
    if (!(timelineRoot instanceof HTMLElement)) {
      return false;
    }
    const timeline = timelineRoot.querySelector(".timeline-canvas .vis-timeline");
    if (timeline instanceof HTMLElement) {
      const rect = timeline.getBoundingClientRect();
      return rect.width > 40 && rect.height > 40;
    }
    const emptyState = timelineRoot.querySelector(".empty-state");
    if (emptyState instanceof HTMLElement) {
      const rect = emptyState.getBoundingClientRect();
      return rect.width > 40 && rect.height > 40;
    }
    return false;
  }, { timeout: 15_000 });
}

async function waitForEventsSection(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const eventsRoot = document.querySelector(".screenshot-target-events");
    if (!(eventsRoot instanceof HTMLElement)) {
      return false;
    }
    const cards = eventsRoot.querySelectorAll(".event-card");
    if (cards.length > 0) {
      return true;
    }
    const emptyState = eventsRoot.querySelector(".empty-state");
    if (emptyState instanceof HTMLElement) {
      const rect = emptyState.getBoundingClientRect();
      return rect.width > 40 && rect.height > 40;
    }
    return false;
  }, { timeout: 15_000 });
}

async function waitForAnalyticsSection(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.querySelector(".screenshot-target-analytics");
    if (!(root instanceof HTMLElement)) {
      return false;
    }
    const panels = Array.from(root.querySelectorAll(".panel"));
    if (panels.length < 3) {
      return false;
    }
    return panels.every((panel) => {
      if (!(panel instanceof HTMLElement)) {
        return false;
      }
      const emptyState = panel.querySelector(".empty-state");
      if (emptyState instanceof HTMLElement) {
        const rect = emptyState.getBoundingClientRect();
        return rect.width > 40 && rect.height > 20;
      }
      const svg = panel.querySelector(".recharts-responsive-container svg");
      if (!(svg instanceof SVGElement)) {
        return false;
      }
      const rect = svg.getBoundingClientRect();
      return rect.width > 40 && rect.height > 40;
    });
  }, { timeout: 15_000 });
}

async function waitForDashboardShell(page: Page): Promise<void> {
  await page.locator(".page").waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForFunction(async () => {
    if (!("fonts" in document) || !document.fonts || typeof document.fonts.ready?.then !== "function") {
      return true;
    }
    await document.fonts.ready;
    return true;
  }, { timeout: 15_000 });
}

async function applyScreenshotControls(page: Page, options: TimelineScreenshotOptions): Promise<void> {
  if (options.range) {
    await selectRangeTab(page, options.range);
  }
  if (options.rangeValue) {
    await selectRangeValue(page, options.rangeValue);
  }
  if (options.category) {
    await selectLegendItem(page, "category", options.category);
  }
  if (options.subcategory) {
    await selectSubcategoryItem(page, options.subcategory, options.category);
  }
}

async function selectRangeTab(page: Page, range: TimelineRangeKey): Promise<void> {
  const button = page.locator(`.tabbar button[data-range-id="${range}"]`).first();
  await button.waitFor({ state: "visible", timeout: 15_000 });
  const active = await button.evaluate((element: HTMLElement) => element.classList.contains("active")).catch(() => false);
  if (!active) {
    await button.click();
  }
  await page.waitForFunction((nextRange: string) => {
    const target = document.querySelector(`.tabbar button[data-range-id="${nextRange}"]`);
    return !!target && target.classList.contains("active");
  }, range, { timeout: 15_000 });
}

async function selectRangeValue(page: Page, requestedValue: string): Promise<void> {
  const trigger = page.locator('.range-select-trigger[data-range-trigger="true"]').first();
  await trigger.waitFor({ state: "visible", timeout: 15_000 });
  await trigger.click();
  const optionSelector = ".range-select-option";
  await page.locator(optionSelector).first().waitFor({ state: "visible", timeout: 15_000 });
  const match = await findMatchingItem(page, optionSelector, requestedValue, {
    idAttribute: "data-range-option-value",
    labelAttribute: "data-range-option-label",
  });
  if (!match) {
    throw new Error(`找不到时间范围选项: ${requestedValue}`);
  }
  await page.locator(`${optionSelector}[data-range-option-value="${match.id}"]`).first().click();
  await page.waitForFunction((expectedLabel: string) => {
    const valueNode = document.querySelector('.range-select-trigger[data-range-trigger="true"]');
    return !!valueNode && String(valueNode.textContent || "").includes(expectedLabel);
  }, match.label, { timeout: 15_000 });
}

async function selectLegendItem(page: Page, kind: "category" | "subcategory", requestedValue: string): Promise<void> {
  const selector = `.pie-legend-row[data-legend-kind="${kind}"]`;
  const match = await findMatchingItem(page, selector, requestedValue, {
    idAttribute: "data-legend-id",
    labelAttribute: "data-legend-label",
  });
  if (!match) {
    throw new Error(`找不到${kind === "category" ? "分类" : "明细"}项: ${requestedValue}`);
  }
  const target = page.locator(`${selector}[data-legend-id="${match.id}"]`).first();
  await target.waitFor({ state: "visible", timeout: 15_000 });
  await target.click();
  await page.waitForFunction((selection: string) => {
    const target = document.querySelector(selection);
    return !!target && target.classList.contains("active");
  }, `${selector}[data-legend-id="${match.id}"]`, { timeout: 15_000 });
}

async function selectSubcategoryItem(page: Page, requestedValue: string, categoryValue: string): Promise<void> {
  const selector = '.pie-legend-row[data-legend-kind="subcategory"]';
  let match = await findMatchingItem(page, selector, requestedValue, {
    idAttribute: "data-legend-id",
    labelAttribute: "data-legend-label",
  });

  if (!match && !categoryValue) {
    const categoryIds = await page.locator('.pie-legend-row[data-legend-kind="category"]').evaluateAll((elements: Element[]) =>
      elements.map((element: Element) => String(element.getAttribute("data-legend-id") || "").trim()).filter(Boolean)
    );
    for (const categoryId of categoryIds) {
      await selectLegendItem(page, "category", categoryId);
      match = await findMatchingItem(page, selector, requestedValue, {
        idAttribute: "data-legend-id",
        labelAttribute: "data-legend-label",
      });
      if (match) {
        break;
      }
    }
  }

  if (!match) {
    throw new Error(`找不到明细项: ${requestedValue}`);
  }

  const target = page.locator(`${selector}[data-legend-id="${match.id}"]`).first();
  await target.waitFor({ state: "visible", timeout: 15_000 });
  await target.click();
  await page.waitForFunction((selection: string) => {
    const target = document.querySelector(selection);
    return !!target && target.classList.contains("active");
  }, `${selector}[data-legend-id="${match.id}"]`, { timeout: 15_000 });
}

async function findMatchingItem(
  page: Page,
  selector: string,
  requestedValue: string,
  attributes: TimelineItemMatchAttributes,
): Promise<TimelineItemMatch | null> {
  const requested = normalizeLookupValue(requestedValue);
  if (!requested) {
    return null;
  }
  return page.locator(selector).evaluateAll((elements: Element[], payload: { requested: string; idAttribute: string; labelAttribute: string }) => {
    const normalize = (value: string) => String(value || "").trim().toLowerCase().replace(/\s+/g, "");
    const match = elements
      .map((element: Element) => ({
        id: String(element.getAttribute(payload.idAttribute) || "").trim(),
        label: String(element.getAttribute(payload.labelAttribute) || "").trim(),
      }))
      .find((item: TimelineItemMatch) => {
        const normalizedId = normalize(item.id);
        const normalizedLabel = normalize(item.label);
        return normalizedId === payload.requested || normalizedLabel === payload.requested;
      });
    return match || null;
  }, {
    requested,
    idAttribute: attributes.idAttribute,
    labelAttribute: attributes.labelAttribute,
  });
}

function buildPageScreenshotStyles(sidePadding: number): string {
  const horizontalPadding = `${sidePadding}px`;
  return [
    ".page {",
    `  width: min(1440px, calc(100vw - ${sidePadding * 2}px)) !important;`,
    `  padding-left: ${horizontalPadding} !important;`,
    `  padding-right: ${horizontalPadding} !important;`,
    `  padding-top: ${horizontalPadding} !important;`,
    `  padding-bottom: ${horizontalPadding} !important;`,
    "}",
  ].join("\n");
}

export {
  captureTimelineScreenshot,
  SCREENSHOT_SELECTOR_MAP,
  resolveTimelineScreenshotOptions,
};
