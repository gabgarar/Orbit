import { filterValidTleEntries, normalizeTleEntries } from "./tle.js";
import { withCatalogMetadata } from "./metadata.js";
import { parseCatalogContent } from "./parsers.js";
import { getNoradId } from "./query.js";

function renamedConflicts(existingEntries, importedEntries) {
    const existingNames = new Map();
    for (const entry of existingEntries) {
        const norad = getNoradId(entry);
        if (norad && !existingNames.has(norad)) {
            existingNames.set(norad, String(entry.name || "").trim());
        }
    }
    return importedEntries.flatMap((entry) => {
        const norad = getNoradId(entry);
        const existingName = existingNames.get(norad);
        const importedName = String(entry.name || "").trim();
        if (!norad || !existingName || !importedName || existingName.toLowerCase() === importedName.toLowerCase()) return [];
        return [{ norad, existingName, importedName }];
    });
}

/**
 * Return the actual catalogue record that survived normalisation for each
 * accepted import candidate. A pre-existing CUSTOM entry can deliberately win
 * over a later import with the same NORAD id; the browser must hydrate that
 * durable record, never the discarded candidate.
 */
function persistedImportedEntries(entries, candidates) {
    const byNorad = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
        const norad = getNoradId(entry);
        if (norad && !byNorad.has(norad)) byNorad.set(norad, entry);
    }
    const seen = new Set();
    return (Array.isArray(candidates) ? candidates : []).flatMap((candidate) => {
        const entry = byNorad.get(getNoradId(candidate));
        const identity = entry ? `${getNoradId(entry)}:${String(entry.name || "").trim()}` : "";
        if (!entry || seen.has(identity)) return [];
        seen.add(identity);
        return [entry];
    });
}

/** Preserve display identifiers; Layers uses these exact catalogue ids. */
function uniqueCatalogNames(entries) {
    const names = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
        const name = String(entry?.name || "").trim();
        const key = name.toLowerCase();
        if (name && !names.has(key)) names.set(key, name);
    }
    return [...names.values()].sort((left, right) => left.localeCompare(right));
}

function importTimestamp(now) {
    const candidate = typeof now === "function" ? now() : new Date();
    const date = candidate instanceof Date ? candidate : new Date(candidate);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

export function createCatalogImportService({ catalog, serialize, reloadPython, now = () => new Date() }) {
    async function mergeIntoLatestCatalog(mutator) {
        if (typeof catalog.update === "function") return catalog.update(mutator, serialize);
        const current = await catalog.get();
        const entries = await mutator(current);
        if (entries === undefined) return { ...current, changed: false };
        const catalogPath = await catalog.replace(entries, serialize);
        return { catalogPath, entries, changed: true };
    }

    async function importContent({ fileName = "imported-catalog", content = "", merge = true, includeEntries = false }) {
        const normalizedFileName = String(fileName).trim() || "imported-catalog";
        const normalizedContent = String(content);
        if (!normalizedContent.trim()) return { ok: false, status: 400, error: "Contenido de fichero vacio." };

        const parsed = parseCatalogContent({ fileName: normalizedFileName, content: normalizedContent });
        // Keep the actual local import fact with the custom entry. It is
        // provenance, not a TLE validity/expiry estimate, and it allows the
        // planner to reconstruct a layer-import event after a reload.
        const importedAt = importTimestamp(now);
        const importedEntries = parsed.entries.map((entry) => withCatalogMetadata({
            ...entry,
            sourceOrigin: "CUSTOM",
            importFileName: normalizedFileName,
            ...(importedAt ? { importedAt } : {})
        }));
        if (parsed.format === "OEM" && !importedEntries.length) {
            return { ok: false, status: 400, error: "El OEM no contiene TLE embebido (TLE_LINE1/TLE_LINE2). OEM ephemeris puro aun no se importa como orbita nativa." };
        }

        const { valid, invalid } = filterValidTleEntries(importedEntries);
        let currentEntries = [];
        let normalized = [];
        const update = merge
            ? await mergeIntoLatestCatalog(({ entries }) => {
                currentEntries = entries;
                normalized = normalizeTleEntries([...entries, ...valid].map(withCatalogMetadata));
                return normalized.length ? normalized : undefined;
            })
            : (() => {
                normalized = normalizeTleEntries(valid.map(withCatalogMetadata));
                return normalized.length
                    ? catalog.replace(normalized, serialize).then((catalogPath) => ({ catalogPath, entries: normalized, changed: true }))
                    : Promise.resolve({ entries: [], changed: false });
            })();
        const persisted = await update;
        if (!normalized.length) return { ok: false, status: 400, error: "No se encontraron elementos validos para importar." };

        const retainedImports = persistedImportedEntries(persisted.entries, valid);
        const result = {
            ok: true,
            format: parsed.format,
            imported: valid.length,
            // Names and hydration data must refer to the durable normalized
            // record, especially when an older custom entry won a NORAD
            // collision under the explicit catalogue policy.
            importedNames: uniqueCatalogNames(retainedImports),
            renamedConflicts: renamedConflicts(currentEntries, valid),
            invalid: invalid.length,
            skipped: Number(parsed.skipped || 0),
            total: persisted.entries.length,
            merge,
            // The browser has just supplied these local records. Returning
            // them only when it will immediately activate them avoids a
            // paginated catalogue reload leaving a new layer without its
            // TLE/provenance cache, while avoiding a large duplicate payload
            // for catalogue-only imports.
            ...(includeEntries === true ? { importedEntries: retainedImports.map((entry) => ({ ...entry })) } : {})
        };
        if (await reloadPython() === false) {
            return {
                ...result,
                ok: false,
                status: 503,
                persisted: true,
                error: "El catalogo se guardo, pero el backend de propagacion no pudo recargarse. Reinicia Orbit para aplicar los cambios."
            };
        }
        return result;
    }
    return { importContent };
}
