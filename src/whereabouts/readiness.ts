import * as fs from "node:fs";

import { normalizeText } from "../contracts/text-normalization";
import { normalizeWhereaboutsServerConfig, type WhereaboutsStateConfig } from "./contracts";
import { resolveWhereaboutsPaths } from "./store";

export interface WhereaboutsCapabilityReadiness {
  explicitlyConfigured: boolean;
  files: {
    eventsFile: string;
    placesFile: string;
    stateDir: string;
  };
  host: string;
  port: number;
  query: {
    available: boolean;
    reason: string;
  };
  serve: {
    available: boolean;
    reason: string;
  };
  tokenConfigured: boolean;
}

export interface WhereaboutsHostCheck {
  ok: boolean;
  path?: string;
  reason: string;
  required: boolean;
  status: "configured" | "missing" | "ok" | "optional" | "unconfigured";
}

export function collectWhereaboutsCapabilityReadiness(
  config: WhereaboutsStateConfig,
): WhereaboutsCapabilityReadiness {
  const stateDir = normalizeText(config.stateDir);
  if (!stateDir) {
    return {
      explicitlyConfigured: false,
      files: {
        eventsFile: "",
        placesFile: "",
        stateDir: "",
      },
      host: "",
      port: 0,
      query: {
        available: false,
        reason: "whereabouts 缺少 stateDir，本地查询面不可用。",
      },
      serve: {
        available: false,
        reason: "whereabouts 缺少 stateDir，无法启动本地 ingest server。",
      },
      tokenConfigured: false,
    };
  }

  const serverConfig = normalizeWhereaboutsServerConfig(config);
  const paths = resolveWhereaboutsPaths(config);
  const tokenConfigured = Boolean(serverConfig.token);
  const hasPlacesFile = fs.existsSync(paths.placesFile);
  const hasEventsFile = fs.existsSync(paths.eventsFile);
  const explicitlyConfigured = Boolean(
    normalizeText(config.whereaboutsHost)
    || normalizeText(config.whereaboutsPort)
    || normalizeText(config.whereaboutsPlacesFile)
    || normalizeText(config.whereaboutsRetentionDays)
    || tokenConfigured
    || hasPlacesFile
    || hasEventsFile
  );

  return {
    explicitlyConfigured,
    files: {
      eventsFile: paths.eventsFile,
      placesFile: paths.placesFile,
      stateDir: serverConfig.stateDir,
    },
    host: serverConfig.host,
    port: serverConfig.port,
    query: {
      available: true,
      reason: hasEventsFile
        ? "whereabouts 本地状态已存在，snapshot / summary 查询面可用。"
        : hasPlacesFile
        ? "whereabouts 已配置命名地点，snapshot / summary 查询面可用。"
        : "whereabouts 查询面可用；未命名地点时会回退成通用语义。",
    },
    serve: {
      available: tokenConfigured,
      reason: tokenConfigured
        ? `whereabouts ingest server 可绑定到 ${serverConfig.host}:${serverConfig.port}。`
        : explicitlyConfigured
        ? "whereabouts serve 缺少 token；请配置 CODEKSEI_WHEREABOUTS_TOKEN。"
        : "whereabouts serve 尚未启用；配置 CODEKSEI_WHEREABOUTS_TOKEN 后可开启本地 ingest server。",
    },
    tokenConfigured,
  };
}

export function buildWhereaboutsHostCheck(config: WhereaboutsStateConfig): WhereaboutsHostCheck {
  const readiness = collectWhereaboutsCapabilityReadiness(config);
  const stateDirPath = normalizeOptionalPath(readiness.files.stateDir);
  const placesFilePath = normalizeOptionalPath(readiness.files.placesFile);
  if (!readiness.query.available) {
    const check: WhereaboutsHostCheck = {
      ok: false,
      reason: readiness.query.reason,
      required: true,
      status: "missing",
    };
    if (stateDirPath) {
      check.path = stateDirPath;
    }
    return check;
  }
  if (!readiness.explicitlyConfigured) {
    const check: WhereaboutsHostCheck = {
      ok: true,
      reason: "whereabouts 未显式配置；查询面仍可按默认本地状态目录工作。",
      required: false,
      status: "optional",
    };
    if (placesFilePath) {
      check.path = placesFilePath;
    }
    return check;
  }
  const check: WhereaboutsHostCheck = {
    ok: readiness.serve.available,
    reason: readiness.serve.available
      ? "whereabouts query / serve readiness 已就绪。"
      : readiness.serve.reason,
    required: false,
    status: readiness.serve.available ? "configured" : "unconfigured",
  };
  if (placesFilePath) {
    check.path = placesFilePath;
  }
  return check;
}

export function buildWhereaboutsSmokeCheck(
  config: WhereaboutsStateConfig,
): {
  blocking: boolean;
  ok: boolean;
  reason: string;
} {
  const check = buildWhereaboutsHostCheck(config);
  return {
    blocking: check.required,
    ok: check.ok,
    reason: check.reason,
  };
}

function normalizeOptionalPath(value: string): string {
  return normalizeText(value);
}
