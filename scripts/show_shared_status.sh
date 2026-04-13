#!/bin/zsh
set -euo pipefail

PORT="${CODEKSEI_SHARED_PORT:-8765}"
LISTEN_URL="ws://127.0.0.1:${PORT}"
STATE_DIR="${CODEKSEI_STATE_DIR:-$HOME/.codeksei}"
LOG_DIR="${STATE_DIR}/logs"
APP_SERVER_PID_FILE="${LOG_DIR}/shared-app-server.pid"
WECHAT_PID_FILE="${LOG_DIR}/shared-wechat.pid"
WECHAT_LOG_FILE="${LOG_DIR}/shared-wechat.log"
RUNTIME="${CODEKSEI_RUNTIME:-codex}"
CHANNEL_PROVIDER="${CODEKSEI_CHANNEL_PROVIDER:-}"

if [[ -z "${CHANNEL_PROVIDER}" ]]; then
  if [[ "${RUNTIME}" == "hermes" ]]; then
    CHANNEL_PROVIDER="hermes"
  else
    CHANNEL_PROVIDER="codeksei"
  fi
fi

if [[ "${RUNTIME}" == "hermes" && "${CHANNEL_PROVIDER}" == "hermes" ]]; then
  echo "profile=hosted-hermes-weixin"
  echo "mode=hosted"
  echo "runtime=hermes"
  echo "channel_provider=hermes"
  echo "channel=weixin"
  echo "shared_bridge=managed_by_host"
  exit 0
fi

if [[ "${RUNTIME}" == "hermes" || "${CHANNEL_PROVIDER}" == "hermes" ]]; then
  echo "profile=unsupported"
  echo "mode=unsupported"
  echo "runtime=${RUNTIME}"
  echo "channel_provider=${CHANNEL_PROVIDER}"
  echo "channel=weixin"
  echo "supported=no"
  echo "shared_bridge=unsupported"
  exit 0
fi

function print_pid_state() {
  local label="$1"
  local pid_file="$2"

  if [[ -f "${pid_file}" ]]; then
    local pid
    pid="$(cat "${pid_file}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      echo "${label}=${pid}"
      return
    fi
    echo "${label}=stale"
    return
  fi

  echo "${label}=missing"
}

echo "listen=${LISTEN_URL}"
print_pid_state "shared_app_server_pid" "${APP_SERVER_PID_FILE}"
print_pid_state "shared_codeksei_pid" "${WECHAT_PID_FILE}"

if command -v curl >/dev/null 2>&1; then
  if curl -sf "http://127.0.0.1:${PORT}/readyz" >/dev/null; then
    echo "readyz=ok"
  else
    echo "readyz=down"
  fi
fi

if command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN || true
fi

if [[ -f "${WECHAT_LOG_FILE}" ]]; then
  echo "--- ${WECHAT_LOG_FILE} (tail) ---"
  tail -n 20 "${WECHAT_LOG_FILE}" || true
fi
