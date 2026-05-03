import type { PulseCardType, PulseSourceRef } from "./contracts";

export interface PulseCandidate {
  date: string;
  detailsMarkdown: string;
  sourceRefs: PulseSourceRef[];
  suggestedPrompt: string;
  summary: string;
  title: string;
  topic: string;
  type: PulseCardType;
  why: string;
}
