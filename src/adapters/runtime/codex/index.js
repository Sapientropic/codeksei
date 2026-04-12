const fs = require("fs");
const { renderInstructionTemplate } = require("../../../core/instructions-template");
const { RUNTIME_EVENT_TYPES } = require("../../../contracts/runtime-events");
const { CodexRpcClient } = require("./rpc-client");
const { mapCodexMessageToRuntimeEvent } = require("./events");
const {
  extractThreadId,
  extractThreadIdFromParams,
} = require("./message-utils");
const { SessionStore } = require("./session-store");
const { resolveCodexWorkspaceRoot } = require("../../../core/workspace-alias");
const { buildWorkspaceContinuityInstructions } = require("../../../core/workspace-bootstrap");

function createCodexRuntimeAdapter(config) {
  const sessionStore = new SessionStore({ filePath: config.sessionsFile });
  let client = null;
  let readyState = null;

  function ensureClient() {
    if (!client) {
      client = new CodexRpcClient({
        endpoint: config.codexEndpoint,
        codexCommand: config.codexCommand,
        env: process.env,
        extraWritableRoots: [config.stateDir],
      });
    }
    return client;
  }

  function isReconnectableRuntimeError(error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return message.includes("Codex websocket is not connected")
      || message.includes("Codex websocket closed")
      || message.includes("Codex websocket errored")
      || message.includes("Codex process stdin is not writable")
      || message.includes("Codex RPC client closed");
  }

  async function refreshReadyState(runtimeClient) {
    const modelResponse = await runtimeClient.listModels().catch(() => null);
    const models = Array.isArray(modelResponse?.result?.data)
      ? modelResponse.result.data
      : [];
    if (models.length) {
      sessionStore.setAvailableModelCatalog(models);
    }
    readyState = {
      endpoint: config.codexEndpoint || "(spawn)",
      models,
    };
    return readyState;
  }

  async function ensureInitialized({ forceReconnect = false } = {}) {
    const runtimeClient = ensureClient();
    if (forceReconnect) {
      readyState = null;
      await runtimeClient.close();
    }
    if (readyState && runtimeClient.isConnected()) {
      return readyState;
    }
    await runtimeClient.connect();
    await runtimeClient.initialize();
    return refreshReadyState(runtimeClient);
  }

  async function withRuntimeReconnect(action) {
    const runtimeClient = ensureClient();
    try {
      await ensureInitialized();
      return await action(runtimeClient);
    } catch (error) {
      if (!isReconnectableRuntimeError(error)) {
        throw error;
      }
      await ensureInitialized({ forceReconnect: true });
      return action(runtimeClient);
    }
  }

  return {
    describe() {
      return {
        id: "codex",
        kind: "runtime",
        endpoint: config.codexEndpoint || "(spawn)",
        sessionsFile: config.sessionsFile,
      };
    },
    createClient() {
      return ensureClient();
    },
    onEvent(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      const runtimeClient = ensureClient();
      return runtimeClient.onMessage((message) => {
        const event = mapCodexMessageToRuntimeEvent(message);
        if (event) {
          listener(event, message);
        }
      });
    },
    getSessionStore() {
      return sessionStore;
    },
    async initialize() {
      return ensureInitialized();
    },
    async close() {
      if (client) {
        await client.close();
      }
      readyState = null;
      client = null;
    },
    async respondApproval({ requestId, decision }) {
      return withRuntimeReconnect(async (runtimeClient) => {
        const normalizedDecision = decision === "accept" ? "accept" : "decline";
        if (requestId == null || String(requestId).trim() === "") {
          throw new Error("approval response requires a requestId");
        }
        await runtimeClient.sendResponse(requestId, { decision: normalizedDecision });
        return {
          requestId,
          decision: normalizedDecision,
        };
      });
    },
    async cancelTurn({ threadId, turnId }) {
      return withRuntimeReconnect(async (runtimeClient) => {
        await runtimeClient.cancelTurn({ threadId, turnId });
        return { threadId, turnId };
      });
    },
    async resumeThread({ threadId }) {
      return withRuntimeReconnect((runtimeClient) => runtimeClient.resumeThread({ threadId }));
    },
    async refreshThreadInstructions({ bindingKey = "", threadId, workspaceRoot, model = "", accessMode = "" }) {
      return withRuntimeReconnect(async (runtimeClient) => {
        const refreshText = buildInstructionRefreshText(config, workspaceRoot);
        const runtimeWorkspaceRoot = resolveCodexWorkspaceRoot(workspaceRoot);
        await runtimeClient.resumeThread({ threadId });
        const completion = waitForTurnCompletion(runtimeClient, threadId);
        await sendUserMessageWithWorkspaceDiagnostics({
          runtimeClient,
          params: {
            threadId,
            text: refreshText,
            model,
            accessMode,
            workspaceRoot: runtimeWorkspaceRoot,
          },
          operation: "turn/start(refresh)",
          bindingKey,
          threadId,
          workspaceRoot,
          runtimeWorkspaceRoot,
        });
        const result = await completion;
        if (bindingKey) {
          sessionStore.rememberWorkspaceBootstrapForThread(bindingKey, workspaceRoot, threadId);
        }
        return { threadId, ...result };
      });
    },
    async sendTextTurn({ bindingKey, workspaceRoot, text, metadata = {}, model = "", accessMode = "" }) {
      return withRuntimeReconnect(async (runtimeClient) => {
        // Codex websocket metadata currently breaks on non-ASCII workspace keys.
        // Keep session truth keyed by the canonical workspace root, but route the
        // actual runtime cwd through the existing machine-level ASCII alias map.
        const runtimeWorkspaceRoot = resolveCodexWorkspaceRoot(workspaceRoot);

        let threadId = sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
        let outboundText = text;
        let startedNewThread = false;
        if (!threadId) {
          const response = await startThreadWithWorkspaceDiagnostics({
            runtimeClient,
            cwd: runtimeWorkspaceRoot,
            bindingKey,
            workspaceRoot,
            runtimeWorkspaceRoot,
          });
          threadId = extractThreadId(response);
          if (!threadId) {
            throw new Error("thread/start did not return a thread id");
          }
          sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, metadata);
          startedNewThread = true;
        } else {
          await runtimeClient.resumeThread({ threadId }).catch(async () => {
            sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
            const recreated = await startThreadWithWorkspaceDiagnostics({
              runtimeClient,
              cwd: runtimeWorkspaceRoot,
              bindingKey,
              workspaceRoot,
              runtimeWorkspaceRoot,
              threadId,
            });
            threadId = extractThreadId(recreated);
            if (!threadId) {
              throw new Error("thread/start did not return a thread id");
            }
            sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, metadata);
            startedNewThread = true;
          });
        }

        const needsWorkspaceBootstrap = startedNewThread
          || !sessionStore.hasWorkspaceBootstrapForThread(bindingKey, workspaceRoot, threadId);
        if (startedNewThread) {
          outboundText = buildOpeningTurnText(config, workspaceRoot, text);
        } else if (needsWorkspaceBootstrap) {
          outboundText = buildWorkspaceBootstrapTurnText(config, workspaceRoot, text);
        }

        await sendUserMessageWithWorkspaceDiagnostics({
          runtimeClient,
          params: {
            threadId,
            text: outboundText,
            model,
            accessMode,
            workspaceRoot: runtimeWorkspaceRoot,
          },
          operation: "turn/start",
          bindingKey,
          threadId,
          workspaceRoot,
          runtimeWorkspaceRoot,
        });
        return {
          threadId,
          workspaceBootstrapPending: needsWorkspaceBootstrap,
        };
      });
    },
  };
}

