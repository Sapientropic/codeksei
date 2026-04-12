const fs = require("fs");
const path = require("path");
const { normalizeDurableNoteSchemaConfig } = require("../contracts/config-files");
const { loadJsonConfig } = require("./config-loader");
const { writeForeignTextDocument } = require("./json-state");

const { listTrackedProjects } = require("./project-radar");
const { appendSection, findSectionRange, resolveNoteSyncTarget } = require("./note-sync");
const {
  normalizeDisplayPath,
  resolveCrossPlatformPath,
  resolveCrossPlatformPathFromRoot,
} = require("./path-utils");

const DURABLE_NOTE_SCOPE_ALIASES = {
  assistant: "companion",
  "life-assistant": "companion",
  life_assistant: "companion",
  companion: "companion",
  inspiration: "inspiration",
};

function loadDurableNoteSchemaConfig(config = {}) {
  const filePath = normalizeText(config.durableNoteSchemaConfigFile);
  if (!filePath) {
    return {};
  }
  return loadJsonConfig({
    filePath,
    label: "durable note schema",
    normalize: normalizeDurableNoteSchemaConfig,
    fallback: {},
    missing: "fallback",
    invalid: "throw",
  });
}

function resolveDurableNoteProfile(config = {}) {
  const workspaceRoot = resolveCrossPlatformPath(String(config.workspaceRoot || process.cwd()));
  const schemaConfig = loadDurableNoteSchemaConfig(config);
  const workspaceProfile = selectWorkspaceProfile(schemaConfig.workspaces, workspaceRoot);
  const projectDefaults = normalizeFamily(workspaceProfile?.projectDefaults);
  const notes = normalizeNamedFamilies(workspaceProfile?.notes);
  return {
    workspaceRoot,
    projectDefaults,
    notes,
  };
}

function inspectDurableNoteRouting(config = {}, options = {}) {
  const profile = resolveDurableNoteProfile(config);
  const project = normalizeText(options.project);
  const scope = canonicalizeDurableNoteScope(options.scope);
  const kind = normalizeText(options.kind).toLowerCase();

  if (project) {
    const target = resolveNoteSyncTarget(config, { project });
    return buildInspectionResult({
      mode: kind ? "route" : "family",
      familyId: "project",
      familyLabel: "tracked-project",
      filePath: target.filePath,
      sections: profile.projectDefaults.sections,
      kinds: profile.projectDefaults.kinds,
      kind,
      extra: {
        project: target.label,
        availableProjects: listTrackedProjects(config).map((entry) => entry.slug),
      },
    });
  }

  if (scope) {
    const family = profile.notes[scope];
    if (!family) {
      throw new Error(`找不到 durable note scope: ${scope}；当前可用 scope: ${listAvailableScopes(profile).join(", ") || "none"}`);
    }
    return buildInspectionResult({
      mode: kind ? "route" : "family",
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
      availableProjects: listTrackedProjects(config).map((entry) => entry.slug),
      sections: profile.projectDefaults.sections,
      kinds: Object.keys(profile.projectDefaults.kinds),
    },
    scopes: Object.fromEntries(
      Object.entries(profile.notes).map(([familyId, family]) => [
        familyId,
        {
          label: family.label || familyId,
          filePath: resolveWorkspaceNotePath(profile.workspaceRoot, family.filePath),
          sections: [...family.sections],
          kinds: Object.keys(family.kinds),
        },
      ])
    ),
  };
}

function resolveDurableNoteRoute(config = {}, options = {}) {
  const inspection = inspectDurableNoteRouting(config, options);
  if (inspection.mode !== "route") {
    throw new Error("缺少完整 durable note 路由参数：至少传 --kind，并配合 --project 或 --scope");
  }
  return inspection.route;
}

function ensureDurableNoteSections(filePath, sections = []) {
  const normalizedPath = normalizeText(filePath);
  if (!normalizedPath) {
    throw new Error("durable note filePath 不能为空");
  }
  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`durable note 文件不存在: ${normalizedPath}`);
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

function buildInspectionResult({ mode, familyId, familyLabel, filePath, sections, kinds, kind, extra }) {
  const availableKinds = Object.keys(kinds);
  if (!kind) {
    return {
      mode,
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
    mode,
    family: familyId,
    label: familyLabel,
    filePath,
    sections: [...sections],
    kinds: availableKinds,
    route: {
      family: familyId,
      kind,
      filePath,
      section: matchedKind.section,
      style: matchedKind.style,
      slot: matchedKind.slot,
      maxItems: matchedKind.maxItems,
      sections: [...sections],
    },
    ...extra,
  };
}

function selectWorkspaceProfile(workspaces, workspaceRoot) {
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

function normalizeNamedFamilies(rawFamilies) {
  if (!rawFamilies || typeof rawFamilies !== "object") {
    return {};
  }
  const families = new Map();

  for (const [familyId, rawFamily] of Object.entries(rawFamilies)) {
    const canonicalId = canonicalizeDurableNoteScope(familyId);
    const family = normalizeFamily(rawFamily);
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
        label: normalizeText(rawFamily?.label) || canonicalId,
      },
    });
  }

  return Object.fromEntries(
    Array.from(families.entries()).map(([familyId, entry]) => [familyId, entry.value])
  );
}

