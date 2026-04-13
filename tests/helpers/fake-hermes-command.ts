const fs: typeof import("node:fs") = require("node:fs");
const path: typeof import("node:path") = require("node:path");

function createFakeHermesCommand(tempRoot: string): { commandPath: string; scriptPath: string } {
  const scriptPath = path.join(tempRoot, "fake-hermes.js");
  fs.writeFileSync(scriptPath, buildFakeHermesScript(), "utf8");

  if (process.platform === "win32") {
    const commandPath = path.join(tempRoot, "fake-hermes.cmd");
    fs.writeFileSync(
      commandPath,
      `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
      "utf8",
    );
    return { commandPath, scriptPath };
  }

  const commandPath = path.join(tempRoot, "fake-hermes");
  fs.writeFileSync(
    commandPath,
    `#!/usr/bin/env bash\n"${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8",
  );
  fs.chmodSync(commandPath, 0o755);
  return { commandPath, scriptPath };
}

function buildFakeHermesScript(): string {
  return [
    "const args = process.argv.slice(2);",
    "const command = String(args[0] || '');",
    "const subcommand = String(args[1] || '');",
    "function exitWith(status, stdout, stderr) {",
    "  if (stdout) process.stdout.write(String(stdout));",
    "  if (stderr) process.stderr.write(String(stderr));",
    "  process.exit(Number(status || 0));",
    "}",
    "if (command === 'skills' && subcommand === 'list') {",
    "  exitWith(process.env.FAKE_HERMES_SKILLS_STATUS || 0, process.env.FAKE_HERMES_SKILLS_STDOUT || 'codeksei-companion\\n', process.env.FAKE_HERMES_SKILLS_STDERR || '');",
    "}",
    "if (command === 'chat') {",
    "  exitWith(process.env.FAKE_HERMES_CHAT_STATUS || 0, process.env.FAKE_HERMES_CHAT_STDOUT || '{\"progress\":[\"done\"]}', process.env.FAKE_HERMES_CHAT_STDERR || '');",
    "}",
    "exitWith(0, '', '');",
    "",
  ].join("\n");
}

module.exports = {
  createFakeHermesCommand,
};
