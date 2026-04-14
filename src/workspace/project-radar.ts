import { normalizeText } from "../contracts/text-normalization";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  normalizeProjectRadarConfig,
  type NormalizedProjectRadarConfig,
} from "../contracts/config-files";
import { loadJsonConfig } from "../core/config-loader";
import {
  normalizeDisplayPath,
  resolveCrossPlatformPath,
  resolveCrossPlatformPathFromRoot,
} from "../core/path-utils";
import { captureSubprocess } from "../core/subprocess-capture";

interface ProjectRadarConfigInput {
  ghCommand?: unknown;
  projectRadarConfigFile?: unknown;
  workspaceRoot?: unknown;
}

interface ProjectRadarOptions {
  changes?: unknown;
  commits?: unknown;
  project?: unknown;
}

interface TrackedProject {
  aliases: string[];
  githubRepo: string;
  graphReportPath: string;
  noteAbsolutePath: string;
  notePath: string;
  overviewFiles: string[];
  repoRoot: string;
  slug: string;
  timelineLabel: string;
  title: string;
}

interface GitCommandResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
}

interface GithubActivityDiagnostics {
  candidates: string[];
  code: string;
  message: string;
}

interface GithubActivityEventSummary {
  createdAt: string;
  description: string;
  repo: string;
  signal: "create" | "pull_request" | "push";
  type: "CreateEvent" | "PullRequestEvent" | "PushEvent";
  url: string;
}

interface GithubActivityFacts {
  diagnostics: GithubActivityDiagnostics;
  latestEvent: GithubActivityEventSummary | null;
  matchedBy: "" | "alias" | "githubRepo" | "repo_basename" | "slug" | "title";
  matchedRepo: string;
  source: "github_activity";
  status: "ambiguous" | "api_error" | "gh_auth_failed" | "gh_unavailable" | "matched" | "no_match" | "not_needed";
  usedAsFallback: boolean;
}

interface GithubRecentEvent {
  createdAt: string;
  description: string;
  repo: string;
  signal: "create" | "pull_request" | "push";
  signalRank: number;
  type: "CreateEvent" | "PullRequestEvent" | "PushEvent";
  url: string;
}

interface GithubRecentEventsResult {
  diagnostics: GithubActivityDiagnostics;
  events: GithubRecentEvent[];
  login: string;
  status: "api_error" | "gh_auth_failed" | "gh_unavailable" | "ok";
}

interface GithubActivityProvider {
  getRecentEvents(): GithubRecentEventsResult;
}

function loadProjectRadarConfig(config: ProjectRadarConfigInput = {}) {
  const workspaceRoot = resolveCrossPlatformPath(String(config.workspaceRoot || process.cwd()));
  const configFile = resolveCrossPlatformPath(String(
    config.projectRadarConfigFile || path.join(workspaceRoot, ".codex", "code-projects.json")
  ));
  const parsed = loadJsonConfig<NormalizedProjectRadarConfig>({
    filePath: configFile,
    label: "project radar config",
    normalize: normalizeProjectRadarConfig,
    missing: "throw",
    invalid: "throw",
  });

  const projects = Array.isArray(parsed?.projects)
    ? parsed.projects
      .map((entry: unknown) => normalizeProjectEntry(entry, workspaceRoot))
      .filter((project): project is TrackedProject => Boolean(project))
    : [];
  if (!projects.length) {
    throw new Error(`代码项目配置里没有可用 projects: ${configFile}`);
  }

  return {
    configFile,
    projects,
    workspaceRoot,
  };
}

function listTrackedProjects(config: ProjectRadarConfigInput = {}) {
  const radarConfig = loadProjectRadarConfig(config);
  return radarConfig.projects.map((project: TrackedProject) => ({
    aliases: [...project.aliases],
    githubRepo: project.githubRepo,
    notePath: project.noteAbsolutePath,
    repoRoot: project.repoRoot,
    slug: project.slug,
    timelineLabel: project.timelineLabel,
    title: project.title,
  }));
}

function collectProjectRadars(config: ProjectRadarConfigInput = {}, options: ProjectRadarOptions = {}) {
  const radarConfig = loadProjectRadarConfig(config);
  const selectedProjects = selectProjects(radarConfig.projects, options.project);
  const githubActivityProvider = createGithubActivityProvider({
    command: normalizeText(config.ghCommand) || "gh",
    cwd: radarConfig.workspaceRoot,
  });

  return {
    configFile: radarConfig.configFile,
    generatedAt: new Date().toISOString(),
    projects: selectedProjects.map((project: TrackedProject) => collectSingleProjectRadar(project, options, githubActivityProvider)),
    workspaceRoot: radarConfig.workspaceRoot,
  };
}

