import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { resolvePackageRoot } from "../core/path-utils";

function main(): void {
  const repoRoot = resolvePackageRoot(__dirname);
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--require",
    "./tests/helpers/build-path-resolver.ts",
    "--test",
    "tests/*.test.ts",
  ], buildSpawnOptions(repoRoot));
  if (result.error instanceof Error) {
    throw new Error(`built-runtime tests failed to launch: ${result.error.message}`);
  }
  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }
  if (result.signal) {
    throw new Error(`built-runtime tests terminated by signal ${result.signal}`);
  }
}

function buildSpawnOptions(cwd: string): SpawnSyncOptionsWithStringEncoding {
  return {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEKSEI_TEST_RUNTIME_MODE: "built",
    },
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  };
}

main();
