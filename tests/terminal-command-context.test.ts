const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

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
  const personReferenceModulePath = require.resolve("../src/core/person-reference");

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
  ]) {
    originals.set(modulePath, require.cache[modulePath]);
  }

  let ensuredHomeFallbackRoot = "";
  let loadEnvStackCalls = 0;
  let ensureStateDirectoryCalls = 0;
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
            timelineScreenshotQueueFile: "timeline-screenshot-queue.json",
            workspaceId: "workspace-1",
            workspaceRoot: "E:/repo/current",
            startWithCheckin: false,
            weixinInstructionsFile: "",
          };
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
    assert.equal(loadEnvStackCalls, 1);
    assert.equal(ensureStateDirectoryCalls, 1);
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
