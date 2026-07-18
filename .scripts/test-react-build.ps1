# Validate the React production bundle, including the legacy Cesium runtime chunk.

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    npm.cmd --prefix react-ui run build
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
