import * as crypto from "node:crypto";

import { normalizeText } from "../contracts/text-normalization";
import type { ProactiveJudgmentInput } from "./contracts";

export function buildProactiveObservationPrompt(input: ProactiveJudgmentInput): string {
  return [
    "You are Codeksei's local proactive observation layer.",
    "Return exactly one JSON object. Do not include markdown, prose, comments, or explanations.",
    "Your job is observation only. Do not decide schedules, do not send messages, do not suggest commands.",
    "",
    "Allowed JSON shape:",
    JSON.stringify({
      annoyanceRisk: "low|medium|high|unknown",
      confidence: 0.0,
      currentStateHypothesis: "short evidence-based hypothesis",
      evidence: ["short source-backed evidence"],
      likelyBlocker: "short blocker",
      memoryCandidates: [
        {
          confidence: 0.0,
          evidence: "source-backed evidence",
          kind: "status|pattern|preference|boundary|next",
          slotId: "current_status|rhythm|preference|boundary|next",
          text: "candidate memory text",
        },
      ],
      modalityHints: ["text|voice|silent|backstage_only|image|audio"],
      reentryCandidate: "one concrete next re-entry step",
      stateSignals: ["context_thin|project_reentry|memory_candidate|user_low_energy|quiet_hour|open_loop|life_record|media_signal|no_action"],
      suggestedTone: "short tone hint",
      surfaceRisk: "low|medium|high|unknown",
      userEnergy: "low|medium|high|unknown",
    }, null, 2),
    "",
    "Rules:",
    "- Evidence must quote or summarize only the provided source pack.",
    "- If context is thin, say so instead of inventing state.",
    "- Memory candidates are candidates only; Codeksei will not auto-write them.",
    "- Never include raw sender ids, absolute paths, lease ids, command lines, or internal schedules.",
    "",
    "Source pack:",
    JSON.stringify(buildRedactedObservationSourcePack(input), null, 2),
  ].join("\n");
}

export function buildRedactedObservationSourcePack(input: ProactiveJudgmentInput): Record<string, unknown> {
  return {
    checkin: {
      lastCompletionResult: normalizeText(input.checkin.lastCompletionResult),
      pendingHandoffExists: Boolean(input.checkin.pendingHandoffExists),
    },
    contextBriefing: {
      followupContext: redactSensitiveText(input.contextBriefing.followupContext),
      stale: Boolean(input.contextBriefing.stale),
      staleReasons: input.contextBriefing.staleReasons.slice(0, 5).map(redactSensitiveText),
    },
    now: normalizeText(input.now),
    recentOutcomes: input.recentOutcomes.slice(-5).map((entry) => ({
      interventionLevel: normalizeText(entry.interventionLevel),
      reasonCode: normalizeText(entry.reasonCode),
      responseOutcome: normalizeText(entry.responseOutcome),
    })),
    stateCard: {
      activeThread: redactSensitiveText(input.stateCard.activeThread),
      currentLikelyState: redactSensitiveText(input.stateCard.currentLikelyState),
      doNotDo: input.stateCard.doNotDo.slice(0, 5).map(redactSensitiveText),
      easiestReentryStep: redactSensitiveText(input.stateCard.easiestReentryStep),
      likelyBlocker: redactSensitiveText(input.stateCard.likelyBlocker),
      sourceThickness: input.stateCard.sourceThickness,
      toneHint: redactSensitiveText(input.stateCard.toneHint),
    },
    target: {
      targetKeyHash: hashText(input.target.targetKey || `${input.target.senderId}:${input.target.workspaceRoot}`),
    },
    timezone: normalizeText(input.timezone),
    voiceSignal: input.voiceSignal ? {
      confidence: input.voiceSignal.confidence,
      durationMs: input.voiceSignal.durationMs,
      emotion: redactSensitiveText(input.voiceSignal.emotion),
      energy: input.voiceSignal.energy,
      source: input.voiceSignal.source,
      transcript: redactSensitiveText(input.voiceSignal.transcript),
    } : null,
  };
}

function redactSensitiveText(value: unknown): string {
  return normalizeText(value)
    .replace(/\/Users\/[^\s，。；,;:)）\]]+/gu, "[local-path]")
    .replace(/\/(?:home|Volumes|tmp|private\/var|var\/folders)\/[^\s，。；,;:)）\]]+/gu, "[local-path]")
    .replace(/[A-Za-z]:\\[^\s，。；,;:)）\]]+/gu, "[local-path]")
    .replace(/\bwx[-_a-zA-Z0-9]+\b/gu, "[user-id]");
}

function hashText(value: unknown): string {
  return crypto.createHash("sha256").update(normalizeText(value)).digest("hex").slice(0, 16);
}
