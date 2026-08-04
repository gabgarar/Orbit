# Run Node gateway unit tests without requiring Docker.

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    npm.cmd --prefix server run test:node
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
