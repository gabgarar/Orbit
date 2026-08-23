import fs from "node:fs/promises";
import path from "node:path";

export const CLIENT_STATE_GENERATION_FILE = ".orbit-client-state-generation.json";
export const CLIENT_STATE_GENERATION_SCHEMA = "orbit.client-state-generation";
export const CLIENT_STATE_GENERATION_VERSION = 1;

const INITIAL_CLIENT_STATE_GENERATION = Object.freeze({
    schema: CLIENT_STATE_GENERATION_SCHEMA,
    version: CLIENT_STATE_GENERATION_VERSION,
    generation: "initial-v1"
});

// `New-Guid` in the zeroisation helper emits the canonical UUID form below.
// Keeping the persisted token deliberately narrow prevents this endpoint from
// becoming a generic way to reflect arbitrary local file content to clients.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidClientStateGeneration(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort();
    if (keys.length !== 3 || keys.join(",") !== "generation,schema,version") return false;
    return value.schema === CLIENT_STATE_GENERATION_SCHEMA
        && value.version === CLIENT_STATE_GENERATION_VERSION
        && typeof value.generation === "string"
        && UUID_PATTERN.test(value.generation);
}

function unavailable(response) {
    return response.status(503).json({
        ok: false,
        error: "El estado de generacion local no esta disponible."
    });
}

/**
 * Expose the server-managed generation marker used to invalidate browser
 * state after a local zeroisation. The filename is fixed by this server
 * module: no request input is ever converted into a filesystem path.
 */
export function registerClientStateGenerationRoute(app, { dataDir, readFile = fs.readFile } = {}) {
    if (typeof dataDir !== "string" || !dataDir.trim()) {
        throw new TypeError("A runtime dataDir is required for client-state generation.");
    }

    const generationPath = path.join(path.resolve(dataDir), CLIENT_STATE_GENERATION_FILE);

    app.get("/api/client-state-generation", async (_request, response) => {
        response.set("Cache-Control", "no-store");
        response.set("Pragma", "no-cache");

        let raw;
        try {
            raw = await readFile(generationPath, "utf8");
        } catch (error) {
            if (error?.code === "ENOENT") {
                return response.json(INITIAL_CLIENT_STATE_GENERATION);
            }
            return unavailable(response);
        }

        let state;
        try {
            state = JSON.parse(raw);
        } catch {
            return unavailable(response);
        }
        if (!isValidClientStateGeneration(state)) return unavailable(response);
        return response.json(state);
    });
}