function normalizeFamily(rawFamily) {
  const family = rawFamily && typeof rawFamily === "object" ? rawFamily : {};
  return {
    filePath: normalizeRelativeOrAbsolutePath(family.path),
    sections: normalizeSections(family.sections),
    kinds: normalizeKinds(family.kinds),
  };
}

function normalizeKinds(rawKinds) {
  if (!rawKinds || typeof rawKinds !== "object") {
    return {};
  }
  const entries = Object.entries(rawKinds)
    .map(([kind, rawRoute]) => {
      const normalizedKind = normalizeText(kind).toLowerCase();
      const route = normalizeRoute(rawRoute);
      if (!normalizedKind || !route) {
        return null;
      }
      return [normalizedKind, route];
    })
    .filter(Boolean);
  return Object.fromEntries(entries);
}

function normalizeRoute(rawRoute) {
  const route = rawRoute && typeof rawRoute === "object" ? rawRoute : {};
  const section = normalizeText(route.section);
  if (!section) {
    return null;
  }
  return {
    section,
    style: normalizeText(route.style).toLowerCase() === "paragraph" ? "paragraph" : "bullet",
    slot: normalizeText(route.slot),
    maxItems: normalizePositiveInteger(route.maxItems),
  };
}

function normalizeSections(rawSections) {
  return Array.isArray(rawSections)
    ? rawSections.map((section) => normalizeText(section)).filter(Boolean)
    : [];
}

function normalizePositiveInteger(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeRelativeOrAbsolutePath(targetPath) {
  const normalized = normalizeText(targetPath);
  if (!normalized) {
    return "";
  }
  return normalized.replace(/\\/g, "/");
}

function resolveWorkspaceNotePath(workspaceRoot, targetPath) {
  const normalizedTargetPath = normalizeText(targetPath);
  if (!normalizedTargetPath) {
    return "";
  }
  if (path.isAbsolute(normalizedTargetPath) || path.win32.isAbsolute(normalizedTargetPath)) {
    return resolveCrossPlatformPath(normalizedTargetPath);
  }
  return resolveCrossPlatformPathFromRoot(workspaceRoot, ...normalizedTargetPath.split("/"));
}

function listAvailableScopes(profile) {
  return Object.keys(profile.notes || {});
}

function canonicalizeDurableNoteScope(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return "";
  }
  return DURABLE_NOTE_SCOPE_ALIASES[normalized] || normalized;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLineEnding(value) {
  return String(value || "").replace(/\r\n/g, "\n");
}

function ensureTrailingNewline(value) {
  const normalized = normalizeLineEnding(value);
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

module.exports = {
  canonicalizeDurableNoteScope,
  ensureDurableNoteSections,
  inspectDurableNoteRouting,
  loadDurableNoteSchemaConfig,
  resolveDurableNoteProfile,
  resolveDurableNoteRoute,
};
