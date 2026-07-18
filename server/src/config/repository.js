import fs from "node:fs/promises";
import path from "node:path";
import { normalizeCatalogFileName } from "./catalog-file.js";
import { isPlainObject } from "./payload.js";
import { writeFileAtomically } from "../shared/files.js";

function normalizeConfig(payload, fallback) {
    if (!isPlainObject(payload)) return fallback();
    const fallbackConfig = fallback();
    const data = isPlainObject(payload.data) ? payload.data : fallbackConfig.data;
    return {
        ...payload,
        system: isPlainObject(payload.system) ? payload.system : {},
        data: {
            ...data,
            satellites_catalog_file: normalizeCatalogFileName(
                data.satellites_catalog_file,
                fallbackConfig.data.satellites_catalog_file
            )
        }
    };
}

export function createConfigRepository({ configDir, defaultCatalogFile = "catalog.json" }) {
    const configPath = path.join(configDir, "system_config.json");
    const safeDefaultCatalogFile = normalizeCatalogFileName(defaultCatalogFile);
    const fallback = () => ({ system: {}, data: { satellites_catalog_file: safeDefaultCatalogFile } });
    let pendingWrite = Promise.resolve();

    async function read() {
        try {
            return normalizeConfig(JSON.parse(await fs.readFile(configPath, "utf8")), fallback);
        } catch {
            return fallback();
        }
    }

    function queueWrite(operation) {
        const queuedOperation = pendingWrite.then(operation, operation);
        pendingWrite = queuedOperation.catch(() => {});
        return queuedOperation;
    }

    async function write(payload) {
        const normalized = normalizeConfig(payload, fallback);
        await writeFileAtomically(configPath, `${JSON.stringify(normalized, null, 2)}\n`);
        return normalized;
    }

    async function get() {
        await pendingWrite;
        return read();
    }

    async function save(payload) {
        return queueWrite(() => write(payload));
    }

    async function update(mutator) {
        if (typeof mutator !== "function") throw new TypeError("config.update requires a mutator function.");
        return queueWrite(async () => {
            const next = await mutator(await read());
            if (!isPlainObject(next)) throw new TypeError("config.update mutator must return a configuration object.");
            return write(next);
        });
    }

    async function getCatalogPath() {
        const config = await get();
        const fileName = normalizeCatalogFileName(config.data?.satellites_catalog_file, safeDefaultCatalogFile);
        return path.join(configDir, fileName);
    }

    return { path: configPath, get, save, update, getCatalogPath };
}
