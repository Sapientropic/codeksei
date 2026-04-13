function Resolve-CodekseiRuntimeEntrypoint {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Id
  )

  switch ($Id) {
    "cli" { return "dist\src\index.js" }
    "shared:start" { return "dist\src\shared\shared-start.js" }
    "shared:open" { return "dist\src\shared\shared-open.js" }
    "shared:status" { return "dist\src\shared\shared-status.js" }
    "shared:supervisor" { return "dist\src\shared\shared-supervisor.js" }
    "shared:watchdog" { return "dist\src\shared\shared-watchdog.js" }
    "maintainer:live-smoke" { return "dist\src\maintainer\shared-real-smoke.js" }
    "timeline:cli" { return "dist\src\timeline\index.js" }
    default { throw "unknown runtime entrypoint: $Id" }
  }
}

function Resolve-CodekseiPublishedAssetFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Id
  )

  switch ($Id) {
    "timeline:dashboard-bundle" { return "dashboard.js" }
    "timeline:dashboard-stylesheet" { return "dashboard.css" }
    default { throw "unknown published asset id: $Id" }
  }
}
