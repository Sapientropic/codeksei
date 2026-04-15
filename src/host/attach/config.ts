import type { CodekseiHostConfig } from "../contracts/codeksei-config";
import { resolveCodekseiConfigPath, readCodekseiHostConfig } from "../contracts/codeksei-config";

export function loadResolvedHostConfig(explicitPath: unknown, cwd: string): {
  path: string;
  config: CodekseiHostConfig | null;
} {
  const filePath = resolveCodekseiConfigPath(explicitPath, cwd);
  return {
    path: filePath,
    config: readCodekseiHostConfig(filePath),
  };
}
