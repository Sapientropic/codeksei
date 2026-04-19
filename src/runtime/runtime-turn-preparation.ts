import { ignoreBestEffortError } from "../core/error-handling";
import { userFacingMessages } from "../core/message-catalog";
import { supportsChannelOperation as canUseChannelOperation } from "../core/app-service-contract";
import type {
  NormalizedIncomingMessage,
  PreparedRuntimeMessage,
} from "../core/runtime-types";
import type { IncomingWeixinAttachment } from "../contracts/weixin-media";
import type {
  RuntimeTurnPreparationDependencies,
} from "./runtime-turn-contract";
import {
  buildPendingProactiveHandoffPrelude,
  readPendingProactiveHandoff,
} from "./pending-proactive-handoff";

export interface RuntimeTurnPreparation {
  prepareIncomingMessageForRuntime(
    normalized: NormalizedIncomingMessage,
    workspaceRoot: string,
  ): Promise<PreparedRuntimeMessage | null>;
}

export function createRuntimeTurnPreparation(
  dependencies: RuntimeTurnPreparationDependencies,
): RuntimeTurnPreparation {
  return {
    async prepareIncomingMessageForRuntime(
      normalized: NormalizedIncomingMessage,
      workspaceRoot: string,
    ): Promise<PreparedRuntimeMessage | null> {
      const pendingProactiveHandoff = readPendingProactiveHandoff({
        checkinScheduleStateFile: dependencies.config.checkinScheduleStateFile || "",
      }, {
        senderId: normalized.senderId,
        workspaceRoot,
      });
      const attachments = Array.isArray(normalized.attachments)
        ? normalized.attachments as IncomingWeixinAttachment[]
        : [];
      if (!attachments.length) {
        const runtimeInboundText = decorateRuntimeInboundText(
          dependencies.buildRuntimeInboundText(normalized, { saved: [], failed: [] }, dependencies.config),
          pendingProactiveHandoff,
        );
        return {
          ...normalized,
          originalText: normalized.text,
          text: runtimeInboundText,
          attachments: [],
          attachmentFailures: [],
          pendingProactiveHandoff,
          workspaceRoot,
        };
      }

      const persisted = await dependencies.persistIncomingWeixinAttachments({
        attachments,
        stateDir: dependencies.config.stateDir,
        cdnBaseUrl: dependencies.config.weixinCdnBaseUrl,
        messageId: normalized.messageId,
        receivedAt: normalized.receivedAt,
        workspaceRoot,
      });

      if (!persisted.saved.length && persisted.failed.length && !String(normalized.text || "").trim()) {
        if (canUseChannelOperation(dependencies.channelAdapter, "visibleTextDelivery")) {
          await ignoreBestEffortError(dependencies.channelAdapter.sendText({
            userId: normalized.senderId,
            text: userFacingMessages.attachmentReceiveFailed(persisted.failed.map((item) => item.reason)),
            contextToken: normalized.contextToken,
            preserveBlock: true,
          }), {
            label: "attachment failure notice",
            reason: "attachment persistence failure should still return null even if the courtesy notice cannot be delivered",
          });
        }
        return null;
      }

      const runtimeInboundText = decorateRuntimeInboundText(
        dependencies.buildRuntimeInboundText(normalized, persisted, dependencies.config),
        pendingProactiveHandoff,
      );
      if (!runtimeInboundText) {
        if (canUseChannelOperation(dependencies.channelAdapter, "visibleTextDelivery")) {
          await ignoreBestEffortError(dependencies.channelAdapter.sendText({
            userId: normalized.senderId,
            text: userFacingMessages.attachmentReceiveFailed(persisted.failed.map((item) => item.reason)),
            contextToken: normalized.contextToken,
            preserveBlock: true,
          }), {
            label: "attachment-only failure notice",
            reason: "the user-facing attachment failure notice is best-effort after the runtime payload collapsed to empty",
          });
        }
        return null;
      }

      return {
        ...normalized,
        originalText: normalized.text,
        text: runtimeInboundText,
        attachments: persisted.saved,
        attachmentFailures: persisted.failed,
        pendingProactiveHandoff,
        workspaceRoot,
      };
    },
  };
}

function decorateRuntimeInboundText(
  runtimeInboundText: string,
  pendingProactiveHandoff: PreparedRuntimeMessage["pendingProactiveHandoff"],
): string {
  const normalizedText = String(runtimeInboundText || "").trim();
  if (!pendingProactiveHandoff) {
    return normalizedText;
  }
  const prelude = buildPendingProactiveHandoffPrelude(pendingProactiveHandoff);
  return [prelude, normalizedText].filter(Boolean).join("\n\n").trim();
}
