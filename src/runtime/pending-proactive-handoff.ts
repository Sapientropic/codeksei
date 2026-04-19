import { buildCheckinTargetKey } from "../checkin";
import type { PendingProactiveHandoffRuntimePayload } from "../core/runtime-types";
import { normalizeText } from "../core/text-normalization";
import { CheckinScheduleStateStore } from "../state/checkin-schedule-state-store";

export function readPendingProactiveHandoff(
  {
    checkinScheduleStateFile = "",
  }: {
    checkinScheduleStateFile?: string;
  },
  {
    senderId,
    workspaceRoot,
  }: {
    senderId: string;
    workspaceRoot: string;
  },
): PendingProactiveHandoffRuntimePayload | null {
  const filePath = normalizeText(checkinScheduleStateFile);
  if (!filePath) {
    return null;
  }
  const state = new CheckinScheduleStateStore({ filePath }).getState();
  if (!state || state.targetKey !== buildCheckinTargetKey({ senderId, workspaceRoot })) {
    return null;
  }
  const handoff = state.pendingHandoff;
  if (!handoff) {
    return null;
  }
  return {
    bookkeepingActions: handoff.bookkeepingActions.map((entry) => `${entry.kind}:${entry.status}:${entry.summary}`),
    followupContext: normalizeText(handoff.followupContext),
    handoffCreatedAt: normalizeText(handoff.handoffCreatedAt),
    handoffExpiresAt: normalizeText(handoff.handoffExpiresAt),
    observedCurrentState: normalizeText(handoff.observedCurrentState),
    outcome: normalizeText(handoff.outcome),
    triggerId: normalizeText(handoff.triggerId),
    userVisibleMessage: normalizeText(handoff.userVisibleMessage),
  };
}

export function buildPendingProactiveHandoffPrelude(
  handoff: PendingProactiveHandoffRuntimePayload,
): string {
  const lines = [
    "[Codeksei pending proactive handoff]",
    "A cron child already observed this thread. Absorb that handoff before you answer, then let the main session own the real continuity and next-wake judgment.",
    `lease_id: ${handoff.triggerId}`,
  ];
  if (handoff.outcome) {
    lines.push(`child_outcome: ${handoff.outcome}`);
  }
  if (handoff.observedCurrentState) {
    lines.push(`observed_current_state: ${handoff.observedCurrentState}`);
  }
  if (handoff.userVisibleMessage) {
    lines.push(`child_user_message: ${handoff.userVisibleMessage}`);
  }
  if (handoff.followupContext) {
    lines.push(`followup_context: ${handoff.followupContext}`);
  }
  if (handoff.bookkeepingActions.length) {
    lines.push("continuity_actions:");
    for (const action of handoff.bookkeepingActions) {
      lines.push(`- ${action}`);
    }
  }
  lines.push("Before ending this turn, decide whether you should write continuity (timeline/diary/project note/companion memory/review) and then finalize the handoff with host finalize-checkin if the proactive lease is still pending.");
  return lines.join("\n");
}
