const fs = require("fs");
const dotenv = require("dotenv");
const { listEnvFileCandidates } = require("./branding");

function loadEnvStack({ cwd = process.cwd(), env = process.env } = {}) {
  const loadedPaths = [];
  const initialCandidates = listEnvFileCandidates({ cwd, env });
  const projectEnvPath = initialCandidates[0];

  if (projectEnvPath && fs.existsSync(projectEnvPath)) {
    dotenv.config({
      path: projectEnvPath,
      processEnv: env,
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
      processEnv: env,
      override: false,
    });
    loadedPaths.push(stateEnvPath);
  }

  return loadedPaths;
}

module.exports = { loadEnvStack };
