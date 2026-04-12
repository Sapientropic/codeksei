import * as fs from "node:fs";
import * as dotenv from "dotenv";
import * as brandingModule from "./branding";

const { listEnvFileCandidates } = brandingModule as {
  listEnvFileCandidates: (args: { cwd?: string; env?: Record<string, unknown> }) => string[];
};

type EnvMap = Record<string, string | undefined>;

function loadEnvStack({
  cwd = process.cwd(),
  env = process.env as EnvMap,
}: {
  cwd?: string;
  env?: EnvMap;
} = {}): string[] {
  const loadedPaths = [];
  const initialCandidates = listEnvFileCandidates({ cwd, env });
  const projectEnvPath = initialCandidates[0];

  if (projectEnvPath && fs.existsSync(projectEnvPath)) {
    dotenv.config({
      path: projectEnvPath,
      processEnv: env as Record<string, string>,
      override: false,
    });
    loadedPaths.push(projectEnvPath);
  }

  // The repo .env is allowed to define STATE_DIR, so the state-dir candidate
  // must be resolved after that first load rather than from the pre-load env.
  const refreshedCandidates = listEnvFileCandidates({ cwd, env });
  const stateEnvPath = refreshedCandidates[1];
  if (stateEnvPath && stateEnvPath !== projectEnvPath && fs.existsSync(stateEnvPath)) {
    dotenv.config({
      path: stateEnvPath,
      processEnv: env as Record<string, string>,
      override: false,
    });
    loadedPaths.push(stateEnvPath);
  }

  return loadedPaths;
}

export { loadEnvStack };
