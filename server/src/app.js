import express from "express";
import { sanitizeSystemConfigPayload } from "./config/payload.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerCatalogExportRoutes } from "./routes/catalog-exports.js";
import { registerApiErrorHandler } from "./routes/errors.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerPythonProxyRoutes } from "./proxy/routes.js";

export function createOrbitApp({ runtime, config, catalog, importer, refresher, pythonBackend, pythonClient }) {
    const app = express();
    app.use(express.json({ limit: "25mb" }));

    registerSystemRoutes(app, {
        getConfig: config.get,
        saveConfig: config.save,
        updateConfig: config.update,
        sanitize: sanitizeSystemConfigPayload,
        onSaved: async () => {
            await refresher.schedule();
            return pythonBackend.reload();
        }
    });
    registerCatalogRoutes(app, {
        catalog,
        config,
        importCatalog: importer.importContent,
        refreshCatalog: refresher.refresh
    });
    registerCatalogExportRoutes(app, { catalog });
    registerPythonProxyRoutes(app, pythonClient);

    app.use(express.static(runtime.reactDistDir));
    app.use(express.static(runtime.frontDir));
    app.use("/config", express.static(runtime.configDir));
    app.get("/health", async (_request, response) => {
        let ready = false;
        try {
            ready = await pythonBackend.isHealthy();
        } catch {
            ready = false;
        }
        response.status(ready ? 200 : 503).json({
            status: ready ? "ok" : "starting",
            python_backend: ready ? "ok" : "unavailable"
        });
    });
    registerApiErrorHandler(app);
    return app;
}
