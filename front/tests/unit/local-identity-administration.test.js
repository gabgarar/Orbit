import assert from "node:assert/strict";
import test from "node:test";

import {
    ADMIN_REGISTRY_STORAGE_KEY,
    createInMemoryIdentityAdministrativeRecoveryKeyStore,
    createInMemoryIdentityAdminRegistryKeyStore,
    createLocalAdministrativeRegistryStore,
    LOCAL_IDENTITY_ROLES
} from "../../js/features/identity/identityAdministration.js";
import {
    createGuardedLocalStorageAdapter,
    createInMemoryIdentitySelectorKeyStore
} from "../../js/features/identity/identityVault.js";
import { createLocalIdentityService } from "../../js/features/identity/localIdentity.js";
import { createUserProjectLibrary } from "../../js/features/projects/userProjectLibrary.js";

class MemoryStorage {
    #values = new Map();

    getItem(key) {
        return this.#values.has(key) ? this.#values.get(key) : null;
    }

    setItem(key, value) {
        this.#values.set(key, String(value));
    }

    removeItem(key) {
        this.#values.delete(key);
    }

    dump() {
        return [...this.#values.values()].join("\n");
    }
}

const PASSWORD = "correct horse battery staple";
const NEXT_PASSWORD = "a newer correct horse battery staple";
const THIRD_PASSWORD = "an even newer correct horse battery staple";
const T0 = "2026-08-22T10:00:00.000Z";
const T1 = "2026-08-22T10:15:00.000Z";

const selectorKeyStores = new WeakMap();
const adminKeyStores = new WeakMap();
const recoveryKeyStores = new WeakMap();

function selectorKeyStoreFor(storage) {
    let keyStore = selectorKeyStores.get(storage);
    if (!keyStore) {
        keyStore = createInMemoryIdentitySelectorKeyStore();
        selectorKeyStores.set(storage, keyStore);
    }
    return keyStore;
}

function adminKeyStoreFor(storage) {
    let keyStore = adminKeyStores.get(storage);
    if (!keyStore) {
        keyStore = createInMemoryIdentityAdminRegistryKeyStore();
        adminKeyStores.set(storage, keyStore);
    }
    return keyStore;
}

function recoveryKeyStoreFor(storage) {
    let keyStore = recoveryKeyStores.get(storage);
    if (!keyStore) {
        keyStore = createInMemoryIdentityAdministrativeRecoveryKeyStore();
        recoveryKeyStores.set(storage, keyStore);
    }
    return keyStore;
}

function serviceFor(storage, options = {}) {
    return createLocalIdentityService({
        storage,
        selectorKeyStore: selectorKeyStoreFor(storage),
        adminRegistryKeyStore: adminKeyStoreFor(storage),
        adminRecoveryKeyStore: recoveryKeyStoreFor(storage),
        pbkdf2Iterations: 100_000,
        now: () => T0,
        online: true,
        ...options
    });
}

function rejectsWithCode(code) {
    return (error) => error?.code === code;
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });
    return { promise, resolve, reject };
}

function cryptoWithToggleableDeriveFailure(control) {
    const nativeCrypto = globalThis.crypto;
    const subtle = new Proxy(nativeCrypto.subtle, {
        get(target, property) {
            const value = Reflect.get(target, property, target);
            if (property === "deriveKey") {
                return async (...argumentsForDerivation) => {
                    if (control.failDeriveKey === true) {
                        throw new Error("Injected account-key derivation failure");
                    }
                    return value.apply(target, argumentsForDerivation);
                };
            }
            return typeof value === "function" ? value.bind(target) : value;
        }
    });
    return {
        getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
        randomUUID: nativeCrypto.randomUUID?.bind(nativeCrypto),
        subtle
    };
}

function cryptoWithPausedSecondAccountVaultEncryption(control) {
    const nativeCrypto = globalThis.crypto;
    const decoder = new TextDecoder();
    control.armed = false;
    control.accountVaultEncryptions = 0;
    const subtle = new Proxy(nativeCrypto.subtle, {
        get(target, property) {
            const value = Reflect.get(target, property, target);
            if (property === "encrypt") {
                return async (...argumentsForEncryption) => {
                    const additionalData = argumentsForEncryption[0]?.additionalData;
                    const isAccountVault = additionalData
                        && decoder.decode(additionalData).startsWith("orbit.identity.account-vault|");
                    if (control.armed === true && isAccountVault) {
                        control.accountVaultEncryptions += 1;
                        if (control.accountVaultEncryptions === 2) {
                            control.reached.resolve();
                            await control.release.promise;
                        }
                    }
                    return value.apply(target, argumentsForEncryption);
                };
            }
            return typeof value === "function" ? value.bind(target) : value;
        }
    });
    return {
        getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
        randomUUID: nativeCrypto.randomUUID?.bind(nativeCrypto),
        subtle
    };
}

function createCrashableWebLockManager() {
    const states = new Map();
    const stateFor = (name) => {
        const existing = states.get(name);
        if (existing) return existing;
        const created = { holder: null, queue: [] };
        states.set(name, created);
        return created;
    };
    const pump = (state) => {
        if (state.holder || state.queue.length === 0) return;
        const request = state.queue.shift();
        const holder = {};
        state.holder = holder;
        Promise.resolve()
            .then(() => request.callback(Object.freeze({ name: request.name, mode: "exclusive" })))
            .then(request.resolve, request.reject)
            .finally(() => {
                if (state.holder === holder) {
                    state.holder = null;
                    pump(state);
                }
            });
    };
    return Object.freeze({
        request(name, options, callback) {
            const requestOptions = typeof options === "function" ? {} : (options || {});
            const operation = typeof options === "function" ? options : callback;
            if (typeof operation !== "function") return Promise.reject(new TypeError("A Web Lock callback is required."));
            const state = stateFor(String(name));
            if (requestOptions.ifAvailable === true && state.holder) {
                return Promise.resolve().then(() => operation(null));
            }
            return new Promise((resolve, reject) => {
                state.queue.push({ name: String(name), callback: operation, resolve, reject });
                pump(state);
            });
        },
        crash() {
            for (const state of states.values()) {
                // Browser/process termination drops held Web Locks even if the
                // JavaScript promise that owned them can no longer settle.
                state.holder = null;
                pump(state);
            }
        }
    });
}

async function withCrashableWebLocks(operation) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const locks = createCrashableWebLockManager();
    Object.defineProperty(globalThis, "navigator", {
        value: { locks },
        writable: true,
        configurable: true
    });
    try {
        return await operation(locks);
    } finally {
        if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
        else delete globalThis.navigator;
    }
}

let isolatedIdentityModuleSequence = 0;

async function isolatedServiceFor(storage, options = {}) {
    const moduleUrl = new URL(
        `../../js/features/identity/localIdentity.js?unit-isolation=${++isolatedIdentityModuleSequence}`,
        import.meta.url
    );
    const isolatedModule = await import(moduleUrl.href);
    return isolatedModule.createLocalIdentityService({
        storage,
        selectorKeyStore: selectorKeyStoreFor(storage),
        adminRegistryKeyStore: adminKeyStoreFor(storage),
        adminRecoveryKeyStore: recoveryKeyStoreFor(storage),
        pbkdf2Iterations: 100_000,
        now: () => T0,
        online: true,
        ...options
    });
}

async function bootstrap(service, password = PASSWORD) {
    return service.bootstrapAdminAccount({
        identifier: "admin@orbit.com",
        password,
        displayName: "Orbit Administrator"
    });
}

test("the reserved administrator has no published credential and bootstrap persists only encrypted administrative metadata", async () => {
    const storage = new MemoryStorage();
    const service = serviceFor(storage);

    await assert.rejects(
        () => service.registerLocalAccount({ identifier: "admin@orbit.com", password: PASSWORD }),
        rejectsWithCode("ADMIN_BOOTSTRAP_REQUIRED")
    );

    const result = await bootstrap(service);
    assert.equal(result.session.role, LOCAL_IDENTITY_ROLES.ADMIN);
    assert.equal(result.session.passwordChangeRequired, false);
    const users = await service.listAdministrativeUsers();
    assert.equal(users.length, 1);
    assert.equal(users[0].role, LOCAL_IDENTITY_ROLES.ADMIN);
    assert.equal(users[0].provider, "local");
    assert.equal(users[0].lastLoginAt, T0);

    const rawRegistry = storage.getItem(ADMIN_REGISTRY_STORAGE_KEY);
    assert.ok(rawRegistry);
    for (const privateValue of ["admin@orbit.com", "Orbit Administrator", PASSWORD, "passwordChangeRequired"]) {
        assert.equal(storage.dump().includes(privateValue), false, `${privateValue} must not appear in localStorage plaintext`);
    }
});

