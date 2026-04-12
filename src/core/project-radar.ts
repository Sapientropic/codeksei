const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { normalizeProjectRadarConfig } = require("../contracts/config-files");
const { loadJsonConfig } = require("./config-loader");
const {
  normalizeDisplayPath,
  resolveCrossPlatformPath,
  resolveCrossPlatformPathFromRoot,
} = require("./path-utils");

function loadProjectRadarConfig(config: any = {}) {
  const workspaceRoot = resolveCrossPlatformPath(String(config.workspaceRoot || process.cwd()));
  const configFile = resolveCrossPlatformPath(String(
    config.projectRadarConfigFile || path.join(workspaceRoot, ".codex", "code-projects.json")
  ));
  const parsed = loadJsonConfig({
    filePath: configFile,
    label: "project radar config",
    normalize: normalizeProjectRadarConfig,
    missing: "throw",
    invalid: "throw",
  });

  const projects = Array.isArray(parsed?.projects)
    ? parsed.projects
      .map((entry: any) => normalizeProjectEntry(entry, workspaceRoot))
      .filter(Boolean)
    : [];
  if (!projects.length) {
    throw new Error(`代码项目配置里没有可用 projects: ${configFile}`);
  }

  return {
    workspaceRoot,
    configFile,
    projects,
  };
}

function listTrackedProjects(config: any = {}) {
  const radarConfig = loadProjectRadarConfig(config);
  return radarConfig.projects.map((project: any) => ({
    slug: project.slug,
    title: project.title,
    aliases: [...project.aliases],
    repoRoot: project.repoRoot,
    notePath: project.noteAbsolutePath,
    timelineLabel: project.timelineLabel,
  }));
}

function collectProjectRadars(config: any = {}, options: any = {}) {
  const radarConfig = loadProjectRadarConfig(config);
  const selectedProjects = selectProjects(radarConfig.projects, options.project);
  return {
    generatedAt: new Date().toISOString(),
    workspaceRoot: radarConfig.workspaceRoot,
    configFile: radarConfig.configFile,
    projects: selectedProjects.map((project: any) => collectSingleProjectRadar(project, options)),
  };
}

function selectProjects(projects: any, selectedProject: any) {
  const normalizedSelectedProject = normalizeText(selectedProject).toLowerCase();
  if (!normalizedSelectedProject) {
    return projects;
  }
  const matched = projects.filter((project: any) => matchesProjectSelector(project, normalizedSelectedProject));
  if (matched.length) {
    return matched;
  }
  const available = projects.map((project: any) => project.slug).join(", ");
  throw new Error(`找不到代码项目: ${selectedProject}；当前可用 slug: ${available}`);
}

function matchesProjectSelector(project: any, selector: any) {
  if (project.slug.toLowerCase() === selector) {
    return true;
  }
  if (project.title.toLowerCase() === selector) {
    return true;
  }
  return project.aliases.some((alias: any) => alias.toLowerCase() === selector);
}

function collectSingleProjectRadar(project: any, options: any = {}) {
  const commitLimit = clampPositiveInteger(options.commits, 5);
  const changeLimit = clampPositiveInteger(options.changes, 20);
  const overviewFiles = project.overviewFiles.map((relativePath: any) => buildWorkspaceFileInfo(project.repoRoot, relativePath, "overview"));
  const graphReport = project.graphReportPath
    ? buildWorkspaceFileInfo(project.repoRoot, project.graphReportPath, "graph")
    : null;
  const readFirst = [
    project.noteAbsolutePath ? {
      kind: "workspace-note",
      path: project.noteAbsolutePath,
      exists: isReadableFile(project.noteAbsolutePath),
    } : null,
    ...overviewFiles.filter((file: any) => file.exists),
    graphReport?.exists ? graphReport : null,
  ].filter(Boolean);

  const repoExists = isReadableDirectory(project.repoRoot);
  const repoFacts = repoExists ? collectGitFacts(project.repoRoot, { commitLimit, changeLimit }) : buildMissingRepoFacts(project.repoRoot);

  return {
    slug: project.slug,
    title: project.title,
    repoRoot: project.repoRoot,
    notePath: project.noteAbsolutePath,
    timelineLabel: project.timelineLabel,
    readFirst,
    overviewFiles,
    graphReport,
    git: repoFacts,
  };
}

function collectGitFacts(repoRoot: any, { commitLimit, changeLimit }: any) {
  const repoCheck = runGit(repoRoot, ["rev-parse", "--show-toplevel"]);
  if (!repoCheck.ok) {
    return {
      ok: false,
      reason: "not-a-git-repo",
      message: repoCheck.stderr || `不是 git 仓库: ${repoRoot}`,
      branch: "",
      upstream: "",
      ahead: 0,
      behind: 0,
      dirty: false,
      summary: {
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
        total: 0,
      },
      statusEntries: [],
      recentCommits: [],
    };
  }

  const branch = resolveBranchName(repoRoot);
  const upstream = resolveUpstreamName(repoRoot);
  const aheadBehind = resolveAheadBehind(repoRoot, upstream);
  const statusResult = runGit(repoRoot, ["status", "--short", "--untracked-files=all"]);
  const allStatusEntries = parseStatusEntries(statusResult.stdout);
  const statusEntries = allStatusEntries.slice(0, changeLimit);
  const statusSummary = summarizeStatusEntries(allStatusEntries);
  const recentCommits = parseRecentCommits(runGit(repoRoot, [
    "log",
    "--date=iso-strict",
    "--pretty=format:%H%x09%cI%x09%s",
    "-n",
    String(commitLimit),
  ]).stdout);

  return {
    ok: true,
    reason: "",
    message: "",
    branch,
    upstream,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    dirty: statusSummary.total > 0,
    summary: statusSummary,
    statusEntries,
    recentCommits,
  };
}

