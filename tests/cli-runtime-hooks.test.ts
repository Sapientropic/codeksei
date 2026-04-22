const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

import type { GlobalCliOptions } from "../src/contracts/cli-contract";
const {
  createCliRuntimeErrorHookInstaller,
}: typeof import("../src/core/cli-runtime-hooks") = require("../src/core/cli-runtime-hooks");

type RuntimeHookEvent = "unhandledRejection" | "uncaughtException";
type RuntimeHookListener = (reason: unknown) => void;

function createCliOptions(overrides: Partial<GlobalCliOptions> = {}): GlobalCliOptions {
  return {
    debug: false,
    format: "json",
    locale: "zh-CN",
    stdinIsTty: false,
    stdoutIsTty: false,
    verbose: false,
    workspaceRoot: "",
    ...overrides,
  };
}

function createFakeProcess(initialExitCode?: number) {
  const listeners = new Map<RuntimeHookEvent, RuntimeHookListener[]>();
  return {
    target: {
      exitCode: initialExitCode,
      on(event: RuntimeHookEvent, listener: RuntimeHookListener) {
        const current = listeners.get(event) || [];
        current.push(listener);
        listeners.set(event, current);
      },
    },
    emit(event: RuntimeHookEvent, reason: unknown) {
      for (const listener of listeners.get(event) || []) {
        listener(reason);
      }
    },
    listenerCount(event: RuntimeHookEvent) {
      return (listeners.get(event) || []).length;
    },
  };
}

test("unhandledRejection sets a non-zero exit code and logs the normalized error", () => {
  const fakeProcess = createFakeProcess();
  const logs: string[] = [];
  const install = createCliRuntimeErrorHookInstaller({
    logErrorImpl: (message: string) => logs.push(message),
    processTarget: fakeProcess.target,
  });

  install(createCliOptions());
  fakeProcess.emit("unhandledRejection", new Error("boom"));

  assert.equal(fakeProcess.target.exitCode, 1);
  assert.equal(fakeProcess.listenerCount("unhandledRejection"), 1);
  assert.match(logs[0] || "", /unhandled rejection boom/u);
});

test("runtime hooks do not override an existing non-zero exit code", () => {
  const fakeProcess = createFakeProcess(7);
  const install = createCliRuntimeErrorHookInstaller({
    logErrorImpl: () => undefined,
    processTarget: fakeProcess.target,
  });

  install(createCliOptions());
  fakeProcess.emit("uncaughtException", new Error("still bad"));

  assert.equal(fakeProcess.target.exitCode, 7);
});

test("verbose mode logs error detail for both runtime hook paths", () => {
  const fakeProcess = createFakeProcess();
  const logs: string[] = [];
  const install = createCliRuntimeErrorHookInstaller({
    logErrorImpl: (message: string) => logs.push(message),
    processTarget: fakeProcess.target,
  });

  install(createCliOptions({ verbose: true }));
  fakeProcess.emit("unhandledRejection", new Error("first failure"));
  fakeProcess.emit("uncaughtException", new Error("second failure"));

  assert.equal(logs.length >= 4, true);
  assert.match(logs[1] || "", /first failure/u);
  assert.match(logs[3] || "", /second failure/u);
});

test("installCliRuntimeErrorHooks only registers once per installer", () => {
  const fakeProcess = createFakeProcess();
  const install = createCliRuntimeErrorHookInstaller({
    logErrorImpl: () => undefined,
    processTarget: fakeProcess.target,
  });

  install(createCliOptions());
  install(createCliOptions({ debug: true }));

  assert.equal(fakeProcess.listenerCount("unhandledRejection"), 1);
  assert.equal(fakeProcess.listenerCount("uncaughtException"), 1);
});
