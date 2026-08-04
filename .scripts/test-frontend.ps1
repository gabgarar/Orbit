# Run pure frontend unit tests; Docker is not needed.

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    npm.cmd --prefix server run test:frontend
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
