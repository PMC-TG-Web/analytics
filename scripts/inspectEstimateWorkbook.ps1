$ErrorActionPreference = 'Stop'
$zipPath = "C:\Users\ToddGilmore\Downloads\estimate-3079623.zip"
if (-not (Test-Path $zipPath)) {
  Copy-Item "C:\Users\ToddGilmore\Downloads\estimate-3079623.xlsx" $zipPath -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)

function Get-EntryText($zipObj, $path) {
  $entry = $zipObj.GetEntry($path)
  if (-not $entry) { return $null }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

$sharedStringsText = Get-EntryText $zip "xl/sharedStrings.xml"
[xml]$sharedXml = $sharedStringsText
$shared = @()
if ($sharedXml.sst.si) {
  foreach ($si in $sharedXml.sst.si) {
    if ($si.t) { $shared += [string]$si.t }
    elseif ($si.r) { $shared += (($si.r | ForEach-Object { $_.t }) -join "") }
    else { $shared += "" }
  }
}

$wbText = Get-EntryText $zip "xl/workbook.xml"
$relsText = Get-EntryText $zip "xl/_rels/workbook.xml.rels"

$sheetMap = @{}
$relMatches = [regex]::Matches($relsText, '<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"')
foreach ($m in $relMatches) {
  $sheetMap[$m.Groups[1].Value] = $m.Groups[2].Value
}

$sheetMatches = [regex]::Matches($wbText, '<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"')
foreach ($m in $sheetMatches) {
  $name = $m.Groups[1].Value
  $rid = $m.Groups[2].Value
  $target = $sheetMap[$rid]
  if (-not $target) { continue }
  $target = $target.TrimStart('/')
  if ($target -notlike "xl/*") { $target = "xl/$target" }
  Write-Output "=== SHEET: $name ($target) ==="

  [xml]$sheetXml = (Get-EntryText $zip $target)
  $rows = $sheetXml.worksheet.sheetData.row | Select-Object -First 15
  foreach ($row in $rows) {
    $vals = @()
    foreach ($c in $row.c) {
      $t = [string]$c.t
      $v = [string]$c.v
      $value = ""
      if ($t -eq "s") {
        $idx = [int]$v
        if ($idx -ge 0 -and $idx -lt $shared.Count) { $value = $shared[$idx] }
      } elseif ($t -eq "inlineStr") {
        $value = [string]$c.is.t
      } else {
        $value = $v
      }
      $vals += $value
    }
    Write-Output (("row {0}: " -f $row.r) + ($vals -join " | "))
  }
  Write-Output ""
}

$zip.Dispose()
