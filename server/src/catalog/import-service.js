import { filterValidTleEntries, normalizeTleEntries } from "./tle.js";
import { withCatalogMetadata } from "./metadata.js";
import { parseCatalogContent } from "./parsers.js";
import { getNoradId } from "./query.js";
import { getUniqueSorted } from "../shared/collections.js";

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

export function createCatalogImportService({ catalog, serialize, reloadPython }) {
    async function mergeIntoLatestCatalog(mutator) {
        if (typeof catalog.update === "function") return catalog.update(mutator, serialize);
        const current = await catalog.get();
        const entries = await mutator(current);
        if (entries === undefined) return { ...current, changed: false };
        const catalogPath = await catalog.replace(entries, serialize);
        return { catalogPath, entries, changed: true };
    }

    async function importContent({ fileName = "imported-catalog", content = "", merge = true }) {
        const normalizedFileName = String(fileName).trim() || "imported-catalog";
        const normalizedContent = String(content);
        if (!normalizedContent.trim()) return { ok: false, status: 400, error: "Contenido de fichero vacio." };

        const parsed = parseCatalogContent({ fileName: normalizedFileName, content: normalizedContent });
        const importedEntries = parsed.entries.map((entry) => withCatalogMetadata({ ...entry, sourceOrigin: "CUSTOM" }));
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

        const result = {
            ok: true,
            format: parsed.format,
            imported: valid.length,
            importedNames: getUniqueSorted(valid.map((entry) => entry.name)),
            renamedConflicts: renamedConflicts(currentEntries, valid),
            invalid: invalid.length,
            skipped: Number(parsed.skipped || 0),
            total: persisted.entries.length,
            merge
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
