# Public link for the demo (#13): a production build of MAKABL on this laptop, exposed through a
# Cloudflare quick tunnel (no account needed). Prints the https link and copies it to the clipboard.
#
#   Double-click "Public link.bat", or:  powershell -ExecutionPolicy Bypass -File launch-public.ps1
#   -SkipBuild   reuse the last production build (faster restart; only if nothing changed since)
#
# Anyone with the link can sign up. So this refuses to run while live builds are switched on in
# .env.local: a stranger could otherwise spend the API keys and run model-written code here.

param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
Set-Location -LiteralPath $project
$port = 3100   # not 3000, so it never collides with a running "npm run dev"

# 1. Never expose live builds to the public internet.
$envFile = Join-Path $project '.env.local'
if ((Test-Path -LiteralPath $envFile) -and (Select-String -LiteralPath $envFile -Pattern '^\s*MAKABL_ALLOW_UNSANDBOXED_BUILDS\s*=\s*1' -Quiet)) {
  throw 'MAKABL_ALLOW_UNSANDBOXED_BUILDS=1 is set in .env.local. Remove it (live builds run on the build laptop, not here), then run this again.'
}

# Keys on a public server let strangers spend your quota (Start build, mockups). Warn, do not block:
# hackathon/public-link.md says to comment them out while the tunnel is up.
if ((Test-Path -LiteralPath $envFile) -and (Select-String -LiteralPath $envFile -Pattern '^\s*(GEMINI|ANTHROPIC|OPENAI|OPENROUTER|DASHSCOPE)_API_KEY\s*=\s*\S' -Quiet)) {
  Write-Host 'WARNING: .env.local still has API keys. Anyone with the link can spend them. Comment them out unless you mean to allow that.' -ForegroundColor Yellow
}

# 2. cloudflared, installed once with winget if missing.
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing cloudflared with winget...'
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    throw 'cloudflared is still not found. Close this window, open a new one and run this again (the installer updates PATH for new windows).'
  }
}

# 3. Database up, tables present (never wipes data).
if (-not (Test-Path -LiteralPath (Join-Path $project 'node_modules'))) { npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' } }
npm.cmd run db:local
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not start. See .pgdata/server.log.' }
node scripts/ensure-local-db.ts
if ($LASTEXITCODE -ne 0) { throw 'Local database setup failed.' }

# 4. Production build: fast pages, no dev overlay, no slow first compile in front of judges.
if (-not $SkipBuild -or -not (Test-Path -LiteralPath (Join-Path $project '.next\BUILD_ID'))) {
  Write-Host 'Building for production (a minute or two)...'
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'next build failed. Fix the error above; the public link needs a clean build.' }
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $listener) {
  Write-Host "Starting MAKABL on port $port..."
  $command = 'Set-Location -LiteralPath ' + (ConvertTo-Json $project -Compress) + "; npm.cmd run start -- -p $port"
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $command) -WorkingDirectory $project -WindowStyle Minimized
}
$local = "http://localhost:$port"
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  try { $null = Invoke-WebRequest -Uri $local -TimeoutSec 2 -UseBasicParsing; $ready = $true; break } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) { throw "MAKABL did not answer on $local within 60 seconds. Check the minimized server window." }

# 5. Tunnel. cloudflared logs the link to stderr; read it from a log file.
$log = Join-Path $env:TEMP 'makabl-tunnel.log'
Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
$tunnel = Start-Process -FilePath 'cloudflared' -ArgumentList @('tunnel', '--no-autoupdate', '--url', $local) -RedirectStandardError $log -NoNewWindow -PassThru
$url = $null
for ($i = 0; $i -lt 45 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path -LiteralPath $log) {
    $m = Select-String -LiteralPath $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
  if ($tunnel.HasExited) { break }
}
if (-not $url) { throw "No tunnel link after 45 seconds. Log: $log" }

Set-Clipboard -Value $url
Write-Host ''
Write-Host "  PUBLIC LINK: $url   (copied to the clipboard)" -ForegroundColor Green
Write-Host '  Test it on a phone on mobile data, in a private window.'
Write-Host '  Keep this window open: closing it ends the tunnel, and the link changes on every restart.'
Write-Host ''
Wait-Process -Id $tunnel.Id
