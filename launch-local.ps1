$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
Set-Location -LiteralPath $project

if (-not (Test-Path -LiteralPath (Join-Path $project 'node_modules'))) {
  Write-Host 'Installing project dependencies...'
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}

Write-Host 'Starting local PostgreSQL...'
npm run db:local
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not start. See .pgdata/server.log.' }

Write-Host 'Checking the local database schema...'
node scripts/ensure-local-db.ts
if ($LASTEXITCODE -ne 0) { throw 'Local database setup failed.' }

$listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $listener) {
  Write-Host 'Starting MAKABL...'
  $command = 'Set-Location -LiteralPath ' + (ConvertTo-Json $project -Compress) + '; npm run dev'
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-Command', $command) -WorkingDirectory $project -WindowStyle Minimized
}

$url = 'http://localhost:3000'
$ready = $false
for ($attempt = 0; $attempt -lt 90; $attempt++) {
  try {
    $null = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing
    $ready = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}

if (-not $ready) { throw 'MAKABL did not respond within 90 seconds. Check the minimized server window.' }
Start-Process $url
Write-Host "MAKABL is open at $url"
