import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalogRepository } from "../src/catalog/repository.js";
import { sanitizeCatalogFileName } from "../src/config/catalog-file.js";

const scriptPath = fileURLToPath(import.meta.url);
const defaultConfigDirectory = path.resolve(path.dirname(scriptPath), "../../config");

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ensure(condition, message) {
    if (!condition) throw new Error(message);
}

function resolveCatalogPath(configDirectory, fileName) {
    const catalogPath = path.resolve(configDirectory, fileName);
    const relative = path.relative(configDirectory, catalogPath);
    ensure(relative && !path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== "..", "El catalogo activo debe permanecer dentro de config/.");
    return catalogPath;
}

async function validateCatalogFile(configDirectory, catalogPath, catalogFileName) {
    let realConfigDirectory;
    let realCatalogPath;
    let catalogStats;
    try {
        [realConfigDirectory, realCatalogPath, catalogStats] = await Promise.all([
            fs.realpath(configDirectory),
            fs.realpath(catalogPath),
            fs.stat(catalogPath)
        ]);
    } catch (error) {
        throw new Error(`No se encontro el catalogo activo ${catalogFileName}: ${error.message}`);
    }

    const relative = path.relative(realConfigDirectory, realCatalogPath);
    ensure(relative && !path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== "..", "El catalogo activo debe permanecer dentro de config/ incluso tras resolver enlaces.");
    ensure(catalogStats.isFile(), `El catalogo activo ${catalogFileName} debe ser un archivo regular.`);
}

/**
 * Validate the configuration baked into a Docker image before it can become a
 * runnable layer. Runtime repositories intentionally repair legacy files; an
 * image build should instead fail early when its packaged source is malformed.
 */
export async function validateImageConfig({ configDir = defaultConfigDirectory } = {}) {
    const configDirectory = path.resolve(configDir);
    const configPath = path.join(configDirectory, "system_config.json");
    let config;

    try {
        config = JSON.parse(await fs.readFile(configPath, "utf8"));
    } catch (error) {
        throw new Error(`No se pudo leer JSON valido de ${configPath}: ${error.message}`);
    }

    ensure(isPlainObject(config), "system_config.json debe contener un objeto JSON.");
    ensure(isPlainObject(config.system), "system_config.json debe contener un objeto system.");
    ensure(isPlainObject(config.data), "system_config.json debe contener un objeto data.");

    const configuredFileName = config.data.satellites_catalog_file;
    const catalogFileName = sanitizeCatalogFileName(configuredFileName);
    ensure(
        typeof configuredFileName === "string" && catalogFileName === configuredFileName,
        "data.satellites_catalog_file debe ser un nombre de archivo de catalogo seguro y normalizado."
    );

    const catalogPath = resolveCatalogPath(configDirectory, catalogFileName);
    await validateCatalogFile(configDirectory, catalogPath, catalogFileName);

    let entries;
    try {
        const repository = createCatalogRepository({ getCatalogPath: async () => catalogPath });
        ({ entries } = await repository.get());
    } catch (error) {
        throw new Error(`No se pudo analizar el catalogo activo ${catalogFileName}: ${error.message}`);
    }
    ensure(Array.isArray(entries) && entries.length > 0, `El catalogo activo ${catalogFileName} no contiene entradas validas.`);

    return { configPath, catalogPath, entries: entries.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
    validateImageConfig()
        .then(({ catalogPath, entries }) => {
            console.log(`Validated packaged Orbit config: ${entries} catalog entries in ${catalogPath}`);
        })
        .catch((error) => {
            console.error(`Invalid packaged Orbit config: ${error.message}`);
            process.exitCode = 1;
        });
}
