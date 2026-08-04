# Execute gateway, frontend, React build, backend, and browser integration suites in that order.

$ErrorActionPreference = "Stop"
$scriptsRoot = $PSScriptRoot
foreach ($scriptName in @("test-node.ps1", "test-frontend.ps1", "test-react-build.ps1", "test-backend.ps1", "test-ui.ps1")) {
    $scriptPath = Join-Path $scriptsRoot $scriptName
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
