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

const hostBindingSchemaV1 = z.object({
  provider: z.enum(["codex", "hermes", "generic-shell"]),
  channel: z.string().min(1),
});

const hostBindingSchemaV2 = z.object({
  provider: z.enum(["codex", "hermes", "generic-shell"]),
  runtimeProvider: z.enum(["codex", "hermes", "openclaw-reserved"]),
  runtimeOwner: z.enum(["codeksei", "host"]),
  channelProvider: z.enum(["codeksei", "hermes", "host"]),
  channelKind: z.string().min(1),
  deliveryRecipe: z.string().min(1),
  channel: z.string().min(1).optional(),
});

const hostBindingSchema = z.union([hostBindingSchemaV2, hostBindingSchemaV1]).transform((value) => {
  if ("runtimeProvider" in value) {
    return value;
  }
  return {
    provider: value.provider,
    runtimeProvider: value.provider === "hermes" ? "hermes" : "codex",
    runtimeOwner: value.provider === "hermes" ? "host" : "codeksei",
    channelProvider: value.provider === "hermes" ? "hermes" : value.provider === "codex" ? "codeksei" : "host",
    channelKind: value.channel || "none",
    deliveryRecipe: value.provider === "hermes" ? "hermes-origin" : value.provider === "codex" ? "codeksei-weixin-bridge" : "generic-shell",
    channel: value.channel,
  };
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
  modeClass: z.enum(["codex-managed", "hosted-proactive", "hosted-skill-only", "cli-only", "bridge-full"]),
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
