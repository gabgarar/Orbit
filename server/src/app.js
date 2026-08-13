import express from "express";
import path from "node:path";
import { sanitizeSystemConfigPayload } from "./config/payload.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerCatalogExportRoutes } from "./routes/catalog-exports.js";
import { registerApiErrorHandler } from "./routes/errors.js";
import { registerSystemRoutes } from "./routes/system.js";
import {
    registerManualOrbitErpBodyParser,
    registerManualOrbitErpPreviewProxyRoute,
    registerPreciseProductImportBodyParser,
    registerPreciseProductImportProxyRoute,
    registerPythonProxyRoutes
} from "./proxy/routes.js";

function isPrivateConfigStaticPath(request) {
    // `express.static` correctly prevents filesystem traversal, but the
    // persisted precise-product directory itself must never be a public web
    // asset. Decode a few times so `%2F`/double-encoded separators cannot
    // disguise the first logical path component on Windows or Linux.
    let decodedPath = String(request.path || request.url || "");
    try {
        for (let index = 0; index < 4; index += 1) {
            const next = decodeURIComponent(decodedPath);
            if (next === decodedPath) break;
            decodedPath = next;
        }
    } catch {
        // A malformed encoded path cannot be a legitimate public config
        // asset, and denying it is safer than allowing static fallthrough.
        return true;
    }

    const normalised = path.posix.normalize(`/${decodedPath.replaceAll("\\", "/")}`).toLowerCase();
    return ["/precise-products", "/manual-erp-snapshots"].some((privateRoot) => (
        normalised === privateRoot || normalised.startsWith(`${privateRoot}/`)
    ));
}

export function createOrbitApp({ runtime, config, catalog, importer, refresher, pythonBackend, pythonClient }) {
    const app = express();
    // A compressed SP3/CLK pair can be tens of MiB. Register this bounded
    // parser before the default parser: base64 expansion needs more than
    // 25 MiB, while all unrelated Orbit JSON APIs retain their smaller limit.
    registerPreciseProductImportBodyParser(app);
    registerPreciseProductImportProxyRoute(app, pythonClient);
    registerManualOrbitErpBodyParser(app);
    registerManualOrbitErpPreviewProxyRoute(app, pythonClient);
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

    // Body textures are source assets rather than Vite bundle chunks.  Mount
    // them explicitly before the generated frontend so Cesium receives the
    // exact offline URL used by its material uniforms, even when the React
    // build also owns an `/assets` directory for hashed JavaScript/CSS files.
    app.use("/assets", express.static(path.join(runtime.frontDir, "assets"), {
        index: false,
        fallthrough: true
    }));
    // The product documentation is a prebuilt MkDocs site.  It deliberately
    // lives under `/Orbit/`, leaving `/docs*` available for FastAPI Swagger
    // through the proxy route registered above.
    app.use("/Orbit", express.static(runtime.docsSiteDir, {
        index: "index.html",
        fallthrough: true
    }));
    app.use(express.static(runtime.reactDistDir));
    app.use(express.static(runtime.frontDir));
    // Config keeps public catalogue/UI assets, but precise SP3/CLK uploads
    // and per-manual-orbit ERP snapshots are private runtime data. They are
    // exposed only through their explicit API/proxy contracts, never by the
    // broad static `/config` mount.
    app.use("/config", (request, response, next) => {
        if (isPrivateConfigStaticPath(request)) {
            response.status(404).end();
            return;
        }
        next();
    });
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
