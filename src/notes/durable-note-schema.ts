import { normalizeText } from "../core/text-normalization";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  normalizeDurableNoteSchemaConfig,
  type NormalizedWorkspaceSchemaConfig,
} from "../contracts/config-files";
import { loadJsonConfig } from "../core/config-loader";
import { listTrackedProjects } from "../workspace/project-radar";
import {
  normalizeDisplayPath,
  resolveCrossPlatformPath,
  resolveCrossPlatformPathFromRoot,
} from "../core/path-utils";
import { writeForeignTextDocument } from "../state/json-state";
import { appendSection, findSectionRange, resolveNoteSyncTarget } from "./note-sync";

const DURABLE_NOTE_SCOPE_ALIASES = {
  assistant: "companion",
  "life-assistant": "companion",
  life_assistant: "companion",
  companion: "companion",
  inspiration: "inspiration",
};

interface DurableNoteConfig {
  allowedUserIds?: unknown;
  durableNoteSchemaConfigFile?: unknown;
  projectRadarConfigFile?: unknown;
  senderId?: unknown;
  stateDir?: unknown;
  workspaceRoot?: unknown;
}

interface DurableNoteInspectionOptions {
  kind?: unknown;
  project?: unknown;
  senderId?: unknown;
  scope?: unknown;
}

interface DurableNoteRouteDefinition {
  createIfMissing?: boolean;
  fileTitle?: string;
  maxItems: number;
  section: string;
  slot: string;
  style: string;
}

interface DurableNoteFamily {
  filePath: string;
  kinds: Record<string, DurableNoteRouteDefinition>;
  label?: string;
  sections: string[];
}

export interface ResolvedDurableNoteRoute extends DurableNoteRouteDefinition {
  family: string;
  filePath: string;
  kind: string;
  sections: string[];
}

export type DurableNoteRoutingInspection =
  | {
    mode: "overview";
    workspaceRoot: string;
    project: {
      availableProjects: string[];
      sections: string[];
      kinds: string[];
    };
    scopes: Record<string, { label: string; filePath: string; sections: string[]; kinds: string[] }>;
  }
  | {
    mode: "family";
    family: string;
    label: string;
    filePath: string;
    sections: string[];
    kinds: string[];
    project?: string;
    availableProjects?: string[];
  }
  | {
    mode: "route";
    family: string;
    label: string;
    filePath: string;
    sections: string[];
    kinds: string[];
    route: ResolvedDurableNoteRoute;
    project?: string;
    availableProjects?: string[];
  };

function loadDurableNoteSchemaConfig(config: DurableNoteConfig = {}): NormalizedWorkspaceSchemaConfig {
  const filePath = normalizeText(config.durableNoteSchemaConfigFile);
  if (!filePath) {
    return { workspaces: {} };
  }
  return loadJsonConfig<NormalizedWorkspaceSchemaConfig>({
    filePath,
    label: "durable note schema",
    normalize: normalizeDurableNoteSchemaConfig,
    fallback: { workspaces: {} },
    missing: "fallback",
    invalid: "throw",
  });
}

function resolveDurableNoteProfile(config: DurableNoteConfig = {}) {
  const workspaceRoot = resolveCrossPlatformPath(String(config.workspaceRoot || process.cwd()));
  const schemaConfig = loadDurableNoteSchemaConfig(config);
  const workspaceProfile = selectWorkspaceProfile(schemaConfig.workspaces, workspaceRoot);
  const projectDefaults = normalizeFamily(workspaceProfile?.projectDefaults);
  const notes = normalizeNamedFamilies(workspaceProfile?.notes);
  const fallbackCompanion = resolveFallbackCompanionFamily(config);
  if (!notes.companion && fallbackCompanion) {
    notes.companion = fallbackCompanion;
  }
  return {
    workspaceRoot,
    projectDefaults,
    notes,
  };
}

