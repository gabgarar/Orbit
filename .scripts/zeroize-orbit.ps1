<#
.SYNOPSIS
    Restablece de forma controlada el estado operativo local de Orbit.

.DESCRIPTION
    El script detiene el despliegue Compose si está activo, borra cachés y
    productos importados regenerables, restaura la configuración de arranque
    versionada y publica una nueva generación de estado cliente. En el
    siguiente arranque, la aplicación ve esa generación antes de crear el
    servicio de identidad y borra sus cuentas, claves y proyectos locales del
    navegador.

    No borra código, dependencias, la tabla IERS de segundos intercalares ni
    rutas externas configuradas mediante variables ORBIT_*. Use -WhatIf para
    revisar el alcance sin modificar nada.
#>

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "High")]
param(
    # Reinicia Orbit al terminar. Sin este modificador, el script deja el
    # servicio detenido para que el siguiente inicio muestre su preparación.
    [switch]$Restart,

    # Incluye cachés y artefactos de desarrollo. No elimina node_modules ni
    # entornos virtuales porque no son estado operativo de Orbit.
    [switch]$IncludeDevelopmentArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptsRoot = $PSScriptRoot
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptsRoot ".."))
$dataRoot = Join-Path $projectRoot "data"
$configRoot = Join-Path $projectRoot "config"
$clientGenerationMarker = Join-Path $dataRoot ".orbit-client-state-generation.json"

function Resolve-ProjectPath {
    param(
        [Parameter(Mandatory)]
        [string]$Path,
        [Parameter(Mandatory)]
        [string]$Purpose
    )

    $trimCharacters = [char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $resolvedProjectRoot = [System.IO.Path]::GetFullPath($projectRoot).TrimEnd($trimCharacters)
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    $separator = [System.IO.Path]::DirectorySeparatorChar
    $projectPrefix = "$resolvedProjectRoot$separator"
    if ($resolvedPath -eq $resolvedProjectRoot -or -not $resolvedPath.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "$Purpose no está dentro del proyecto Orbit: $resolvedPath"
    }
    return $resolvedPath
}

function Assert-NotReparsePoint {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    # OneDrive Files On-Demand marks ordinary in-project folders as
    # ReparsePoint too, while LinkType/Target remain empty. Only reject a
    # real filesystem link; an actual OneDrive placeholder is safe because the
    # explicit target path has already passed Resolve-ProjectPath.
    $linkType = [string]$item.LinkType
    $linkTargets = @($item.Target | Where-Object { -not [string]::IsNullOrWhiteSpace("$_") })
    if (-not [string]::IsNullOrWhiteSpace($linkType) -or $linkTargets.Count -gt 0) {
        throw "Se rechaza borrar el enlace '$Path'. Revísalo manualmente."
    }
}

function Remove-OrbitResetTarget {
    param(
        [Parameter(Mandatory)]
        [string]$Path,
        [Parameter(Mandatory)]
        [string]$Description
    )

    $target = Resolve-ProjectPath -Path $Path -Purpose $Description
    if (-not (Test-Path -LiteralPath $target)) {
        Write-Host "  Sin cambios: $Description" -ForegroundColor DarkGray
        return
    }
    Assert-NotReparsePoint -Path $target
    Remove-Item -LiteralPath $target -Force -Recurse -Confirm:$false
    Write-Host "  Eliminado: $Description" -ForegroundColor Yellow
}

function Ensure-OrbitDirectory {
    param([Parameter(Mandatory)][string]$Path)

    $target = Resolve-ProjectPath -Path $Path -Purpose "Directorio operativo"
    if (Test-Path -LiteralPath $target) {
        Assert-NotReparsePoint -Path $target
        return
    }
    # New-Item does not accept -LiteralPath in Windows PowerShell 5.1.
    # Use the .NET API so the zeroizer works in both Windows PowerShell and PowerShell 7.
    [System.IO.Directory]::CreateDirectory($target) | Out-Null
}

function Invoke-RequiredGitRestore {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "Git es necesario para restaurar la configuración semilla de Orbit."
    }
    & git -C $projectRoot restore --source=HEAD --worktree -- "config/catalog.json" "config/system_config.json"
    if ($LASTEXITCODE -ne 0) {
        throw "No se pudieron restaurar config/catalog.json y config/system_config.json desde HEAD."
    }
    Write-Host "  Restauradas: configuración y catálogo semilla" -ForegroundColor Yellow
}

