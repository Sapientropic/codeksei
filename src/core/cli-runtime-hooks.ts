import { PACKAGE_NAME } from "../contracts/app-env";
import type { GlobalCliOptions } from "../contracts/cli-contract";
import { formatCliErrorMessage } from "./cli-contract";
import { logError } from "./logging";

type RuntimeHookEvent = "unhandledRejection" | "uncaughtException";
type RuntimeHookListener = (reason: unknown) => void;

export interface CliRuntimeHookTarget {
  exitCode?: number | string | null | undefined;
  on(event: RuntimeHookEvent, listener: RuntimeHookListener): void;
}

export interface CliRuntimeHookDependencies {
  logErrorImpl?: (message: string) => void;
  processTarget?: CliRuntimeHookTarget;
}

function setNonZeroExitCode(processTarget: CliRuntimeHookTarget): void {
  if (!Number.isFinite(processTarget.exitCode) || processTarget.exitCode === 0) {
    processTarget.exitCode = 1;
  }
}

function emitRuntimeErrorLog(
  cli: GlobalCliOptions,
  label: RuntimeHookEvent,
  reason: unknown,
  logErrorImpl: (message: string) => void,
): void {
  const message = formatCliErrorMessage(reason);
  logErrorImpl(`[${PACKAGE_NAME}] ${label === "unhandledRejection" ? "unhandled rejection" : "uncaught exception"} ${message}`);
  if (cli.verbose || cli.debug) {
    const detail = reason instanceof Error ? reason.stack || reason.message : String(reason);
    logErrorImpl(detail);
  }
}

export function createCliRuntimeErrorHookInstaller({
  logErrorImpl = logError,
  processTarget = process,
}: CliRuntimeHookDependencies = {}): (cli: GlobalCliOptions) => void {
  let installed = false;

  return function installCliRuntimeErrorHooks(cli: GlobalCliOptions): void {
    if (installed) {
      return;
    }
    installed = true;

    processTarget.on("unhandledRejection", (reason: unknown) => {
      emitRuntimeErrorLog(cli, "unhandledRejection", reason, logErrorImpl);
      setNonZeroExitCode(processTarget);
    });

    processTarget.on("uncaughtException", (error: unknown) => {
      emitRuntimeErrorLog(cli, "uncaughtException", error, logErrorImpl);
      setNonZeroExitCode(processTarget);
    });
  };
}

export const installCliRuntimeErrorHooks = createCliRuntimeErrorHookInstaller();
