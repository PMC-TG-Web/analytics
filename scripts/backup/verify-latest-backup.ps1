param(
  [string]$BackupRoot = "C:\Backups\Analytics"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info {
  param([string]$Message)
  Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
}

function Get-PgRestoreCommand {
  $cmd = Get-Command pg_restore -ErrorAction SilentlyContinue
  if ($cmd) {
    return $cmd.Source
  }

  $commonRoots = @(
    'C:\Program Files\PostgreSQL',
    'C:\Program Files (x86)\PostgreSQL'
  )

  foreach ($root in $commonRoots) {
    if (-not (Test-Path -LiteralPath $root)) {
      continue
    }

    $candidate = Get-ChildItem -LiteralPath $root -Recurse -Filter pg_restore.exe -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending |
      Select-Object -First 1

    if ($candidate) {
      return $candidate.FullName
    }
  }

  return $null
}

if (-not (Test-Path -LiteralPath $BackupRoot)) {
  throw "Backup root does not exist: $BackupRoot"
}

$candidateRuns = Get-ChildItem -LiteralPath $BackupRoot -Directory |
  Where-Object { $_.Name -ne 'task-logs' } |
  Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'manifest.json') }

$latest = $candidateRuns |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $latest) {
  throw "No valid backup runs found under: $BackupRoot"
}

$runDir = $latest.FullName
$manifestPath = Join-Path $runDir 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Manifest not found: $manifestPath"
}

Write-Info "Verifying backup run: $runDir"

try {
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
} catch {
  throw @"
Failed to parse manifest.json at: $manifestPath

If you are passing JSON values manually, this usually means an unescaped Windows path.
Use either:
  - Escaped backslashes: C:\\Users\\ToddGilmore\\...
  - Forward slashes:      C:/Users/ToddGilmore/...

Original parser error: $($_.Exception.Message)
"@
}

foreach ($artifact in $manifest.artifacts) {
  $artifactPath = Join-Path $runDir $artifact.file
  if (-not (Test-Path -LiteralPath $artifactPath)) {
    throw "Missing artifact: $($artifact.file)"
  }

  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifactPath).Hash
  if ($hash -ne $artifact.sha256) {
    throw "Hash mismatch for $($artifact.file)"
  }

  Write-Info "OK: $($artifact.file) ($($artifact.bytes) bytes)"
}

$dumpPath = Join-Path $runDir 'database.dump'
if (Test-Path -LiteralPath $dumpPath) {
  $pgRestorePath = Get-PgRestoreCommand
  if ($pgRestorePath) {
    Write-Info "Validating database.dump with pg_restore --list"
    & $pgRestorePath --list "$dumpPath" | Out-Null
    Write-Info "OK: database.dump passed pg_restore validation"
  } else {
    Write-Info "pg_restore not found; skipped deep dump validation"
  }
}

Write-Info "Backup verification completed successfully"
