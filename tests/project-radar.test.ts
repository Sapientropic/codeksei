const fs: typeof import("node:fs") = require("node:fs");
const os: typeof import("node:os") = require("node:os");
const path: typeof import("node:path") = require("node:path");
const { spawnSync }: typeof import("node:child_process") = require("node:child_process");
const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  collectProjectRadars,
}: typeof import("../src/workspace/project-radar") = require("../src/workspace/project-radar");

function createWorkspaceFixture(projects: unknown[]) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-project-radar-"));
  const codexDir = path.join(workspaceRoot, ".codex");
  fs.mkdirSync(codexDir, { recursive: true });
  const configFile = path.join(codexDir, "code-projects.json");
  fs.writeFileSync(configFile, JSON.stringify({ projects }, null, 2), "utf8");
  return { configFile, workspaceRoot };
}

function createGitRepo(tempRoot: string): string {
  const repoRoot = path.join(tempRoot, "repo");
  fs.mkdirSync(repoRoot, { recursive: true });
  runGit(repoRoot, ["init", "--initial-branch", "main"]);
  runGit(repoRoot, ["config", "user.email", "bot@example.com"]);
  runGit(repoRoot, ["config", "user.name", "Codeksei Bot"]);
  fs.writeFileSync(path.join(repoRoot, "README.md"), "# repo\n", "utf8");
  runGit(repoRoot, ["add", "README.md"]);
  runGit(repoRoot, ["commit", "-m", "initial"]);
  return repoRoot;
}

function runGit(repoRoot: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || `git ${args.join(" ")} failed`);
}

function createFakeGhCommand(tempRoot: string, events: unknown[], markerFile: string) {
  const configPath = path.join(tempRoot, "fake-gh.config.json");
  const scriptPath = path.join(tempRoot, "fake-gh.js");
  fs.writeFileSync(configPath, JSON.stringify({ events, login: "sapientropic", markerFile }), "utf8");
  fs.writeFileSync(scriptPath, [
    "const fs = require('node:fs');",
    `const config = JSON.parse(fs.readFileSync(${JSON.stringify(configPath)}, 'utf8'));`,
    "if (config.markerFile) { fs.writeFileSync(config.markerFile, 'called', 'utf8'); }",
    "const args = process.argv.slice(2);",
    "if (args[0] === 'api' && args[1] === 'user') { process.stdout.write(String(config.login || 'sapientropic')); process.exit(0); }",
    "if (args[0] === 'api' && args[1] === `/users/${config.login}/events?per_page=100`) { process.stdout.write(JSON.stringify(config.events || [])); process.exit(0); }",
    "process.stderr.write(`unexpected gh args: ${JSON.stringify(args)}`);",
    "process.exit(1);",
  ].join("\n"), "utf8");

  if (process.platform === "win32") {
    const wrapperPath = path.join(tempRoot, "gh.cmd");
    fs.writeFileSync(wrapperPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, "utf8");
    return wrapperPath;
  }

  const wrapperPath = path.join(tempRoot, "gh");
  fs.writeFileSync(wrapperPath, `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`, {
    encoding: "utf8",
    mode: 0o755,
  });
  return wrapperPath;
}

test("project radar keeps local git as the first truth and skips GitHub fallback when repo is healthy", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-project-radar-local-"));
  const repoRoot = createGitRepo(tempRoot);
  const { workspaceRoot, configFile } = createWorkspaceFixture([{
    slug: "codeksei",
    title: "Codeksei",
    repoRoot,
    githubRepo: "sapientropic/codeksei",
    notePath: "notes/codeksei.md",
  }]);
  fs.mkdirSync(path.join(workspaceRoot, "notes"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "notes", "codeksei.md"), "note", "utf8");

  const markerFile = path.join(tempRoot, "gh-called.txt");
  const ghCommand = createFakeGhCommand(tempRoot, [], markerFile);
  const result = collectProjectRadars({
    ghCommand,
    projectRadarConfigFile: configFile,
    workspaceRoot,
  }, {
    project: "codeksei",
  });
  const project = result.projects[0];
  assert.ok(project);

  assert.equal(project.git.ok, true);
  assert.equal(project.githubActivity.status, "not_needed");
  assert.equal(fs.existsSync(markerFile), false);
});

