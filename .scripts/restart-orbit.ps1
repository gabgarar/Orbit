# Rebuild (using Docker cache by default) and restart Orbit from any directory.

param(
    [switch]$SkipBuild,
    [switch]$NoCache
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

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker was not found. Open Docker Desktop and run this script from a new terminal."
}
if ($SkipBuild -and $NoCache) {
    throw "-SkipBuild and -NoCache cannot be used together."
}

Push-Location $projectRoot
try {
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

    docker compose up --detach --force-recreate --wait --wait-timeout 90
    if ($LASTEXITCODE -ne 0) {
        throw "Orbit did not become healthy within 90 seconds. Run .\.scripts\orbit-logs.cmd to inspect the service logs."
    }

    docker compose ps
    $exposure = if ($orbitHttpBind -eq "0.0.0.0") { "network-exposed" } else { "local-only" }
    Write-Host "`nOrbit restarted and healthy ($exposure). Open http://localhost:$orbitHttpPort" -ForegroundColor Green
} finally {
    Pop-Location
}
