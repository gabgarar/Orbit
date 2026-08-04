# Rebuild a healthy Orbit container, verify host reachability, then run the UI suite.

param(
    [ValidateRange(1, 8)]
    [int]$Workers = 2
)

$ErrorActionPreference = "Stop"
$scriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptsRoot
$serverRoot = Join-Path $projectRoot "server"
$restartScript = Join-Path $scriptsRoot "restart-orbit.ps1"
. (Join-Path $scriptsRoot "orbit-http-port.ps1")
. (Join-Path $scriptsRoot "orbit-http-bind.ps1")
$orbitHttpPort = Get-OrbitHttpPort
$orbitHttpBind = Get-OrbitHttpBind
$env:ORBIT_HTTP_PORT = "$orbitHttpPort"
$env:ORBIT_HTTP_BIND = $orbitHttpBind
$orbitBaseUrl = "http://127.0.0.1:$orbitHttpPort"
$env:ORBIT_UI_WORKERS = $Workers
$env:ORBIT_UI_BASE_URL = $orbitBaseUrl

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "npm.cmd was not found. Install Node.js 20.19+ or 22.12+ before running UI tests."
}

& $restartScript
if ($LASTEXITCODE -ne 0) {
    throw "Orbit could not be restarted before running UI tests."
}

try {
    $healthResponse = Invoke-WebRequest -UseBasicParsing -Uri "$orbitBaseUrl/health" -TimeoutSec 5
} catch {
    throw "Orbit reported healthy in Docker but is not reachable at $orbitBaseUrl/health. Run .\.scripts\orbit-logs.cmd to inspect the startup logs."
}

if ($healthResponse.StatusCode -ne 200) {
    throw "Orbit host healthcheck returned status $($healthResponse.StatusCode). Run .\.scripts\orbit-logs.cmd to inspect the startup logs."
}

Push-Location $serverRoot
try {
    Write-Host "Running UI tests with $Workers workers." -ForegroundColor Cyan
    npm.cmd run test:ui
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