function Write-ClientStateGenerationMarker {
    Ensure-OrbitDirectory -Path $dataRoot
    $markerPath = Resolve-ProjectPath -Path $clientGenerationMarker -Purpose "Marcador de restablecimiento del cliente"
    $generation = [System.Guid]::NewGuid().ToString()
    $payload = [ordered]@{
        schema = "orbit.client-state-generation"
        version = 1
        generation = $generation
    } | ConvertTo-Json -Compress
    $temporaryPath = Join-Path $dataRoot (".orbit-client-state-generation-{0}.tmp" -f [System.Guid]::NewGuid().ToString("N"))
    # Windows PowerShell/.NET Framework rejects $null as File.Replace's backup
    # path. Keep an ephemeral backup on the same volume and remove it after the
    # atomic replacement has completed.
    $backupPath = Join-Path $dataRoot (".orbit-client-state-generation-{0}.bak" -f [System.Guid]::NewGuid().ToString("N"))

    try {
        [System.IO.File]::WriteAllText($temporaryPath, "$payload$([Environment]::NewLine)", [System.Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $markerPath) {
            [System.IO.File]::Replace($temporaryPath, $markerPath, $backupPath)
        } else {
            [System.IO.File]::Move($temporaryPath, $markerPath)
        }
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force -Confirm:$false
        }
        if (Test-Path -LiteralPath $backupPath) {
            Remove-Item -LiteralPath $backupPath -Force -Confirm:$false
        }
    }

    Write-Host "  Publicada: nueva generación para borrar el estado local del navegador" -ForegroundColor Yellow
    return $generation
}

function Get-RunningOrbitComposeServices {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return @() }

    Push-Location $projectRoot
    try {
        $services = @(& docker compose ps --status running --services 2>$null)
        if ($LASTEXITCODE -ne 0) {
            throw "No se ha podido comprobar Docker Compose. No se ha borrado nada: inicia Docker Desktop o detén Orbit manualmente antes de reintentar."
        }
        return @($services | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
    } finally {
        Pop-Location
    }
}

function Stop-RunningOrbitComposeServices {
    param([string[]]$Services)

    if (-not $Services.Count) { return }
    Write-Host "Deteniendo Orbit: $($Services -join ', ')" -ForegroundColor Cyan
    Push-Location $projectRoot
    try {
        & docker compose down
        if ($LASTEXITCODE -ne 0) {
            throw "Docker Compose no pudo detener Orbit; no se ha borrado ningún dato."
        }
    } finally {
        Pop-Location
    }
}

function Write-ExternalPathWarning {
    $externalPathVariables = @(
        "ORBIT_EOP_C04_PATH",
        "ORBIT_GRAVITY_FIELD_PATH",
        "ORBIT_LEAP_SECONDS_PATH",
        "ORBIT_EOP_C01_CACHE_PATH",
        "ORBIT_FINALS2000A_CACHE_PATH",
        "ORBIT_GRAVITY_CACHE_DIR"
    )
    foreach ($variableName in $externalPathVariables) {
        $value = [Environment]::GetEnvironmentVariable($variableName)
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            Write-Warning "$variableName está configurada en '$value'. El script no sigue ni borra rutas configuradas fuera de sus objetivos locales conocidos."
        }
    }
}

$runtimeDirectories = @(
    @{ Path = (Join-Path $dataRoot "erp"); Description = "caché IERS C01 y finals2000A" },
    @{ Path = (Join-Path $dataRoot "geopotential"); Description = "caché NGA EGM96/EGM2008" },
    @{ Path = (Join-Path $dataRoot "test-real-data"); Description = "caché de datos de pruebas reales" },
    @{ Path = (Join-Path $configRoot "precise-products"); Description = "productos GNSS precisos importados" },
    @{ Path = (Join-Path $configRoot "manual-erp-snapshots"); Description = "ERP manuales importados" }
)
$runtimeLogs = @(
    "debug.log",
    "server/debug.log",
    "server/server.log",
    "server/server.pid",
    "server.pid",
    "server.log"
)
$developmentTargets = @(
    "front/dist",
    "react-ui/dist",
    "react-ui/.runtime-vendor",
    "react-ui/.npm-cache",
    "server/ui-artifacts",
    "tests/artifacts",
    ".pytest_cache",
    ".ruff_cache",
    "server/python/.pytest_cache",
    "server/python/.ruff_cache"
)

