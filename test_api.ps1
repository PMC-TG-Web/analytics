$body = @{year = "2026"; month = 1; field = "bidSubmittedSales"; value = "5000000"} | ConvertTo-Json
Write-Host "Sending body: $body"
Write-Host "Testing POST to http://localhost:3000/api/kpi"
try {
  $response = Invoke-WebRequest -Uri "http://localhost:3000/api/kpi" -Method POST -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 10
  Write-Host "Status Code: $($response.StatusCode)"
  Write-Host "Response: $($response.Content)"
} catch {
  Write-Host "Error: $_"
  Write-Host "Status Code: $($_.Exception.Response.StatusCode)"
}
