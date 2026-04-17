import * as nodeCrypto from "node:crypto";

import type { ContextBoardConfig } from "../context/board";
import { bestEffortRefreshContextBoard } from "../context/board";
import { normalizeText } from "../core/text-normalization";
import {
  rememberCompanionMemory,
  type CompanionMemoryRememberResult,
  type CompanionMemoryRuntimeConfig,
  type CompanionMemoryWrite,
} from "../companion-memory/remember";
import {
  extractCompanionProfileSignalUpdatesFromText,
  resolveCompanionProfileSignals,
} from "../companion-memory/profile-signals";
import { normalizeCompanionProfileLanguage } from "../companion-memory/profile-signal-contracts";
import type { CompanionMemorySemanticGap } from "../companion-memory/semantic-normalize";
import {
  createDefaultOnboardingCoverage,
  createOnboardingStateStore,
  isOnboardingReady,
  type OnboardingDomainCoverage,
  type OnboardingCoverage,
  type OnboardingSlotCoverage,
  type OnboardingSlotId,
  type OnboardingState,
  type OnboardingStatus,
} from "./state";

export interface OnboardingRuntimeConfig extends ContextBoardConfig, CompanionMemoryRuntimeConfig {
  cliIdempotencyLedgerFile?: string;
}

export type ExtractedOnboardingWrite = CompanionMemoryWrite;

export interface OnboardingConversationResult {
  assistantMessage: string;
  noteFiles: string[];
  state: OnboardingState;
  writes: ExtractedOnboardingWrite[];
}

const MAX_ONBOARDING_TURNS = 8;

type OnboardingConversationLanguage = "zh-CN" | "en";

const SLOT_PROMPTS: Record<OnboardingConversationLanguage, Record<OnboardingSlotId, string[]>> = {
  "zh-CN": {
    current_status: [
      "先别把自己整理成一张表。你就顺着说说，最近的生活和最占心的那件事，大概是什么样？",
      "我们先不急着定义一切。你这阵子主要在过什么样的日子，脑子里最常挂着哪条线？",
    ],
    rhythm: [
      "我想摸一下你的节奏。你一天里通常什么时候最有精神，什么时候我最好别冒出来？",
      "顺着刚才那条线再说一句就够了: 你一般什么时段比较能动，什么时段我别打扰你？",
    ],
    preference: [
      "如果我要陪你把事接住，你更喜欢我短一点直接一点，还是多展开一点慢慢说？",
      "我也想知道你舒服的说话方式。你更喜欢我利落一点，还是更像有人陪着你一起展开一点？",
    ],
    boundary: [
      "还有个边界我想先记住。有没有什么事是我别碰的，或者必须先问过你的？",
      "你可以先把不舒服的地方告诉我。什么做法会让你烦，或者哪些事我一定要先征求你？",
    ],
    next: [
      "最后先替你接住一条最近会发生的事。接下来最可能先出现、最值得我记着的那件事是什么？",
      "我想先记住一个很近的落点。接下来这几天，最可能先发生、也最希望我帮你接上的是什么？",
    ],
  },
  en: {
    current_status: [
      "Let's skip the form. What has life felt like lately, and what's the thing sitting heaviest on your mind right now?",
      "We do not need to define everything at once. What kind of days have you been living lately, and what thread do you keep returning to?",
    ],
    rhythm: [
      "I want to get a feel for your rhythm. When do you usually have energy, and when should I keep quiet?",
      "Just one more detail on that line: what times of day are you usually more able to move, and when should I leave you alone?",
    ],
    preference: [
      "If I'm helping you stay with things, do you want me short and direct, or a bit more expansive and companionable?",
      "I also want to learn how you like to be supported. Do you prefer crisp and efficient, or a little more like someone staying with you in the thread?",
    ],
    boundary: [
      "There's one boundary I'd like to remember early. Is there anything I shouldn't touch, or anything I should always ask before doing?",
      "You can start with what feels bad. What kind of move would annoy you, or what should I always check with you before I do it?",
    ],
    next: [
      "Let me hold one near-term thing for you. What's the most likely next thing coming up soon that you'd want me to remember?",
      "I want to keep one close re-entry point in view. In the next few days, what's most likely to happen first, and what would you most want me to help you pick back up?",
    ],
  },
};

const ACK_LINES: Record<OnboardingConversationLanguage, Record<OnboardingSlotId, string>> = {
  "zh-CN": {
    boundary: "这条边界我会认真记着。",
    current_status: "我大概知道你最近在过什么了。",
    next: "好，我先把那条近线记着。",
    preference: "你舒服的说话方式我记下来了。",
    rhythm: "你的节奏我先摸到了。",
  },
  en: {
    boundary: "I'll keep that boundary in mind.",
    current_status: "I have a better sense of what life has been like lately.",
    next: "Okay, I'll hold that near-term thread for you.",
    preference: "I've got a clearer sense of how you want me to sound.",
    rhythm: "I have a better feel for your rhythm now.",
  },
};