test("project radar falls back to GitHub activity when repo is missing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-project-radar-fallback-"));
  const missingRepoRoot = path.join(tempRoot, "missing-repo");
  const { workspaceRoot, configFile } = createWorkspaceFixture([{
    slug: "codeksei",
    title: "Codeksei",
    repoRoot: missingRepoRoot,
    githubRepo: "sapientropic/codeksei",
    notePath: "notes/codeksei.md",
  }]);
  fs.mkdirSync(path.join(workspaceRoot, "notes"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "notes", "codeksei.md"), "note", "utf8");

  const ghCommand = createFakeGhCommand(tempRoot, [{
    type: "PushEvent",
    created_at: "2026-04-14T10:00:00Z",
    repo: { name: "sapientropic/codeksei" },
    payload: { ref: "refs/heads/main", size: 2 },
  }], path.join(tempRoot, "gh-called.txt"));

  const result = collectProjectRadars({
    ghCommand,
    projectRadarConfigFile: configFile,
    workspaceRoot,
  }, {
    project: "codeksei",
  });
  const project = result.projects[0];
  assert.ok(project);

  assert.equal(project.git.ok, false);
  assert.equal(project.githubActivity.status, "matched");
  assert.equal(project.githubActivity.usedAsFallback, true);
  assert.equal(project.githubActivity.matchedBy, "githubRepo");
  assert.equal(project.githubActivity.latestEvent?.type, "PushEvent");
});

test("project radar keeps clear diagnostics when auto matching cannot find a safe GitHub repo", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-project-radar-no-match-"));
  const { workspaceRoot, configFile } = createWorkspaceFixture([{
    slug: "project-radar",
    title: "Project Radar",
    repoRoot: path.join(tempRoot, "missing-repo"),
    aliases: ["continuity"],
    notePath: "notes/project.md",
  }]);
  fs.mkdirSync(path.join(workspaceRoot, "notes"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "notes", "project.md"), "note", "utf8");

  const ghCommand = createFakeGhCommand(tempRoot, [{
    type: "PushEvent",
    created_at: "2026-04-14T10:00:00Z",
    repo: { name: "sapientropic/other-repo" },
    payload: { ref: "refs/heads/main", size: 1 },
  }], path.join(tempRoot, "gh-called.txt"));

  const result = collectProjectRadars({
    ghCommand,
    projectRadarConfigFile: configFile,
    workspaceRoot,
  }, {
    project: "project-radar",
  });
  const project = result.projects[0];
  assert.ok(project);

  assert.equal(project.githubActivity.status, "no_match");
  assert.match(project.githubActivity.diagnostics.message, /最近活动里没有找到/u);
});

test("project radar lets explicit githubRepo override automatic slug matching", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-project-radar-explicit-"));
  const { workspaceRoot, configFile } = createWorkspaceFixture([{
    slug: "codeksei",
    title: "Codeksei",
    repoRoot: path.join(tempRoot, "missing-repo"),
    githubRepo: "sapientropic/hosted-checkins",
    notePath: "notes/codeksei.md",
  }]);
  fs.mkdirSync(path.join(workspaceRoot, "notes"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, "notes", "codeksei.md"), "note", "utf8");

  const ghCommand = createFakeGhCommand(tempRoot, [
    {
      type: "PushEvent",
      created_at: "2026-04-14T10:00:00Z",
      repo: { name: "sapientropic/codeksei" },
      payload: { ref: "refs/heads/main", size: 3 },
    },
    {
      type: "PullRequestEvent",
      created_at: "2026-04-14T09:00:00Z",
      repo: { name: "sapientropic/hosted-checkins" },
      payload: {
        action: "opened",
        pull_request: {
          number: 42,
          html_url: "https://github.com/sapientropic/hosted-checkins/pull/42",
        },
      },
    },
  ], path.join(tempRoot, "gh-called.txt"));

  const result = collectProjectRadars({
    ghCommand,
    projectRadarConfigFile: configFile,
    workspaceRoot,
  }, {
    project: "codeksei",
  });
  const project = result.projects[0];
  assert.ok(project);

  assert.equal(project.githubActivity.status, "matched");
  assert.equal(project.githubActivity.matchedRepo, "sapientropic/hosted-checkins");
  assert.equal(project.githubActivity.latestEvent?.type, "PullRequestEvent");
});