function buildMissingRepoFacts(repoRoot: any) {
  return {
    ok: false,
    reason: "missing-repo",
    message: `仓库目录不存在: ${repoRoot}`,
    branch: "",
    upstream: "",
    ahead: 0,
    behind: 0,
    dirty: false,
    summary: {
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      total: 0,
    },
    statusEntries: [],
    recentCommits: [],
  };
}

function buildWorkspaceFileInfo(root: any, relativePath: any, kind: any) {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const absolutePath = normalizedRelativePath
    ? resolveCrossPlatformPathFromRoot(root, ...normalizedRelativePath.split("/"))
    : "";
  return {
    kind,
    relativePath: normalizedRelativePath,
    path: absolutePath,
    exists: isReadableFile(absolutePath),
  };
}

function normalizeProjectEntry(entry: any, workspaceRoot: any) {
  const project = entry && typeof entry === "object" ? entry : {};
  const slug = normalizeText(project.slug);
  const repoRoot = normalizeText(project.repoRoot);
  const notePath = normalizeRelativePath(project.notePath);
  if (!slug || !repoRoot || !notePath) {
    return null;
  }
  return {
    slug,
    title: normalizeText(project.title) || slug,
    aliases: normalizeAliases(project.aliases),
    repoRoot: resolveCrossPlatformPath(repoRoot),
    notePath,
    noteAbsolutePath: resolveCrossPlatformPathFromRoot(workspaceRoot, ...notePath.split("/")),
    overviewFiles: normalizeRelativePathList(project.overviewFiles),
    graphReportPath: normalizeRelativePath(project.graphReportPath),
    timelineLabel: normalizeText(project.timelineLabel),
  };
}

function normalizeAliases(rawAliases: any) {
  return Array.isArray(rawAliases)
    ? rawAliases.map((alias: any) => normalizeText(alias)).filter(Boolean)
    : [];
}

function normalizeRelativePathList(rawPaths: any) {
  return Array.isArray(rawPaths)
    ? rawPaths.map((value: any) => normalizeRelativePath(value)).filter(Boolean)
    : [];
}

function resolveBranchName(repoRoot: any) {
  const symbolic = runGit(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (symbolic.ok && normalizeText(symbolic.stdout)) {
    return normalizeText(symbolic.stdout);
  }
  const detached = runGit(repoRoot, ["rev-parse", "--short", "HEAD"]);
  if (detached.ok && normalizeText(detached.stdout)) {
    return `(detached ${normalizeText(detached.stdout)})`;
  }
  return "";
}

function resolveUpstreamName(repoRoot: any) {
  const upstream = runGit(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  return upstream.ok ? normalizeText(upstream.stdout) : "";
}

function resolveAheadBehind(repoRoot: any, upstream: any) {
  if (!normalizeText(upstream)) {
    return { ahead: 0, behind: 0 };
  }
  const counts = runGit(repoRoot, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
  if (!counts.ok) {
    return { ahead: 0, behind: 0 };
  }
  const [behindText, aheadText] = normalizeText(counts.stdout).split(/\s+/);
  return {
    ahead: Number.parseInt(aheadText, 10) || 0,
    behind: Number.parseInt(behindText, 10) || 0,
  };
}

function parseStatusEntries(stdout: any) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line: any) => line.trimEnd())
    .filter(Boolean)
    .map((line: any) => {
      const code = line.slice(0, 2);
      const filePath = line.slice(3).trim();
      return {
        code,
        path: filePath,
      };
    });
}

function summarizeStatusEntries(entries: any) {
  const summary = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    total: Array.isArray(entries) ? entries.length : 0,
  };
  for (const entry of Array.isArray(entries) ? entries : []) {
    const code = String(entry.code || "");
    if (code === "??") {
      summary.untracked += 1;
      continue;
    }
    if (/[U]/.test(code) || code === "AA" || code === "DD") {
      summary.conflicted += 1;
    }
    if (code[0] && code[0] !== " ") {
      summary.staged += 1;
    }
    if (code[1] && code[1] !== " ") {
      summary.unstaged += 1;
    }
  }
  return summary;
}

function parseRecentCommits(stdout: any) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line: any) => line.trim())
    .filter(Boolean)
    .map((line: any) => {
      const [hash, committedAt, subject] = line.split("\t");
      return {
        hash: normalizeText(hash),
        shortHash: normalizeText(hash).slice(0, 7),
        committedAt: normalizeText(committedAt),
        subject: normalizeText(subject),
      };
    });
}

function runGit(repoRoot: any, args: any) {
  const result = spawnSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: normalizeCommandStdout(result.stdout),
    stderr: normalizeCommandStderr(result.stderr || result.error?.message || ""),
  };
}

function clampPositiveInteger(value: any, fallback: any) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeRelativePath(value: any) {
  return normalizeText(value)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function isReadableDirectory(directoryPath: any) {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function isReadableFile(filePath: any) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function normalizeCommandStdout(value: any) {
  return String(value || "").replace(/\r\n/g, "\n").trimEnd();
}

function normalizeCommandStderr(value: any) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function normalizeText(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

function formatErrorMessage(error: any) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

module.exports = {
  collectProjectRadars,
  listTrackedProjects,
  loadProjectRadarConfig,
};

export {};
