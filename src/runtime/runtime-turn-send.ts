import { supportsRuntimeOperation as canUseRuntimeOperation } from "../core/app-service-contract";
import type {
  NormalizedIncomingMessage,
  PreparedRuntimeMessage,
  RuntimeTurnSendResult,
} from "../core/runtime-types";
import type {
  RuntimeTurnSendDependencies,
} from "./runtime-turn-contract";

export interface RuntimeTurnSend {
  sendPreparedMessageToRuntime(args: {
    bindingKey: string;
    workspaceRoot: string;
    normalized: NormalizedIncomingMessage;
    prepared: PreparedRuntimeMessage;
  }): Promise<RuntimeTurnSendResult>;
}

export function createRuntimeTurnSend(
  dependencies: RuntimeTurnSendDependencies,
): RuntimeTurnSend {
  return {
    async sendPreparedMessageToRuntime({
      bindingKey,
      workspaceRoot,
      normalized,
      prepared,
    }: {
      bindingKey: string;
      workspaceRoot: string;
      normalized: NormalizedIncomingMessage;
      prepared: PreparedRuntimeMessage;
    }): Promise<RuntimeTurnSendResult> {
      if (!canUseRuntimeOperation(dependencies.runtimeAdapter, "interactiveTurn")) {
        return {
          status: "retryable_error",
          reason: "当前宿主不支持 interactive runtime turn。",
        };
      }
      try {
        const turn = await dependencies.withUserTyping({
          userId: normalized.senderId,
          contextToken: normalized.contextToken,
          // A successful runtime turn keeps typing alive until the runtime
          // event stream or watchdog settles it. Only the local failure path
          // should clear typing here.
          clearOnSuccess: false,
        }, async () => {
          const sendArgs: {
            bindingKey: string;
            workspaceRoot: string;
            text: string;
            model?: string;
            effort?: string;
            accessMode?: string;
            metadata?: Record<string, unknown>;
          } = {
            bindingKey,
            workspaceRoot,
            text: prepared.text,
          };
          const metadata: Record<string, unknown> = {
            workspaceId: prepared.workspaceId,
            accountId: prepared.accountId,
            senderId: prepared.senderId,
          };
          if (prepared.provider === "system") {
            metadata.systemMessage = {
              kind: dependencies.normalizeText(prepared.systemMessageKind) || "manual",
              messageId: prepared.messageId,
              checkinTriggerId: dependencies.normalizeText(prepared.checkinTriggerId),
            };
          }
          sendArgs.metadata = metadata;

          const runtimeParams = dependencies.runtimeAdapter.getSessionStore()
            .getRuntimeParamsForWorkspace(bindingKey, workspaceRoot);
          if (runtimeParams.model) {
            sendArgs.model = runtimeParams.model;
          }
          if (runtimeParams.effort) {
            sendArgs.effort = runtimeParams.effort;
          }
          const accessMode = dependencies.normalizeText(dependencies.config.runtimeAccessMode);
          if (accessMode) {
            sendArgs.accessMode = accessMode;
          }
          return dependencies.runtimeAdapter.sendTextTurn(sendArgs);
        });

        dependencies.streamDelivery.queueReplyTargetForThread(turn.threadId, {
          userId: prepared.senderId,
          contextToken: prepared.contextToken,
          provider: prepared.provider,
        });
        if (turn.workspaceBootstrapPending) {
          dependencies.queuePendingWorkspaceBootstrap({
            bindingKey,
            workspaceRoot,
            threadId: turn.threadId,
          });
        }
        dependencies.scheduleRuntimeEventWatchdog({
          bindingKey,
          workspaceRoot,
          normalized: prepared,
          threadId: turn.threadId,
        });
        return {
          status: "sent",
          threadId: turn.threadId,
        };
      } catch (error) {
        return {
          status: "retryable_error",
          reason: dependencies.formatErrorMessage(error),
          error,
        };
      }
    },
  };
}
