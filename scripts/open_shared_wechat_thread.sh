#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${CODEKSEI_SHARED_PORT:-8765}"
REMOTE_URL="ws://127.0.0.1:${PORT}"
STATE_DIR="${CODEKSEI_STATE_DIR:-$HOME/.codeksei}"
LOG_DIR="${STATE_DIR}/logs"
PID_FILE="${LOG_DIR}/shared-wechat.pid"
READYZ_URL="http://127.0.0.1:${PORT}/readyz"

if [[ "${CODEKSEI_RUNTIME:-codex}" == "hermes" || "${CODEKSEI_CHANNEL_PROVIDER:-}" == "hermes" ]]; then
  echo "Hermes Hosted Mode 下共享线程由 Hermes 宿主管理；不要再执行 open_shared_wechat_thread.sh。" >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"

function resolve_pid_cwd() {
  local pid="$1"
  lsof -a -p "${pid}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

function readyz_is_up() {
  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi
  curl -sf "${READYZ_URL}" >/dev/null
}

function resolve_bridge_pid_from_file() {
  local candidate_pid="$1"
  [[ -n "${candidate_pid}" ]] || return 1
  if ! kill -0 "${candidate_pid}" 2>/dev/null; then
    return 1
  fi

  if [[ "$(resolve_pid_cwd "${candidate_pid}")" == "${ROOT_DIR}" ]]; then
    if readyz_is_up; then
      echo "${candidate_pid}"
      return 0
    fi
  fi

  return 1
}

function find_existing_bridge_pid() {
  if [[ -f "${PID_FILE}" ]]; then
    local pid_from_file
    pid_from_file="$(cat "${PID_FILE}" 2>/dev/null || true)"
    local resolved_from_file
    resolved_from_file="$(resolve_bridge_pid_from_file "${pid_from_file}" || true)"
    if [[ -n "${resolved_from_file}" ]]; then
      echo "${resolved_from_file}"
      return 0
    fi
  fi

  return 1
}

"${ROOT_DIR}/scripts/start_shared_app_server.sh"

EXISTING_PID="$(find_existing_bridge_pid || true)"

if [[ -z "${EXISTING_PID}" ]]; then
  echo "shared codeksei is not running." >&2
  echo "start it in a separate terminal and keep it in the foreground:" >&2
  echo "  cd ${ROOT_DIR}" >&2
  echo "  ./scripts/start_shared_wechat.sh" >&2
  exit 1
fi

echo "${EXISTING_PID}" > "${PID_FILE}"

echo "shared codeksei running pid=${EXISTING_PID} endpoint=${REMOTE_URL}"

export CODEKSEI_RUNTIME_ENDPOINT="${REMOTE_URL}"
export CODEKSEI_CODEX_ENDPOINT="${REMOTE_URL}"
exec "${ROOT_DIR}/scripts/open_wechat_thread.sh" "$@"
