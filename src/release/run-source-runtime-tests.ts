import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { resolvePackageRoot } from "../core/path-utils";

const builtRuntimeOnlyTestFiles = new Set([
  "cli-agent-native-contract.test.ts",
  "dependency-contract.test.ts",
  "published-runtime-artifacts.test.ts",
  "root-helper-smoke.test.ts",
  "shared-mode-long-chain.test.ts",
  "timeline-first-party-runtime.test.ts",
]);

function main(): void {
  const repoRoot = resolvePackageRoot(__dirname);
  const testFiles = listSourceRuntimeTestFiles(repoRoot);
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--require",
    "./tests/helpers/build-path-resolver.ts",
    "--test",
    ...testFiles,
  ], buildSpawnOptions(repoRoot));
  if (result.error instanceof Error) {
    throw new Error(`source-runtime tests failed to launch: ${result.error.message}`);
  }
  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
  if (result.signal) {
    throw new Error(`source-runtime tests terminated by signal ${result.signal}`);
  }
}

function listSourceRuntimeTestFiles(repoRoot: string): string[] {
  const testsRoot = path.join(repoRoot, "tests");
  return fs.readdirSync(testsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".test.ts"))
    .filter((name) => !builtRuntimeOnlyTestFiles.has(name))
    .sort()
    .map((name) => path.join("tests", name).replace(/\\/g, "/"));
}

function buildSpawnOptions(cwd: string): SpawnSyncOptionsWithStringEncoding {
  return {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEKSEI_TEST_RUNTIME_MODE: "source",
    },
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  };
}

main();
