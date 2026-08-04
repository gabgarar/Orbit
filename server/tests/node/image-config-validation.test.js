import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateImageConfig } from "../../scripts/validate-image-config.js";

async function withConfigDirectory(files, callback) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-image-config-"));
    try {
        await Promise.all(Object.entries(files).map(([fileName, content]) => fs.writeFile(path.join(directory, fileName), content)));
        return await callback(directory);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

function systemConfig(catalogFileName = "catalog.json") {
    return JSON.stringify({ system: {}, data: { satellites_catalog_file: catalogFileName } });
}

const validCatalog = JSON.stringify({
    entries: [{ name: "PACKAGED TEST", line1: "1 00001U", line2: "2 00001", sourceFormat: "TLE" }]
});

test("packaged image validation accepts a complete JSON configuration and catalog", async () => {
    await withConfigDirectory({ "system_config.json": systemConfig(), "catalog.json": validCatalog }, async (configDir) => {
        const result = await validateImageConfig({ configDir });

        assert.equal(result.entries, 1);
        assert.equal(result.catalogPath, path.join(configDir, "catalog.json"));
    });
});

test("packaged image validation rejects malformed system configuration JSON", async () => {
    await withConfigDirectory({ "system_config.json": "{", "catalog.json": validCatalog }, async (configDir) => {
        await assert.rejects(validateImageConfig({ configDir }), /JSON valido/);
    });
});

test("packaged image validation rejects unsafe active catalog file names", async () => {
    await withConfigDirectory({ "system_config.json": systemConfig("../outside.json"), "catalog.json": validCatalog }, async (configDir) => {
        await assert.rejects(validateImageConfig({ configDir }), /nombre de archivo de catalogo seguro/);
    });
});

test("packaged image validation rejects missing, invalid, and empty active catalogs", async () => {
    await withConfigDirectory({ "system_config.json": systemConfig() }, async (configDir) => {
        await assert.rejects(validateImageConfig({ configDir }), /No se encontro el catalogo activo/);
    });
    await withConfigDirectory({ "system_config.json": systemConfig(), "catalog.json": "{" }, async (configDir) => {
        await assert.rejects(validateImageConfig({ configDir }), /No se pudo analizar el catalogo activo/);
    });
    await withConfigDirectory({ "system_config.json": systemConfig(), "catalog.json": JSON.stringify({ entries: [] }) }, async (configDir) => {
        await assert.rejects(validateImageConfig({ configDir }), /no contiene entradas validas/);
    });
});

test("packaged image validation parses a non-JSON active TLE catalog", async () => {
    await withConfigDirectory({
        "system_config.json": systemConfig("mission.tle"),
        "mission.tle": "PACKAGED TEST\n1 00001U\n2 00001"
    }, async (configDir) => {
        const result = await validateImageConfig({ configDir });
        assert.equal(result.entries, 1);
    });
});
