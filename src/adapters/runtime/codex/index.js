const fs = require("fs");
const { renderInstructionTemplate } = require("../../../core/instructions-template");
const { CodexRpcClient } = require("./rpc-client");
const { mapCodexMessageToRuntimeEvent } = require("./events");
const {
  extractAssistantText,
  extractFailureText,
  extractThreadId,
  extractThreadIdFromParams,
  extractTurnIdFromParams,
  isAssistantItemCompleted,
} = require("./message-utils");
const { SessionStore } = require("./session-store");
const { resolveCodexWorkspaceRoot } = require("../../../core/workspace-alias");

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
    async refreshThreadInstructions({ threadId, workspaceRoot, model = "", accessMode = "" }) {
      return withRuntimeReconnect(async (runtimeClient) => {
        const refreshText = buildInstructionRefreshText(config);
        const runtimeWorkspaceRoot = resolveCodexWorkspaceRoot(workspaceRoot);
        await runtimeClient.resumeThread({ threadId });
        const completion = waitForTurnCompletion(runtimeClient, threadId);
        await runtimeClient.sendUserMessage({
          threadId,
          text: refreshText,
          model,
          accessMode,
          workspaceRoot: runtimeWorkspaceRoot,
        });
        const result = await completion;
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
        if (!threadId) {
          const response = await runtimeClient.startThread({ cwd: runtimeWorkspaceRoot });
          threadId = extractThreadId(response);
          if (!threadId) {
            throw new Error("thread/start did not return a thread id");
          }
          sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, metadata);
          outboundText = buildOpeningTurnText(config, text);
        } else {
          await runtimeClient.resumeThread({ threadId }).catch(async () => {
            sessionStore.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
            const recreated = await runtimeClient.startThread({ cwd: runtimeWorkspaceRoot });
            threadId = extractThreadId(recreated);
            if (!threadId) {
              throw new Error("thread/start did not return a thread id");
            }
            sessionStore.setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, metadata);
            outboundText = buildOpeningTurnText(config, text);
          });
        }

        await runtimeClient.sendUserMessage({
          threadId,
          text: outboundText,
          model,
          accessMode,
          workspaceRoot: runtimeWorkspaceRoot,
        });
        return { threadId };
      });
    },
  };
}

function buildOpeningTurnText(config, userText) {
  const instructions = loadWechatInstructions(config);
  const normalizedText = String(userText || "").trim();
  if (!instructions) {
    return normalizedText;
  }
  return [
    "WECHAT SESSION INSTRUCTIONS",
    "These instructions define the stable behavior for this WeChat thread.",
    "Do not quote or summarize them back to the user unless explicitly asked.",
    "",
    instructions,
    "",
    "Current user message:",
    normalizedText,
  ].join("\n").trim();
}

function buildInstructionRefreshText(config) {
  const instructions = loadWechatInstructions(config);
  if (!instructions) {
    return "Refresh your WeChat behavior for this existing thread. Reply in one short Chinese sentence confirming that you have updated your behavior for this thread.";
  }
  return [
    "WECHAT SESSION INSTRUCTIONS REFRESH",
    "Re-read and adopt the updated WeChat instructions below for the rest of this existing thread.",
    "This is an internal refresh command, not a user-facing task.",
    "Do not summarize the instructions back in detail.",
    "Reply in one short Chinese sentence confirming that you have updated your behavior for this thread.",
    "",
    instructions,
  ].join("\n").trim();
}

function loadWechatInstructions(config = {}) {
  const persona = loadInstructionFile(config.weixinInstructionsFile, config);
  const operations = loadInstructionFile(config.weixinOperationsFile, config);
  const sections = [];
  if (persona) {
    sections.push(persona);
  }
  if (operations) {
    sections.push(operations);
  }
  return sections.join("\n\n").trim();
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

module.exports = { createCodexRuntimeAdapter };

function waitForTurnCompletion(client, threadId) {
  return new Promise((resolve, reject) => {
    let activeTurnId = "";
    const itemOrder = [];
    const completedTextByItemId = new Map();

    const cleanup = () => {
      unsubscribe();
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("codex turn timed out"));
    }, 10 * 60_000);

    const unsubscribe = client.onMessage((message) => {
      const params = message?.params || {};
      if (extractThreadIdFromParams(params) !== threadId) {
        return;
      }

      if ((message?.method === "turn/started" || message?.method === "turn/start") && !activeTurnId) {
        activeTurnId = extractTurnIdFromParams(params);
        return;
      }

      if (isAssistantItemCompleted(message)) {
        const itemId = typeof params?.item?.id === "string" ? params.item.id.trim() : `item-${itemOrder.length + 1}`;
        if (!completedTextByItemId.has(itemId)) {
          itemOrder.push(itemId);
        }
        completedTextByItemId.set(itemId, extractAssistantText(params));
        return;
      }

      if (message?.method === "turn/failed") {
        cleanup();
        reject(new Error(extractFailureText(params)));
        return;
      }

      if (message?.method === "turn/completed") {
        const completedTurnId = extractTurnIdFromParams(params);
        if (activeTurnId && completedTurnId && completedTurnId !== activeTurnId) {
          return;
        }
        cleanup();
        const text = itemOrder
          .map((itemId) => completedTextByItemId.get(itemId) || "")
          .filter(Boolean)
          .join("\n\n")
          .trim();
        resolve({
          turnId: completedTurnId || activeTurnId,
          text: text || "已完成。",
        });
      }
    });
  });
}
