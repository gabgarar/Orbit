/**
 * Local account lifecycle built on the encrypted identity vault.
 *
 * There is intentionally no persisted session.  A new service instance starts
 * unauthenticated even when encrypted accounts exist on the device, which
 * keeps the application's startup gate explicit and prevents silent login.
 */

import { ORBIT_IDENTITY_SESSION_CHANGED_EVENT } from "./identityEvents.js";
import {
    ADMIN_BOOTSTRAP_IDENTIFIER,
    createAdministrativeUserRecord,
    createIndexedDbIdentityAdminRegistryKeyStore,
    createLocalAdministrativeRegistryStore,
    LOCAL_IDENTITY_ROLES,
    normalizeAdministrativeProvider,
    normalizeAdminLoginPolicy,
    normalizeLocalIdentityRole,
    publicAdministrativeUser
} from "./identityAdministration.js";
import { identityStateForProvider, IDENTITY_STATES } from "./identityStates.js";
import {
    base64UrlEncode,
    createIndexedDbIdentitySelectorKeyStore,
    createEmptyIdentityVaultIndex,
    createEncryptedAccountVault,
    createGuardedLocalStorageAdapter,
    createProviderTokenEnvelope,
    encryptAccountVaultData,
    hashLegacyLocalIdentifier,
    hashLocalIdentifierWithSelectorKey,
    IDENTITY_KEYED_SELECTOR_ALGORITHM,
    IDENTITY_VAULT_INDEX_VERSION,
    IdentityVaultError,
    openAccountVaultData,
    openAccountJson,
    openProviderTokenEnvelope,
    sealAccountJson,
    unlockEncryptedAccountVault
} from "./identityVault.js";

export const LOCAL_ACCOUNT_DATA_SCHEMA = "orbit.identity.local-account-data";
export const LOCAL_ACCOUNT_DATA_VERSION = 1;
export const SUPPORTED_TOKEN_PROVIDERS = Object.freeze(["google", "microsoft"]);
export { ADMIN_BOOTSTRAP_IDENTIFIER, LOCAL_IDENTITY_ROLES } from "./identityAdministration.js";

const MIN_PASSWORD_LENGTH = 12;
const MAX_IDENTIFIER_LENGTH = 320;
const MAX_DISPLAY_NAME_LENGTH = 120;
const ALLOWED_TOKEN_FIELDS = new Set([
    "accessToken",
    "refreshToken",
    "idToken",
    "tokenType",
    "scope",
    "expiresAt",
    "issuedAt"
]);
const identityVaultMutationQueues = new Map();
const PROVIDER_TOKEN_ENVELOPE_KEYS = Object.freeze([
    "schema",
    "version",
    "accountId",
    "provider",
    "createdAt",
    "expiresAt",
    "renewalRequired",
    "cipher"
]);
const PROVIDER_TOKEN_CIPHER_KEYS = Object.freeze(["name", "iv", "ciphertext"]);

function runWithInProcessIdentityVaultLock(lockName, operation) {
    const previous = identityVaultMutationQueues.get(lockName) || Promise.resolve();
    const result = previous.then(operation, operation);
    const settled = result.catch(() => {});
    identityVaultMutationQueues.set(lockName, settled);
    return result.finally(() => {
        if (identityVaultMutationQueues.get(lockName) === settled) {
            identityVaultMutationQueues.delete(lockName);
        }
    });
}

function runWithIdentityVaultMutationLock(lockName, operation) {
    const locks = globalThis.navigator?.locks;
    if (locks && typeof locks.request === "function") {
        return locks.request(lockName, { mode: "exclusive" }, () => runWithInProcessIdentityVaultLock(lockName, operation));
    }
    return runWithInProcessIdentityVaultLock(lockName, operation);
}

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function frozenClone(value) {
    return Object.freeze(cloneJson(value));
}

function fail(code, message) {
    throw new IdentityVaultError(code, message);
}

function normalizedIdentifier(value) {
    const identifier = text(value).normalize("NFKC").toLowerCase();
    if (identifier.length < 3 || identifier.length > MAX_IDENTIFIER_LENGTH || /\s/u.test(identifier)) {
        fail("IDENTIFIER_INVALID", "Introduce una identidad local válida.");
    }
    return identifier;
}

