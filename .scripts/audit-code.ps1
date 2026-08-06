[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"

function Invoke-AuditCommand {
    param(
        [Parameter(Mandatory)]
        [scriptblock]$Command,
        [Parameter(Mandatory)]
        [string]$Name
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name encontró incidencias. Revisa su salida antes de continuar."
    }
}

if (-not (Test-Path -LiteralPath $python)) {
    throw "No se encontró .venv. Crea el entorno e instala server/requirements-dev.txt antes de ejecutar la auditoría."
}

Push-Location $repoRoot
try {
    Push-Location (Join-Path $repoRoot "server")
    Invoke-AuditCommand { npx.cmd knip --include files,exports,dependencies,unlisted --reporter compact --no-progress } "Knip del servidor"
    Pop-Location
    Invoke-AuditCommand { npx.cmd --prefix server knip --directory react-ui --include files,exports,dependencies,unlisted --reporter compact --no-progress } "Knip de React"
    Invoke-AuditCommand { npx.cmd --prefix server knip --directory front --include files,exports --reporter compact --no-progress } "Knip del frontend"
    Invoke-AuditCommand { npx.cmd --prefix server eslint --config server/eslint.config.js server/src server/scripts front/main.js front/js react-ui/src } "ESLint"
    Invoke-AuditCommand { & $python -m ruff check --select F401,F841 server/python/orbit_api } "Ruff"
    Invoke-AuditCommand { & $python -m vulture server/python/orbit_api --min-confidence 80 } "Vulture"
} finally {
    Pop-Location
}