export function startOnboardingConversation(
  config: OnboardingRuntimeConfig,
  userId: string,
  now: Date = new Date(),
): OnboardingConversationResult {
  const store = createOnboardingStateStore(config, userId);
  const current = store.getState();
  const language = resolveOnboardingLanguage(config, userId);

  if (current.status === "ready") {
    return {
      assistantMessage: language === "en"
        ? "I already have a decent sense of you, so we do not need to restart this. If something shifts, just tell me naturally and I'll update along the way."
        : "我已经大概有个你的样子了，后面不用重来。要是最近有变化，就像平常聊天一样告诉我，我会顺手改。",
      noteFiles: [],
      state: current,
      writes: [],
    };
  }

  if (current.status === "in_progress" || current.status === "followup_needed") {
    return {
      assistantMessage: buildPromptForMissingSlot(current.missingSlots, current.turnCount, [], language),
      noteFiles: [],
      state: current,
      writes: [],
    };
  }

  const nextState = store.setState({
    coverage: createDefaultOnboardingCoverage(),
    missingSlots: [],
    sessionId: cryptoRandomUuid(),
    status: "in_progress",
    turnCount: 1,
    updatedAt: now.toISOString(),
  });
  return {
    assistantMessage: buildPromptForMissingSlot(nextState.missingSlots, nextState.turnCount, [], language),
    noteFiles: [],
    state: nextState,
    writes: [],
  };
}

export async function stepOnboardingConversation(
  config: OnboardingRuntimeConfig,
  {
    sessionId,
    text,
    userId,
  }: {
    sessionId: string;
    text: string;
    userId: string;
  },
  now: Date = new Date(),
): Promise<OnboardingConversationResult> {
  const store = createOnboardingStateStore(config, userId);
  const current = store.getState();
  const normalizedSessionId = normalizeText(sessionId);
  if (!normalizedSessionId || !current.sessionId) {
    throw new Error("当前还没有进行中的 onboarding session，请先执行 onboarding start。");
  }
  if (current.sessionId !== normalizedSessionId) {
    throw new Error("onboarding session 已变化，请重新获取最新 sessionId。");
  }

  const normalizedText = normalizeText(text);
  const remembered = await rememberCompanionMemory(config, {
    options: {
      onboarding_state: {
        missing_slots: current.missingSlots,
        status: current.status,
        turn_count: current.turnCount,
      },
    },
    refreshBoard: false,
    source: "onboarding_turn",
    state: current,
    text: normalizedText,
    userId,
    workspaceRoot: config.workspaceRoot,
  }, now);
  const nextCoverage = mergeCoverage(current.coverage, remembered.writes);
  const nextTurnCount = current.status === "ready"
    ? current.turnCount
    : Math.min(current.turnCount + 1, MAX_ONBOARDING_TURNS);
  const nextStatus = resolveNextOnboardingStatus(nextCoverage, nextTurnCount);
  const nextState = store.setState({
    coverage: nextCoverage,
    missingSlots: [],
    sessionId: current.sessionId,
    status: nextStatus,
    turnCount: nextTurnCount,
    updatedAt: now.toISOString(),
  });
  refreshOnboardingContextBoard(config, userId);
  const language = resolveOnboardingLanguage(config, userId, [
    normalizedText,
    ...remembered.writes.map((write) => write.text),
  ]);

  return {
    assistantMessage: buildAssistantReply({
      gaps: remembered.gaps,
      language,
      missingSlots: nextState.missingSlots,
      status: nextState.status,
      turnCount: nextState.turnCount,
      writes: remembered.writes,
    }),
    noteFiles: remembered.noteFiles,
    state: nextState,
    writes: remembered.writes,
  };
}

export function getOnboardingStatus(
  config: OnboardingRuntimeConfig,
  userId: string,
): OnboardingState {
  return createOnboardingStateStore(config, userId).getState();
}

export function resetOnboardingState(
  config: OnboardingRuntimeConfig,
  userId: string,
): OnboardingState {
  return createOnboardingStateStore(config, userId).reset();
}

function mergeCoverage(
  coverage: OnboardingCoverage,
  writes: ExtractedOnboardingWrite[],
): OnboardingCoverage {
  const nextSlotCoverage: OnboardingSlotCoverage = {
    ...coverage.slots,
  };
  const nextDomainCoverage: OnboardingDomainCoverage = {
    ...coverage.domains,
  };
  for (const slotId of new Set(writes.map((write) => write.slotId))) {
    nextSlotCoverage[slotId] += 1;
  }
  for (const domain of new Set(
    writes
      .map((write) => write.domain)
      .filter(Boolean) as Array<keyof OnboardingDomainCoverage>,
  )) {
    nextDomainCoverage[domain] += 1;
  }
  return {
    domains: nextDomainCoverage,
    slots: nextSlotCoverage,
  };
}