function selectProjects(projects: TrackedProject[], selectedProject: unknown): TrackedProject[] {
  const normalizedSelectedProject = normalizeText(selectedProject).toLowerCase();
  if (!normalizedSelectedProject) {
    return projects;
  }
  const matched = projects.filter((project) => matchesProjectSelector(project, normalizedSelectedProject));
  if (matched.length) {
    return matched;
  }
  const available = projects.map((project) => project.slug).join(", ");
  throw new Error(`找不到代码项目: ${selectedProject}；当前可用 slug: ${available}`);
}

function matchesProjectSelector(project: TrackedProject, selector: unknown): boolean {
  if (project.slug.toLowerCase() === selector) {
    return true;
  }
  if (project.title.toLowerCase() === selector) {
    return true;
  }
  return project.aliases.some((alias) => alias.toLowerCase() === selector);
}

function collectSingleProjectRadar(
  project: TrackedProject,
  options: ProjectRadarOptions,
  githubActivityProvider: GithubActivityProvider,
) {
  const commitLimit = clampPositiveInteger(options.commits, 5);
  const changeLimit = clampPositiveInteger(options.changes, 20);
  const overviewFiles = project.overviewFiles.map((relativePath) => buildWorkspaceFileInfo(project.repoRoot, relativePath, "overview"));
  const graphReport = project.graphReportPath
    ? buildWorkspaceFileInfo(project.repoRoot, project.graphReportPath, "graph")
    : null;
  const readFirst = [
    project.noteAbsolutePath ? {
      exists: isReadableFile(project.noteAbsolutePath),
      kind: "workspace-note",
      path: project.noteAbsolutePath,
    } : null,
    ...overviewFiles.filter((file) => file.exists),
    graphReport?.exists ? graphReport : null,
  ].filter(Boolean);

  const repoExists = isReadableDirectory(project.repoRoot);
  const git = repoExists ? collectGitFacts(project.repoRoot, { commitLimit, changeLimit }) : buildMissingRepoFacts(project.repoRoot);
  const githubActivity = collectGithubActivity(project, git, githubActivityProvider);

  return {
    git,
    githubActivity,
    graphReport,
    githubRepo: project.githubRepo,
    notePath: project.noteAbsolutePath,
    overviewFiles,
    readFirst,
    repoRoot: project.repoRoot,
    slug: project.slug,
    timelineLabel: project.timelineLabel,
    title: project.title,
  };
}

