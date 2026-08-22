/**
 * Local-only encrypted identity storage.
 *
 * The browser never receives a server-side key: every local account is
 * encrypted with a key derived from that account's password through PBKDF2,
 * then AES-GCM authenticates its private JSON.  The small outer index keeps
 * only opaque account ids and selectors keyed by a per-installation
 * non-extractable HMAC key.  Names, profiles and provider credentials stay
 * inside the ciphertext.
 *
 * This module deliberately has no fetch, telemetry, or backend dependency.
 */

export const IDENTITY_VAULT_STORAGE_KEY = "orbit.identity.vault.v1";
export const IDENTITY_VAULT_SCHEMA = "orbit.identity.local-vault-index";
export const IDENTITY_ACCOUNT_VAULT_SCHEMA = "orbit.identity.account-vault";
export const IDENTITY_SEALED_DATA_SCHEMA = "orbit.identity.sealed-data";
export const IDENTITY_PROVIDER_TOKEN_SCHEMA = "orbit.identity.provider-token-envelope";
export const IDENTITY_VAULT_VERSION = 1;
export const IDENTITY_VAULT_INDEX_VERSION = 2;
export const LEGACY_IDENTITY_VAULT_INDEX_VERSION = 1;
export const IDENTITY_LEGACY_SELECTOR_ALGORITHM = "SHA-256";
export const IDENTITY_KEYED_SELECTOR_ALGORITHM = "HMAC-SHA-256";
export const PBKDF2_DEFAULT_ITERATIONS = 310_000;
export const PBKDF2_MINIMUM_ITERATIONS = 100_000;

