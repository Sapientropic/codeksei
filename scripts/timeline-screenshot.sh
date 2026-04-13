#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT}/scripts/lib/runtime-entrypoints.sh"
ARGS=()

for arg in "$@"; do
  if [[ "$arg" == "--send" ]]; then
    continue
  fi
  ARGS+=("$arg")
done

cd "$ROOT"
exec node "$(codeksei_runtime_entrypoint cli)" timeline screenshot "${ARGS[@]}"
