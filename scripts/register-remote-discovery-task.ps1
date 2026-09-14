<#
.SYNOPSIS
  Register (or remove) a Windows Task Scheduler entry that runs the MaliScope
  remote discovery job unattended.

.DESCRIPTION
  The task calls  scripts\run-remote-discovery.ps1 -NonInteractive  as the
  current Windows user. That script reads the DPAPI-encrypted PGPASSWORD
  cache - so before scheduling you MUST have run  npm run job:discover:remote
  once interactively and answered "y" to caching.

  The task runs only while the current user is logged on (LogonType Interactive)
  which means:
    * No Windows password is stored anywhere.
    * DPAPI decryption always works (user profile is loaded).
    * On a suspended/logged-off laptop the run is skipped and picked up on the
      next scheduled time (or immediately once you log back on, if
      StartWhenAvailable is set - which it is).

  Every run appends a transcript to
    %LOCALAPPDATA%\MaliScope\logs\remote-discovery-YYYY-MM-DD.log

.PARAMETER TaskName
  Task Scheduler entry name. Default: "MaliScope Remote Discovery".

.PARAMETER TaskPath
  Task Scheduler folder. Default: "\MaliScope\" (created if missing).

.PARAMETER Time
  Local start time in HH:mm. Default: "09:00".

.PARAMETER Frequency
  Daily or Weekly. Default: Weekly.

.PARAMETER DaysOfWeek
  Only used when Frequency=Weekly. Default: Wednesday.

.PARAMETER Remove
  Unregister the task and exit. Ignores every other option.

.PARAMETER RunNow
  After registering (or if already registered), start the task once so you can
  verify it works end-to-end. The transcript log will tell you what happened.

.EXAMPLE
  # Register the default weekly Wednesday 09:00 task.
  ./scripts/register-remote-discovery-task.ps1

.EXAMPLE
  # Daily at 08:30.
  ./scripts/register-remote-discovery-task.ps1 -Frequency Daily -Time 08:30

.EXAMPLE
  # Tuesday and Friday at 10:00.
  ./scripts/register-remote-discovery-task.ps1 -DaysOfWeek Tuesday,Friday -Time 10:00

.EXAMPLE
  # Register and immediately run once for verification.
  ./scripts/register-remote-discovery-task.ps1 -RunNow

.EXAMPLE
  # Remove the schedule (leaves the cache and log files alone).
  ./scripts/register-remote-discovery-task.ps1 -Remove
#>
[CmdletBinding()]
param(
    [string]$TaskName = "MaliScope Remote Discovery",
    [string]$TaskPath = "\MaliScope\",
    [string]$Time = "09:00",
    [ValidateSet("Daily", "Weekly")][string]$Frequency = "Weekly",
    [ValidateSet("Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday")]
    [string[]]$DaysOfWeek = @("Wednesday"),
    [switch]$Remove,
    [switch]$RunNow
)

$ErrorActionPreference = "Stop"

$repoRoot   = Split-Path -Parent $PSScriptRoot
$runnerPath = Join-Path $repoRoot "scripts\run-remote-discovery.ps1"

if (-not (Test-Path -LiteralPath $runnerPath)) {
    Write-Error "Cannot find $runnerPath. Run this script from a MaliScope checkout."
    exit 1
}

# ---------- Remove --------------------------------------------------------

if ($Remove) {
    $existing = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false
        Write-Host "Removed scheduled task '$TaskName'." -ForegroundColor Yellow
    } else {
        Write-Host "No scheduled task '$TaskName' at '$TaskPath' - nothing to remove." -ForegroundColor DarkGray
    }
    exit 0
}

# ---------- Preflight -----------------------------------------------------

$cachePath = Join-Path $env:LOCALAPPDATA "MaliScope\pg-password.dpapi"
if (-not (Test-Path -LiteralPath $cachePath)) {
    Write-Warning "No cached PGPASSWORD found at $cachePath. The scheduled task will fail with exit code 2 until you run 'npm run job:discover:remote' once interactively and answer 'y' to the 'Cache this password?' prompt."
}

# ---------- Build action / trigger / settings / principal ------------------

$psExe = (Get-Command powershell.exe -ErrorAction Stop).Source
$action = New-ScheduledTaskAction `
    -Execute $psExe `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`" -NonInteractive" `
    -WorkingDirectory $repoRoot

if ($Frequency -eq "Weekly") {
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DaysOfWeek -At $Time
} else {
    $trigger = New-ScheduledTaskTrigger -Daily -At $Time
}

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 10)

# Interactive user, no stored Windows password. DPAPI decrypts because the
# user profile is loaded whenever the task fires.
$principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Limited

# ---------- Register ------------------------------------------------------

$existing = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
$verb = if ($existing) { "Updated" } else { "Registered" }

Register-ScheduledTask `
    -TaskName $TaskName `
    -TaskPath $TaskPath `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Crawl approved MaliScope discovery sources from this laptop and persist drafts to production Postgres via SSH tunnel." `
    -Force | Out-Null

$schedule = if ($Frequency -eq "Weekly") { "$($DaysOfWeek -join ',') at $Time" } else { "daily at $Time" }
Write-Host "$verb scheduled task '$TaskName' at '$TaskPath' ($schedule)." -ForegroundColor Green
Write-Host "Logs: $env:LOCALAPPDATA\MaliScope\logs\remote-discovery-YYYY-MM-DD.log" -ForegroundColor DarkGray

if ($RunNow) {
    Write-Host "Starting task once for verification..." -ForegroundColor Cyan
    Start-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
    Start-Sleep -Seconds 2
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -TaskPath $TaskPath
    Write-Host "  LastRunTime: $($info.LastRunTime)"
    Write-Host "  LastTaskResult (0=OK, non-zero=exit code): $($info.LastTaskResult)"
    $today = Get-Date -Format yyyy-MM-dd
    $logPath = Join-Path $env:LOCALAPPDATA "MaliScope\logs\remote-discovery-$today.log"
    Write-Host "  Tail the log with:"
    Write-Host "    Get-Content '$logPath' -Wait -Tail 40" -ForegroundColor DarkGray
}
