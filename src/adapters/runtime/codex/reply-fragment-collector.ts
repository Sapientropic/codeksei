import {
  RUNTIME_EVENT_TYPES,
  normalizeRuntimeIdentifier,
  normalizeRuntimeReplyText,
  normalizeRuntimeText,
  type RuntimeEvent,
} from "../../../contracts/runtime-events";
import type { UnknownRecord } from "../../../core/runtime-types";
import { appendCodexTextFragment } from "./message-utils";

export interface ReplyFragmentCollectorState {
  activeTurnId: string;
  itemOrder: string[];
  textByItemId: Map<string, string>;
}

export function createReplyFragmentCollectorState(): ReplyFragmentCollectorState {
  return {
    activeTurnId: "",
    itemOrder: [],
    textByItemId: new Map<string, string>(),
  };
}

export function observeReplyFragmentTurnStart(
  state: ReplyFragmentCollectorState,
  event: RuntimeEvent<UnknownRecord> | null | undefined,
): boolean {
  if (event?.type !== RUNTIME_EVENT_TYPES.TURN_STARTED || state.activeTurnId) {
    return false;
  }
  state.activeTurnId = normalizeRuntimeIdentifier(event.payload.turnId);
  return true;
}

export function collectReplyFragment(
  state: ReplyFragmentCollectorState,
  event: RuntimeEvent<UnknownRecord> | null | undefined,
): boolean {
  if (
    event?.type !== RUNTIME_EVENT_TYPES.REPLY_DELTA
    && event?.type !== RUNTIME_EVENT_TYPES.REPLY_COMPLETED
  ) {
    return false;
  }

  const itemId = normalizeRuntimeIdentifier(event.payload.itemId) || `item-${state.itemOrder.length + 1}`;
  if (!state.textByItemId.has(itemId)) {
    state.itemOrder.push(itemId);
    state.textByItemId.set(itemId, "");
  }

  const nextText = normalizeRuntimeReplyText(event.payload.text);
  if (!nextText) {
    return true;
  }

  if (event.type === RUNTIME_EVENT_TYPES.REPLY_DELTA && normalizeFragmentKind(event.payload.fragmentKind) === "delta") {
    state.textByItemId.set(itemId, appendCodexTextFragment(state.textByItemId.get(itemId) || "", nextText));
    return true;
  }

  state.textByItemId.set(itemId, nextText);
  return true;
}

export function shouldIgnoreReplyFragmentTurnCompletion(
  state: ReplyFragmentCollectorState,
  event: RuntimeEvent<UnknownRecord> | null | undefined,
): boolean {
  const completedTurnId = normalizeRuntimeIdentifier(event?.payload?.turnId);
  return Boolean(state.activeTurnId && completedTurnId && completedTurnId !== state.activeTurnId);
}

export function resolveReplyFragmentCollectorText(state: ReplyFragmentCollectorState): string {
  return state.itemOrder
    .slice()
    .reverse()
    .map((itemId) => state.textByItemId.get(itemId) || "")
    .find((value) => value.trim()) || "";
}

export function resolveReplyFragmentCollectorTurnId(
  state: ReplyFragmentCollectorState,
  event: RuntimeEvent<UnknownRecord> | null | undefined,
): string {
  return normalizeRuntimeIdentifier(event?.payload?.turnId) || state.activeTurnId;
}

function normalizeFragmentKind(value: unknown): "delta" | "snapshot" | "" {
  const normalized = normalizeRuntimeText(value).toLowerCase();
  if (normalized === "delta" || normalized === "snapshot") {
    return normalized;
  }
  return "";
}
