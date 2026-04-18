#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "${ROOT}/scripts/lib/runtime-entrypoints.sh"

cd "$ROOT"
exec node "$(codeksei_runtime_entrypoint cli)" timeline screenshot "$@"
