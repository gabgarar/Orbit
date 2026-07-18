import fs from "node:fs/promises";
import path from "node:path";
import { parseTleCatalog } from "./parsers.js";
import { withCatalogMetadata } from "./metadata.js";
import { writeFileAtomically } from "../shared/files.js";

export function createCatalogRepository({ getCatalogPath }) {
    let cache = { path: "", mtimeMs: 0, entries: [] };
    let pendingWrite = Promise.resolve();
    // A full replacement has stronger semantics than a normal merge. Keep a
    // separate version so a remote refresh that began before a replacement
    // cannot write stale data back after its downloads complete.
    let replacementVersion = 0;

    function normalize(entries) {
        return Array.isArray(entries) ? entries.map((entry) => withCatalogMetadata({
            ...entry,
            name: String(entry?.name || "").trim(),
            line1: String(entry?.line1 || "").trim(),
            line2: String(entry?.line2 || "").trim(),
            sourceFormat: entry?.sourceFormat || entry?.format || "TLE"
        })).filter((entry) => entry.name && entry.line1 && entry.line2) : [];
    }

    function parseCatalog(raw, catalogPath) {
        if (path.extname(catalogPath).toLowerCase() !== ".json") {
            return normalize(parseTleCatalog(raw));
        }
        const payload = JSON.parse(raw);
        return normalize(Array.isArray(payload) ? payload : payload?.entries);
    }

    async function read({ force = false } = {}) {
        const catalogPath = await getCatalogPath();
        const stats = await fs.stat(catalogPath);
        if (!force && cache.path === catalogPath && cache.mtimeMs === stats.mtimeMs) return { catalogPath, entries: cache.entries };
        const raw = await fs.readFile(catalogPath, "utf8");
        const entries = parseCatalog(raw, catalogPath);
        cache = { path: catalogPath, mtimeMs: stats.mtimeMs, entries };
        return { catalogPath, entries };
    }

    function queueWrite(operation) {
        const queuedOperation = pendingWrite.then(operation, operation);
        pendingWrite = queuedOperation.catch(() => {});
        return queuedOperation;
    }

    async function writeEntries(catalogPath, entries, serialize) {
        // Reading treats every non-JSON extension as a TLE catalogue, so
        // writing must mirror that rule (not just special-case `.txt`).
        const output = path.extname(catalogPath).toLowerCase() === ".json" ? serialize.json(entries) : serialize.text(entries);
        await writeFileAtomically(catalogPath, output);
        cache = { path: "", mtimeMs: 0, entries: [] };
        return catalogPath;
    }

    async function get() {
        await pendingWrite;
        return read();
    }

    async function replace(entries, serialize) {
        return queueWrite(async () => {
            const catalogPath = await writeEntries(await getCatalogPath(), entries, serialize);
            replacementVersion += 1;
            return catalogPath;
        });
    }

    async function updateEntries(mutator, serialize, expectedReplacementVersion) {
        if (typeof mutator !== "function") throw new TypeError("catalog.update requires a mutator function.");
        return queueWrite(async () => {
            const current = await read({ force: true });
            if (expectedReplacementVersion !== undefined && expectedReplacementVersion !== replacementVersion) {
                return { ...current, changed: false, superseded: true };
            }
            const nextEntries = await mutator(current);
            if (nextEntries === undefined) return { ...current, changed: false };
            if (!Array.isArray(nextEntries)) throw new TypeError("catalog.update mutator must return an entry array.");
            const catalogPath = await writeEntries(current.catalogPath, nextEntries, serialize);
            return { catalogPath, entries: nextEntries, changed: true };
        });
    }

    /**
     * Serialize read-modify-write catalog changes against the latest durable
     * catalog. Returning undefined from the mutator leaves the file intact.
     */
    async function update(mutator, serialize) {
        return updateEntries(mutator, serialize);
    }

    /**
     * Apply an update only when no full replacement completed since the
     * caller began its work. The comparison lives inside the write queue so
     * it cannot race a replacement waiting ahead of it.
     */
    async function updateUnlessReplaced(expectedReplacementVersion, mutator, serialize) {
        if (!Number.isSafeInteger(expectedReplacementVersion) || expectedReplacementVersion < 0) {
            throw new TypeError("catalog.updateUnlessReplaced requires a valid replacement version.");
        }
        return updateEntries(mutator, serialize, expectedReplacementVersion);
    }

    return {
        get,
        replace,
        update,
        getReplacementVersion: () => replacementVersion,
        updateUnlessReplaced,
        invalidate: () => { cache = { path: "", mtimeMs: 0, entries: [] }; }
    };
}
