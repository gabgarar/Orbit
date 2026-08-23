/**
 * Local-only administrative directory for Orbit identities.
 *
 * The regular identity index deliberately remains opaque: it contains only
 * account ids and selector hashes. Administrative metadata is therefore kept
 * in a second AES-GCM envelope protected by a non-extractable installation
 * key persisted in IndexedDB. Nothing in this module sends data to a server.
 */

import { base64UrlDecode, base64UrlEncode, IdentityVaultError } from "./identityVault.js";

export const ADMIN_REGISTRY_SCHEMA = "orbit.identity.admin-registry";
export const ADMIN_REGISTRY_VERSION = 1;
export const ADMIN_REGISTRY_STORAGE_KEY = "orbit.identity.admin-registry.v1";
export const ADMIN_BOOTSTRAP_IDENTIFIER = "admin@orbit.com";
export const LOCAL_IDENTITY_ROLES = Object.freeze({
    ADMIN: "admin",
    USER: "user"
});
export const ADMIN_LOGIN_POLICY_DEFAULTS = Object.freeze({
    maxFailedAttempts: 5
});

const ADMIN_REGISTRY_KEY_DATABASE = "orbit.identity.admin-registry-keys.v1";
const ADMIN_REGISTRY_KEY_OBJECT_STORE = "keys";
// Password-reset recovery keys deliberately live in a separate IndexedDB
// database.  They are non-extractable Web Crypto keys, and their opaque ids
// are kept only inside the encrypted administrative directory.  Keeping them
// separate from the registry key avoids turning the directory-key API into a
// general key store.
const ADMIN_RECOVERY_KEY_DATABASE = "orbit.identity.admin-recovery-keys.v1";
const ADMIN_RECOVERY_KEY_OBJECT_STORE = "keys";
const ADMIN_REGISTRY_KEY_ID_BYTES = 16;
const AES_GCM_IV_BYTES = 12;
const MAX_ADMIN_NOTE_LENGTH = 4_000;
const MAX_IDENTIFIER_LENGTH = 320;
const MAX_DISPLAY_NAME_LENGTH = 120;
const MAX_PASSWORD_REPLACEMENT_BACKUPS = 20_000;
const MAX_PASSWORD_REPLACEMENT_STORAGE_KEY_LENGTH = 2_048;
const MAX_PASSWORD_REPLACEMENT_PURPOSE_LENGTH = 120;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fail(code, message) {
    throw new IdentityVaultError(code, message);
}

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function frozenClone(value) {
    return Object.freeze(clone(value));
}

function assertExactKeys(value, keys, code = "ADMIN_REGISTRY_FORMAT_INVALID") {
    const source = record(value);
    if (!source || Object.keys(source).length !== keys.length || Object.keys(source).some((key) => !keys.includes(key))) {
        fail(code, "El registro administrativo local tiene un formato no válido.");
    }
    return source;
}

function resolveCrypto(cryptoRef = globalThis.crypto) {
    if (!cryptoRef || typeof cryptoRef.getRandomValues !== "function" || !cryptoRef.subtle) {
        fail("WEB_CRYPTO_UNAVAILABLE", "Este navegador no dispone de la protección criptográfica necesaria.");
    }
    return cryptoRef;
}

function randomBytes(length, cryptoRef) {
    const crypto = resolveCrypto(cryptoRef);
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
}

function normalizedTimestamp(value, { optional = false } = {}) {
    const candidate = text(value);
    if (!candidate && optional) return "";
    const date = new Date(candidate);
    if (!candidate || Number.isNaN(date.getTime())) {
        fail("ADMIN_REGISTRY_FORMAT_INVALID", "El registro administrativo contiene una fecha no válida.");
    }
    return date.toISOString();
}

function nowTimestamp(now) {
    const candidate = typeof now === "function" ? now() : now;
    return normalizedTimestamp(candidate instanceof Date ? candidate.toISOString() : candidate || new Date().toISOString());
}

function normalizedIdentifier(value) {
    const identifier = text(value).normalize("NFKC").toLowerCase();
    if (!identifier || identifier.length > MAX_IDENTIFIER_LENGTH || /\s/u.test(identifier)) {
        fail("ADMIN_REGISTRY_FORMAT_INVALID", "El registro administrativo contiene una identidad no válida.");
    }
    return identifier;
}

