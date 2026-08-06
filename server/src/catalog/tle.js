export function computeTleChecksum(line) {
    if (typeof line !== "string" || line.length < 69) return null;
    let sum = 0;
    for (let index = 0; index < 68; index += 1) {
        const character = line[index];
        if (character >= "0" && character <= "9") sum += Number(character);
        else if (character === "-") sum += 1;
    }
    return sum % 10;
}

function hasValidTleChecksum(line) {
    if (typeof line !== "string" || line.length < 69) return false;
    const expected = Number(line[68]);
    return Number.isInteger(expected) && expected >= 0 && expected <= 9 && computeTleChecksum(line) === expected;
}

function isValidTleEntry(entry) {
    const name = String(entry?.name || "").trim(); const line1 = String(entry?.line1 || "").trim(); const line2 = String(entry?.line2 || "").trim();
    if (!name || !line1.startsWith("1 ") || !line2.startsWith("2 ") || line1.length < 69 || line2.length < 69) return false;
    const satelliteNumber = line1.slice(2, 7);
    if (!/^\d{5}$/.test(satelliteNumber) || satelliteNumber !== line2.slice(2, 7)) return false;
    return hasValidTleChecksum(line1) && hasValidTleChecksum(line2) && Number(line2.slice(52, 63).trim()) > 0;
}

export function filterValidTleEntries(entries) {
    const valid = []; const invalid = [];
    for (const entry of entries) (isValidTleEntry(entry) ? valid : invalid).push(entry);
    return { valid, invalid };
}

export function getCatalogEntryOrigin(entry) {
    return String(entry?.sourceOrigin || "CATALOG").trim().toUpperCase() === "CUSTOM"
        ? "CUSTOM"
        : "CATALOG";
}

function catalogEntryKey(entry) {
    const line1 = String(entry?.line1 || "");
    const satelliteNumber = line1.slice(2, 7).trim();
    return satelliteNumber || `${String(entry?.name || "")}|${line1}|${String(entry?.line2 || "")}`;
}

function shouldReplaceEntry(currentEntry, candidateEntry) {
    return getCatalogEntryOrigin(currentEntry) === "CATALOG"
        && getCatalogEntryOrigin(candidateEntry) === "CUSTOM";
}

/**
 * Resolve duplicate NORAD entries with an explicit policy: CUSTOM wins over
 * CATALOG; entries from the same origin keep their first persisted occurrence.
 */
export function normalizeTleEntries(entries) {
    const bySatelliteNumber = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || typeof entry !== "object") continue;
        const key = catalogEntryKey(entry);
        const currentEntry = bySatelliteNumber.get(key);
        if (!currentEntry || shouldReplaceEntry(currentEntry, entry)) {
            bySatelliteNumber.set(key, entry);
        }
    }
    return Array.from(bySatelliteNumber.values())
        .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
}

export function serializeTleCatalog(entries) {
    return `${entries.map((entry) => `${entry.name}\n${entry.line1}\n${entry.line2}`).join("\n\n")}\n`;
}

export function serializeTleCatalogJson(entries) {
    return JSON.stringify({ format: "tle-catalog-v1", generatedAt: new Date().toISOString(), count: entries.length, entries });
}
