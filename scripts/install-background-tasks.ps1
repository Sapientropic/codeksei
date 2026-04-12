param(
  [int]$WatchdogMinutes = 5
)

$ErrorActionPreference = "Stop"

if ($WatchdogMinutes -lt 1) {
  throw "WatchdogMinutes 必须大于等于 1"
}

$runnerPath = Join-Path $PSScriptRoot "shared-task-runner.ps1"
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskNames = @{
  start = "Codeksei Shared Start"
  unlock = "Codeksei Shared Unlock"
  resume = "Codeksei Shared Resume"
  watchdog = "Codeksei Shared Watchdog"
}

function Escape-XmlText {
  param([string]$Value)
  [System.Security.SecurityElement]::Escape($Value)
}

function Register-CodekseiTaskXml {
  param(
    [string]$TaskName,
    [string]$TriggerXml,
    [string]$ArgumentsXml
  )

  $escapedUser = Escape-XmlText $currentUser
  $taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <URI>\$TaskName</URI>
    <SecurityDescriptor></SecurityDescriptor>
  </RegistrationInfo>
  <Triggers>
$TriggerXml
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$escapedUser</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <Duration>PT10M</Duration>
      <WaitTimeout>PT1H</WaitTimeout>
      <StopOnIdleEnd>true</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <DisallowStartOnRemoteAppSession>false</DisallowStartOnRemoteAppSession>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>$ArgumentsXml</Arguments>
    </Exec>
  </Actions>
</Task>
"@

  Register-ScheduledTask -TaskName $TaskName -Xml $taskXml -Force | Out-Null
}

foreach ($taskName in @($taskNames.start, $taskNames.unlock, $taskNames.resume, $taskNames.watchdog)) {
  try {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop | Out-Null
  } catch {
    # best effort; task may not exist yet
  }
}

$bootstrapArguments = Escape-XmlText "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerPath`" -Mode Start -IntervalMinutes $WatchdogMinutes"
$escapedUser = Escape-XmlText $currentUser
$logonTriggerXml = @"
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$escapedUser</UserId>
    </LogonTrigger>
"@
$unlockTriggerXml = @"
    <SessionStateChangeTrigger>
      <Enabled>true</Enabled>
      <StateChange>SessionUnlock</StateChange>
      <UserId>$escapedUser</UserId>
    </SessionStateChangeTrigger>
"@
$resumeTriggerXml = @"
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription><![CDATA[<QueryList><Query Id="0" Path="System"><Select Path="System">*[System[Provider[@Name='Microsoft-Windows-Power-Troubleshooter'] and EventID=1]]</Select></Query></QueryList>]]></Subscription>
    </EventTrigger>
"@

# Use short-lived event-driven bootstrap tasks instead of a periodic task.
# The detached supervisor keeps idle checks quiet, while logon/unlock/resume
# pokes recover quickly after session lifecycle changes without relaunching a
# watchdog shell every few minutes.
Register-CodekseiTaskXml -TaskName $taskNames.start -TriggerXml $logonTriggerXml -ArgumentsXml $bootstrapArguments
Register-CodekseiTaskXml -TaskName $taskNames.unlock -TriggerXml $unlockTriggerXml -ArgumentsXml $bootstrapArguments
Register-CodekseiTaskXml -TaskName $taskNames.resume -TriggerXml $resumeTriggerXml -ArgumentsXml $bootstrapArguments

Start-ScheduledTask -TaskName $taskNames.start

Write-Host "installed=$($taskNames.start)"
Write-Host "installed=$($taskNames.unlock)"
Write-Host "installed=$($taskNames.resume)"
Write-Host "removed=$($taskNames.watchdog)"
Write-Host "supervisor_interval_minutes=$WatchdogMinutes"
