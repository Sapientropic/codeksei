const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const path: typeof import("node:path") = require("node:path");

function resolveCrossPlatformPath(value: unknown): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  if (path.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    return normalized.replace(/\\/gu, "/");
  }
  return path.resolve(normalized).replace(/\\/gu, "/");
}

test("createTerminalCommandContext derives leafArgs and checkin from the provided argv", () => {
  const contextModulePath = require.resolve("../src/app/terminal-command-context");
  const terminalFacadeModulePath = require.resolve("../src/core/app-terminal-facade");
  const brandingModulePath = require.resolve("../src/core/branding");
  const envLoaderModulePath = require.resolve("../src/core/env-loader");
  const configModulePath = require.resolve("../src/core/config");
  const instructionsTemplateModulePath = require.resolve("../src/core/instructions-template");
  const timelineIntegrationModulePath = require.resolve("../src/integrations/timeline");
  const jsonStateModulePath = require.resolve("../src/state/json-state");
  const pathUtilsModulePath = require.resolve("../src/core/path-utils");
  const personReferenceModulePath = require.resolve("../src/contracts/person-reference");
  const hostAttachConfigModulePath = require.resolve("../src/host/attach/config");

  const originals = new Map<string, NodeJS.Module | undefined>();
  for (const modulePath of [
    contextModulePath,
    terminalFacadeModulePath,
    brandingModulePath,
    envLoaderModulePath,
    configModulePath,
    instructionsTemplateModulePath,
    timelineIntegrationModulePath,
    jsonStateModulePath,
    pathUtilsModulePath,
    personReferenceModulePath,
    hostAttachConfigModulePath,
  ]) {
    originals.set(modulePath, require.cache[modulePath]);
  }

  let ensuredHomeFallbackRoot = "";
  let loadEnvStackCalls = 0;
  let ensureStateDirectoryCalls = 0;
  let hostConfigFallbackCalls = 0;
  let timelineIntegrationConfig: Record<string, unknown> | null = null;
  const originalArgv = process.argv;
  process.argv = ["node", "ambient.js", "review", "weekly", "--ambient-flag", "wrong"];

  try {
    require.cache[terminalFacadeModulePath] = {
      id: terminalFacadeModulePath,
      filename: terminalFacadeModulePath,
      loaded: true,
      exports: {
        createTerminalAppFacade(config: Record<string, unknown>) {
          return {
            config,
            login() {
              return Promise.resolve();
            },
            getDoctorReport() {
              return {};
            },
            printAccounts() {
              return undefined;
            },
            printDoctor() {
              return undefined;
            },
            sendLocalFileToCurrentChat() {
              return Promise.resolve();
            },
            start() {
              return Promise.resolve();
            },
          };
        },
      },
    } as NodeJS.Module;

    require.cache[brandingModulePath] = {
      id: brandingModulePath,
      filename: brandingModulePath,
      loaded: true,
      exports: {
        ensureCodekseiHomeEnv({ fallbackRoot }: { fallbackRoot: string }) {
          ensuredHomeFallbackRoot = fallbackRoot;
        },
        ensureStateDirectory() {
          ensureStateDirectoryCalls += 1;
        },
      },
    } as NodeJS.Module;

    require.cache[envLoaderModulePath] = {
      id: envLoaderModulePath,
      filename: envLoaderModulePath,
      loaded: true,
      exports: {
        loadEnvStack() {
          loadEnvStackCalls += 1;
        },
      },
    } as NodeJS.Module;

    require.cache[configModulePath] = {
      id: configModulePath,
      filename: configModulePath,
      loaded: true,
      exports: {
        readConfig() {
          return {
            sessionsFile: "sessions.json",
            stateDir: "state-dir",
            systemMessageQueueFile: "system-message-queue.json",
            systemMessageDeadLetterFile: "system-message-dead-letter.json",
            workspaceId: "workspace-1",
            workspaceRoot: "E:/repo/current",
            startWithCheckin: false,
            weixinInstructionsFile: "",
          };
        },
      },
    } as NodeJS.Module;

    require.cache[hostAttachConfigModulePath] = {
      id: hostAttachConfigModulePath,
      filename: hostAttachConfigModulePath,
      loaded: true,
      exports: {
        applyHostConfigEnvFallback() {
          hostConfigFallbackCalls += 1;
          return null;
        },
      },
    } as NodeJS.Module;

    require.cache[instructionsTemplateModulePath] = {
      id: instructionsTemplateModulePath,
      filename: instructionsTemplateModulePath,
      loaded: true,
      exports: {
        renderInstructionTemplate(template: string) {
          return template;
        },
      },
    } as NodeJS.Module;

    require.cache[timelineIntegrationModulePath] = {
      id: timelineIntegrationModulePath,
      filename: timelineIntegrationModulePath,
      loaded: true,
      exports: {
        createTimelineIntegration(config: Record<string, unknown>) {
          timelineIntegrationConfig = config;
          return {
            runSubcommand: async () => undefined,
          };
        },
      },
    } as NodeJS.Module;

    require.cache[jsonStateModulePath] = {
      id: jsonStateModulePath,
      filename: jsonStateModulePath,
      loaded: true,
      exports: {
        writeForeignTextDocument() {
          return undefined;
        },
      },
    } as NodeJS.Module;

    require.cache[pathUtilsModulePath] = {
      id: pathUtilsModulePath,
      filename: pathUtilsModulePath,
      loaded: true,
      exports: {
        resolveCrossPlatformPath,
        resolvePackageRoot() {
          return "E:/repo/codeksei";
        },
      },
    } as NodeJS.Module;

    require.cache[personReferenceModulePath] = {
      id: personReferenceModulePath,
      filename: personReferenceModulePath,
      loaded: true,
      exports: {
        resolveConfiguredPersonName() {
          return "Tester";
        },
      },
    } as NodeJS.Module;

    delete require.cache[contextModulePath];
    const {
      createTerminalCommandContext,
    }: typeof import("../src/app/terminal-command-context") = require(contextModulePath);

    const context = createTerminalCommandContext(
      ["review", "weekly", "--window", "7d", "--checkin"],
      {
        debug: false,
        format: "text",
        locale: "zh-CN",
        stdinIsTty: true,
        stdoutIsTty: true,
        verbose: false,
        workspaceRoot: "",
      },
      {
        action: "review.weekly",
        approval: { autoApprove: true },
        argsSchemaKey: "review",
        audience: "public",
        authRequirement: "none",
        command: "review",
        entrypointType: "cli",
        helpTopic: "review",
        hostDependencies: [],
        hostProfileIds: ["codex-mode", "hosted-mode"],
        hostSupportTier: "host_neutral",
        key: "review weekly",
        kind: "weekly",
        mutability: "write",
        pathTokens: ["review", "weekly"],
        runner: "review.command",
        safetyTier: "warned",
        scriptName: "review:weekly",
        sideEffects: [],
        subcommand: "weekly",
        tokenCount: 2,
        timelineSubcommand: "",
      },
    );
    const app = context.getApp();
    void context.getTimelineIntegration();

    assert.deepEqual(context.argv, ["review", "weekly", "--window", "7d", "--checkin"]);
    assert.deepEqual(context.leafArgs, ["--window", "7d", "--checkin"]);
    assert.equal(context.config.startWithCheckin, true);
    assert.equal(loadEnvStackCalls, 2);
    assert.equal(ensureStateDirectoryCalls, 1);
    assert.equal(hostConfigFallbackCalls, 0);
    assert.equal(ensuredHomeFallbackRoot, "E:/repo/codeksei");
    assert.deepEqual(timelineIntegrationConfig, context.config);
    assert.equal(typeof app.login, "function");
    assert.equal(typeof app.printAccounts, "function");
    assert.equal(typeof ((app as unknown) as Record<string, unknown>).handlePreparedMessage, "undefined");
  } finally {
    process.argv = originalArgv;
    for (const [modulePath, original] of originals.entries()) {
      if (original) {
        require.cache[modulePath] = original;
      } else {
        delete require.cache[modulePath];
      }
    }
  }
});

