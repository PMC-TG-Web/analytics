param(
  [string]$ProjectId = "598134326626273",
  [string]$VendorId = "598134334366393",
  [string]$ContractNumber = "SC-TEST-POWERSHELL-001",
  [string]$ContractType = "WorkOrderContract",
  [string]$Title = "API Probe",
  [string]$Status = "Approved"
)

$ErrorActionPreference = "Stop"

function Get-EnvMapFromFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    throw ".env file not found at $Path"
  }

  $map = @{}
  Get-Content $Path | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') {
      $key = $matches[1].Trim()
      $val = $matches[2].Trim().Trim('"', "'")
      $map[$key] = $val
    }
  }
  return $map
}

$envPath = Join-Path (Get-Location) ".env"
$envMap = Get-EnvMapFromFile -Path $envPath

$clientId = $envMap["PROCORE_CLIENT_ID"]
$clientSecret = $envMap["PROCORE_CLIENT_SECRET"]
$companyId = $envMap["PROCORE_COMPANY_ID"]

if ([string]::IsNullOrWhiteSpace($clientId) -or [string]::IsNullOrWhiteSpace($clientSecret) -or [string]::IsNullOrWhiteSpace($companyId)) {
  throw "Missing one or more required values in .env: PROCORE_CLIENT_ID, PROCORE_CLIENT_SECRET, PROCORE_COMPANY_ID"
}

$tokenBody = "grant_type=client_credentials&client_id=$clientId&client_secret=$clientSecret"
$tokenResp = Invoke-RestMethod -Method Post -Uri "https://api.procore.com/oauth/token" -ContentType "application/x-www-form-urlencoded" -Body $tokenBody
$accessToken = $tokenResp.access_token

if ([string]::IsNullOrWhiteSpace($accessToken)) {
  throw "Failed to obtain access token"
}

Write-Host "Token acquired: OK"

$headers = @{
  Authorization = "Bearer $accessToken"
  "Procore-Company-Id" = $companyId
  Accept = "application/json"
  "Content-Type" = "application/json"
}

$payload = @{
  type = $ContractType
  number = $ContractNumber
  status = $Status
  title = $Title
  description = "<p>Created via testCreateCommitmentContract.ps1</p>"
  executed = $true
  vendor_id = $VendorId
  accounting_method = "amount"
  private = $false
  contract_date = (Get-Date -Format "yyyy-MM-dd")
} | ConvertTo-Json

$url = "https://api.procore.com/rest/v2.0/companies/$companyId/projects/$ProjectId/commitment_contracts?view=extended"

try {
  $resp = Invoke-WebRequest -Method Post -Uri $url -Headers $headers -Body $payload
  Write-Host "create_status=$($resp.StatusCode)"
  Write-Host $resp.Content
} catch {
  $r = $_.Exception.Response
  if ($r -ne $null) {
    $status = [int]$r.StatusCode
    $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
    $txt = $sr.ReadToEnd()
    Write-Host "create_status=$status"
    Write-Host $txt
    exit 1
  }
  throw
}
