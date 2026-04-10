param()

$ErrorActionPreference = "Stop"

$taskNames = @(
  "Cyberboss Shared Start",
  "Cyberboss Shared Unlock",
  "Cyberboss Shared Resume",
  "Cyberboss Shared Watchdog"
)

foreach ($taskName in $taskNames) {
  try {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
    Write-Host "removed=$taskName"
  } catch {
    Write-Host "missing=$taskName"
  }
}