function collectGitFacts(repoRoot: string, { commitLimit, changeLimit }: { changeLimit: number; commitLimit: number }) {
  const repoCheck = runGit(repoRoot, ["rev-parse", "--show-toplevel"]);
  if (!repoCheck.ok) {
    return {
      ahead: 0,
      behind: 0,
      branch: "",
      dirty: false,
      message: repoCheck.stderr || `不是 git 仓库: ${repoRoot}`,
      ok: false,
      reason: "not-a-git-repo",
      recentCommits: [],
      statusEntries: [],
      summary: {
        conflicted: 0,
        staged: 0,
        total: 0,
        unstaged: 0,
        untracked: 0,
      },
      upstream: "",
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
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    branch,
    dirty: statusSummary.total > 0,
    message: "",
    ok: true,
    reason: "",
    recentCommits,
    statusEntries,
    summary: statusSummary,
    upstream,
  };
}

function buildMissingRepoFacts(repoRoot: string) {
  return {
    ahead: 0,
    behind: 0,
    branch: "",
    dirty: false,
    message: `仓库目录不存在: ${repoRoot}`,
    ok: false,
    reason: "missing-repo",
    recentCommits: [],
    statusEntries: [],
    summary: {
      conflicted: 0,
      staged: 0,
      total: 0,
      unstaged: 0,
      untracked: 0,
    },
    upstream: "",
  };
}

function collectGithubActivity(
  project: TrackedProject,
  git: { ok: boolean; reason: string },
  githubActivityProvider: GithubActivityProvider,
): GithubActivityFacts {
  if (git.ok) {
    return buildGithubActivityFacts({
      diagnostics: { candidates: [], code: "", message: "" },
      latestEvent: null,
      matchedBy: "",
      matchedRepo: "",
      status: "not_needed",
      usedAsFallback: false,
    });
  }

  const recentEvents = githubActivityProvider.getRecentEvents();
  if (recentEvents.status !== "ok") {
    return buildGithubActivityFacts({
      diagnostics: recentEvents.diagnostics,
      latestEvent: null,
      matchedBy: "",
      matchedRepo: "",
      status: recentEvents.status,
      usedAsFallback: false,
    });
  }

  if (project.githubRepo) {
    const matched = recentEvents.events.find((event) => event.repo.toLowerCase() === project.githubRepo);
    if (!matched) {
      return buildGithubActivityFacts({
        diagnostics: {
          candidates: collectDistinctRepos(recentEvents.events),
          code: "explicit_repo_not_seen",
          message: `最近活动里没有看到 ${project.githubRepo}。`,
        },
        latestEvent: null,
        matchedBy: "githubRepo",
        matchedRepo: project.githubRepo,
        status: "no_match",
        usedAsFallback: false,
      });
    }
    return buildGithubActivityFacts({
      diagnostics: { candidates: [], code: "", message: "" },
      latestEvent: summarizeGithubEvent(matched),
      matchedBy: "githubRepo",
      matchedRepo: matched.repo,
      status: "matched",
      usedAsFallback: true,
    });
  }

  const candidates = rankGithubRepoCandidates(project, recentEvents.events);
  if (!candidates.length) {
    return buildGithubActivityFacts({
      diagnostics: {
        candidates: [],
        code: "no_match",
        message: "最近活动里没有找到和当前项目可安全匹配的 GitHub 仓库。",
      },
      latestEvent: null,
      matchedBy: "",
      matchedRepo: "",
      status: "no_match",
      usedAsFallback: false,
    });
  }

  const topScore = candidates[0]?.score || 0;
  const topCandidates = candidates.filter((candidate) => candidate.score === topScore);
  if (topCandidates.length > 1) {
    return buildGithubActivityFacts({
      diagnostics: {
        candidates: topCandidates.map((candidate) => candidate.repo),
        code: "ambiguous",
        message: "最近活动里命中了多个同分仓库，无法安全判断当前项目线落在哪个 GitHub repo 上。",
      },
      latestEvent: null,
      matchedBy: "",
      matchedRepo: "",
      status: "ambiguous",
      usedAsFallback: false,
    });
  }

  const matched = topCandidates[0];
  return buildGithubActivityFacts({
    diagnostics: { candidates: [], code: "", message: "" },
    latestEvent: summarizeGithubEvent(matched?.event || null),
    matchedBy: matched?.matchedBy || "",
    matchedRepo: matched?.repo || "",
    status: "matched",
    usedAsFallback: true,
  });
}

function buildGithubActivityFacts({
  diagnostics,
  latestEvent,
  matchedBy,
  matchedRepo,
  status,
  usedAsFallback,
}: {
  diagnostics: GithubActivityDiagnostics;
  latestEvent: GithubActivityEventSummary | null;
  matchedBy: GithubActivityFacts["matchedBy"];
  matchedRepo: string;
  status: GithubActivityFacts["status"];
  usedAsFallback: boolean;
}): GithubActivityFacts {
  return {
    diagnostics,
    latestEvent,
    matchedBy,
    matchedRepo,
    source: "github_activity",
    status,
    usedAsFallback,
  };
}

function createGithubActivityProvider({
  command,
  cwd,
}: {
  command: string;
  cwd: string;
}): GithubActivityProvider {
  let cached: GithubRecentEventsResult | null = null;
  return {
    getRecentEvents(): GithubRecentEventsResult {
      if (!cached) {
        cached = loadGithubRecentEvents({ command, cwd });
      }
      return cached;
    },
  };
}

function loadGithubRecentEvents({
  command,
  cwd,
}: {
  command: string;
  cwd: string;
}): GithubRecentEventsResult {
  const loginResult = captureSubprocess(command, ["api", "user", "--jq", ".login"], {
    cwd,
    timeoutMs: 30_000,
  });
  if (!loginResult.ok) {
    return {
      diagnostics: classifyGithubCommandFailure(loginResult.stderr || loginResult.error, command),
      events: [],
      login: "",
      status: classifyGithubCommandStatus(loginResult.stderr || loginResult.error),
    };
  }

  const login = normalizeText(loginResult.stdout);
  if (!login) {
    return {
      diagnostics: {
        candidates: [],
        code: "empty_login",
        message: "gh 已执行成功，但没有返回当前登录用户。",
      },
      events: [],
      login: "",
      status: "api_error",
    };
  }

  const eventsResult = captureSubprocess(command, ["api", `/users/${login}/events?per_page=100`], {
    cwd,
    timeoutMs: 30_000,
  });
  if (!eventsResult.ok) {
    return {
      diagnostics: classifyGithubCommandFailure(eventsResult.stderr || eventsResult.error, command),
      events: [],
      login,
      status: classifyGithubCommandStatus(eventsResult.stderr || eventsResult.error),
    };
  }

  try {
    const parsed = JSON.parse(eventsResult.stdout);
    return {
      diagnostics: { candidates: [], code: "", message: "" },
      events: normalizeGithubRecentEvents(parsed),
      login,
      status: "ok",
    };
  } catch (error) {
    return {
      diagnostics: {
        candidates: [],
        code: "invalid_json",
        message: `gh events 输出不是合法 JSON：${formatErrorMessage(error)}`,
      },
      events: [],
      login,
      status: "api_error",
    };
  }
}

function classifyGithubCommandFailure(message: unknown, command: string): GithubActivityDiagnostics {
  const normalized = normalizeText(message).toLowerCase();
  if (!normalized) {
    return {
      candidates: [],
      code: "unknown_error",
      message: `无法通过 ${command} 读取 GitHub activity。`,
    };
  }
  if (normalized.includes("not logged into any github hosts") || normalized.includes("authentication")) {
    return {
      candidates: [],
      code: "gh_auth_failed",
      message: "gh 当前未登录，无法读取 GitHub activity fallback。",
    };
  }
  if (
    normalized.includes("not recognized")
    || normalized.includes("no such file")
    || normalized.includes("enoent")
    || normalized.includes("could not find")
  ) {
    return {
      candidates: [],
      code: "gh_unavailable",
      message: "本机找不到 gh，无法读取 GitHub activity fallback。",
    };
  }
  return {
    candidates: [],
    code: "api_error",
    message: normalizeText(message),
  };
}

function classifyGithubCommandStatus(message: unknown): GithubRecentEventsResult["status"] {
  const normalized = normalizeText(message).toLowerCase();
  if (!normalized) {
    return "api_error";
  }
  if (normalized.includes("not logged into any github hosts") || normalized.includes("authentication")) {
    return "gh_auth_failed";
  }
  if (
    normalized.includes("not recognized")
    || normalized.includes("no such file")
    || normalized.includes("enoent")
    || normalized.includes("could not find")
  ) {
    return "gh_unavailable";
  }
  return "api_error";
}

function normalizeGithubRecentEvents(value: unknown): GithubRecentEvent[] {
  return Array.isArray(value)
    ? value
      .map((entry) => normalizeGithubRecentEvent(entry))
      .filter((event): event is GithubRecentEvent => Boolean(event))
    : [];
}

function normalizeGithubRecentEvent(value: unknown): GithubRecentEvent | null {
  const event = isPlainObject(value) ? value : null;
  if (!event) {
    return null;
  }

  const type = normalizeText(event.type) as GithubRecentEvent["type"] | "";
  const repoName = normalizeGithubRepoName((isPlainObject(event.repo) ? event.repo.name : "") || "");
  const createdAt = normalizeIsoTime(event.created_at);
  if (!repoName || !createdAt || (type !== "PushEvent" && type !== "PullRequestEvent" && type !== "CreateEvent")) {
    return null;
  }

  const payload = isPlainObject(event.payload) ? event.payload : {};
  if (type === "PushEvent") {
    const branchName = normalizeGithubRefName(payload.ref);
    const commitCount = clampPositiveInteger(payload.size, 0);
    return {
      createdAt,
      description: `push ${commitCount || 0} commit(s) to ${branchName || "(unknown ref)"}`,
      repo: repoName,
      signal: "push",
      signalRank: 3,
      type,
      url: buildGithubRepoUrl(repoName),
    };
  }
  if (type === "PullRequestEvent") {
    const pullRequest = isPlainObject(payload.pull_request) ? payload.pull_request : {};
    const prNumber = clampPositiveInteger(pullRequest.number || payload.number, 0);
    const action = normalizeText(payload.action) || "updated";
    return {
      createdAt,
      description: `${action} PR #${prNumber || "?"}`,
      repo: repoName,
      signal: "pull_request",
      signalRank: 2,
      type,
      url: normalizeText(pullRequest.html_url) || buildGithubRepoUrl(repoName),
    };
  }

  const refType = normalizeText(payload.ref_type) || "ref";
  const refName = normalizeText(payload.ref) || "(unnamed)";
  return {
    createdAt,
    description: `created ${refType} ${refName}`,
    repo: repoName,
    signal: "create",
    signalRank: 1,
    type: "CreateEvent",
    url: buildGithubRepoUrl(repoName),
  };
}

function rankGithubRepoCandidates(project: TrackedProject, events: GithubRecentEvent[]) {
  const candidates = new Map<string, {
    event: GithubRecentEvent;
    matchedBy: Exclude<GithubActivityFacts["matchedBy"], "" | "githubRepo">;
    repo: string;
    score: number;
  }>();

  for (const event of events) {
    const score = scoreProjectAgainstGithubRepo(project, event.repo);
    if (!score) {
      continue;
    }
    const existing = candidates.get(event.repo);
    if (
      !existing
      || score.score > existing.score
      || (score.score === existing.score && eventIsNewer(event, existing.event))
    ) {
      candidates.set(event.repo, {
        event,
        matchedBy: score.matchedBy,
        repo: event.repo,
        score: score.score,
      });
    }
  }

  return [...candidates.values()].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    const timeDelta = Date.parse(right.event.createdAt) - Date.parse(left.event.createdAt);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.repo.localeCompare(right.repo);
  });
}

