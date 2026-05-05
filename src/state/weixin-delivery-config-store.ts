import * as fs from "node:fs";

import {
  normalizeWeixinDeliveryConfig,
  validateWeixinDeliveryConfig,
  type WeixinDeliveryConfig,
  type WeixinDeliveryPageMode,
  type WeixinDeliveryReplyMode,
} from "../contracts/weixin-delivery-config";
import {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} from "./json-state";

class WeixinDeliveryConfigStore {
  filePath: string;

  constructor({ filePath }: { filePath: string }) {
    this.filePath = filePath;
    this.ensureParentDirectory();
  }

  ensureParentDirectory(): void {
    ensureParentDirectory(this.filePath);
  }

  getConfig(): WeixinDeliveryConfig | null {
    const value = readManagedJsonStateFile<WeixinDeliveryConfig | null>({
      filePath: this.filePath,
      fallback: null,
      label: "weixin delivery config",
      validate: (candidate) => candidate == null ? true : validateWeixinDeliveryConfig(candidate),
    });
    return value ? normalizeWeixinDeliveryConfig(value) : null;
  }

  setConfig(config: {
    replyMode?: WeixinDeliveryReplyMode | undefined;
    minChunkChars?: number | undefined;
    pageMode?: WeixinDeliveryPageMode | undefined;
    pageChars?: number | undefined;
  }): WeixinDeliveryConfig {
    const nextConfig = normalizeWeixinDeliveryConfig({
      ...this.getConfig(),
      ...config,
      updatedAt: new Date().toISOString(),
    });
    writeManagedJsonStateFile(this.filePath, nextConfig);
    return nextConfig;
  }

  reset(): void {
    fs.rmSync(this.filePath, { force: true });
  }
}

export {
  WeixinDeliveryConfigStore,
};
