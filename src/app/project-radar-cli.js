const { getCommandArgsSchema } = require("../contracts/command-args");
const { parseCliArgs } = require("../core/cli-args");
const { collectProjectRadars, listTrackedProjects, loadProjectRadarConfig } = require("../core/project-radar");

async function runProjectRadarCommand(config, args = []) {
  const options = parseProjectRadarArgs(args);
  if (options.help) {
    printProjectRadarHelp(config);
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

function parseProjectRadarArgs(args) {
  return parseCliArgs(args, getCommandArgsSchema("projectRadar"));
}

function printProjectRadarHelp(config = {}) {
  console.log([
    "用法: npm run project:radar -- [--list] [--project <slug>] [--json] [--commits 5] [--changes 20]",
    "",
    "说明：",
    "  默认从当前 workspace 的 .codex/code-projects.json 读取已跟踪代码项目。",
    `  当前配置文件: ${config.projectRadarConfigFile || "(auto)"}`,
    "",
    "示例：",
    "  npm run project:radar -- --list",
    "  npm run project:radar -- --project <slug> --json",
    "  npm run project:radar -- --project engineering-issues --commits 8 --changes 30",
  ].join("\n"));
}

function printProjectList(radarConfig, trackedProjects) {
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

function renderProjectRadarsText(result) {
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

module.exports = { runProjectRadarCommand };
