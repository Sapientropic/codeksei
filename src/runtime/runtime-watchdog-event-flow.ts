import {
  RUNTIME_EVENT_TYPES,
  type RuntimeEvent,
} from "../contracts/runtime-events";
import type { UnknownRecord } from "../core/runtime-types";
import {
  clearPendingApproval,
  handleApprovalRequested,
  sendFailureToThread,
  stopTypingForThread,
  type RuntimeWatchdogApprovalDependencies,
} from "./runtime-watchdog-approval";

export async function handleRuntimeWatchdogEvent(
  approvalDependencies: RuntimeWatchdogApprovalDependencies,
  event: RuntimeEvent<UnknownRecord>,
): Promise<void> {
  if (!event) {
    return;
  }
  if (event.type === RUNTIME_EVENT_TYPES.TURN_COMPLETED || event.type === RUNTIME_EVENT_TYPES.TURN_FAILED) {
    await clearPendingApproval(approvalDependencies.sessionWriter, event.payload.threadId);
    await stopTypingForThread(approvalDependencies, event.payload.threadId);
    if (event.type === RUNTIME_EVENT_TYPES.TURN_FAILED) {
      await sendFailureToThread(approvalDependencies, event.payload.threadId, event.payload.text || "执行失败");
    }
    return;
  }
  await handleApprovalRequested(approvalDependencies, event);
}
