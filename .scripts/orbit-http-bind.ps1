# Resolve the published Orbit HTTP bind address for every Docker-facing script.

function Get-OrbitHttpBind {
    param(
        [string]$Value = $env:ORBIT_HTTP_BIND
    )

    $candidate = if ([string]::IsNullOrWhiteSpace($Value)) { "127.0.0.1" } else { $Value.Trim() }
    if ($candidate -notin @("127.0.0.1", "0.0.0.0")) {
        throw "ORBIT_HTTP_BIND must be 127.0.0.1 (local only) or 0.0.0.0 (explicit network exposure)."
    }

    return $candidate
}
