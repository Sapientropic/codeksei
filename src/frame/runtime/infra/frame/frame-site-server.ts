import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

import type { AppRuntimeConfig } from "../../../../core/app-service-contract";
import { buildZonedIsoString, formatDateInTimezone, normalizeTimezone } from "../../../../core/timezone";
import { normalizeText } from "../../../../contracts/text-normalization";
import { runDiaryWriteCommand } from "../../../../app/diary-write-cli";
import { buildFrameState } from "../../application/frame/state";
import type { FrameRuntimeConfig } from "../../../runtime-config";
import { ReminderQueueStore } from "../../../../state/reminder-queue-store";
import { CheckinScheduleStateStore } from "../../../../state/checkin-schedule-state-store";
import {
  runCheckinComplete,
  runCheckinTick,
  type CheckinResolvedTarget,
} from "../../../../checkin";
import type {
  CheckinActiveWake,
  CheckinCompletionResult,
  CheckinPendingTrigger,
  CheckinScheduleState,
} from "../../../../contracts/checkin-schedule-state";

type FrameServerRuntimeConfig = FrameRuntimeConfig & Partial<AppRuntimeConfig>;

interface FrameSiteServerInput {
  config: FrameServerRuntimeConfig;
}

type JsonObject = Record<string, unknown>;
type FrameReminderAction = "present" | "settle" | "snooze";
type FrameCheckinAction = "here" | "later" | "quiet_today" | "settle";

