import type { HostRecipeId } from "./host-recipe";

export type HostClaimStatus = "idle" | "claimed" | "in_progress";

export interface DelegationLease {
  id: string;
  triggerId: string;
  claimedAt: string;
  expiresAt: string;
  recoveryOnExpiry: true;
}

export interface PersistedOriginRef {
  channel: string;
  chatId?: string | undefined;
  threadId?: string | undefined;
  senderId?: string | undefined;
  raw?: Record<string, unknown> | undefined;
}

export interface ClaimedPayload {
  kind: "proactive_checkin";
  format: "plain_text";
  text: string;
}

export interface HostCommandMeta {
  contract: "codeksei-host-v1";
  command: "host.claim-checkin" | "host.settle-checkin";
  runtimeInvariant: "bridge-full";
  recipeId: HostRecipeId | "";
  workspaceRoot: string;
  targetKey: string;
}
