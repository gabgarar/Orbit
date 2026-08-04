import { getPerigeeKm, inferOperator, inferOwner } from "./metadata.js";
import { filterCatalogEntries, getNoradId, normalizeText, resolveDecayPerigeeKm } from "./query.js";
import { getUniqueSorted } from "../shared/collections.js";

const SOURCE_FORMATS = new Set(["TLE", "OMM", "OEM", "OCM"]);
const SOURCE_ORIGINS = new Set(["CATALOG", "CUSTOM"]);

function pageNumber(value, fallback, minimum, maximum) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function selectedSourceFormat(value) {
    const format = String(value || "").trim().toUpperCase();
    return SOURCE_FORMATS.has(format) ? format : "";
}

function selectedSourceOrigin(value) {
    const origin = String(value || "").trim().toUpperCase();
    return SOURCE_ORIGINS.has(origin) ? origin : "";
}

function isDecayRisk(entry, threshold) {
    const perigeeKm = getPerigeeKm(entry);
    return perigeeKm !== null && perigeeKm < threshold;
}

export function createCatalogPageService({ catalog, config }) {
    async function getPage(query = {}) {
        const configuration = await config.get();
        const decayPerigeeKm = resolveDecayPerigeeKm(configuration.data?.decay_alert_perigee_km);
        const filters = {
            search: normalizeText(query.search),
            orbitKind: normalizeText(query.orbitKind),
            mission: normalizeText(query.mission),
            operator: normalizeText(query.operator),
            owner: normalizeText(query.owner),
            decayOnly: String(query.decayOnly || "").toLowerCase() === "true",
            decayPerigeeKm
        };
        const sourceFormat = selectedSourceFormat(query.sourceFormat);
        const sourceOrigin = selectedSourceOrigin(query.sourceOrigin);
        const offset = pageNumber(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = pageNumber(query.limit, 100, 1, 1000);
        const { entries } = await catalog.get();
        let filtered = filterCatalogEntries(entries, filters);

        if (sourceFormat) {
            filtered = filtered.filter((entry) => String(entry.sourceFormat || "TLE").trim().toUpperCase() === sourceFormat);
        }
        if (sourceOrigin) {
            filtered = filtered.filter((entry) => String(entry.sourceOrigin || "CATALOG").trim().toUpperCase() === sourceOrigin);
        }

        const duplicateNames = new Set();
        const knownNames = new Set();
        for (const entry of filtered) {
            const name = String(entry?.name || "").trim();
            if (!name) continue;
            if (knownNames.has(name)) duplicateNames.add(name);
            else knownNames.add(name);
        }
        const items = filtered.slice(offset, offset + limit).map((entry, index) => {
            const name = String(entry?.name || "").trim();
            const noradId = getNoradId(entry);
            // Display and interaction IDs must be unique: launch debris often
            // shares a human-readable name while representing distinct TLEs.
            const catalogId = duplicateNames.has(name)
                ? `${name} · NORAD ${noradId || offset + index + 1}`
                : name;
            return {
                ...entry,
                catalogId,
                noradId,
                decayRisk: isDecayRisk(entry, decayPerigeeKm)
            };
        });
        return {
            ok: true,
            total: filtered.length,
            offset,
            limit,
            hasMore: offset + items.length < filtered.length,
            operators: getUniqueSorted(entries.map((entry) => entry.operator || inferOperator(entry.name))),
            owners: getUniqueSorted(entries.map((entry) => entry.owner || inferOwner(entry.name))),
            decayPerigeeKm,
            items
        };
    }
    return { getPage };
}
