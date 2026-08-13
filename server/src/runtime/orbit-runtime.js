import { createOrbitApp } from "../app.js";
import { createCatalogImportService } from "../catalog/import-service.js";
import { createCatalogRefreshService } from "../catalog/refresh-service.js";
import { createCatalogRepository } from "../catalog/repository.js";
import { serializeTleCatalog, serializeTleCatalogJson } from "../catalog/tle.js";
import { createConfigRepository } from "../config/repository.js";
import { createPythonClient } from "../proxy/client.js";
import { createPythonBackend } from "./python-backend.js";
import { startHttpServer } from "./http-server.js";
import { getRuntimeSettings } from "./settings.js";

const defaults = Object.freeze({
    getRuntimeSettings,
    createConfigRepository,
    createCatalogRepository,
    createPythonClient,
    createPythonBackend,
    createCatalogRefreshService,
    createCatalogImportService,
    createOrbitApp,
    startHttpServer
});

export function createOrbitRuntime({ serverDir, environment, logger = console, services = {} }) {
    const factory = { ...defaults, ...services };
    const settings = factory.getRuntimeSettings({ serverDir, environment });
    const config = factory.createConfigRepository({ configDir: settings.configDir });
    const catalog = factory.createCatalogRepository({ getCatalogPath: config.getCatalogPath });
    const pythonClient = factory.createPythonClient(settings.pythonBackendUrl);
    const pythonBackend = factory.createPythonBackend({
        client: pythonClient,
        pythonDir: settings.pythonDir,
        backendUrl: settings.pythonBackendUrl,
        startupTimeoutMs: settings.pythonStartupTimeoutMs,
        logger
    });
    const serialize = { text: serializeTleCatalog, json: serializeTleCatalogJson };
    const refresher = factory.createCatalogRefreshService({ catalog, config, serialize, reloadPython: pythonBackend.reload, logger });
    const importer = factory.createCatalogImportService({ catalog, serialize, reloadPython: pythonBackend.reload });
    const app = factory.createOrbitApp({ settings, runtime: settings, config, catalog, importer, refresher, pythonBackend, pythonClient });
    let httpServer = null;
    let starting = null;
    let stopping = null;
    let pythonReady = false;
    let refreshScheduled = false;

    async function stopRefreshScheduler() {
        if (refreshScheduled) {
            refreshScheduled = false;
            try {
                await refresher.stop();
            } catch (error) {
                logger.warn("Unable to stop catalog refresh scheduler cleanly:", error);
            }
        }
    }

    async function stopPythonBackend(signal) {
        if (pythonReady) {
            pythonReady = false;
            try {
                await pythonBackend.stop(signal);
            } catch (error) {
                logger.warn("Unable to stop Python backend cleanly:", error);
            }
        }
    }

    async function start() {
        if (stopping) await stopping;
        if (httpServer) return app;
        if (starting) return starting;

        starting = (async () => {
            try {
                await pythonBackend.ensureStarted();
                pythonReady = true;
                await refresher.schedule();
                refreshScheduled = true;
                httpServer = await factory.startHttpServer({
                    app,
                    port: settings.port,
                    pythonBackendUrl: settings.pythonBackendUrl,
                    logger
                });
                return app;
            } catch (error) {
                await stopRefreshScheduler();
                await stopPythonBackend("SIGTERM");
                throw error;
            }
        })();
        try {
            return await starting;
        } finally {
            starting = null;
        }
    }

    async function stop(signal = "SIGTERM") {
        if (stopping) return stopping;
        stopping = (async () => {
            try {
                await starting;
            } catch {
                // Startup errors are returned to the caller that initiated startup.
            }
            await stopRefreshScheduler();
            const server = httpServer;
            httpServer = null;
            if (server) {
                try {
                    await server.close();
                } catch (error) {
                    logger.warn("Unable to close HTTP server cleanly:", error);
                }
            }
            await stopPythonBackend(signal);
        })();
        try {
            return await stopping;
        } finally {
            stopping = null;
        }
    }

    return { app, settings, start, stop };
}
