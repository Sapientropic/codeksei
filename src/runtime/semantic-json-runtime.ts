import { spawnSync } from "node:child_process";

import { mapCodexMessageToRuntimeEvent } from "../adapters/runtime/codex/events";
import { extractThreadId, extractThreadIdFromParams } from "../adapters/runtime/codex/message-utils";
import {
  collectReplyFragment,
  createReplyFragmentCollectorState,
  observeReplyFragmentTurnStart,
  resolveReplyFragmentCollectorText,
  shouldIgnoreReplyFragmentTurnCompletion,
} from "../adapters/runtime/codex/reply-fragment-collector";
import { CodexRpcClient } from "../adapters/runtime/codex/rpc-client";
import { RUNTIME_EVENT_TYPES } from "../contracts/runtime-events";
import { ignoreCleanupError } from "../core/error-handling";
import {
  asRecord,
  normalizeText,
  parseSemanticJson,
  type JsonObject,
} from "../core/semantic-json";
import { resolveCodexWorkspaceRoot } from "../workspace/workspace-alias";

export interface RuntimeSemanticClient {
  onMessage(listener: (message: unknown) => void): () => void;
}

export interface SemanticJsonRuntimeConfig {
  hermesCommand?: unknown;
  proactiveJudgmentApiKey?: unknown;
  proactiveJudgmentEndpoint?: unknown;
  runtimeCommand?: unknown;
  runtimeEndpoint?: unknown;
  stateDir?: unknown;
}

export interface SemanticJsonRunInput {
  label: string;
  model?: unknown;
  prompt: string;
  timeoutMs: number;
  workspaceRoot?: unknown;
}

export async function runCodexSemanticJson(
  config: SemanticJsonRuntimeConfig = {},
  input: SemanticJsonRunInput,
): Promise<JsonObject> {
  const workspaceRoot = resolveCodexWorkspaceRoot(input.workspaceRoot || process.cwd());
  const client = new CodexRpcClient({
    endpoint: normalizeText(config.runtimeEndpoint),
    codexCommand: normalizeText(config.runtimeCommand),
    env: process.env,
    extraWritableRoots: normalizeText(config.stateDir) ? [normalizeText(config.stateDir)] : [],
  });

  try {
    await client.connect();
    await client.initialize();
    const response = await client.startThread({ cwd: workspaceRoot });
    const threadId = extractThreadId(response as Parameters<typeof extractThreadId>[0]);
    if (!threadId) {
      throw new Error(`${input.label} did not return a thread id`);
    }
    const completion = waitForSemanticJsonTurnCompletion(client, threadId, input.timeoutMs, input.label);
    await client.sendUserMessage({
      threadId,
      text: input.prompt,
      model: normalizeText(input.model) || null,
      workspaceRoot,
    });
    const text = await completion;
    return parseSemanticJson(text);
  } finally {
    await ignoreCleanupError(client.close(), {
      label: `${input.label} client close`,
      reason: "semantic extraction client teardown should not mask the result",
    });
  }
}

export function runHermesSemanticJson(
  config: SemanticJsonRuntimeConfig = {},
  input: SemanticJsonRunInput,
): JsonObject {
  const hermesCommand = normalizeText(config.hermesCommand) || "hermes";
  const model = normalizeText(input.model);
  const workspaceRoot = normalizeText(input.workspaceRoot || process.cwd());

  // Hermes currently accepts semantic extraction via a one-shot CLI call.
  // On Windows, oversized argv payloads can truncate silently across shell
  // boundaries, so fail closed here and let callers fall back deterministically.
  if (process.platform === "win32" && input.prompt.length > 6_000) {
    throw new Error(`${input.label} prompt is too large for safe Windows CLI argument transport`);
  }

  const args = ["chat", "-Q", "-q", input.prompt];
  if (model) {
    args.push("--model", model);
  }

  const useShell = process.platform === "win32" && /\.(cmd|bat)$/iu.test(hermesCommand);
  const result = spawnSync(hermesCommand, args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    shell: useShell,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: input.timeoutMs,
    windowsHide: true,
  });

  if (result.error instanceof Error) {
    throw new Error(`${input.label} failed: ${result.error.message}`);
  }
  if (result.signal === "SIGTERM" || result.signal === "SIGKILL") {
    throw new Error(`${input.label} timed out after ${input.timeoutMs}ms`);
  }
  if (result.status !== 0) {
    const detail = normalizeText(result.stderr) || normalizeText(result.stdout) || `exit ${String(result.status)}`;
    throw new Error(`${input.label} failed: ${detail}`);
  }

  const output = normalizeText(result.stdout);
  if (!output) {
    throw new Error(`${input.label} returned empty text`);
  }
  return parseSemanticJson(output);
}

export async function runOpenAICompatibleSemanticJson(
  config: SemanticJsonRuntimeConfig = {},
  input: SemanticJsonRunInput,
): Promise<JsonObject> {
  const endpoint = normalizeText(config.proactiveJudgmentEndpoint);
  if (!endpoint) {
    throw new Error(`${input.label} missing OpenAI-compatible endpoint`);
  }
  const url = resolveChatCompletionsUrl(endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, input.timeoutMs));
  try {
    const response = await fetch(url, {
      body: JSON.stringify({
        messages: [
          {
            content: input.prompt,
            role: "user",
          },
        ],
        model: normalizeText(input.model),
        response_format: { type: "json_object" },
        stream: false,
        temperature: 0,
      }),
      headers: buildOpenAICompatibleHeaders(config),
      method: "POST",
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${input.label} failed: HTTP ${response.status} ${normalizeText(text)}`);
    }
    const body = parseSemanticJson(text);
    const content = extractOpenAICompatibleContent(body);
    if (!content) {
      throw new Error(`${input.label} returned no message content`);
    }
    return parseSemanticJson(content);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${input.label} timed out after ${input.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function waitForSemanticJsonTurnCompletion(
  client: RuntimeSemanticClient,
  threadId: string,
  timeoutMs: number,
  label: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const collector = createReplyFragmentCollectorState();

    const cleanup = () => {
      unsubscribe();
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const unsubscribe = client.onMessage((message: unknown) => {
      const params = asRecord(asRecord(message).params);
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

      // Semantic extraction is a pure backstage pass over the provided source
      // pack. Any tool request or approval here means the host is drifting away
      // from the contract, so callers must fall back to deterministic parsing.
      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.APPROVAL_REQUESTED) {
        cleanup();
        reject(new Error(`${label} requested approval`));
        return;
      }

      if (collectReplyFragment(collector, runtimeEvent)) {
        return;
      }

      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.TURN_FAILED) {
        cleanup();
        reject(new Error(normalizeText(runtimeEvent.payload.text) || `${label} failed`));
        return;
      }

      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.TURN_COMPLETED) {
        if (shouldIgnoreReplyFragmentTurnCompletion(collector, runtimeEvent)) {
          return;
        }
        cleanup();
        const text = resolveReplyFragmentCollectorText(collector);
        if (!text) {
          reject(new Error(`${label} returned empty text`));
          return;
        }
        resolve(String(text).trim());
      }
    });
  });
}

function buildOpenAICompatibleHeaders(config: SemanticJsonRuntimeConfig): Record<string, string> {
  const apiKey = normalizeText(config.proactiveJudgmentApiKey);
  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    "Content-Type": "application/json",
  };
}

function resolveChatCompletionsUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/u, "");
  if (/\/chat\/completions$/u.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

function extractOpenAICompatibleContent(body: JsonObject): string {
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const first = asRecord(choices[0]);
  const message = asRecord(first.message);
  return normalizeText(message.content || first.text || body.output_text);
}
