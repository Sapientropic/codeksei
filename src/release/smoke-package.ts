import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { resolvePackageRoot } from "../core/path-utils";

interface PackRecord {
  filename?: string;
}

function main(): void {
  const repoRoot = resolvePackageRoot(__dirname);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codeksei-package-smoke-"));
  const installRoot = path.join(tempRoot, "install-root");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const stateDir = path.join(tempRoot, "state");
  let tarballPath = "";

  fs.mkdirSync(installRoot, { recursive: true });
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  try {
    fs.writeFileSync(path.join(installRoot, "package.json"), JSON.stringify({
      name: "codeksei-package-smoke",
      private: true,
    }, null, 2));

    const packResult = runCommand(resolveNpmCommand(), ["pack", "--ignore-scripts", "--json"], {
      cwd: repoRoot,
    });
    const packRecords = JSON.parse(packResult.stdout) as PackRecord[];
    const tarballName = String(packRecords[0]?.filename || "");
    if (!tarballName) {
      throw new Error("npm pack --json did not return a tarball filename");
    }
    tarballPath = path.join(repoRoot, tarballName);

    runCommand(resolveNpmCommand(), ["install", "--ignore-scripts", tarballPath], {
      cwd: installRoot,
    });

    const installedPackageRoot = path.join(installRoot, "node_modules", "codeksei");
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(installedPackageRoot, "package.json"), "utf8"),
    ) as {
      bin?: string | Record<string, string>;
    };
    const binRelative = typeof packageJson.bin === "string"
      ? packageJson.bin
      : String(packageJson.bin?.codeksei || "");
    if (!binRelative) {
      throw new Error("installed package is missing the codeksei bin entry");
    }
    const binPath = path.join(installedPackageRoot, binRelative);
    const commandEnv = {
      CODEKSEI_STATE_DIR: stateDir,
      CODEKSEI_WORKSPACE_ROOT: workspaceRoot,
    };

    runCliSmoke(binPath, ["help"], /command_collection|Codeksei/u, installRoot, commandEnv);
    runCliSmoke(binPath, ["schema"], /command_collection/u, installRoot, commandEnv);
    runCliSmoke(binPath, ["operator", "hermes", "status", "--help"], /operator hermes|install-skill|status/u, installRoot, commandEnv);

    process.stdout.write("[codeksei] package smoke passed\n");
  } finally {
    if (tarballPath && fs.existsSync(tarballPath)) {
      fs.rmSync(tarballPath, { force: true });
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runCliSmoke(
  binPath: string,
  args: string[],
  expectedOutput: RegExp,
  cwd: string,
  extraEnv: Record<string, string>,
): void {
  const result = runCommand(process.execPath, [binPath, ...args], {
    cwd,
    env: extraEnv,
  });
  const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (!expectedOutput.test(combinedOutput)) {
    throw new Error(`package smoke output did not match ${expectedOutput}: ${combinedOutput}`);
  }
}

function resolveNpmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
  },
): { stdout: string; stderr: string } {
  const baseOptions: SpawnSyncOptionsWithStringEncoding = {
    cwd: options.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  };
  const useWindowsCmdWrapper = process.platform === "win32" && /\.cmd$/iu.test(command);
  const result = useWindowsCmdWrapper
    ? spawnSync(resolveWindowsCommandInterpreter(), [
      "/d",
      "/s",
      "/c",
      buildWindowsCommandLine(command, args),
    ], baseOptions)
    : spawnSync(command, args, baseOptions);

  const stdout = typeof result.stdout === "string" ? result.stdout : String(result.stdout || "");
  const stderr = typeof result.stderr === "string" ? result.stderr : String(result.stderr || "");
  if (result.error instanceof Error) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${String(result.status)}\n${stdout}\n${stderr}`.trim());
  }
  return { stdout, stderr };
}

function resolveWindowsCommandInterpreter(): string {
  return process.env.ComSpec || "cmd.exe";
}

function buildWindowsCommandLine(command: string, args: string[]): string {
  return [quoteWindowsCmdArg(command), ...args.map((value) => quoteWindowsCmdArg(value))].join(" ");
}

function quoteWindowsCmdArg(value: string): string {
  if (!/[ \t"]/u.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\"\"")}"`;
}

main();
