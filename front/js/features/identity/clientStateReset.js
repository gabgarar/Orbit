/**
 * Synchronises browser-resident Orbit state with the server-owned reset
 * generation.  This deliberately runs before React mounts: clearing an
 * encrypted identity vault while a session or project library is active can
 * otherwise leave the renderer holding stale capabilities.
 *
 * The module is dependency-free and accepts all browser primitives by
 * injection so its reset boundary can be exercised without a browser.
 */

export const CLIENT_STATE_GENERATION_ENDPOINT = "/api/client-state-generation";
export const CLIENT_STATE_GENERATION_SCHEMA = "orbit.client-state-generation";
export const CLIENT_STATE_GENERATION_VERSION = 1;
export const CLIENT_STATE_GENERATION_ACKNOWLEDGED_KEY = "orbit.client-state-generation.ack.v1";
export const INITIAL_CLIENT_STATE_GENERATION = "initial-v1";

// Orbit has historically used both styles for browser preferences.  Keep the
// predicate narrow: unrelated applications sharing an origin must never have
// their browser state removed by a client-state reset.
export const ORBIT_STORAGE_PREFIXES = Object.freeze(["orbit.", "orbit-"]);

// These are the secure-key databases currently used by the local identity
// and administrator registries.  `indexedDB.databases()` augments this list
// when the browser supports discovery, allowing future Orbit databases to be
// reset without broad deletion of other origin data.
export const ORBIT_INDEXED_DB_NAMES = Object.freeze([
    "orbit.identity.selector-keys.v1",
    "orbit.identity.admin-registry-keys.v1",
    // Holds non-extractable, per-installation administrative recovery keys.
    // It is Orbit state too: retaining it after zeroize would leave a stale
    // recovery capability behind even though the encrypted account registry
    // has been erased.
    "orbit.identity.admin-recovery-keys.v1"
]);

const GENERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

export class ClientStateResetError extends Error {
    constructor(code, message, cause = null) {
        super(message);
        this.name = "ClientStateResetError";
        this.code = code;
        if (cause) this.cause = cause;
    }
}

function failure(code, message, cause = null) {
    return new ClientStateResetError(code, message, cause);
}

