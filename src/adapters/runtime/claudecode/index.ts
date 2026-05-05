import type { RuntimeEvent } from "../../../contracts/runtime-events";
import type { AppRuntimeConfig, RuntimeAdapterDescriptor } from "../../../core/app-service-contract";
import type { RuntimeTurnSendState } from "../../../core/runtime-types";
import {
  buildInstructionRefreshText,
  buildOpeningTurnText,
  buildWorkspaceBootstrapTurnText,
} from "../codex/bootstrap";
import { SessionStore } from "../codex/session-store";
import { SessionStoreWriter } from "../codex/session-store-writer";
import { mapClaudeCodeMessageToRuntimeEvent } from "./events";
import {
  ClaudeCodeProcessClient,
  type ClaudeCodeProcessEvent,
} from "./process-client";

type UnknownRecord = Record<string, unknown>;

type ClaudeCodeRuntimeConfig = Pick<
  AppRuntimeConfig,
  | "allowedUserIds"
  | "claudeCommand"
  | "claudeContextWindow"
  | "claudeDisableVerbose"
  | "claudeExtraArgs"
  | "claudeMcpConfigPaths"
  | "claudeMaxOutputTokens"
  | "claudeModel"
  | "claudePermissionMode"
  | "claudeStrictMcpConfig"
  | "codekseiHome"
  | "durableNoteSchemaConfigFile"
  | "runtimeCommand"
  | "sessionsFile"
  | "stateDir"
  | "userGender"
  | "userLanguage"
  | "userName"
  | "weixinInstructionsFile"
  | "weixinInstructionsOverlayFile"
  | "weixinOperationsFile"
  | "weixinOperationsOverlayFile"
>;

interface SendTextTurnArgs {
  bindingKey: string;
  workspaceRoot: string;
  text: string;
  metadata?: Record<string, unknown>;
  model?: string;
}

interface RefreshThreadInstructionsArgs {
  bindingKey?: string;
  threadId: string;
  workspaceRoot: string;
  model?: string;
}

const CLAUDE_RESUME_SESSION_TIMEOUT_MS = 8000;

