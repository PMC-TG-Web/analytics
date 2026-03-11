param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$BackupRoot = "C:\Backups\Analytics",
  [int]$KeepDays = 30,
  [string]$OffsiteCopyPath = ""
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info {
  param([string]$Message)
  Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
}

function Read-DotEnvFile {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
    if ($trimmed.StartsWith('#')) { continue }

    $idx = $trimmed.IndexOf('=')
    if ($idx -lt 1) { continue }

    $key = $trimmed.Substring(0, $idx).Trim()
    $value = $trimmed.Substring($idx + 1).Trim()

    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $values[$key] = $value
  }

  return $values
}

function Get-DatabaseUrl {
  param([string]$Root)

  if ($env:DATABASE_URL) {
    return $env:DATABASE_URL
  }

  $paths = @(
    (Join-Path $Root '.env.local'),
    (Join-Path $Root '.env')
  )

  foreach ($path in $paths) {
    $envMap = Read-DotEnvFile -Path $path
    if ($envMap.ContainsKey('DATABASE_URL') -and -not [string]::IsNullOrWhiteSpace($envMap['DATABASE_URL'])) {
      return $envMap['DATABASE_URL']
    }
  }

  throw "DATABASE_URL not found in environment, .env.local, or .env"
}

function New-SafeDirectory {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Get-PgDumpCommand {
  $cmd = Get-Command pg_dump -ErrorAction SilentlyContinue
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

    $candidate = Get-ChildItem -LiteralPath $root -Recurse -Filter pg_dump.exe -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending |
      Select-Object -First 1

    if ($candidate) {
      return $candidate.FullName
    }
  }

  return $null
}

Write-Info "Starting backup"
Write-Info "ProjectRoot: $ProjectRoot"
Write-Info "BackupRoot:  $BackupRoot"
Write-Info "KeepDays:    $KeepDays"

New-SafeDirectory -Path $BackupRoot

$timestamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$runDir = Join-Path $BackupRoot $timestamp
New-SafeDirectory -Path $runDir

$dbUrl = Get-DatabaseUrl -Root $ProjectRoot
$pgDumpPath = Get-PgDumpCommand
if (-not $pgDumpPath) {
  throw "pg_dump was not found in PATH. Install PostgreSQL client tools and ensure pg_dump is available."
}

$dbDumpPath = Join-Path $runDir 'database.dump'
$plainSqlPath = Join-Path $runDir 'database.sql'

Write-Info "Creating PostgreSQL custom-format backup"
$env:PGSSLMODE = 'require'
& $pgDumpPath --format=custom --no-owner --no-privileges --file "$dbDumpPath" "$dbUrl"

Write-Info "Creating PostgreSQL plain SQL backup"
& $pgDumpPath --format=plain --no-owner --no-privileges --file "$plainSqlPath" "$dbUrl"

$artifactPaths = @()
$artifactPaths += $dbDumpPath
$artifactPaths += $plainSqlPath

$extraPaths = @(
  (Join-Path $ProjectRoot 'prisma'),
  (Join-Path $ProjectRoot 'public\job-titles.json'),
  (Join-Path $ProjectRoot 'logs\audit.log'),
  (Join-Path $ProjectRoot '.env.local.example')
)

$stagingDir = Join-Path $runDir 'site-artifacts'
New-SafeDirectory -Path $stagingDir

foreach ($extraPath in $extraPaths) {
  if (-not (Test-Path -LiteralPath $extraPath)) {
    continue
  }

  $name = Split-Path -Path $extraPath -Leaf
  $dest = Join-Path $stagingDir $name

  if ((Get-Item -LiteralPath $extraPath).PSIsContainer) {
    Copy-Item -LiteralPath $extraPath -Destination $dest -Recurse -Force
  } else {
    Copy-Item -LiteralPath $extraPath -Destination $dest -Force
  }
}

$siteArchive = Join-Path $runDir 'site-artifacts.zip'
if ((Get-ChildItem -LiteralPath $stagingDir -Force | Measure-Object).Count -gt 0) {
  Write-Info "Compressing site artifacts"
  Compress-Archive -Path (Join-Path $stagingDir '*') -DestinationPath $siteArchive -Force
  Remove-Item -LiteralPath $stagingDir -Recurse -Force
  $artifactPaths += $siteArchive
} else {
  Remove-Item -LiteralPath $stagingDir -Recurse -Force
}

$manifest = [ordered]@{
  createdAt = (Get-Date).ToString('o')
  hostName = $env:COMPUTERNAME
  projectRoot = $ProjectRoot
  backupRoot = $BackupRoot
  keepDays = $KeepDays
  artifacts = @()
}

foreach ($artifact in $artifactPaths) {
  if (-not (Test-Path -LiteralPath $artifact)) {
    continue
  }

  $item = Get-Item -LiteralPath $artifact
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $artifact).Hash

  $manifest.artifacts += [ordered]@{
    file = $item.Name
    bytes = $item.Length
    sha256 = $hash
  }
}

$manifestPath = Join-Path $runDir 'manifest.json'
$manifest | ConvertTo-Json -Depth 6 | Out-File -LiteralPath $manifestPath -Encoding utf8

if (-not [string]::IsNullOrWhiteSpace($OffsiteCopyPath)) {
  New-SafeDirectory -Path $OffsiteCopyPath
  $offsiteTarget = Join-Path $OffsiteCopyPath $timestamp
  Write-Info "Copying backup to offsite path: $offsiteTarget"
  Copy-Item -LiteralPath $runDir -Destination $offsiteTarget -Recurse -Force
}

$cutoff = (Get-Date).AddDays(-1 * [Math]::Abs($KeepDays))
Write-Info "Applying retention policy for backups older than $($cutoff.ToString('yyyy-MM-dd HH:mm:ss'))"

Get-ChildItem -LiteralPath $BackupRoot -Directory |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  ForEach-Object {
    Write-Info "Removing old backup: $($_.FullName)"
    Remove-Item -LiteralPath $_.FullName -Recurse -Force
  }

Write-Info "Backup completed successfully"
Write-Info "Output folder: $runDir"
