param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$BackupRoot = "C:\Backups\Analytics",
  [string]$TaskName = "Analytics-Nightly-Backup",
  [string]$StartTime = "02:00",
  [int]$KeepDays = 30,
  [string]$OffsiteCopyPath = "",
  [switch]$RunNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info {
  param([string]$Message)
  Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
}

$backupScript = Join-Path $ProjectRoot 'scripts\backup\backup-site.ps1'
if (-not (Test-Path -LiteralPath $backupScript)) {
  throw "Backup script not found at: $backupScript"
}

$logDir = Join-Path $BackupRoot 'task-logs'
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$stdoutLog = Join-Path $logDir 'backup-task.log'

$arguments = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', ('"' + $backupScript + '"'),
  '-ProjectRoot', ('"' + $ProjectRoot + '"'),
  '-BackupRoot', ('"' + $BackupRoot + '"'),
  '-KeepDays', $KeepDays.ToString()
)

if (-not [string]::IsNullOrWhiteSpace($OffsiteCopyPath)) {
  $arguments += @('-OffsiteCopyPath', ('"' + $OffsiteCopyPath + '"'))
}

$psCommand = "powershell.exe " + ($arguments -join ' ')
$taskCommand = "cmd /c $psCommand >> `"$stdoutLog`" 2>&1"

Write-Info "Creating or updating scheduled task: $TaskName"
Write-Info "Run time: $StartTime daily"
Write-Info "ProjectRoot: $ProjectRoot"
Write-Info "BackupRoot:  $BackupRoot"
Write-Info "Task log:    $stdoutLog"

schtasks /Create /TN "$TaskName" /TR "$taskCommand" /SC DAILY /ST "$StartTime" /RL HIGHEST /F | Out-Null

Write-Info "Scheduled task created/updated."
Write-Info "Manual run:  schtasks /Run /TN \"$TaskName\""
Write-Info "Task status: schtasks /Query /TN \"$TaskName\" /V /FO LIST"

if ($RunNow) {
  Write-Info "Running task immediately..."
  schtasks /Run /TN "$TaskName" | Out-Null
  Write-Info "Task triggered. Check log: $stdoutLog"
}
