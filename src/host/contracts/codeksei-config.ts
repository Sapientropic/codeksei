import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

import { normalizeText } from "../../contracts/text-normalization";
import { resolveCrossPlatformPath } from "../../contracts/path-utils";
import {
  HOST_ATTACHMENT_CONTRACT_VERSION,
  HOST_BOOTSTRAP_SNAPSHOT_VERSION,
} from "./attach-manifest";

const hostUserSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  timezone: z.string().min(1),
});

const hostBindingSchema = z.object({
  provider: z.enum(["hermes", "generic-shell"]),
  channel: z.string().min(1),
});

const hostBootstrapSchema = z.object({
  snapshotVersion: z.number().int().min(1).default(HOST_BOOTSTRAP_SNAPSHOT_VERSION),
  manifestContractVersion: z.number().int().min(1).default(HOST_ATTACHMENT_CONTRACT_VERSION),
  companionSkillVersion: z.string().default(""),
  companionSkillHash: z.string().default(""),
  completedAt: z.string().default(""),
}).optional();

export const codekseiHostConfigSchema = z.object({
  $schema: z.string().min(1),
  modeClass: z.enum(["bridge-full", "hosted-proactive", "hosted-skill-only", "cli-only"]),
  workspaceRoot: z.string().min(1),
  stateDir: z.string().min(1),
  user: hostUserSchema,
  host: hostBindingSchema,
  bootstrap: hostBootstrapSchema,
});

export type CodekseiHostConfig = z.infer<typeof codekseiHostConfigSchema>;

export function resolveCodekseiConfigPath(explicitPath: unknown, cwd: string): string {
  const normalized = normalizeText(explicitPath);
  return normalized
    ? resolveCrossPlatformPath(normalized)
    : path.join(cwd, "codeksei.config.json");
}

export function readCodekseiHostConfig(filePath: string): CodekseiHostConfig | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return codekseiHostConfigSchema.parse(parsed);
}

export function writeCodekseiHostConfig(filePath: string, config: CodekseiHostConfig): CodekseiHostConfig {
  const normalized = codekseiHostConfigSchema.parse(config);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}