function normalizedDisplayName(value, identifier) {
    const displayName = text(value) || identifier;
    if (!displayName || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
        fail("ADMIN_REGISTRY_FORMAT_INVALID", "El registro administrativo contiene un nombre no válido.");
    }
    return displayName;
}

function normalizedAccountId(value) {
    const accountId = text(value);
    if (!accountId || accountId.length > 512) {
        fail("ADMIN_REGISTRY_FORMAT_INVALID", "El registro administrativo contiene una cuenta no válida.");
    }
    return accountId;
}

function optionalAdministrativeKeyReference(value) {
    const keyId = text(value);
    if (keyId && !/^[A-Za-z0-9_-]{16,}$/u.test(keyId)) {
        fail("ADMIN_REGISTRY_FORMAT_INVALID", "El registro administrativo contiene una referencia de clave no válida.");
    }
    return keyId;
}

/**
 * The replacement journal is deliberately private administrative metadata.
 * It contains no key material and is encrypted together with the registry;
 * its backup payloads live separately, encrypted with the candidate account
 * key.  This lets a later login restore a project partition after an
 * interrupted re-key without publishing raw project envelopes in the
 * registry itself.
 */
function normalizePasswordReplacementJournal(value) {
    if (value === undefined || value === null || value === "") return null;
    const source = assertExactKeys(value, [
        "id",
        "previousCredentialGeneration",
        "oldRecoveryKeyId",
        "replacementRecoveryKeyId",
        "startedAt",
        "backups"
    ]);
    const id = text(source.id);
    const previousCredentialGeneration = Number(source.previousCredentialGeneration);
    if (!/^[A-Za-z0-9_-]{16,}$/u.test(id)
        || !Number.isInteger(previousCredentialGeneration)
        || previousCredentialGeneration < 1
        || previousCredentialGeneration > 1_000_000
        || !Array.isArray(source.backups)
        || source.backups.length > MAX_PASSWORD_REPLACEMENT_BACKUPS) {
        fail("ADMIN_REGISTRY_FORMAT_INVALID", "El diario de actualización de contraseña local no es válido.");
    }
    const backupKeys = new Set();
    const storageKeys = new Set();
    const backups = source.backups.map((candidate) => {
        const backup = assertExactKeys(candidate, ["storageKey", "backupKey", "purpose"]);
        const storageKey = text(backup.storageKey);
        const backupKey = text(backup.backupKey);
        const purpose = text(backup.purpose);
        if (!storageKey
            || storageKey.length > MAX_PASSWORD_REPLACEMENT_STORAGE_KEY_LENGTH
            || !backupKey
            || backupKey.length > MAX_PASSWORD_REPLACEMENT_STORAGE_KEY_LENGTH
            || !purpose
            || purpose.length > MAX_PASSWORD_REPLACEMENT_PURPOSE_LENGTH
            || !/^[A-Za-z0-9._:-]+$/u.test(purpose)
            || backupKeys.has(backupKey)
            || storageKeys.has(storageKey)) {
            fail("ADMIN_REGISTRY_FORMAT_INVALID", "El diario de actualización de contraseña local no es válido.");
        }
        backupKeys.add(backupKey);
        storageKeys.add(storageKey);
        return { storageKey, backupKey, purpose };
    });
    return {
        id,
        previousCredentialGeneration,
        oldRecoveryKeyId: optionalAdministrativeKeyReference(source.oldRecoveryKeyId),
        replacementRecoveryKeyId: optionalAdministrativeKeyReference(source.replacementRecoveryKeyId),
        startedAt: normalizedTimestamp(source.startedAt),
        backups
    };
}

export function normalizeLocalIdentityRole(value, fallback = LOCAL_IDENTITY_ROLES.USER) {
    const role = text(value).toLowerCase();
    if (!role) return fallback;
    if (role === LOCAL_IDENTITY_ROLES.ADMIN || role === LOCAL_IDENTITY_ROLES.USER) return role;
    fail("ADMIN_ROLE_INVALID", "El rol local indicado no es válido.");
}

export function normalizeAdminLoginPolicy(value, fallback = ADMIN_LOGIN_POLICY_DEFAULTS) {
    const source = record(value) || {};
    const base = record(fallback) || ADMIN_LOGIN_POLICY_DEFAULTS;
    const maxFailedAttempts = source.maxFailedAttempts === undefined ? base.maxFailedAttempts : Number(source.maxFailedAttempts);
    if (!Number.isInteger(maxFailedAttempts) || maxFailedAttempts < 1 || maxFailedAttempts > 50) {
        fail("ADMIN_LOGIN_POLICY_INVALID", "El límite de intentos debe estar entre 1 y 50.");
    }
    return Object.freeze({ maxFailedAttempts });
}