function browserValue(name) {
    try {
        return globalThis[name];
    } catch {
        return null;
    }
}

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function exactKeys(value, expected) {
    const source = record(value);
    if (!source) return false;
    const keys = Object.keys(source);
    return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

/** Validate the server marker before any persistent browser state is changed. */
export function validateClientStateGenerationMarker(value) {
    if (!exactKeys(value, ["schema", "version", "generation"])
        || value.schema !== CLIENT_STATE_GENERATION_SCHEMA
        || value.version !== CLIENT_STATE_GENERATION_VERSION
        || typeof value.generation !== "string"
        || !GENERATION_PATTERN.test(value.generation)) {
        throw failure(
            "CLIENT_STATE_GENERATION_MALFORMED",
            "El marcador de reinicio de Orbit no tiene un formato válido."
        );
    }
    return Object.freeze({
        schema: CLIENT_STATE_GENERATION_SCHEMA,
        version: CLIENT_STATE_GENERATION_VERSION,
        generation: value.generation
    });
}

function requiredStorage(storage, name, { writable = false } = {}) {
    const available = storage
        && typeof storage.key === "function"
        && typeof storage.removeItem === "function"
        && typeof storage.getItem === "function"
        && (!writable || typeof storage.setItem === "function");
    if (!available) {
        throw failure(
            "CLIENT_STATE_STORAGE_UNAVAILABLE",
            `No se puede acceder al almacenamiento ${name} de Orbit.`
        );
    }
    return storage;
}

function storageKeys(storage, name) {
    let length;
    try {
        length = Number(storage.length);
    } catch (cause) {
        throw failure("CLIENT_STATE_STORAGE_UNAVAILABLE", `No se puede leer el almacenamiento ${name} de Orbit.`, cause);
    }
    if (!Number.isInteger(length) || length < 0) {
        throw failure("CLIENT_STATE_STORAGE_UNAVAILABLE", `El almacenamiento ${name} de Orbit no es válido.`);
    }
    const keys = [];
    try {
        for (let index = 0; index < length; index += 1) {
            const key = storage.key(index);
            if (typeof key === "string") keys.push(key);
        }
    } catch (cause) {
        throw failure("CLIENT_STATE_STORAGE_UNAVAILABLE", `No se puede enumerar el almacenamiento ${name} de Orbit.`, cause);
    }
    return keys;
}

export function isOrbitClientStorageKey(key) {
    return typeof key === "string" && ORBIT_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Remove only Orbit's own entries from a Web Storage area. */
export function clearOrbitStorageNamespace(storage, { name = "local" } = {}) {
    const target = requiredStorage(storage, name);
    const removed = [];
    for (const key of storageKeys(target, name)) {
        if (!isOrbitClientStorageKey(key)) continue;
        try {
            target.removeItem(key);
            removed.push(key);
        } catch (cause) {
            throw failure("CLIENT_STATE_STORAGE_UNAVAILABLE", `No se puede limpiar el almacenamiento ${name} de Orbit.`, cause);
        }
    }
    return Object.freeze(removed);
}

function readAcknowledgedMarker(storage) {
    const target = requiredStorage(storage, "local", { writable: true });
    let raw;
    try {
        raw = target.getItem(CLIENT_STATE_GENERATION_ACKNOWLEDGED_KEY);
    } catch (cause) {
        throw failure("CLIENT_STATE_STORAGE_UNAVAILABLE", "No se puede leer el marcador local de reinicio de Orbit.", cause);
    }
    if (raw === null || raw === undefined || raw === "") return null;
    try {
        return validateClientStateGenerationMarker(JSON.parse(String(raw)));
    } catch {
        // A local acknowledgement is never authoritative.  Treat a stale or
        // corrupted value as unacknowledged and rebuild the Orbit namespace.
        return null;
    }
}

function writeAcknowledgedMarker(storage, marker) {
    const target = requiredStorage(storage, "local", { writable: true });
    try {
        target.setItem(CLIENT_STATE_GENERATION_ACKNOWLEDGED_KEY, JSON.stringify(marker));
    } catch (cause) {
        throw failure("CLIENT_STATE_STORAGE_UNAVAILABLE", "No se puede confirmar el reinicio local de Orbit.", cause);
    }
}

function requestIndexedDbDeletion(indexedDb, name) {
    return new Promise((resolve, reject) => {
        let request;
        try {
            request = indexedDb.deleteDatabase(name);
        } catch (cause) {
            reject(failure("CLIENT_STATE_INDEXED_DB_UNAVAILABLE", "No se puede borrar la base de datos local de Orbit.", cause));
            return;
        }
        if (!request || typeof request !== "object") {
            reject(failure("CLIENT_STATE_INDEXED_DB_UNAVAILABLE", "El navegador no permite borrar la base de datos local de Orbit."));
            return;
        }
        request.onsuccess = () => resolve(name);
        request.onerror = () => reject(failure(
            "CLIENT_STATE_INDEXED_DB_UNAVAILABLE",
            "No se puede borrar la base de datos local de Orbit.",
            request.error || null
        ));
        request.onblocked = () => reject(failure(
            "CLIENT_STATE_INDEXED_DB_BLOCKED",
            "Cierra las demás pestañas de Orbit antes de reiniciar los datos locales.",
            request.error || null
        ));
    });
}

async function orbitIndexedDbNames(indexedDb) {
    if (!indexedDb || typeof indexedDb.deleteDatabase !== "function") {
        throw failure("CLIENT_STATE_INDEXED_DB_UNAVAILABLE", "IndexedDB no está disponible para reiniciar Orbit.");
    }
    const names = new Set(ORBIT_INDEXED_DB_NAMES);
    if (typeof indexedDb.databases !== "function") return [...names].sort();
    let databases;
    try {
        databases = await indexedDb.databases();
    } catch (cause) {
        throw failure("CLIENT_STATE_INDEXED_DB_UNAVAILABLE", "No se pueden enumerar las bases de datos locales de Orbit.", cause);
    }
    if (!Array.isArray(databases)) {
        throw failure("CLIENT_STATE_INDEXED_DB_UNAVAILABLE", "El navegador no ha devuelto las bases de datos locales de Orbit.");
    }
    for (const database of databases) {
        if (isOrbitClientStorageKey(database?.name)) names.add(database.name);
    }
    return [...names].sort();
}

async function clearOrbitIndexedDatabaseNames(indexedDb, names) {
    const removed = [];
    for (const name of names) {
        removed.push(await requestIndexedDbDeletion(indexedDb, name));
    }
    return Object.freeze(removed);
}

/** Fetch and validate the reset marker with a cache-bypassing request. */
export async function fetchClientStateGeneration({
    fetchImpl = browserValue("fetch"),
    endpoint = CLIENT_STATE_GENERATION_ENDPOINT
} = {}) {
    if (typeof fetchImpl !== "function") {
        throw failure("CLIENT_STATE_GENERATION_UNAVAILABLE", "No se puede consultar el marcador de reinicio de Orbit.");
    }
    let response;
    try {
        response = await fetchImpl(endpoint, {
            cache: "no-store",
            credentials: "same-origin",
            headers: { Accept: "application/json" }
        });
    } catch (cause) {
        throw failure("CLIENT_STATE_GENERATION_UNAVAILABLE", "No se puede consultar el marcador de reinicio de Orbit.", cause);
    }
    if (!response || response.ok !== true || typeof response.json !== "function") {
        throw failure("CLIENT_STATE_GENERATION_UNAVAILABLE", "El marcador de reinicio de Orbit no está disponible.");
    }
    let marker;
    try {
        marker = await response.json();
    } catch (cause) {
        throw failure("CLIENT_STATE_GENERATION_MALFORMED", "El marcador de reinicio de Orbit no contiene JSON válido.", cause);
    }
    return validateClientStateGenerationMarker(marker);
}

function acknowledged(marker, current) {
    return marker !== null && marker.generation === current.generation;
}

/**
 * Prepare Orbit's browser state for the server-owned generation.
 *
 * On a new generation every Orbit local/session-storage key and every known
 * Orbit IndexedDB database is removed before the acknowledgement is written.
 * A failure deliberately leaves no acknowledgement behind, so retrying is
 * safe and cannot mount the application against partly trusted state.
 */
export async function synchronizeOrbitClientState({
    fetchImpl = browserValue("fetch"),
    localStorage = browserValue("localStorage"),
    sessionStorage = browserValue("sessionStorage"),
    indexedDb = browserValue("indexedDB"),
    endpoint = CLIENT_STATE_GENERATION_ENDPOINT
} = {}) {
    const marker = await fetchClientStateGeneration({ fetchImpl, endpoint });
    const local = requiredStorage(localStorage, "local", { writable: true });
    const session = requiredStorage(sessionStorage, "de sesión");
    const previous = readAcknowledgedMarker(local);
    if (acknowledged(previous, marker)) {
        return Object.freeze({
            changed: false,
            marker,
            removedLocalStorageKeys: Object.freeze([]),
            removedSessionStorageKeys: Object.freeze([]),
            removedIndexedDbNames: Object.freeze([])
        });
    }

    // An installation that predates the zeroizer has no server marker and no
    // acknowledgement yet. Recording this baseline must not turn a product
    // update into an implicit destructive reset. The PowerShell zeroizer
    // always replaces it with a UUID, which follows the reset path below.
    if (marker.generation === INITIAL_CLIENT_STATE_GENERATION) {
        writeAcknowledgedMarker(local, marker);
        return Object.freeze({
            changed: false,
            marker,
            removedLocalStorageKeys: Object.freeze([]),
            removedSessionStorageKeys: Object.freeze([]),
            removedIndexedDbNames: Object.freeze([])
        });
    }

    // Check that IndexedDB can be reached before removing any browser state.
    // A blocked delete can still occur later because another tab opens the
    // database in the meantime; in that case the missing acknowledgement
    // makes the next retry cleanly resume the reset.
    const indexedDbNames = await orbitIndexedDbNames(indexedDb);

    // The acknowledgement is part of the Orbit namespace, therefore the
    // clear below removes the old value before the new marker is persisted.
    const removedLocalStorageKeys = clearOrbitStorageNamespace(local, { name: "local" });
    const removedSessionStorageKeys = clearOrbitStorageNamespace(session, { name: "de sesión" });
    const removedIndexedDbNames = await clearOrbitIndexedDatabaseNames(indexedDb, indexedDbNames);
    writeAcknowledgedMarker(local, marker);
    return Object.freeze({
        changed: true,
        marker,
        removedLocalStorageKeys,
        removedSessionStorageKeys,
        removedIndexedDbNames
    });
}
