import assert from "node:assert/strict";
import test from "node:test";

import {
    ADMIN_BOOTSTRAP_IDENTIFIER,
    ADMIN_LOGIN_POLICY_DEFAULTS,
    ADMIN_REGISTRY_STORAGE_KEY,
    LOCAL_IDENTITY_ROLES,
    createAdministrativeUserRecord,
    createInMemoryIdentityAdminRegistryKeyStore,
    createLocalAdministrativeRegistryStore,
    validateAdministrativeRegistry
} from "../../js/features/identity/identityAdministration.js";

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
}

const T0 = "2026-08-22T10:00:00.000Z";
const T1 = "2026-08-22T10:15:00.000Z";

function rejectsWithCode(code) {
    return (error) => error?.code === code;
}

test("the local administration registry starts without a default administrator or credential", async () => {
    const storage = new MemoryStorage();
    const store = createLocalAdministrativeRegistryStore({
        storage,
        keyStore: createInMemoryIdentityAdminRegistryKeyStore()
    });

    const initial = await store.read({ create: true, now: T0 });
    assert.equal(ADMIN_BOOTSTRAP_IDENTIFIER, "admin@orbit.com");
    assert.deepEqual(initial.registry.users, []);
    assert.deepEqual(initial.registry.policy, ADMIN_LOGIN_POLICY_DEFAULTS);
    assert.equal(initial.keyRecord.key.extractable, false, "the installation registry key cannot be exported");

    const raw = storage.getItem(ADMIN_REGISTRY_STORAGE_KEY);
    assert.ok(raw);
    assert.equal(raw.includes(ADMIN_BOOTSTRAP_IDENTIFIER), false);
    assert.equal(raw.includes("password"), false);
    assert.equal(raw.includes("administrator"), false);
});

test("administrative roles, lock metadata, and reset requests remain inside an encrypted installation registry", async () => {
    const storage = new MemoryStorage();
    const store = createLocalAdministrativeRegistryStore({
        storage,
        keyStore: createInMemoryIdentityAdminRegistryKeyStore()
    });
    const initial = await store.read({ create: true, now: T0 });
    const administrator = createAdministrativeUserRecord({
        accountId: "local-administrator",
        identifier: ADMIN_BOOTSTRAP_IDENTIFIER,
        displayName: "Local administrator",
        role: LOCAL_IDENTITY_ROLES.ADMIN,
        createdAt: T0,
        updatedAt: T1,
        lastLoginAt: T0,
        failedLoginAttempts: 5,
        lockedUntil: T1,
        notes: "A local-only operator note",
        passwordChangeRequired: true,
        passwordResetRequestedAt: T0
    });
    const registry = {
        ...initial.registry,
        updatedAt: T1,
        users: [administrator]
    };

    await store.write({ registry, keyRecord: initial.keyRecord });
    const raw = storage.getItem(ADMIN_REGISTRY_STORAGE_KEY);
    assert.ok(raw);
    for (const privateValue of [ADMIN_BOOTSTRAP_IDENTIFIER, "Local administrator", "operator note", "lockedUntil", "passwordChangeRequired"]) {
        assert.equal(raw.includes(privateValue), false, `${privateValue} must not be present in localStorage plaintext`);
    }

    const reopened = await store.read({ now: T1 });
    assert.deepEqual(reopened.registry.users, [administrator]);
    assert.equal(reopened.registry.users[0].role, LOCAL_IDENTITY_ROLES.ADMIN);
    assert.equal(reopened.registry.users[0].passwordChangeRequired, true);
});

test("administrative registry validation rejects malformed roles and duplicate local identities", () => {
    const user = createAdministrativeUserRecord({
        accountId: "local-user",
        identifier: "user@orbit.test",
        displayName: "Local user",
        createdAt: T0,
        updatedAt: T0
    });
    const valid = {
        schema: "orbit.identity.admin-registry",
        version: 1,
        createdAt: T0,
        updatedAt: T0,
        policy: ADMIN_LOGIN_POLICY_DEFAULTS,
        users: [user]
    };
    assert.deepEqual(validateAdministrativeRegistry(valid).users, [user]);

    assert.throws(
        () => createAdministrativeUserRecord({ ...user, role: "superuser" }),
        rejectsWithCode("ADMIN_ROLE_INVALID")
    );
    assert.throws(
        () => validateAdministrativeRegistry({ ...valid, users: [user, { ...user, accountId: "local-other" }] }),
        rejectsWithCode("ADMIN_REGISTRY_FORMAT_INVALID")
    );
});