export function normalizeAdministrativeProvider(value, fallback = "local") {
    const provider = text(value).toLowerCase() || fallback;
    if (["local", "google", "microsoft"].includes(provider)) return provider;
    fail("ADMIN_PROVIDER_INVALID", "El proveedor de identidad indicado no es válido.");
}

export function createAdministrativeUserRecord({
    accountId,
    identifier,
    displayName,
    role = LOCAL_IDENTITY_ROLES.USER,
    provider = "local",
    createdAt,
    updatedAt,
    lastLoginAt = "",
    lastLoginProvider = "local",
    blocked = false,
    failedLoginAttempts = 0,
    failedLoginAttemptsAtLastSuccess = 0,
    lockedUntil = "",
    notes = "",
    passwordChangeRequired = false,
    passwordResetRequestedAt = "",
    passwordRecoveryKeyId = "",
    credentialGeneration = 1,
    // Internal transition marker.  It is intentionally omitted from the
    // public administrative projection so another tab cannot start a
    // password rotation while the account vault/project envelopes are being
    // re-keyed.
    passwordReplacementPending = false,
    passwordReplacementJournal = null
} = {}) {
    const canonicalIdentifier = normalizedIdentifier(identifier);
    const created = normalizedTimestamp(createdAt);
    const updated = normalizedTimestamp(updatedAt || created);
    const failedAttempts = Number(failedLoginAttempts);
    const failedAttemptsAtLastSuccess = Number(failedLoginAttemptsAtLastSuccess);
    const recoveryKeyId = optionalAdministrativeKeyReference(passwordRecoveryKeyId);
    const normalizedCredentialGeneration = Number(credentialGeneration);
    const normalizedNotes = String(notes || "");
    const replacementJournal = normalizePasswordReplacementJournal(passwordReplacementJournal);
    if (!Number.isInteger(failedAttempts)
        || failedAttempts < 0
        || failedAttempts > 1_000
        || !Number.isInteger(failedAttemptsAtLastSuccess)
        || failedAttemptsAtLastSuccess < 0
        || failedAttemptsAtLastSuccess > 1_000
        || !Number.isInteger(normalizedCredentialGeneration)
        || normalizedCredentialGeneration < 1
        || normalizedCredentialGeneration > 1_000_000
        || normalizedNotes.length > MAX_ADMIN_NOTE_LENGTH
        || typeof blocked !== "boolean"
        || typeof passwordChangeRequired !== "boolean"
        || typeof passwordReplacementPending !== "boolean"
        || (passwordReplacementPending === true && !replacementJournal)
        || (passwordReplacementPending !== true && replacementJournal !== null)) {
        fail("ADMIN_REGISTRY_FORMAT_INVALID", "El registro administrativo contiene una política de usuario no válida.");
    }
    return {
        accountId: normalizedAccountId(accountId),
        identifier: canonicalIdentifier,
        displayName: normalizedDisplayName(displayName, canonicalIdentifier),
        role: normalizeLocalIdentityRole(role),
        provider: normalizeAdministrativeProvider(provider),
        createdAt: created,
        updatedAt: updated,
        lastLoginAt: normalizedTimestamp(lastLoginAt, { optional: true }),
        lastLoginProvider: normalizeAdministrativeProvider(lastLoginProvider),
        blocked,
        failedLoginAttempts: failedAttempts,
        failedLoginAttemptsAtLastSuccess: failedAttemptsAtLastSuccess,
        lockedUntil: normalizedTimestamp(lockedUntil, { optional: true }),
        notes: normalizedNotes,
        passwordChangeRequired,
        passwordResetRequestedAt: normalizedTimestamp(passwordResetRequestedAt, { optional: true }),
        passwordRecoveryKeyId: recoveryKeyId,
        credentialGeneration: normalizedCredentialGeneration,
        passwordReplacementPending,
        passwordReplacementJournal: replacementJournal
    };
}

