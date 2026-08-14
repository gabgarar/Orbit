# Validate the optional real-data integration suite without making ordinary
# test runs or CI depend on the network.  `-Download` is the only switch that
# authorises an HTTPS fetch; existing ../SP3 or cached files are always
# revalidated before pytest sees them.

[CmdletBinding()]
param(
    [switch]$Download,
    [switch]$Performance,
    [switch]$IncludeIers,
    [string]$CacheDirectory,
    [string]$DataDirectory
)

$ErrorActionPreference = "Stop"
$scriptsRoot = Split-Path -Parent $PSCommandPath
$projectRoot = Split-Path -Parent $scriptsRoot
$pythonRoot = Join-Path $projectRoot "server\python"
$venvPython = Join-Path $projectRoot ".venv\Scripts\python.exe"

if (Test-Path -LiteralPath $venvPython) {
    $pythonCommand = $venvPython
} elseif (Get-Command python.exe -ErrorAction SilentlyContinue) {
    $pythonCommand = "python.exe"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $pythonCommand = "python"
} else {
    throw "Python no se encontró. Cree .venv o instale Python 3.12 con las dependencias de server/requirements.txt."
}

# The support module is test-only and lives under server/python. Preserve a
# caller's path additions while ensuring this source tree wins over a global
# package named tests_support.
$separator = [IO.Path]::PathSeparator
$env:PYTHONPATH = if ([string]::IsNullOrWhiteSpace($env:PYTHONPATH)) {
    $pythonRoot
} else {
    "$pythonRoot$separator$($env:PYTHONPATH)"
}
if (-not [string]::IsNullOrWhiteSpace($CacheDirectory)) {
    $env:ORBIT_REAL_DATA_CACHE = $CacheDirectory
}
if (-not [string]::IsNullOrWhiteSpace($DataDirectory)) {
    $env:ORBIT_REAL_DATA_DIR = $DataDirectory
}

$env:ORBIT_RUN_REAL_DATA = "1"
$env:ORBIT_DOWNLOAD_REAL_DATA = if ($Download) { "1" } else { "0" }
$env:ORBIT_RUN_REAL_DATA_PERFORMANCE = if ($Performance) { "1" } else { "0" }

Push-Location $projectRoot
try {
    if ($Download -or $IncludeIers) {
        $prepareArguments = @("-m", "tests_support.real_data")
        if ($Download) { $prepareArguments += "--download" }
        if ($IncludeIers) { $prepareArguments += "--include-iers" }
        if (-not [string]::IsNullOrWhiteSpace($CacheDirectory)) {
            $prepareArguments += @("--cache-dir", $CacheDirectory)
        }
        if (-not [string]::IsNullOrWhiteSpace($DataDirectory)) {
            $prepareArguments += @("--local-dir", $DataDirectory)
        }
        Write-Host "Preparando datos reales validados (sin red salvo -Download)..." -ForegroundColor Cyan
        & $pythonCommand @prepareArguments
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }

    $pytestArguments = @("-m", "pytest", "-q", "server/python/tests/integration/test_real_data_integration.py")
    if ($Performance) { $pytestArguments += "-s" }
    Write-Host "Ejecutando integración SP3/ERP real (origen local/caché validada)..." -ForegroundColor Cyan
    & $pythonCommand @pytestArguments
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