test("only one concurrent secure bootstrap can create the initial local administrator", async () => {
    const storage = new MemoryStorage();
    const selectorKeyStore = createInMemoryIdentitySelectorKeyStore();
    const adminRegistryKeyStore = createInMemoryIdentityAdminRegistryKeyStore();
    const first = serviceFor(storage, { selectorKeyStore, adminRegistryKeyStore });
    const second = serviceFor(storage, { selectorKeyStore, adminRegistryKeyStore });

    const results = await Promise.allSettled([
        bootstrap(first, PASSWORD),
        bootstrap(second, `${PASSWORD}!`)
    ]);
    const fulfilled = results.map((result, index) => ({ result, service: [first, second][index] }))
        .filter(({ result }) => result.status === "fulfilled");
    assert.equal(fulfilled.length, 1);
    const users = await fulfilled[0].service.listAdministrativeUsers();
    assert.equal(users.filter((user) => user.role === LOCAL_IDENTITY_ROLES.ADMIN).length, 1);
    assert.equal(users.length, 1);
});

test("administrative operations reject a regular local session", async () => {
    const storage = new MemoryStorage();
    const service = serviceFor(storage);
    await service.registerLocalAccount({ identifier: "operator@orbit.test", password: PASSWORD });

    await assert.rejects(() => service.listAdministrativeUsers(), rejectsWithCode("ADMIN_ACCESS_REQUIRED"));
    await assert.rejects(
        () => service.setAdministrativeLoginPolicy({ maxFailedAttempts: 2 }),
        rejectsWithCode("ADMIN_ACCESS_REQUIRED")
    );
    await assert.rejects(
        () => service.createAdministrativeUser({ identifier: "other@orbit.test", password: PASSWORD }),
        rejectsWithCode("ADMIN_ACCESS_REQUIRED")
    );
});

