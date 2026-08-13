# Build documentation, rebuild (using Docker cache by default) and restart Orbit.

param(
    [switch]$SkipBuild,
    [switch]$NoCache,
    [switch]$SkipDocsBuild
)

$ErrorActionPreference = "Stop"
$scriptsRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptsRoot
. (Join-Path $scriptsRoot "orbit-http-port.ps1")
. (Join-Path $scriptsRoot "orbit-http-bind.ps1")
$orbitHttpPort = Get-OrbitHttpPort
$orbitHttpBind = Get-OrbitHttpBind
$env:ORBIT_HTTP_PORT = "$orbitHttpPort"
$env:ORBIT_HTTP_BIND = $orbitHttpBind

# Match Compose' bounded backend-startup budget.  A product collection may
# need several minutes for strict local SP3/ERP rehydration before /health is
# available; add one minute for the gateway and Docker healthcheck cadence.
$defaultPythonStartupTimeoutMs = 180000
$minimumPythonStartupTimeoutMs = 10000
$maximumPythonStartupTimeoutMs = 600000
$pythonStartupTimeoutMs = $defaultPythonStartupTimeoutMs
$configuredPythonStartupTimeoutMs = "$env:ORBIT_PYTHON_STARTUP_TIMEOUT_MS".Trim()
if ($configuredPythonStartupTimeoutMs -match '^\d+$') {
    $candidatePythonStartupTimeoutMs = [long]$configuredPythonStartupTimeoutMs
    if ($candidatePythonStartupTimeoutMs -ge $minimumPythonStartupTimeoutMs -and $candidatePythonStartupTimeoutMs -le $maximumPythonStartupTimeoutMs) {
        $pythonStartupTimeoutMs = $candidatePythonStartupTimeoutMs
    }
}
$composeWaitTimeoutSeconds = [Math]::Ceiling($pythonStartupTimeoutMs / 1000.0) + 60

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker was not found. Open Docker Desktop and run this script from a new terminal."
}
if ($SkipBuild -and $NoCache) {
    throw "-SkipBuild and -NoCache cannot be used together."
}

Push-Location $projectRoot
try {
    if ($SkipDocsBuild) {
        Write-Host "Skipping documentation build." -ForegroundColor Cyan
    } else {
        $docsPython = Join-Path $projectRoot ".venv\Scripts\python.exe"
        if (-not (Test-Path -LiteralPath $docsPython)) {
            throw "Documentation environment was not found at .venv. Create it with: py -m venv .venv"
        }

        Write-Host "Building documentation..." -ForegroundColor Cyan
        & $docsPython -m mkdocs build --strict
        if ($LASTEXITCODE -ne 0) {
            throw "Documentation build failed. Orbit was not restarted."
        }
    }

    if ($SkipBuild) {
        Write-Host "Reusing the current Orbit image." -ForegroundColor Cyan
    } else {
        $buildArguments = @("compose", "build", "orbit")
        if ($NoCache) {
            $buildArguments = @("compose", "build", "--no-cache", "orbit")
        }
        & docker @buildArguments
        if ($LASTEXITCODE -ne 0) {
            throw "Orbit image could not be rebuilt. The running Orbit container was left untouched."
        }
    }

    docker compose down
    if ($LASTEXITCODE -ne 0) {
        throw "Orbit containers could not be stopped after the image was rebuilt."
    }

    docker compose up --detach --force-recreate --wait --wait-timeout $composeWaitTimeoutSeconds
    if ($LASTEXITCODE -ne 0) {
        throw "Orbit did not become healthy within $composeWaitTimeoutSeconds seconds. Run .\.scripts\orbit-logs.cmd to inspect the service logs."
    }

    docker compose ps
    $exposure = if ($orbitHttpBind -eq "0.0.0.0") { "network-exposed" } else { "local-only" }
    Write-Host "`nOrbit restarted and healthy ($exposure). Open http://localhost:$orbitHttpPort" -ForegroundColor Green
} finally {
    Pop-Location
}
