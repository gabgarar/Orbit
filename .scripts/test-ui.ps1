# Rebuild Orbit, wait for its health endpoint, then run the responsive UI suite.

param(
    [ValidateRange(1, 8)]
    [int]$Workers = 2
)

$ErrorActionPreference = "Stop"
$scriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptsRoot
$serverRoot = Join-Path $projectRoot "server"
$restartScript = Join-Path $scriptsRoot "restart-orbit.ps1"
$env:ORBIT_UI_WORKERS = $Workers

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "npm.cmd was not found. Install Node.js 20 or newer before running UI tests."
}

& $restartScript
if ($LASTEXITCODE -ne 0) {
    throw "Orbit could not be restarted before running UI tests."
}

$deadline = (Get-Date).AddSeconds(60)
do {
    try {
        $healthResponse = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8100/health" -TimeoutSec 3
        if ($healthResponse.StatusCode -eq 200) {
            break
        }
    } catch {
        # The container is still starting; retry until the deadline.
    }
    Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)

if (-not $healthResponse -or $healthResponse.StatusCode -ne 200) {
    throw "Orbit did not become healthy within 60 seconds. Run .\.scripts\orbit-logs.cmd to inspect the startup logs."
}

Push-Location $serverRoot
try {
    Write-Host "Running UI tests with $Workers workers." -ForegroundColor Cyan
    npm.cmd run test:ui
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
