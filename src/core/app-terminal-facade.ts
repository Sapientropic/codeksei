import { CodekseiApp } from "./app";
import type { AppRuntimeConfig } from "./app-service-contract";
import type { SendLocalFileRequest } from "./runtime-types";

export interface TerminalAppFacade {
  login(): Promise<void>;
  printAccounts(): void;
  printDoctor(): void;
  sendLocalFileToCurrentChat(payload?: SendLocalFileRequest): Promise<unknown>;
  start(): Promise<void>;
}

export function createTerminalAppFacade(config: AppRuntimeConfig): TerminalAppFacade {
  const app = new CodekseiApp(config);
  return {
    login: () => app.login(),
    printAccounts: () => app.printAccounts(),
    printDoctor: () => app.printDoctor(),
    sendLocalFileToCurrentChat: (payload?: SendLocalFileRequest) => app.sendLocalFileToCurrentChat(payload),
    start: () => app.start(),
  };
}
