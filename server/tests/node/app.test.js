import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createOrbitApp } from "../../src/app.js";

function dependencies(isHealthy, overrides = {}) {
    return {
        runtime: { reactDistDir: ".", frontDir: path.resolve("..", "front"), configDir: "." },
        config: { get: async () => ({ system: {}, data: {} }), save: async () => {} },
        catalog: { get: async () => ({ entries: [] }) },
        importer: { importContent: async () => ({ ok: true }) },
        refresher: { refresh: async () => ({ ok: true }), schedule: async () => {} },
        pythonBackend: { isHealthy, reload: async () => true },
        pythonClient: { request: async () => new Response("{}", { status: 200 }) },
        ...overrides
    };
}

async function withApp(app, callback) {
    const server = await new Promise((resolve) => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    try {
        const address = server.address();
        return await callback(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
}

test("health endpoint reflects Python backend readiness", async () => {
    const readyApp = createOrbitApp(dependencies(async () => true));
    await withApp(readyApp, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: "ok", python_backend: "ok" });
    });

    const waitingApp = createOrbitApp(dependencies(async () => false));
    await withApp(waitingApp, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { status: "starting", python_backend: "unavailable" });
    });

    const unavailableApp = createOrbitApp(dependencies(async () => { throw new Error("connection refused"); }));
    await withApp(unavailableApp, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { status: "starting", python_backend: "unavailable" });
    });
});

test("invalid JSON payloads use the API error contract without mutating configuration", async () => {
    let readCalls = 0;
    let saveCalls = 0;
    let scheduleCalls = 0;
    let reloadCalls = 0;
    const app = createOrbitApp(dependencies(async () => true, {
        config: {
            get: async () => {
                readCalls += 1;
                return { system: {}, data: {} };
            },
            save: async () => { saveCalls += 1; }
        },
        refresher: {
            refresh: async () => ({ ok: true }),
            schedule: async () => { scheduleCalls += 1; }
        },
        pythonBackend: {
            isHealthy: async () => true,
            reload: async () => { reloadCalls += 1; }
        }
    }));

    await withApp(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/system-config`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"system":'
        });
        assert.equal(response.status, 400);
        assert.match(response.headers.get("content-type"), /^application\/json/);
        assert.deepEqual(await response.json(), { ok: false, error: "Payload JSON invalido." });
    });

    assert.equal(readCalls, 0);
    assert.equal(saveCalls, 0);
    assert.equal(scheduleCalls, 0);
    assert.equal(reloadCalls, 0);
});
