import type { RuntimeEvent } from "../../../contracts/runtime-events";
import type { RuntimeTurnSendState, UnknownRecord } from "../../../core/runtime-types";
import type { AppRuntimeConfig, RuntimeAdapterDescriptor } from "../../../core/app-service-contract";
import { resolveCodexWorkspaceRoot } from "../../../workspace/workspace-alias";
import { mapCodexMessageToRuntimeEvent } from "./events";
import { extractThreadId, type RuntimeMessage } from "./message-utils";
import { probeCodexAppServerCapabilities } from "../../../contracts/codex-capability";
import { SessionStore } from "./session-store";
import { SessionStoreWriter } from "./session-store-writer";
import {
  buildInstructionRefreshText,
  buildOpeningTurnText,
  buildWorkspaceBootstrapTurnText,
  loadWechatInstructions,
} from "./bootstrap";
import {
  type RuntimeClientLike,
  type WaitForTurnCompletionResult,
  normalizeText,
  sendUserMessageWithWorkspaceDiagnostics,
  startThreadWithWorkspaceDiagnostics,
  waitForTurnCompletion,
} from "./diagnostics";
import { createRuntimeLifecycle } from "./lifecycle";


type CodexRuntimeConfig = Pick<
  AppRuntimeConfig,
  | "sessionsFile"
  | "stateDir"
  | "runtimeEndpoint"
  | "runtimeCommand"
  | "weixinInstructionsFile"
  | "weixinOperationsFile"
  | "weixinInstructionsOverlayFile"
  | "weixinOperationsOverlayFile"
>;

interface RespondApprovalArgs {
  requestId: string | number;
  decision: string;
}

interface CancelTurnArgs {
  threadId: string;
  turnId: string;
}

interface ResumeThreadArgs {
  threadId: string;
}

interface RefreshThreadInstructionsArgs {
  bindingKey?: string;
  threadId: string;
  workspaceRoot: string;
  model?: string;
  effort?: string;
  accessMode?: string;
}

interface SendTextTurnArgs {
  bindingKey: string;
  workspaceRoot: string;
  text: string;
  metadata?: Record<string, unknown>;
  model?: string;
  effort?: string;
  accessMode?: string;
}

interface ReadyState {
  endpoint: string;
  models: unknown[];
}

interface CodexRuntimeAdapter {
  describe(): RuntimeAdapterDescriptor;
  createClient(): RuntimeClientLike;
  onEvent(listener: (event: RuntimeEvent<UnknownRecord>) => void): () => void;
  getSessionStore(): SessionStore;
  getSessionWriter(): SessionStoreWriter;
  initialize(): Promise<ReadyState>;
  close(): Promise<void>;
  respondApproval(args: RespondApprovalArgs): Promise<{ requestId: string | number; decision: "accept" | "decline" }>;
  cancelTurn(args: CancelTurnArgs): Promise<CancelTurnArgs>;
  resumeThread(args: ResumeThreadArgs): Promise<unknown>;
  probeRuntimeCapabilities(command: string): ReturnType<typeof probeCodexAppServerCapabilities>;
  refreshThreadInstructions(args: RefreshThreadInstructionsArgs): Promise<WaitForTurnCompletionResult & { threadId: string }>;
  sendTextTurn(args: SendTextTurnArgs): Promise<RuntimeTurnSendState>;
}

