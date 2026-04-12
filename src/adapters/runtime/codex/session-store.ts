// @ts-check

const { normalizeModelCatalog } = require("./model-catalog");
const {
  createEmptySessionState,
  normalizePendingApprovalRecord,
  normalizeSessionBinding,
  normalizeSessionState,
  sessionStoreStateSchema,
} = require("../../../contracts/session-state");
const {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} = require("../../../core/json-state");

class SessionStore {
  filePath: any;
  state: any;

  constructor({ filePath }: any) {
    this.filePath = filePath;
    this.state = createEmptySessionState();
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory() {
    ensureParentDirectory(this.filePath);
  }

  load() {
    // sessionStoreStateSchema already canonicalizes persisted session JSON.
    // Keep compatibility logic at that ingress so reads do not silently apply
    // a second round of shape repair in every store call site.
    this.state = readManagedJsonStateFile({
      filePath: this.filePath,
      fallback: createEmptySessionState(),
      label: "session store",
      schema: sessionStoreStateSchema,
    });
  }

  save() {
    this.state = normalizeSessionState(this.state);
    writeManagedJsonStateFile(this.filePath, this.state);
  }

  getBinding(bindingKey: any) {
    return this.state.bindings[normalizeValue(bindingKey)] || null;
  }

  listBindings() {
    return Object.entries(this.state.bindings || {}).map(([bindingKey, binding]: any) => ({
      bindingKey,
      ...(binding || {}),
    }));
  }

  getActiveWorkspaceRoot(bindingKey: any) {
    const activeWorkspaceRoot = this.state.bindings[normalizeValue(bindingKey)]?.activeWorkspaceRoot;
    return typeof activeWorkspaceRoot === "string" ? activeWorkspaceRoot : "";
  }

  updateBinding(bindingKey: any, nextBinding: any) {
    const normalizedBindingKey = normalizeValue(bindingKey);
    if (!normalizedBindingKey) {
      return null;
    }
    const current = this.getBinding(normalizedBindingKey) || {};
    const normalizedBinding = normalizeSessionBinding({
      ...current,
      ...(nextBinding || {}),
      updatedAt: new Date().toISOString(),
    });
    this.state.bindings = {
      ...(this.state.bindings || {}),
      [normalizedBindingKey]: normalizedBinding,
    };
    this.save();
    return this.state.bindings[normalizedBindingKey];
  }

  getThreadIdForWorkspace(bindingKey: any, workspaceRoot: any) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return "";
    }
    const threadId = this.state.bindings[normalizeValue(bindingKey)]?.threadIdByWorkspaceRoot?.[normalizedWorkspaceRoot];
    return typeof threadId === "string" ? threadId : "";
  }

  setThreadIdForWorkspace(bindingKey: any, workspaceRoot: any, threadId: any, extra: any = {}) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }

    const current = this.getBinding(bindingKey) || {};
    const threadIdByWorkspaceRoot = {
      ...getThreadMap(current),
      [normalizedWorkspaceRoot]: normalizedThreadId,
    };
    const workspaceBootstrapThreadIdByWorkspaceRoot = {
      ...getWorkspaceBootstrapThreadMap(current),
      [normalizedWorkspaceRoot]:
        getWorkspaceBootstrapThreadMap(current)[normalizedWorkspaceRoot] === normalizedThreadId
          ? normalizedThreadId
          : "",
    };

    return this.updateBinding(bindingKey, {
      ...current,
      ...extra,
      activeWorkspaceRoot: normalizedWorkspaceRoot,
      threadIdByWorkspaceRoot,
      workspaceBootstrapThreadIdByWorkspaceRoot,
    });
  }

  getCodexParamsForWorkspace(bindingKey: any, workspaceRoot: any) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return { model: "" };
    }
    const current = this.getBinding(bindingKey) || {};
    const codexParamsByWorkspaceRoot = getCodexParamsMap(current);
    const entry = codexParamsByWorkspaceRoot[normalizedWorkspaceRoot];
    return {
      model: typeof entry?.model === "string" ? entry.model : "",
    };
  }

  setCodexParamsForWorkspace(bindingKey: any, workspaceRoot: any, { model = "" }: any) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    const current = this.getBinding(bindingKey) || {};
    const codexParamsByWorkspaceRoot = {
      ...getCodexParamsMap(current),
      [normalizedWorkspaceRoot]: {
        model: normalizeValue(model),
      },
    };
    return this.updateBinding(bindingKey, {
      ...current,
      codexParamsByWorkspaceRoot,
    });
  }

  clearThreadIdForWorkspace(bindingKey: any, workspaceRoot: any) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    const current = this.getBinding(bindingKey) || {};
    const threadIdByWorkspaceRoot = {
      ...getThreadMap(current),
      [normalizedWorkspaceRoot]: "",
    };
    const workspaceBootstrapThreadIdByWorkspaceRoot = {
      ...getWorkspaceBootstrapThreadMap(current),
      [normalizedWorkspaceRoot]: "",
    };
    return this.updateBinding(bindingKey, {
      ...current,
      threadIdByWorkspaceRoot,
      workspaceBootstrapThreadIdByWorkspaceRoot,
    });
  }

  setActiveWorkspaceRoot(bindingKey: any, workspaceRoot: any) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    return this.updateBinding(bindingKey, {
      activeWorkspaceRoot: normalizedWorkspaceRoot,
    });
  }

  listWorkspaceRoots(bindingKey: any) {
    const current = this.getBinding(bindingKey) || {};
    return Object.keys(getThreadMap(current));
  }

  findBindingForThreadId(threadId: any) {
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedThreadId) {
      return null;
    }
    for (const [bindingKey, binding] of Object.entries(this.state.bindings || {})) {
      for (const [workspaceRoot, candidateThreadId] of Object.entries(getThreadMap(binding))) {
        if (candidateThreadId === normalizedThreadId) {
          return {
            bindingKey,
            workspaceRoot,
          };
        }
      }
    }
    return null;
  }

  hasWorkspaceBootstrapForThread(bindingKey: any, workspaceRoot: any, threadId: any) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedWorkspaceRoot || !normalizedThreadId) {
      return false;
    }
    const current = this.getBinding(bindingKey) || {};
    return getWorkspaceBootstrapThreadMap(current)[normalizedWorkspaceRoot] === normalizedThreadId;
  }

  rememberWorkspaceBootstrapForThread(bindingKey: any, workspaceRoot: any, threadId: any) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedWorkspaceRoot || !normalizedThreadId) {
      return this.getBinding(bindingKey);
    }
    const current = this.getBinding(bindingKey) || {};
    const workspaceBootstrapThreadIdByWorkspaceRoot = {
      ...getWorkspaceBootstrapThreadMap(current),
      [normalizedWorkspaceRoot]: normalizedThreadId,
    };
    return this.updateBinding(bindingKey, {
      ...current,
      workspaceBootstrapThreadIdByWorkspaceRoot,
    });
  }

  getApprovalCommandAllowlistForWorkspace(workspaceRoot: any) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return [];
    }
    const raw = this.state.approvalCommandAllowlistByWorkspaceRoot?.[normalizedWorkspaceRoot];
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter((entry: any) => Array.isArray(entry) && entry.every((part: any) => typeof part === "string" && part))
      .map((entry: any) => entry.slice())
      .filter((entry: any) => entry.length);
  }

  rememberApprovalPrefixForWorkspace(workspaceRoot: any, commandTokens: any) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    const normalizedTokens = normalizeCommandTokens(commandTokens);
    if (!normalizedWorkspaceRoot || !normalizedTokens.length) {
      return this.getApprovalCommandAllowlistForWorkspace(workspaceRoot);
    }
    const current = this.getApprovalCommandAllowlistForWorkspace(normalizedWorkspaceRoot);
    if (!current.some((entry: any) => isSameTokenList(entry, normalizedTokens))) {
      current.push(normalizedTokens);
      this.state.approvalCommandAllowlistByWorkspaceRoot = {
        ...(this.state.approvalCommandAllowlistByWorkspaceRoot || {}),
        [normalizedWorkspaceRoot]: current,
      };
      this.save();
    }
    return current;
  }

  getPendingApprovalForThread(threadId: any) {
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedThreadId) {
      return null;
    }
    const approval = this.state.approvalPromptStateByThreadId?.[normalizedThreadId];
    if (!approval || typeof approval !== "object") {
      return null;
    }
    return { ...approval };
  }

  listPendingApprovals() {
    return Object.entries(this.state.approvalPromptStateByThreadId || {}).map(([threadId, approval]: any) => ({
      threadId,
      approval: { ...approval },
    }));
  }

  rememberPendingApprovalForThread(threadId: any, approval: any, {
    signature = "",
    promptedAt = "",
  }: any = {}) {
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedThreadId) {
      return null;
    }
    const existing = this.getPendingApprovalForThread(normalizedThreadId);
    const normalizedApproval = normalizePendingApprovalRecord({
      ...(existing || {}),
      ...(approval || {}),
      signature: normalizeValue(signature)
        || normalizeValue(approval?.signature)
        || normalizeValue(existing?.signature)
        || "",
      promptedAt: normalizeValue(promptedAt) || normalizeValue(approval?.promptedAt) || new Date().toISOString(),
    });
    if (!normalizedApproval) {
      return null;
    }
    this.state.approvalPromptStateByThreadId = {
      ...(this.state.approvalPromptStateByThreadId || {}),
      [normalizedThreadId]: normalizedApproval,
    };
    this.save();
    return this.getPendingApprovalForThread(normalizedThreadId);
  }

  getApprovalPromptState(threadId: any) {
    return this.getPendingApprovalForThread(threadId);
  }

  rememberApprovalPrompt(threadId: any, requestIdOrApproval: any, signature: string = "") {
    if (requestIdOrApproval && typeof requestIdOrApproval === "object") {
      return this.rememberPendingApprovalForThread(threadId, requestIdOrApproval, { signature });
    }
    const existing = this.getPendingApprovalForThread(threadId) || {};
    return this.rememberPendingApprovalForThread(threadId, {
      ...existing,
      requestId: requestIdOrApproval,
    }, {
      signature,
      promptedAt: new Date().toISOString(),
    });
  }

  clearPendingApprovalForThread(threadId: any) {
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedThreadId || !this.state.approvalPromptStateByThreadId?.[normalizedThreadId]) {
      return;
    }
    const next = {
      ...(this.state.approvalPromptStateByThreadId || {}),
    };
    delete next[normalizedThreadId];
    this.state.approvalPromptStateByThreadId = next;
    this.save();
  }

  clearApprovalPrompt(threadId: any) {
    this.clearPendingApprovalForThread(threadId);
  }

  getAvailableModelCatalog() {
    const raw = this.state.availableModelCatalog;
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const models = normalizeModelCatalog(raw.models);
    if (!models.length) {
      return null;
    }
    const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : "";
    return { models, updatedAt };
  }

  setAvailableModelCatalog(models: any) {
    const normalizedModels = normalizeModelCatalog(models);
    if (!normalizedModels.length) {
      return null;
    }
    this.state.availableModelCatalog = {
      models: normalizedModels,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.state.availableModelCatalog;
  }

  buildBindingKey({ workspaceId, accountId, senderId }: any) {
    return `${normalizeValue(workspaceId)}:${normalizeValue(accountId)}:${normalizeValue(senderId)}`;
  }
}

function normalizeValue(value: any) {
  return typeof value === "string" ? value.trim() : "";
}

function getThreadMap(binding: any) {
  return binding?.threadIdByWorkspaceRoot && typeof binding.threadIdByWorkspaceRoot === "object"
    ? binding.threadIdByWorkspaceRoot
    : {};
}

function getCodexParamsMap(binding: any) {
  return binding?.codexParamsByWorkspaceRoot && typeof binding.codexParamsByWorkspaceRoot === "object"
    ? binding.codexParamsByWorkspaceRoot
    : {};
}

function getWorkspaceBootstrapThreadMap(binding: any) {
  return binding?.workspaceBootstrapThreadIdByWorkspaceRoot
    && typeof binding.workspaceBootstrapThreadIdByWorkspaceRoot === "object"
    ? binding.workspaceBootstrapThreadIdByWorkspaceRoot
    : {};
}

function normalizeCommandTokens(tokens: any) {
  return Array.isArray(tokens)
    ? tokens.map((part: any) => normalizeValue(part)).filter(Boolean)
    : [];
}

function isSameTokenList(left: any, right: any) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((value: any, index: any) => value === right[index]);
}

module.exports = { SessionStore };

export {};
