import {
    formatCatalogEntryToOcm,
    formatCatalogEntryToOem,
    formatCatalogEntryToOmmJson,
    formatCatalogEntryToOmmXml,
    formatCatalogEntryToTleText,
    isEntrySourceFormat
} from "../catalog/exporters.js";
import { normalizeText } from "../catalog/query.js";

const EXPORTS = Object.freeze([
    { kind: "tle", sourceFormat: "TLE", contentType: "text/plain; charset=utf-8", extension: "tle", render: formatCatalogEntryToTleText },
    { kind: "omm", sourceFormat: "OMM", contentType: "application/json; charset=utf-8", extension: "omm.json", render: formatCatalogEntryToOmmJson },
    { kind: "oem", sourceFormat: "OEM", contentType: "text/plain; charset=utf-8", extension: "oem", render: formatCatalogEntryToOem },
    { kind: "ocm", sourceFormat: null, contentType: "application/json; charset=utf-8", extension: "ocm.json", render: formatCatalogEntryToOcm }
]);

function fileBaseName(entry) {
    return String(entry.name || "satellite").replace(/[^a-z0-9\-_]+/gi, "_");
}

function findEntry(entries, satelliteId) {
    return entries.find((entry) => normalizeText(entry.name) === normalizeText(satelliteId));
}

function hasExportableTleLines(entry) {
    return String(entry?.line1 || "").trim().startsWith("1 ")
        && String(entry?.line2 || "").trim().startsWith("2 ");
}

function sendCatalogExport(response, definition, entry, query) {
    const xml = definition.kind === "omm" && String(query.format).toLowerCase() === "xml";
    const extension = xml ? "omm.xml" : definition.extension;
    const contentType = xml ? "application/xml; charset=utf-8" : definition.contentType;
    response.set("Content-Type", contentType);
    response.set("Content-Disposition", `attachment; filename="${fileBaseName(entry)}.${extension}"`);
    response.send(xml ? formatCatalogEntryToOmmXml(entry) : definition.render(entry, query.propagator));
}

export function registerCatalogExportRoutes(app, { catalog }) {
    for (const definition of EXPORTS) {
        app.get(`/api/export/${definition.kind}/:satId`, async (request, response) => {
            try {
                const { entries } = await catalog.get();
                const entry = findEntry(entries, request.params.satId);
                if (!entry) return response.status(404).json({ ok: false, error: "Satelite no encontrado." });
                if (definition.sourceFormat && !isEntrySourceFormat(entry, definition.sourceFormat)) {
                    return response.status(400).json({ ok: false, error: `Este satelite no tiene origen ${definition.sourceFormat}. Exporta en su formato de origen.` });
                }
                if (definition.kind === "tle" && !hasExportableTleLines(entry)) {
                    return response.status(422).json({
                        ok: false,
                        error: "La entrada TLE no conserva lineas validas de tipo 1 y 2. Corrige la importacion antes de exportarla."
                    });
                }
                sendCatalogExport(response, definition, entry, request.query);
            } catch (error) {
                response.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
            }
        });
    }
}