function resolveNextOnboardingStatus(
  coverage: OnboardingCoverage,
  turnCount: number,
): OnboardingStatus {
  if (isOnboardingReady(coverage)) {
    return "ready";
  }
  if (turnCount >= MAX_ONBOARDING_TURNS) {
    return "followup_needed";
  }
  return "in_progress";
}

function buildAssistantReply({
  gaps,
  language,
  missingSlots,
  status,
  turnCount,
  writes,
}: {
  gaps: CompanionMemorySemanticGap[];
  language: OnboardingConversationLanguage;
  missingSlots: OnboardingSlotId[];
  status: OnboardingStatus;
  turnCount: number;
  writes: ExtractedOnboardingWrite[];
}): string {
  const ack = buildAckPrefix(writes, language);
  if (status === "ready") {
    return [ack, language === "en"
      ? "Okay, I have a decent sense of your rhythm now. You do not need to explain yourself from scratch every time. If something changes, just say it naturally and I'll keep up."
      : "好，我已经大概摸到你的节奏了。后面你不用每次都从头解释自己，有变化直接顺手告诉我，我会跟着更新。",
    ].filter(Boolean).join(" ");
  }
  if (status === "followup_needed") {
    return [ack, language === "en"
      ? "I do not want to turn this into an intake form. There's still a little missing, and I'll gently pick it up later when the moment is better."
      : "我先不把这次聊成一份调查表。还缺的那一点，后面我会在合适的时候轻轻补一句。",
    ].filter(Boolean).join(" ");
  }
  if (!writes.length) {
    return [pickNoWritePreface(turnCount, language), buildPromptForMissingSlot(missingSlots, turnCount, gaps, language)].filter(Boolean).join(" ");
  }
  return [ack, buildPromptForMissingSlot(missingSlots, turnCount, gaps, language)].filter(Boolean).join(" ");
}

function buildAckPrefix(
  writes: ExtractedOnboardingWrite[],
  language: OnboardingConversationLanguage,
): string {
  const slotIds = Array.from(new Set(writes.map((write) => write.slotId)));
  return slotIds.slice(0, 2).map((slotId) => ACK_LINES[language][slotId]).filter(Boolean).join(" ");
}

function buildPromptForMissingSlot(
  missingSlots: OnboardingSlotId[],
  turnCount: number,
  gaps: CompanionMemorySemanticGap[],
  language: OnboardingConversationLanguage,
): string {
  const nextSlot = resolveNextPromptSlot(missingSlots, gaps);
  const prompts = SLOT_PROMPTS[language][nextSlot];
  return prompts[turnCount % prompts.length] || prompts[0] || "";
}

function resolveNextPromptSlot(missingSlots: OnboardingSlotId[], gaps: CompanionMemorySemanticGap[]): OnboardingSlotId {
  const gapOrder = { high: 0, medium: 1, low: 2 };
  const gapSlot = [...gaps]
    .filter((gap) => gap.slotId && missingSlots.includes(gap.slotId))
    .sort((left, right) => gapOrder[left.priority] - gapOrder[right.priority])[0]?.slotId;
  return gapSlot || missingSlots[0] || "current_status";
}

function pickNoWritePreface(
  turnCount: number,
  language: OnboardingConversationLanguage,
): string {
  const options = language === "en"
    ? [
      "That's okay, you do not need to explain yourself all at once.",
      "No need to package this into a neat answer. Just say a little in the shape it comes.",
    ]
    : [
      "没关系，你不用一下子把自己讲得很完整。",
      "不用替我整理答案，顺口说一点就够了。",
    ];
  return options[turnCount % options.length] || options[0] || "";
}

function refreshOnboardingContextBoard(
  config: OnboardingRuntimeConfig,
  userId: string,
): void {
  if (!normalizeText(config.workspaceRoot)) {
    return;
  }
  bestEffortRefreshContextBoard(config, {
    mode: "proactive",
    user: userId,
    workspace: normalizeText(config.workspaceRoot),
  });
}

function cryptoRandomUuid(): string {
  if (typeof nodeCrypto.randomUUID === "function") {
    return nodeCrypto.randomUUID();
  }
  return `onboarding-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resolveOnboardingLanguage(
  config: OnboardingRuntimeConfig,
  userId: string,
  candidateTexts: string[] = [],
): OnboardingConversationLanguage {
  for (const text of candidateTexts) {
    const detected = normalizeCompanionProfileLanguage(
      extractCompanionProfileSignalUpdatesFromText(text).preferredLanguage,
    );
    if (detected) {
      return detected;
    }
  }
  const signals = resolveCompanionProfileSignals(config, userId);
  return normalizeCompanionProfileLanguage(
    signals.preferredLanguage || config.userLanguage,
  ) || "zh-CN";
}