const AES_GCM_IV_BYTES = 12;
const PBKDF2_SALT_BYTES = 16;
const SELECTOR_KEY_ID_BYTES = 16;
const LEGACY_IDENTIFIER_HASH_PREFIX = "orbit.identity.identifier.v1:";
const KEYED_IDENTIFIER_SELECTOR_PREFIX = "orbit.identity.identifier.selector.v2:";
const SELECTOR_KEY_ALGORITHM = IDENTITY_KEYED_SELECTOR_ALGORITHM;
const LEGACY_SELECTOR_ALGORITHM = IDENTITY_LEGACY_SELECTOR_ALGORITHM;
const SELECTOR_KEY_DATABASE = "orbit.identity.selector-keys.v1";
const SELECTOR_KEY_OBJECT_STORE = "keys";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class IdentityVaultError extends Error {
    constructor(code, message = "No se ha podido acceder a la bóveda local de identidad.") {
        super(message);
        this.name = "IdentityVaultError";
        this.code = code;
    }
}

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function fail(code, message) {
    throw new IdentityVaultError(code, message);
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function assertExactKeys(value, allowedKeys, code = "VAULT_FORMAT_INVALID") {
    const source = record(value);
    if (!source) fail(code, "La bóveda local tiene un formato no válido.");
    const allowed = new Set(allowedKeys);
    if (Object.keys(source).some((key) => !allowed.has(key))) {
        fail(code, "La bóveda local contiene campos no permitidos.");
    }
    return source;
}

function resolveWebCrypto(cryptoRef = globalThis.crypto) {
    if (!cryptoRef || typeof cryptoRef.getRandomValues !== "function" || !cryptoRef.subtle) {
        fail("WEB_CRYPTO_UNAVAILABLE", "Web Crypto no está disponible en este navegador.");
    }
    return cryptoRef;
}

function randomBytes(size, cryptoRef) {
    const bytes = new Uint8Array(size);
    resolveWebCrypto(cryptoRef).getRandomValues(bytes);
    return bytes;
}

function base64Encode(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    if (typeof globalThis.btoa === "function") return globalThis.btoa(binary);
    if (globalThis.Buffer) return globalThis.Buffer.from(bytes).toString("base64");
    fail("BASE64_UNAVAILABLE", "El navegador no puede codificar la bóveda cifrada.");
}

function base64Decode(value) {
    const normalized = String(value || "");
    try {
        if (typeof globalThis.atob === "function") {
            const binary = globalThis.atob(normalized);
            return Uint8Array.from(binary, (character) => character.charCodeAt(0));
        }
        if (globalThis.Buffer) return new Uint8Array(globalThis.Buffer.from(normalized, "base64"));
    } catch {
        fail("VAULT_FORMAT_INVALID", "La bóveda local contiene Base64 no válido.");
    }
    fail("BASE64_UNAVAILABLE", "El navegador no puede descodificar la bóveda cifrada.");
}

export function base64UrlEncode(bytes) {
    return base64Encode(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlDecode(value) {
    const normalized = text(value);
    if (!normalized || !/^[A-Za-z0-9_-]+$/u.test(normalized)) {
        fail("VAULT_FORMAT_INVALID", "La bóveda local contiene Base64URL no válido.");
    }
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    return base64Decode(`${normalized.replaceAll("-", "+").replaceAll("_", "/")}${padding}`);
}

function normalizedIterations(value) {
    const iterations = Number(value);
    if (!Number.isInteger(iterations) || iterations < PBKDF2_MINIMUM_ITERATIONS) {
        fail("PBKDF2_PARAMETERS_INVALID", `PBKDF2 requiere al menos ${PBKDF2_MINIMUM_ITERATIONS} iteraciones.`);
    }
    return iterations;
}

function validatedPurpose(value) {
    const purpose = text(value);
    if (!purpose || purpose.length > 120 || !/^[A-Za-z0-9._:-]+$/u.test(purpose)) {
        fail("SEALED_DATA_PURPOSE_INVALID", "El propósito de los datos cifrados no es válido.");
    }
    return purpose;
}

function additionalData(...parts) {
    return encoder.encode(parts.join("|"));
}

function assertJsonValue(value, code = "JSON_VALUE_INVALID") {
    let serialized = "";
    try {
        serialized = JSON.stringify(value);
    } catch {
        fail(code, "El valor contiene referencias que no se pueden guardar localmente.");
    }
    if (serialized === undefined) fail(code, "El valor no se puede guardar como JSON.");
    return serialized;
}

async function encryptSerialized(serialized, key, aad, cryptoRef) {
    const crypto = resolveWebCrypto(cryptoRef);
    const iv = randomBytes(AES_GCM_IV_BYTES, crypto);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, encoder.encode(serialized));
    return {
        name: "AES-GCM",
        iv: base64UrlEncode(iv),
        ciphertext: base64UrlEncode(new Uint8Array(ciphertext))
    };
}

async function decryptSerialized(cipher, key, aad, cryptoRef) {
    const crypto = resolveWebCrypto(cryptoRef);
    const source = assertExactKeys(cipher, ["name", "iv", "ciphertext"]);
    if (source.name !== "AES-GCM") fail("VAULT_FORMAT_INVALID", "La bóveda local usa un cifrado no admitido.");
    const iv = base64UrlDecode(source.iv);
    if (iv.length !== AES_GCM_IV_BYTES) fail("VAULT_FORMAT_INVALID", "La bóveda local tiene un IV no válido.");
    try {
        const plaintext = await crypto.subtle.decrypt({
            name: "AES-GCM",
            iv,
            additionalData: aad
        }, key, base64UrlDecode(source.ciphertext));
        return decoder.decode(plaintext);
    } catch {
        fail("VAULT_DECRYPT_FAILED", "No se ha podido descifrar la bóveda local.");
    }
}

function parseJson(serialized, code = "VAULT_FORMAT_INVALID") {
    try {
        return JSON.parse(serialized);
    } catch {
        fail(code, "La bóveda local contiene JSON no válido.");
    }
}

function validateKdf(kdf) {
    const source = assertExactKeys(kdf, ["name", "hash", "iterations", "salt"]);
    if (source.name !== "PBKDF2" || source.hash !== "SHA-256") {
        fail("VAULT_FORMAT_INVALID", "La bóveda local usa una derivación de claves no admitida.");
    }
    const salt = base64UrlDecode(source.salt);
    if (salt.length < PBKDF2_SALT_BYTES) fail("VAULT_FORMAT_INVALID", "La bóveda local tiene una sal no válida.");
    return {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: normalizedIterations(source.iterations),
        salt: source.salt
    };
}

function validateAccountVault(vault) {
    const source = assertExactKeys(vault, ["schema", "version", "accountId", "identifierHash", "kdf", "cipher"]);
    if (source.schema !== IDENTITY_ACCOUNT_VAULT_SCHEMA || source.version !== IDENTITY_VAULT_VERSION) {
        fail("VAULT_VERSION_UNSUPPORTED", "La versión de la bóveda de identidad no es compatible.");
    }
    if (!text(source.accountId) || !text(source.identifierHash)) {
        fail("VAULT_FORMAT_INVALID", "La bóveda local no identifica una cuenta válida.");
    }
    const kdf = validateKdf(source.kdf);
    const cipher = assertExactKeys(source.cipher, ["name", "iv", "ciphertext"]);
    // Validate encoding while loading, before a password is ever processed.
    base64UrlDecode(cipher.iv);
    base64UrlDecode(cipher.ciphertext);
    if (cipher.name !== "AES-GCM") fail("VAULT_FORMAT_INVALID", "La bóveda local usa un cifrado no admitido.");
    return {
        schema: IDENTITY_ACCOUNT_VAULT_SCHEMA,
        version: IDENTITY_VAULT_VERSION,
        accountId: text(source.accountId),
        identifierHash: text(source.identifierHash),
        kdf,
        cipher: { name: "AES-GCM", iv: text(cipher.iv), ciphertext: text(cipher.ciphertext) }
    };
}

function validateSelectorKeyReference(value) {
    const source = assertExactKeys(value, ["algorithm", "id"]);
    const id = text(source.id);
    if (source.algorithm !== SELECTOR_KEY_ALGORITHM || !id || !/^[A-Za-z0-9_-]{16,}$/u.test(id)) {
        fail("VAULT_FORMAT_INVALID", "La referencia de clave del selector local no es válida.");
    }
    return { algorithm: SELECTOR_KEY_ALGORITHM, id };
}

function validateIndexEntry(entry, { indexVersion, selectorKey } = {}) {
    const source = assertExactKeys(entry, ["id", "selector", "vault"]);
    const selector = assertExactKeys(source.selector, ["algorithm", "value"]);
    const selectorAlgorithm = text(selector.algorithm);
    const selectorValue = text(selector.value);
    const validAlgorithm = selectorAlgorithm === LEGACY_SELECTOR_ALGORITHM
        || (indexVersion === IDENTITY_VAULT_INDEX_VERSION && selectorKey && selectorAlgorithm === SELECTOR_KEY_ALGORITHM);
    if (!text(source.id) || !validAlgorithm || !selectorValue) {
        fail("VAULT_FORMAT_INVALID", "El índice local de identidad no es válido.");
    }
    if (base64UrlDecode(selectorValue).length !== 32) {
        fail("VAULT_FORMAT_INVALID", "El selector local de identidad no es válido.");
    }
    const vault = validateAccountVault(source.vault);
    if (vault.accountId !== text(source.id) || vault.identifierHash !== selectorValue) {
        fail("VAULT_FORMAT_INVALID", "El índice y la bóveda local no coinciden.");
    }
    return { id: text(source.id), selector: { algorithm: selectorAlgorithm, value: selectorValue }, vault };
}

export function validateIdentityVaultIndex(index) {
    const candidate = record(index);
    if (!candidate || candidate.schema !== IDENTITY_VAULT_SCHEMA || !Array.isArray(candidate.entries)) {
        fail("VAULT_FORMAT_INVALID", "La bóveda local no tiene un formato compatible.");
    }
    const indexVersion = Number(candidate.version);
    if (indexVersion !== LEGACY_IDENTITY_VAULT_INDEX_VERSION && indexVersion !== IDENTITY_VAULT_INDEX_VERSION) {
        fail("VAULT_VERSION_UNSUPPORTED", "La versión de la bóveda de identidad no es compatible.");
    }
    const source = assertExactKeys(
        candidate,
        indexVersion === IDENTITY_VAULT_INDEX_VERSION
            ? ["schema", "version", "createdAt", "updatedAt", "entries", "selectorKey"]
            : ["schema", "version", "createdAt", "updatedAt", "entries"]
    );
    if (!text(source.createdAt) || !text(source.updatedAt)) fail("VAULT_FORMAT_INVALID", "La bóveda local no tiene marcas de tiempo válidas.");
    const selectorKey = indexVersion === IDENTITY_VAULT_INDEX_VERSION
        ? validateSelectorKeyReference(source.selectorKey)
        : null;
    const entries = source.entries.map((entry) => validateIndexEntry(entry, { indexVersion, selectorKey }));
    const ids = new Set(entries.map((entry) => entry.id));
    const selectors = new Set(entries.map((entry) => `${entry.selector.algorithm}:${entry.selector.value}`));
    if (ids.size !== entries.length || selectors.size !== entries.length) {
        fail("VAULT_FORMAT_INVALID", "La bóveda local tiene cuentas duplicadas.");
    }
    return {
        schema: IDENTITY_VAULT_SCHEMA,
        version: indexVersion,
        createdAt: text(source.createdAt),
        updatedAt: text(source.updatedAt),
        ...(selectorKey ? { selectorKey } : {}),
        entries
    };
}

/**
 * A deliberately narrow localStorage wrapper.  Consumers can only read,
 * replace, or clear the one validated encrypted vault document; it offers no
 * arbitrary key/value API through which a profile or token might be written
 * in plaintext by accident.
 */
export function createGuardedLocalStorageAdapter(storage = globalThis.localStorage, {
    storageKey = IDENTITY_VAULT_STORAGE_KEY
} = {}) {
    const key = text(storageKey);
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function" || !key) {
        fail("LOCAL_STORAGE_UNAVAILABLE", "El almacenamiento local seguro no está disponible.");
    }
    const readRaw = () => {
        try {
            return storage.getItem(key);
        } catch {
            fail("LOCAL_STORAGE_UNAVAILABLE", "No se puede leer el almacenamiento local seguro.");
        }
    };
    return Object.freeze({
        storageKey: key,
        read() {
            const raw = readRaw();
            if (raw === null || raw === undefined || raw === "") return null;
            const index = validateIdentityVaultIndex(parseJson(String(raw)));
            return cloneJson(index);
        },
        write(index) {
            const validated = validateIdentityVaultIndex(index);
            try {
                storage.setItem(key, JSON.stringify(validated));
            } catch {
                fail("LOCAL_STORAGE_UNAVAILABLE", "No se puede escribir el almacenamiento local seguro.");
            }
            return cloneJson(validated);
        },
        clear() {
            try {
                storage.removeItem(key);
            } catch {
                fail("LOCAL_STORAGE_UNAVAILABLE", "No se puede borrar el almacenamiento local seguro.");
            }
        }
    });
}

export function createEmptyIdentityVaultIndex(now = new Date().toISOString()) {
    const timestamp = text(now);
    if (!timestamp) fail("VAULT_FORMAT_INVALID", "La bóveda local requiere una marca de tiempo.");
    return {
        schema: IDENTITY_VAULT_SCHEMA,
        // Keep the empty shape readable by v1 clients. The identity service
        // upgrades it to index v2 only when it can create the non-extractable
        // selector key required for a new local account.
        version: LEGACY_IDENTITY_VAULT_INDEX_VERSION,
        createdAt: timestamp,
        updatedAt: timestamp,
        entries: []
    };
}

function canonicalLocalIdentifier(identifier) {
    const canonical = text(identifier).normalize("NFKC").toLowerCase();
    if (!canonical) fail("IDENTIFIER_INVALID", "La identidad local no es válida.");
    return canonical;
}

/**
 * Legacy v1 selector only. It is intentionally retained exclusively to find
 * and migrate existing accounts. New accounts must use
 * hashLocalIdentifierWithSelectorKey instead.
 */
export async function hashLegacyLocalIdentifier(identifier, cryptoRef = globalThis.crypto) {
    const crypto = resolveWebCrypto(cryptoRef);
    const canonical = canonicalLocalIdentifier(identifier);
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${LEGACY_IDENTIFIER_HASH_PREFIX}${canonical}`));
    return base64UrlEncode(new Uint8Array(digest));
}

/** @deprecated Use hashLegacyLocalIdentifier only to migrate a v1 index. */
export const hashLocalIdentifier = hashLegacyLocalIdentifier;

function selectorKeyHashName(key) {
    const hash = key?.algorithm?.hash;
    return typeof hash === "string" ? hash : hash?.name;
}

function validateSelectorHmacKey(key) {
    const usages = Array.isArray(key?.usages) ? key.usages : [];
    if (!key
        || key.type !== "secret"
        || key.extractable !== false
        || key.algorithm?.name !== "HMAC"
        || selectorKeyHashName(key) !== "SHA-256"
        || !usages.includes("sign")) {
        fail("SELECTOR_KEY_INVALID", "La clave local del selector no es válida.");
    }
    return key;
}

export async function hashLocalIdentifierWithSelectorKey(identifier, selectorKey, cryptoRef = globalThis.crypto) {
    const crypto = resolveWebCrypto(cryptoRef);
    const key = validateSelectorHmacKey(selectorKey);
    const canonical = canonicalLocalIdentifier(identifier);
    const signature = await crypto.subtle.sign(
        { name: "HMAC" },
        key,
        encoder.encode(`${KEYED_IDENTIFIER_SELECTOR_PREFIX}${canonical}`)
    );
    return base64UrlEncode(new Uint8Array(signature));
}

async function createSelectorHmacKey(cryptoRef = globalThis.crypto) {
    const crypto = resolveWebCrypto(cryptoRef);
    const key = await crypto.subtle.generateKey(
        { name: "HMAC", hash: "SHA-256", length: 256 },
        false,
        ["sign"]
    );
    return validateSelectorHmacKey(key);
}

function selectorKeyId(cryptoRef = globalThis.crypto) {
    return base64UrlEncode(randomBytes(SELECTOR_KEY_ID_BYTES, cryptoRef));
}

function selectorKeyStoreUnavailable() {
    fail(
        "SELECTOR_KEY_STORAGE_UNAVAILABLE",
        "No hay un almacén seguro disponible para la clave local del selector de identidad."
    );
}

function selectorKeyStoreFailure() {
    fail(
        "SELECTOR_KEY_STORAGE_FAILED",
        "No se ha podido acceder a la clave local del selector de identidad."
    );
}

function selectorKeyRecord(id, key) {
    const keyId = text(id);
    if (!/^[A-Za-z0-9_-]{16,}$/u.test(keyId)) fail("SELECTOR_KEY_INVALID", "La referencia de clave del selector no es válida.");
    return Object.freeze({ id: keyId, key: validateSelectorHmacKey(key) });
}

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(request.error || new Error("IndexedDB blocked"));
    });
}

function transactionCompleted(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
}

async function openSelectorKeyDatabase(indexedDb) {
    if (!indexedDb || typeof indexedDb.open !== "function") selectorKeyStoreUnavailable();
    let request;
    try {
        request = indexedDb.open(SELECTOR_KEY_DATABASE, 1);
    } catch {
        selectorKeyStoreFailure();
    }
    request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SELECTOR_KEY_OBJECT_STORE)) {
            database.createObjectStore(SELECTOR_KEY_OBJECT_STORE);
        }
    };
    try {
        return await requestResult(request);
    } catch {
        selectorKeyStoreFailure();
    }
}

/**
 * Persists a non-extractable HMAC key in IndexedDB. Its public reference is
 * stored with the identity index, while the raw key is never placed in
 * localStorage or exported by this module.
 */
export function createIndexedDbIdentitySelectorKeyStore({
    indexedDb = globalThis.indexedDB,
    crypto = globalThis.crypto
} = {}) {
    return Object.freeze({
        async create() {
            const id = selectorKeyId(crypto);
            const key = await createSelectorHmacKey(crypto);
            const database = await openSelectorKeyDatabase(indexedDb);
            try {
                const transaction = database.transaction(SELECTOR_KEY_OBJECT_STORE, "readwrite");
                const completed = transactionCompleted(transaction);
                transaction.objectStore(SELECTOR_KEY_OBJECT_STORE).add(key, id);
                await completed;
            } catch {
                selectorKeyStoreFailure();
            } finally {
                database.close?.();
            }
            return selectorKeyRecord(id, key);
        },

        async get(id) {
            const keyId = text(id);
            if (!/^[A-Za-z0-9_-]{16,}$/u.test(keyId)) return null;
            const database = await openSelectorKeyDatabase(indexedDb);
            try {
                const transaction = database.transaction(SELECTOR_KEY_OBJECT_STORE, "readonly");
                const completed = transactionCompleted(transaction);
                const result = await requestResult(transaction.objectStore(SELECTOR_KEY_OBJECT_STORE).get(keyId));
                await completed;
                return result ? selectorKeyRecord(keyId, result) : null;
            } catch {
                selectorKeyStoreFailure();
            } finally {
                database.close?.();
            }
        }
    });
}

/**
 * Test/host helper. It keeps non-extractable CryptoKeys only in memory and is
 * deliberately not selected by the browser identity service by default.
 */
export function createInMemoryIdentitySelectorKeyStore({ crypto = globalThis.crypto } = {}) {
    const keys = new Map();
    return Object.freeze({
        async create() {
            const id = selectorKeyId(crypto);
            const key = await createSelectorHmacKey(crypto);
            keys.set(id, key);
            return selectorKeyRecord(id, key);
        },
        async get(id) {
            const key = keys.get(text(id));
            return key ? selectorKeyRecord(id, key) : null;
        }
    });
}

export async function deriveAccountEncryptionKey({ password, kdf }, cryptoRef = globalThis.crypto) {
    const crypto = resolveWebCrypto(cryptoRef);
    const normalizedKdf = validateKdf(kdf);
    if (typeof password !== "string" || !password) fail("PASSWORD_INVALID", "La contraseña local no es válida.");
    const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({
        name: "PBKDF2",
        salt: base64UrlDecode(normalizedKdf.salt),
        iterations: normalizedKdf.iterations,
        hash: normalizedKdf.hash
    }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function accountVaultAad(accountId, identifierHash) {
    return additionalData(IDENTITY_ACCOUNT_VAULT_SCHEMA, String(IDENTITY_VAULT_VERSION), accountId, identifierHash);
}

export async function createEncryptedAccountVault({
    accountId,
    identifierHash,
    password,
    data,
    pbkdf2Iterations = PBKDF2_DEFAULT_ITERATIONS
}, cryptoRef = globalThis.crypto) {
    const crypto = resolveWebCrypto(cryptoRef);
    const normalizedAccountId = text(accountId);
    const normalizedHash = text(identifierHash);
    if (!normalizedAccountId || !normalizedHash) fail("VAULT_FORMAT_INVALID", "La cuenta local no se puede cifrar.");
    const kdf = {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: normalizedIterations(pbkdf2Iterations),
        salt: base64UrlEncode(randomBytes(PBKDF2_SALT_BYTES, crypto))
    };
    const key = await deriveAccountEncryptionKey({ password, kdf }, crypto);
    const cipher = await encryptSerialized(assertJsonValue(data), key, accountVaultAad(normalizedAccountId, normalizedHash), crypto);
    return {
        vault: {
            schema: IDENTITY_ACCOUNT_VAULT_SCHEMA,
            version: IDENTITY_VAULT_VERSION,
            accountId: normalizedAccountId,
            identifierHash: normalizedHash,
            kdf,
            cipher
        },
        key
    };
}

export async function unlockEncryptedAccountVault({ vault, password }, cryptoRef = globalThis.crypto) {
    const normalizedVault = validateAccountVault(vault);
    const key = await deriveAccountEncryptionKey({ password, kdf: normalizedVault.kdf }, cryptoRef);
    const data = await openAccountVaultData({ vault: normalizedVault, key }, cryptoRef);
    return { vault: normalizedVault, key, data };
}

/**
 * Opens the current account-vault payload with an already-unlocked key.
 *
 * This is intentionally separate from password-based unlock so a caller that
 * already owns the non-extractable key can re-read the *latest* encrypted
 * vault document while holding a storage mutation lock.  It never returns or
 * derives a key, and is used by compare-and-swap operations that must not make
 * a decision from a stale in-memory copy.
 */
export async function openAccountVaultData({ vault, key }, cryptoRef = globalThis.crypto) {
    const normalizedVault = validateAccountVault(vault);
    if (!key) fail("VAULT_KEY_UNAVAILABLE", "La cuenta local debe estar desbloqueada para abrir datos.");
    const serialized = await decryptSerialized(
        normalizedVault.cipher,
        key,
        accountVaultAad(normalizedVault.accountId, normalizedVault.identifierHash),
        cryptoRef
    );
    return parseJson(serialized);
}

export async function encryptAccountVaultData({ vault, key, data }, cryptoRef = globalThis.crypto) {
    const normalizedVault = validateAccountVault(vault);
    if (!key) fail("VAULT_KEY_UNAVAILABLE", "La cuenta local debe estar desbloqueada para guardar datos.");
    const cipher = await encryptSerialized(
        assertJsonValue(data),
        key,
        accountVaultAad(normalizedVault.accountId, normalizedVault.identifierHash),
        cryptoRef
    );
    return { ...normalizedVault, cipher };
}

/** Encrypt arbitrary JSON for a live account capability without exporting its CryptoKey. */
export async function sealAccountJson({ accountId, purpose, key, value }, cryptoRef = globalThis.crypto) {
    const normalizedAccountId = text(accountId);
    const normalizedPurpose = validatedPurpose(purpose);
    if (!normalizedAccountId || !key) fail("VAULT_KEY_UNAVAILABLE", "La cuenta local debe estar desbloqueada para cifrar datos.");
    const cipher = await encryptSerialized(
        assertJsonValue(value),
        key,
        additionalData(IDENTITY_SEALED_DATA_SCHEMA, String(IDENTITY_VAULT_VERSION), normalizedAccountId, normalizedPurpose),
        cryptoRef
    );
    return {
        schema: IDENTITY_SEALED_DATA_SCHEMA,
        version: IDENTITY_VAULT_VERSION,
        accountId: normalizedAccountId,
        purpose: normalizedPurpose,
        cipher
    };
}

/** Decrypt JSON produced by sealAccountJson after validating its owner and purpose binding. */
export async function openAccountJson({ accountId, purpose, key, envelope }, cryptoRef = globalThis.crypto) {
    const source = assertExactKeys(envelope, ["schema", "version", "accountId", "purpose", "cipher"]);
    const normalizedAccountId = text(accountId);
    const normalizedPurpose = validatedPurpose(purpose);
    if (!key || !normalizedAccountId) fail("VAULT_KEY_UNAVAILABLE", "La cuenta local debe estar desbloqueada para abrir datos.");
    if (source.schema !== IDENTITY_SEALED_DATA_SCHEMA || source.version !== IDENTITY_VAULT_VERSION || source.accountId !== normalizedAccountId || source.purpose !== normalizedPurpose) {
        fail("SEALED_DATA_BINDING_INVALID", "Los datos cifrados no pertenecen a esta cuenta o propósito.");
    }
    const serialized = await decryptSerialized(
        source.cipher,
        key,
        additionalData(IDENTITY_SEALED_DATA_SCHEMA, String(IDENTITY_VAULT_VERSION), normalizedAccountId, normalizedPurpose),
        cryptoRef
    );
    return parseJson(serialized, "SEALED_DATA_INVALID");
}

export async function createProviderTokenEnvelope({ accountId, provider, key, tokens, createdAt, expiresAt }, cryptoRef = globalThis.crypto) {
    const normalizedAccountId = text(accountId);
    const normalizedProvider = text(provider).toLowerCase();
    if (!normalizedAccountId || !normalizedProvider || !key) {
        fail("PROVIDER_TOKEN_INPUT_INVALID", "No se puede guardar el token del proveedor.");
    }
    const timestamp = text(createdAt);
    if (!timestamp) fail("PROVIDER_TOKEN_INPUT_INVALID", "El token del proveedor requiere una fecha de guardado.");
    const expiry = text(expiresAt);
    if (!expiry || Number.isNaN(new Date(expiry).getTime())) {
        fail("PROVIDER_TOKEN_INPUT_INVALID", "El token del proveedor requiere una fecha de expiración válida.");
    }
    const cipher = await encryptSerialized(
        assertJsonValue(tokens, "PROVIDER_TOKEN_INPUT_INVALID"),
        key,
        additionalData(IDENTITY_PROVIDER_TOKEN_SCHEMA, String(IDENTITY_VAULT_VERSION), normalizedAccountId, normalizedProvider),
        cryptoRef
    );
    return {
        schema: IDENTITY_PROVIDER_TOKEN_SCHEMA,
        version: IDENTITY_VAULT_VERSION,
        accountId: normalizedAccountId,
        provider: normalizedProvider,
        createdAt: timestamp,
        expiresAt: new Date(expiry).toISOString(),
        renewalRequired: true,
        cipher
    };
}

export async function openProviderTokenEnvelope({ accountId, provider, key, envelope }, cryptoRef = globalThis.crypto) {
    const source = assertExactKeys(envelope, ["schema", "version", "accountId", "provider", "createdAt", "expiresAt", "renewalRequired", "cipher"]);
    const normalizedAccountId = text(accountId);
    const normalizedProvider = text(provider).toLowerCase();
    if (!key || !normalizedAccountId || !normalizedProvider) fail("VAULT_KEY_UNAVAILABLE", "La cuenta local debe estar desbloqueada para usar el token.");
    if (source.schema !== IDENTITY_PROVIDER_TOKEN_SCHEMA || source.version !== IDENTITY_VAULT_VERSION || source.accountId !== normalizedAccountId || source.provider !== normalizedProvider) {
        fail("PROVIDER_TOKEN_BINDING_INVALID", "El token no pertenece a esta cuenta o proveedor.");
    }
    if (!text(source.expiresAt) || Number.isNaN(new Date(source.expiresAt).getTime()) || source.renewalRequired !== true) {
        fail("PROVIDER_TOKEN_INVALID", "El token del proveedor no declara una renovación válida.");
    }
    const serialized = await decryptSerialized(
        source.cipher,
        key,
        additionalData(IDENTITY_PROVIDER_TOKEN_SCHEMA, String(IDENTITY_VAULT_VERSION), normalizedAccountId, normalizedProvider),
        cryptoRef
    );
    return parseJson(serialized, "PROVIDER_TOKEN_INVALID");
}
