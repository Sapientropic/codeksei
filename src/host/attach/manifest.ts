import type { HostAttachmentManifest, HostEntrypointManifest } from "../contracts/attach-manifest";
import { resolveHostAttachment, type HostAttachmentConfigInput } from "./model";
import { listHostRecipes } from "../contracts/host-recipe";

export function buildHostEntrypointManifest(): HostEntrypointManifest {
  return {
    manifest: ["codeksei", "host", "manifest", "--format", "json"],
    bootstrap: ["codeksei", "host", "bootstrap", "--ensure-daemon", "--format", "json"],
    doctor: ["codeksei", "host", "doctor", "--format", "json"],
    smoke: ["codeksei", "host", "smoke", "--provider", "hermes", "--format", "json"],
    seedProactive: ["codeksei", "host", "seed-proactive", "--format", "json"],
    claimCheckin: ["codeksei", "host", "claim-checkin", "--format", "json"],
    settleCheckin: ["codeksei", "host", "settle-checkin", "--format", "json"],
    render: ["codeksei", "host", "render", "--provider", "hermes", "--target", "skill", "--format", "json"],
  };
}

export function buildHostAttachmentManifest(
  config: HostAttachmentConfigInput = {},
): HostAttachmentManifest {
  const attachment = resolveHostAttachment(config);
  return {
    contractVersion: 1,
    runtimeInvariant: "bridge-full",
    transport: attachment.transport,
    modeClass: attachment.modeClass,
    provider: attachment.provider,
    supported: attachment.supported,
    reason: attachment.reason,
    install: {
      preferred: ["npx", "-y", "codeksei@latest"],
      fallback: [["npm", "install", "-g", "codeksei"]],
    },
    entrypoints: buildHostEntrypointManifest(),
    recipes: listHostRecipes(),
  };
}