export function createClaudeCodeRuntimeAdapter(config: ClaudeCodeRuntimeConfig) {
  const sessionStore = new SessionStore({ filePath: config.sessionsFile, runtimeId: "claudecode" });
  const sessionWriter = new SessionStoreWriter(sessionStore);
  const clientsByWorkspaceRoot = new Map<string, ClaudeCodeProcessClient>();
  const pendingApprovalsByRequestId = new Map<string, string>();
  const listeners = new Set<(event: RuntimeEvent<UnknownRecord>) => void>();

  function describe(): RuntimeAdapterDescriptor {
    return {
      id: "claudecode",
      kind: "runtime",
      provider: "claudecode",
      operations: {
        initialize: true,
        interactiveTurn: true,
        refreshThreadInstructions: true,
        respondApproval: true,
        resumeThread: true,
        cancelTurn: true,
        compactThread: true,
      },
      endpoint: "(spawn)",
      model: config.claudeModel,
      sessionsFile: config.sessionsFile,
      profile: "claudecode-mode",
      mode: "claudecode",
      supported: true,
    };
  }

  function resolveModel(model: unknown): string {
    return normalizeString(model) || normalizeString(config.claudeModel);
  }

  async function ensureClient(workspaceRoot: string, model = ""): Promise<ClaudeCodeProcessClient> {
    const normalizedWorkspaceRoot = normalizeString(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      throw new Error("workspaceRoot is required");
    }
    const desiredModel = resolveModel(model);
    const existingClient = clientsByWorkspaceRoot.get(normalizedWorkspaceRoot);
    if (existingClient?.alive && existingClient.model === desiredModel) {
      return existingClient;
    }
    if (existingClient) {
      await closeWorkspaceClient(normalizedWorkspaceRoot);
    }
    const client = new ClaudeCodeProcessClient({
      command: normalizeString(config.claudeCommand) || normalizeString(config.runtimeCommand) || "claude",
      cwd: normalizedWorkspaceRoot,
      env: process.env,
      model: desiredModel,
      permissionMode: config.claudePermissionMode || "default",
      disableVerbose: Boolean(config.claudeDisableVerbose),
      extraArgs: config.claudeExtraArgs || [],
      mcpConfigPaths: config.claudeMcpConfigPaths || [],
      strictMcpConfig: Boolean(config.claudeStrictMcpConfig),
      workspaceRoot: normalizedWorkspaceRoot,
      modelContextWindow: config.claudeContextWindow,
    });
    client.onMessage((event, raw) => {
      handleClientEvent(normalizedWorkspaceRoot, event, raw);
    });
    clientsByWorkspaceRoot.set(normalizedWorkspaceRoot, client);
    return client;
  }

  function handleClientEvent(workspaceRoot: string, event: ClaudeCodeProcessEvent, raw: unknown): void {
    if (event.type === "session.id") {
      void confirmWorkspaceSessionId(workspaceRoot, event.sessionId || "");
      return;
    }
    const mapped = mapClaudeCodeMessageToRuntimeEvent(event, raw);
    if (!mapped) {
      return;
    }
    mapped.payload.workspaceRoot = workspaceRoot;
    if (mapped.type === "runtime.approval.requested") {
      pendingApprovalsByRequestId.set(String(mapped.payload.requestId || ""), workspaceRoot);
    }
    if (mapped.type === "runtime.turn.failed") {
      clientsByWorkspaceRoot.delete(workspaceRoot);
    }
    for (const listener of listeners) {
      listener(mapped);
    }
  }

  async function confirmWorkspaceSessionId(workspaceRoot: string, sessionId: string): Promise<void> {
    const normalizedSessionId = normalizeThreadId(sessionId);
    if (!normalizedSessionId) {
      return;
    }
    for (const binding of sessionStore.listBindings()) {
      if (binding.activeWorkspaceRoot !== workspaceRoot) {
        continue;
      }
      const pendingThreadId = normalizeThreadId(
        sessionStore.getPendingThreadIdForWorkspace(binding.bindingKey, workspaceRoot),
      );
      if (pendingThreadId) {
        if (pendingThreadId === normalizedSessionId) {
          await sessionWriter.setThreadIdForWorkspace(binding.bindingKey, workspaceRoot, normalizedSessionId);
          await sessionWriter.clearPendingThreadIdForWorkspace?.(binding.bindingKey, workspaceRoot);
        }
        continue;
      }
      await sessionWriter.setThreadIdForWorkspace(binding.bindingKey, workspaceRoot, normalizedSessionId);
    }
  }

  async function attachClientToThread({
    workspaceRoot,
    threadId = "",
    model = "",
  }: {
    workspaceRoot: string;
    threadId?: string;
    model?: string;
  }): Promise<{ client: ClaudeCodeProcessClient; threadId: string }> {
    const normalizedThreadId = normalizeThreadId(threadId);
    const client = await ensureClient(workspaceRoot, model);
    if (client.alive && (!normalizedThreadId || clientMatchesThread(client, normalizedThreadId))) {
      return { client, threadId: client.sessionId || normalizedThreadId };
    }
    if (client.alive && normalizedThreadId && !clientMatchesThread(client, normalizedThreadId)) {
      await closeWorkspaceClient(workspaceRoot);
    }
    const freshClient = await ensureClient(workspaceRoot, model);
    await freshClient.connect(normalizedThreadId);
    return {
      client: freshClient,
      threadId: normalizedThreadId || freshClient.sessionId,
    };
  }

  async function closeWorkspaceClient(workspaceRoot: string): Promise<void> {
    const normalizedWorkspaceRoot = normalizeString(workspaceRoot);
    const client = clientsByWorkspaceRoot.get(normalizedWorkspaceRoot);
    if (!client) {
      return;
    }
    await client.close();
    clientsByWorkspaceRoot.delete(normalizedWorkspaceRoot);
    for (const [requestId, candidateWorkspaceRoot] of pendingApprovalsByRequestId.entries()) {
      if (candidateWorkspaceRoot === normalizedWorkspaceRoot) {
        pendingApprovalsByRequestId.delete(requestId);
      }
    }
  }

  return {
    describe,
    onEvent(listener: (event: RuntimeEvent<UnknownRecord>) => void) {
      if (typeof listener !== "function") {
        return () => undefined;
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSessionStore() {
      return sessionStore;
    },
    getSessionWriter() {
      return sessionWriter;
    },
    async initialize() {
      return {
        endpoint: "(spawn)",
        models: [],
      };
    },
    async close() {
      await Promise.all([...clientsByWorkspaceRoot.values()].map((client) => client.close()));
      clientsByWorkspaceRoot.clear();
      pendingApprovalsByRequestId.clear();
    },
    async startFreshThreadDraft({ workspaceRoot }: { workspaceRoot: string }) {
      for (const binding of sessionStore.listBindings()) {
        if (binding.activeWorkspaceRoot === workspaceRoot) {
          await sessionWriter.clearPendingThreadIdForWorkspace?.(binding.bindingKey, workspaceRoot);
        }
      }
      await closeWorkspaceClient(workspaceRoot);
      return { workspaceRoot };
    },
    async respondApproval({ requestId, decision }: { requestId: string; decision: "accept" | "decline" }) {
      const normalizedRequestId = normalizeString(requestId);
      const workspaceRoot = pendingApprovalsByRequestId.get(normalizedRequestId);
      const candidates = workspaceRoot
        ? [clientsByWorkspaceRoot.get(workspaceRoot)]
        : [...clientsByWorkspaceRoot.values()];
      for (const client of candidates) {
        if (client?.alive) {
          await client.sendResponse(normalizedRequestId, { decision });
          pendingApprovalsByRequestId.delete(normalizedRequestId);
          return {
            requestId: normalizedRequestId,
            decision: decision === "accept" ? "accept" : "decline",
          };
        }
      }
      throw new Error("no active claudecode session to respond to approval");
    },
    async cancelTurn({ threadId, turnId }: { threadId: string; turnId: string }) {
      for (const [workspaceRoot, client] of clientsByWorkspaceRoot.entries()) {
        if (clientMatchesThread(client, threadId) || normalizeThreadId(client.activeThreadId) === normalizeThreadId(threadId)) {
          await closeWorkspaceClient(workspaceRoot);
          return { threadId, turnId };
        }
      }
      return { threadId, turnId };
    },
    async resumeThread({ threadId, workspaceRoot = "" }: { threadId: string; workspaceRoot?: string }) {
      if (!workspaceRoot) {
        return { threadId };
      }
      const attached = await attachClientToThread({ workspaceRoot, threadId });
      return { threadId: attached.threadId || threadId };
    },
    async compactThread({ threadId, workspaceRoot }: { threadId: string; workspaceRoot: string }) {
      const attached = await attachClientToThread({ workspaceRoot, threadId });
      await attached.client.sendUserMessage({ text: "/compact", threadId: attached.threadId || threadId });
      return { threadId: attached.threadId || threadId, turnId: attached.client.pendingTurnId };
    },
    async refreshThreadInstructions({
      bindingKey = "",
      threadId,
      workspaceRoot,
      model = "",
    }: RefreshThreadInstructionsArgs) {
      const attached = await attachClientToThread({ workspaceRoot, threadId, model });
      const refreshText = buildInstructionRefreshText(
        config,
        workspaceRoot,
        bindingKey ? sessionStore.getBinding(bindingKey)?.senderId : "",
      );
      await attached.client.sendUserMessage({ text: refreshText, threadId: attached.threadId || threadId });
      if (bindingKey) {
        await sessionWriter.rememberWorkspaceBootstrapForThread(bindingKey, workspaceRoot, attached.threadId || threadId);
      }
      return { threadId: attached.threadId || threadId, turnId: attached.client.pendingTurnId };
    },
    async sendTextTurn({
      bindingKey,
      workspaceRoot,
      text,
      metadata = {},
      model = "",
    }: SendTextTurnArgs): Promise<RuntimeTurnSendState> {
      const pendingThreadId = normalizeThreadId(
        sessionStore.getPendingThreadIdForWorkspace(bindingKey, workspaceRoot),
      );
      let threadId = pendingThreadId || sessionStore.getThreadIdForWorkspace(bindingKey, workspaceRoot);
      let openingTurn = !threadId;
      let attached: { client: ClaudeCodeProcessClient; threadId: string };
      try {
        attached = await attachClientToThread({ workspaceRoot, threadId, model });
      } catch (error) {
        if (!threadId) {
          throw error;
        }
        await sessionWriter.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
        await sessionWriter.clearPendingThreadIdForWorkspace?.(bindingKey, workspaceRoot);
        threadId = "";
        openingTurn = true;
        attached = await attachClientToThread({ workspaceRoot, threadId: "", model });
      }
      const activeThreadId = attached.threadId || threadId || `pending-${Date.now()}`;
      const needsWorkspaceBootstrap = openingTurn
        || !sessionStore.hasWorkspaceBootstrapForThread(bindingKey, workspaceRoot, activeThreadId);
      const outboundText = openingTurn
        ? buildOpeningTurnText(config, workspaceRoot, text, metadata.senderId)
        : needsWorkspaceBootstrap
          ? buildWorkspaceBootstrapTurnText(config, workspaceRoot, text, metadata.senderId)
          : text;
      await attached.client.sendUserMessage({ text: outboundText, threadId: activeThreadId });
      let confirmedSessionId = "";
      if (!openingTurn) {
        confirmedSessionId = normalizeThreadId(
          attached.client.sessionId || await attached.client.waitForSessionId({ timeoutMs: CLAUDE_RESUME_SESSION_TIMEOUT_MS }),
        );
        if (confirmedSessionId && confirmedSessionId !== normalizeThreadId(activeThreadId)) {
          await closeWorkspaceClient(workspaceRoot);
          await sessionWriter.clearThreadIdForWorkspace(bindingKey, workspaceRoot);
          await sessionWriter.clearPendingThreadIdForWorkspace?.(bindingKey, workspaceRoot);
          throw new Error(`claudecode resumed unexpected session id: ${confirmedSessionId}`);
        }
      }
      if (pendingThreadId) {
        if (confirmedSessionId === pendingThreadId) {
          await sessionWriter.setThreadIdForWorkspace(bindingKey, workspaceRoot, confirmedSessionId, metadata);
          await sessionWriter.clearPendingThreadIdForWorkspace?.(bindingKey, workspaceRoot);
        }
      } else {
        await sessionWriter.setThreadIdForWorkspace(bindingKey, workspaceRoot, activeThreadId, metadata);
      }
      return {
        threadId: activeThreadId,
        workspaceBootstrapPending: needsWorkspaceBootstrap,
      };
    },
  };
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeThreadId(value: unknown): string {
  return normalizeString(value).replace(/\s+/gu, "");
}

function clientMatchesThread(client: ClaudeCodeProcessClient | null | undefined, threadId: unknown): boolean {
  const normalizedThreadId = normalizeThreadId(threadId);
  return Boolean(
    normalizedThreadId
    && client?.alive
    && (
      normalizeThreadId(client.sessionId) === normalizedThreadId
      || normalizeThreadId(client.resumeSessionId) === normalizedThreadId
    ),
  );
}