export function createEmptyAdministrativeRegistry(now = new Date()) {
    const timestamp = nowTimestamp(now);
    return {
        schema: ADMIN_REGISTRY_SCHEMA,
        version: ADMIN_REGISTRY_VERSION,
        createdAt: timestamp,
        updatedAt: timestamp,
        policy: { ...ADMIN_LOGIN_POLICY_DEFAULTS },
        users: []
    };
}

export function validateAdministrativeRegistry(value) {
    const source = assertExactKeys(value, ["schema", "version", "createdAt", "updatedAt", "policy", "users"]);
    if (source.schema !== ADMIN_REGISTRY_SCHEMA || Number(source.version) !== ADMIN_REGISTRY_VERSION || !Array.isArray(source.users)) {
        fail("ADMIN_REGISTRY_FORMAT_INVALID", "El registro administrativo local no es compatible.");
    }
    const users = source.users.map((entry) => createAdministrativeUserRecord(entry));
    const accountIds = new Set(users.map((entry) => entry.accountId));
    const identifiers = new Set(users.map((entry) => entry.identifier));
    if (accountIds.size !== users.length || identifiers.size !== users.length) {
        fail("ADMIN_REGISTRY_FORMAT_INVALID", "El registro administrativo contiene usuarios duplicados.");
    }
    return {
        schema: ADMIN_REGISTRY_SCHEMA,
        version: ADMIN_REGISTRY_VERSION,
        createdAt: normalizedTimestamp(source.createdAt),
        updatedAt: normalizedTimestamp(source.updatedAt),
        policy: { ...normalizeAdminLoginPolicy(source.policy) },
        users
    };
}

export function publicAdministrativeUser(record) {
    const user = createAdministrativeUserRecord(record);
    // The recovery-key reference is deliberately admin-core-only.  A caller
    // can see reset/lock state, but can never obtain the handle which lets the
    // authenticated service retrieve a non-extractable recovery key.
    const {
        passwordRecoveryKeyId,
        credentialGeneration,
        passwordReplacementPending,
        passwordReplacementJournal,
        ...publicUser
    } = user;
    return frozenClone(publicUser);
}

function adminRegistryKeyId(cryptoRef) {
    return base64UrlEncode(randomBytes(ADMIN_REGISTRY_KEY_ID_BYTES, cryptoRef));
}

function validateAdministrativeRegistryKey(key) {
    const usages = Array.isArray(key?.usages) ? key.usages : [];
    if (!key
        || key.type !== "secret"
        || key.extractable !== false
        || key.algorithm?.name !== "AES-GCM"
        || !usages.includes("encrypt")
        || !usages.includes("decrypt")) {
        fail("ADMIN_REGISTRY_KEY_INVALID", "La clave del registro administrativo no es válida.");
    }
    return key;
}

function administrativeRegistryKeyRecord(id, key) {
    const keyId = text(id);
    if (!/^[A-Za-z0-9_-]{16,}$/u.test(keyId)) {
        fail("ADMIN_REGISTRY_KEY_INVALID", "La referencia de clave administrativa no es válida.");
    }
    return Object.freeze({ id: keyId, key: validateAdministrativeRegistryKey(key) });
}

async function createAdministrativeRegistryKey(cryptoRef) {
    const crypto = resolveCrypto(cryptoRef);
    return validateAdministrativeRegistryKey(await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
}

function registryAad(keyId) {
    return encoder.encode(`${ADMIN_REGISTRY_SCHEMA}:${ADMIN_REGISTRY_VERSION}:${keyId}`);
}

function validateRegistryEnvelope(value) {
    const source = assertExactKeys(value, ["schema", "version", "keyId", "cipher"]);
    const cipher = assertExactKeys(source.cipher, ["name", "iv", "ciphertext"]);
    const keyId = text(source.keyId);
    if (source.schema !== ADMIN_REGISTRY_SCHEMA
        || Number(source.version) !== ADMIN_REGISTRY_VERSION
        || !/^[A-Za-z0-9_-]{16,}$/u.test(keyId)
        || cipher.name !== "AES-GCM"
        || base64UrlDecode(cipher.iv).length !== AES_GCM_IV_BYTES
        || !base64UrlDecode(cipher.ciphertext).length) {
        fail("ADMIN_REGISTRY_FORMAT_INVALID", "El registro administrativo cifrado no es válido.");
    }
    return {
        schema: ADMIN_REGISTRY_SCHEMA,
        version: ADMIN_REGISTRY_VERSION,
        keyId,
        cipher: { name: "AES-GCM", iv: text(cipher.iv), ciphertext: text(cipher.ciphertext) }
    };
}

async function sealAdministrativeRegistry(registry, keyRecord, cryptoRef) {
    const crypto = resolveCrypto(cryptoRef);
    const validated = validateAdministrativeRegistry(registry);
    const key = validateAdministrativeRegistryKey(keyRecord?.key);
    const keyId = text(keyRecord?.id);
    const iv = randomBytes(AES_GCM_IV_BYTES, crypto);
    const cipher = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: registryAad(keyId) },
        key,
        encoder.encode(JSON.stringify(validated))
    );
    return {
        schema: ADMIN_REGISTRY_SCHEMA,
        version: ADMIN_REGISTRY_VERSION,
        keyId,
        cipher: {
            name: "AES-GCM",
            iv: base64UrlEncode(iv),
            ciphertext: base64UrlEncode(new Uint8Array(cipher))
        }
    };
}

