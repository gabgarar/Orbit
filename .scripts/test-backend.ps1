# Run Python tests inside the same Docker image used by Orbit.

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$restartScript = Join-Path $PSScriptRoot "restart-orbit.ps1"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker was not found. Open Docker Desktop and run this script from a new terminal."
}

Push-Location $projectRoot
try {
    & $restartScript
    if ($LASTEXITCODE -ne 0) {
        throw "Orbit could not be restarted before backend tests."
    }

    docker compose exec -T orbit python3 -m pytest server/python/tests
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
