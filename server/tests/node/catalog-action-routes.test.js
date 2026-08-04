import express from "express";
import test from "node:test";
import assert from "node:assert/strict";
import { registerCatalogActionRoutes } from "../../src/routes/catalog-actions.js";

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

function createApp(overrides = {}) {
    const app = express();
    app.use(express.json());
    registerCatalogActionRoutes(app, {
        catalog: { get: async () => ({ entries: [{ name: "ISS Test", line1: "1 25544U", line2: "2 25544" }] }) },
        importCatalog: async () => ({ ok: true, total: 1 }),
        refreshCatalog: async () => ({ ok: true }),
        ...overrides
    });
    return app;
}

test("catalog action routes forward refresh and import inputs", async () => {
    let refreshOptions;
    let importOptions;
    const app = createApp({
        refreshCatalog: async (options) => {
            refreshOptions = options;
            return { ok: true, writtenEntries: 2 };
        },
        importCatalog: async (options) => {
            importOptions = options;
            return { ok: true, total: 3 };
        }
    });

    await withServer(app, async (baseUrl) => {
        const refreshResponse = await fetch(`${baseUrl}/api/catalog/refresh?discover=true`, { method: "POST" });
        assert.equal(refreshResponse.status, 200);
        assert.deepEqual(await refreshResponse.json(), { ok: true, writtenEntries: 2 });

        const importResponse = await fetch(`${baseUrl}/api/catalog/import`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ fileName: "sample.tle", content: "contents", merge: false })
        });
        assert.equal(importResponse.status, 200);
        assert.deepEqual(await importResponse.json(), { ok: true, total: 3 });
    });

    assert.deepEqual(refreshOptions, { discover: true });
    assert.deepEqual(importOptions, { fileName: "sample.tle", content: "contents", merge: false });
});

test("catalog action routes preserve service failures and thrown errors", async () => {
    const app = createApp({
        refreshCatalog: async () => ({ ok: false, status: 429, error: "Demasiadas solicitudes" }),
        importCatalog: async () => {
            throw new Error("Importacion no disponible");
        }
    });

    await withServer(app, async (baseUrl) => {
        const refreshResponse = await fetch(`${baseUrl}/api/catalog/refresh`, { method: "POST" });
        assert.equal(refreshResponse.status, 429);
        assert.equal((await refreshResponse.json()).error, "Demasiadas solicitudes");

        const importResponse = await fetch(`${baseUrl}/api/catalog/import`, { method: "POST" });
        assert.equal(importResponse.status, 500);
        assert.equal((await importResponse.json()).error, "Importacion no disponible");
    });
});

test("catalog TLE lookup is case insensitive and validates its name", async () => {
    let getCalls = 0;
    const app = createApp({
        catalog: {
            get: async () => {
                getCalls += 1;
                return { entries: [{ name: "ISS Test", line1: "1 25544U", line2: "2 25544" }] };
            }
        }
    });

    await withServer(app, async (baseUrl) => {
        const missingName = await fetch(`${baseUrl}/api/catalog/tle`);
        assert.equal(missingName.status, 400);
        assert.equal(getCalls, 0);

        const found = await fetch(`${baseUrl}/api/catalog/tle?name=iss%20test`);
        assert.equal(found.status, 200);
        assert.equal((await found.json()).item.name, "ISS Test");

        const missing = await fetch(`${baseUrl}/api/catalog/tle?name=unknown`);
        assert.equal(missing.status, 404);
    });
});
