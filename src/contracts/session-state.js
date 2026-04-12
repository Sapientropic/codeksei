// @ts-check

function createEmptySessionState() {
  return {
    bindings: {},
    approvalCommandAllowlistByWorkspaceRoot: {},
    approvalPromptStateByThreadId: {},
    availableModelCatalog: {
      models: [],
      updatedAt: "",
    },
  };
}

function normalizeSessionState(state) {
  const source = isPlainObject(state) ? state : {};
  return {
    ...source,
    ...createEmptySessionState(),
    bindings: normalizeBindings(source.bindings),
    approvalCommandAllowlistByWorkspaceRoot: normalizeApprovalAllowlistMap(
      source.approvalCommandAllowlistByWorkspaceRoot
    ),
    approvalPromptStateByThreadId: normalizePendingApprovalMap(source.approvalPromptStateByThreadId),
    availableModelCatalog: normalizeAvailableModelCatalog(source.availableModelCatalog),
  };
}

function validateSessionStoreState(state) {
  if (!isPlainObject(state)) {
    return "session store top-level state must be an object";
  }
  if ("bindings" in state && !isPlainObject(state.bindings)) {
    return "session store bindings must be an object";
  }
  for (const [bindingKey, binding] of Object.entries(state.bindings || {})) {
    const error = validateBinding(binding, bindingKey);
    if (error) {
      return error;
    }
  }
  if (
    "approvalCommandAllowlistByWorkspaceRoot" in state
    && !isPlainObject(state.approvalCommandAllowlistByWorkspaceRoot)
  ) {
    return "session store approvalCommandAllowlistByWorkspaceRoot must be an object";
  }
  for (const [workspaceRoot, entries] of Object.entries(state.approvalCommandAllowlistByWorkspaceRoot || {})) {
    if (!Array.isArray(entries)) {
      return `session store allowlist for workspace ${workspaceRoot} must be an array`;
    }
    for (let index = 0; index < entries.length; index += 1) {
      if (!Array.isArray(entries[index]) || entries[index].some((part) => typeof part !== "string")) {
        return `session store allowlist ${workspaceRoot}[${index}] must be string[]`;
      }
    }
  }
  if (
    "approvalPromptStateByThreadId" in state
    && !isPlainObject(state.approvalPromptStateByThreadId)
  ) {
    return "session store approvalPromptStateByThreadId must be an object";
  }
  for (const [threadId, approval] of Object.entries(state.approvalPromptStateByThreadId || {})) {
    const error = validatePendingApprovalRecord(approval, threadId);
    if (error) {
      return error;
    }
  }
  if ("availableModelCatalog" in state) {
    const error = validateAvailableModelCatalog(state.availableModelCatalog);
    if (error) {
      return error;
    }
  }
  return true;
}

function normalizeSessionBinding(binding) {
  const source = isPlainObject(binding) ? binding : {};
  return {
    ...source,
    workspaceId: normalizeText(source.workspaceId),
    accountId: normalizeText(source.accountId),
    senderId: normalizeText(source.senderId),
    activeWorkspaceRoot: normalizeText(source.activeWorkspaceRoot),
    updatedAt: normalizeIsoTimestamp(source.updatedAt),
    threadIdByWorkspaceRoot: normalizeStringMap(source.threadIdByWorkspaceRoot),
    codexParamsByWorkspaceRoot: normalizeCodexParamsMap(source.codexParamsByWorkspaceRoot),
    workspaceBootstrapThreadIdByWorkspaceRoot: normalizeStringMap(
      source.workspaceBootstrapThreadIdByWorkspaceRoot
    ),
  };
}

function normalizeBindings(value) {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([bindingKey, binding]) => [normalizeText(bindingKey), normalizeSessionBinding(binding)])
      .filter(([bindingKey]) => Boolean(bindingKey))
  );
}

function normalizeCodexParamsMap(value) {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([workspaceRoot, params]) => {
        const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
        if (!normalizedWorkspaceRoot) {
          return null;
        }
        return [normalizedWorkspaceRoot, {
          model: normalizeText(params?.model),
        }];
      })
      .filter(Boolean)
  );
}

function normalizeStringMap(value) {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]) => [normalizeText(key), normalizeText(entryValue)])
      .filter(([key]) => Boolean(key))
  );
}

function normalizeApprovalAllowlistMap(value) {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([workspaceRoot, entries]) => {
        const normalizedWorkspaceRoot = normalizeText(workspaceRoot);
        if (!normalizedWorkspaceRoot) {
          return null;
        }
        return [normalizedWorkspaceRoot, normalizeApprovalAllowlistEntries(entries)];
      })
      .filter(Boolean)
  );
}

function normalizeApprovalAllowlistEntries(value) {
  return Array.isArray(value)
    ? value
      .map((entry) => normalizeCommandTokens(entry))
      .filter((entry) => entry.length)
    : [];
}

