export const EARTH_RADIUS_KM = 6378.137;
export const EARTH_MU_KM3_S2 = 398600.4418;

const OPERATOR_RULES = Object.freeze([
    [/\bstarlink\b/i, "spacex"],
    [/\boneweb\b/i, "oneweb"],
    [/\bgalileo\b/i, "esa"],
    [/\bgps|navstar\b/i, "ussf"],
    [/\bglonass\b/i, "roscosmos"],
    [/\bbeidou\b/i, "casc"],
    [/\biss|station|tiangong\b/i, "multinational"],
    [/\biridium\b/i, "iridium"],
    [/\bglobalstar\b/i, "globalstar"],
    [/\bintelsat\b/i, "intelsat"]
]);

const OWNER_BY_OPERATOR = Object.freeze({
    spacex: "spacex",
    oneweb: "eutelsat-oneweb",
    esa: "esa",
    ussf: "us-space-force",
    roscosmos: "roscosmos",
    casc: "china",
    iridium: "iridium",
    globalstar: "globalstar",
    intelsat: "intelsat"
});

function normalizedString(value) {
    return String(value ?? "").trim();
}

function finiteNumber(value) {
    if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
        return null;
    }
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

export function inferOperator(name) {
    const normalizedName = normalizedString(name);
    if (!normalizedName) return "unknown";
    return OPERATOR_RULES.find(([pattern]) => pattern.test(normalizedName))?.[1] || "unknown";
}

export function inferOwner(name) {
    return OWNER_BY_OPERATOR[inferOperator(name)] || "unknown";
}

function estimatePerigeeKmFromLine2(line2) {
    const cleanLine = String(line2 || "");
    const meanMotion = Number(cleanLine.slice(52, 63).trim());
    const eccentricity = Number(`0.${cleanLine.slice(26, 33).trim() || "0"}`);
    if (!Number.isFinite(meanMotion) || meanMotion <= 0 || !Number.isFinite(eccentricity) || eccentricity < 0 || eccentricity >= 1) {
        return null;
    }

    const meanMotionRadiansPerSecond = meanMotion * (2 * Math.PI) / 86400;
    const perigeeKm = (
        Math.cbrt(EARTH_MU_KM3_S2 / (meanMotionRadiansPerSecond * meanMotionRadiansPerSecond))
        * (1 - eccentricity)
    ) - EARTH_RADIUS_KM;
    return Number.isFinite(perigeeKm) ? perigeeKm : null;
}

/** Return the explicit perigee when valid, otherwise derive it from TLE line 2. */
export function getPerigeeKm(entry = {}) {
    return finiteNumber(entry?.perigee_km) ?? estimatePerigeeKmFromLine2(entry?.line2);
}

export function withCatalogMetadata(entry = {}) {
    const name = normalizedString(entry?.name);
    const line1 = normalizedString(entry?.line1);
    const line2 = normalizedString(entry?.line2);
    const sourceFormat = normalizedString(entry?.sourceFormat || "TLE").toUpperCase() || "TLE";
    const sourceOrigin = normalizedString(entry?.sourceOrigin || entry?.source_origin || "CATALOG").toUpperCase();
    const operator = normalizedString(entry?.operator).toLowerCase() || inferOperator(name);
    const owner = normalizedString(entry?.owner).toLowerCase() || inferOwner(name);

    return {
        ...entry,
        name,
        line1,
        line2,
        sourceFormat,
        sourceOrigin: sourceOrigin === "CUSTOM" ? "CUSTOM" : "CATALOG",
        operator,
        owner,
        perigee_km: getPerigeeKm({ ...entry, line2 })
    };
}
