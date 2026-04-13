#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT_DIR}/scripts/lib/runtime-entrypoints.sh"
PORT="${CODEKSEI_SHARED_PORT:-8765}"
STATE_DIR="${CODEKSEI_STATE_DIR:-$HOME/.codeksei}"
LOG_DIR="${STATE_DIR}/logs"
PID_FILE="${LOG_DIR}/shared-wechat.pid"
READYZ_URL="http://127.0.0.1:${PORT}/readyz"

if [[ "${CODEKSEI_RUNTIME:-codex}" == "hermes" || "${CODEKSEI_CHANNEL_PROVIDER:-}" == "hermes" ]]; then
  echo "Hermes Hosted Mode 下不要启动 Codeksei 自己的 shared Weixin bridge；请改用 Hermes gateway。" >&2
  exit 1
fi

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

function cleanup_pid_file() {
  if [[ -f "${PID_FILE}" ]]; then
    local current_pid
    current_pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [[ "${current_pid}" == "$$" ]]; then
      rm -f "${PID_FILE}"
    fi
  fi
}

"${ROOT_DIR}/scripts/start_shared_app_server.sh"
mkdir -p "${LOG_DIR}"

EXISTING_PID="$(find_existing_bridge_pid || true)"
if [[ -n "${EXISTING_PID}" ]]; then
  echo "${EXISTING_PID}" > "${PID_FILE}"
  echo "shared codeksei already running pid=${EXISTING_PID}"
  exit 0
fi

BRIDGE_PID=""
function shutdown_bridge() {
  if [[ -n "${BRIDGE_PID}" ]] && kill -0 "${BRIDGE_PID}" 2>/dev/null; then
    kill "${BRIDGE_PID}" 2>/dev/null || true
  fi
  cleanup_pid_file
}

trap shutdown_bridge EXIT INT TERM
cd "${ROOT_DIR}"
export CODEKSEI_CODEX_ENDPOINT="ws://127.0.0.1:${PORT}"
node "$(codeksei_runtime_entrypoint cli)" start --checkin &
BRIDGE_PID="$!"
echo "${BRIDGE_PID}" > "${PID_FILE}"
wait "${BRIDGE_PID}"
