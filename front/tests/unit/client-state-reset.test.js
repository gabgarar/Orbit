import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    CLIENT_STATE_GENERATION_ACKNOWLEDGED_KEY,
    CLIENT_STATE_GENERATION_SCHEMA,
    CLIENT_STATE_GENERATION_VERSION,
    INITIAL_CLIENT_STATE_GENERATION,
    ClientStateResetError,
    ORBIT_INDEXED_DB_NAMES,
    synchronizeOrbitClientState
} from "../../js/features/identity/clientStateReset.js";

function marker(generation = "initial-v1") {
    return {
        schema: CLIENT_STATE_GENERATION_SCHEMA,
        version: CLIENT_STATE_GENERATION_VERSION,
        generation
    };
}

class MemoryStorage {
    constructor(entries = [], events = []) {
        this.values = new Map(entries);
        this.events = events;
    }

    get length() {
        return this.values.size;
    }

    key(index) {
        return [...this.values.keys()][index] ?? null;
    }

    getItem(key) {
        this.events.push(`get:${key}`);
        return this.values.get(key) ?? null;
    }

    setItem(key, value) {
        this.events.push(`set:${key}`);
        this.values.set(key, String(value));
    }

    removeItem(key) {
        this.events.push(`remove:${key}`);
        this.values.delete(key);
    }
}

function successfulResponse(value) {
    return { ok: true, json: async () => value };
}

function indexedDbStub({ discovered = [], events = [], blocked = false } = {}) {
    return {
        async databases() {
            events.push("idb:databases");
            return discovered.map((name) => ({ name }));
        },
        deleteDatabase(name) {
            events.push(`idb:delete:${name}`);
            const request = { error: null };
            queueMicrotask(() => {
                if (blocked) {
                    request.onblocked?.();
                    return;
                }
                request.onsuccess?.();
            });
            return request;
        }
    };
}

function acknowledged(generation) {
    return [CLIENT_STATE_GENERATION_ACKNOWLEDGED_KEY, JSON.stringify(marker(generation))];
}

test("an acknowledged unchanged generation leaves all Orbit client state intact", async () => {
    const events = [];
    const localStorage = new MemoryStorage([acknowledged("generation-a"), ["orbit.identity.vault.v1", "vault"], ["third-party", "keep"]], events);
    const sessionStorage = new MemoryStorage([["orbit.session", "keep"], ["third-party-session", "keep"]], events);
    const indexedDb = indexedDbStub({ events });

    const result = await synchronizeOrbitClientState({
        fetchImpl: async (endpoint, options) => {
            events.push(`fetch:${endpoint}:${options.cache}`);
            return successfulResponse(marker("generation-a"));
        },
        localStorage,
        sessionStorage,
        indexedDb
    });

    assert.equal(result.changed, false);
    assert.equal(localStorage.values.get("orbit.identity.vault.v1"), "vault");
    assert.equal(sessionStorage.values.get("orbit.session"), "keep");
    assert.equal(events.some((event) => event.startsWith("idb:delete:")), false);
    assert.deepEqual(result.removedIndexedDbNames, []);
    assert.equal(events[0], "fetch:/api/client-state-generation:no-store");
});

test("the initial server baseline acknowledges existing installations without deleting their Orbit data", async () => {
    const localStorage = new MemoryStorage([["orbit.identity.vault.v1", "existing-vault"], ["third-party", "keep"]]);
    const sessionStorage = new MemoryStorage([["orbit.session", "existing-session"]]);
    const indexedDb = indexedDbStub();

    const result = await synchronizeOrbitClientState({
        fetchImpl: async () => successfulResponse(marker(INITIAL_CLIENT_STATE_GENERATION)),
        localStorage,
        sessionStorage,
        indexedDb
    });

    assert.equal(result.changed, false);
    assert.equal(localStorage.values.get("orbit.identity.vault.v1"), "existing-vault");
    assert.equal(sessionStorage.values.get("orbit.session"), "existing-session");
    assert.deepEqual(JSON.parse(localStorage.values.get(CLIENT_STATE_GENERATION_ACKNOWLEDGED_KEY)), marker(INITIAL_CLIENT_STATE_GENERATION));
});

