import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCatalogImportService } from "../../src/catalog/import-service.js";
import { createCatalogRefreshService } from "../../src/catalog/refresh-service.js";
import { createCatalogRepository } from "../../src/catalog/repository.js";
import { computeTleChecksum, serializeTleCatalog, serializeTleCatalogJson } from "../../src/catalog/tle.js";

const templateLine1 = "1 48843U 21050D   26197.30124859  .00001521  00000+0  66451-4 0  9996";
const templateLine2 = "2 48843  97.3327 272.6770 0006429 149.2414 210.9202 15.23598987283395";

function lineForNorad(template, noradId) {
    const body = `${template.slice(0, 2)}${String(noradId).padStart(5, "0")}${template.slice(7, 68)}`;
    return `${body}${computeTleChecksum(`${body}0`)}`;
}

async function withTemporaryCatalog(callback) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-catalog-concurrency-"));
    try {
        const catalogPath = path.join(directory, "catalog.json");
        await fs.writeFile(catalogPath, JSON.stringify({ entries: [] }));
        return await callback(catalogPath);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

test("a refresh merges remote entries with an import completed while it was downloading", async () => {
    await withTemporaryCatalog(async (catalogPath) => {
        const catalog = createCatalogRepository({ getCatalogPath: async () => catalogPath });
        const serialize = { text: serializeTleCatalog, json: serializeTleCatalogJson };
        const custom = {
            name: "CUSTOM SATELLITE",
            line1: lineForNorad(templateLine1, 1),
            line2: lineForNorad(templateLine2, 1),
            sourceFormat: "TLE"
        };
        const remote = {
            name: "REMOTE SATELLITE",
            line1: lineForNorad(templateLine1, 2),
            line2: lineForNorad(templateLine2, 2),
            sourceFormat: "TLE"
        };
        let beginDownload;
        let releaseDownload;
        const downloadStarted = new Promise((resolve) => { beginDownload = resolve; });
        const downloaded = new Promise((resolve) => { releaseDownload = resolve; });
        const importer = createCatalogImportService({ catalog, serialize, reloadPython: async () => true });
        const refresher = createCatalogRefreshService({
            catalog,
            config: { get: async () => ({ data: {} }) },
            serialize,
            reloadPython: async () => true,
            defaultGroups: ["test-group"],
            defaultSources: [],
            download: async () => {
                beginDownload();
                return downloaded;
            },
            logger: { log: () => {}, warn: () => {}, error: () => {} }
        });

        const refreshing = refresher.refresh();
        await downloadStarted;
        const imported = await importer.importContent({
            fileName: "custom.tle",
            content: `${custom.name}\n${custom.line1}\n${custom.line2}`
        });
        releaseDownload({ entries: [remote] });
        const refreshed = await refreshing;

        assert.equal(imported.ok, true);
        assert.equal(refreshed.ok, true);
        assert.deepEqual((await catalog.get()).entries.map((entry) => entry.name), ["CUSTOM SATELLITE", "REMOTE SATELLITE"]);
    });
});

test("a replacement import wins over a refresh that started downloading earlier", async () => {
    await withTemporaryCatalog(async (catalogPath) => {
        const catalog = createCatalogRepository({ getCatalogPath: async () => catalogPath });
        const serialize = { text: serializeTleCatalog, json: serializeTleCatalogJson };
        const replacement = {
            name: "REPLACEMENT SATELLITE",
            line1: lineForNorad(templateLine1, 1),
            line2: lineForNorad(templateLine2, 1),
            sourceFormat: "TLE"
        };
        const remote = {
            name: "REMOTE SATELLITE",
            line1: lineForNorad(templateLine1, 2),
            line2: lineForNorad(templateLine2, 2),
            sourceFormat: "TLE"
        };
        let beginDownload;
        let releaseDownload;
        let reloads = 0;
        const downloadStarted = new Promise((resolve) => { beginDownload = resolve; });
        const downloaded = new Promise((resolve) => { releaseDownload = resolve; });
        const importer = createCatalogImportService({
            catalog,
            serialize,
            reloadPython: async () => { reloads += 1; return true; }
        });
        const refresher = createCatalogRefreshService({
            catalog,
            config: { get: async () => ({ data: {} }) },
            serialize,
            reloadPython: async () => { reloads += 1; return true; },
            defaultGroups: ["test-group"],
            defaultSources: [],
            download: async () => {
                beginDownload();
                return downloaded;
            },
            logger: { log: () => {}, warn: () => {}, error: () => {} }
        });

        const refreshing = refresher.refresh();
        await downloadStarted;
        const imported = await importer.importContent({
            fileName: "replacement.tle",
            content: `${replacement.name}\n${replacement.line1}\n${replacement.line2}`,
            merge: false
        });
        releaseDownload({ entries: [remote] });
        const refreshed = await refreshing;

        assert.equal(imported.ok, true);
        assert.equal(imported.merge, false);
        assert.equal(refreshed.ok, false);
        assert.equal(refreshed.status, 409);
        assert.equal(refreshed.superseded, true);
        assert.equal(reloads, 1);
        assert.deepEqual((await catalog.get()).entries.map((entry) => entry.name), ["REPLACEMENT SATELLITE"]);
        assert.deepEqual((await catalog.get()).entries.map((entry) => entry.sourceOrigin), ["CUSTOM"]);
    });
});
