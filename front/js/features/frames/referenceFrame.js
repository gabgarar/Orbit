const CANONICAL_FRAME_NAMES = new Set([
    "EME2000", "GCRF", "ICRF", "ITRF", "TIRS", "CIRS", "TEME", "PEF", "TOD", "MOD", "ENU"
]);

function frameValue(value) {
    if (typeof value !== "object" || value === null) return value;
    return value.label ?? value.name ?? value.frame ?? value.id ?? value.value ?? "";
}

/**
 * Returns a stable UI label without silently converting or relabelling a
 * declared reference frame. Unknown external frame names remain intact.
 */
export function formatReferenceFrame(value, fallback = "") {
    const text = String(frameValue(value) || "").trim();
    if (!text) return fallback;
    const canonical = text.toUpperCase();
    return CANONICAL_FRAME_NAMES.has(canonical) ? canonical : text;
}

/**
 * Manual designs support an inertial EME2000 view and an Earth-fixed ITRF
 * preview. Legacy ECI/ECEF names are accepted only as input aliases.
 */
export function normalizeManualOrbitPreviewReferenceFrame(value, fallback = "eme2000") {
    const normalize = (candidate) => {
        const normalized = String(candidate || "").trim().toLowerCase();
        if (["itrf", "ecef", "earth-fixed", "earth_fixed"].includes(normalized)) return "itrf";
        if (["eme2000", "eci", "inertial"].includes(normalized)) return "eme2000";
        return null;
    };
    return normalize(value) || normalize(fallback) || "eme2000";
}