function inspectDurableNoteRouting(
  config: DurableNoteConfig = {},
  options: DurableNoteInspectionOptions = {},
): DurableNoteRoutingInspection {
  const profile = resolveDurableNoteProfile(config);
  const project = normalizeText(options.project);
  const scope = canonicalizeDurableNoteScope(options.scope);
  const kind = normalizeText(options.kind).toLowerCase();

  if (project) {
    const target = resolveNoteSyncTarget(config, { project });
    return buildInspectionResult({
      familyId: "project",
      familyLabel: "tracked-project",
      filePath: target.filePath,
      sections: profile.projectDefaults.sections,
      kinds: profile.projectDefaults.kinds,
      kind,
      extra: {
        project: target.label,
        availableProjects: listTrackedProjectsSafe(config).map((entry) => entry.slug),
      },
    });
  }

  if (scope) {
    const family = profile.notes[scope] as DurableNoteFamily | undefined;
    if (!family) {
      throw new Error(`找不到 durable note scope: ${scope}；当前可用 scope: ${listAvailableScopes(profile).join(", ") || "none"}`);
    }
    return buildInspectionResult({
      familyId: scope,
      familyLabel: family.label || scope,
      filePath: resolveWorkspaceNotePath(profile.workspaceRoot, family.filePath),
      sections: family.sections,
      kinds: family.kinds,
      kind,
      extra: {},
    });
  }

  return {
    mode: "overview",
    workspaceRoot: profile.workspaceRoot,
    project: {
      availableProjects: listTrackedProjectsSafe(config).map((entry) => entry.slug),
      sections: profile.projectDefaults.sections,
      kinds: Object.keys(profile.projectDefaults.kinds),
    },
    scopes: Object.fromEntries(
      Object.entries(profile.notes).map(([familyId, family]) => {
        const familyDefinition = family as DurableNoteFamily;
        return [
        familyId,
        {
          label: familyDefinition.label || familyId,
          filePath: resolveWorkspaceNotePath(profile.workspaceRoot, familyDefinition.filePath),
          sections: [...familyDefinition.sections],
          kinds: Object.keys(familyDefinition.kinds),
        },
      ];
      })
    ),
  };
}

function resolveDurableNoteRoute(
  config: DurableNoteConfig = {},
  options: DurableNoteInspectionOptions = {},
): ResolvedDurableNoteRoute {
  const inspection = inspectDurableNoteRouting(config, options);
  if (inspection.mode !== "route" || !("route" in inspection) || !inspection.route) {
    throw new Error("缺少完整 durable note 路由参数：至少传 --kind，并配合 --project 或 --scope");
  }
  return inspection.route;
}

function ensureDurableNoteSections(
  filePath: unknown,
  sections: unknown[] = [],
  {
    createIfMissing = false,
    fileTitle = "",
  }: {
    createIfMissing?: boolean;
    fileTitle?: unknown;
  } = {},
) {
  const normalizedPath = normalizeText(filePath);
  if (!normalizedPath) {
    throw new Error("durable note filePath 不能为空");
  }
  if (!fs.existsSync(normalizedPath)) {
    if (!createIfMissing) {
      throw new Error(`durable note 文件不存在: ${normalizedPath}`);
    }
    const title = normalizeText(fileTitle) || path.parse(normalizedPath).name;
    writeForeignTextDocument(normalizedPath, ensureTrailingNewline(`# ${title}\n`), { encoding: "utf8" });
  }
  const stat = fs.statSync(normalizedPath);
  if (!stat.isFile()) {
    throw new Error(`durable note 目标不是文件: ${normalizedPath}`);
  }

  let content = normalizeLineEnding(fs.readFileSync(normalizedPath, "utf8"));
  let changed = false;
  const createdSections = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const normalizedSection = normalizeText(section);
    if (!normalizedSection) {
      continue;
    }
    if (findSectionRange(content, normalizedSection)) {
      continue;
    }
    content = appendSection(content, normalizedSection);
    createdSections.push(normalizedSection);
    changed = true;
  }

  if (changed) {
    writeForeignTextDocument(normalizedPath, ensureTrailingNewline(content), { encoding: "utf8" });
  }
  return {
    changed,
    createdSections,
    filePath: normalizeDisplayPath(normalizedPath),
  };
}