function scoreProjectAgainstGithubRepo(
  project: TrackedProject,
  repo: string,
): {
  matchedBy: Exclude<GithubActivityFacts["matchedBy"], "" | "githubRepo">;
  score: number;
} | null {
  const repoLower = repo.toLowerCase();
  const repoBaseLower = getGithubRepoBasename(repoLower);
  const repoMatchText = normalizeGithubMatchText(repo);
  const repoBaseMatchText = normalizeGithubMatchText(repoBaseLower);

  const slug = normalizeText(project.slug).toLowerCase();
  if (slug && repoBaseLower === slug) {
    return { matchedBy: "slug", score: 96 };
  }

  const aliasMatch = project.aliases
    .map((alias) => normalizeText(alias).toLowerCase())
    .find((alias) => alias && (repoLower === alias || repoBaseLower === alias));
  if (aliasMatch) {
    return { matchedBy: "alias", score: aliasMatch.includes("/") ? 95 : 94 };
  }

  const titleMatchText = normalizeGithubMatchText(project.title);
  if (titleMatchText && (repoBaseMatchText === titleMatchText || repoMatchText === titleMatchText)) {
    return { matchedBy: "title", score: 88 };
  }

  const repoBasename = normalizeGithubMatchText(path.basename(project.repoRoot));
  if (repoBasename && (repoBaseMatchText === repoBasename || repoMatchText === repoBasename)) {
    return { matchedBy: "repo_basename", score: 82 };
  }

  return null;
}