async function openAdministrativeRegistry(envelope, keyRecord, cryptoRef) {
    const crypto = resolveCrypto(cryptoRef);
    const validatedEnvelope = validateRegistryEnvelope(envelope);
    const keyId = text(keyRecord?.id);
    if (keyId !== validatedEnvelope.keyId) {
        fail("ADMIN_REGISTRY_KEY_NOT_FOUND", "No se ha encontrado la clave del registro administrativo.");
    }
    try {
        const plaintext = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: base64UrlDecode(validatedEnvelope.cipher.iv),
                additionalData: registryAad(keyId)
            },
            validateAdministrativeRegistryKey(keyRecord.key),
            base64UrlDecode(validatedEnvelope.cipher.ciphertext)
        );
        return validateAdministrativeRegistry(JSON.parse(decoder.decode(plaintext)));
    } catch (error) {
        if (error?.code) throw error;
        fail("ADMIN_REGISTRY_DECRYPT_FAILED", "No se ha podido descifrar el registro administrativo local.");
    }
}

function keyStoreUnavailable() {
    fail("ADMIN_REGISTRY_KEY_STORAGE_UNAVAILABLE", "No hay un almacén seguro disponible para la clave administrativa local.");
}

function keyStoreFailure() {
    fail("ADMIN_REGISTRY_KEY_STORAGE_FAILED", "No se ha podido acceder a la clave administrativa local.");
}

function recoveryKeyStoreUnavailable() {
    fail("ADMIN_PASSWORD_RECOVERY_UNAVAILABLE", "No está disponible la recuperación local de contraseñas administrativas.");
}

function recoveryKeyStoreFailure() {
    fail("ADMIN_PASSWORD_RECOVERY_UNAVAILABLE", "No se ha podido acceder a la clave local de recuperación de contraseña.");
}

function administrativeRecoveryKeyRecord(id, key) {
    const keyId = text(id);
    if (!/^[A-Za-z0-9_-]{16,}$/u.test(keyId)) {
        fail("ADMIN_PASSWORD_RECOVERY_UNAVAILABLE", "La referencia de recuperación de contraseña no es válida.");
    }
    return Object.freeze({ id: keyId, key: validateAdministrativeRegistryKey(key) });
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

async function openAdministrativeKeyDatabase(indexedDb) {
    if (!indexedDb || typeof indexedDb.open !== "function") keyStoreUnavailable();
    let request;
    try {
        request = indexedDb.open(ADMIN_REGISTRY_KEY_DATABASE, 1);
    } catch {
        keyStoreFailure();
    }
    request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(ADMIN_REGISTRY_KEY_OBJECT_STORE)) {
            database.createObjectStore(ADMIN_REGISTRY_KEY_OBJECT_STORE);
        }
    };
    try {
        return await requestResult(request);
    } catch {
        keyStoreFailure();
    }
}

async function openAdministrativeRecoveryKeyDatabase(indexedDb) {
    if (!indexedDb || typeof indexedDb.open !== "function") recoveryKeyStoreUnavailable();
    let request;
    try {
        request = indexedDb.open(ADMIN_RECOVERY_KEY_DATABASE, 1);
    } catch {
        recoveryKeyStoreFailure();
    }
    request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(ADMIN_RECOVERY_KEY_OBJECT_STORE)) {
            database.createObjectStore(ADMIN_RECOVERY_KEY_OBJECT_STORE);
        }
    };
    try {
        return await requestResult(request);
    } catch {
        recoveryKeyStoreFailure();
    }
}