$runningServices = @(Get-RunningOrbitComposeServices)
Write-Host "Orbit se restablecerá a un estado operativo nuevo." -ForegroundColor Cyan
Write-Host "Se eliminarán: cachés EOP/EGM, SP3/ERP importados, logs y datos locales del navegador en el próximo arranque." -ForegroundColor Cyan
Write-Host "Se restaurarán desde HEAD: config/catalog.json y config/system_config.json." -ForegroundColor Cyan
Write-Host "Se preserva: config/eop/leap-seconds.list (recurso IERS obligatorio y verificado)." -ForegroundColor Cyan
if ($runningServices.Count) {
    Write-Host "Orbit está en ejecución y se detendrá antes de limpiar: $($runningServices -join ', ')." -ForegroundColor Yellow
}
if ($IncludeDevelopmentArtifacts) {
    Write-Host "También se eliminarán artefactos de desarrollo regenerables." -ForegroundColor Cyan
}
Write-ExternalPathWarning

if (-not $PSCmdlet.ShouldProcess($projectRoot, "zeroizar los datos operativos de Orbit")) {
    Write-Host "No se ha modificado nada. Ejecuta sin -WhatIf y confirma para aplicar el restablecimiento." -ForegroundColor DarkGray
    return
}

Stop-RunningOrbitComposeServices -Services $runningServices

# El marcador se escribe primero. Si la limpieza posterior falla a mitad, el
# próximo cliente seguirá invalidando cuentas, claves y proyectos antiguos.
$generation = Write-ClientStateGenerationMarker

foreach ($target in $runtimeDirectories) {
    Remove-OrbitResetTarget -Path $target.Path -Description $target.Description
}

Invoke-RequiredGitRestore

foreach ($relativePath in $runtimeLogs) {
    Remove-OrbitResetTarget -Path (Join-Path $projectRoot $relativePath) -Description "registro de ejecución $relativePath"
}

# Sólo se consideran logs en el directorio raíz ya enumerados y con un nombre
# conocido; no se usan globs ni rutas calculadas fuera del proyecto.
Get-ChildItem -LiteralPath $projectRoot -Force -File | Where-Object {
    $_.Name -match "^(npm|yarn)-(debug|error)\\.log(?:\\..+)?$"
} | ForEach-Object {
    Remove-OrbitResetTarget -Path $_.FullName -Description "registro de herramientas $($_.Name)"
}

if ($IncludeDevelopmentArtifacts) {
    foreach ($relativePath in $developmentTargets) {
        Remove-OrbitResetTarget -Path (Join-Path $projectRoot $relativePath) -Description "artefacto de desarrollo $relativePath"
    }
}

foreach ($target in $runtimeDirectories) {
    Ensure-OrbitDirectory -Path $target.Path
}

Write-Host "`nOrbit ha quedado zeroizado. Generación cliente: $generation" -ForegroundColor Green
Write-Host "Al abrir Orbit de nuevo se borrarán las cuentas, claves y proyectos locales de este origen antes de mostrar el acceso." -ForegroundColor Green
if ($Restart) {
    $restartScript = Join-Path $scriptsRoot "restart-orbit.ps1"
    Write-Host "Reiniciando Orbit para iniciar la descarga y validación inicial..." -ForegroundColor Cyan
    & $restartScript
    if ($LASTEXITCODE -ne 0) {
        throw "El estado se ha zeroizado, pero Orbit no pudo reiniciarse. Consulta .scripts/orbit-logs.cmd."
    }
} else {
    Write-Host "Cuando quieras arrancar de nuevo: .\\.scripts\\restart-orbit.cmd" -ForegroundColor Cyan
}