function eventIsNewer(left: GithubRecentEvent, right: GithubRecentEvent): boolean {
  return Date.parse(left.createdAt) > Date.parse(right.createdAt);
}

function summarizeGithubEvent(event: GithubRecentEvent | null): GithubActivityEventSummary | null {
  if (!event) {
    return null;
  }
  return {
    createdAt: event.createdAt,
    description: event.description,
    repo: event.repo,
    signal: event.signal,
    type: event.type,
    url: event.url,
  };
}

function collectDistinctRepos(events: GithubRecentEvent[]): string[] {
  return [...new Set(events.map((event) => event.repo))];
}

function buildWorkspaceFileInfo(root: string, relativePath: unknown, kind: string) {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const absolutePath = normalizedRelativePath
    ? resolveCrossPlatformPathFromRoot(root, ...normalizedRelativePath.split("/"))
    : "";
  return {
    exists: isReadableFile(absolutePath),
    kind,
    path: absolutePath,
    relativePath: normalizedRelativePath,
  };
}

function normalizeProjectEntry(entry: unknown, workspaceRoot: string): TrackedProject | null {
  const project = entry && typeof entry === "object"
    ? entry as Record<string, unknown>
    : {};
  const slug = normalizeText(project.slug);
  const repoRoot = normalizeText(project.repoRoot);
  const notePath = normalizeRelativePath(project.notePath);
  if (!slug || !repoRoot || !notePath) {
    return null;
  }
  return {
    aliases: normalizeAliases(project.aliases),
    githubRepo: normalizeGithubRepoName(project.githubRepo),
    graphReportPath: normalizeRelativePath(project.graphReportPath),
    noteAbsolutePath: resolveCrossPlatformPathFromRoot(workspaceRoot, ...notePath.split("/")),
    notePath,
    overviewFiles: normalizeRelativePathList(project.overviewFiles),
    repoRoot: resolveCrossPlatformPath(repoRoot),
    slug,
    timelineLabel: normalizeText(project.timelineLabel),
    title: normalizeText(project.title) || slug,
  };
}

