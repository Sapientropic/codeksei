#!/bin/zsh
set -euo pipefail

PORT="${CODEKSEI_SHARED_PORT:-8765}"
REMOTE_URL="${CODEKSEI_CODEX_ENDPOINT:-ws://127.0.0.1:${PORT}}"
STATE_DIR="${CODEKSEI_STATE_DIR:-$HOME/.codeksei}"
SESSION_FILE="${CODEKSEI_SESSIONS_FILE:-${STATE_DIR}/sessions.json}"
WORKSPACE_ROOT="${CODEKSEI_WORKSPACE_ROOT:-$PWD}"
ACCOUNT_DIR="${STATE_DIR}/accounts"
ACCOUNT_ID="${CODEKSEI_ACCOUNT_ID:-}"

if [[ ! -f "${SESSION_FILE}" ]]; then
  echo "session file not found: ${SESSION_FILE}" >&2
  exit 1
fi

RESOLVED="$(
  node -e '
    const fs = require("fs");
    const path = require("path");

    const sessionFile = process.argv[1];
    const workspaceRoot = process.argv[2];
    const accountDir = process.argv[3];
    const explicitAccountId = process.argv[4];
    const data = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    const bindings = Object.entries(data.bindings || {}).map(([bindingKey, binding]) => ({ bindingKey, ...(binding || {}) }));

    function normalize(value) {
      return typeof value === "string" ? value.trim() : "";
    }

    function normalizePath(value) {
      return normalize(value).replace(/\\/g, "/");
    }

    function canonicalizeWorkspaceRoot(root) {
      const normalizedRoot = normalizePath(root);
      if (!normalizedRoot) {
        return "";
      }
      try {
        const resolved = fs.realpathSync.native
          ? fs.realpathSync.native(normalizedRoot)
          : fs.realpathSync(normalizedRoot);
        return normalizePath(resolved);
      } catch {
        return normalizedRoot;
      }
    }

    function resolveSelectedAccountId(dir, configuredAccountId) {
      const normalizedConfiguredAccountId = normalize(configuredAccountId);
      if (normalizedConfiguredAccountId) {
        return normalizedConfiguredAccountId;
      }

      const normalizedDir = normalize(dir);
      if (!normalizedDir || !fs.existsSync(normalizedDir)) {
        return "";
      }

      const entries = fs.readdirSync(normalizedDir)
        .filter((name) => name.endsWith(".json") && !name.endsWith(".context-tokens.json"))
        .map((name) => {
          const fullPath = path.join(normalizedDir, name);
          try {
            const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
            return normalize(parsed && parsed.accountId);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
      ;
      const uniqueEntries = [...new Set(entries)];
      if (uniqueEntries.length <= 1) {
        return uniqueEntries[0] || "";
      }
      throw new Error("multiple accounts detected; set CODEKSEI_ACCOUNT_ID before opening the shared thread");
    }

    function getThreadId(binding, root) {
      const normalizedRoot = normalize(root);
      if (!normalizedRoot) {
        return "";
      }
      const map = binding && typeof binding.threadIdByWorkspaceRoot === "object"
        ? binding.threadIdByWorkspaceRoot
        : {};
      return normalize(map[normalizedRoot]);
    }

    const normalizedWorkspaceRoot = canonicalizeWorkspaceRoot(workspaceRoot);
    const currentAccountId = resolveSelectedAccountId(accountDir, explicitAccountId);

    const filteredBindings = bindings
      .filter((binding) => !currentAccountId || normalize(binding.accountId) === currentAccountId)
      .sort((left, right) => Date.parse(normalize(right.updatedAt)) - Date.parse(normalize(left.updatedAt)));

    const exactBinding = filteredBindings.find((binding) => getThreadId(binding, normalizedWorkspaceRoot));
    if (exactBinding) {
      process.stdout.write(`${getThreadId(exactBinding, normalizedWorkspaceRoot)}\n${normalizedWorkspaceRoot}`);
      process.exit(0);
    }

    const activeBinding = filteredBindings.find((binding) => {
      const activeWorkspaceRoot = normalize(binding && binding.activeWorkspaceRoot);
      return activeWorkspaceRoot && getThreadId(binding, activeWorkspaceRoot);
    });
    if (activeBinding) {
      const activeWorkspaceRoot = normalize(activeBinding.activeWorkspaceRoot);
      process.stdout.write(`${getThreadId(activeBinding, activeWorkspaceRoot)}\n${activeWorkspaceRoot}`);
      process.exit(0);
    }

    process.exit(1);
  ' "${SESSION_FILE}" "${WORKSPACE_ROOT}" "${ACCOUNT_DIR}" "${ACCOUNT_ID}"
)"

if [[ -z "${RESOLVED}" ]]; then
  echo "no bound WeChat thread found for workspace: ${WORKSPACE_ROOT}" >&2
  exit 1
fi

THREAD_ID="${RESOLVED%%$'\n'*}"
RESOLVED_WORKSPACE_ROOT="${RESOLVED#*$'\n'}"

if [[ -z "${THREAD_ID}" || -z "${RESOLVED_WORKSPACE_ROOT}" ]]; then
  echo "failed to resolve bound WeChat thread from: ${SESSION_FILE}" >&2
  exit 1
fi

exec codex resume "${THREAD_ID}" --remote "${REMOTE_URL}" -C "${RESOLVED_WORKSPACE_ROOT}" "$@"