/** Persist a non-extractable AES-GCM key without placing it in localStorage. */
export function createIndexedDbIdentityAdminRegistryKeyStore({
    indexedDb = globalThis.indexedDB,
    crypto = globalThis.crypto
} = {}) {
    return Object.freeze({
        async create() {
            const id = adminRegistryKeyId(crypto);
            const key = await createAdministrativeRegistryKey(crypto);
            const database = await openAdministrativeKeyDatabase(indexedDb);
            try {
                const transaction = database.transaction(ADMIN_REGISTRY_KEY_OBJECT_STORE, "readwrite");
                const completed = transactionCompleted(transaction);
                transaction.objectStore(ADMIN_REGISTRY_KEY_OBJECT_STORE).add(key, id);
                await completed;
            } catch {
                keyStoreFailure();
            } finally {
                database.close?.();
            }
            return administrativeRegistryKeyRecord(id, key);
        },

        async get(id) {
            const keyId = text(id);
            if (!/^[A-Za-z0-9_-]{16,}$/u.test(keyId)) return null;
            const database = await openAdministrativeKeyDatabase(indexedDb);
            try {
                const transaction = database.transaction(ADMIN_REGISTRY_KEY_OBJECT_STORE, "readonly");
                const completed = transactionCompleted(transaction);
                const key = await requestResult(transaction.objectStore(ADMIN_REGISTRY_KEY_OBJECT_STORE).get(keyId));
                await completed;
                return key ? administrativeRegistryKeyRecord(keyId, key) : null;
            } catch {
                keyStoreFailure();
            } finally {
                database.close?.();
            }
        }
    });
}

/** Test/host helper which keeps non-extractable administrative keys in memory. */
export function createInMemoryIdentityAdminRegistryKeyStore({ crypto = globalThis.crypto } = {}) {
    const keys = new Map();
    return Object.freeze({
        async create() {
            const id = adminRegistryKeyId(crypto);
            const key = await createAdministrativeRegistryKey(crypto);
            keys.set(id, key);
            return administrativeRegistryKeyRecord(id, key);
        },
        async get(id) {
            const key = keys.get(text(id));
            return key ? administrativeRegistryKeyRecord(id, key) : null;
        }
    });
}

/**
 * Persists an already-created, non-extractable account AES-GCM key for a
 * local administrator-approved password replacement.  It never exports key
 * material; callers receive only an opaque id and can later ask for the
 * CryptoKey through this narrowly scoped store.
 */
export function createIndexedDbIdentityAdministrativeRecoveryKeyStore({
    indexedDb = globalThis.indexedDB,
    crypto = globalThis.crypto
} = {}) {
    return Object.freeze({
        async put(key) {
            const record = administrativeRecoveryKeyRecord(adminRegistryKeyId(crypto), key);
            const database = await openAdministrativeRecoveryKeyDatabase(indexedDb);
            try {
                const transaction = database.transaction(ADMIN_RECOVERY_KEY_OBJECT_STORE, "readwrite");
                const completed = transactionCompleted(transaction);
                transaction.objectStore(ADMIN_RECOVERY_KEY_OBJECT_STORE).add(record.key, record.id);
                await completed;
            } catch {
                recoveryKeyStoreFailure();
            } finally {
                database.close?.();
            }
            return record;
        },

        async get(id) {
            const keyId = text(id);
            if (!/^[A-Za-z0-9_-]{16,}$/u.test(keyId)) return null;
            const database = await openAdministrativeRecoveryKeyDatabase(indexedDb);
            try {
                const transaction = database.transaction(ADMIN_RECOVERY_KEY_OBJECT_STORE, "readonly");
                const completed = transactionCompleted(transaction);
                const key = await requestResult(transaction.objectStore(ADMIN_RECOVERY_KEY_OBJECT_STORE).get(keyId));
                await completed;
                return key ? administrativeRecoveryKeyRecord(keyId, key) : null;
            } catch {
                recoveryKeyStoreFailure();
            } finally {
                database.close?.();
            }
        },

        async remove(id) {
            const keyId = text(id);
            if (!/^[A-Za-z0-9_-]{16,}$/u.test(keyId)) return false;
            const database = await openAdministrativeRecoveryKeyDatabase(indexedDb);
            try {
                const transaction = database.transaction(ADMIN_RECOVERY_KEY_OBJECT_STORE, "readwrite");
                const completed = transactionCompleted(transaction);
                transaction.objectStore(ADMIN_RECOVERY_KEY_OBJECT_STORE).delete(keyId);
                await completed;
                return true;
            } catch {
                recoveryKeyStoreFailure();
            } finally {
                database.close?.();
            }
        }
    });
}

