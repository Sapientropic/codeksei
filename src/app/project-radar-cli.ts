import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import * as projectRadarModule from "../core/project-radar";

interface ProjectRadarOptions {
  help: boolean;
  list: boolean;
  json: boolean;
  project: string;
  commits: string;
  changes: string;
}

interface TrackedProject {
  slug: string;
  title: string;
  aliases: string[];
  repoRoot: string;
  notePath: string;
  timelineLabel: string;
}

interface ProjectRadarConfig {
  workspaceRoot: string;
  configFile: string;
}

interface ProjectGitStatusEntry {
  code: string;
  path: string;
}

interface ProjectGitCommit {
  shortHash: string;
  committedAt: string;
  subject: string;
}

interface ProjectRadarResult {
  workspaceRoot: string;
  configFile: string;
  generatedAt: string;
  projects: Array<{
    slug: string;
    title: string;
    repoRoot: string;
    notePath: string;
    timelineLabel: string;
    readFirst: Array<{ kind: string; path: string; exists: boolean }>;
    git: {
      ok: boolean;
      message: string;
      branch: string;
      upstream: string;
      ahead: number;
      behind: number;
      dirty: boolean;
      summary: {
        staged: number;
        unstaged: number;
        untracked: number;
        conflicted: number;
      };
      statusEntries: ProjectGitStatusEntry[];
      recentCommits: ProjectGitCommit[];
    };
  }>;
}

const {
  collectProjectRadars,
  listTrackedProjects,
  loadProjectRadarConfig,
} = projectRadarModule as {
  collectProjectRadars: (config: unknown, options: ProjectRadarOptions) => ProjectRadarResult;
  listTrackedProjects: (config: unknown) => TrackedProject[];
  loadProjectRadarConfig: (config: unknown) => ProjectRadarConfig;
};

async function runProjectRadarCommand(config: unknown, args: string[] = []) {
  const options = parseProjectRadarArgs(args);
  if (options.help) {
    console.log(buildTerminalLeafHelp("project.radar", { config }));
    return;
  }

  if (options.list) {
    const radarConfig = loadProjectRadarConfig(config);
    const tracked = listTrackedProjects(config);
    if (options.json) {
      console.log(JSON.stringify({
        workspaceRoot: radarConfig.workspaceRoot,
        configFile: radarConfig.configFile,
        projects: tracked,
      }, null, 2));
      return;
    }
    printProjectList(radarConfig, tracked);
    return;
  }

  const result = collectProjectRadars(config, options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(renderProjectRadarsText(result));
}

function parseProjectRadarArgs(args: string[]): ProjectRadarOptions {
  return parseCliArgs<ProjectRadarOptions>(args, getCommandArgsSchema("projectRadar"));
}

function printProjectList(radarConfig: ProjectRadarConfig, trackedProjects: TrackedProject[]): void {
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
  }
  console.log(lines.join("\n"));
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
    if (project.timelineLabel) {
      lines.push(`timeline: ${project.timelineLabel}`);
    }

    if (project.readFirst.length) {
      lines.push("readFirst:");
      for (const file of project.readFirst) {
        lines.push(`- [${file.kind}] ${file.path}${file.exists ? "" : " (missing)"}`);
      }
    }

    if (!project.git.ok) {
      lines.push(`git: ${project.git.message}`);
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

export { runProjectRadarCommand };