test("a new generation wipes only Orbit browser namespaces and acknowledges after IndexedDB deletion", async () => {
    const events = [];
    const localStorage = new MemoryStorage([
        acknowledged("generation-a"),
        ["orbit.identity.vault.v1", "vault"],
        ["orbit-theme", "dark"],
        ["third-party", "keep"]
    ], events);
    const sessionStorage = new MemoryStorage([["orbit.session", "remove"], ["third-party-session", "keep"]], events);
    const indexedDb = indexedDbStub({ discovered: ["orbit.project-cache.v1", "third-party-db"], events });

    const result = await synchronizeOrbitClientState({
        fetchImpl: async () => successfulResponse(marker("generation-b")),
        localStorage,
        sessionStorage,
        indexedDb
    });

    assert.equal(result.changed, true);
    assert.equal(localStorage.values.get("orbit.identity.vault.v1"), undefined);
    assert.equal(localStorage.values.get("orbit-theme"), undefined);
    assert.equal(localStorage.values.get("third-party"), "keep");
    assert.equal(sessionStorage.values.get("orbit.session"), undefined);
    assert.equal(sessionStorage.values.get("third-party-session"), "keep");
    assert.deepEqual(JSON.parse(localStorage.values.get(CLIENT_STATE_GENERATION_ACKNOWLEDGED_KEY)), marker("generation-b"));
    assert.ok(result.removedIndexedDbNames.includes("orbit.project-cache.v1"));
    for (const name of ORBIT_INDEXED_DB_NAMES) assert.ok(result.removedIndexedDbNames.includes(name));
    assert.equal(events.includes("idb:delete:third-party-db"), false);
    const acknowledgementWrite = events.lastIndexOf(`set:${CLIENT_STATE_GENERATION_ACKNOWLEDGED_KEY}`);
    const lastIndexedDbDelete = Math.max(...events.map((event, index) => event.startsWith("idb:delete:") ? index : -1));
    assert.ok(acknowledgementWrite > lastIndexedDbDelete, "the acknowledgement must only be written after all Orbit databases are deleted");
});

test("a generation reset deletes the administrative recovery-key database even when IndexedDB cannot enumerate databases", async () => {
    const events = [];
    const indexedDb = indexedDbStub({ events });
    indexedDb.databases = undefined;

    const result = await synchronizeOrbitClientState({
        fetchImpl: async () => successfulResponse(marker("generation-recovery-keys")),
        localStorage: new MemoryStorage(),
        sessionStorage: new MemoryStorage(),
        indexedDb
    });

    assert.equal(result.changed, true);
    assert.ok(result.removedIndexedDbNames.includes("orbit.identity.admin-recovery-keys.v1"));
    assert.ok(events.includes("idb:delete:orbit.identity.admin-recovery-keys.v1"));
    assert.equal(events.includes("idb:databases"), false);
});

test("an unavailable or malformed server marker fails before local Orbit state is changed", async () => {
    const run = async (fetchImpl, code) => {
        const localStorage = new MemoryStorage([["orbit.identity.vault.v1", "vault"]]);
        const sessionStorage = new MemoryStorage([["orbit.session", "session"]]);
        await assert.rejects(
            () => synchronizeOrbitClientState({ fetchImpl, localStorage, sessionStorage, indexedDb: indexedDbStub() }),
            (error) => error instanceof ClientStateResetError && error.code === code
        );
        assert.equal(localStorage.values.get("orbit.identity.vault.v1"), "vault");
        assert.equal(sessionStorage.values.get("orbit.session"), "session");
    };

    await run(async () => { throw new Error("offline"); }, "CLIENT_STATE_GENERATION_UNAVAILABLE");
    await run(async () => successfulResponse({ ...marker("generation-c"), unexpected: true }), "CLIENT_STATE_GENERATION_MALFORMED");
});

test("a blocked Orbit IndexedDB reset does not acknowledge the new generation", async () => {
    const localStorage = new MemoryStorage([["orbit.identity.vault.v1", "vault"]]);
    await assert.rejects(
        () => synchronizeOrbitClientState({
            fetchImpl: async () => successfulResponse(marker("generation-d")),
            localStorage,
            sessionStorage: new MemoryStorage(),
            indexedDb: indexedDbStub({ blocked: true })
        }),
        (error) => error instanceof ClientStateResetError && error.code === "CLIENT_STATE_INDEXED_DB_BLOCKED"
    );
    assert.equal(localStorage.values.has(CLIENT_STATE_GENERATION_ACKNOWLEDGED_KEY), false);
});

test("the React bootstrap waits for the client-state preflight before creating the App root", () => {
    const main = readFileSync(new URL("../../../react-ui/src/main.jsx", import.meta.url), "utf8");
    const bootMatch = main.match(/async function bootOrbit\(\) \{([\s\S]*?)^\}/mu);
    assert.ok(bootMatch, "Orbit boot function is present");
    const boot = bootMatch[1];
    const preflight = boot.indexOf("await synchronizeOrbitClientState()");
    const render = boot.indexOf("createRoot(rootElement).render(");
    assert.ok(preflight >= 0 && render > preflight, "React must mount only after the preflight resolves");
    assert.match(boot, /catch \(cause\) \{\s*renderClientStateRetry\(rootElement, cause\);/u);
});

test("the Vite development server proxies the same-origin reset endpoint to Orbit", () => {
    const viteConfig = readFileSync(new URL("../../../react-ui/vite.config.js", import.meta.url), "utf8");
    assert.match(viteConfig, /server:\s*\{\s*proxy:\s*\{\s*"\/api":\s*"http:\/\/127\.0\.0\.1:8100"/su);
});