/** Test/host helper for the administrative recovery-key lifecycle. */
export function createInMemoryIdentityAdministrativeRecoveryKeyStore({ crypto = globalThis.crypto } = {}) {
    const keys = new Map();
    return Object.freeze({
        async put(key) {
            const record = administrativeRecoveryKeyRecord(adminRegistryKeyId(crypto), key);
            keys.set(record.id, record.key);
            return record;
        },
        async get(id) {
            const key = keys.get(text(id));
            return key ? administrativeRecoveryKeyRecord(text(id), key) : null;
        },
        async remove(id) {
            return keys.delete(text(id));
        }
    });
}

export function createAdministrativeRegistryStorageAdapter(storage = globalThis.localStorage, {
    storageKey = ADMIN_REGISTRY_STORAGE_KEY
} = {}) {
    const key = text(storageKey);
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function" || !key) {
        fail("ADMIN_REGISTRY_STORAGE_UNAVAILABLE", "No se puede acceder al registro administrativo local.");
    }
    return Object.freeze({
        storageKey: key,
        read() {
            let raw;
            try {
                raw = storage.getItem(key);
            } catch {
                fail("ADMIN_REGISTRY_STORAGE_UNAVAILABLE", "No se puede leer el registro administrativo local.");
            }
            if (raw === null || raw === undefined || raw === "") return null;
            try {
                return validateRegistryEnvelope(JSON.parse(String(raw)));
            } catch (error) {
                if (error?.code) throw error;
                fail("ADMIN_REGISTRY_FORMAT_INVALID", "El registro administrativo local no tiene JSON válido.");
            }
        },
        write(envelope) {
            const validated = validateRegistryEnvelope(envelope);
            try {
                storage.setItem(key, JSON.stringify(validated));
            } catch {
                fail("ADMIN_REGISTRY_STORAGE_UNAVAILABLE", "No se puede guardar el registro administrativo local.");
            }
            return frozenClone(validated);
        },
        clear() {
            try {
                storage.removeItem(key);
            } catch {
                fail("ADMIN_REGISTRY_STORAGE_UNAVAILABLE", "No se puede borrar el registro administrativo local.");
            }
        }
    });
}

/**
 * Narrow encrypted store used by the identity service. The caller owns its
 * mutation lock, which lets account and administrative decisions share an
 * ordering without ever publishing cleartext registry records.
 */
export function createLocalAdministrativeRegistryStore({
    storage = globalThis.localStorage,
    storageKey,
    keyStore = createIndexedDbIdentityAdminRegistryKeyStore(),
    crypto = globalThis.crypto
} = {}) {
    const adapter = createAdministrativeRegistryStorageAdapter(storage, { storageKey });
    if (!keyStore || typeof keyStore.create !== "function" || typeof keyStore.get !== "function") {
        keyStoreUnavailable();
    }
    return Object.freeze({
        storageKey: adapter.storageKey,
        hasDocument() {
            return adapter.read() !== null;
        },
        async read({ create = false, now = new Date() } = {}) {
            const envelope = adapter.read();
            if (!envelope) {
                if (!create) return null;
                const keyRecord = await keyStore.create();
                const registry = createEmptyAdministrativeRegistry(now);
                const nextEnvelope = await sealAdministrativeRegistry(registry, keyRecord, crypto);
                adapter.write(nextEnvelope);
                return { registry, keyRecord };
            }
            const keyRecord = await keyStore.get(envelope.keyId);
            if (!keyRecord) {
                fail("ADMIN_REGISTRY_KEY_NOT_FOUND", "No se ha encontrado la clave del registro administrativo local.");
            }
            return { registry: await openAdministrativeRegistry(envelope, keyRecord, crypto), keyRecord };
        },
        async write({ registry, keyRecord } = {}) {
            const envelope = await sealAdministrativeRegistry(registry, keyRecord, crypto);
            adapter.write(envelope);
            return frozenClone(validateAdministrativeRegistry(registry));
        }
    });
}
