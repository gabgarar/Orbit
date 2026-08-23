import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    CLIENT_STATE_GENERATION_FILE,
    CLIENT_STATE_GENERATION_SCHEMA,
    registerClientStateGenerationRoute
} from "../../src/routes/client-state-generation.js";

const validState = Object.freeze({
    schema: CLIENT_STATE_GENERATION_SCHEMA,
    version: 1,
    generation: "8ea4e1f7-4d4a-4f3d-9aa4-9869a21d8b2e"
});

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

async function withDataDirectory(callback) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-client-state-generation-"));
    try {
        return await callback(directory);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

function createApp(dataDir, overrides = {}) {
    const app = express();
    registerClientStateGenerationRoute(app, { dataDir, ...overrides });
    return app;
}

function assertNoStoreHeaders(response) {
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
}

test("client-state generation returns the stable initial marker while its file is absent", async () => {
    await withDataDirectory(async (dataDir) => {
        await withServer(createApp(dataDir), async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/client-state-generation`);
            assert.equal(response.status, 200);
            assertNoStoreHeaders(response);
            assert.deepEqual(await response.json(), {
                schema: CLIENT_STATE_GENERATION_SCHEMA,
                version: 1,
                generation: "initial-v1"
            });
        });
    });
});

test("client-state generation reads only the fixed runtime data marker", async () => {
    await withDataDirectory(async (dataDir) => {
        await fs.writeFile(
            path.join(dataDir, CLIENT_STATE_GENERATION_FILE),
            JSON.stringify(validState)
        );
        await fs.writeFile(path.join(dataDir, "other-generation.json"), JSON.stringify({ generation: "wrong" }));

        await withServer(createApp(dataDir), async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/client-state-generation?file=other-generation.json`);
            assert.equal(response.status, 200);
            assertNoStoreHeaders(response);
            assert.deepEqual(await response.json(), validState);
        });
    });
});

test("client-state generation rejects malformed or unsupported persisted state", async () => {
    const malformedStates = [
        "{",
        JSON.stringify({ schema: CLIENT_STATE_GENERATION_SCHEMA, version: 1 }),
        JSON.stringify({ schema: CLIENT_STATE_GENERATION_SCHEMA, version: 2, generation: validState.generation }),
        JSON.stringify({ schema: CLIENT_STATE_GENERATION_SCHEMA, version: 1, generation: "initial-v1" }),
        JSON.stringify({ schema: CLIENT_STATE_GENERATION_SCHEMA, version: 1, generation: validState.generation, extra: true })
    ];

    await withDataDirectory(async (dataDir) => {
        const markerPath = path.join(dataDir, CLIENT_STATE_GENERATION_FILE);
        await withServer(createApp(dataDir), async (baseUrl) => {
            for (const raw of malformedStates) {
                await fs.writeFile(markerPath, raw);
                const response = await fetch(`${baseUrl}/api/client-state-generation`);
                assert.equal(response.status, 503, raw);
                assertNoStoreHeaders(response);
                assert.deepEqual(await response.json(), {
                    ok: false,
                    error: "El estado de generacion local no esta disponible."
                });
            }
        });
    });
});

test("client-state generation converts unreadable marker errors into a no-store 503", async () => {
    const dataDir = path.join(os.tmpdir(), "unused-orbit-client-state-generation");
    const readFile = async () => {
        const error = new Error("access denied");
        error.code = "EACCES";
        throw error;
    };
    await withServer(createApp(dataDir, { readFile }), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/client-state-generation`);
        assert.equal(response.status, 503);
        assertNoStoreHeaders(response);
        assert.deepEqual(await response.json(), {
            ok: false,
            error: "El estado de generacion local no esta disponible."
        });
    });
});
