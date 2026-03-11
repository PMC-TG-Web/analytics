param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$BackupRoot = "C:\Backups\Analytics",
  [string]$OffsiteCopyPath = "",
  [int]$KeepDays = 30,
  [string]$BackupTaskName = "Analytics-Nightly-Backup",
  [string]$BackupStartTime = "02:00",
  [string]$VerifyTaskName = "Analytics-Weekly-Backup-Verify",
  [string]$VerifyDay = "SUN",
  [string]$VerifyStartTime = "03:00",
  [switch]$RunBackupNow,
  [switch]$RunVerifyNow
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info {
  param([string]$Message)
  Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
}

$backupScript = Join-Path $ProjectRoot 'scripts\backup\backup-site.ps1'
$verifyScript = Join-Path $ProjectRoot 'scripts\backup\verify-latest-backup.ps1'

if (-not (Test-Path -LiteralPath $backupScript)) {
  throw "Backup script not found at: $backupScript"
}

if (-not (Test-Path -LiteralPath $verifyScript)) {
  throw "Verify script not found at: $verifyScript"
}

$logDir = Join-Path $BackupRoot 'task-logs'
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$backupLog = Join-Path $logDir 'backup-task.log'
$verifyLog = Join-Path $logDir 'verify-task.log'

$backupWrapperPath = Join-Path $PSScriptRoot 'run-backup-task.cmd'
$verifyWrapperPath = Join-Path $PSScriptRoot 'run-verify-task.cmd'

$backupCmdParts = @(
  'powershell.exe',
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', ('"' + $backupScript + '"'),
  '-ProjectRoot', ('"' + $ProjectRoot + '"'),
  '-BackupRoot', ('"' + $BackupRoot + '"'),
  '-KeepDays', $KeepDays.ToString()
)

if (-not [string]::IsNullOrWhiteSpace($OffsiteCopyPath)) {
  $backupCmdParts += @('-OffsiteCopyPath', ('"' + $OffsiteCopyPath + '"'))
}

$backupCmdLine = ($backupCmdParts -join ' ') + " >> `"$backupLog`" 2>&1"
$backupWrapper = "@echo off`r`n$backupCmdLine`r`n"
Set-Content -LiteralPath $backupWrapperPath -Value $backupWrapper -Encoding ASCII

$verifyCmdLine = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$verifyScript`" -BackupRoot `"$BackupRoot`" >> `"$verifyLog`" 2>&1"
$verifyWrapper = "@echo off`r`n$verifyCmdLine`r`n"
Set-Content -LiteralPath $verifyWrapperPath -Value $verifyWrapper -Encoding ASCII

$backupTaskCommand = '"' + $backupWrapperPath + '"'
$verifyTaskCommand = '"' + $verifyWrapperPath + '"'

Write-Info "Registering nightly backup task: $BackupTaskName"
Write-Info "  Schedule: daily at $BackupStartTime"
schtasks /Create /TN "$BackupTaskName" /TR "$backupTaskCommand" /SC DAILY /ST "$BackupStartTime" /RL LIMITED /F | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to create backup task. schtasks exit code: $LASTEXITCODE"
}

Write-Info "Registering weekly verify task: $VerifyTaskName"
Write-Info "  Schedule: weekly on $VerifyDay at $VerifyStartTime"
schtasks /Create /TN "$VerifyTaskName" /TR "$verifyTaskCommand" /SC WEEKLY /D "$VerifyDay" /ST "$VerifyStartTime" /RL LIMITED /F | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to create verify task. schtasks exit code: $LASTEXITCODE"
}

Write-Info "Automation setup complete"
Write-Info "Backup task : $BackupTaskName"
Write-Info "Verify task : $VerifyTaskName"
Write-Info "Backup log  : $backupLog"
Write-Info "Verify log  : $verifyLog"
Write-Info "Backup cmd  : $backupWrapperPath"
Write-Info "Verify cmd  : $verifyWrapperPath"

if ($RunBackupNow) {
  Write-Info "Running backup task now..."
  schtasks /Run /TN "$BackupTaskName" | Out-Null
}

if ($RunVerifyNow) {
  Write-Info "Running verify task now..."
  schtasks /Run /TN "$VerifyTaskName" | Out-Null
}