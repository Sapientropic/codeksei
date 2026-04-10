const fs = require("fs");
const path = require("path");

const DEFAULT_BOOTSTRAP_PROFILE = Object.freeze({
  primaryFiles: [
    {
      path: "AGENTS.md",
      role: "workspace routing and boundary contract",
    },
    {
      path: "README.md",
      role: "workspace overview and operating instructions",
    },
    {
      path: "Home.md",
      role: "workspace home and current control page",
    },
    {
      path: ".codex/AGENT_GUIDE.md",
      role: "agent write/update rules for this workspace",
    },
  ],
  conditionalFiles: [
    {
      path: ".codex/timeline/README.md",
      role: "timeline write/read contract for this workspace",
      when: "timeline read/write/build/screenshot work",
    },
  ],
  recentFiles: [],
});

let workspaceBootstrapConfigCache = {
  filePath: "",
  mtimeMs: -1,
  value: {},
};

function buildWorkspaceContinuityInstructions(workspaceRoot, config = {}) {
  const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return "";
  }

  const profile = resolveWorkspaceBootstrapProfile(normalizedWorkspaceRoot, config);
  // Keep the bootstrap read set intentionally narrow and curated. This path is
  // supposed to rehydrate durable context for a thread, not silently turn a
  // workspace switch into a broad vault scan.
  const primaryFiles = collectExistingFiles(normalizedWorkspaceRoot, profile.primaryFiles);
  const recentFiles = collectRecentFiles(normalizedWorkspaceRoot, profile.recentFiles);
  const conditionalFiles = collectExistingFiles(normalizedWorkspaceRoot, profile.conditionalFiles);

  const primarySequence = primaryFiles.concat(recentFiles);
  if (!primarySequence.length && !conditionalFiles.length) {
    return "";
  }

  const lines = [
    "This workspace keeps durable continuity in local notes.",
    `Current workspace root: ${normalizedWorkspaceRoot}`,
  ];

  if (primarySequence.length) {
    lines.push(
      "Before your first substantive reply in this workspace, recover context from these files in order:"
    );
    for (const [index, file] of primarySequence.entries()) {
      lines.push(`${index + 1}. ${file.absolutePath} - ${file.role}`);
    }
  }

  for (const group of groupConditionalFiles(conditionalFiles)) {
    lines.push("");
    lines.push(`If the current user request touches ${group.when}, also read:`);
    for (const file of group.files) {
      lines.push(`- ${file.absolutePath} - ${file.role}`);
    }
  }

  lines.push("");
  lines.push("Use AGENTS / Home / workspace README as durable truth.");
  if (recentFiles.length) {
    lines.push("Treat any auto-discovered recent note only as recent context, not as a permanent rulebook.");
  }
  lines.push("Do not paste these file paths or summarize them back unless the user explicitly asks.");
  return lines.join("\n").trim();
}

function resolveWorkspaceBootstrapProfile(workspaceRoot, config = {}) {
  const externalConfig = loadWorkspaceBootstrapConfig(config);
  const externalDefaults = externalConfig.defaults || externalConfig.default || {};
  const baseProfile = mergeProfiles(DEFAULT_BOOTSTRAP_PROFILE, externalDefaults);
  const workspaceOverrides = selectWorkspaceOverrides(externalConfig.workspaces, workspaceRoot);
  return mergeProfiles(baseProfile, workspaceOverrides || {});
}

function loadWorkspaceBootstrapConfig(config = {}) {
  const filePath = normalizeText(config.workspaceBootstrapConfigFile);
  if (!filePath) {
    return {};
  }
  let stats = null;
  try {
    stats = fs.statSync(filePath);
  } catch {
    workspaceBootstrapConfigCache = {
      filePath: "",
      mtimeMs: -1,
      value: {},
    };
    return {};
  }

  if (!stats.isFile()) {
    return {};
  }

  const normalizedPath = normalizeDisplayPath(filePath);
  if (
    workspaceBootstrapConfigCache.filePath === normalizedPath
    && workspaceBootstrapConfigCache.mtimeMs === stats.mtimeMs
  ) {
    return workspaceBootstrapConfigCache.value;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const value = parsed && typeof parsed === "object" ? parsed : {};
    workspaceBootstrapConfigCache = {
      filePath: normalizedPath,
      mtimeMs: stats.mtimeMs,
      value,
    };
    return value;
  } catch {
    workspaceBootstrapConfigCache = {
      filePath: normalizedPath,
      mtimeMs: stats.mtimeMs,
      value: {},
    };
    return {};
  }
}

function selectWorkspaceOverrides(workspaces, workspaceRoot) {
  if (!workspaces || typeof workspaces !== "object") {
    return null;
  }
  const normalizedWorkspaceRoot = normalizeDisplayPath(workspaceRoot);
  for (const [candidateRoot, profile] of Object.entries(workspaces)) {
    if (normalizeDisplayPath(candidateRoot) === normalizedWorkspaceRoot) {
      return profile;
    }
  }
  return null;
}

