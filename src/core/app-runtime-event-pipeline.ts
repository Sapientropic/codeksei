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

function recoverRuntimeEventChain(chain: Promise<void>): Promise<void> {
  // A rejected event must not poison the serialized chain for every later
  // runtime event in the same session.
  return chain.catch(() => undefined);
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
    const nextChain = recoverRuntimeEventChain(getRuntimeEventChain())
      .then(() => runtimeWatchdogLifecycle.handleRuntimeEvent(event))
      .catch((error) => {
        logRuntimeEventFailure(event, error);
      });
    setRuntimeEventChain(nextChain);
  });
}
