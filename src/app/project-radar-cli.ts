import { getCommandArgsSchema } from "../contracts/command-args";
import { parseCliArgs } from "../core/cli-args";
import { buildTerminalLeafHelp } from "../core/command-registry";
import { collectProjectRadars, listTrackedProjects, loadProjectRadarConfig } from "../core/project-radar";

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

async function runProjectRadarCommand(config: unknown, args: string[] = []) {
  const options = parseProjectRadarArgs(args);
  if (options.help) {
    console.log(buildTerminalLeafHelp("project.radar", { config }));
    return;
  }

  if (options.list) {
    const radarConfig = loadProjectRadarConfig(config as Parameters<typeof loadProjectRadarConfig>[0]);
    const tracked = listTrackedProjects(config as Parameters<typeof listTrackedProjects>[0]);
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

  const result = collectProjectRadars(
    config as Parameters<typeof collectProjectRadars>[0],
    options,
  );
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
        if (!file) {
          continue;
        }
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