function normalizeAliases(rawAliases: unknown): string[] {
  return Array.isArray(rawAliases)
    ? rawAliases.map((alias: unknown) => normalizeText(alias)).filter(Boolean)
    : [];
}

function normalizeRelativePathList(rawPaths: unknown): string[] {
  return Array.isArray(rawPaths)
    ? rawPaths.map((value: unknown) => normalizeRelativePath(value)).filter(Boolean)
    : [];
}

function resolveBranchName(repoRoot: string): string {
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

function resolveUpstreamName(repoRoot: string): string {
  const upstream = runGit(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  return upstream.ok ? normalizeText(upstream.stdout) : "";
}

function resolveAheadBehind(repoRoot: string, upstream: unknown): { ahead: number; behind: number } {
  if (!normalizeText(upstream)) {
    return { ahead: 0, behind: 0 };
  }
  const counts = runGit(repoRoot, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]);
  if (!counts.ok) {
    return { ahead: 0, behind: 0 };
  }
  const [behindText, aheadText] = normalizeText(counts.stdout).split(/\s+/);
  return {
    ahead: Number.parseInt(aheadText || "", 10) || 0,
    behind: Number.parseInt(behindText || "", 10) || 0,
  };
}

function parseStatusEntries(stdout: unknown) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line: string) => line.trimEnd())
    .filter(Boolean)
    .map((line: string) => {
      const code = line.slice(0, 2);
      const filePath = line.slice(3).trim();
      return {
        code,
        path: filePath,
      };
    });
}

function summarizeStatusEntries(entries: Array<{ code: string; path: string }> | unknown) {
  const summary = {
    conflicted: 0,
    staged: 0,
    total: Array.isArray(entries) ? entries.length : 0,
    unstaged: 0,
    untracked: 0,
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

function parseRecentCommits(stdout: unknown) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line: string) => line.trim())
    .filter(Boolean)
    .map((line: string) => {
      const [hash, committedAt, subject] = line.split("\t");
      return {
        committedAt: normalizeText(committedAt),
        hash: normalizeText(hash),
        shortHash: normalizeText(hash).slice(0, 7),
        subject: normalizeText(subject),
      };
    });
}

function runGit(repoRoot: string, args: string[]): GitCommandResult {
  const result = captureSubprocess("git", ["-c", "core.quotepath=false", ...args], {
    cwd: repoRoot,
    timeoutMs: 15_000,
  });
  return {
    ok: result.ok,
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function clampPositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function normalizeRelativePath(value: unknown): string {
  return normalizeText(value)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function normalizeGithubRepoName(value: unknown): string {
  const normalized = normalizeText(value)
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  return /^[^/\s]+\/[^/\s]+$/u.test(normalized) ? normalized : "";
}

function normalizeGithubRefName(value: unknown): string {
  const normalized = normalizeText(value);
  return normalized.replace(/^refs\/(heads|tags)\//u, "");
}

function normalizeGithubMatchText(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function buildGithubRepoUrl(repo: string): string {
  return repo ? `https://github.com/${repo}` : "";
}

function getGithubRepoBasename(repo: string): string {
  return normalizeText(repo).split("/").pop() || "";
}

function normalizeIsoTime(value: unknown): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function isReadableDirectory(directoryPath: unknown): boolean {
  const normalizedPath = normalizeText(directoryPath);
  if (!normalizedPath) {
    return false;
  }
  try {
    return fs.statSync(normalizedPath).isDirectory();
  } catch {
    return false;
  }
}

function isReadableFile(filePath: unknown): boolean {
  const normalizedPath = normalizeText(filePath);
  if (!normalizedPath) {
    return false;
  }
  try {
    return fs.statSync(normalizedPath).isFile();
  } catch {
    return false;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

export {
  collectProjectRadars,
  listTrackedProjects,
  loadProjectRadarConfig,
};
