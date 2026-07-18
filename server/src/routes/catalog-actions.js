import { normalizeText } from "../catalog/query.js";

function findCatalogEntry(entries, name) {
    const normalizedName = normalizeText(name);
    return entries.find((entry) => normalizeText(entry.name) === normalizedName);
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function isDiscoveryRequested(value) {
    return String(value || "").toLowerCase() === "true";
}

/** Register catalog mutations and the legacy single-TLE lookup endpoint. */
export function registerCatalogActionRoutes(app, { catalog, importCatalog, refreshCatalog }) {
    app.post("/api/catalog/refresh", async (request, response) => {
        try {
            const result = await refreshCatalog({ discover: isDiscoveryRequested(request.query.discover) });
            return response.status(result.ok ? 200 : result.status || 502).json(result);
        } catch (error) {
            return response.status(500).json({ ok: false, error: errorMessage(error) });
        }
    });

    app.post("/api/catalog/import", async (request, response) => {
        try {
            const result = await importCatalog({
                fileName: request.body?.fileName,
                content: request.body?.content,
                merge: request.body?.merge !== false
            });
            return response.status(result.ok ? 200 : result.status || 500).json(result);
        } catch (error) {
            return response.status(500).json({ ok: false, error: errorMessage(error) });
        }
    });

    app.get("/api/catalog/tle", async (request, response) => {
        const name = String(request.query.name || "").trim();
        if (!name) return response.status(400).json({ ok: false, error: "Parametro 'name' requerido." });

        try {
            const { entries } = await catalog.get();
            const entry = findCatalogEntry(entries, name);
            return entry
                ? response.json({ ok: true, item: entry })
                : response.status(404).json({ ok: false, error: "Satelite no encontrado." });
        } catch (error) {
            return response.status(500).json({ ok: false, error: errorMessage(error) });
        }
    });
}
