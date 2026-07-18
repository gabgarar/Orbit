/** Return the raw five-character NORAD field contained in TLE line 1. */
export function getTleNoradField(line1) {
    return String(line1 || "").slice(2, 7);
}

/** NORAD IDs used for catalogue queries must be numeric values derived from TLE data. */
export function getQueryableNoradId(entry) {
    const identifier = getTleNoradField(entry?.line1).trim();
    return /^\d+$/.test(identifier) ? identifier : "";
}

/** Export payloads preserve an explicit external identifier when one is available. */
export function getExportNoradId(entry) {
    const explicitIdentifier = String(entry?.noradId || "").trim();
    return explicitIdentifier || getTleNoradField(entry?.line1).trim();
}
