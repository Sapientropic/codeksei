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
  bookkeepingPriorities: string[];
  decisionOrder: string[];
  observerContract: string;
  text: string;
}

export interface HostCheckinBookkeepingExpectation {
  kind: "companion_memory" | "diary" | "project_note" | "review" | "timeline";
  route: string;
  when: string;
}

export interface HostClaimContextBriefing {
  briefingText: string;
  followupContext: string;
  stale: boolean;
  staleReasons: string[];
}

export interface HostPendingHandoffSummary {
  bookkeepingActions: string[];
  exists: boolean;
  followupContext: string;
  handoffCreatedAt: string;
  handoffExpiresAt: string;
  observedCurrentState: string;
  outcome: string;
  triggerId: string;
  userVisibleMessage: string;
}

export interface HostCommandMeta {
  contract: "codeksei-host-v2";
  command: "host.claim-checkin" | "host.finalize-checkin" | "host.settle-checkin";
  coreInvariant: "codeksei-core-owned";
  scheduleTruthOwner: "codeksei";
  runtimeInvariant: "bridge-full";
  recipeId: HostRecipeId | "";
  workspaceRoot: string;
  targetKey: string;
}