test("createTerminalCommandContext applies hosted config fallback for hosted checkin surfaces", () => {
  const contextModulePath = require.resolve("../src/app/terminal-command-context");
  const terminalFacadeModulePath = require.resolve("../src/core/app-terminal-facade");
  const brandingModulePath = require.resolve("../src/core/branding");
  const envLoaderModulePath = require.resolve("../src/core/env-loader");
  const configModulePath = require.resolve("../src/core/config");
  const instructionsTemplateModulePath = require.resolve("../src/core/instructions-template");
  const timelineIntegrationModulePath = require.resolve("../src/integrations/timeline");
  const jsonStateModulePath = require.resolve("../src/state/json-state");
  const pathUtilsModulePath = require.resolve("../src/core/path-utils");
  const personReferenceModulePath = require.resolve("../src/contracts/person-reference");
  const hostAttachConfigModulePath = require.resolve("../src/host/attach/config");

  const originals = new Map<string, NodeJS.Module | undefined>();
  for (const modulePath of [
    contextModulePath,
    terminalFacadeModulePath,
    brandingModulePath,
    envLoaderModulePath,
    configModulePath,
    instructionsTemplateModulePath,
    timelineIntegrationModulePath,
    jsonStateModulePath,
    pathUtilsModulePath,
    personReferenceModulePath,
    hostAttachConfigModulePath,
  ]) {
    originals.set(modulePath, require.cache[modulePath]);
  }

  let hostConfigFallbackCalls = 0;
  const originalArgv = process.argv;
  process.argv = ["node", "ambient.js", "system", "checkin-tick"];

  try {
    require.cache[terminalFacadeModulePath] = {
      id: terminalFacadeModulePath,
      filename: terminalFacadeModulePath,
      loaded: true,
      exports: {
        createTerminalAppFacade(config: Record<string, unknown>) {
          return {
            config,
            login() {
              return Promise.resolve();
            },
            getDoctorReport() {
              return {};
            },
            printAccounts() {
              return undefined;
            },
            printDoctor() {
              return undefined;
            },
            sendLocalFileToCurrentChat() {
              return Promise.resolve();
            },
            start() {
              return Promise.resolve();
            },
          };
        },
      },
    } as NodeJS.Module;

    require.cache[brandingModulePath] = {
      id: brandingModulePath,
      filename: brandingModulePath,
      loaded: true,
      exports: {
        ensureCodekseiHomeEnv() {
          return undefined;
        },
        ensureStateDirectory() {
          return undefined;
        },
      },
    } as NodeJS.Module;

    require.cache[envLoaderModulePath] = {
      id: envLoaderModulePath,
      filename: envLoaderModulePath,
      loaded: true,
      exports: {
        loadEnvStack() {
          return undefined;
        },
      },
    } as NodeJS.Module;

    require.cache[configModulePath] = {
      id: configModulePath,
      filename: configModulePath,
      loaded: true,
      exports: {
        readConfig() {
          return {
            sessionsFile: "sessions.json",
            stateDir: "state-dir",
            systemMessageQueueFile: "system-message-queue.json",
            systemMessageDeadLetterFile: "system-message-dead-letter.json",
            workspaceId: "workspace-1",
            workspaceRoot: "E:/repo/current",
            startWithCheckin: false,
            weixinInstructionsFile: "",
          };
        },
      },
    } as NodeJS.Module;

    require.cache[hostAttachConfigModulePath] = {
      id: hostAttachConfigModulePath,
      filename: hostAttachConfigModulePath,
      loaded: true,
      exports: {
        applyHostConfigEnvFallback() {
          hostConfigFallbackCalls += 1;
          return null;
        },
      },
    } as NodeJS.Module;

    require.cache[instructionsTemplateModulePath] = {
      id: instructionsTemplateModulePath,
      filename: instructionsTemplateModulePath,
      loaded: true,
      exports: {
        renderInstructionTemplate(template: string) {
          return template;
        },
      },
    } as NodeJS.Module;

    require.cache[timelineIntegrationModulePath] = {
      id: timelineIntegrationModulePath,
      filename: timelineIntegrationModulePath,
      loaded: true,
      exports: {
        createTimelineIntegration() {
          return {
            runSubcommand: async () => undefined,
          };
        },
      },
    } as NodeJS.Module;

    require.cache[jsonStateModulePath] = {
      id: jsonStateModulePath,
      filename: jsonStateModulePath,
      loaded: true,
      exports: {
        writeForeignTextDocument() {
          return undefined;
        },
      },
    } as NodeJS.Module;

    require.cache[pathUtilsModulePath] = {
      id: pathUtilsModulePath,
      filename: pathUtilsModulePath,
      loaded: true,
      exports: {
        resolveCrossPlatformPath,
        resolvePackageRoot() {
          return "E:/repo/codeksei";
        },
      },
    } as NodeJS.Module;

    require.cache[personReferenceModulePath] = {
      id: personReferenceModulePath,
      filename: personReferenceModulePath,
      loaded: true,
      exports: {
        resolveConfiguredPersonName() {
          return "Tester";
        },
      },
    } as NodeJS.Module;

    delete require.cache[contextModulePath];
    const {
      createTerminalCommandContext,
    }: typeof import("../src/app/terminal-command-context") = require(contextModulePath);

    createTerminalCommandContext(
      ["system", "checkin-tick"],
      {
        debug: false,
        format: "text",
        locale: "zh-CN",
        stdinIsTty: true,
        stdoutIsTty: true,
        verbose: false,
        workspaceRoot: "",
      },
      {
        action: "system.checkin_tick",
        approval: { autoApprove: true },
        argsSchemaKey: "systemCheckinTick",
        audience: "public",
        authRequirement: "none",
        command: "system",
        entrypointType: "cli",
        helpTopic: "system",
        hostDependencies: [],
        hostProfileIds: ["hosted-mode"],
        hostSupportTier: "hosted_ready",
        key: "system checkin-tick",
        kind: "",
        mutability: "write",
        pathTokens: ["system", "checkin-tick"],
        runner: "system.checkin-tick",
        safetyTier: "warned",
        scriptName: "system:checkin-tick",
        sideEffects: [],
        subcommand: "checkin-tick",
        tokenCount: 2,
        timelineSubcommand: "",
      },
    );

    assert.equal(hostConfigFallbackCalls, 1);
  } finally {
    process.argv = originalArgv;
    for (const [modulePath, original] of originals.entries()) {
      if (original) {
        require.cache[modulePath] = original;
      } else {
        delete require.cache[modulePath];
      }
    }
  }
});

