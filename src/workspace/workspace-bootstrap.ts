const fs = require("fs");
const path = require("path");
const { normalizeWorkspaceBootstrapConfig } = require("../contracts/config-files");
const { loadJsonConfig } = require("../core/config-loader");

const DEFAULT_BOOTSTRAP_PROFILE = Object.freeze({
  primaryFiles: [
    {
      path: "AGENTS.md",
      role: "workspace routing and boundary contract",
    },
    {
      path: "AGENTS.local.md",
      role: "private operator overlay for this workspace",
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
    {
      path: ".codex/AGENT_GUIDE.local.md",
      role: "private agent write/update overlay for this workspace",
    },
  ],
  conditionalFiles: [
    {
      path: ".codex/timeline/README.md",
      role: "timeline write/read contract for this workspace",
      when: "timeline read/write/build/screenshot work, or cutover/closeout bookkeeping that may append timeline facts/events",
    },
  ],
  recentFiles: [],
});

function buildWorkspaceContinuityInstructions(workspaceRoot: any, config: any = {}) {
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

  const primarySequence = [...primaryFiles, ...recentFiles];
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

function resolveWorkspaceBootstrapProfile(workspaceRoot: any, config: any = {}) {
  const externalConfig = loadWorkspaceBootstrapConfig(config);
  const externalDefaults = externalConfig.defaults || externalConfig.default || {};
  const baseProfile = mergeProfiles(DEFAULT_BOOTSTRAP_PROFILE, externalDefaults);
  const workspaceOverrides = selectWorkspaceOverrides(externalConfig.workspaces, workspaceRoot);
  return mergeProfiles(baseProfile, workspaceOverrides || {});
}

function loadWorkspaceBootstrapConfig(config: any = {}) {
  const filePath = normalizeText(config.workspaceBootstrapConfigFile);
  if (!filePath) {
    return {};
  }
  return loadJsonConfig({
    filePath,
    label: "workspace bootstrap",
    normalize: normalizeWorkspaceBootstrapConfig,
    fallback: {},
    missing: "fallback",
    invalid: "fallback",
  });
}

function selectWorkspaceOverrides(workspaces: any, workspaceRoot: any) {
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

function mergeProfiles(baseProfile: any, overrideProfile: any) {
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

function normalizeFileCandidates(rawCandidates: any) {
  const candidates = Array.isArray(rawCandidates) ? rawCandidates : [];
  return candidates
    .map((candidate: any) => normalizeFileCandidate(candidate))
    .filter(Boolean);
}

function normalizeFileCandidate(rawCandidate: any) {
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

function normalizeRecentFileSpecs(rawSpecs: any) {
  const specs = Array.isArray(rawSpecs) ? rawSpecs : [];
  return specs
    .map((spec: any) => normalizeRecentFileSpec(spec))
    .filter(Boolean);
}

function normalizeRecentFileSpec(rawSpec: any) {
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

function collectExistingFiles(workspaceRoot: any, candidates: any) {
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

function collectRecentFiles(workspaceRoot: any, specs: any) {
  const normalizedSpecs = Array.isArray(specs) ? specs : [];
  const files = [];
  for (const spec of normalizedSpecs) {
    const directoryPath = path.join(workspaceRoot, ...String(spec.directory || "").split("/"));
    if (!isReadableDirectory(directoryPath)) {
      continue;
    }
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry: any) => entry.isFile() && spec.pattern.test(entry.name))
      .map((entry: any) => entry.name)
      .sort((left: any, right: any) => right.localeCompare(left))
      .slice(0, spec.maxCount);
    for (const entryName of entries) {
      files.push({
        absolutePath: normalizeDisplayPath(path.join(directoryPath, entryName)),
        role: spec.role,
        when: "",
      });
    }
  }
  return files;
}

function groupConditionalFiles(files: any) {
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

function isReadableFile(filePath: any) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isReadableDirectory(directoryPath: any) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function normalizeWorkspaceRoot(workspaceRoot: any) {
  const normalized = normalizeText(workspaceRoot);
  if (!normalized) {
    return "";
  }
  return normalizeDisplayPath(normalized);
}

function normalizeRelativePath(value: any) {
  if (Array.isArray(value)) {
    return value
      .map((segment: any) => normalizeText(segment))
      .filter(Boolean)
      .join("/");
  }
  return normalizeText(value)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function normalizeDisplayPath(targetPath: any) {
  return normalizeText(targetPath).replace(/\\/g, "/");
}

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

function hasOwn(value: any, key: any) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

module.exports = {
  buildWorkspaceContinuityInstructions,
};

export {};
