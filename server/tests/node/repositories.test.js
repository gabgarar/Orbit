import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogRepository } from "../../src/catalog/repository.js";
import { createConfigRepository } from "../../src/config/repository.js";

async function temporaryDirectory(callback) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-node-test-"));
    try {
        return await callback(directory);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

test("config repository normalizes malformed configuration and protects catalog paths", async () => {
    await temporaryDirectory(async (directory) => {
        const repository = createConfigRepository({ configDir: directory });
        assert.deepEqual(await repository.get(), { system: {}, data: { satellites_catalog_file: "catalog.json" } });
        await repository.save({ system: { ui: { theme: "dark" } }, data: { satellites_catalog_file: "../outside.json" } });
        assert.equal(await repository.getCatalogPath(), path.join(directory, "catalog.json"));

        for (const invalidName of [
            ".", "..", "/", "\\", "nested\\..",
            "system_config.json", "SYSTEM_CONFIG.JSON", "system_config.json.",
            "system_config.json ", "CON.tle", "catalog:archive.tle"
        ]) {
            await repository.save({ system: {}, data: { satellites_catalog_file: invalidName } });
            const catalogPath = await repository.getCatalogPath();
            const relative = path.relative(path.resolve(directory), path.resolve(catalogPath));
            assert.equal(catalogPath, path.join(directory, "catalog.json"));
            assert.notEqual(relative, "");
            assert.notEqual(relative, "..");
            assert.equal(relative.startsWith(`..${path.sep}`), false);
            assert.equal(path.isAbsolute(relative), false);
        }

        await repository.save({ system: {}, data: { satellites_catalog_file: "mission.tle" } });
        assert.equal(await repository.getCatalogPath(), path.join(directory, "mission.tle"));
        assert.deepEqual(await fs.readdir(directory), ["system_config.json"]);
    });
});

test("config repository repairs reserved catalog names persisted by older versions", async () => {
    await temporaryDirectory(async (directory) => {
        await fs.writeFile(path.join(directory, "system_config.json"), JSON.stringify({
            system: { language: "es" },
            data: { satellites_catalog_file: "SYSTEM_CONFIG.JSON" }
        }));
        const repository = createConfigRepository({ configDir: directory });

        assert.deepEqual(await repository.get(), {
            system: { language: "es" },
            data: { satellites_catalog_file: "catalog.json" }
        });
        assert.equal(await repository.getCatalogPath(), path.join(directory, "catalog.json"));
    });
});

test("catalog repository invalidates its in-memory cache after replacement", async () => {
    await temporaryDirectory(async (directory) => {
        const catalogPath = path.join(directory, "catalog.json");
        await fs.writeFile(catalogPath, JSON.stringify({ entries: [{ name: "TEST", line1: "1 12345U", line2: "2 12345", sourceFormat: "TLE" }] }));
        const repository = createCatalogRepository({ getCatalogPath: async () => catalogPath });
        assert.equal((await repository.get()).entries[0].name, "TEST");
        await repository.replace([{ name: "NEXT", line1: "1 54321U", line2: "2 54321" }], { text: () => "", json: (entries) => JSON.stringify({ entries }) });
        assert.equal((await repository.get()).entries[0].name, "NEXT");
        assert.deepEqual(await fs.readdir(directory), ["catalog.json"]);
    });
});

test("catalog repository rejects a queued update superseded by a full replacement", async () => {
    await temporaryDirectory(async (directory) => {
        const catalogPath = path.join(directory, "catalog.json");
        const serialize = { text: () => "", json: (entries) => JSON.stringify({ entries }) };
        await fs.writeFile(catalogPath, JSON.stringify({ entries: [{ name: "BASE", line1: "1 00001U", line2: "2 00001" }] }));
        const repository = createCatalogRepository({ getCatalogPath: async () => catalogPath });
        const replacementVersion = repository.getReplacementVersion();

        const replacing = repository.replace([{ name: "REPLACEMENT", line1: "1 00002U", line2: "2 00002" }], serialize);
        const updating = repository.updateUnlessReplaced(
            replacementVersion,
            ({ entries }) => [...entries, { name: "STALE REMOTE", line1: "1 00003U", line2: "2 00003" }],
            serialize
        );
        await replacing;
        const result = await updating;

        assert.equal(result.superseded, true);
        assert.equal(result.changed, false);
        assert.deepEqual((await repository.get()).entries.map((entry) => entry.name), ["REPLACEMENT"]);
    });
});

test("catalog repository writes TLE text for non-JSON catalogue files", async () => {
    await temporaryDirectory(async (directory) => {
        const catalogPath = path.join(directory, "mission.tle");
        const serialize = {
            text: (entries) => entries.map((entry) => `${entry.name}\n${entry.line1}\n${entry.line2}`).join("\n"),
            json: (entries) => JSON.stringify({ entries })
        };
        await fs.writeFile(catalogPath, "BASE\n1 00001U\n2 00001");
        const repository = createCatalogRepository({ getCatalogPath: async () => catalogPath });

        await repository.replace([{ name: "NEXT", line1: "1 00002U", line2: "2 00002" }], serialize);

        assert.match(await fs.readFile(catalogPath, "utf8"), /^NEXT\n1 00002U\n2 00002$/);
        assert.equal((await repository.get()).entries[0].name, "NEXT");
    });
});

test("catalog repository serializes concurrent mutations against the latest catalog", async () => {
    await temporaryDirectory(async (directory) => {
        const catalogPath = path.join(directory, "catalog.json");
        const serialize = { text: () => "", json: (entries) => JSON.stringify({ entries }) };
        await fs.writeFile(catalogPath, JSON.stringify({ entries: [{ name: "BASE", line1: "1 00001U", line2: "2 00001" }] }));
        const repository = createCatalogRepository({ getCatalogPath: async () => catalogPath });

        await Promise.all([
            repository.update(({ entries }) => [...entries, { name: "CUSTOM", line1: "1 00002U", line2: "2 00002" }], serialize),
            repository.update(({ entries }) => [...entries, { name: "REMOTE", line1: "1 00003U", line2: "2 00003" }], serialize)
        ]);

        assert.deepEqual((await repository.get()).entries.map((entry) => entry.name).sort(), ["BASE", "CUSTOM", "REMOTE"]);
    });
});

test("catalog repository recovers its mutation queue after a failed update", async () => {
    await temporaryDirectory(async (directory) => {
        const catalogPath = path.join(directory, "catalog.json");
        const serialize = { text: () => "", json: (entries) => JSON.stringify({ entries }) };
        await fs.writeFile(catalogPath, JSON.stringify({ entries: [] }));
        const repository = createCatalogRepository({ getCatalogPath: async () => catalogPath });

        await assert.rejects(repository.update(() => { throw new Error("invalid catalog update"); }, serialize), /invalid catalog update/);
        await repository.update(() => [{ name: "RECOVERED", line1: "1 00001U", line2: "2 00001" }], serialize);

        assert.equal((await repository.get()).entries[0].name, "RECOVERED");
    });
});

test("config repository serializes updates against the latest persisted state", async () => {
    await temporaryDirectory(async (directory) => {
        const repository = createConfigRepository({ configDir: directory });

        await Promise.all([
            repository.update((current) => ({
                ...current,
                system: { ...current.system, language: "es" }
            })),
            repository.update((current) => ({
                ...current,
                data: { ...current.data, offline_mode: true }
            }))
        ]);

        assert.deepEqual(await repository.get(), {
            system: { language: "es" },
            data: { satellites_catalog_file: "catalog.json", offline_mode: true }
        });
    });
});

test("config repository recovers its update queue after a failed mutation", async () => {
    await temporaryDirectory(async (directory) => {
        const repository = createConfigRepository({ configDir: directory });
        await assert.rejects(repository.update(() => { throw new Error("invalid update"); }), /invalid update/);

        await repository.update((current) => ({
            ...current,
            system: { language: "en" }
        }));

        assert.deepEqual(await repository.get(), {
            system: { language: "en" },
            data: { satellites_catalog_file: "catalog.json" }
        });
    });
});

test("config repository returns the normalized configuration from updates", async () => {
    await temporaryDirectory(async (directory) => {
        const repository = createConfigRepository({ configDir: directory });
        const saved = await repository.update((current) => ({
            ...current,
            data: { ...current.data, satellites_catalog_file: "system_config.json" }
        }));

        assert.equal(saved.data.satellites_catalog_file, "catalog.json");
        assert.deepEqual(saved, await repository.get());
    });
});
