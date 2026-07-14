# Execute frontend, backend, and browser integration suites in that order.

$ErrorActionPreference = "Stop"
$scriptsRoot = $PSScriptRoot
foreach ($scriptName in @("test-frontend.ps1", "test-backend.ps1", "test-ui.ps1")) {
    & (Join-Path $scriptsRoot $scriptName)
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
