# Rebuild and restart Orbit from any working directory.

$ErrorActionPreference = "Stop"
$scriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptsRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker was not found. Open Docker Desktop and run this script from a new terminal."
}

Push-Location $projectRoot
try {
    docker compose down
    if ($LASTEXITCODE -ne 0) {
        throw "Orbit containers could not be stopped."
    }

    docker compose up --build --detach
    if ($LASTEXITCODE -ne 0) {
        throw "Orbit could not be started. Run .\.scripts\orbit-logs.cmd to inspect the service logs."
    }

    docker compose ps
    Write-Host "`nOrbit restarted. Open http://localhost:8100" -ForegroundColor Green
} finally {
    Pop-Location
}