function validatedPassword(value) {
    if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH) {
        fail("PASSWORD_WEAK", `La contraseña local debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    }
    return value;
}

function normalizedDisplayName(value, fallback) {
    const displayName = text(value) || fallback;
    if (!displayName || displayName.length > MAX_DISPLAY_NAME_LENGTH) {
        fail("DISPLAY_NAME_INVALID", "El nombre mostrado de la cuenta no es válido.");
    }
    return displayName;
}

function normalizedProvider(value) {
    const provider = text(value).toLowerCase();
    if (!SUPPORTED_TOKEN_PROVIDERS.includes(provider)) {
        fail("PROVIDER_UNSUPPORTED", "El proveedor de identidad no está admitido.");
    }
    return provider;
}

function normalizedTokenPayload(value) {
    const source = record(value);
    if (!source) fail("PROVIDER_TOKEN_INPUT_INVALID", "El token del proveedor no es válido.");
    const unknownField = Object.keys(source).find((key) => !ALLOWED_TOKEN_FIELDS.has(key));
    if (unknownField) fail("PROVIDER_TOKEN_INPUT_INVALID", "El token del proveedor contiene campos no admitidos.");
    const token = {};
    for (const field of ALLOWED_TOKEN_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
        const valueForField = source[field];
        if (field === "expiresAt" || field === "issuedAt") {
            const date = new Date(valueForField);
            if (Number.isNaN(date.getTime())) fail("PROVIDER_TOKEN_INPUT_INVALID", "La fecha del token no es válida.");
            token[field] = date.toISOString();
            continue;
        }
        if (typeof valueForField !== "string" || !valueForField) {
            fail("PROVIDER_TOKEN_INPUT_INVALID", "El token del proveedor no es válido.");
        }
        token[field] = valueForField;
    }
    if (!token.accessToken || !token.expiresAt) {
        fail("PROVIDER_TOKEN_INPUT_INVALID", "Un token de acceso con fecha de expiración es obligatorio.");
    }
    return token;
}

function timestamp(now) {
    const value = typeof now === "function" ? now() : new Date();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) fail("CLOCK_INVALID", "La hora local no es válida.");
    return date.toISOString();
}

function accountIdFromCrypto(cryptoRef) {
    if (typeof cryptoRef?.randomUUID === "function") return `local-${cryptoRef.randomUUID()}`;
    if (!cryptoRef || typeof cryptoRef.getRandomValues !== "function") {
        fail("WEB_CRYPTO_UNAVAILABLE", "Web Crypto no está disponible en este navegador.");
    }
    const bytes = new Uint8Array(16);
    cryptoRef.getRandomValues(bytes);
    return `local-${base64UrlEncode(bytes)}`;
}

function createAccountData({ accountId, identifier, displayName, createdAt }) {
    return {
        schema: LOCAL_ACCOUNT_DATA_SCHEMA,
        version: LOCAL_ACCOUNT_DATA_VERSION,
        account: {
            id: accountId,
            kind: "local",
            identityState: IDENTITY_STATES.LOCAL_USER,
            identifier,
            displayName,
            createdAt,
            updatedAt: createdAt
        },
        profile: {
            id: `profile:${accountId}`,
            accountId,
            displayName,
            createdAt,
            updatedAt: createdAt
        },
        providerTokenEnvelopes: {},
        externalIdentities: {}
    };
}

function validateAccountData(value, { accountId, identifier } = {}) {
    const source = record(value);
    const account = record(source?.account);
    const profile = record(source?.profile);
    const envelopes = record(source?.providerTokenEnvelopes);
    const externalIdentities = record(source?.externalIdentities);
    if (!source || source.schema !== LOCAL_ACCOUNT_DATA_SCHEMA || source.version !== LOCAL_ACCOUNT_DATA_VERSION || !account || !profile || !envelopes || !externalIdentities) {
        fail("ACCOUNT_DATA_INVALID", "La cuenta local cifrada no tiene un formato válido.");
    }
    if (account.id !== accountId || account.kind !== "local" || account.identityState !== IDENTITY_STATES.LOCAL_USER || account.identifier !== identifier) {
        fail("ACCOUNT_DATA_INVALID", "La cuenta local cifrada no coincide con la identidad solicitada.");
    }
    if (profile.accountId !== accountId || !text(account.displayName) || !text(profile.displayName)) {
        fail("ACCOUNT_DATA_INVALID", "El perfil local cifrado no es válido.");
    }
    for (const provider of Object.keys(envelopes)) normalizedProvider(provider);
    for (const [provider, identity] of Object.entries(externalIdentities)) {
        const external = record(identity);
        if (!external || normalizedProvider(provider) !== external.provider || !text(external.subject) || !text(external.displayName)) {
            fail("ACCOUNT_DATA_INVALID", "La identidad externa cifrada no es válida.");
        }
    }
    return source;
}

function publicAccount(data) {
    const account = data.account;
    return Object.freeze({
        id: account.id,
        kind: account.kind,
        identityState: account.identityState,
        identifier: account.identifier,
        displayName: account.displayName,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt
    });
}

function publicProfile(data) {
    const profile = data.profile;
    return Object.freeze({
        id: profile.id,
        accountId: profile.accountId,
        displayName: profile.displayName,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt
    });
}

function publicSession(data, authenticatedAt, externalIdentity = null, security = {}) {
    const account = publicAccount(data);
    const role = normalizeLocalIdentityRole(security?.role, LOCAL_IDENTITY_ROLES.USER);
    const passwordChangeRequired = security?.passwordChangeRequired === true;
    if (externalIdentity) {
        return Object.freeze({
            accountId: externalIdentity.id,
            localAccountId: account.id,
            identityState: identityStateForProvider(externalIdentity.provider),
            provider: externalIdentity.provider,
            subject: externalIdentity.subject,
            identifier: externalIdentity.email || "",
            displayName: externalIdentity.displayName,
            authenticatedAt,
            role,
            passwordChangeRequired
        });
    }
    return Object.freeze({
        accountId: account.id,
        identityState: IDENTITY_STATES.LOCAL_USER,
        identifier: account.identifier,
        displayName: account.displayName,
        authenticatedAt,
        role,
        passwordChangeRequired
    });
}

function providerEnvelopeSummary(envelope) {
    return Object.freeze({
        provider: envelope.provider,
        createdAt: envelope.createdAt,
        expiresAt: envelope.expiresAt,
        encrypted: true,
        renewalRequired: true
    });
}

function providerTokenNeedsRenewal(envelope, now) {
    return new Date(envelope.expiresAt).getTime() <= new Date(timestamp(now)).getTime();
}

function invalidCredentials() {
    return new IdentityVaultError("INVALID_CREDENTIALS", "La identidad o contraseña no son correctas.");
}

function normalizeExternalIdentity(provider, value) {
    const source = record(value);
    if (!source) fail("EXTERNAL_IDENTITY_INVALID", "La identidad autorizada por el proveedor no es válida.");
    const unsafeKey = Object.keys(source).find((key) => /token|secret|password/i.test(key));
    const unknownKey = Object.keys(source).find((key) => !["provider", "subject", "displayName", "email"].includes(key));
    if (unsafeKey || unknownKey || (text(source.provider) && normalizedProvider(source.provider) !== provider)) {
        fail("EXTERNAL_IDENTITY_INVALID", "La identidad externa no debe incluir tokens ni campos no admitidos.");
    }
    const subject = text(source.subject);
    const displayName = text(source.displayName);
    const email = text(source.email).toLowerCase();
    if (!subject || subject.length > 512 || /\s/u.test(subject) || !displayName || displayName.length > MAX_DISPLAY_NAME_LENGTH || (email && (email.length > MAX_IDENTIFIER_LENGTH || /\s/u.test(email)))) {
        fail("EXTERNAL_IDENTITY_INVALID", "La identidad autorizada por el proveedor no es válida.");
    }
    return {
        id: `${provider}:${subject}`,
        provider,
        subject,
        displayName,
        ...(email ? { email } : {})
    };
}

function sameEncryptedEnvelope(left, right) {
    const hasExactKeys = (value, allowedKeys) => {
        const source = record(value);
        if (!source) return false;
        const keys = Object.keys(source);
        return keys.length === allowedKeys.length && keys.every((key) => allowedKeys.includes(key));
    };
    if (!hasExactKeys(left, PROVIDER_TOKEN_ENVELOPE_KEYS)
        || !hasExactKeys(right, PROVIDER_TOKEN_ENVELOPE_KEYS)
        || !hasExactKeys(left.cipher, PROVIDER_TOKEN_CIPHER_KEYS)
        || !hasExactKeys(right.cipher, PROVIDER_TOKEN_CIPHER_KEYS)) {
        return false;
    }
    return left.schema === right.schema
        && left.version === right.version
        && left.accountId === right.accountId
        && left.provider === right.provider
        && left.createdAt === right.createdAt
        && left.expiresAt === right.expiresAt
        && left.renewalRequired === right.renewalRequired
        && left.cipher?.name === right.cipher?.name
        && left.cipher?.iv === right.cipher?.iv
        && left.cipher?.ciphertext === right.cipher?.ciphertext;
}

function safelyDispatchSession(target, session) {
    if (!target || typeof target.dispatchEvent !== "function" || typeof CustomEvent === "undefined") return;
    target.dispatchEvent(new CustomEvent(ORBIT_IDENTITY_SESSION_CHANGED_EVENT, { detail: { session } }));
}

/**
 * Creates an in-memory local-account session manager.  `adapter` is injected
 * for tests or advanced hosts; otherwise a guarded one-key localStorage
 * adapter is created.  Session state is never read from or written to disk.
 */
export function createLocalIdentityService({
    adapter,
    storage,
    storageKey,
    selectorKeyStore,
    adminRegistryStore,
    adminRegistryKeyStore,
    adminRegistryStorageKey,
    crypto = globalThis.crypto,
    now = () => new Date(),
    pbkdf2Iterations,
    eventTarget,
    online = () => globalThis.navigator?.onLine === true
} = {}) {
    const vaultAdapter = adapter || createGuardedLocalStorageAdapter(storage, { storageKey });
    const identitySelectorKeyStore = selectorKeyStore || createIndexedDbIdentitySelectorKeyStore({ crypto });
    const rawStorage = storage || globalThis.localStorage;
    const localAdministrationStore = adminRegistryStore || (rawStorage
        ? createLocalAdministrativeRegistryStore({
            storage: rawStorage,
            storageKey: adminRegistryStorageKey,
            keyStore: adminRegistryKeyStore || createIndexedDbIdentityAdminRegistryKeyStore({ crypto }),
            crypto
        })
        : null);
    const identityVaultLockName = `orbit.identity.vault-write:${text(vaultAdapter.storageKey) || "default"}`;
    const administrationLockName = `orbit.identity.admin-registry-write:${text(localAdministrationStore?.storageKey) || "unavailable"}`;
    const listeners = new Set();
    let active = null;
    let sessionGeneration = 0;

    function currentSession() {
        return active ? publicSession(active.data, active.authenticatedAt, active.externalIdentity, active.security) : null;
    }

    function publishSession() {
        const session = currentSession();
        listeners.forEach((listener) => listener(session));
        safelyDispatchSession(eventTarget, session);
        return session;
    }

    function mutateIdentityVault(operation) {
        return runWithIdentityVaultMutationLock(identityVaultLockName, operation);
    }

    function administrationUnavailable() {
        fail("ADMIN_REGISTRY_UNAVAILABLE", "La administración local de usuarios no está disponible en este dispositivo.");
    }

    function administrativeSecurity(recordForAccount = null) {
        return {
            role: normalizeLocalIdentityRole(recordForAccount?.role, LOCAL_IDENTITY_ROLES.USER),
            passwordChangeRequired: recordForAccount?.passwordChangeRequired === true
        };
    }

    function administrativeRecordForAccount(registry, accountId) {
        return registry?.users?.find((candidate) => candidate.accountId === accountId) || null;
    }

    function administrationCanBeProvisionedLater(error) {
        return [
            "ADMIN_REGISTRY_STORAGE_UNAVAILABLE",
            "ADMIN_REGISTRY_KEY_STORAGE_UNAVAILABLE",
            "ADMIN_REGISTRY_KEY_STORAGE_FAILED"
        ].includes(error?.code);
    }

    async function mutateAdministrativeRegistry(operation, { create = false, required = false } = {}) {
        if (!localAdministrationStore) {
            if (required) administrationUnavailable();
            return null;
        }
        return runWithIdentityVaultMutationLock(administrationLockName, async () => {
            let context;
            try {
                context = await localAdministrationStore.read({ create, now: timestamp(now) });
            } catch (error) {
                // A pre-existing encrypted directory whose key cannot be read
                // must never be treated as absent. That would bypass lockouts
                // or an administrator's forced-password-change marker.
                if (required || localAdministrationStore.hasDocument?.()) throw error;
                if (administrationCanBeProvisionedLater(error)) return null;
                throw error;
            }
            if (!context) {
                if (required) administrationUnavailable();
                return null;
            }
            const result = await operation(context.registry);
            context.registry.updatedAt = timestamp(now);
            await localAdministrationStore.write(context);
            return result;
        });
    }

    function makeAdministrativeRecord({
        entry,
        data,
        role = LOCAL_IDENTITY_ROLES.USER,
        provider = "local",
        passwordChangeRequired = false,
        recordLogin = true
    }) {
        const instant = timestamp(now);
        return createAdministrativeUserRecord({
            accountId: entry.id,
            identifier: data.account.identifier,
            displayName: data.account.displayName,
            role,
            provider,
            createdAt: instant,
            updatedAt: instant,
            lastLoginAt: recordLogin ? instant : "",
            lastLoginProvider: provider,
            passwordChangeRequired
        });
    }

    function activeLockRecord(recordForAccount, instant) {
        if (!recordForAccount) return false;
        if (recordForAccount.blocked === true) return true;
        const lockedUntil = recordForAccount.lockedUntil ? new Date(recordForAccount.lockedUntil).getTime() : Number.NaN;
        return Number.isFinite(lockedUntil) && lockedUntil > new Date(instant).getTime();
    }

    async function synchronizeAdministrativeLogin({
        entry,
        data,
        role = LOCAL_IDENTITY_ROLES.USER,
        provider = "local",
        passwordChangeRequired = false,
        requireNoExistingAdmin = false,
        recordLogin = true,
        required = false
    }) {
        const normalizedProviderName = normalizeAdministrativeProvider(provider);
        const instant = timestamp(now);
        const result = await mutateAdministrativeRegistry((registry) => {
            const existing = administrativeRecordForAccount(registry, entry.id);
            if (requireNoExistingAdmin === true
                && !existing
                && registry.users.some((candidate) => candidate.role === LOCAL_IDENTITY_ROLES.ADMIN)) {
                fail("ADMIN_BOOTSTRAP_ALREADY_COMPLETED", "Ya existe una cuenta administradora local.");
            }
            const user = existing || makeAdministrativeRecord({
                entry,
                data,
                role,
                provider: normalizedProviderName,
                passwordChangeRequired,
                recordLogin
            });
            if (activeLockRecord(user, instant)) {
                fail("ACCOUNT_LOCKED", "Esta cuenta local está bloqueada.");
            }
            const next = {
                ...user,
                identifier: data.account.identifier,
                displayName: data.account.displayName,
                provider: normalizedProviderName,
                lastLoginProvider: recordLogin ? normalizedProviderName : user.lastLoginProvider,
                lastLoginAt: recordLogin ? instant : user.lastLoginAt,
                failedLoginAttempts: 0,
                lockedUntil: "",
                updatedAt: instant
            };
            if (existing) {
                registry.users = registry.users.map((candidate) => candidate.accountId === entry.id ? next : candidate);
            } else {
                registry.users = [...registry.users, next];
            }
            return administrativeSecurity(next);
        }, { create: true, required });
        return result || administrativeSecurity();
    }

    async function recordAdministrativeFailure({ entry, identifier }) {
        if (!entry) return false;
        const instant = timestamp(now);
        const canonicalIdentifier = normalizedIdentifier(identifier);
        const result = await mutateAdministrativeRegistry((registry) => {
            const existing = administrativeRecordForAccount(registry, entry.id);
            const user = existing || createAdministrativeUserRecord({
                accountId: entry.id,
                identifier: canonicalIdentifier,
                displayName: canonicalIdentifier,
                createdAt: instant,
                updatedAt: instant
            });
            const attempts = user.failedLoginAttempts + 1;
            const becomesBlocked = attempts >= registry.policy.maxFailedAttempts;
            const next = {
                ...user,
                failedLoginAttempts: attempts,
                blocked: user.blocked === true || becomesBlocked,
                lockedUntil: "",
                updatedAt: instant
            };
            if (existing) {
                registry.users = registry.users.map((candidate) => candidate.accountId === entry.id ? next : candidate);
            } else {
                registry.users = [...registry.users, next];
            }
            return true;
        }, { create: true });
        return result === true;
    }

    function activate({ entry, vault, key, data, authenticatedAt, externalIdentity = null, security = null }) {
        const validData = validateAccountData(data, {
            accountId: vault.accountId,
            identifier: data?.account?.identifier
        });
        active = {
            entryId: entry.id,
            vault,
            key,
            data: validData,
            authenticatedAt,
            externalIdentity,
            security: {
                role: normalizeLocalIdentityRole(security?.role, LOCAL_IDENTITY_ROLES.USER),
                passwordChangeRequired: security?.passwordChangeRequired === true
            }
        };
        sessionGeneration += 1;
        return publishSession();
    }

    function requireActive() {
        if (!active) fail("AUTHENTICATION_REQUIRED", "Inicia sesión local para acceder a estos datos.");
        return active;
    }

    function requireWorkspaceAccess() {
        const state = requireActive();
        if (state.security?.passwordChangeRequired === true) {
            fail("PASSWORD_CHANGE_REQUIRED", "Debes cambiar la contraseña local antes de abrir proyectos o módulos.");
        }
        return state;
    }

    /**
     * A session can outlive an administrative decision made in another tab.
     * Project capabilities therefore re-read the authenticated, encrypted
     * administrative record before they are issued or used. A discovered
     * block revokes this in-memory session immediately; a forced password
     * change keeps it alive only for changeLocalPassword().
     */
    async function revalidateWorkspaceAccess(state = requireActive(), generation = sessionGeneration, operation = null) {
        return mutateIdentityVault(async () => {
        assertActiveState(state, generation);
        const currentIndex = vaultAdapter.read();
        if (!currentIndex?.entries?.some((entry) => entry.id === state.entryId)) {
            if (active === state && sessionGeneration === generation) {
                active = null;
                sessionGeneration += 1;
                publishSession();
            }
            fail("ACCOUNT_DELETED", "This local account was deleted by an administrator.");
        }
        let security = null;
        try {
            security = await mutateAdministrativeRegistry((registry) => {
                const user = administrativeRecordForAccount(registry, state.entryId);
                if (!user) {
                    fail("ACCOUNT_DELETED", "This local account is no longer present in the administrative directory.");
                }
                if (activeLockRecord(user, timestamp(now))) {
                    fail("ACCOUNT_LOCKED", "This local account is blocked.");
                }
                return administrativeSecurity(user);
            }, { required: false });
        } catch (error) {
            if (["ACCOUNT_LOCKED", "ACCOUNT_DELETED"].includes(error?.code)
                && active === state && sessionGeneration === generation) {
                active = null;
                sessionGeneration += 1;
                publishSession();
            }
            throw error;
        }
        assertActiveState(state, generation);
        if (security) state.security = security;
        if (state.security?.passwordChangeRequired === true) {
            fail("PASSWORD_CHANGE_REQUIRED", "Debes cambiar la contraseña local antes de abrir proyectos o módulos.");
        }
        if (typeof operation !== "function") return state;
        const result = await operation(state);
        assertActiveState(state, generation);
        return result;
        });
    }

    function assertActiveState(state, generation) {
        if (!active || active !== state || sessionGeneration !== generation) {
            fail("SESSION_CHANGED", "La sesión local cambió antes de terminar la operación.");
        }
        return state;
    }

    function externalProvidersAreOnline() {
        try {
            return (typeof online === "function" ? online() : online) === true;
        } catch {
            return false;
        }
    }

    function requireExternalProviderOnline() {
        if (!externalProvidersAreOnline()) {
            fail("EXTERNAL_PROVIDER_OFFLINE", "Google y Microsoft no están disponibles sin conexión a Internet.");
        }
    }

    function isSelectorKeyIssue(error) {
        return typeof error?.code === "string" && error.code.startsWith("SELECTOR_KEY_");
    }

    function requireSelectorKeyStore() {
        if (!identitySelectorKeyStore
            || typeof identitySelectorKeyStore.create !== "function"
            || typeof identitySelectorKeyStore.get !== "function") {
            fail("SELECTOR_KEY_STORAGE_UNAVAILABLE", "No hay un almacén seguro disponible para el selector de identidad.");
        }
        return identitySelectorKeyStore;
    }

    function selectorReference(keyRecord) {
        const id = text(keyRecord?.id);
        if (!id || !keyRecord?.key) {
            fail("SELECTOR_KEY_INVALID", "La clave local del selector no es válida.");
        }
        return { algorithm: IDENTITY_KEYED_SELECTOR_ALGORITHM, id };
    }

    async function existingSelectorKey(index) {
        if (index?.version !== IDENTITY_VAULT_INDEX_VERSION || !index.selectorKey?.id) return null;
        const keyRecord = await requireSelectorKeyStore().get(index.selectorKey.id);
        if (!keyRecord || keyRecord.id !== index.selectorKey.id || !keyRecord.key) return null;
        return keyRecord;
    }

    /** Provision a v2 key for registration, but never overwrite a missing key reference. */
    async function selectorContextForNewAccount(index) {
        if (index.version === IDENTITY_VAULT_INDEX_VERSION) {
            const keyRecord = await existingSelectorKey(index);
            if (!keyRecord) {
                fail("SELECTOR_KEY_NOT_FOUND", "No se ha encontrado la clave local que protege el selector de identidad.");
            }
            return { index, keyRecord };
        }
        const keyRecord = await requireSelectorKeyStore().create();
        return {
            index: {
                ...index,
                version: IDENTITY_VAULT_INDEX_VERSION,
                selectorKey: selectorReference(keyRecord)
            },
            keyRecord
        };
    }

    /**
     * A successful password unlock can recover a legacy selector or rotate a
     * lost selector-key reference. Other accounts remain readable through the
     * password-verified fallback and migrate one by one when they are opened.
     */
    async function selectorContextForMigration(index) {
        if (index.version === IDENTITY_VAULT_INDEX_VERSION) {
            const keyRecord = await existingSelectorKey(index);
            if (keyRecord) return { index, keyRecord };
        }
        const keyRecord = await requireSelectorKeyStore().create();
        return {
            index: {
                ...index,
                version: IDENTITY_VAULT_INDEX_VERSION,
                selectorKey: selectorReference(keyRecord)
            },
            keyRecord
        };
    }

    async function keyedSelectorFor(index, canonicalIdentifier) {
        try {
            const keyRecord = await existingSelectorKey(index);
            if (!keyRecord) return null;
            return {
                keyRecord,
                value: await hashLocalIdentifierWithSelectorKey(canonicalIdentifier, keyRecord.key, crypto)
            };
        } catch (error) {
            if (isSelectorKeyIssue(error)) return null;
            throw error;
        }
    }

    async function directlyMatchedEntries(index, canonicalIdentifier) {
        const legacySelector = await hashLegacyLocalIdentifier(canonicalIdentifier, crypto);
        const keyedSelector = await keyedSelectorFor(index, canonicalIdentifier);
        return index.entries.filter((entry) => (
            (entry.selector.algorithm === IDENTITY_KEYED_SELECTOR_ALGORITHM && keyedSelector?.value === entry.selector.value)
            || (entry.selector.algorithm !== IDENTITY_KEYED_SELECTOR_ALGORITHM && entry.selector.value === legacySelector)
        ));
    }

    async function unlockMatchingEntry({ index, canonicalIdentifier, password }) {
        const directMatches = await directlyMatchedEntries(index, canonicalIdentifier);
        // If a device-local HMAC key was cleared independently of localStorage,
        // authenticate candidates with the supplied password instead of making
        // that account unrecoverable. This fallback never exposes identifiers.
        const candidates = directMatches.length ? directMatches : index.entries;
        for (const entry of candidates) {
            try {
                const unlocked = await unlockEncryptedAccountVault({ vault: entry.vault, password }, crypto);
                const data = validateAccountData(unlocked.data, { accountId: entry.id, identifier: canonicalIdentifier });
                return { entry, unlocked, data };
            } catch (error) {
                if (error?.code === "WEB_CRYPTO_UNAVAILABLE") throw error;
            }
        }
        return null;
    }

    /**
     * Checks whether this device can identify a local account without opening
     * any encrypted account vault.  The result deliberately contains no
     * account id, profile data or selector value.
     *
     * `exists: null` is a fail-closed answer. It means a v2 account may be
     * present but the device-local HMAC selector key is unavailable, so
     * claiming that an identifier is free would be misleading. Legacy SHA-256
     * selectors remain readable solely to support the migration path.
     */
    async function getLocalAccountAvailability({ identifier } = {}) {
        const canonicalIdentifier = normalizedIdentifier(identifier);
        const index = vaultAdapter.read();
        if (!index?.entries?.length) return Object.freeze({ exists: false });

        const legacySelector = await hashLegacyLocalIdentifier(canonicalIdentifier, crypto);
        const legacyMatch = index.entries.some((entry) => (
            entry.selector.algorithm !== IDENTITY_KEYED_SELECTOR_ALGORITHM
            && entry.selector.value === legacySelector
        ));
        if (legacyMatch) return Object.freeze({ exists: true });

        const keyedSelector = await keyedSelectorFor(index, canonicalIdentifier);
        if (keyedSelector?.value) {
            return Object.freeze({
                exists: index.entries.some((entry) => (
                    entry.selector.algorithm === IDENTITY_KEYED_SELECTOR_ALGORITHM
                    && entry.selector.value === keyedSelector.value
                ))
            });
        }

        // Do not enumerate a v2 vault when its independent selector key is
        // missing or unusable. Login can still recover it with the password,
        // but an unauthenticated availability probe cannot safely decide.
        const hasKeyedAccounts = index.entries.some((entry) => (
            entry.selector.algorithm === IDENTITY_KEYED_SELECTOR_ALGORITHM
        ));
        return Object.freeze({ exists: hasKeyedAccounts ? null : false });
    }

    async function migrateUnlockedEntry(index, entry, unlocked, data) {
        const context = await selectorContextForMigration(index);
        const selector = await hashLocalIdentifierWithSelectorKey(data.account.identifier, context.keyRecord.key, crypto);
        const currentSelector = entry.selector;
        if (context.index === index
            && currentSelector.algorithm === IDENTITY_KEYED_SELECTOR_ALGORITHM
            && currentSelector.value === selector) {
            return { entry, vault: unlocked.vault };
        }
        const vault = await encryptAccountVaultData({
            vault: { ...unlocked.vault, identifierHash: selector },
            key: unlocked.key,
            data
        }, crypto);
        const replacement = {
            id: entry.id,
            selector: { algorithm: IDENTITY_KEYED_SELECTOR_ALGORITHM, value: selector },
            vault
        };
        const entries = context.index.entries.map((candidate) => candidate.id === entry.id ? replacement : candidate);
        const saved = vaultAdapter.write({ ...context.index, updatedAt: timestamp(now), entries });
        const savedEntry = saved.entries.find((candidate) => candidate.id === entry.id);
        return { entry: savedEntry, vault: savedEntry.vault };
    }

    async function migrateUnlockedEntryIfPossible(index, entry, unlocked, data) {
        try {
            return await migrateUnlockedEntry(index, entry, unlocked, data);
        } catch (error) {
            if (isSelectorKeyIssue(error)) return null;
            throw error;
        }
    }

    async function persistActive(expectedState = requireActive(), generation = sessionGeneration) {
        return mutateIdentityVault(async () => {
            const state = assertActiveState(expectedState, generation);
            const index = vaultAdapter.read();
            if (!index) fail("VAULT_NOT_FOUND", "No se ha encontrado la bóveda de la cuenta local.");
            const entryIndex = index.entries.findIndex((entry) => entry.id === state.entryId);
            if (entryIndex < 0) fail("VAULT_NOT_FOUND", "No se ha encontrado la bóveda de la cuenta local.");
            const encryptedVault = await encryptAccountVaultData({
                vault: state.vault,
                key: state.key,
                data: state.data
            }, crypto);
            assertActiveState(state, generation);
            const entries = [...index.entries];
            entries[entryIndex] = { ...entries[entryIndex], vault: encryptedVault };
            const saved = vaultAdapter.write({ ...index, updatedAt: timestamp(now), entries });
            state.vault = saved.entries[entryIndex].vault;
        });
    }

    /**
     * Reads and authenticates the vault entry that is physically stored at the
     * instant an identity-vault mutation lock is held.  In particular, callers
     * must not make a compare-and-swap decision from `state.data`, because a
     * separate browser tab can have written a newer encrypted envelope.
     */
    async function readFreshActiveAccountData(state, generation) {
        assertActiveState(state, generation);
        const index = vaultAdapter.read();
        if (!index) fail("VAULT_NOT_FOUND", "No se ha encontrado la boveda de la cuenta local.");
        const entryIndex = index.entries.findIndex((entry) => entry.id === state.entryId);
        if (entryIndex < 0) fail("VAULT_NOT_FOUND", "No se ha encontrado la boveda de la cuenta local.");
        const vault = index.entries[entryIndex].vault;
        const data = await openAccountVaultData({ vault, key: state.key }, crypto);
        assertActiveState(state, generation);
        return {
            index,
            entryIndex,
            vault,
            data: validateAccountData(data, {
                accountId: state.data.account.id,
                identifier: state.data.account.identifier
            })
        };
    }

    function createUnlockedVaultCapability(generation, accountId) {
        const assertLive = () => {
            if (!active || sessionGeneration !== generation || active.data.account.id !== accountId) {
                fail("VAULT_CAPABILITY_EXPIRED", "La sesión local ya no puede usar esta bóveda.");
            }
            if (active.security?.passwordChangeRequired === true) {
                fail("PASSWORD_CHANGE_REQUIRED", "Debes cambiar la contraseña local antes de abrir datos de proyecto.");
            }
            return active;
        };
        const revalidate = async (operation = null) => {
            const state = assertLive();
            return revalidateWorkspaceAccess(state, generation, operation);
        };
        const seal = async (value, { purpose = "project" } = {}) => {
            return revalidate((state) => sealAccountJson({ accountId, purpose, key: state.key, value }, crypto));
        };
        const open = async (envelope, { purpose = "project" } = {}) => {
            return revalidate((state) => openAccountJson({ accountId, purpose, key: state.key, envelope }, crypto));
        };
        return Object.freeze({
            accountId,
            seal,
            open,
            sealJson: seal,
            openJson: open
        });
    }

    async function createLocalAccountInternal({
        identifier,
        password,
        displayName,
        role = LOCAL_IDENTITY_ROLES.USER,
        passwordChangeRequired = false,
        allowAdminBootstrapIdentifier = false,
        administrationRequired = false,
        requireNoExistingAdmin = false,
        activateCreatedAccount = true
    } = {}) {
        return mutateIdentityVault(async () => {
            const canonicalIdentifier = normalizedIdentifier(identifier);
            if (canonicalIdentifier === ADMIN_BOOTSTRAP_IDENTIFIER && allowAdminBootstrapIdentifier !== true) {
                fail("ADMIN_BOOTSTRAP_REQUIRED", "La cuenta administrativa inicial debe crearse mediante el arranque seguro.");
            }
            const validPassword = validatedPassword(password);
            const accountDisplayName = normalizedDisplayName(displayName, canonicalIdentifier);
            const index = vaultAdapter.read() || createEmptyIdentityVaultIndex(timestamp(now));
            const context = await selectorContextForNewAccount(index);
            const selector = await hashLocalIdentifierWithSelectorKey(canonicalIdentifier, context.keyRecord.key, crypto);
            const legacySelector = await hashLegacyLocalIdentifier(canonicalIdentifier, crypto);
            if (context.index.entries.some((entry) => (
                (entry.selector.algorithm === IDENTITY_KEYED_SELECTOR_ALGORITHM && entry.selector.value === selector)
                || (entry.selector.algorithm !== IDENTITY_KEYED_SELECTOR_ALGORITHM && entry.selector.value === legacySelector)
            ))) {
                fail("IDENTIFIER_UNAVAILABLE", "Ya existe una cuenta local con esa identidad.");
            }
            const createdAt = timestamp(now);
            const accountId = accountIdFromCrypto(crypto);
            const data = createAccountData({
                accountId,
                identifier: canonicalIdentifier,
                displayName: accountDisplayName,
                createdAt
            });
            const encrypted = await createEncryptedAccountVault({
                accountId,
                identifierHash: selector,
                password: validPassword,
                data,
                ...(pbkdf2Iterations === undefined ? {} : { pbkdf2Iterations })
            }, crypto);
            const entry = {
                id: accountId,
                selector: { algorithm: IDENTITY_KEYED_SELECTOR_ALGORITHM, value: selector },
                vault: encrypted.vault
            };
            const saved = vaultAdapter.write({ ...context.index, updatedAt: createdAt, entries: [...context.index.entries, entry] });
            const savedEntry = saved.entries.find((candidate) => candidate.id === accountId);
            // If the admin directory cannot be created for a normal local
            // account, legacy local operation remains available. Bootstrap and
            // privileged creation, in contrast, are strictly fail-closed.
            let security;
            try {
                security = await synchronizeAdministrativeLogin({
                    entry: savedEntry,
                    data,
                    role,
                    provider: "local",
                    passwordChangeRequired,
                    requireNoExistingAdmin,
                    recordLogin: activateCreatedAccount === true,
                    required: administrationRequired
                });
            } catch (error) {
                // Bootstrap/admin creation has no safe degraded mode. Remove
                // the just-created vault entry before releasing the shared
                // vault lock, so a losing concurrent bootstrap cannot leave a
                // reserved identifier behind as an ordinary user account.
                if (administrationRequired) {
                    vaultAdapter.write({
                        ...saved,
                        updatedAt: timestamp(now),
                        entries: saved.entries.filter((candidate) => candidate.id !== accountId)
                    });
                }
                throw error;
            }
            const session = activateCreatedAccount === true
                ? activate({
                    entry: savedEntry,
                    vault: savedEntry.vault,
                    key: encrypted.key,
                    data,
                    authenticatedAt: createdAt,
                    security
                })
                : null;
            return Object.freeze({ account: publicAccount(data), session });
        });
    }

    async function requireAdministrativeAccess() {
        const state = requireWorkspaceAccess();
        if (state.security?.role !== LOCAL_IDENTITY_ROLES.ADMIN) {
            fail("ADMIN_ACCESS_REQUIRED", "Solo una cuenta administradora puede gestionar usuarios locales.");
        }
        const recordForAdmin = await mutateAdministrativeRegistry((registry) => {
            const current = administrativeRecordForAccount(registry, state.entryId);
            if (!current || current.role !== LOCAL_IDENTITY_ROLES.ADMIN || activeLockRecord(current, timestamp(now))) {
                fail("ADMIN_ACCESS_REQUIRED", "La cuenta administradora ya no tiene acceso a la gestión local.");
            }
            return current;
        }, { required: true });
        return { state, record: recordForAdmin };
    }

    function requireAdministrativeTarget(registry, accountId) {
        const targetId = text(accountId);
        const target = administrativeRecordForAccount(registry, targetId);
        if (!target) fail("ADMIN_USER_NOT_FOUND", "No se ha encontrado el usuario local solicitado.");
        return target;
    }

    function administrativeRoleCount(registry) {
        return registry.users.filter((candidate) => candidate.role === LOCAL_IDENTITY_ROLES.ADMIN).length;
    }

    function normalizeAdministrativePatch(target, patch, instant) {
        const source = record(patch) || {};
        const allowed = new Set(["role", "blocked", "notes", "passwordChangeRequired"]);
        if (Object.keys(source).some((key) => !allowed.has(key))) {
            fail("ADMIN_USER_UPDATE_INVALID", "La actualización administrativa contiene campos no permitidos.");
        }
        const next = {
            ...target,
            ...(source.role === undefined ? {} : { role: normalizeLocalIdentityRole(source.role) }),
            ...(source.blocked === undefined ? {} : { blocked: source.blocked === true }),
            ...(source.notes === undefined ? {} : { notes: String(source.notes ?? "") }),
            ...(source.passwordChangeRequired === undefined ? {} : { passwordChangeRequired: source.passwordChangeRequired === true }),
            updatedAt: instant
        };
        if (source.blocked === false) {
            next.failedLoginAttempts = 0;
            next.lockedUntil = "";
        }
        return createAdministrativeUserRecord(next);
    }

    return Object.freeze({
        /** Always null on a fresh service instance: no automatic login exists. */
        getSession() {
            return currentSession();
        },

        /**
         * Local-only email/identifier-first sign-in probe. This never unlocks
         * a vault and never returns user data; see its fail-closed `null`
         * result when the local HMAC selector key is unavailable.
         */
        getLocalAccountAvailability,

        subscribe(listener) {
            if (typeof listener !== "function") return () => {};
            listeners.add(listener);
            listener(currentSession());
            return () => listeners.delete(listener);
        },

        async registerLocalAccount({ identifier, password, displayName } = {}) {
            return createLocalAccountInternal({ identifier, password, displayName });
        },

        /**
         * One-time local bootstrap. There is deliberately no embedded admin
         * password: the operator chooses it at this moment and only the
         * encrypted administrative registry receives the admin role.
         */
        async bootstrapAdminAccount({ identifier, password, displayName } = {}) {
            if (normalizedIdentifier(identifier) !== ADMIN_BOOTSTRAP_IDENTIFIER) {
                fail("ADMIN_BOOTSTRAP_IDENTIFIER_REQUIRED", `La cuenta administrativa inicial debe ser ${ADMIN_BOOTSTRAP_IDENTIFIER}.`);
            }
            return createLocalAccountInternal({
                identifier,
                password,
                displayName,
                role: LOCAL_IDENTITY_ROLES.ADMIN,
                allowAdminBootstrapIdentifier: true,
                administrationRequired: true,
                requireNoExistingAdmin: true
            });
        },

        async listAdministrativeUsers() {
            await requireAdministrativeAccess();
            const users = await mutateAdministrativeRegistry((registry) => registry.users
                .map((user) => publicAdministrativeUser(user))
                .sort((left, right) => left.identifier.localeCompare(right.identifier)), { required: true });
            return Object.freeze(users);
        },

        async getAdministrativeLoginPolicy() {
            await requireAdministrativeAccess();
            const policy = await mutateAdministrativeRegistry((registry) => ({ ...registry.policy }), { required: true });
            return Object.freeze(policy);
        },

        async setAdministrativeLoginPolicy(policy) {
            await requireAdministrativeAccess();
            const nextPolicy = normalizeAdminLoginPolicy(policy);
            const saved = await mutateAdministrativeRegistry((registry) => {
                registry.policy = { ...nextPolicy };
                return { ...registry.policy };
            }, { required: true });
            return Object.freeze(saved);
        },

        async createAdministrativeUser({
            identifier,
            password,
            displayName,
            role = LOCAL_IDENTITY_ROLES.USER,
            notes = "",
            passwordChangeRequired = true
        } = {}) {
            await requireAdministrativeAccess();
            const normalizedRole = normalizeLocalIdentityRole(role);
            const created = await createLocalAccountInternal({
                identifier,
                password,
                displayName,
                role: normalizedRole,
                passwordChangeRequired: passwordChangeRequired === true,
                administrationRequired: true,
                activateCreatedAccount: false
            });
            const user = await mutateAdministrativeRegistry((registry) => {
                const target = requireAdministrativeTarget(registry, created.account.id);
                const next = normalizeAdministrativePatch(target, { notes }, timestamp(now));
                registry.users = registry.users.map((candidate) => candidate.accountId === target.accountId ? next : candidate);
                return publicAdministrativeUser(next);
            }, { required: true });
            return Object.freeze({ account: created.account, user });
        },

        async updateAdministrativeUser({ accountId, ...patch } = {}) {
            const { state } = await requireAdministrativeAccess();
            const updated = await mutateAdministrativeRegistry((registry) => {
                const requester = requireAdministrativeTarget(registry, state.entryId);
                if (requester.role !== LOCAL_IDENTITY_ROLES.ADMIN || activeLockRecord(requester, timestamp(now))) {
                    fail("ADMIN_ACCESS_REQUIRED", "La cuenta administradora ya no tiene acceso a la gestión local.");
                }
                const target = requireAdministrativeTarget(registry, accountId);
                const next = normalizeAdministrativePatch(target, patch, timestamp(now));
                if (target.accountId === state.entryId
                    && (next.role !== target.role || next.blocked !== target.blocked || next.passwordChangeRequired !== target.passwordChangeRequired)) {
                    fail("ADMIN_SELF_UPDATE_FORBIDDEN", "Una cuenta administradora no puede revocar su propio acceso.");
                }
                if (target.role === LOCAL_IDENTITY_ROLES.ADMIN
                    && next.role !== LOCAL_IDENTITY_ROLES.ADMIN
                    && administrativeRoleCount(registry) <= 1) {
                    fail("ADMIN_LAST_ADMIN_REQUIRED", "Debe permanecer al menos una cuenta administradora local.");
                }
                registry.users = registry.users.map((candidate) => candidate.accountId === target.accountId ? next : candidate);
                return publicAdministrativeUser(next);
            }, { required: true });
            return updated;
        },

        async forcePasswordChange({ accountId } = {}) {
            const { state } = await requireAdministrativeAccess();
            const updated = await mutateAdministrativeRegistry((registry) => {
                const requester = requireAdministrativeTarget(registry, state.entryId);
                if (requester.role !== LOCAL_IDENTITY_ROLES.ADMIN) fail("ADMIN_ACCESS_REQUIRED", "La cuenta administradora ya no tiene acceso.");
                const target = requireAdministrativeTarget(registry, accountId);
                if (target.accountId === state.entryId) {
                    fail("ADMIN_SELF_UPDATE_FORBIDDEN", "Una cuenta administradora no puede forzar su propio cierre de acceso.");
                }
                const next = createAdministrativeUserRecord({
                    ...target,
                    passwordChangeRequired: true,
                    passwordResetRequestedAt: "",
                    updatedAt: timestamp(now)
                });
                registry.users = registry.users.map((candidate) => candidate.accountId === target.accountId ? next : candidate);
                return publicAdministrativeUser(next);
            }, { required: true });
            return updated;
        },

        /**
         * Marks a generic local reset request as handled without changing the
         * user's password or silently removing a separately forced change.
         * Password replacement remains a user-held cryptographic operation
         * through changeLocalPassword().
         */
        async clearAdministrativePasswordResetRequest({ accountId } = {}) {
            await requireAdministrativeAccess();
            const updated = await mutateAdministrativeRegistry((registry) => {
                const target = requireAdministrativeTarget(registry, accountId);
                const next = createAdministrativeUserRecord({
                    ...target,
                    passwordResetRequestedAt: "",
                    updatedAt: timestamp(now)
                });
                registry.users = registry.users.map((candidate) => candidate.accountId === target.accountId ? next : candidate);
                return publicAdministrativeUser(next);
            }, { required: true });
            return updated;
        },

        // Concise alias retained for the local-facing React hook. It has the
        // same authorization and encrypted mutation semantics as the fully
        // named administrative method above.
        async clearLocalPasswordResetRequest({ accountId } = {}) {
            await requireAdministrativeAccess();
            const updated = await mutateAdministrativeRegistry((registry) => {
                const target = requireAdministrativeTarget(registry, accountId);
                const next = createAdministrativeUserRecord({
                    ...target,
                    passwordResetRequestedAt: "",
                    updatedAt: timestamp(now)
                });
                registry.users = registry.users.map((candidate) => candidate.accountId === target.accountId ? next : candidate);
                return publicAdministrativeUser(next);
            }, { required: true });
            return updated;
        },

        async deleteAdministrativeUser({ accountId } = {}) {
            const { state } = await requireAdministrativeAccess();
            const targetId = text(accountId);
            if (!targetId) fail("ADMIN_USER_NOT_FOUND", "No se ha encontrado el usuario local solicitado.");
            if (targetId === state.entryId) {
                fail("ADMIN_SELF_DELETE_FORBIDDEN", "Una cuenta administradora no puede eliminarse a sí misma.");
            }
            return mutateIdentityVault(async () => {
                const index = vaultAdapter.read();
                const entryIndex = index?.entries?.findIndex((entry) => entry.id === targetId) ?? -1;
                if (entryIndex < 0) fail("ADMIN_USER_NOT_FOUND", "No se ha encontrado la cuenta local solicitada.");
                const target = await mutateAdministrativeRegistry((registry) => {
                    const requester = requireAdministrativeTarget(registry, state.entryId);
                    if (requester.role !== LOCAL_IDENTITY_ROLES.ADMIN) fail("ADMIN_ACCESS_REQUIRED", "La cuenta administradora ya no tiene acceso.");
                    const current = requireAdministrativeTarget(registry, targetId);
                    if (current.role === LOCAL_IDENTITY_ROLES.ADMIN && administrativeRoleCount(registry) <= 1) {
                        fail("ADMIN_LAST_ADMIN_REQUIRED", "Debe permanecer al menos una cuenta administradora local.");
                    }
                    return current;
                }, { required: true });
                const nextIndex = vaultAdapter.write({
                    ...index,
                    updatedAt: timestamp(now),
                    entries: index.entries.filter((entry) => entry.id !== targetId)
                });
                await mutateAdministrativeRegistry((registry) => {
                    registry.users = registry.users.filter((user) => user.accountId !== targetId);
                    return true;
                }, { required: true });
                return Object.freeze({ accountId: target.accountId, deleted: nextIndex.entries.every((entry) => entry.id !== targetId) });
            });
        },

        /**
         * A deliberately generic, unauthenticated local request. It never
         * says whether an identifier exists; an administrator may later turn
         * the encrypted request into a forced password-change marker.
         */
        async requestLocalPasswordReset({ identifier } = {}) {
            try {
                const canonicalIdentifier = normalizedIdentifier(identifier);
                await mutateIdentityVault(async () => {
                    const index = vaultAdapter.read();
                    if (!index?.entries?.length) return;
                    const entry = (await directlyMatchedEntries(index, canonicalIdentifier))[0];
                    if (!entry) return;
                    await mutateAdministrativeRegistry((registry) => {
                        const existing = administrativeRecordForAccount(registry, entry.id);
                        const user = existing || createAdministrativeUserRecord({
                            accountId: entry.id,
                            identifier: canonicalIdentifier,
                            displayName: canonicalIdentifier,
                            createdAt: timestamp(now),
                            updatedAt: timestamp(now)
                        });
                        const next = createAdministrativeUserRecord({
                            ...user,
                            passwordResetRequestedAt: timestamp(now),
                            updatedAt: timestamp(now)
                        });
                        if (existing) {
                            registry.users = registry.users.map((candidate) => candidate.accountId === entry.id ? next : candidate);
                        } else {
                            registry.users = [...registry.users, next];
                        }
                        return true;
                    }, { create: true });
                });
            } catch {
                // A forgot-password surface must not become an account or
                // local-storage oracle. The generic accepted response remains
                // identical for malformed, absent and unavailable accounts.
            }
            return Object.freeze({ accepted: true });
        },

        async loginLocalAccount({ identifier, password } = {}) {
            let canonicalIdentifier = "";
            try {
                return await mutateIdentityVault(async () => {
                    canonicalIdentifier = normalizedIdentifier(identifier);
                    if (typeof password !== "string" || !password) throw invalidCredentials();
                    const index = vaultAdapter.read();
                    if (!index) throw invalidCredentials();
                    const directMatches = await directlyMatchedEntries(index, canonicalIdentifier);
                    const match = await unlockMatchingEntry({ index, canonicalIdentifier, password });
                    if (!match) {
                        await recordAdministrativeFailure({ entry: directMatches[0], identifier: canonicalIdentifier });
                        throw invalidCredentials();
                    }
                    const migrated = await migrateUnlockedEntryIfPossible(index, match.entry, match.unlocked, match.data);
                    const entry = migrated?.entry || match.entry;
                    const vault = migrated?.vault || match.unlocked.vault;
                    // The administrative decision happens only after the
                    // password has authenticated this exact encrypted entry.
                    // A correct credential therefore receives ACCOUNT_LOCKED,
                    // while wrong credentials retain the generic response.
                    const security = await synchronizeAdministrativeLogin({
                        entry,
                        data: match.data,
                        provider: "local"
                    });
                    const session = activate({
                        entry,
                        vault,
                        key: match.unlocked.key,
                        data: match.data,
                        authenticatedAt: timestamp(now),
                        security
                    });
                    return Object.freeze({ account: publicAccount(match.data), session });
                });
            } catch (error) {
                if (error?.code === "WEB_CRYPTO_UNAVAILABLE"
                    || error?.code === "LOCAL_STORAGE_UNAVAILABLE"
                    || error?.code === "ACCOUNT_LOCKED"
                    || String(error?.code || "").startsWith("ADMIN_REGISTRY_")) throw error;
                throw invalidCredentials();
            }
        },

        logout() {
            const wasAuthenticated = Boolean(active);
            active = null;
            sessionGeneration += 1;
            publishSession();
            return wasAuthenticated;
        },

        getAccount() {
            return publicAccount(requireActive().data);
        },

        getProfile() {
            return publicProfile(requireActive().data);
        },

        /** Current identity may be local, Google, or Microsoft; account/profile stay local companions. */
        getIdentity() {
            return currentSession();
        },

        /**
         * Re-encrypts the active local vault with a caller-supplied password.
         * An administrator can only mark this operation as required; it never
         * knows, exports, or replaces another user's cryptographic password.
         */
        async changeLocalPassword({ currentPassword, newPassword } = {}) {
            const state = requireActive();
            const generation = sessionGeneration;
            const nextPassword = validatedPassword(newPassword);
            return mutateIdentityVault(async () => {
                const fresh = await readFreshActiveAccountData(state, generation);
                let verified;
                try {
                    verified = await unlockEncryptedAccountVault({ vault: fresh.vault, password: currentPassword }, crypto);
                    validateAccountData(verified.data, {
                        accountId: fresh.data.account.id,
                        identifier: fresh.data.account.identifier
                    });
                } catch (error) {
                    if (error?.code === "WEB_CRYPTO_UNAVAILABLE") throw error;
                    throw invalidCredentials();
                }
                const replacement = await createEncryptedAccountVault({
                    accountId: fresh.data.account.id,
                    identifierHash: fresh.vault.identifierHash,
                    password: nextPassword,
                    data: fresh.data,
                    pbkdf2Iterations: fresh.vault.kdf.iterations
                }, crypto);
                assertActiveState(state, generation);
                const entries = [...fresh.index.entries];
                entries[fresh.entryIndex] = { ...entries[fresh.entryIndex], vault: replacement.vault };
                const saved = vaultAdapter.write({ ...fresh.index, updatedAt: timestamp(now), entries });
                state.key = replacement.key;
                state.vault = saved.entries[fresh.entryIndex].vault;
                state.data = fresh.data;
                let security = state.security;
                try {
                    const updatedSecurity = await mutateAdministrativeRegistry((registry) => {
                        const user = administrativeRecordForAccount(registry, state.entryId);
                        if (!user) return administrativeSecurity();
                        const next = createAdministrativeUserRecord({
                            ...user,
                            passwordChangeRequired: false,
                            passwordResetRequestedAt: "",
                            failedLoginAttempts: 0,
                            lockedUntil: "",
                            updatedAt: timestamp(now)
                        });
                        registry.users = registry.users.map((candidate) => candidate.accountId === state.entryId ? next : candidate);
                        return administrativeSecurity(next);
                    }, { required: state.security?.passwordChangeRequired === true });
                    security = updatedSecurity || administrativeSecurity();
                } catch (error) {
                    // The vault has changed but its administrative marker did
                    // not. Keeping the restricted state is the safe outcome;
                    // a retry with the new current password can clear it once
                    // the local administrative key is available again.
                    state.security = { ...state.security, passwordChangeRequired: true };
                    sessionGeneration += 1;
                    publishSession();
                    throw error;
                }
                state.security = security;
                state.authenticatedAt = timestamp(now);
                sessionGeneration += 1;
                return publishSession();
            });
        },

        async updateProfile({ displayName } = {}) {
            const state = requireActive();
            const generation = sessionGeneration;
            const nextDisplayName = normalizedDisplayName(displayName, state.data.account.identifier);
            const updatedAt = timestamp(now);
            state.data = {
                ...state.data,
                account: { ...state.data.account, displayName: nextDisplayName, updatedAt },
                profile: { ...state.data.profile, displayName: nextDisplayName, updatedAt }
            };
            await persistActive(state, generation);
            publishSession();
            return publicProfile(state.data);
        },

        /**
         * Returns an opaque encryption capability for a currently open local
         * account.  It never exposes the non-extractable AES CryptoKey and is
         * invalidated on logout or when another account becomes active.
         */
        async getUnlockedVault() {
            const state = requireActive();
            const generation = sessionGeneration;
            await revalidateWorkspaceAccess(state, generation);
            return createUnlockedVaultCapability(generation, state.data.account.id);
        },

        /**
         * Completes a provider identity only after a trusted OAuth handler has
         * stored an encrypted envelope in this already-unlocked local vault.
         * Raw provider tokens are rejected here by shape: UI code passes only
         * the envelope returned by getProviderTokenEnvelope().
         */
        async completeExternalIdentity({ provider, identity, tokenEnvelope } = {}) {
            const state = requireActive();
            const generation = sessionGeneration;
            requireExternalProviderOnline();
            const normalizedProviderName = normalizedProvider(provider);
            const storedEnvelope = state.data.providerTokenEnvelopes[normalizedProviderName];
            if (!storedEnvelope) fail("PROVIDER_TOKEN_NOT_FOUND", "Primero debe guardarse un token cifrado del proveedor.");
            if (providerTokenNeedsRenewal(storedEnvelope, now)) {
                fail("PROVIDER_TOKEN_RENEWAL_REQUIRED", "El token del proveedor ha expirado y requiere una autorización interactiva nueva.");
            }
            if (!sameEncryptedEnvelope(tokenEnvelope, storedEnvelope)) {
                fail("EXTERNAL_IDENTITY_ENVELOPE_INVALID", "La identidad externa debe usar el sobre cifrado de esta cuenta local.");
            }
            const authorizedIdentity = normalizeExternalIdentity(normalizedProviderName, identity);
            const updatedAt = timestamp(now);
            const previous = state.data.externalIdentities[normalizedProviderName];
            const externalIdentity = {
                ...authorizedIdentity,
                linkedAt: previous?.linkedAt || updatedAt,
                updatedAt
            };
            state.data = {
                ...state.data,
                externalIdentities: { ...state.data.externalIdentities, [normalizedProviderName]: externalIdentity }
            };
            await persistActive(state, generation);
            // Keep the admin-visible provider metadata in the separately
            // encrypted registry. The regular selector index intentionally
            // remains opaque and must not acquire this user information.
            const security = await synchronizeAdministrativeLogin({
                entry: { id: state.entryId },
                data: state.data,
                provider: normalizedProviderName
            });
            state.externalIdentity = externalIdentity;
            state.security = security || state.security;
            state.authenticatedAt = updatedAt;
            sessionGeneration += 1;
            return publishSession();
        },

        /**
         * Re-enters a previously linked Google/Microsoft identity from its
         * unlocked local companion.  It does not call a provider or pretend
         * that an expired token can be refreshed offline.
         */
        async startExternalSession({ provider, subject } = {}) {
            const state = requireActive();
            requireExternalProviderOnline();
            const normalizedProviderName = normalizedProvider(provider);
            const externalIdentity = state.data.externalIdentities[normalizedProviderName];
            const envelope = state.data.providerTokenEnvelopes[normalizedProviderName];
            if (!externalIdentity || externalIdentity.subject !== text(subject) || !envelope) {
                fail("EXTERNAL_IDENTITY_NOT_LINKED", "No existe una identidad externa vinculada a esta cuenta local.");
            }
            if (providerTokenNeedsRenewal(envelope, now)) {
                fail("PROVIDER_TOKEN_RENEWAL_REQUIRED", "La identidad externa requiere una autorización interactiva nueva.");
            }
            const security = await synchronizeAdministrativeLogin({
                entry: { id: state.entryId },
                data: state.data,
                provider: normalizedProviderName
            });
            state.externalIdentity = externalIdentity;
            state.security = security || state.security;
            state.authenticatedAt = timestamp(now);
            sessionGeneration += 1;
            return publishSession();
        },

        /** Return to the active local companion without writing a session to disk. */
        useLocalIdentity() {
            const state = requireActive();
            if (!state.externalIdentity) return currentSession();
            state.externalIdentity = null;
            state.authenticatedAt = timestamp(now);
            sessionGeneration += 1;
            return publishSession();
        },

        async storeProviderTokens(provider, tokens) {
            const state = requireActive();
            const generation = sessionGeneration;
            requireExternalProviderOnline();
            const normalizedProviderName = normalizedProvider(provider);
            const tokenPayload = normalizedTokenPayload(tokens);
            const envelope = await createProviderTokenEnvelope({
                accountId: state.data.account.id,
                provider: normalizedProviderName,
                key: state.key,
                tokens: tokenPayload,
                createdAt: timestamp(now),
                expiresAt: tokenPayload.expiresAt
            }, crypto);
            assertActiveState(state, generation);
            state.data = {
                ...state.data,
                providerTokenEnvelopes: { ...state.data.providerTokenEnvelopes, [normalizedProviderName]: envelope }
            };
            await persistActive(state, generation);
            return providerEnvelopeSummary(envelope);
        },

        /** Returns encrypted metadata only; no access/refresh token is returned. */
        getProviderTokenEnvelope(provider) {
            const state = requireActive();
            const envelope = state.data.providerTokenEnvelopes[normalizedProvider(provider)];
            return envelope ? frozenClone(envelope) : null;
        },

        /** Safe token lifecycle metadata; it never contains a plaintext token. */
        getProviderTokenStatus(provider) {
            const state = requireActive();
            const envelope = state.data.providerTokenEnvelopes[normalizedProvider(provider)];
            if (!envelope) return null;
            return Object.freeze({
                ...providerEnvelopeSummary(envelope),
                renewalRequired: true,
                expired: providerTokenNeedsRenewal(envelope, now),
                available: externalProvidersAreOnline() && !providerTokenNeedsRenewal(envelope, now)
            });
        },

        /**
         * The sole token-consumption escape hatch.  Plaintext exists only for
         * the duration of `consumer` and is never returned by this API or put
         * in browser events/storage.  The caller is responsible for not
         * logging its callback argument.
         */
        async withProviderTokens(provider, consumer) {
            if (typeof consumer !== "function") fail("TOKEN_CONSUMER_INVALID", "Se necesita una función para usar el token del proveedor.");
            const state = requireActive();
            const generation = sessionGeneration;
            requireExternalProviderOnline();
            const normalizedProviderName = normalizedProvider(provider);
            const envelope = state.data.providerTokenEnvelopes[normalizedProviderName];
            if (!envelope) fail("PROVIDER_TOKEN_NOT_FOUND", "No hay un token local para este proveedor.");
            if (providerTokenNeedsRenewal(envelope, now)) {
                fail("PROVIDER_TOKEN_RENEWAL_REQUIRED", "El token del proveedor ha expirado y necesita una renovación interactiva.");
            }
            const tokens = await openProviderTokenEnvelope({
                accountId: state.data.account.id,
                provider: normalizedProviderName,
                key: state.key,
                envelope
            }, crypto);
            assertActiveState(state, generation);
            return consumer(Object.freeze(cloneJson(tokens)));
        },

        /**
         * Atomically removes a provider envelope only when the currently
         * persisted encrypted payload is the exact envelope the caller saw.
         *
         * Cancellation cleanup uses this instead of a read-then-remove pair:
         * the current entry is re-read and authenticated under the same vault
         * mutation lock used for writes, so an OAuth flow in another tab that
         * wrote a newer envelope always wins.
         */
        async removeProviderTokensIfMatching(provider, expectedEnvelope) {
            const state = requireActive();
            const generation = sessionGeneration;
            const normalizedProviderName = normalizedProvider(provider);
            let expected;
            try {
                expected = cloneJson(expectedEnvelope);
            } catch {
                return false;
            }
            return mutateIdentityVault(async () => {
                const fresh = await readFreshActiveAccountData(state, generation);
                const persistedEnvelope = fresh.data.providerTokenEnvelopes[normalizedProviderName];
                if (!sameEncryptedEnvelope(persistedEnvelope, expected)) return false;

                const providerTokenEnvelopes = { ...fresh.data.providerTokenEnvelopes };
                const externalIdentities = { ...fresh.data.externalIdentities };
                delete providerTokenEnvelopes[normalizedProviderName];
                delete externalIdentities[normalizedProviderName];
                const nextData = { ...fresh.data, providerTokenEnvelopes, externalIdentities };
                const encryptedVault = await encryptAccountVaultData({
                    vault: fresh.vault,
                    key: state.key,
                    data: nextData
                }, crypto);
                assertActiveState(state, generation);
                const entries = [...fresh.index.entries];
                entries[fresh.entryIndex] = { ...entries[fresh.entryIndex], vault: encryptedVault };
                const saved = vaultAdapter.write({ ...fresh.index, updatedAt: timestamp(now), entries });
                state.data = nextData;
                state.vault = saved.entries[fresh.entryIndex].vault;
                if (state.externalIdentity?.provider === normalizedProviderName) {
                    state.externalIdentity = null;
                    state.authenticatedAt = timestamp(now);
                    sessionGeneration += 1;
                    publishSession();
                }
                return true;
            });
        },

        async removeProviderTokens(provider) {
            const state = requireActive();
            const generation = sessionGeneration;
            const normalizedProviderName = normalizedProvider(provider);
            if (!state.data.providerTokenEnvelopes[normalizedProviderName]) return false;
            const providerTokenEnvelopes = { ...state.data.providerTokenEnvelopes };
            const externalIdentities = { ...state.data.externalIdentities };
            delete providerTokenEnvelopes[normalizedProviderName];
            delete externalIdentities[normalizedProviderName];
            state.data = { ...state.data, providerTokenEnvelopes, externalIdentities };
            await persistActive(state, generation);
            if (state.externalIdentity?.provider === normalizedProviderName) {
                state.externalIdentity = null;
                state.authenticatedAt = timestamp(now);
                sessionGeneration += 1;
                publishSession();
            }
            return true;
        }
    });
}
