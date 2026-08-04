import express from "express";
import test from "node:test";
import assert from "node:assert/strict";
import { registerCatalogExportRoutes } from "../../src/routes/catalog-exports.js";

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

test("catalog export route returns a download with the requested source format", async () => {
    const app = express();
    registerCatalogExportRoutes(app, {
        catalog: { get: async () => ({ entries: [{ name: "ISS Test", line1: "1 25544U", line2: "2 25544", sourceFormat: "TLE" }] }) }
    });
    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/export/tle/iss%20test`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
        assert.match(response.headers.get("content-disposition"), /ISS_Test\.tle/);
        assert.match(await response.text(), /ISS Test/);
    });
});

test("catalog export route rejects a request for an incompatible source format", async () => {
    const app = express();
    registerCatalogExportRoutes(app, {
        catalog: { get: async () => ({ entries: [{ name: "Imported OMM", line1: "1 25544U", line2: "2 25544", sourceFormat: "OMM" }] }) }
    });
    await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/export/tle/imported%20omm`);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).ok, false);
    });
});
