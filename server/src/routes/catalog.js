import { createCatalogPageService } from "../catalog/page-service.js";
import { registerCatalogActionRoutes } from "./catalog-actions.js";

export function registerCatalogRoutes(app, { catalog, config, importCatalog, refreshCatalog }) {
    const catalogPage = createCatalogPageService({ catalog, config });

    registerCatalogActionRoutes(app, { catalog, importCatalog, refreshCatalog });

    app.get("/api/catalog/page", async (req, res) => {
        try {
            res.json(await catalogPage.getPage(req.query));
        } catch (error) { res.status(500).json({ ok: false, error: error.message }); }
    });
}
