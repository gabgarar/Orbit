# Show Orbit container state and its health check result.

$ErrorActionPreference = "Stop"
$scriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptsRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker was not found. Open Docker Desktop and run this script from a new terminal."
}

Push-Location $projectRoot
try {
    docker compose ps
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