test("failed local logins block persistently at the configured threshold and an administrator can explicitly unblock", async () => {
    const storage = new MemoryStorage();
    const administrator = serviceFor(storage);
    await bootstrap(administrator);
    await administrator.setAdministrativeLoginPolicy({ maxFailedAttempts: 2 });
    const created = await administrator.createAdministrativeUser({
        identifier: "locked.operator@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });

    const attempts = serviceFor(storage);
    await assert.rejects(
        () => attempts.loginLocalAccount({ identifier: "locked.operator@orbit.test", password: "incorrect password" }),
        rejectsWithCode("INVALID_CREDENTIALS")
    );
    await assert.rejects(
        () => attempts.loginLocalAccount({ identifier: "locked.operator@orbit.test", password: "incorrect password" }),
        rejectsWithCode("INVALID_CREDENTIALS")
    );

    const blocked = (await administrator.listAdministrativeUsers()).find((user) => user.accountId === created.account.id);
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.failedLoginAttempts, 2);
    assert.equal(blocked.lockedUntil, "", "the configured limit is a persistent administrative block, not a timer");

    const correctButBlocked = serviceFor(storage);
    await assert.rejects(
        () => correctButBlocked.loginLocalAccount({ identifier: "locked.operator@orbit.test", password: PASSWORD }),
        rejectsWithCode("ACCOUNT_LOCKED")
    );

    await administrator.updateAdministrativeUser({ accountId: created.account.id, blocked: false });
    const unlocked = serviceFor(storage);
    const signedIn = await unlocked.loginLocalAccount({ identifier: "locked.operator@orbit.test", password: PASSWORD });
    assert.equal(signedIn.session.role, LOCAL_IDENTITY_ROLES.USER);
    assert.equal(signedIn.session.passwordChangeRequired, false);
    const alreadyIssuedVault = await unlocked.getUnlockedVault();
    await administrator.updateAdministrativeUser({ accountId: created.account.id, blocked: true });
    await assert.rejects(
        () => alreadyIssuedVault.seal({ shouldNotPersist: true }),
        rejectsWithCode("ACCOUNT_LOCKED")
    );
    assert.equal(unlocked.getSession(), null, "an administrative block revokes a stale active session before project data can be used");
});

test("the administrative directory retains current failed attempts and the attempts preceding the last successful login", async () => {
    const storage = new MemoryStorage();
    const administrator = serviceFor(storage);
    await bootstrap(administrator);
    await administrator.setAdministrativeLoginPolicy({ maxFailedAttempts: 4 });
    const created = await administrator.createAdministrativeUser({
        identifier: "attempts.operator@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });
    const user = serviceFor(storage);
    await assert.rejects(
        () => user.loginLocalAccount({ identifier: "attempts.operator@orbit.test", password: "wrong password" }),
        rejectsWithCode("INVALID_CREDENTIALS")
    );
    await assert.rejects(
        () => user.loginLocalAccount({ identifier: "attempts.operator@orbit.test", password: "wrong password" }),
        rejectsWithCode("INVALID_CREDENTIALS")
    );
    const beforeSuccess = (await administrator.listAdministrativeUsers()).find((candidate) => candidate.accountId === created.account.id);
    assert.equal(beforeSuccess.failedLoginAttempts, 2);
    assert.equal(beforeSuccess.failedLoginAttemptsAtLastSuccess, 0);

    await user.loginLocalAccount({ identifier: "attempts.operator@orbit.test", password: PASSWORD });
    const afterSuccess = (await administrator.listAdministrativeUsers()).find((candidate) => candidate.accountId === created.account.id);
    assert.equal(afterSuccess.failedLoginAttempts, 0);
    assert.equal(afterSuccess.failedLoginAttemptsAtLastSuccess, 2);
    assert.equal(Object.hasOwn(afterSuccess, "passwordRecoveryKeyId"), false);
    assert.equal(Object.hasOwn(afterSuccess, "credentialGeneration"), false);
    assert.equal(Object.hasOwn(afterSuccess, "passwordReplacementPending"), false);
    assert.equal(Object.hasOwn(afterSuccess, "passwordReplacementJournal"), false);

    user.logout();
    await assert.rejects(
        () => user.loginLocalAccount({ identifier: "attempts.operator@orbit.test", password: "wrong password" }),
        rejectsWithCode("INVALID_CREDENTIALS")
    );
    const current = (await administrator.listAdministrativeUsers()).find((candidate) => candidate.accountId === created.account.id);
    assert.equal(current.failedLoginAttempts, 1);
    assert.equal(current.failedLoginAttemptsAtLastSuccess, 2);
});

test("forgot-password requests are non-enumerating, encrypted, and can be resolved by an administrator", async () => {
    const storage = new MemoryStorage();
    const administrator = serviceFor(storage);
    await bootstrap(administrator);
    const created = await administrator.createAdministrativeUser({
        identifier: "reset.operator@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });
    const unauthenticated = serviceFor(storage);

    const existing = await unauthenticated.requestLocalPasswordReset({ identifier: "reset.operator@orbit.test" });
    const missing = await unauthenticated.requestLocalPasswordReset({ identifier: "absent.operator@orbit.test" });
    const malformed = await unauthenticated.requestLocalPasswordReset({ identifier: "not a local identifier" });
    assert.deepEqual(existing, { accepted: true });
    assert.deepEqual(missing, existing);
    assert.deepEqual(malformed, existing);

    const requested = (await administrator.listAdministrativeUsers()).find((user) => user.accountId === created.account.id);
    assert.equal(requested.passwordResetRequestedAt, T0);
    await administrator.clearAdministrativePasswordResetRequest({ accountId: created.account.id });
    const cleared = (await administrator.listAdministrativeUsers()).find((user) => user.accountId === created.account.id);
    assert.equal(cleared.passwordResetRequestedAt, "");
    assert.equal(storage.dump().includes("reset.operator@orbit.test"), false, "the request must not put an identifier in plaintext storage");
});

test("administrators cannot delete themselves, and deleting another administrator preserves an administrator account", async () => {
    const storage = new MemoryStorage();
    const administrator = serviceFor(storage);
    const initial = await bootstrap(administrator);
    const second = await administrator.createAdministrativeUser({
        identifier: "second.admin@orbit.test",
        password: PASSWORD,
        role: LOCAL_IDENTITY_ROLES.ADMIN,
        passwordChangeRequired: false
    });

    await assert.rejects(
        () => administrator.deleteAdministrativeUser({ accountId: initial.account.id }),
        rejectsWithCode("ADMIN_SELF_DELETE_FORBIDDEN")
    );
    await assert.rejects(
        () => administrator.updateAdministrativeUser({ accountId: initial.account.id, role: LOCAL_IDENTITY_ROLES.USER }),
        rejectsWithCode("ADMIN_SELF_UPDATE_FORBIDDEN")
    );
    await administrator.deleteAdministrativeUser({ accountId: second.account.id });
    const users = await administrator.listAdministrativeUsers();
    assert.equal(users.filter((user) => user.role === LOCAL_IDENTITY_ROLES.ADMIN).length, 1);
    assert.equal(users[0].accountId, initial.account.id);
});

test("deleting a user revokes an already-issued project capability before it can encrypt or decrypt more project data", async () => {
    const storage = new MemoryStorage();
    const administrator = serviceFor(storage);
    await bootstrap(administrator);
    const created = await administrator.createAdministrativeUser({
        identifier: "deleted.operator@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });
    const user = serviceFor(storage);
    await user.loginLocalAccount({ identifier: "deleted.operator@orbit.test", password: PASSWORD });
    const staleVault = await user.getUnlockedVault();

    await administrator.deleteAdministrativeUser({ accountId: created.account.id });
    await assert.rejects(
        () => staleVault.seal({ noLongerAuthorized: true }),
        rejectsWithCode("ACCOUNT_DELETED")
    );
    assert.equal(user.getSession(), null);
});

test("forced password change keeps a user out of the workspace until the vault is re-encrypted with a new password", async () => {
    const storage = new MemoryStorage();
    const administrator = serviceFor(storage);
    await bootstrap(administrator);
    const created = await administrator.createAdministrativeUser({
        identifier: "change.required@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });
    await administrator.forcePasswordChange({ accountId: created.account.id });

    const user = serviceFor(storage);
    const limited = await user.loginLocalAccount({ identifier: "change.required@orbit.test", password: PASSWORD });
    assert.equal(limited.session.passwordChangeRequired, true);
    await assert.rejects(() => user.getUnlockedVault(), rejectsWithCode("PASSWORD_CHANGE_REQUIRED"));
    const profileBeforeBlockedMutations = user.getProfile();
    await assert.rejects(
        () => user.updateProfile({ displayName: "No debe quedar ni en memoria" }),
        rejectsWithCode("PASSWORD_CHANGE_REQUIRED")
    );
    await assert.rejects(
        () => user.storeProviderTokens("google", {
            accessToken: "blocked-password-change-token",
            expiresAt: "2026-08-22T11:00:00.000Z"
        }),
        rejectsWithCode("PASSWORD_CHANGE_REQUIRED")
    );
    await assert.rejects(
        () => user.removeProviderTokens("google"),
        rejectsWithCode("PASSWORD_CHANGE_REQUIRED")
    );
    assert.deepEqual(user.getProfile(), profileBeforeBlockedMutations);
    await assert.rejects(
        () => user.changeLocalPassword({ currentPassword: "wrong password", newPassword: NEXT_PASSWORD }),
        rejectsWithCode("INVALID_CREDENTIALS")
    );
    const changed = await user.changeLocalPassword({ currentPassword: PASSWORD, newPassword: NEXT_PASSWORD });
    assert.equal(changed.passwordChangeRequired, false);
    assert.ok(await user.getUnlockedVault());
    user.logout();
    await assert.rejects(
        () => user.loginLocalAccount({ identifier: "change.required@orbit.test", password: PASSWORD }),
        rejectsWithCode("INVALID_CREDENTIALS")
    );
    assert.equal((await user.loginLocalAccount({ identifier: "change.required@orbit.test", password: NEXT_PASSWORD })).session.passwordChangeRequired, false);
});

test("an administrator can replace a user's local password without exposing it and migrates the user's encrypted projects", async () => {
    const storage = new MemoryStorage();
    const administrator = serviceFor(storage);
    await bootstrap(administrator);
    const created = await administrator.createAdministrativeUser({
        identifier: "reset.direct@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });
    const user = serviceFor(storage);
    await user.loginLocalAccount({ identifier: "reset.direct@orbit.test", password: PASSWORD });
    const staleVault = await user.getUnlockedVault();
    const library = createUserProjectLibrary({
        session: user.getSession(),
        vault: staleVault,
        storage
    });
    const project = await library.createProject({ name: "Proyecto protegido" });
    await user.requestLocalPasswordReset({ identifier: "reset.direct@orbit.test" });

    const reset = await administrator.resetAdministrativeUserPassword({
        accountId: created.account.id,
        newPassword: NEXT_PASSWORD
    });
    assert.equal(reset.accountId, created.account.id);
    assert.equal(reset.passwordChangeRequired, false);
    assert.equal(reset.passwordResetRequestedAt, "");
    assert.equal(reset.blocked, false);
    assert.equal(reset.failedLoginAttempts, 0);
    assert.equal(Object.hasOwn(reset, "passwordRecoveryKeyId"), false);
    assert.equal(Object.hasOwn(reset, "credentialGeneration"), false);
    assert.equal(Object.hasOwn(reset, "passwordReplacementPending"), false);
    assert.equal(Object.hasOwn(reset, "passwordReplacementJournal"), false);
    await assert.rejects(() => staleVault.seal({ stale: true }), rejectsWithCode("ACCOUNT_PASSWORD_RESET"));

    const restarted = serviceFor(storage);
    await assert.rejects(
        () => restarted.loginLocalAccount({ identifier: "reset.direct@orbit.test", password: PASSWORD }),
        rejectsWithCode("INVALID_CREDENTIALS")
    );
    const signedIn = await restarted.loginLocalAccount({ identifier: "reset.direct@orbit.test", password: NEXT_PASSWORD });
    const restoredLibrary = createUserProjectLibrary({
        session: signedIn.session,
        vault: await restarted.getUnlockedVault(),
        storage
    });
    assert.equal((await restoredLibrary.loadProject(project.id)).document.name, "Proyecto protegido");
});

test("a direct administrative password reset rejects a correct old-password login while its re-key is pending", async () => {
    const storage = new MemoryStorage();
    const sharedRecoveryStore = recoveryKeyStoreFor(storage);
    const reachedRecoveryLookup = deferred();
    const continueReset = deferred();
    let pauseRecoveryLookup = false;
    const delayedRecoveryStore = Object.freeze({
        put(key) {
            return sharedRecoveryStore.put(key);
        },
        async get(id) {
            if (pauseRecoveryLookup) {
                reachedRecoveryLookup.resolve();
                await continueReset.promise;
            }
            return sharedRecoveryStore.get(id);
        },
        remove(id) {
            return sharedRecoveryStore.remove(id);
        }
    });
    const administrator = serviceFor(storage, { adminRecoveryKeyStore: delayedRecoveryStore });
    await bootstrap(administrator);
    const created = await administrator.createAdministrativeUser({
        identifier: "pending.reset@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });

    pauseRecoveryLookup = true;
    const reset = administrator.resetAdministrativeUserPassword({
        accountId: created.account.id,
        newPassword: NEXT_PASSWORD
    });
    await reachedRecoveryLookup.promise;

    const concurrentLogin = serviceFor(storage);
    await assert.rejects(
        () => concurrentLogin.loginLocalAccount({ identifier: "pending.reset@orbit.test", password: PASSWORD }),
        rejectsWithCode("ACCOUNT_PASSWORD_CHANGE_IN_PROGRESS")
    );
    const duringReset = (await administrator.listAdministrativeUsers()).find((user) => user.accountId === created.account.id);
    assert.equal(duringReset.failedLoginAttempts, 0, "a correct login during the staged rotation must not mutate counters");
    assert.equal(Object.hasOwn(duringReset, "passwordReplacementPending"), false);
    assert.equal(Object.hasOwn(duringReset, "passwordReplacementJournal"), false);

    pauseRecoveryLookup = false;
    continueReset.resolve();
    await reset;
    const restarted = serviceFor(storage);
    await assert.rejects(
        () => restarted.loginLocalAccount({ identifier: "pending.reset@orbit.test", password: PASSWORD }),
        rejectsWithCode("INVALID_CREDENTIALS")
    );
    assert.equal((await restarted.loginLocalAccount({ identifier: "pending.reset@orbit.test", password: NEXT_PASSWORD })).account.id, created.account.id);
});

test("a direct reset rolls the staged credential generation back when creating the candidate vault fails", async () => {
    const storage = new MemoryStorage();
    const control = { failDeriveKey: false };
    const administrator = serviceFor(storage, { crypto: cryptoWithToggleableDeriveFailure(control) });
    await bootstrap(administrator);
    const created = await administrator.createAdministrativeUser({
        identifier: "candidate.failure@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });

    control.failDeriveKey = true;
    await assert.rejects(
        () => administrator.resetAdministrativeUserPassword({ accountId: created.account.id, newPassword: NEXT_PASSWORD }),
        /Injected account-key derivation failure/
    );
    control.failDeriveKey = false;

    const user = serviceFor(storage);
    assert.equal((await user.loginLocalAccount({ identifier: "candidate.failure@orbit.test", password: PASSWORD })).account.id, created.account.id);
    assert.equal((await administrator.listAdministrativeUsers()).find((candidate) => candidate.accountId === created.account.id).failedLoginAttempts, 0);
});

test("a direct reset rolls the staged credential generation back when recovery key access fails", async () => {
    const storage = new MemoryStorage();
    const sharedRecoveryStore = recoveryKeyStoreFor(storage);
    let failGet = false;
    const recoveryStore = Object.freeze({
        put(key) {
            return sharedRecoveryStore.put(key);
        },
        async get(id) {
            if (failGet) throw new Error("Injected recovery lookup failure");
            return sharedRecoveryStore.get(id);
        },
        remove(id) {
            return sharedRecoveryStore.remove(id);
        }
    });
    const administrator = serviceFor(storage, { adminRecoveryKeyStore: recoveryStore });
    await bootstrap(administrator);
    const created = await administrator.createAdministrativeUser({
        identifier: "recovery.lookup.failure@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });

    failGet = true;
    await assert.rejects(
        () => administrator.resetAdministrativeUserPassword({ accountId: created.account.id, newPassword: NEXT_PASSWORD }),
        rejectsWithCode("ADMIN_PASSWORD_RECOVERY_UNAVAILABLE")
    );
    failGet = false;

    const user = serviceFor(storage);
    assert.equal((await user.loginLocalAccount({ identifier: "recovery.lookup.failure@orbit.test", password: PASSWORD })).account.id, created.account.id);
});

test("a direct reset rolls the staged credential generation back when saving its replacement recovery key fails", async () => {
    const storage = new MemoryStorage();
    const sharedRecoveryStore = recoveryKeyStoreFor(storage);
    let failPut = false;
    const recoveryStore = Object.freeze({
        async put(key) {
            if (failPut) throw new Error("Injected recovery key write failure");
            return sharedRecoveryStore.put(key);
        },
        get(id) {
            return sharedRecoveryStore.get(id);
        },
        remove(id) {
            return sharedRecoveryStore.remove(id);
        }
    });
    const administrator = serviceFor(storage, { adminRecoveryKeyStore: recoveryStore });
    await bootstrap(administrator);
    const created = await administrator.createAdministrativeUser({
        identifier: "recovery.write.failure@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });

    failPut = true;
    await assert.rejects(
        () => administrator.resetAdministrativeUserPassword({ accountId: created.account.id, newPassword: NEXT_PASSWORD }),
        /Injected recovery key write failure/
    );
    failPut = false;

    const user = serviceFor(storage);
    assert.equal((await user.loginLocalAccount({ identifier: "recovery.write.failure@orbit.test", password: PASSWORD })).account.id, created.account.id);
});

test("administrative password replacement preserves linked-provider project partitions and provider envelopes", async () => {
    const storage = new MemoryStorage();
    const administrator = serviceFor(storage);
    await bootstrap(administrator);
    const created = await administrator.createAdministrativeUser({
        identifier: "linked.reset@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });
    const user = serviceFor(storage);
    await user.loginLocalAccount({ identifier: "linked.reset@orbit.test", password: PASSWORD });
    await user.storeProviderTokens("google", {
        accessToken: "linked-reset-token",
        expiresAt: "2026-08-22T11:00:00.000Z"
    });
    const envelope = user.getProviderTokenEnvelope("google");
    const externalSession = await user.completeExternalIdentity({
        provider: "google",
        identity: {
            provider: "google",
            subject: "linked-reset-subject",
            displayName: "Linked reset operator",
            email: "linked.reset@example.test"
        },
        tokenEnvelope: envelope
    });
    const linkedLibrary = createUserProjectLibrary({
        session: externalSession,
        vault: await user.getUnlockedVault(),
        storage
    });
    const linkedProject = await linkedLibrary.createProject({ name: "Proyecto Google protegido" });

    await administrator.resetAdministrativeUserPassword({
        accountId: created.account.id,
        newPassword: NEXT_PASSWORD
    });

    const restarted = serviceFor(storage);
    await restarted.loginLocalAccount({ identifier: "linked.reset@orbit.test", password: NEXT_PASSWORD });
    assert.deepEqual(
        await restarted.withProviderTokens("google", (tokens) => tokens),
        {
            accessToken: "linked-reset-token",
            expiresAt: "2026-08-22T11:00:00.000Z"
        },
        "the provider envelope must be re-encrypted with the replacement account key"
    );
    const restoredExternal = await restarted.startExternalSession({ provider: "google", subject: "linked-reset-subject" });
    const restoredLibrary = createUserProjectLibrary({
        session: restoredExternal,
        vault: await restarted.getUnlockedVault(),
        storage
    });
    assert.equal((await restoredLibrary.loadProject(linkedProject.id)).document.name, "Proyecto Google protegido");
});

test("administrative password replacement re-keys a retained Google project partition after unlink and later re-link", async () => {
    const storage = new MemoryStorage();
    const administrator = serviceFor(storage);
    await bootstrap(administrator);
    const created = await administrator.createAdministrativeUser({
        identifier: "historical.google.partition@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });
    const user = serviceFor(storage);
    await user.loginLocalAccount({ identifier: "historical.google.partition@orbit.test", password: PASSWORD });
    await user.storeProviderTokens("google", {
        accessToken: "historical-google-token",
        expiresAt: "2026-08-22T11:00:00.000Z"
    });
    const googleSubject = "historical-google-subject";
    const external = await user.completeExternalIdentity({
        provider: "google",
        identity: {
            provider: "google",
            subject: googleSubject,
            displayName: "Historical Google operator",
            email: "historical.google@example.test"
        },
        tokenEnvelope: user.getProviderTokenEnvelope("google")
    });
    const linkedLibrary = createUserProjectLibrary({
        session: external,
        vault: await user.getUnlockedVault(),
        storage
    });
    const retainedProject = await linkedLibrary.createProject({ name: "Proyecto Google retenido tras unlink" });
    assert.equal(await user.removeProviderTokens("google"), true);
    assert.equal(user.getSession().identityState, "local_user");
    user.logout();

    await administrator.resetAdministrativeUserPassword({
        accountId: created.account.id,
        newPassword: NEXT_PASSWORD
    });

    const relinkedUser = serviceFor(storage);
    await relinkedUser.loginLocalAccount({ identifier: "historical.google.partition@orbit.test", password: NEXT_PASSWORD });
    await relinkedUser.storeProviderTokens("google", {
        accessToken: "historical-google-token-after-reset",
        expiresAt: "2026-08-22T11:00:00.000Z"
    });
    const relinked = await relinkedUser.completeExternalIdentity({
        provider: "google",
        identity: {
            provider: "google",
            subject: googleSubject,
            displayName: "Historical Google operator",
            email: "historical.google@example.test"
        },
        tokenEnvelope: relinkedUser.getProviderTokenEnvelope("google")
    });
    const restoredLibrary = createUserProjectLibrary({
        session: relinked,
        vault: await relinkedUser.getUnlockedVault(),
        storage
    });
    assert.equal((await restoredLibrary.loadProject(retainedProject.id)).document.name, "Proyecto Google retenido tras unlink");
    assert.equal(Object.hasOwn(relinkedUser.getAccount(), "projectOwnerHistory"), false);
    assert.equal(Object.hasOwn(relinkedUser.getSession(), "projectOwnerHistory"), false);
});

test("self password rotation re-keys a retained Google project partition after unlink and later re-link", async () => {
    const storage = new MemoryStorage();
    const administrator = serviceFor(storage);
    await bootstrap(administrator);
    await administrator.createAdministrativeUser({
        identifier: "self.historical.google.partition@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });
    const user = serviceFor(storage);
    await user.loginLocalAccount({ identifier: "self.historical.google.partition@orbit.test", password: PASSWORD });
    await user.storeProviderTokens("google", {
        accessToken: "self-historical-google-token",
        expiresAt: "2026-08-22T11:00:00.000Z"
    });
    const googleSubject = "self-historical-google-subject";
    const external = await user.completeExternalIdentity({
        provider: "google",
        identity: {
            provider: "google",
            subject: googleSubject,
            displayName: "Self historical Google operator",
            email: "self.historical.google@example.test"
        },
        tokenEnvelope: user.getProviderTokenEnvelope("google")
    });
    const linkedLibrary = createUserProjectLibrary({
        session: external,
        vault: await user.getUnlockedVault(),
        storage
    });
    const retainedProject = await linkedLibrary.createProject({ name: "Proyecto Google retenido en cambio propio" });
    await user.removeProviderTokens("google");
    await user.changeLocalPassword({ currentPassword: PASSWORD, newPassword: NEXT_PASSWORD });
    user.logout();

    const relinkedUser = serviceFor(storage);
    await relinkedUser.loginLocalAccount({ identifier: "self.historical.google.partition@orbit.test", password: NEXT_PASSWORD });
    await relinkedUser.storeProviderTokens("google", {
        accessToken: "self-historical-google-token-after-rotation",
        expiresAt: "2026-08-22T11:00:00.000Z"
    });
    const relinked = await relinkedUser.completeExternalIdentity({
        provider: "google",
        identity: {
            provider: "google",
            subject: googleSubject,
            displayName: "Self historical Google operator",
            email: "self.historical.google@example.test"
        },
        tokenEnvelope: relinkedUser.getProviderTokenEnvelope("google")
    });
    const restoredLibrary = createUserProjectLibrary({
        session: relinked,
        vault: await relinkedUser.getUnlockedVault(),
        storage
    });
    assert.equal((await restoredLibrary.loadProject(retainedProject.id)).document.name, "Proyecto Google retenido en cambio propio");
});

test("a failed administrative confirmation preserves every re-keyed local and Google partition when the candidate vault cannot be rolled back", async () => {
    const storage = new MemoryStorage();
    const control = {
        armed: false,
        identityWrites: 0,
        failRegistryWrite: false
    };
    const baseVaultAdapter = createGuardedLocalStorageAdapter(storage);
    const vaultAdapter = Object.freeze({
        storageKey: baseVaultAdapter.storageKey,
        read() {
            return baseVaultAdapter.read();
        },
        write(index) {
            if (control.armed) {
                control.identityWrites += 1;
                if (control.identityWrites === 1) {
                    const saved = baseVaultAdapter.write(index);
                    // The registry confirmation happens immediately after
                    // this candidate-vault write.
                    control.failRegistryWrite = true;
                    return saved;
                }
                if (control.identityWrites === 2) {
                    throw new Error("Injected identity-vault rollback failure");
                }
            }
            return baseVaultAdapter.write(index);
        },
        clear() {
            return baseVaultAdapter.clear();
        }
    });
    const baseRegistryStore = createLocalAdministrativeRegistryStore({
        storage,
        keyStore: adminKeyStoreFor(storage)
    });
    const registryStore = Object.freeze({
        storageKey: baseRegistryStore.storageKey,
        hasDocument() {
            return baseRegistryStore.hasDocument();
        },
        read(options) {
            return baseRegistryStore.read(options);
        },
        write(context) {
            if (control.failRegistryWrite) {
                throw new Error("Injected administrative confirmation failure");
            }
            return baseRegistryStore.write(context);
        }
    });
    const administrator = serviceFor(storage, {
        adapter: vaultAdapter,
        adminRegistryStore: registryStore
    });
    await bootstrap(administrator);
    const created = await administrator.createAdministrativeUser({
        identifier: "preserved.partitions@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });
    const user = serviceFor(storage);
    const localSession = await user.loginLocalAccount({ identifier: "preserved.partitions@orbit.test", password: PASSWORD });
    const localLibrary = createUserProjectLibrary({
        session: localSession.session,
        vault: await user.getUnlockedVault(),
        storage
    });
    const localProject = await localLibrary.createProject({ name: "Proyecto local candidato" });
    await user.storeProviderTokens("google", {
        accessToken: "candidate-google-token",
        expiresAt: "2026-08-22T11:00:00.000Z"
    });
    const linkedSession = await user.completeExternalIdentity({
        provider: "google",
        identity: {
            provider: "google",
            subject: "candidate-google-subject",
            displayName: "Candidate Google operator",
            email: "candidate.google@example.test"
        },
        tokenEnvelope: user.getProviderTokenEnvelope("google")
    });
    const linkedLibrary = createUserProjectLibrary({
        session: linkedSession,
        vault: await user.getUnlockedVault(),
        storage
    });
    const linkedProject = await linkedLibrary.createProject({ name: "Proyecto Google candidato" });

    control.armed = true;
    await assert.rejects(
        () => administrator.resetAdministrativeUserPassword({
            accountId: created.account.id,
            newPassword: NEXT_PASSWORD
        }),
        /Injected administrative confirmation failure/
    );

    // Simulate the next app launch: the durable journal must observe the
    // candidate vault and finalize it. Both the earlier local partition and
    // the final linked-provider partition must still use that candidate key.
    control.armed = false;
    control.failRegistryWrite = false;
    const restarted = serviceFor(storage);
    const restartedLocal = await restarted.loginLocalAccount({
        identifier: "preserved.partitions@orbit.test",
        password: NEXT_PASSWORD
    });
    const restoredLocalLibrary = createUserProjectLibrary({
        session: restartedLocal.session,
        vault: await restarted.getUnlockedVault(),
        storage
    });
    assert.equal((await restoredLocalLibrary.loadProject(localProject.id)).document.name, "Proyecto local candidato");
    const restartedLinked = await restarted.startExternalSession({ provider: "google", subject: "candidate-google-subject" });
    const restoredLinkedLibrary = createUserProjectLibrary({
        session: restartedLinked,
        vault: await restarted.getUnlockedVault(),
        storage
    });
    assert.equal((await restoredLinkedLibrary.loadProject(linkedProject.id)).document.name, "Proyecto Google candidato");
    assert.deepEqual(await restarted.withProviderTokens("google", (tokens) => tokens), {
        accessToken: "candidate-google-token",
        expiresAt: "2026-08-22T11:00:00.000Z"
    });
});

test("recovery revokes every stale target session before it can overwrite a finalized administrative reset", { concurrency: false }, async () => {
    await withCrashableWebLocks(async (locks) => {
        const storage = new MemoryStorage();
        const control = {
            armed: false,
            candidateVaultWritten: false,
            reached: deferred(),
            release: deferred()
        };
        const baseVaultAdapter = createGuardedLocalStorageAdapter(storage);
        const vaultAdapter = Object.freeze({
            storageKey: baseVaultAdapter.storageKey,
            read() {
                return baseVaultAdapter.read();
            },
            write(index) {
                const saved = baseVaultAdapter.write(index);
                if (control.armed === true) control.candidateVaultWritten = true;
                return saved;
            },
            clear() {
                return baseVaultAdapter.clear();
            }
        });
        const baseRegistryStore = createLocalAdministrativeRegistryStore({
            storage,
            keyStore: adminKeyStoreFor(storage)
        });
        const registryStore = Object.freeze({
            storageKey: baseRegistryStore.storageKey,
            hasDocument() {
                return baseRegistryStore.hasDocument();
            },
            read(options) {
                return baseRegistryStore.read(options);
            },
            async write(context) {
                if (control.armed === true && control.candidateVaultWritten === true) {
                    control.reached.resolve();
                    await control.release.promise;
                }
                return baseRegistryStore.write(context);
            }
        });
        const serviceOptions = { adapter: vaultAdapter, adminRegistryStore: registryStore };
        const administrator = await isolatedServiceFor(storage, serviceOptions);
        await bootstrap(administrator);
        const created = await administrator.createAdministrativeUser({
            identifier: "stale.recovery.target@orbit.test",
            password: PASSWORD,
            displayName: "Target before recovery",
            passwordChangeRequired: false
        });

        const setup = await isolatedServiceFor(storage, serviceOptions);
        await setup.loginLocalAccount({ identifier: "stale.recovery.target@orbit.test", password: PASSWORD });
        const localLibrary = createUserProjectLibrary({
            session: setup.getSession(),
            vault: await setup.getUnlockedVault(),
            storage
        });
        const project = await localLibrary.createProject({ name: "Proyecto que debe sobrevivir al recovery" });
        await setup.storeProviderTokens("google", {
            accessToken: "stale-recovery-google-token",
            refreshToken: "stale-recovery-google-refresh",
            expiresAt: "2026-08-22T11:00:00.000Z"
        });
        await setup.completeExternalIdentity({
            provider: "google",
            identity: {
                provider: "google",
                subject: "stale-recovery-google-subject",
                displayName: "Target Google identity",
                email: "stale.recovery.target@example.test"
            },
            tokenEnvelope: setup.getProviderTokenEnvelope("google")
        });
        setup.logout();

        const staleProfile = await isolatedServiceFor(storage, serviceOptions);
        const stalePassword = await isolatedServiceFor(storage, serviceOptions);
        const staleTokens = await isolatedServiceFor(storage, serviceOptions);
        const staleExternal = await isolatedServiceFor(storage, serviceOptions);
        const staleRemoval = await isolatedServiceFor(storage, serviceOptions);
        for (const stale of [staleProfile, stalePassword, staleTokens, staleExternal, staleRemoval]) {
            await stale.loginLocalAccount({ identifier: "stale.recovery.target@orbit.test", password: PASSWORD });
        }
        const expectedEnvelope = staleRemoval.getProviderTokenEnvelope("google");

        control.armed = true;
        const interrupted = administrator.resetAdministrativeUserPassword({
            accountId: created.account.id,
            newPassword: NEXT_PASSWORD
        });
        void interrupted.catch(() => {});
        await control.reached.promise;

        // The candidate vault and re-keyed project are durable, but the
        // registry still says "pending". Simulate process termination, then
        // let a fresh service finalize from the durable journal.
        control.armed = false;
        locks.crash();
        const recovered = await isolatedServiceFor(storage, serviceOptions);
        const signedIn = await recovered.loginLocalAccount({
            identifier: "stale.recovery.target@orbit.test",
            password: NEXT_PASSWORD
        });
        const originalProfile = recovered.getProfile();

        await assert.rejects(
            () => staleProfile.updateProfile({ displayName: "No debe sobrescribir el vault candidato" }),
            rejectsWithCode("ACCOUNT_PASSWORD_RESET")
        );
        await assert.rejects(
            () => stalePassword.changeLocalPassword({ currentPassword: PASSWORD, newPassword: THIRD_PASSWORD }),
            rejectsWithCode("ACCOUNT_PASSWORD_RESET")
        );
        await assert.rejects(
            () => staleTokens.withProviderTokens("google", (tokens) => tokens),
            rejectsWithCode("ACCOUNT_PASSWORD_RESET")
        );
        await assert.rejects(
            () => staleExternal.startExternalSession({ provider: "google", subject: "stale-recovery-google-subject" }),
            rejectsWithCode("ACCOUNT_PASSWORD_RESET")
        );
        await assert.rejects(
            () => staleRemoval.removeProviderTokensIfMatching("google", expectedEnvelope),
            rejectsWithCode("ACCOUNT_PASSWORD_RESET")
        );

        assert.deepEqual(recovered.getProfile(), originalProfile);
        assert.deepEqual(await recovered.withProviderTokens("google", (tokens) => tokens), {
            accessToken: "stale-recovery-google-token",
            refreshToken: "stale-recovery-google-refresh",
            expiresAt: "2026-08-22T11:00:00.000Z"
        });
        await recovered.startExternalSession({ provider: "google", subject: "stale-recovery-google-subject" });
        recovered.useLocalIdentity();
        const restoredLibrary = createUserProjectLibrary({
            session: recovered.getSession(),
            vault: await recovered.getUnlockedVault(),
            storage
        });
        assert.equal((await restoredLibrary.loadProject(project.id)).document.name, "Proyecto que debe sobrevivir al recovery");
        recovered.logout();
        await assert.rejects(
            () => recovered.loginLocalAccount({ identifier: "stale.recovery.target@orbit.test", password: PASSWORD }),
            rejectsWithCode("INVALID_CREDENTIALS")
        );
        assert.equal(signedIn.account.id, created.account.id);
    });
});

test("a direct reset retains its journal when project rollback is uncertain and recovers the old vault on next login", async () => {
    const backingStorage = new MemoryStorage();
    const values = new Map();
    const control = {
        armed: false,
        candidateVaultWritten: false,
        rejectRegistryConfirmation: false,
        observeCandidateProjectWrites: false,
        rejectOldProjectRestore: false,
        rollbackFailureInjected: false,
        originalProjectValues: new Map(),
        candidateProjectKeys: new Set()
    };
    const storage = Object.freeze({
        getItem(key) {
            return backingStorage.getItem(key);
        },
        setItem(key, value) {
            const serialized = String(value);
            const original = control.originalProjectValues.get(key);
            const isProjectKey = key.startsWith("orbit.user-project-library:");
            if (control.observeCandidateProjectWrites === true
                && isProjectKey
                && original !== undefined
                && original !== serialized) {
                control.candidateProjectKeys.add(key);
            }
            if (control.rejectOldProjectRestore === true
                && control.rollbackFailureInjected === false
                && control.candidateProjectKeys.has(key)
                && original === serialized) {
                control.rollbackFailureInjected = true;
                throw new Error("Injected old project envelope restoration failure");
            }
            backingStorage.setItem(key, serialized);
            values.set(key, serialized);
        },
        removeItem(key) {
            backingStorage.removeItem(key);
            values.delete(key);
        },
        dump() {
            return backingStorage.dump();
        }
    });
    const baseVaultAdapter = createGuardedLocalStorageAdapter(storage);
    const vaultAdapter = Object.freeze({
        storageKey: baseVaultAdapter.storageKey,
        read() {
            return baseVaultAdapter.read();
        },
        write(index) {
            const saved = baseVaultAdapter.write(index);
            if (control.armed === true) control.candidateVaultWritten = true;
            return saved;
        },
        clear() {
            return baseVaultAdapter.clear();
        }
    });
    const baseRegistryStore = createLocalAdministrativeRegistryStore({
        storage,
        keyStore: adminKeyStoreFor(backingStorage)
    });
    const registryStore = Object.freeze({
        storageKey: baseRegistryStore.storageKey,
        hasDocument() {
            return baseRegistryStore.hasDocument();
        },
        read(options) {
            return baseRegistryStore.read(options);
        },
        write(context) {
            if (control.rejectRegistryConfirmation === true && control.candidateVaultWritten === true) {
                control.rejectOldProjectRestore = true;
                throw new Error("Injected final administrative confirmation failure");
            }
            return baseRegistryStore.write(context);
        }
    });
    const options = {
        adapter: vaultAdapter,
        adminRegistryStore: registryStore,
        adminRecoveryKeyStore: recoveryKeyStoreFor(backingStorage)
    };
    const administrator = serviceFor(storage, options);
    await bootstrap(administrator);
    const created = await administrator.createAdministrativeUser({
        identifier: "rollback.uncertain@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });
    const user = serviceFor(storage, options);
    const local = await user.loginLocalAccount({ identifier: "rollback.uncertain@orbit.test", password: PASSWORD });
    const library = createUserProjectLibrary({
        session: local.session,
        vault: await user.getUnlockedVault(),
        storage
    });
    const project = await library.createProject({ name: "Proyecto restaurado por diario" });
    for (const [key, value] of values) {
        if (key.startsWith("orbit.user-project-library:")) control.originalProjectValues.set(key, value);
    }
    user.logout();

    control.armed = true;
    control.observeCandidateProjectWrites = true;
    control.rejectRegistryConfirmation = true;
    await assert.rejects(
        () => administrator.resetAdministrativeUserPassword({
            accountId: created.account.id,
            newPassword: NEXT_PASSWORD
        }),
        /Injected final administrative confirmation failure/
    );
    assert.equal(control.rollbackFailureInjected, true, "the test must leave at least one candidate project envelope behind");

    control.armed = false;
    control.rejectRegistryConfirmation = false;
    control.rejectOldProjectRestore = false;
    const recovered = serviceFor(storage, options);
    const signedIn = await recovered.loginLocalAccount({
        identifier: "rollback.uncertain@orbit.test",
        password: PASSWORD
    });
    const restoredLibrary = createUserProjectLibrary({
        session: signedIn.session,
        vault: await recovered.getUnlockedVault(),
        storage
    });
    assert.equal((await restoredLibrary.loadProject(project.id)).document.name, "Proyecto restaurado por diario");
    recovered.logout();
    await assert.rejects(
        () => recovered.loginLocalAccount({ identifier: "rollback.uncertain@orbit.test", password: NEXT_PASSWORD }),
        rejectsWithCode("INVALID_CREDENTIALS")
    );
});

test("a self password rotation retains its journal when project rollback is uncertain and recovers the old vault on next login", async () => {
    const backingStorage = new MemoryStorage();
    const values = new Map();
    const control = {
        armed: false,
        candidateVaultWritten: false,
        rejectRegistryConfirmation: false,
        observeCandidateProjectWrites: false,
        rejectOldProjectRestore: false,
        rollbackFailureInjected: false,
        originalProjectValues: new Map(),
        candidateProjectKeys: new Set()
    };
    const storage = Object.freeze({
        getItem(key) {
            return backingStorage.getItem(key);
        },
        setItem(key, value) {
            const serialized = String(value);
            const original = control.originalProjectValues.get(key);
            const isProjectKey = key.startsWith("orbit.user-project-library:");
            if (control.observeCandidateProjectWrites === true
                && isProjectKey
                && original !== undefined
                && original !== serialized) {
                control.candidateProjectKeys.add(key);
            }
            if (control.rejectOldProjectRestore === true
                && control.rollbackFailureInjected === false
                && control.candidateProjectKeys.has(key)
                && original === serialized) {
                control.rollbackFailureInjected = true;
                throw new Error("Injected old project envelope restoration failure");
            }
            backingStorage.setItem(key, serialized);
            values.set(key, serialized);
        },
        removeItem(key) {
            backingStorage.removeItem(key);
            values.delete(key);
        },
        dump() {
            return backingStorage.dump();
        }
    });
    const baseVaultAdapter = createGuardedLocalStorageAdapter(storage);
    const vaultAdapter = Object.freeze({
        storageKey: baseVaultAdapter.storageKey,
        read() {
            return baseVaultAdapter.read();
        },
        write(index) {
            const saved = baseVaultAdapter.write(index);
            if (control.armed === true) control.candidateVaultWritten = true;
            return saved;
        },
        clear() {
            return baseVaultAdapter.clear();
        }
    });
    const baseRegistryStore = createLocalAdministrativeRegistryStore({
        storage,
        keyStore: adminKeyStoreFor(backingStorage)
    });
    const registryStore = Object.freeze({
        storageKey: baseRegistryStore.storageKey,
        hasDocument() {
            return baseRegistryStore.hasDocument();
        },
        read(options) {
            return baseRegistryStore.read(options);
        },
        write(context) {
            if (control.rejectRegistryConfirmation === true && control.candidateVaultWritten === true) {
                control.rejectOldProjectRestore = true;
                throw new Error("Injected final self-confirmation failure");
            }
            return baseRegistryStore.write(context);
        }
    });
    const options = {
        adapter: vaultAdapter,
        adminRegistryStore: registryStore,
        adminRecoveryKeyStore: recoveryKeyStoreFor(backingStorage)
    };
    const administrator = serviceFor(storage, options);
    await bootstrap(administrator);
    await administrator.createAdministrativeUser({
        identifier: "self.rollback.uncertain@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });
    const user = serviceFor(storage, options);
    const local = await user.loginLocalAccount({ identifier: "self.rollback.uncertain@orbit.test", password: PASSWORD });
    const library = createUserProjectLibrary({
        session: local.session,
        vault: await user.getUnlockedVault(),
        storage
    });
    const project = await library.createProject({ name: "Proyecto propio restaurado por diario" });
    for (const [key, value] of values) {
        if (key.startsWith("orbit.user-project-library:")) control.originalProjectValues.set(key, value);
    }

    control.armed = true;
    control.observeCandidateProjectWrites = true;
    control.rejectRegistryConfirmation = true;
    await assert.rejects(
        () => user.changeLocalPassword({ currentPassword: PASSWORD, newPassword: NEXT_PASSWORD }),
        /Injected final self-confirmation failure/
    );
    assert.equal(control.rollbackFailureInjected, true, "the failed self rotation must leave a journal-recoverable candidate project envelope");
    assert.equal(user.getSession(), null, "the self session must be revoked while recovery remains pending");

    control.armed = false;
    control.rejectRegistryConfirmation = false;
    control.rejectOldProjectRestore = false;
    const recovered = serviceFor(storage, options);
    const signedIn = await recovered.loginLocalAccount({
        identifier: "self.rollback.uncertain@orbit.test",
        password: PASSWORD
    });
    const restoredLibrary = createUserProjectLibrary({
        session: signedIn.session,
        vault: await recovered.getUnlockedVault(),
        storage
    });
    assert.equal((await restoredLibrary.loadProject(project.id)).document.name, "Proyecto propio restaurado por diario");
    recovered.logout();
    await assert.rejects(
        () => recovered.loginLocalAccount({ identifier: "self.rollback.uncertain@orbit.test", password: NEXT_PASSWORD }),
        rejectsWithCode("INVALID_CREDENTIALS")
    );
});

test("a user's own password rotation revokes a stale sibling session before it can overwrite the new vault", async () => {
    const storage = new MemoryStorage();
    const administrator = serviceFor(storage);
    await bootstrap(administrator);
    const created = await administrator.createAdministrativeUser({
        identifier: "two.tabs@orbit.test",
        password: PASSWORD,
        passwordChangeRequired: false
    });
    const first = serviceFor(storage);
    const second = serviceFor(storage);
    await first.loginLocalAccount({ identifier: "two.tabs@orbit.test", password: PASSWORD });
    await second.loginLocalAccount({ identifier: "two.tabs@orbit.test", password: PASSWORD });
    await first.changeLocalPassword({ currentPassword: PASSWORD, newPassword: NEXT_PASSWORD });

    await assert.rejects(
        () => second.updateProfile({ displayName: "No debe persistirse" }),
        rejectsWithCode("ACCOUNT_PASSWORD_RESET")
    );
    const restarted = serviceFor(storage);
    await assert.rejects(
        () => restarted.loginLocalAccount({ identifier: "two.tabs@orbit.test", password: PASSWORD }),
        rejectsWithCode("INVALID_CREDENTIALS")
    );
    assert.equal((await restarted.loginLocalAccount({ identifier: "two.tabs@orbit.test", password: NEXT_PASSWORD })).account.id, created.account.id);
});

test("an existing local account is enrolled into the encrypted directory only after a successful legacy-compatible login", async () => {
    const storage = new MemoryStorage();
    const selectorKeyStore = createInMemoryIdentitySelectorKeyStore();
    const adminRegistryKeyStore = createInMemoryIdentityAdminRegistryKeyStore();
    const unavailableStore = Object.freeze({
        storageKey: "orbit.identity.admin-registry.v1",
        hasDocument() {
            return false;
        },
        async read() {
            const error = new Error("administration unavailable during legacy account creation");
            error.code = "ADMIN_REGISTRY_STORAGE_UNAVAILABLE";
            throw error;
        },
        async write() {
            throw new Error("not reached");
        }
    });
    const legacyService = serviceFor(storage, { selectorKeyStore, adminRegistryStore: unavailableStore });
    await legacyService.registerLocalAccount({ identifier: "legacy.operator@orbit.test", password: PASSWORD, displayName: "Legacy Operator" });
    legacyService.logout();

    const upgraded = serviceFor(storage, { selectorKeyStore, adminRegistryKeyStore });
    await upgraded.loginLocalAccount({ identifier: "legacy.operator@orbit.test", password: PASSWORD });
    const store = createLocalAdministrativeRegistryStore({ storage, keyStore: adminRegistryKeyStore });
    const registry = await store.read({ now: T1 });
    assert.equal(registry.registry.users.length, 1);
    assert.equal(registry.registry.users[0].identifier, "legacy.operator@orbit.test");
    assert.equal(registry.registry.users[0].role, LOCAL_IDENTITY_ROLES.USER);
});

test("linking or re-entering an external identity records its provider in the encrypted administrative directory", async () => {
    const storage = new MemoryStorage();
    const administrator = serviceFor(storage);
    await bootstrap(administrator);
    await administrator.storeProviderTokens("google", {
        accessToken: "google-token-not-in-directory",
        expiresAt: "2026-08-22T11:00:00.000Z"
    });
    const envelope = administrator.getProviderTokenEnvelope("google");
    const external = await administrator.completeExternalIdentity({
        provider: "google",
        identity: {
            provider: "google",
            subject: "admin-google-subject",
            displayName: "Orbit Google Administrator",
            email: "admin@example.test"
        },
        tokenEnvelope: envelope
    });
    assert.equal(external.provider, "google");
    assert.equal(external.role, LOCAL_IDENTITY_ROLES.ADMIN);
    const afterLink = await administrator.listAdministrativeUsers();
    assert.equal(afterLink[0].provider, "google");
    assert.equal(afterLink[0].lastLoginProvider, "google");

    administrator.useLocalIdentity();
    const reentered = await administrator.startExternalSession({ provider: "google", subject: "admin-google-subject" });
    assert.equal(reentered.provider, "google");
    const afterReentry = await administrator.listAdministrativeUsers();
    assert.equal(afterReentry[0].provider, "google");
    assert.equal(storage.dump().includes("google-token-not-in-directory"), false);
});

test("an interrupted self password rotation before its vault switch rolls projects and credentials back on the next launch", { concurrency: false }, async () => {
    await withCrashableWebLocks(async (locks) => {
        const storage = new MemoryStorage();
        const control = { reached: deferred(), release: deferred() };
        const pausedCrypto = cryptoWithPausedSecondAccountVaultEncryption(control);
        const administrator = await isolatedServiceFor(storage, { crypto: pausedCrypto });
        await bootstrap(administrator);
        await administrator.createAdministrativeUser({
            identifier: "self.pre-vault@orbit.test",
            password: PASSWORD,
            passwordChangeRequired: false
        });
        const rotatingUser = await isolatedServiceFor(storage, { crypto: pausedCrypto });
        await rotatingUser.loginLocalAccount({ identifier: "self.pre-vault@orbit.test", password: PASSWORD });
        const library = createUserProjectLibrary({
            session: rotatingUser.getSession(),
            vault: await rotatingUser.getUnlockedVault(),
            storage
        });
        const project = await library.createProject({ name: "Proyecto propio previo a bóveda" });

        control.armed = true;
        const interrupted = rotatingUser.changeLocalPassword({
            currentPassword: PASSWORD,
            newPassword: NEXT_PASSWORD
        });
        void interrupted.catch(() => {});
        await control.reached.promise;

        // A terminated tab releases both its identity and project locks. The
        // independently loaded service models the next application launch.
        locks.crash();
        const restarted = await isolatedServiceFor(storage);
        const recovered = await restarted.loginLocalAccount({
            identifier: "self.pre-vault@orbit.test",
            password: PASSWORD
        });
        const restoredLibrary = createUserProjectLibrary({
            session: recovered.session,
            vault: await restarted.getUnlockedVault(),
            storage
        });
        assert.equal((await restoredLibrary.loadProject(project.id)).document.name, "Proyecto propio previo a bóveda");
        restarted.logout();
        await assert.rejects(
            () => restarted.loginLocalAccount({ identifier: "self.pre-vault@orbit.test", password: NEXT_PASSWORD }),
            rejectsWithCode("INVALID_CREDENTIALS")
        );
        assert.equal(control.accountVaultEncryptions, 2);
    });
});

test("an interrupted self password rotation after its vault switch finalizes the candidate key and projects on the next launch", { concurrency: false }, async () => {
    await withCrashableWebLocks(async (locks) => {
        const storage = new MemoryStorage();
        const control = { armed: false, candidateVaultWritten: false, reached: deferred(), release: deferred() };
        const baseVaultAdapter = createGuardedLocalStorageAdapter(storage);
        const vaultAdapter = Object.freeze({
            storageKey: baseVaultAdapter.storageKey,
            read() {
                return baseVaultAdapter.read();
            },
            write(index) {
                const saved = baseVaultAdapter.write(index);
                if (control.armed === true) control.candidateVaultWritten = true;
                return saved;
            },
            clear() {
                return baseVaultAdapter.clear();
            }
        });
        const baseRegistryStore = createLocalAdministrativeRegistryStore({
            storage,
            keyStore: adminKeyStoreFor(storage)
        });
        const registryStore = Object.freeze({
            storageKey: baseRegistryStore.storageKey,
            hasDocument() {
                return baseRegistryStore.hasDocument();
            },
            read(options) {
                return baseRegistryStore.read(options);
            },
            async write(context) {
                if (control.armed === true && control.candidateVaultWritten === true) {
                    control.reached.resolve();
                    await control.release.promise;
                }
                return baseRegistryStore.write(context);
            }
        });
        const serviceOptions = { adapter: vaultAdapter, adminRegistryStore: registryStore };
        const administrator = await isolatedServiceFor(storage, serviceOptions);
        await bootstrap(administrator);
        await administrator.createAdministrativeUser({
            identifier: "self.post-vault@orbit.test",
            password: PASSWORD,
            passwordChangeRequired: false
        });
        const rotatingUser = await isolatedServiceFor(storage, serviceOptions);
        await rotatingUser.loginLocalAccount({ identifier: "self.post-vault@orbit.test", password: PASSWORD });
        const library = createUserProjectLibrary({
            session: rotatingUser.getSession(),
            vault: await rotatingUser.getUnlockedVault(),
            storage
        });
        const project = await library.createProject({ name: "Proyecto propio posterior a bóveda" });

        control.armed = true;
        const interrupted = rotatingUser.changeLocalPassword({
            currentPassword: PASSWORD,
            newPassword: NEXT_PASSWORD
        });
        void interrupted.catch(() => {});
        await control.reached.promise;

        // The vault and all project envelopes use the candidate key already,
        // but the administrative directory did not receive its final commit.
        // A new process must complete that commit, never roll projects back.
        control.armed = false;
        locks.crash();
        const restarted = await isolatedServiceFor(storage, serviceOptions);
        const recovered = await restarted.loginLocalAccount({
            identifier: "self.post-vault@orbit.test",
            password: NEXT_PASSWORD
        });
        const restoredLibrary = createUserProjectLibrary({
            session: recovered.session,
            vault: await restarted.getUnlockedVault(),
            storage
        });
        assert.equal((await restoredLibrary.loadProject(project.id)).document.name, "Proyecto propio posterior a bóveda");
        restarted.logout();
        await assert.rejects(
            () => restarted.loginLocalAccount({ identifier: "self.post-vault@orbit.test", password: PASSWORD }),
            rejectsWithCode("INVALID_CREDENTIALS")
        );
    });
});

test("a second administrator recovers an interrupted direct reset before retrying it", { concurrency: false }, async () => {
    await withCrashableWebLocks(async (locks) => {
        const storage = new MemoryStorage();
        const control = { reached: deferred(), release: deferred() };
        const pausedCrypto = cryptoWithPausedSecondAccountVaultEncryption(control);
        const firstAdministrator = await isolatedServiceFor(storage, { crypto: pausedCrypto });
        await bootstrap(firstAdministrator);
        const target = await firstAdministrator.createAdministrativeUser({
            identifier: "direct.retry.target@orbit.test",
            password: PASSWORD,
            passwordChangeRequired: false
        });
        const backupAdministrator = await firstAdministrator.createAdministrativeUser({
            identifier: "direct.retry.admin@orbit.test",
            password: PASSWORD,
            passwordChangeRequired: false
        });
        await firstAdministrator.updateAdministrativeUser({
            accountId: backupAdministrator.account.id,
            role: LOCAL_IDENTITY_ROLES.ADMIN
        });
        const targetUser = await isolatedServiceFor(storage, { crypto: pausedCrypto });
        const targetSession = await targetUser.loginLocalAccount({
            identifier: "direct.retry.target@orbit.test",
            password: PASSWORD
        });
        const targetLibrary = createUserProjectLibrary({
            session: targetSession.session,
            vault: await targetUser.getUnlockedVault(),
            storage
        });
        const project = await targetLibrary.createProject({ name: "Proyecto de reset directo interrumpido" });
        targetUser.logout();

        control.armed = true;
        const interrupted = firstAdministrator.resetAdministrativeUserPassword({
            accountId: target.account.id,
            newPassword: NEXT_PASSWORD
        });
        void interrupted.catch(() => {});
        await control.reached.promise;

        // The target still has its old vault, while its projects were already
        // re-keyed. The next administrator must restore that state first,
        // then be able to perform a completely new reset.
        locks.crash();
        const secondAdministrator = await isolatedServiceFor(storage);
        await secondAdministrator.loginLocalAccount({
            identifier: "direct.retry.admin@orbit.test",
            password: PASSWORD
        });
        await secondAdministrator.resetAdministrativeUserPassword({
            accountId: target.account.id,
            newPassword: THIRD_PASSWORD
        });

        const restartedTarget = await isolatedServiceFor(storage);
        const recovered = await restartedTarget.loginLocalAccount({
            identifier: "direct.retry.target@orbit.test",
            password: THIRD_PASSWORD
        });
        const restoredLibrary = createUserProjectLibrary({
            session: recovered.session,
            vault: await restartedTarget.getUnlockedVault(),
            storage
        });
        assert.equal((await restoredLibrary.loadProject(project.id)).document.name, "Proyecto de reset directo interrumpido");
        restartedTarget.logout();
        await assert.rejects(
            () => restartedTarget.loginLocalAccount({ identifier: "direct.retry.target@orbit.test", password: PASSWORD }),
            rejectsWithCode("INVALID_CREDENTIALS")
        );
        await assert.rejects(
            () => restartedTarget.loginLocalAccount({ identifier: "direct.retry.target@orbit.test", password: NEXT_PASSWORD }),
            rejectsWithCode("INVALID_CREDENTIALS")
        );
    });
});