function buildInspectionResult({
  familyId,
  familyLabel,
  filePath,
  sections,
  kinds,
  kind,
  extra,
}: {
  extra: Record<string, unknown>;
  familyId: string;
  familyLabel: string;
  filePath: string;
  kind: string;
  kinds: Record<string, { createIfMissing?: boolean; fileTitle?: string; maxItems: number; section: string; slot: string; style: string }>;
  sections: string[];
}): DurableNoteRoutingInspection {
  const availableKinds = Object.keys(kinds);
  if (!kind) {
    return {
      mode: "family",
      family: familyId,
      label: familyLabel,
      filePath,
      sections: [...sections],
      kinds: availableKinds,
      ...extra,
    };
  }

  const matchedKind = kinds[kind];
  if (!matchedKind) {
    throw new Error(`scope ${familyId} 不支持 kind: ${kind}；当前可用 kinds: ${availableKinds.join(", ") || "none"}`);
  }

  return {
    mode: "route",
    family: familyId,
    label: familyLabel,
    filePath,
    sections: [...sections],
    kinds: availableKinds,
    route: {
      createIfMissing: Boolean(matchedKind.createIfMissing),
      family: familyId,
      kind,
      filePath,
      fileTitle: normalizeText(matchedKind.fileTitle),
      section: matchedKind.section,
      style: matchedKind.style,
      slot: matchedKind.slot,
      maxItems: matchedKind.maxItems,
      sections: [...sections],
    },
    ...extra,
  };
}

function selectWorkspaceProfile(workspaces: unknown, workspaceRoot: string): Record<string, unknown> {
  if (!workspaces || typeof workspaces !== "object") {
    return {};
  }
  const normalizedWorkspaceRoot = normalizeDisplayPath(workspaceRoot);
  for (const [candidateRoot, profile] of Object.entries(workspaces)) {
    if (normalizeDisplayPath(candidateRoot) === normalizedWorkspaceRoot) {
      return profile && typeof profile === "object" ? profile : {};
    }
  }
  return {};
}

function normalizeNamedFamilies(rawFamilies: unknown) {
  if (!rawFamilies || typeof rawFamilies !== "object") {
    return {};
  }
  const families = new Map<string, { priority: number; value: DurableNoteFamily & { label: string } }>();

  for (const [familyId, rawFamily] of Object.entries(rawFamilies) as Array<[string, unknown]>) {
    const canonicalId = canonicalizeDurableNoteScope(familyId);
    const family = normalizeFamily(rawFamily);
    const familyRecord = rawFamily && typeof rawFamily === "object"
      ? rawFamily as Record<string, unknown>
      : {};
    if (!canonicalId || !family.filePath || !Object.keys(family.kinds).length) {
      continue;
    }

    const priority = canonicalId === normalizeText(familyId).toLowerCase() ? 2 : 1;
    const current = families.get(canonicalId);
    if (current && current.priority > priority) {
      continue;
    }

    families.set(canonicalId, {
      priority,
      value: {
        ...family,
        label: normalizeText(familyRecord.label) || canonicalId,
      },
    });
  }

  return Object.fromEntries(
    Array.from(families.entries()).map(([familyId, entry]) => [familyId, entry.value])
  );
}

function normalizeFamily(rawFamily: unknown) {
  const family = rawFamily && typeof rawFamily === "object"
    ? rawFamily as Record<string, unknown>
    : {};
  return {
    filePath: normalizeRelativeOrAbsolutePath(family.path),
    sections: normalizeSections(family.sections),
    kinds: normalizeKinds(family.kinds),
  };
}

function normalizeKinds(rawKinds: unknown) {
  if (!rawKinds || typeof rawKinds !== "object") {
    return {};
  }
  const entries: Array<[string, {
    createIfMissing?: boolean;
    fileTitle?: string;
    section: string;
    style: string;
    slot: string;
    maxItems: number;
  }]> = [];
  for (const [kind, rawRoute] of Object.entries(rawKinds)) {
    const normalizedKind = normalizeText(kind).toLowerCase();
    const route = normalizeRoute(rawRoute);
    if (!normalizedKind || !route) {
      continue;
    }
    entries.push([normalizedKind, route]);
  }
  return Object.fromEntries(entries);
}

function normalizeRoute(rawRoute: unknown) {
  const route = rawRoute && typeof rawRoute === "object"
    ? rawRoute as Record<string, unknown>
    : {};
  const section = normalizeText(route.section);
  if (!section) {
    return null;
  }
  return {
    createIfMissing: Boolean(route.createIfMissing),
    fileTitle: normalizeText(route.fileTitle),
    section,
    style: normalizeText(route.style).toLowerCase() === "paragraph" ? "paragraph" : "bullet",
    slot: normalizeText(route.slot),
    maxItems: normalizePositiveInteger(route.maxItems),
  };
}

