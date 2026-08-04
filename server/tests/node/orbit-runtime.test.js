import test from "node:test";
import assert from "node:assert/strict";
import { createOrbitRuntime } from "../../src/runtime/orbit-runtime.js";

test("runtime starts dependencies in order and stops them only once", async () => {
    const calls = [];
    const config = { getCatalogPath: async () => "catalog.json" };
    const catalog = {};
    const pythonBackend = {
        ensureStarted: async () => calls.push("python:start"),
        reload: async () => true,
        stop: (signal) => calls.push(`python:stop:${signal}`)
    };
    const refresher = { schedule: async () => calls.push("refresh:schedule"), stop: () => calls.push("refresh:stop") };
    const runtime = createOrbitRuntime({
        serverDir: "/app/server",
        logger: { log: () => {}, warn: () => {} },
        services: {
            getRuntimeSettings: () => ({ port: 8100, configDir: "/app/config", pythonDir: "/app/server/python", pythonBackendUrl: "http://python" }),
            createConfigRepository: () => config,
            createCatalogRepository: () => catalog,
            createPythonClient: () => ({}),
            createPythonBackend: () => pythonBackend,
            createCatalogRefreshService: () => refresher,
            createCatalogImportService: () => ({}),
            createOrbitApp: () => ({ name: "app" }),
            startHttpServer: async ({ app, port, pythonBackendUrl }) => {
                assert.deepEqual(app, { name: "app" });
                assert.equal(port, 8100);
                assert.equal(pythonBackendUrl, "http://python");
                calls.push("http:start");
                return { close: async () => calls.push("http:close") };
            }
        }
    });
    const startedApps = await Promise.all([runtime.start(), runtime.start()]);
    assert.deepEqual(startedApps, [{ name: "app" }, { name: "app" }]);
    await Promise.all([runtime.stop("SIGTERM"), runtime.stop("SIGINT")]);
    assert.deepEqual(calls, ["python:start", "refresh:schedule", "http:start", "refresh:stop", "http:close", "python:stop:SIGTERM"]);
});

test("runtime shutdown waits for an in-flight startup before closing dependencies", async () => {
    const calls = [];
    let allowPythonStartup;
    const pythonStartup = new Promise((resolve) => { allowPythonStartup = resolve; });
    const runtime = createOrbitRuntime({
        serverDir: "/app/server",
        logger: { log: () => {}, warn: () => {} },
        services: {
            getRuntimeSettings: () => ({ port: 8100, configDir: "/app/config", pythonDir: "/app/server/python", pythonBackendUrl: "http://python" }),
            createConfigRepository: () => ({ getCatalogPath: async () => "catalog.json" }),
            createCatalogRepository: () => ({}),
            createPythonClient: () => ({}),
            createPythonBackend: () => ({
                ensureStarted: async () => {
                    calls.push("python:start");
                    await pythonStartup;
                },
                reload: async () => true,
                stop: () => calls.push("python:stop")
            }),
            createCatalogRefreshService: () => ({
                schedule: async () => calls.push("refresh:schedule"),
                stop: () => calls.push("refresh:stop")
            }),
            createCatalogImportService: () => ({}),
            createOrbitApp: () => ({ name: "app" }),
            startHttpServer: async () => {
                calls.push("http:start");
                return { close: async () => calls.push("http:close") };
            }
        }
    });

    const startup = runtime.start();
    const shutdown = runtime.stop();
    allowPythonStartup();
    await Promise.all([startup, shutdown]);

    assert.deepEqual(calls, ["python:start", "refresh:schedule", "http:start", "refresh:stop", "http:close", "python:stop"]);
});

test("runtime waits for an active catalog refresh to stop before stopping Python", async () => {
    const calls = [];
    let releaseRefresh;
    const refreshStopped = new Promise((resolve) => { releaseRefresh = resolve; });
    const runtime = createOrbitRuntime({
        serverDir: "/app/server",
        logger: { log: () => {}, warn: () => {} },
        services: {
            getRuntimeSettings: () => ({ port: 8100, configDir: "/app/config", pythonDir: "/app/server/python", pythonBackendUrl: "http://python" }),
            createConfigRepository: () => ({ getCatalogPath: async () => "catalog.json" }),
            createCatalogRepository: () => ({}),
            createPythonClient: () => ({}),
            createPythonBackend: () => ({
                ensureStarted: async () => calls.push("python:start"),
                reload: async () => true,
                stop: () => calls.push("python:stop")
            }),
            createCatalogRefreshService: () => ({
                schedule: async () => calls.push("refresh:schedule"),
                stop: async () => {
                    calls.push("refresh:stop");
                    await refreshStopped;
                    calls.push("refresh:stopped");
                }
            }),
            createCatalogImportService: () => ({}),
            createOrbitApp: () => ({ name: "app" }),
            startHttpServer: async () => ({ close: async () => calls.push("http:close") })
        }
    });

    await runtime.start();
    const stopping = runtime.stop();
    await Promise.resolve();
    assert.deepEqual(calls, ["python:start", "refresh:schedule", "refresh:stop"]);

    releaseRefresh();
    await stopping;
    assert.deepEqual(calls, ["python:start", "refresh:schedule", "refresh:stop", "refresh:stopped", "http:close", "python:stop"]);
});

test("runtime rolls back started dependencies when the HTTP server cannot start", async () => {
    const calls = [];
    const runtime = createOrbitRuntime({
        serverDir: "/app/server",
        logger: { log: () => {}, warn: () => {} },
        services: {
            getRuntimeSettings: () => ({ port: 8100, configDir: "/app/config", pythonDir: "/app/server/python", pythonBackendUrl: "http://python" }),
            createConfigRepository: () => ({ getCatalogPath: async () => "catalog.json" }),
            createCatalogRepository: () => ({}),
            createPythonClient: () => ({}),
            createPythonBackend: () => ({
                ensureStarted: async () => calls.push("python:start"),
                reload: async () => true,
                stop: (signal) => calls.push(`python:stop:${signal}`)
            }),
            createCatalogRefreshService: () => ({
                schedule: async () => calls.push("refresh:schedule"),
                stop: () => calls.push("refresh:stop")
            }),
            createCatalogImportService: () => ({}),
            createOrbitApp: () => ({ name: "app" }),
            startHttpServer: async () => {
                calls.push("http:start");
                throw new Error("address already in use");
            }
        }
    });

    await assert.rejects(runtime.start(), /address already in use/);
    await runtime.stop();

    assert.deepEqual(calls, ["python:start", "refresh:schedule", "http:start", "refresh:stop", "python:stop:SIGTERM"]);
});
