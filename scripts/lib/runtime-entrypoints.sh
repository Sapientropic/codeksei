#!/bin/zsh

codeksei_runtime_entrypoint() {
  case "$1" in
    cli) printf '%s\n' "./dist/src/index.js" ;;
    shared:start) printf '%s\n' "./dist/src/shared/shared-start.js" ;;
    shared:open) printf '%s\n' "./dist/src/shared/shared-open.js" ;;
    shared:status) printf '%s\n' "./dist/src/shared/shared-status.js" ;;
    shared:supervisor) printf '%s\n' "./dist/src/shared/shared-supervisor.js" ;;
    shared:watchdog) printf '%s\n' "./dist/src/shared/shared-watchdog.js" ;;
    maintainer:live-smoke) printf '%s\n' "./dist/src/maintainer/shared-real-smoke.js" ;;
    timeline:cli) printf '%s\n' "./dist/src/timeline/index.js" ;;
    *)
      echo "unknown runtime entrypoint: $1" >&2
      return 1
      ;;
  esac
}

codeksei_published_asset_file() {
  case "$1" in
    timeline:dashboard-bundle) printf '%s\n' "dashboard.js" ;;
    timeline:dashboard-stylesheet) printf '%s\n' "dashboard.css" ;;
    *)
      echo "unknown published asset id: $1" >&2
      return 1
      ;;
  esac
}