const FRAME_REMINDER_SNOOZE_MS = 30 * 60_000;
const FRAME_CHECKIN_LATER_SLEEP_FOR = "30m";

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
    await handleReminderAction(config, request, response);
    return;
  }
  if (method === "POST" && requestPath === "frame/checkin/action") {
    await handleCheckinAction(config, request, response);
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

async function handleReminderAction(
  config: FrameServerRuntimeConfig,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const queueFile = normalizeText(config.reminderQueueFile);
  if (!queueFile) {
    writeJson(response, 503, { ok: false, error: "frame reminder actions require reminderQueueFile" });
    return;
  }
  const body = await readJsonBody(request);
  const id = normalizeText(body.id);
  const action = normalizeReminderAction(body.action);
  if (!id || !action) {
    writeJson(response, 400, {
      ok: false,
      error: "reminder action requires id and action=present|settle|snooze",
    });
    return;
  }

  const queue = new ReminderQueueStore({ filePath: queueFile });
  if (action === "snooze") {
    const reminder = queue.rescheduleById(id, Date.now() + FRAME_REMINDER_SNOOZE_MS);
    if (!reminder) {
      writeJson(response, 404, { ok: false, error: `reminder not found: ${id}` });
      return;
    }
    writeJson(response, 200, {
      ok: true,
      data: {
        action,
        reminder,
        state: buildFrameState(config),
      },
    });
    return;
  }

  const removed = queue.removeById(id);
  if (!removed) {
    writeJson(response, 404, { ok: false, error: `reminder not found: ${id}` });
    return;
  }
  writeJson(response, 200, {
    ok: true,
    data: {
      action,
      removed,
      state: buildFrameState(config),
    },
  });
}

async function handleCheckinAction(
  config: FrameServerRuntimeConfig,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const stateFile = normalizeText(config.checkinScheduleStateFile);
  if (!stateFile) {
    writeJson(response, 503, { ok: false, error: "frame check-in actions require checkinScheduleStateFile" });
    return;
  }
  const checkinConfig = {
    ...config,
    checkinConfigFile: normalizeText(config.checkinConfigFile),
    checkinScheduleStateFile: stateFile,
  };
  const body = await readJsonBody(request);
  const action = normalizeCheckinAction(body.action);
  const requestedTriggerId = normalizeText(body.triggerId);
  if (!action) {
    writeJson(response, 400, {
      ok: false,
      error: "check-in action requires action=here|later|settle|quiet_today",
    });
    return;
  }

  const currentState = new CheckinScheduleStateStore({ filePath: stateFile }).getState();
  const current = resolveCurrentCheckinTrigger(currentState, requestedTriggerId);
  if (!current) {
    writeJson(response, 409, {
      ok: false,
      error: requestedTriggerId
        ? `check-in trigger is no longer active: ${requestedTriggerId}`
        : "check-in action requires a current pending or active trigger",
    });
    return;
  }

  const nowMs = Date.now();
  const target = buildFrameCheckinTarget(current.trigger);
  try {
    if (current.phase === "pending") {
      runCheckinTick({
        ack: current.trigger.triggerId,
        config: checkinConfig,
        nowMs,
        target,
      });
    }
    const completion = runCheckinComplete({
      config: checkinConfig,
      ...resolveFrameCheckinCompletion(action, config, nowMs),
      target,
      triggerId: current.trigger.triggerId,
    });
    writeJson(response, 200, {
      ok: true,
      data: {
        action,
        completion: completion.completion,
        nextWakeAt: completion.nextWakeAt,
        state: buildFrameState(config),
        target: completion.target,
      },
    });
  } catch (error) {
    writeJson(response, 409, {
      ok: false,
      error: error instanceof Error ? error.message : String(error || "unknown error"),
    });
  }
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

function normalizeReminderAction(value: unknown): FrameReminderAction | "" {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "present" || normalized === "settle" || normalized === "snooze" ? normalized : "";
}

function normalizeCheckinAction(value: unknown): FrameCheckinAction | "" {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "here" || normalized === "later" || normalized === "quiet_today" || normalized === "settle"
    ? normalized
    : "";
}

function resolveCurrentCheckinTrigger(
  state: CheckinScheduleState | null,
  requestedTriggerId: string,
): { phase: "active" | "pending"; trigger: CheckinActiveWake | CheckinPendingTrigger } | null {
  if (!state) {
    return null;
  }
  const candidates: Array<{ phase: "active" | "pending"; trigger: CheckinActiveWake | CheckinPendingTrigger }> = [];
  if (state.activeWake) {
    candidates.push({ phase: "active", trigger: state.activeWake });
  }
  if (state.pendingTrigger) {
    candidates.push({ phase: "pending", trigger: state.pendingTrigger });
  }
  if (!requestedTriggerId) {
    return candidates.length === 1 ? candidates[0] || null : null;
  }
  return candidates.find((candidate) => candidate.trigger.triggerId === requestedTriggerId) || null;
}

function buildFrameCheckinTarget(trigger: CheckinActiveWake | CheckinPendingTrigger): CheckinResolvedTarget {
  return {
    senderId: trigger.senderId,
    senderSource: "frame.checkinState",
    workspaceRoot: trigger.workspaceRoot,
    workspaceSource: "frame.checkinState",
  };
}

function resolveFrameCheckinCompletion(
  action: FrameCheckinAction,
  config: FrameServerRuntimeConfig,
  nowMs: number,
): {
  nextWakeAt?: string;
  result: CheckinCompletionResult;
  sleepFor?: string;
} {
  if (action === "later") {
    return {
      result: "silent",
      sleepFor: FRAME_CHECKIN_LATER_SLEEP_FOR,
    };
  }
  if (action === "quiet_today") {
    return {
      nextWakeAt: resolveTomorrowMorningWakeAt(config, nowMs),
      result: "silent",
    };
  }
  // A Frame click is a local foreground acknowledgement, not a delivered chat
  // message. Keep it out of sent_message so later review does not overstate
  // what the agent actually sent.
  return {
    result: "backstage_only",
  };
}

function resolveTomorrowMorningWakeAt(config: FrameServerRuntimeConfig, nowMs: number): string {
  const timezone = normalizeTimezone(config.timezone) || "Asia/Shanghai";
  const today = formatDateInTimezone(new Date(nowMs), timezone);
  const tomorrow = new Date(`${today}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);
  return buildZonedIsoString(tomorrowDate, "09:00:00", timezone);
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
