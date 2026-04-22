import * as fs from "node:fs";
import * as path from "node:path";

import { resolvePackageRoot } from "../../contracts/path-utils";
import { normalizeText } from "../../contracts/text-normalization";
import type { HostAttachmentManifest } from "../contracts/attach-manifest";
import { listHostRecipes } from "../contracts/host-recipe";
import { buildHostAttachmentManifest } from "../attach/manifest";

interface HostkitPackageContract {
  name: string;
  bin: string;
  node: string;
}

interface HostkitRecipeEntry {
  id: string;
  kind: "first_party" | "generic";
  runtimeProviders: string[];
  channelProviders: string[];
  channelKinds: string[];
  defaultDeliveryRecipe: string;
  supportsDelegatedCheckin: boolean;
  supportsToolSurface: boolean;
}

interface RepoHostkitDocument extends Pick<
  HostAttachmentManifest,
  | "contractVersion"
  | "coreInvariant"
  | "scheduleTruthOwner"
  | "hostIdentity"
  | "runtimeInvariant"
  | "install"
  | "entrypoints"
  | "recommendedWorkflows"
> {
  $schema: "./schemas/hostkit-v2.json";
  package: HostkitPackageContract;
  io: {
    defaultFormat: "json";
    stdout: "command-envelope";
    stderr: "diagnostic";
  };
  daemon: {
    required: true;
    ownership: {
      pollLoop: "daemon";
      scheduleTruth: "daemon";
      leaseRecovery: "daemon";
    };
  };
  config: {
    canonicalFile: "codeksei.config.json";
    schema: "./schemas/codeksei-config-v2.json";
  };
  contracts: {
    hostkit: "./schemas/hostkit-v2.json";
    attachmentCapabilities: "./schemas/host-capabilities-v1.json";
    commandEnvelope: "./schemas/command-envelope-v1.json";
    claimCheckin: "./schemas/host-claim-checkin-v1.json";
    finalizeCheckin: "./schemas/host-finalize-checkin-v1.json";
    settleCheckin: "./schemas/host-settle-checkin-v1.json";
  };
  attachmentPolicy: {
    daemonOwnsPollLoop: true;
    daemonOwnsScheduleTruth: true;
    leaseExpiryFallback: "daemon_local_recovery";
  };
  recipes: HostkitRecipeEntry[];
  discovery: {
    docs: ["README.md", "docs/architecture.md", "docs/commands.md"];
  };
}

export function resolveRepoHostkitAssetPath(): string {
  const packageRoot = resolvePackageRoot(__dirname);
  return path.join(packageRoot, "CODEKSEI_HOSTKIT.json");
}

export function buildRepoHostkitDocument(): RepoHostkitDocument {
  const manifest = buildHostAttachmentManifest();
  return {
    $schema: "./schemas/hostkit-v2.json",
    contractVersion: manifest.contractVersion,
    coreInvariant: manifest.coreInvariant,
    scheduleTruthOwner: manifest.scheduleTruthOwner,
    hostIdentity: manifest.hostIdentity,
    runtimeInvariant: manifest.runtimeInvariant,
    package: readHostkitPackageContract(),
    install: manifest.install,
    io: {
      defaultFormat: "json",
      stdout: "command-envelope",
      stderr: "diagnostic",
    },
    daemon: {
      required: true,
      ownership: {
        pollLoop: "daemon",
        scheduleTruth: "daemon",
        leaseRecovery: "daemon",
      },
    },
    entrypoints: manifest.entrypoints,
    config: {
      canonicalFile: "codeksei.config.json",
      schema: "./schemas/codeksei-config-v2.json",
    },
    contracts: {
      hostkit: "./schemas/hostkit-v2.json",
      attachmentCapabilities: "./schemas/host-capabilities-v1.json",
      commandEnvelope: "./schemas/command-envelope-v1.json",
      claimCheckin: "./schemas/host-claim-checkin-v1.json",
      finalizeCheckin: "./schemas/host-finalize-checkin-v1.json",
      settleCheckin: "./schemas/host-settle-checkin-v1.json",
    },
    attachmentPolicy: {
      daemonOwnsPollLoop: true,
      daemonOwnsScheduleTruth: true,
      leaseExpiryFallback: "daemon_local_recovery",
    },
    recipes: buildHostkitRecipeEntries(),
    recommendedWorkflows: manifest.recommendedWorkflows,
    discovery: {
      docs: ["README.md", "docs/architecture.md", "docs/commands.md"],
    },
  };
}

export function renderRepoHostkitDocument(): string {
  return `${JSON.stringify(buildRepoHostkitDocument(), null, 2)}\n`;
}

function buildHostkitRecipeEntries(): HostkitRecipeEntry[] {
  return listHostRecipes().map((entry) => ({
    id: entry.id,
    kind: entry.id === "hermes" || entry.id === "codex" ? "first_party" : "generic",
    runtimeProviders: [...entry.runtimeProviders],
    channelProviders: [...entry.channelProviders],
    channelKinds: [...entry.channelKinds],
    defaultDeliveryRecipe: entry.defaultDeliveryRecipe,
    supportsDelegatedCheckin: entry.supportsDelegatedCheckin,
    supportsToolSurface: entry.supportsToolSurface,
  }));
}

function readHostkitPackageContract(): HostkitPackageContract {
  const packageRoot = resolvePackageRoot(__dirname);
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    name?: unknown;
    bin?: Record<string, unknown>;
    engines?: {
      node?: unknown;
    };
  };
  const binName = Object.keys(packageJson.bin || {}).find(Boolean) || "codeksei";
  return {
    name: normalizeText(packageJson.name) || "codeksei",
    bin: normalizeText(binName) || "codeksei",
    node: normalizeText(packageJson.engines?.node) || ">=22",
  };
}
