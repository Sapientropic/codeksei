import type { TestContext } from "node:test";

type MockTimerEnableOptions = NonNullable<Parameters<TestContext["mock"]["timers"]["enable"]>[0]>;
type MockTimerApi = MockTimerEnableOptions["apis"][number];

const DEFAULT_APIS: readonly MockTimerApi[] = ["setImmediate", "setTimeout"];

export function enableMockTimers(
  context: TestContext,
  apis: readonly MockTimerApi[] = DEFAULT_APIS,
): void {
  context.mock.timers.enable({ apis });
  context.after(() => {
    context.mock.timers.reset();
  });
}

export async function advanceTimersAndMicrotasks(
  context: TestContext,
  ms: number = 0,
  microtaskTurns: number = 8,
): Promise<void> {
  context.mock.timers.tick(ms);
  for (let index = 0; index < microtaskTurns; index += 1) {
    await Promise.resolve();
  }
}
