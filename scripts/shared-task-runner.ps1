param(
  [ValidateSet("Start", "Watchdog", "Supervisor")]
  [string]$Mode = "Watchdog",
  [int]$IntervalMinutes = 5
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$stateDir = if ($env:CODEKSEI_STATE_DIR) {
  $env:CODEKSEI_STATE_DIR
} else {
  Join-Path $env:USERPROFILE ".codeksei"
}
$logDir = Join-Path $stateDir "logs"
$null = New-Item -ItemType Directory -Force -Path $logDir

$logFile = if ($Mode -eq "Start") {
  Join-Path $logDir "shared-task-start.log"
} elseif ($Mode -eq "Supervisor") {
  Join-Path $logDir "shared-task-supervisor.log"
} else {
  Join-Path $logDir "shared-task-watchdog.log"
}
$supervisorOutputLogFile = if ($Mode -eq "Supervisor") {
  Join-Path $logDir "shared-supervisor.log"
} else {
  $null
}
$errorLogFile = if ($Mode -eq "Supervisor") {
  Join-Path $logDir "shared-supervisor.stderr.log"
} else {
  $null
}

$node = (Get-Command node -ErrorAction Stop).Source
$scriptPath = if ($Mode -eq "Start") {
  Join-Path $repoRoot "dist\src\shared\shared-start.js"
} elseif ($Mode -eq "Supervisor") {
  Join-Path $repoRoot "dist\src\shared\shared-supervisor.js"
} else {
  Join-Path $repoRoot "dist\src\shared\shared-watchdog.js"
}

$nodeArgs = @($scriptPath)
if ($Mode -eq "Supervisor" -or $Mode -eq "Start") {
  $nodeArgs += "--interval-minutes=$IntervalMinutes"
}

$startedAt = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
"[$startedAt] mode=$Mode starting" | Out-File -FilePath $logFile -Encoding utf8 -Append

if ($Mode -eq "Supervisor") {
  # Start the long-lived supervisor as a detached hidden process. Running it
  # inline under the task shell keeps it attached to the outer PowerShell/cmd
  # host, so closing or recycling that host can propagate SIGHUP and also
  # surface transient console windows. We only want the scheduler to launch
  # the supervisor, not to be the supervisor's lifetime owner.
  $process = Start-Process `
    -FilePath $node `
    -ArgumentList $nodeArgs `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $supervisorOutputLogFile `
    -RedirectStandardError $errorLogFile `
    -PassThru
  "started_pid=$($process.Id)" | Out-File -FilePath $logFile -Encoding utf8 -Append
  $exitCode = 0
} else {
  & $node @nodeArgs 2>&1 | Out-File -FilePath $logFile -Encoding utf8 -Append
  $exitCode = $LASTEXITCODE
}

$endedAt = Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
"[$endedAt] mode=$Mode exit=$exitCode" | Out-File -FilePath $logFile -Encoding utf8 -Append

exit $exitCode
