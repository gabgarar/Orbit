const absentIdentifiers = new Set(["", "-", "unknown", "n/a", "na", "none", "null", "undefined"]);

/**
 * NORAD catalogue numbers are meaningful only when the selected object
 * actually publishes one.  In particular, an SP3 PRN (for example G01) is
 * not a NORAD identifier and must not be presented as a missing NORAD value.
 */
function objectDetailsNoradId(value) {
    const normalized = String(value ?? "").trim();
    return absentIdentifiers.has(normalized.toLowerCase()) ? "" : normalized;
}

/**
 * Return the concise secondary header label for an object inspector.  It is
 * intentionally separate from the tabular overview so it remains safe to use
 * in the compact, truncatable header layout.
 */
export function objectDetailsSecondaryHeader({
    sourceFormat = "",
    noradId = "",
    isCelestialBody = false,
    isGroundStation = false
} = {}) {
    if (isCelestialBody) return "CUERPO DE REFERENCIA";
    if (isGroundStation) return "OPERACIONES TERRESTRES";

    const resolvedNoradId = objectDetailsNoradId(noradId);
    if (resolvedNoradId) return `NORAD ${resolvedNoradId}`;

    switch (String(sourceFormat || "").trim().toUpperCase()) {
    case "SP3":
        return "PRODUCTO GNSS · SP3";
    case "OEM":
        return "EFEMÉRIDE OEM";
    case "OMM":
        return "ELEMENTOS OMM";
    case "MANUAL":
        return "ÓRBITA MANUAL";
    case "STATE_VECTOR":
    case "STATE VECTOR":
        return "VECTOR DE ESTADO";
    default:
        return "";
    }
}