function mergeProfiles(baseProfile, overrideProfile) {
  const override = overrideProfile && typeof overrideProfile === "object" ? overrideProfile : {};
  return {
    primaryFiles: hasOwn(override, "primaryFiles")
      ? normalizeFileCandidates(override.primaryFiles)
      : normalizeFileCandidates(baseProfile.primaryFiles),
    conditionalFiles: hasOwn(override, "conditionalFiles")
      ? normalizeFileCandidates(override.conditionalFiles)
      : normalizeFileCandidates(baseProfile.conditionalFiles),
    recentFiles: hasOwn(override, "recentFiles")
      ? normalizeRecentFileSpecs(override.recentFiles)
      : normalizeRecentFileSpecs(baseProfile.recentFiles),
  };
}

function normalizeFileCandidates(rawCandidates) {
  const candidates = Array.isArray(rawCandidates) ? rawCandidates : [];
  return candidates
    .map((candidate) => normalizeFileCandidate(candidate))
    .filter(Boolean);
}

function normalizeFileCandidate(rawCandidate) {
  const candidate = rawCandidate && typeof rawCandidate === "object" ? rawCandidate : {};
  const relativePath = normalizeRelativePath(candidate.path || candidate.relativePath);
  if (!relativePath) {
    return null;
  }
  return {
    relativePath,
    role: normalizeText(candidate.role) || "workspace entry file",
    when: normalizeText(candidate.when),
  };
}

function normalizeRecentFileSpecs(rawSpecs) {
  const specs = Array.isArray(rawSpecs) ? rawSpecs : [];
  return specs
    .map((spec) => normalizeRecentFileSpec(spec))
    .filter(Boolean);
}

function normalizeRecentFileSpec(rawSpec) {
  const spec = rawSpec && typeof rawSpec === "object" ? rawSpec : {};
  const directory = normalizeRelativePath(spec.directory);
  const patternText = normalizeText(spec.pattern);
  if (!directory || !patternText) {
    return null;
  }
  let pattern = null;
  try {
    pattern = new RegExp(patternText);
  } catch {
    return null;
  }
  const maxCount = Math.max(1, Number.parseInt(spec.maxCount, 10) || 1);
  return {
    directory,
    pattern,
    role: normalizeText(spec.role) || "newest workspace note",
    maxCount,
  };
}

function collectExistingFiles(workspaceRoot, candidates) {
  const normalizedCandidates = Array.isArray(candidates) ? candidates : [];
  const files = [];
  for (const candidate of normalizedCandidates) {
    const relativePath = normalizeRelativePath(candidate?.relativePath);
    if (!relativePath) {
      continue;
    }
    const absolutePath = path.join(workspaceRoot, ...relativePath.split("/"));
    if (!isReadableFile(absolutePath)) {
      continue;
    }
    files.push({
      absolutePath: normalizeDisplayPath(absolutePath),
      role: normalizeText(candidate?.role) || "workspace entry file",
      when: normalizeText(candidate?.when),
    });
  }
  return files;
}

function collectRecentFiles(workspaceRoot, specs) {
  const normalizedSpecs = Array.isArray(specs) ? specs : [];
  const files = [];
  for (const spec of normalizedSpecs) {
    const directoryPath = path.join(workspaceRoot, ...String(spec.directory || "").split("/"));
    if (!isReadableDirectory(directoryPath)) {
      continue;
    }
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && spec.pattern.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))
      .slice(0, spec.maxCount);
    for (const entryName of entries) {
      files.push({
        absolutePath: normalizeDisplayPath(path.join(directoryPath, entryName)),
        role: spec.role,
      });
    }
  }
  return files;
}

function groupConditionalFiles(files) {
  const groups = [];
  const byWhen = new Map();
  for (const file of Array.isArray(files) ? files : []) {
    const when = normalizeText(file.when);
    if (!when) {
      continue;
    }
    if (!byWhen.has(when)) {
      byWhen.set(when, []);
      groups.push({
        when,
        files: byWhen.get(when),
      });
    }
    byWhen.get(when).push(file);
  }
  return groups;
}

function isReadableFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isReadableDirectory(directoryPath) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function normalizeWorkspaceRoot(workspaceRoot) {
  const normalized = normalizeText(workspaceRoot);
  if (!normalized) {
    return "";
  }
  return normalizeDisplayPath(normalized);
}

function normalizeRelativePath(value) {
  if (Array.isArray(value)) {
    return value
      .map((segment) => normalizeText(segment))
      .filter(Boolean)
      .join("/");
  }
  return normalizeText(value)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function normalizeDisplayPath(targetPath) {
  return normalizeText(targetPath).replace(/\\/g, "/");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

module.exports = {
  buildWorkspaceContinuityInstructions,
};
