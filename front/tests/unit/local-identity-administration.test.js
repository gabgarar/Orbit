import assert from "node:assert/strict";
import test from "node:test";

import {
    ADMIN_REGISTRY_STORAGE_KEY,
    createInMemoryIdentityAdminRegistryKeyStore,
    createLocalAdministrativeRegistryStore,
    LOCAL_IDENTITY_ROLES
} from "../../js/features/identity/identityAdministration.js";
import { createInMemoryIdentitySelectorKeyStore } from "../../js/features/identity/identityVault.js";
import { createLocalIdentityService } from "../../js/features/identity/localIdentity.js";

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
const T0 = "2026-08-22T10:00:00.000Z";
const T1 = "2026-08-22T10:15:00.000Z";

const selectorKeyStores = new WeakMap();
const adminKeyStores = new WeakMap();

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

function serviceFor(storage, options = {}) {
    return createLocalIdentityService({
        storage,
        selectorKeyStore: selectorKeyStoreFor(storage),
        adminRegistryKeyStore: adminKeyStoreFor(storage),
        pbkdf2Iterations: 100_000,
        now: () => T0,
        online: true,
        ...options
    });
}

function rejectsWithCode(code) {
    return (error) => error?.code === code;
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
