# Resolve the published Orbit HTTP port once for every Docker-facing script.

function Get-OrbitHttpPort {
    param(
        [string]$Value = $env:ORBIT_HTTP_PORT
    )

    $candidate = if ([string]::IsNullOrWhiteSpace($Value)) { "8100" } else { $Value.Trim() }
    $port = 0
    if (-not [int]::TryParse($candidate, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        throw "ORBIT_HTTP_PORT must be an integer between 1 and 65535."
    }

    return $port
}
