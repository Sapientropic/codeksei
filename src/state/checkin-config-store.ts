import * as fs from "node:fs";

import {
  normalizeCheckinConfig,
  validateCheckinConfig,
  type CheckinConfig,
} from "../contracts/checkin-config";
import {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} from "./json-state";

class CheckinConfigStore {
  filePath: string;

  constructor({ filePath }: { filePath: string }) {
    this.filePath = filePath;
    this.ensureParentDirectory();
  }

  ensureParentDirectory(): void {
    ensureParentDirectory(this.filePath);
  }

  getConfig(): CheckinConfig | null {
    const value = readManagedJsonStateFile<CheckinConfig | null>({
      filePath: this.filePath,
      fallback: null,
      label: "checkin config",
      validate: (candidate) => candidate == null ? true : validateCheckinConfig(candidate),
    });
    return value ? normalizeCheckinConfig(value) : null;
  }

  setConfig(config: { minIntervalMs: number; maxIntervalMs: number }): CheckinConfig {
    const nextConfig: CheckinConfig = {
      minIntervalMs: Number(config.minIntervalMs),
      maxIntervalMs: Number(config.maxIntervalMs),
      updatedAt: new Date().toISOString(),
    };
    writeManagedJsonStateFile(this.filePath, nextConfig);
    return nextConfig;
  }

  reset(): void {
    fs.rmSync(this.filePath, { force: true });
  }
}

export {
  CheckinConfigStore,
};
