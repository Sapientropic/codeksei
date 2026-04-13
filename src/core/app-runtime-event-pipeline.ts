import type {
  RuntimeAdapterLike,
  RuntimeWatchdogLifecycleLike,
  ThreadStateStoreLike,
} from "./app-service-contract";
import type { RuntimeEvent } from "../contracts/runtime-events";
import type { UnknownRecord } from "./runtime-types";

interface AttachRuntimeEventPipelineArgs {
  runtimeAdapter: RuntimeAdapterLike;
  runtimeWatchdogLifecycle: RuntimeWatchdogLifecycleLike;
  threadStateStore: ThreadStateStoreLike;
  getRuntimeEventChain(): Promise<void>;
  setRuntimeEventChain(chain: Promise<void>): void;
  logRuntimeEventFailure(event: RuntimeEvent<UnknownRecord>, error: unknown): void;
}

export function attachRuntimeEventPipeline({
  runtimeAdapter,
  runtimeWatchdogLifecycle,
  threadStateStore,
  getRuntimeEventChain,
  setRuntimeEventChain,
  logRuntimeEventFailure,
}: AttachRuntimeEventPipelineArgs): void {
  runtimeAdapter.onEvent((event) => {
    runtimeWatchdogLifecycle.observeRuntimeEvent(event);
    threadStateStore.applyRuntimeEvent(event);
    const nextChain = getRuntimeEventChain()
      // Reset the serialized promise chain after a rejected event so one bad
      // runtime callback cannot block every later event in the same session.
      .catch(() => {})
      .then(() => runtimeWatchdogLifecycle.handleRuntimeEvent(event))
      .catch((error) => {
        logRuntimeEventFailure(event, error);
      });
    setRuntimeEventChain(nextChain);
  });
}
