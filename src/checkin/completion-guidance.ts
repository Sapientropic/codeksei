export const CHECKIN_COMPLETION_SLEEP_FOR_PLACEHOLDER = "<duration>";

export const CHECKIN_COMPLETION_CONTEXT_GUIDANCE =
  "Choose --sleep-for based on the user's current state and time of day: shorter during active daytime, longer during sleep or late-night quiet hours.";

export const CHECKIN_COMPLETION_DURATION_GUIDANCE = [
  "Use shorter intervals during active daytime, such as 1-2h after a meaningful check-in or when you expect a near-term follow-up.",
  "Use medium intervals such as 2-4h when the user seems busy, in deep work, or unlikely to need another nudge soon.",
  "Use longer intervals such as 6-8h overnight or when the user is likely asleep.",
];

export function buildCheckinCompletionDurationGuidanceLines(): string[] {
  return [...CHECKIN_COMPLETION_DURATION_GUIDANCE];
}