function buildOpeningTurnText(config, workspaceRoot, userText) {
  const instructionBlocks = buildInstructionBlocks(config, workspaceRoot);
  const normalizedText = String(userText || "").trim();
  if (!instructionBlocks.length) {
    return normalizedText;
  }
  return [
    ...instructionBlocks,
    "",
    "Current user message:",
    normalizedText,
  ].join("\n").trim();
}

function buildWorkspaceBootstrapTurnText(config, workspaceRoot, userText) {
  const instructionBlocks = buildInstructionBlocks(config, workspaceRoot);
  const normalizedText = String(userText || "").trim();
  if (!instructionBlocks.length) {
    return normalizedText;
  }
  return [
    "WECHAT THREAD CONTINUITY REFRESH",
    "This existing thread needs the current WeChat and workspace continuity context before you answer.",
    "Keep the ongoing conversation state, but adopt the guidance below before replying.",
    "Do not quote or summarize these instructions back to the user unless explicitly asked.",
    "",
    ...instructionBlocks,
    "",
    "Current user message:",
    normalizedText,
  ].join("\n").trim();
}

function buildInstructionRefreshText(config, workspaceRoot) {
  const instructionBlocks = buildInstructionBlocks(config, workspaceRoot);
  if (!instructionBlocks.length) {
    return "Refresh your WeChat behavior for this existing thread. Reply in one short Chinese sentence confirming that you have updated your behavior for this thread.";
  }
  return [
    "WECHAT SESSION INSTRUCTIONS REFRESH",
    "Re-read and adopt the updated WeChat and workspace continuity instructions below for the rest of this existing thread.",
    "This is an internal refresh command, not a user-facing task.",
    "Do not summarize the instructions back in detail.",
    "Reply in one short Chinese sentence confirming that you have updated your behavior for this thread.",
    "",
    ...instructionBlocks,
  ].join("\n").trim();
}

