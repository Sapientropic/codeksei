import { mapCodexMessageToRuntimeEvent } from "../adapters/runtime/codex/events";
import { CodexRpcClient } from "../adapters/runtime/codex/rpc-client";
import {
  extractThreadId,
  extractThreadIdFromParams,
} from "../adapters/runtime/codex/message-utils";
import { RUNTIME_EVENT_TYPES } from "../contracts/runtime-events";
import { resolveCodexWorkspaceRoot } from "../workspace/workspace-alias";
import {
  collectReplyFragment,
  createReplyFragmentCollectorState,
  observeReplyFragmentTurnStart,
  resolveReplyFragmentCollectorText,
  shouldIgnoreReplyFragmentTurnCompletion,
} from "../adapters/runtime/codex/reply-fragment-collector";
import {
  buildSemanticPrompt,
  type SemanticReviewConfig,
  type SemanticReviewInput,
} from "./review-semantic-prompt";
import {
  asRecord,
  normalizeText,
  parseSemanticJson,
} from "./review-semantic-normalize";

export interface RuntimeSemanticClient {
  onMessage(listener: (message: unknown) => void): () => void;
}

export async function runCodexSemanticReview(
  config: SemanticReviewConfig = {},
  input: SemanticReviewInput = {},
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const prompt = buildSemanticPrompt(input);
  const model = normalizeText(input?.options?.model || config.reviewSemanticModel);
  const workspaceRoot = resolveCodexWorkspaceRoot(input?.profile?.workspaceRoot || config.workspaceRoot || process.cwd());
  const client = new CodexRpcClient({
    endpoint: normalizeText(config.codexEndpoint),
    codexCommand: normalizeText(config.codexCommand),
    env: process.env,
    extraWritableRoots: normalizeText(config.stateDir) ? [normalizeText(config.stateDir)] : [],
  });

  try {
    await client.connect();
    await client.initialize();
    const response = await client.startThread({ cwd: workspaceRoot });
    const threadId = extractThreadId(
      response as Parameters<typeof extractThreadId>[0]
    );
    if (!threadId) {
      throw new Error("semantic review did not return a thread id");
    }
    const completion = waitForSemanticTurnCompletion(client, threadId, timeoutMs);
    await client.sendUserMessage({
      threadId,
      text: prompt,
      model: model || null,
      workspaceRoot,
    });
    const text = await completion;
    return parseSemanticJson(text);
  } finally {
    await client.close().catch(() => {});
  }
}

export function waitForSemanticTurnCompletion(
  client: RuntimeSemanticClient,
  threadId: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const collector = createReplyFragmentCollectorState();

    const cleanup = () => {
      unsubscribe();
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`semantic review timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const unsubscribe = client.onMessage((message: unknown) => {
      const params = asRecord(asRecord(message).params);
      // Keep semantic review on the same normalized runtime event contract as
      // the main chat/runtime path. Otherwise upstream RPC drift gets fixed in
      // one place and silently reintroduced here.
      const runtimeEvent = mapCodexMessageToRuntimeEvent(
        message as Parameters<typeof mapCodexMessageToRuntimeEvent>[0]
      );
      const messageThreadId = normalizeText(runtimeEvent?.payload?.threadId)
        || extractThreadIdFromParams(params);
      if (messageThreadId && messageThreadId !== threadId) {
        return;
      }

      if (observeReplyFragmentTurnStart(collector, runtimeEvent)) {
        return;
      }

      // Review summarization is meant to be a pure thinking pass over the
      // provided source pack. If Codex wants tools or escalation here, the
      // safe behavior is to abort and fall back to deterministic extraction.
      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED) {
        cleanup();
        reject(new Error("semantic review requested approval"));
        return;
      }

      if (collectReplyFragment(collector, runtimeEvent)) {
        return;
      }

      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.TURN_FAILED) {
        cleanup();
        reject(new Error(normalizeText(runtimeEvent.payload.text) || "semantic review failed"));
        return;
      }

      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.TURN_COMPLETED) {
        if (shouldIgnoreReplyFragmentTurnCompletion(collector, runtimeEvent)) {
          return;
        }
        cleanup();
        // Semantic review expects the terminal JSON payload. Codex can emit
        // multiple assistant messages within one turn, so concatenating every
        // message here risks mixing progress chatter into the final JSON blob.
        const text = resolveReplyFragmentCollectorText(collector);
        if (!text) {
          reject(new Error("semantic review returned empty text"));
          return;
        }
        resolve(String(text).trim());
      }
    });
  });
}