function normalizePendingApprovalMap(value) {
  if (!isPlainObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([threadId, approval]) => {
        const normalizedThreadId = normalizeText(threadId);
        const normalizedApproval = normalizePendingApprovalRecord(approval);
        if (!normalizedThreadId || !normalizedApproval) {
          return null;
        }
        return [normalizedThreadId, normalizedApproval];
      })
      .filter(Boolean)
  );
}

function normalizePendingApprovalRecord(value) {
  if (!isPlainObject(value)) {
    return null;
  }
  const requestId = normalizeRequestId(value.requestId);
  if (!requestId) {
    return null;
  }
  return {
    requestId,
    reason: normalizeText(value.reason),
    command: normalizeText(value.command),
    commandTokens: normalizeCommandTokens(value.commandTokens),
    signature: normalizeText(value.signature),
    promptedAt: normalizeIsoTimestamp(value.promptedAt),
  };
}

function normalizeAvailableModelCatalog(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    ...source,
    models: Array.isArray(source.models) ? source.models.slice() : [],
    updatedAt: normalizeIsoTimestamp(source.updatedAt),
  };
}

function validateBinding(binding, bindingKey) {
  if (!isPlainObject(binding)) {
    return `session store binding ${bindingKey} must be an object`;
  }
  for (const key of ["workspaceId", "accountId", "senderId", "activeWorkspaceRoot", "updatedAt"]) {
    if (key in binding && typeof binding[key] !== "string") {
      return `session store binding ${bindingKey}.${key} must be a string`;
    }
  }
  for (const key of ["threadIdByWorkspaceRoot", "workspaceBootstrapThreadIdByWorkspaceRoot"]) {
    if (key in binding) {
      if (!isPlainObject(binding[key])) {
        return `session store binding ${bindingKey}.${key} must be an object`;
      }
      for (const [mapKey, mapValue] of Object.entries(binding[key])) {
        if (typeof mapKey !== "string" || typeof mapValue !== "string") {
          return `session store binding ${bindingKey}.${key} entries must be string:string`;
        }
      }
    }
  }
  if ("codexParamsByWorkspaceRoot" in binding) {
    if (!isPlainObject(binding.codexParamsByWorkspaceRoot)) {
      return `session store binding ${bindingKey}.codexParamsByWorkspaceRoot must be an object`;
    }
    for (const [workspaceRoot, params] of Object.entries(binding.codexParamsByWorkspaceRoot)) {
      if (typeof workspaceRoot !== "string" || !isPlainObject(params)) {
        return `session store binding ${bindingKey}.codexParamsByWorkspaceRoot entries must be object values`;
      }
      if ("model" in params && typeof params.model !== "string") {
        return `session store binding ${bindingKey}.codexParamsByWorkspaceRoot.${workspaceRoot}.model must be a string`;
      }
    }
  }
  return "";
}

function validatePendingApprovalRecord(value, threadId) {
  if (!isPlainObject(value)) {
    return `session store approvalPromptStateByThreadId.${threadId} must be an object`;
  }
  if (!normalizeRequestId(value.requestId)) {
    return `session store approvalPromptStateByThreadId.${threadId}.requestId must be a non-empty string`;
  }
  for (const key of ["reason", "command", "signature", "promptedAt"]) {
    if (key in value && typeof value[key] !== "string") {
      return `session store approvalPromptStateByThreadId.${threadId}.${key} must be a string`;
    }
  }
  if ("commandTokens" in value) {
    if (!Array.isArray(value.commandTokens) || value.commandTokens.some((part) => typeof part !== "string")) {
      return `session store approvalPromptStateByThreadId.${threadId}.commandTokens must be string[]`;
    }
  }
  return "";
}

function validateAvailableModelCatalog(value) {
  if (!isPlainObject(value)) {
    return "session store availableModelCatalog must be an object";
  }
  if ("models" in value && !Array.isArray(value.models)) {
    return "session store availableModelCatalog.models must be an array";
  }
  if ("updatedAt" in value && typeof value.updatedAt !== "string") {
    return "session store availableModelCatalog.updatedAt must be a string";
  }
  return "";
}

function listPendingApprovalEntries(state) {
  return Object.entries(normalizePendingApprovalMap(state?.approvalPromptStateByThreadId))
    .map(([threadId, approval]) => ({
      threadId,
      approval,
    }));
}

function normalizeCommandTokens(tokens) {
  return Array.isArray(tokens)
    ? tokens.map((token) => normalizeText(token)).filter(Boolean)
    : [];
}

function normalizeRequestId(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
}

function normalizeIsoTimestamp(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  createEmptySessionState,
  listPendingApprovalEntries,
  normalizePendingApprovalRecord,
  normalizeSessionBinding,
  normalizeSessionState,
  validateSessionStoreState,
};