function buildInstructionBlocks(config = {}, workspaceRoot = "") {
  const instructions = loadWechatInstructions(config);
  const workspaceContinuity = buildWorkspaceContinuityInstructions(workspaceRoot, config);
  const sections = [];
  if (instructions) {
    sections.push([
      "WECHAT SESSION INSTRUCTIONS",
      "These instructions define the stable behavior for this WeChat thread.",
      "Do not quote or summarize them back to the user unless explicitly asked.",
      "",
      instructions,
    ].join("\n"));
  }
  if (workspaceContinuity) {
    sections.push([
      "WORKSPACE CONTINUITY",
      workspaceContinuity,
    ].join("\n"));
  }
  return sections;
}

function loadWechatInstructions(config = {}) {
  const persona = loadInstructionFile(config.weixinInstructionsFile, config);
  const operations = loadInstructionFile(config.weixinOperationsFile, config);
  const personaOverlay = loadInstructionFile(config.weixinInstructionsOverlayFile, config);
  const operationsOverlay = loadInstructionFile(config.weixinOperationsOverlayFile, config);
  return [persona, operations, personaOverlay, operationsOverlay].filter(Boolean).join("\n\n").trim();
}

function loadInstructionFile(filePath, config = {}) {
  const normalizedPath = typeof filePath === "string" ? filePath.trim() : "";
  if (!normalizedPath) {
    return "";
  }
  try {
    const raw = fs.readFileSync(normalizedPath, "utf8");
    return renderInstructionTemplate(raw, config).trim();
  } catch {
    return "";
  }
}

module.exports = {
  createCodexRuntimeAdapter,
  loadWechatInstructions,
  __testing: {
    waitForTurnCompletion,
  },
};

async function startThreadWithWorkspaceDiagnostics({
  runtimeClient,
  cwd,
  bindingKey = "",
  workspaceRoot = "",
  runtimeWorkspaceRoot = "",
  threadId = "",
}) {
  try {
    return await runtimeClient.startThread({ cwd });
  } catch (error) {
    logInvalidWorkspaceError({
      operation: "thread/start",
      bindingKey,
      threadId,
      workspaceRoot,
      runtimeWorkspaceRoot,
      error,
    });
    throw error;
  }
}

async function sendUserMessageWithWorkspaceDiagnostics({
  runtimeClient,
  params,
  operation,
  bindingKey = "",
  threadId = "",
  workspaceRoot = "",
  runtimeWorkspaceRoot = "",
}) {
  try {
    return await runtimeClient.sendUserMessage(params);
  } catch (error) {
    logInvalidWorkspaceError({
      operation,
      bindingKey,
      threadId: threadId || params?.threadId || "",
      workspaceRoot,
      runtimeWorkspaceRoot,
      error,
    });
    throw error;
  }
}

