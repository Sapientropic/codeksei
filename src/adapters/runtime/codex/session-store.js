// @ts-check

const { normalizeModelCatalog } = require("./model-catalog");
const {
  createEmptySessionState,
  listPendingApprovalEntries,
  normalizePendingApprovalRecord,
  normalizeSessionBinding,
  normalizeSessionState,
  validateSessionStoreState,
} = require("../../../contracts/session-state");
const {
  ensureParentDirectory,
  readManagedJsonStateFile,
  writeManagedJsonStateFile,
} = require("../../../core/json-state");

class SessionStore {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.state = createEmptySessionState();
    this.ensureParentDirectory();
    this.load();
  }

  ensureParentDirectory() {
    ensureParentDirectory(this.filePath);
  }

  load() {
    const parsed = readManagedJsonStateFile({
      filePath: this.filePath,
      fallback: createEmptySessionState(),
      label: "session store",
      validate: validateSessionStoreState,
    });
    this.state = normalizeSessionState(parsed);
  }

  save() {
    this.state = normalizeSessionState(this.state);
    writeManagedJsonStateFile(this.filePath, this.state);
  }

  getBinding(bindingKey) {
    return this.state.bindings[normalizeValue(bindingKey)] || null;
  }

  listBindings() {
    return Object.entries(this.state.bindings || {}).map(([bindingKey, binding]) => ({
      bindingKey,
      ...(binding || {}),
    }));
  }

  getActiveWorkspaceRoot(bindingKey) {
    return normalizeValue(this.state.bindings[normalizeValue(bindingKey)]?.activeWorkspaceRoot);
  }

  updateBinding(bindingKey, nextBinding) {
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

  getThreadIdForWorkspace(bindingKey, workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return "";
    }
    return this.state.bindings[normalizeValue(bindingKey)]?.threadIdByWorkspaceRoot?.[normalizedWorkspaceRoot] || "";
  }

  setThreadIdForWorkspace(bindingKey, workspaceRoot, threadId, extra = {}) {
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

  getCodexParamsForWorkspace(bindingKey, workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return { model: "" };
    }
    const current = this.getBinding(bindingKey) || {};
    const codexParamsByWorkspaceRoot = getCodexParamsMap(current);
    const entry = codexParamsByWorkspaceRoot[normalizedWorkspaceRoot];
    return {
      model: normalizeValue(entry?.model),
    };
  }

  setCodexParamsForWorkspace(bindingKey, workspaceRoot, { model = "" }) {
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

  clearThreadIdForWorkspace(bindingKey, workspaceRoot) {
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

  setActiveWorkspaceRoot(bindingKey, workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return this.getBinding(bindingKey);
    }
    return this.updateBinding(bindingKey, {
      activeWorkspaceRoot: normalizedWorkspaceRoot,
    });
  }

  listWorkspaceRoots(bindingKey) {
    const current = this.getBinding(bindingKey) || {};
    return Object.keys(getThreadMap(current));
  }

  findBindingForThreadId(threadId) {
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedThreadId) {
      return null;
    }
    for (const [bindingKey, binding] of Object.entries(this.state.bindings || {})) {
      for (const [workspaceRoot, candidateThreadId] of Object.entries(getThreadMap(binding))) {
        if (normalizeValue(candidateThreadId) === normalizedThreadId) {
          return {
            bindingKey,
            workspaceRoot: normalizeValue(workspaceRoot),
          };
        }
      }
    }
    return null;
  }

  hasWorkspaceBootstrapForThread(bindingKey, workspaceRoot, threadId) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedWorkspaceRoot || !normalizedThreadId) {
      return false;
    }
    const current = this.getBinding(bindingKey) || {};
    return getWorkspaceBootstrapThreadMap(current)[normalizedWorkspaceRoot] === normalizedThreadId;
  }

  rememberWorkspaceBootstrapForThread(bindingKey, workspaceRoot, threadId) {
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

  getApprovalCommandAllowlistForWorkspace(workspaceRoot) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    if (!normalizedWorkspaceRoot) {
      return [];
    }
    const raw = this.state.approvalCommandAllowlistByWorkspaceRoot?.[normalizedWorkspaceRoot];
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw
      .filter((entry) => Array.isArray(entry))
      .map((entry) => entry.map((part) => normalizeValue(part)).filter(Boolean))
      .filter((entry) => entry.length);
  }

  rememberApprovalPrefixForWorkspace(workspaceRoot, commandTokens) {
    const normalizedWorkspaceRoot = normalizeValue(workspaceRoot);
    const normalizedTokens = normalizeCommandTokens(commandTokens);
    if (!normalizedWorkspaceRoot || !normalizedTokens.length) {
      return this.getApprovalCommandAllowlistForWorkspace(workspaceRoot);
    }
    const current = this.getApprovalCommandAllowlistForWorkspace(normalizedWorkspaceRoot);
    if (!current.some((entry) => isSameTokenList(entry, normalizedTokens))) {
      current.push(normalizedTokens);
      this.state.approvalCommandAllowlistByWorkspaceRoot = {
        ...(this.state.approvalCommandAllowlistByWorkspaceRoot || {}),
        [normalizedWorkspaceRoot]: current,
      };
      this.save();
    }
    return current;
  }

  getPendingApprovalForThread(threadId) {
    const normalizedThreadId = normalizeValue(threadId);
    if (!normalizedThreadId) {
      return null;
    }
    const raw = this.state.approvalPromptStateByThreadId?.[normalizedThreadId];
    const normalized = normalizePendingApprovalRecord(raw);
    return normalized ? { ...normalized } : null;
  }

  listPendingApprovals() {
    return listPendingApprovalEntries(this.state).map((entry) => ({
      threadId: entry.threadId,
      approval: { ...entry.approval },
    }));
  }

  rememberPendingApprovalForThread(threadId, approval, {
    signature = "",
    promptedAt = "",
  } = {}) {
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

  getApprovalPromptState(threadId) {
    return this.getPendingApprovalForThread(threadId);
  }

  rememberApprovalPrompt(threadId, requestIdOrApproval, signature = "") {
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

  clearPendingApprovalForThread(threadId) {
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

  clearApprovalPrompt(threadId) {
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
    const updatedAt = normalizeValue(raw.updatedAt);
    return { models, updatedAt };
  }

  setAvailableModelCatalog(models) {
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

  buildBindingKey({ workspaceId, accountId, senderId }) {
    return `${normalizeValue(workspaceId)}:${normalizeValue(accountId)}:${normalizeValue(senderId)}`;
  }
}

function normalizeValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getThreadMap(binding) {
  return binding?.threadIdByWorkspaceRoot && typeof binding.threadIdByWorkspaceRoot === "object"
    ? binding.threadIdByWorkspaceRoot
    : {};
}

function getCodexParamsMap(binding) {
  return binding?.codexParamsByWorkspaceRoot && typeof binding.codexParamsByWorkspaceRoot === "object"
    ? binding.codexParamsByWorkspaceRoot
    : {};
}

function getWorkspaceBootstrapThreadMap(binding) {
  return binding?.workspaceBootstrapThreadIdByWorkspaceRoot
    && typeof binding.workspaceBootstrapThreadIdByWorkspaceRoot === "object"
    ? binding.workspaceBootstrapThreadIdByWorkspaceRoot
    : {};
}

function normalizeCommandTokens(tokens) {
  return Array.isArray(tokens)
    ? tokens.map((part) => normalizeValue(part)).filter(Boolean)
    : [];
}

function isSameTokenList(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

module.exports = { SessionStore };
