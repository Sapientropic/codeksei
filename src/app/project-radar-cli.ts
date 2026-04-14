import { getCommandArgsSchema } from "../contracts/command-args";
import type { CommandExecutionResult } from "../contracts/cli-contract";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { collectProjectRadars, listTrackedProjects, loadProjectRadarConfig } from "../workspace/project-radar";

interface ProjectRadarOptions {
  help: boolean;
  list: boolean;
  json: boolean;
  project: string;
  commits: string;
  changes: string;
}

type ProjectRadarConfig = ReturnType<typeof loadProjectRadarConfig>;
type TrackedProject = ReturnType<typeof listTrackedProjects>[number];
type ProjectRadarResult = ReturnType<typeof collectProjectRadars>;

async function runProjectRadarCommand(
  config: unknown,
  args: string[] = [],
): Promise<CommandExecutionResult> {
  const options = parseProjectRadarArgs(args);
  if (options.help) {
    return {
      data: null,
      text: buildTerminalLeafHelp("project.radar", { config }),
    };
  }

  if (options.list) {
    const radarConfig = loadProjectRadarConfig(config as Parameters<typeof loadProjectRadarConfig>[0]);
    const tracked = listTrackedProjects(config as Parameters<typeof listTrackedProjects>[0]);
    const data = {
      workspaceRoot: radarConfig.workspaceRoot,
      configFile: radarConfig.configFile,
      projects: tracked,
    };
    return {
      data,
      meta: {
        configSource: {
          projectRadarConfigFile: radarConfig.configFile,
        },
        effectiveWorkspaceRoot: radarConfig.workspaceRoot,
      },
      text: options.json
        ? JSON.stringify(data, null, 2)
        : renderProjectListText(radarConfig, tracked),
    };
  }

  const result = collectProjectRadars(
    config as Parameters<typeof collectProjectRadars>[0],
    options,
  );
  return {
    data: result,
    meta: {
      configSource: {
        projectRadarConfigFile: result.configFile,
      },
      effectiveWorkspaceRoot: result.workspaceRoot,
    },
    text: options.json
      ? JSON.stringify(result, null, 2)
      : renderProjectRadarsText(result),
  };
}

function parseProjectRadarArgs(args: string[]): ProjectRadarOptions {
  return parseCliArgs<ProjectRadarOptions>(args, getCommandArgsSchema("projectRadar"));
}

function renderProjectListText(radarConfig: ProjectRadarConfig, trackedProjects: TrackedProject[]): string {
  const lines = [
    `workspace: ${radarConfig.workspaceRoot}`,
    `config: ${radarConfig.configFile}`,
    "",
    "tracked projects:",
  ];
  for (const project of trackedProjects) {
    lines.push(`- ${project.slug} | ${project.title}`);
    lines.push(`  repo: ${project.repoRoot}`);
    lines.push(`  note: ${project.notePath}`);
    if (project.githubRepo) {
      lines.push(`  github: ${project.githubRepo}`);
    }
  }
  return lines.join("\n");
}

function renderProjectRadarsText(result: ProjectRadarResult): string {
  const lines = [
    `workspace: ${result.workspaceRoot}`,
    `config: ${result.configFile}`,
    `generatedAt: ${result.generatedAt}`,
  ];

  for (const project of result.projects) {
    lines.push("");
    lines.push(`## ${project.slug} | ${project.title}`);
    lines.push(`repo: ${project.repoRoot}`);
    lines.push(`note: ${project.notePath || "(none)"}`);
    if (project.githubRepo) {
      lines.push(`githubRepo: ${project.githubRepo}`);
    }
    if (project.timelineLabel) {
      lines.push(`timeline: ${project.timelineLabel}`);
    }

    if (project.readFirst.length) {
      lines.push("readFirst:");
      for (const file of project.readFirst) {
        if (!file) {
          continue;
        }
        lines.push(`- [${file.kind}] ${file.path}${file.exists ? "" : " (missing)"}`);
      }
    }

    if (!project.git.ok) {
      lines.push(`git: unavailable (${project.git.reason || "unknown"}) ${project.git.message}`);
      appendGithubActivityText(lines, project.githubActivity);
      continue;
    }

    lines.push(`branch: ${project.git.branch || "(unknown)"}`);
    if (project.git.upstream) {
      lines.push(`upstream: ${project.git.upstream} | ahead=${project.git.ahead} behind=${project.git.behind}`);
    }
    lines.push(
      `dirty: ${project.git.dirty ? "yes" : "no"} | staged=${project.git.summary.staged} unstaged=${project.git.summary.unstaged} untracked=${project.git.summary.untracked} conflicted=${project.git.summary.conflicted}`
    );
    if (project.git.statusEntries.length) {
      lines.push("changes:");
      for (const entry of project.git.statusEntries) {
        lines.push(`- ${entry.code} ${entry.path}`);
      }
    }
    if (project.git.recentCommits.length) {
      lines.push("recentCommits:");
      for (const commit of project.git.recentCommits) {
        lines.push(`- ${commit.shortHash} ${commit.committedAt} ${commit.subject}`);
      }
    }
  }

  return lines.join("\n");
}

function appendGithubActivityText(lines: string[], githubActivity: {
  diagnostics?: { candidates?: string[]; message?: string };
  latestEvent?: { createdAt?: string; description?: string; repo?: string; type?: string; url?: string } | null;
  matchedBy?: string;
  matchedRepo?: string;
  source?: string;
  status?: string;
}): void {
  lines.push(`githubActivity: ${String(githubActivity.status || "unknown")} [${String(githubActivity.source || "github_activity")}]`);
  if (githubActivity.matchedRepo) {
    lines.push(`matchedRepo: ${githubActivity.matchedRepo}${githubActivity.matchedBy ? ` via ${githubActivity.matchedBy}` : ""}`);
  }
  if (githubActivity.latestEvent) {
    lines.push("latestGithubEvent:");
    lines.push(`- ${githubActivity.latestEvent.type || "(unknown)"} ${githubActivity.latestEvent.createdAt || ""} ${githubActivity.latestEvent.description || ""}`.trim());
    if (githubActivity.latestEvent.url) {
      lines.push(`- ${githubActivity.latestEvent.url}`);
    }
  }
  if (githubActivity.diagnostics?.message) {
    lines.push(`githubDiagnostic: ${githubActivity.diagnostics.message}`);
  }
  if (Array.isArray(githubActivity.diagnostics?.candidates) && githubActivity.diagnostics?.candidates.length) {
    lines.push(`githubCandidates: ${githubActivity.diagnostics.candidates.join(", ")}`);
  }
}

export { runProjectRadarCommand };