function logInvalidWorkspaceError({
  operation,
  bindingKey = "",
  threadId = "",
  workspaceRoot = "",
  runtimeWorkspaceRoot = "",
  error,
}) {
  if (!isInvalidWorkspaceError(error)) {
    return;
  }
  console.error(
    `[codeksei] codex ${operation} invalid workspace cwd `
    + `thread=${normalizeLogValue(threadId) || "(new)"} `
    + `binding=${normalizeLogValue(bindingKey) || "(none)"} `
    + `workspaceRoot=${normalizeLogValue(workspaceRoot) || "(empty)"} `
    + `workspaceState=${describeWorkspaceState(workspaceRoot)} `
    + `runtimeWorkspaceRoot=${normalizeLogValue(runtimeWorkspaceRoot) || "(empty)"} `
    + `runtimeWorkspaceState=${describeWorkspaceState(runtimeWorkspaceRoot)} `
    + `error=${formatErrorMessage(error)}`
  );
}

function isInvalidWorkspaceError(error) {
  const message = formatErrorMessage(error).toLowerCase();
  return message.includes("os error 267")
    || message.includes("notadirectory")
    || message.includes("目录名称无效");
}

function describeWorkspaceState(workspaceRoot) {
  const normalized = normalizeLogValue(workspaceRoot);
  if (!normalized) {
    return "empty";
  }
  try {
    return fs.statSync(normalized).isDirectory() ? "directory" : "not-directory";
  } catch {
    return "missing";
  }
}

function normalizeLogValue(value) {
  return typeof value === "string" ? value.trim().replace(/\\/g, "/") : "";
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function waitForTurnCompletion(client, threadId) {
  return new Promise((resolve, reject) => {
    let activeTurnId = "";
    const itemOrder = [];
    const textByItemId = new Map();

    const cleanup = () => {
      unsubscribe();
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("codex turn timed out"));
    }, 10 * 60_000);

    const unsubscribe = client.onMessage((message) => {
      const runtimeEvent = mapCodexMessageToRuntimeEvent(message);
      const params = message?.params || {};
      const messageThreadId = normalizeLogValue(runtimeEvent?.payload?.threadId)
        || extractThreadIdFromParams(params);
      if (messageThreadId !== threadId) {
        return;
      }

      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.TURN_STARTED && !activeTurnId) {
        activeTurnId = normalizeLogValue(runtimeEvent.payload.turnId);
        return;
      }

      if (
        runtimeEvent?.type === RUNTIME_EVENT_TYPES.REPLY_DELTA
        || runtimeEvent?.type === RUNTIME_EVENT_TYPES.REPLY_COMPLETED
      ) {
        const itemId = normalizeLogValue(runtimeEvent.payload.itemId) || `item-${itemOrder.length + 1}`;
        if (!textByItemId.has(itemId)) {
          itemOrder.push(itemId);
          textByItemId.set(itemId, "");
        }
        const nextText = normalizeLogValue(runtimeEvent.payload.text);
        if (nextText) {
          if (runtimeEvent.type === RUNTIME_EVENT_TYPES.REPLY_DELTA) {
            textByItemId.set(itemId, `${textByItemId.get(itemId) || ""}${nextText}`);
          } else {
            textByItemId.set(itemId, nextText);
          }
        }
        return;
      }

      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.TURN_FAILED) {
        cleanup();
        reject(new Error(normalizeLogValue(runtimeEvent.payload.text) || "执行失败"));
        return;
      }

      if (runtimeEvent?.type === RUNTIME_EVENT_TYPES.TURN_COMPLETED) {
        const completedTurnId = normalizeLogValue(runtimeEvent.payload.turnId);
        if (activeTurnId && completedTurnId && completedTurnId !== activeTurnId) {
          return;
        }
        cleanup();
        // A single Codex turn can emit many assistant messages: progress notes,
        // compacted-context check-ins, then the final reply. Callers waiting for
        // turn completion expect the latest user-facing answer, not the whole
        // turn history concatenated together.
        const text = itemOrder
          .slice()
          .reverse()
          .map((itemId) => textByItemId.get(itemId) || "")
          .find((value) => String(value || "").trim()) || "";
        resolve({
          turnId: completedTurnId || activeTurnId,
          text: String(text || "").trim() || "已完成。",
        });
      }
    });
  });
}