export function createCodexRuntimeAdapter(config: CodexRuntimeConfig): CodexRuntimeAdapter {
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  const sessionWriter = new SessionStoreWriter(sessionStore);
  const runtimeLifecycle = createRuntimeLifecycle({ config, sessionWriter });

  return {
    describe: runtimeLifecycle.describe,
    createClient() {
      return runtimeLifecycle.createClient();
    },
    onEvent(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      const runtimeClient = runtimeLifecycle.createClient();
      return runtimeClient.onMessage((message) => {
        const event = mapCodexMessageToRuntimeEvent(message);
        if (event) {
          listener(event);
        }
      });
    },
    getSessionStore() {
      return sessionStore;
    },
    getSessionWriter() {
      return sessionWriter;
    },
    async initialize() {
      return runtimeLifecycle.ensureInitialized();
    },
    async close() {
      await runtimeLifecycle.close();
    },
    async respondApproval({ requestId, decision }) {
      return runtimeLifecycle.withRuntimeReconnect(async (runtimeClient) => {
        const normalizedDecision = decision === "accept" ? "accept" : "decline";
        if (requestId == null || String(requestId).trim() === "") {
          throw new Error("approval response requires a requestId");
        }
        await runtimeClient.sendResponse(requestId, { decision: normalizedDecision });
        return {
          requestId,
          decision: normalizedDecision,
        };
      });
    },
    async cancelTurn({ threadId, turnId }) {
      return runtimeLifecycle.withRuntimeReconnect(async (runtimeClient) => {
        await runtimeClient.cancelTurn({ threadId, turnId });
        return { threadId, turnId };
      });
    },
    async resumeThread({ threadId }) {
      return runtimeLifecycle.withRuntimeReconnect((runtimeClient) => runtimeClient.resumeThread({ threadId }));
    },
    probeRuntimeCapabilities(command: string) {
      return probeCodexAppServerCapabilities(command || config.runtimeCommand || "codex");
    },
    async refreshThreadInstructions({
      bindingKey = "",
      threadId,
      workspaceRoot,
      model = "",
      effort = "",
      accessMode = "",
    }) {
      return runtimeLifecycle.withRuntimeReconnect(async (runtimeClient) => {
        const refreshText = buildInstructionRefreshText(config, workspaceRoot);
        const runtimeWorkspaceRoot = resolveCodexWorkspaceRoot(workspaceRoot);
        await runtimeClient.resumeThread({ threadId });
        const completion = waitForTurnCompletion(runtimeClient, threadId);
        await sendUserMessageWithWorkspaceDiagnostics({
          runtimeClient,
          params: {
            threadId,
            text: refreshText,
            model,
            effort,
            accessMode,
            workspaceRoot: runtimeWorkspaceRoot,
          },
          operation: "turn/start(refresh)",
          bindingKey,
          threadId,
          workspaceRoot,
          runtimeWorkspaceRoot,
        });
        const result = await completion;
        if (bindingKey) {
          await sessionWriter.rememberWorkspaceBootstrapForThread(bindingKey, workspaceRoot, threadId);
        }
        return { threadId, ...result };
      });
    },
    async sendTextTurn({
      bindingKey,
      workspaceRoot,
      text,
      metadata = {},
      model = "",
      effort = "",
      accessMode = "",
    }) {
      return runtimeLifecycle.withRuntimeReconnect(async (runtimeClient) => {
        // Codex websocket metadata currently breaks on non-ASCII workspace keys.
        // Keep session truth keyed by the canonical workspace root, but route the
        // actual runtime cwd through the existing machine-level ASCII alias map.
        const runtimeWorkspaceRoot = resolveCodexWorkspaceRoot(workspaceRoot);

        let threadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
        let outboundText = text;
        let startedNewThread = false;
        if (!threadId) {
          const response = await startThreadWithWorkspaceDiagnostics({
            runtimeClient,
            cwd: runtimeWorkspaceRoot,
            bindingKey,
            workspaceRoot,
            runtimeWorkspaceRoot,
          });
          threadId = normalizeText(extractThreadId(response as RuntimeMessage));
          if (!threadId) {
            throw new Error("thread/start did not return a thread id");
          }
          await sessionWriter.setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, metadata);
          startedNewThread = true;
        } else {
          await runtimeClient.resumeThread({ threadId }).catch(async () => {
            await sessionWriter.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
            const recreated = await startThreadWithWorkspaceDiagnostics({
              runtimeClient,
              cwd: runtimeWorkspaceRoot,
              bindingKey,
              workspaceRoot,
              runtimeWorkspaceRoot,
              threadId,
            });
            threadId = normalizeText(extractThreadId(recreated as RuntimeMessage));
            if (!threadId) {
              throw new Error("thread/start did not return a thread id");
            }
            await sessionWriter.setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, metadata);
            startedNewThread = true;
          });
        }

        const needsWorkspaceBootstrap = startedNewThread
          || !sessionStore.hasWorkspaceBootstrapForThread(bindingKey, workspaceRoot, threadId);
        if (startedNewThread) {
          outboundText = buildOpeningTurnText(config, workspaceRoot, text);
        } else if (needsWorkspaceBootstrap) {
          outboundText = buildWorkspaceBootstrapTurnText(config, workspaceRoot, text);
        }

        await sendUserMessageWithWorkspaceDiagnostics({
          runtimeClient,
          params: {
            threadId,
            text: outboundText,
            model,
            effort,
            accessMode,
            workspaceRoot: runtimeWorkspaceRoot,
          },
          operation: "turn/start",
          bindingKey,
          threadId,
          workspaceRoot,
          runtimeWorkspaceRoot,
        });
        return {
          threadId,
          workspaceBootstrapPending: needsWorkspaceBootstrap,
        };
      });
    },
  };
}

export const __testing = {
  waitForTurnCompletion,
};

export { loadWechatInstructions };