test("hosted config fallback uses the leaf workspace before repo-local sample config", () => {
  const contextModulePath = require.resolve("../src/app/terminal-command-context");
  const terminalFacadeModulePath = require.resolve("../src/core/app-terminal-facade");
  const brandingModulePath = require.resolve("../src/core/branding");
  const envLoaderModulePath = require.resolve("../src/core/env-loader");
  const configModulePath = require.resolve("../src/core/config");
  const instructionsTemplateModulePath = require.resolve("../src/core/instructions-template");
  const timelineIntegrationModulePath = require.resolve("../src/integrations/timeline");
  const jsonStateModulePath = require.resolve("../src/state/json-state");
  const pathUtilsModulePath = require.resolve("../src/core/path-utils");
  const personReferenceModulePath = require.resolve("../src/contracts/person-reference");
  const hostAttachConfigModulePath = require.resolve("../src/host/attach/config");

  const originals = new Map<string, NodeJS.Module | undefined>();
  for (const modulePath of [
    contextModulePath,
    terminalFacadeModulePath,
    brandingModulePath,
    envLoaderModulePath,
    configModulePath,
    instructionsTemplateModulePath,
    timelineIntegrationModulePath,
    jsonStateModulePath,
    pathUtilsModulePath,
    personReferenceModulePath,
    hostAttachConfigModulePath,
  ]) {
    originals.set(modulePath, require.cache[modulePath]);
  }

  const capturedFallbacks: Array<{ cwd: string; explicitPath: unknown }> = [];
  const workspaceRoot = "/Users/example/real-workspace";
  const explicitConfig = "/Users/example/real-workspace/codeksei.config.json";

  try {
    require.cache[terminalFacadeModulePath] = {
      id: terminalFacadeModulePath,
      filename: terminalFacadeModulePath,
      loaded: true,
      exports: {
        createTerminalAppFacade(config: Record<string, unknown>) {
          return {
            config,
            login() {
              return Promise.resolve();
            },
            getDoctorReport() {
              return {};
            },
            printAccounts() {
              return undefined;
            },
            printDoctor() {
              return undefined;
            },
            sendLocalFileToCurrentChat() {
              return Promise.resolve();
            },
            start() {
              return Promise.resolve();
            },
          };
        },
      },
    } as NodeJS.Module;

    require.cache[brandingModulePath] = {
      id: brandingModulePath,
      filename: brandingModulePath,
      loaded: true,
      exports: {
        ensureCodekseiHomeEnv() {
          return undefined;
        },
        ensureStateDirectory() {
          return undefined;
        },
      },
    } as NodeJS.Module;

    require.cache[envLoaderModulePath] = {
      id: envLoaderModulePath,
      filename: envLoaderModulePath,
      loaded: true,
      exports: {
        loadEnvStack() {
          return undefined;
        },
      },
    } as NodeJS.Module;

    require.cache[configModulePath] = {
      id: configModulePath,
      filename: configModulePath,
      loaded: true,
      exports: {
        readConfig() {
          return {
            sessionsFile: "sessions.json",
            stateDir: "state-dir",
            systemMessageQueueFile: "system-message-queue.json",
            systemMessageDeadLetterFile: "system-message-dead-letter.json",
            workspaceId: "workspace-1",
            workspaceRoot,
            startWithCheckin: false,
            weixinInstructionsFile: "",
          };
        },
      },
    } as NodeJS.Module;

    require.cache[hostAttachConfigModulePath] = {
      id: hostAttachConfigModulePath,
      filename: hostAttachConfigModulePath,
      loaded: true,
      exports: {
        applyHostConfigEnvFallback(_env: NodeJS.ProcessEnv, cwd: string, explicitPath?: unknown) {
          capturedFallbacks.push({ cwd, explicitPath });
          return null;
        },
      },
    } as NodeJS.Module;

    require.cache[instructionsTemplateModulePath] = {
      id: instructionsTemplateModulePath,
      filename: instructionsTemplateModulePath,
      loaded: true,
      exports: {
        renderInstructionTemplate(template: string) {
          return template;
        },
      },
    } as NodeJS.Module;

    require.cache[timelineIntegrationModulePath] = {
      id: timelineIntegrationModulePath,
      filename: timelineIntegrationModulePath,
      loaded: true,
      exports: {
        createTimelineIntegration() {
          return {
            runSubcommand: async () => undefined,
          };
        },
      },
    } as NodeJS.Module;

    require.cache[jsonStateModulePath] = {
      id: jsonStateModulePath,
      filename: jsonStateModulePath,
      loaded: true,
      exports: {
        writeForeignTextDocument() {
          return undefined;
        },
      },
    } as NodeJS.Module;

    require.cache[pathUtilsModulePath] = {
      id: pathUtilsModulePath,
      filename: pathUtilsModulePath,
      loaded: true,
      exports: {
        resolveCrossPlatformPath,
        resolvePackageRoot() {
          return "/Users/example/codeksei";
        },
      },
    } as NodeJS.Module;

    require.cache[personReferenceModulePath] = {
      id: personReferenceModulePath,
      filename: personReferenceModulePath,
      loaded: true,
      exports: {
        resolveConfiguredPersonName() {
          return "Tester";
        },
      },
    } as NodeJS.Module;

    delete require.cache[contextModulePath];
    const {
      createTerminalCommandContext,
    }: typeof import("../src/app/terminal-command-context") = require(contextModulePath);

    createTerminalCommandContext(
      ["system", "checkin-trigger", "--user", "wx-user", "--workspace", workspaceRoot],
      {
        debug: false,
        format: "json",
        locale: "zh-CN",
        stdinIsTty: false,
        stdoutIsTty: false,
        verbose: false,
        workspaceRoot: "",
      },
      {
        action: "system.checkin_trigger",
        approval: { autoApprove: true },
        argsSchemaKey: "systemCheckinTrigger",
        audience: "public",
        authRequirement: "none",
        command: "system",
        entrypointType: "cli",
        helpTopic: "system",
        hostDependencies: [],
        hostProfileIds: ["hosted-mode"],
        hostSupportTier: "hosted_ready",
        key: "system checkin-trigger",
        kind: "",
        mutability: "read",
        pathTokens: ["system", "checkin-trigger"],
        runner: "system.checkin-trigger",
        safetyTier: "open",
        scriptName: "system:checkin-trigger",
        sideEffects: [],
        subcommand: "checkin-trigger",
        tokenCount: 2,
        timelineSubcommand: "",
      },
    );

    createTerminalCommandContext(
      ["host", "claim-checkin", "--provider", "hermes", "--config", explicitConfig, "--workspace", "/ignored"],
      {
        debug: false,
        format: "json",
        locale: "zh-CN",
        stdinIsTty: false,
        stdoutIsTty: false,
        verbose: false,
        workspaceRoot: "",
      },
      {
        action: "host.claim_checkin",
        approval: { autoApprove: true },
        argsSchemaKey: "hostClaimCheckin",
        audience: "public",
        authRequirement: "none",
        command: "host",
        entrypointType: "cli",
        helpTopic: "host",
        hostDependencies: [],
        hostProfileIds: ["hosted-mode"],
        hostSupportTier: "hosted_ready",
        key: "host claim-checkin",
        kind: "",
        mutability: "write",
        pathTokens: ["host", "claim-checkin"],
        runner: "host.claim_checkin",
        safetyTier: "warned",
        scriptName: "",
        sideEffects: [],
        subcommand: "claim-checkin",
        tokenCount: 2,
        timelineSubcommand: "",
      },
    );

    assert.equal(capturedFallbacks[0]?.cwd, workspaceRoot);
    assert.equal(capturedFallbacks[0]?.explicitPath, undefined);
    assert.equal(capturedFallbacks[1]?.cwd, process.cwd());
    assert.equal(capturedFallbacks[1]?.explicitPath, explicitConfig);
  } finally {
    for (const [modulePath, original] of originals.entries()) {
      if (original) {
        require.cache[modulePath] = original;
      } else {
        delete require.cache[modulePath];
      }
    }
  }
});
