import { normalizeText } from "../contracts/text-normalization";
import type { ProactiveJudgmentInput } from "./contracts";

export function buildProactiveJudgmentPrompt(input: ProactiveJudgmentInput): string {
  return [
    "You are Codeksei's host-neutral proactive judgment classifier.",
    "Return exactly one JSON object. Do not include markdown, prose, comments, or explanations.",
    "You may suggest an action, but Codeksei core owns schedule truth and will validate your output.",
    "",
    "Allowed JSON shape:",
    JSON.stringify({
      backstageActions: [
        {
          kind: "timeline|diary|project_note|companion_memory|review",
          status: "done|suggested|skipped",
          summary: "short summary",
        },
      ],
      confidence: 0.0,
      interventionLevel: "silent|backstage_only|light_nudge|state_check|offer_next_step|push_forward",
      nextWakePolicy: {
        mode: "sleep_for|next_wake_at|keep_existing",
        reason: "short reason",
        sleepFor: "2h",
      },
      outputModality: "text|voice|silent|backstage_only",
      reasonCode: "context_thin|open_loop_stale|project_reentry|scheduled_followup|reminder_due|closeout_window|user_scattered|voice_low_energy|quiet_hours|no_action",
      shouldSurface: true,
      suggestedMessage: "one short natural user-visible message",
      userVisibleReason: "short reason suitable for logs, not internal commands",
    }, null, 2),
    "",
    "Hard preferences:",
    "- If context is thin, prefer state_check over pretending to know.",
    "- If voice energy is low, avoid push_forward.",
    "- If surfacing, suggestedMessage must be short and natural.",
    "- Never expose lease ids, commands, internal schedules, or raw implementation details.",
    "",
    "Input:",
    JSON.stringify(redactForPrompt(input), null, 2),
  ].join("\n");
}

function redactForPrompt(input: ProactiveJudgmentInput): ProactiveJudgmentInput {
  return {
    ...input,
    recentOutcomes: input.recentOutcomes.slice(-5),
    stateCard: {
      ...input.stateCard,
      doNotDo: input.stateCard.doNotDo.map((line) => truncate(line, 180)).slice(0, 5),
    },
    voiceSignal: input.voiceSignal ? {
      ...input.voiceSignal,
      transcript: truncate(input.voiceSignal.transcript, 240),
    } : undefined,
  };
}

function truncate(value: string, limit: number): string {
  const normalized = normalizeText(value);
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}
