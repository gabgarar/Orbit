import { EARTH_MU_KM3_S2, EARTH_RADIUS_KM, getPerigeeKm, inferOperator, inferOwner } from "./metadata.js";
import { getQueryableNoradId } from "./identity.js";

export const ORBIT_KIND = Object.freeze({
    LEO: "leo",
    MEO: "meo",
    GEO: "geo",
    HEO: "heo",
    UNKNOWN: "unknown"
});

export const DEFAULT_DECAY_PERIGEE_KM = 200;

const MISSION_RULES = Object.freeze([
    ["starlink", /\bstarlink\b/i],
    ["sentinel", /\bsentinel\b/i],
    ["oneweb", /\boneweb\b/i],
    ["planet", /\bplanet\b/i],
    ["gnss", /\b(gps|galileo|glonass|beidou|navstar|qzss|irnss|navic)\b/i],
    ["weather", /\b(weather|goes|noaa|meteo|metop|himawari|fy-|fengyun)\b/i],
    ["communications", /\b(intelsat|iridium|orbcomm|globalstar|ses|viasat|echostar)\b/i],
    ["stations", /\b(iss|tiangong|css|station)\b/i],
    ["military", /\b(nrol|yaogan|military|defense|usa )\b/i],
    ["science", /\b(hubble|jwst|fermi|swift|gaia|tess|science)\b/i],
    ["earth-observation", /\b(landsat|resource|dmc|radarsat|spot|pleiades)\b/i]
]);

export const normalizeText = (value) => String(value || "").trim().toLowerCase();
export const getNoradId = getQueryableNoradId;

/** Convert persisted/query configuration into a usable non-negative threshold. */
export function resolveDecayPerigeeKm(value, fallback = DEFAULT_DECAY_PERIGEE_KM) {
    if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
        return fallback;
    }
    const threshold = Number(value);
    return Number.isFinite(threshold) && threshold >= 0 ? threshold : fallback;
}

export function inferOrbitKind(line2) {
    const meanMotion = Number(String(line2 || "").slice(52, 63).trim());
    if (!(meanMotion > 0)) return ORBIT_KIND.UNKNOWN;
    const altitude = Math.cbrt(EARTH_MU_KM3_S2 / ((meanMotion * 2 * Math.PI / 86400) ** 2)) - EARTH_RADIUS_KM;
    if (altitude < 2000) return ORBIT_KIND.LEO;
    if (altitude < 35786) return ORBIT_KIND.MEO;
    return altitude <= 36550 ? ORBIT_KIND.GEO : ORBIT_KIND.HEO;
}

export function inferMission(name) {
    return MISSION_RULES.find(([, test]) => test.test(String(name || "")))?.[0] || "other";
}

function matchesSearch(entry, search) {
    if (!search) return true;
    const noradId = getNoradId(entry);
    const numericSearch = search.replace(/^0+/, "");
    const name = normalizeText(entry?.name);
    return name.includes(search)
        || noradId.includes(search)
        || Boolean(numericSearch && noradId.includes(numericSearch));
}

export function filterCatalogEntries(entries, filters = {}) {
    const threshold = resolveDecayPerigeeKm(filters.decayPerigeeKm);
    const search = normalizeText(filters.search);
    const orbitKind = normalizeText(filters.orbitKind);
    const mission = normalizeText(filters.mission);
    const operator = normalizeText(filters.operator);
    const owner = normalizeText(filters.owner);

    return (Array.isArray(entries) ? entries : []).filter((entry) => {
        if (!matchesSearch(entry, search)) return false;
        if (orbitKind && inferOrbitKind(entry?.line2) !== orbitKind) return false;
        if (mission && inferMission(entry?.name) !== mission) return false;
        if (operator && (normalizeText(entry?.operator) || inferOperator(entry?.name)) !== operator) return false;
        if (owner && (normalizeText(entry?.owner) || inferOwner(entry?.name)) !== owner) return false;

        const perigeeKm = getPerigeeKm(entry);
        return !filters.decayOnly || (perigeeKm !== null && perigeeKm < threshold);
    });
}
