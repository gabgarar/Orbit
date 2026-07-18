import express from "express";
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeSystemConfigPayload } from "../../src/config/payload.js";
import { registerSystemRoutes } from "../../src/routes/system.js";

async function withServer(app, callback) {
    const server = await new Promise((resolve) => {
        const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    try {
        const { port } = server.address();
        return await callback(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
}

function createApp({ getConfig, saveConfig, updateConfig, schedule, reload }) {
    const app = express();
    app.use(express.json());
    registerSystemRoutes(app, {
        getConfig,
        saveConfig,
        updateConfig,
        sanitize: sanitizeSystemConfigPayload,
        onSaved: async () => {
            await schedule();
            return reload();
        }
    });
    return app;
}

test("system-config saves the system settings, preserves current data, and refreshes runtime services", async () => {
    const existing = {
        system: { language: "es" },
        data: { satellites_catalog_file: "catalog.json", decay_alert_perigee_km: 200, catalog_refresh_interval_minutes: 60 },
        revision: 4
    };
    const saved = [];
    let scheduleCalls = 0;
    let reloadCalls = 0;
    const app = createApp({
        getConfig: async () => existing,
        saveConfig: async (config) => saved.push(config),
        schedule: async () => { scheduleCalls += 1; },
        reload: async () => { reloadCalls += 1; }
    });

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/system-config`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                system: { language: "en", theme: "dark" },
                data: { satellites_catalog_file: "catalog.json", decay_alert_perigee_km: 200, catalog_refresh_interval_minutes: 60 }
            })
        });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true });
    });

    assert.deepEqual(saved, [{
        system: { language: "en", theme: "dark" },
        data: existing.data,
        revision: 4
    }]);
    assert.equal(scheduleCalls, 1);
    assert.equal(reloadCalls, 1);
});

test("system-config keeps the active catalog target immutable at runtime", async () => {
    const existing = { system: { language: "es" }, data: { satellites_catalog_file: "catalog.json" } };
    let saveCalls = 0;
    let updateCalls = 0;
    let scheduleCalls = 0;
    let reloadCalls = 0;
    const app = createApp({
        getConfig: async () => existing,
        saveConfig: async () => { saveCalls += 1; },
        updateConfig: async () => { updateCalls += 1; },
        schedule: async () => { scheduleCalls += 1; },
        reload: async () => { reloadCalls += 1; }
    });

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/system-config`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                system: { language: "en" },
                data: { satellites_catalog_file: "missing.json" }
            })
        });

        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), {
            ok: false,
            error: "El archivo de catalogo activo no se puede cambiar mientras Orbit esta en ejecucion."
        });
    });

    assert.equal(saveCalls, 0);
    assert.equal(updateCalls, 0);
    assert.equal(scheduleCalls, 0);
    assert.equal(reloadCalls, 0);
});

test("system-config rejects invalid payloads without saving or refreshing runtime services", async () => {
    let getConfigCalls = 0;
    let saveCalls = 0;
    let updateCalls = 0;
    let scheduleCalls = 0;
    let reloadCalls = 0;
    const app = createApp({
        getConfig: async () => {
            getConfigCalls += 1;
            return { system: {}, data: {} };
        },
        saveConfig: async () => { saveCalls += 1; },
        updateConfig: async () => { updateCalls += 1; },
        schedule: async () => { scheduleCalls += 1; },
        reload: async () => { reloadCalls += 1; }
    });

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/system-config`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ data: { decay_alert_perigee_km: 100 } })
        });

        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { ok: false, error: "Payload invalido." });
    });

    assert.equal(getConfigCalls, 0);
    assert.equal(saveCalls, 0);
    assert.equal(updateCalls, 0);
    assert.equal(scheduleCalls, 0);
    assert.equal(reloadCalls, 0);
});

test("system-config rejects unsafe or reserved catalogue file names", async () => {
    let saveCalls = 0;
    let scheduleCalls = 0;
    let reloadCalls = 0;
    const app = createApp({
        getConfig: async () => ({ system: {}, data: {} }),
        saveConfig: async () => { saveCalls += 1; },
        schedule: async () => { scheduleCalls += 1; },
        reload: async () => { reloadCalls += 1; }
    });

    await withServer(app, async (baseUrl) => {
        for (const satellitesCatalogFile of [
            "../../outside.tle", "system_config.json", "SYSTEM_CONFIG.JSON",
            "system_config.json.", "CON.tle", "catalog:archive.tle"
        ]) {
            const response = await fetch(`${baseUrl}/api/system-config`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    system: { language: "en" },
                    data: { satellites_catalog_file: satellitesCatalogFile }
                })
            });

            assert.equal(response.status, 400);
            assert.deepEqual(await response.json(), { ok: false, error: "Payload invalido." });
        }
    });

    assert.equal(saveCalls, 0);
    assert.equal(scheduleCalls, 0);
    assert.equal(reloadCalls, 0);
});

test("system-config merges through the repository updater when available", async () => {
    const saved = [];
    let getConfigCalls = 0;
    const app = createApp({
        getConfig: async () => {
            getConfigCalls += 1;
            return { system: {}, data: {} };
        },
        saveConfig: async () => { throw new Error("save fallback must not run"); },
        updateConfig: async (mutator) => {
            const next = await mutator({
                system: { language: "es" },
                data: { offline_mode: true, catalog_last_refresh_attempt_at: 42_000 },
                revision: 8
            });
            saved.push(next);
            return next;
        },
        schedule: async () => {},
        reload: async () => {}
    });

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/system-config`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                system: { language: "en" },
                data: { offline_mode: false, catalog_last_refresh_attempt_at: 1 }
            })
        });
        assert.equal(response.status, 200);
    });

    assert.equal(getConfigCalls, 0);
    assert.deepEqual(saved, [{
        system: { language: "en" },
        data: { offline_mode: false, catalog_last_refresh_attempt_at: 42_000 },
        revision: 8
    }]);
});

test("system-config reports a saved configuration when the Python reload is unavailable", async () => {
    let saveCalls = 0;
    let scheduleCalls = 0;
    const app = createApp({
        getConfig: async () => ({ system: {}, data: {} }),
        saveConfig: async () => { saveCalls += 1; },
        schedule: async () => { scheduleCalls += 1; },
        reload: async () => false
    });

    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/system-config`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ system: { language: "en" } })
        });

        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
            ok: false,
            persisted: true,
            error: "La configuracion se guardo, pero el backend de propagacion no pudo recargarse. Reinicia Orbit para aplicar los cambios."
        });
    });

    assert.equal(saveCalls, 1);
    assert.equal(scheduleCalls, 1);
});