function normalizeSections(rawSections: unknown): string[] {
  return Array.isArray(rawSections)
    ? rawSections.map((section: unknown) => normalizeText(section)).filter(Boolean)
    : [];
}

function normalizePositiveInteger(value: unknown): number {
  const raw = String(value || "").trim();
  if (!raw) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeRelativeOrAbsolutePath(targetPath: unknown): string {
  const normalized = normalizeText(targetPath);
  if (!normalized) {
    return "";
  }
  return normalized.replace(/\\/g, "/");
}

function resolveWorkspaceNotePath(workspaceRoot: unknown, targetPath: unknown): string {
  const normalizedTargetPath = normalizeText(targetPath);
  if (!normalizedTargetPath) {
    return "";
  }
  if (path.isAbsolute(normalizedTargetPath) || path.win32.isAbsolute(normalizedTargetPath)) {
    return resolveCrossPlatformPath(normalizedTargetPath);
  }
  return resolveCrossPlatformPathFromRoot(workspaceRoot, ...normalizedTargetPath.split("/"));
}

function listAvailableScopes(profile: { notes?: Record<string, unknown> }): string[] {
  return Object.keys(profile.notes || {});
}

function listTrackedProjectsSafe(config: DurableNoteConfig = {}) {
  try {
    return listTrackedProjects(config);
  } catch {
    return [];
  }
}

function resolveFallbackCompanionFamily(config: DurableNoteConfig = {}): (DurableNoteFamily & { label: string }) | null {
  const stateDir = normalizeText(config.stateDir);
  if (!stateDir) {
    return null;
  }
  const userKey = resolveFallbackCompanionUserKey(config);
  return {
    filePath: resolveCrossPlatformPathFromRoot(stateDir, "companions", userKey, "profile.md"),
    kinds: {
      status: {
        createIfMissing: true,
        fileTitle: "Codeksei Companion Profile",
        maxItems: 1,
        section: "当前定位",
        slot: "current-position",
        style: "paragraph",
      },
      pattern: {
        createIfMissing: true,
        fileTitle: "Codeksei Companion Profile",
        maxItems: 10,
        section: "协作节奏",
        slot: "",
        style: "bullet",
      },
      preference: {
        createIfMissing: true,
        fileTitle: "Codeksei Companion Profile",
        maxItems: 12,
        section: "支持偏好",
        slot: "",
        style: "bullet",
      },
      boundary: {
        createIfMissing: true,
        fileTitle: "Codeksei Companion Profile",
        maxItems: 12,
        section: "能力边界",
        slot: "",
        style: "bullet",
      },
      next: {
        createIfMissing: true,
        fileTitle: "Codeksei Companion Profile",
        maxItems: 8,
        section: "下一步",
        slot: "",
        style: "bullet",
      },
    },
    label: "Codeksei companion fallback",
    sections: ["当前定位", "协作节奏", "支持偏好", "能力边界", "下一步"],
  };
}

function resolveFallbackCompanionUserKey(config: DurableNoteConfig = {}): string {
  const explicitSender = normalizeText(config.senderId);
  if (explicitSender) {
    return sanitizePathSegment(explicitSender);
  }
  const allowedUserIds = Array.isArray(config.allowedUserIds)
    ? config.allowedUserIds.map((entry) => normalizeText(entry)).filter(Boolean)
    : [];
  const singleAllowedUser = allowedUserIds.length === 1 ? allowedUserIds[0] || "" : "";
  if (singleAllowedUser) {
    return sanitizePathSegment(singleAllowedUser);
  }
  return "default";
}

function sanitizePathSegment(value: string): string {
  return normalizeText(value).replace(/[\\/:*?"<>|]+/gu, "_") || "default";
}

function canonicalizeDurableNoteScope(value: unknown): string {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return "";
  }
  return DURABLE_NOTE_SCOPE_ALIASES[normalized as keyof typeof DURABLE_NOTE_SCOPE_ALIASES] || normalized;
}

function normalizeLineEnding(value: unknown): string {
  return String(value || "").replace(/\r\n/g, "\n");
}

function ensureTrailingNewline(value: unknown): string {
  const normalized = normalizeLineEnding(value);
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

export {
  canonicalizeDurableNoteScope,
  ensureDurableNoteSections,
  inspectDurableNoteRouting,
  loadDurableNoteSchemaConfig,
  resolveDurableNoteProfile,
  resolveDurableNoteRoute,
};

