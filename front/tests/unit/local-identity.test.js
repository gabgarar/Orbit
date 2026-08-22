import assert from "node:assert/strict";
import test from "node:test";

import { ORBIT_IDENTITY_SESSION_CHANGED_EVENT } from "../../js/features/identity/identityEvents.js";
import { IDENTITY_STATES } from "../../js/features/identity/identityStates.js";
import {
    createEmptyIdentityVaultIndex,
    createEncryptedAccountVault,
    createGuardedLocalStorageAdapter,
    createInMemoryIdentitySelectorKeyStore,
    hashLegacyLocalIdentifier,
    IDENTITY_KEYED_SELECTOR_ALGORITHM,
    IDENTITY_VAULT_INDEX_VERSION
} from "../../js/features/identity/identityVault.js";
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

const selectorKeyStores = new WeakMap();

function selectorKeyStoreFor(storage) {
    let keyStore = selectorKeyStores.get(storage);
    if (!keyStore) {
        keyStore = createInMemoryIdentitySelectorKeyStore();
        selectorKeyStores.set(storage, keyStore);
    }
    return keyStore;
}

const PASSWORD = "correct horse battery staple";
const T0 = "2026-08-22T10:00:00.000Z";
const T1 = "2026-08-22T11:00:00.000Z";

function serviceFor(storage, options = {}) {
    const selectorKeyStore = options.selectorKeyStore || selectorKeyStoreFor(storage);
    return createLocalIdentityService({
        storage,
        now: () => T0,
        pbkdf2Iterations: 100_000,
        online: true,
        selectorKeyStore,
        ...options
    });
}

function rejectsWithCode(code) {
    return (error) => error?.code === code;
}

test("a legacy SHA-256 account can unlock and is migrated to the keyed v2 selector", async () => {
    const storage = new MemoryStorage();
    const adapter = createGuardedLocalStorageAdapter(storage);
    const identifier = "legacy@orbit.test";
    const accountId = "local-legacy-selector";
    const legacySelector = await hashLegacyLocalIdentifier(identifier);
    const accountData = {
        schema: "orbit.identity.local-account-data",
        version: 1,
        account: {
            id: accountId,
            kind: "local",
            identityState: IDENTITY_STATES.LOCAL_USER,
            identifier,
            displayName: "Legacy operator",
            createdAt: T0,
            updatedAt: T0
        },
        profile: {
            id: `profile:${accountId}`,
            accountId,
            displayName: "Legacy operator",
            createdAt: T0,
            updatedAt: T0
        },
        providerTokenEnvelopes: {},
        externalIdentities: {}
    };
    const encrypted = await createEncryptedAccountVault({
        accountId,
        identifierHash: legacySelector,
        password: PASSWORD,
        data: accountData,
        pbkdf2Iterations: 100_000
    });
    adapter.write({
        ...createEmptyIdentityVaultIndex(T0),
        entries: [{
            id: accountId,
            selector: { algorithm: "SHA-256", value: legacySelector },
            vault: encrypted.vault
        }]
    });

    const service = serviceFor(storage);
    await service.loginLocalAccount({ identifier, password: PASSWORD });
    const migrated = adapter.read();
    assert.equal(migrated.version, IDENTITY_VAULT_INDEX_VERSION);
    assert.equal(migrated.entries[0].selector.algorithm, IDENTITY_KEYED_SELECTOR_ALGORITHM);
    assert.notEqual(migrated.entries[0].selector.value, legacySelector);

    const restarted = serviceFor(storage);
    await restarted.loginLocalAccount({ identifier, password: PASSWORD });
    assert.equal(restarted.getSession().identifier, identifier);
});

test("a missing installation selector key falls back to password-verified recovery and rotates the selector", async () => {
    const storage = new MemoryStorage();
    const firstKeyStore = createInMemoryIdentitySelectorKeyStore();
    const first = serviceFor(storage, { selectorKeyStore: firstKeyStore });
    await first.registerLocalAccount({ identifier: "recovery@orbit.test", password: PASSWORD });
    const originalReference = createGuardedLocalStorageAdapter(storage).read().selectorKey.id;
    first.logout();

    const replacementKeyStore = createInMemoryIdentitySelectorKeyStore();
    const recovered = serviceFor(storage, { selectorKeyStore: replacementKeyStore });
    await recovered.loginLocalAccount({ identifier: "recovery@orbit.test", password: PASSWORD });
    const recoveredIndex = createGuardedLocalStorageAdapter(storage).read();
    assert.equal(recovered.getSession().identifier, "recovery@orbit.test");
    assert.notEqual(recoveredIndex.selectorKey.id, originalReference);
    assert.equal(recoveredIndex.entries[0].selector.algorithm, IDENTITY_KEYED_SELECTOR_ALGORITHM);
});

test("concurrent local-account registrations serialize a shared identity index", async () => {
    const storage = new MemoryStorage();
    const selectorKeyStore = createInMemoryIdentitySelectorKeyStore();
    const alpha = serviceFor(storage, { selectorKeyStore });
    const bravo = serviceFor(storage, { selectorKeyStore });
    await Promise.all([
        alpha.registerLocalAccount({ identifier: "alpha-lock@orbit.test", password: PASSWORD }),
        bravo.registerLocalAccount({ identifier: "bravo-lock@orbit.test", password: `${PASSWORD}!` })
    ]);
    const index = createGuardedLocalStorageAdapter(storage).read();
    assert.equal(index.entries.length, 2);
    assert.equal(new Set(index.entries.map((entry) => entry.id)).size, 2);
});

test("a fresh app instance is unauthenticated even when its encrypted local account exists", async () => {
    const storage = new MemoryStorage();
    const events = [];
    const eventTarget = new EventTarget();
    eventTarget.addEventListener(ORBIT_IDENTITY_SESSION_CHANGED_EVENT, (event) => events.push(event.detail.session));
    const first = serviceFor(storage, { eventTarget });

    assert.equal(first.getSession(), null);
    const registration = await first.registerLocalAccount({
        identifier: "Operator@Orbit.test",
        password: PASSWORD,
        displayName: "Orbit Operator"
    });
    assert.equal(registration.session.identityState, IDENTITY_STATES.LOCAL_USER);
    assert.equal(first.getSession().identifier, "operator@orbit.test");
    assert.equal(events.at(-1).identityState, IDENTITY_STATES.LOCAL_USER);

    const restarted = serviceFor(storage);
    assert.equal(restarted.getSession(), null, "there is no localStorage session restoration");
    await restarted.loginLocalAccount({ identifier: "operator@orbit.test", password: PASSWORD });
    assert.equal(restarted.getSession().displayName, "Orbit Operator");
    await assert.rejects(
        () => restarted.loginLocalAccount({ identifier: "operator@orbit.test", password: "wrong password" }),
        rejectsWithCode("INVALID_CREDENTIALS")
    );
});

test("email-first account availability is selector-only, canonical and leaves an encrypted vault unopened", async () => {
    const storage = new MemoryStorage();
    const service = serviceFor(storage);
    await service.registerLocalAccount({
        identifier: "Operator@Orbit.test",
        password: PASSWORD,
        displayName: "Orbit Operator"
    });
    service.logout();
    const beforeLookup = storage.getItem("orbit.identity.vault.v1");

    const existing = await service.getLocalAccountAvailability({ identifier: "  operator@orbit.test  " });
    const missing = await service.getLocalAccountAvailability({ identifier: "new.operator@orbit.test" });

    assert.deepEqual(existing, { exists: true });
    assert.deepEqual(missing, { exists: false });
    assert.equal(Object.isFrozen(existing), true);
    assert.deepEqual(Object.keys(existing), ["exists"], "the lookup result must not disclose an account id, profile, selector or vault metadata");
    assert.equal(service.getSession(), null, "checking an email must never authenticate or unlock its vault");
    assert.equal(storage.getItem("orbit.identity.vault.v1"), beforeLookup, "checking an email must not migrate, re-encrypt or otherwise write the vault");
    assert.equal(storage.dump().includes("operator@orbit.test"), false, "the identifier remains encrypted after a lookup");
});

test("email-first availability recognizes a legacy selector without migrating or opening the account", async () => {
    const storage = new MemoryStorage();
    const adapter = createGuardedLocalStorageAdapter(storage);
    const identifier = "legacy-lookup@orbit.test";
    const accountId = "local-legacy-lookup";
    const legacySelector = await hashLegacyLocalIdentifier(identifier);
    const accountData = {
        schema: "orbit.identity.local-account-data",
        version: 1,
        account: {
            id: accountId,
            kind: "local",
            identityState: IDENTITY_STATES.LOCAL_USER,
            identifier,
            displayName: "Legacy lookup operator",
            createdAt: T0,
            updatedAt: T0
        },
        profile: {
            id: `profile:${accountId}`,
            accountId,
            displayName: "Legacy lookup operator",
            createdAt: T0,
            updatedAt: T0
        },
        providerTokenEnvelopes: {},
        externalIdentities: {}
    };
    const encrypted = await createEncryptedAccountVault({
        accountId,
        identifierHash: legacySelector,
        password: PASSWORD,
        data: accountData,
        pbkdf2Iterations: 100_000
    });
    adapter.write({
        ...createEmptyIdentityVaultIndex(T0),
        entries: [{
            id: accountId,
            selector: { algorithm: "SHA-256", value: legacySelector },
            vault: encrypted.vault
        }]
    });
    const beforeLookup = storage.getItem("orbit.identity.vault.v1");
    const service = serviceFor(storage);

    const availability = await service.getLocalAccountAvailability({ identifier: "LEGACY-LOOKUP@ORBIT.TEST" });

    assert.deepEqual(availability, { exists: true });
    assert.equal(service.getSession(), null);
    assert.equal(storage.getItem("orbit.identity.vault.v1"), beforeLookup, "a check must not silently migrate a legacy selector");
    assert.equal(adapter.read().version, 1, "only a successful password login may migrate this legacy account");
});

test("email-first availability fails closed when a v2 keyed selector cannot be read", async () => {
    const storage = new MemoryStorage();
    const originalKeyStore = createInMemoryIdentitySelectorKeyStore();
    const first = serviceFor(storage, { selectorKeyStore: originalKeyStore });
    await first.registerLocalAccount({ identifier: "unavailable-selector@orbit.test", password: PASSWORD });
    first.logout();
    const beforeLookup = storage.getItem("orbit.identity.vault.v1");
    const unavailableKeyStore = createInMemoryIdentitySelectorKeyStore();
    const recoveredInstance = serviceFor(storage, { selectorKeyStore: unavailableKeyStore });

    const existing = await recoveredInstance.getLocalAccountAvailability({ identifier: "unavailable-selector@orbit.test" });
    const absent = await recoveredInstance.getLocalAccountAvailability({ identifier: "not-in-this-vault@orbit.test" });

    assert.deepEqual(existing, { exists: null });
    assert.deepEqual(absent, { exists: null }, "a missing HMAC selector key must never be misreported as an available account");
    assert.equal(recoveredInstance.getSession(), null);
    assert.equal(storage.getItem("orbit.identity.vault.v1"), beforeLookup, "an indeterminate check must not rotate selector keys or mutate the vault");
});

test("email-first availability validates the identifier before reading local account state", async () => {
    const storage = new MemoryStorage();
    const service = serviceFor(storage);

    await assert.rejects(
        () => service.getLocalAccountAvailability({ identifier: "not a local identifier" }),
        rejectsWithCode("IDENTIFIER_INVALID")
    );
    assert.equal(storage.getItem("orbit.identity.vault.v1"), null);
    assert.equal(service.getSession(), null);
});

test("registration keeps profiles and passwords encrypted and supports multiple local accounts", async () => {
    const storage = new MemoryStorage();
    const service = serviceFor(storage);
    await service.registerLocalAccount({ identifier: "alpha@orbit.test", password: PASSWORD, displayName: "Alpha" });
    service.logout();
    await service.registerLocalAccount({ identifier: "bravo@orbit.test", password: `${PASSWORD}!`, displayName: "Bravo" });
    assert.equal(service.getSession().identifier, "bravo@orbit.test");
    const raw = storage.dump();
    assert.equal(raw.includes("alpha@orbit.test"), false);
    assert.equal(raw.includes("bravo@orbit.test"), false);
    assert.equal(raw.includes(PASSWORD), false);
    assert.equal(raw.includes("Alpha"), false);

    await service.loginLocalAccount({ identifier: "alpha@orbit.test", password: PASSWORD });
    assert.equal(service.getProfile().displayName, "Alpha");
    await service.updateProfile({ displayName: "Alpha Prime" });
    service.logout();
    await service.loginLocalAccount({ identifier: "alpha@orbit.test", password: PASSWORD });
    assert.equal(service.getProfile().displayName, "Alpha Prime");
});

test("an unlocked vault capability seals project data and expires on logout", async () => {
    const storage = new MemoryStorage();
    const service = serviceFor(storage);
    await service.registerLocalAccount({ identifier: "operator@orbit.test", password: PASSWORD });
    const vault = await service.getUnlockedVault();
    const sealed = await vault.seal({ planner: { events: 2 } }, { purpose: "project:mission" });
    assert.equal(JSON.stringify(sealed).includes("planner"), false);
    assert.deepEqual(await vault.open(sealed, { purpose: "project:mission" }), { planner: { events: 2 } });
    service.logout();
    await assert.rejects(() => vault.open(sealed, { purpose: "project:mission" }), rejectsWithCode("VAULT_CAPABILITY_EXPIRED"));
});

test("provider credentials are double-encrypted and a linked external identity becomes an explicit session state", async () => {
    const storage = new MemoryStorage();
    const service = serviceFor(storage);
    await service.registerLocalAccount({ identifier: "operator@orbit.test", password: PASSWORD, displayName: "Local Operator" });
    const tokenStatus = await service.storeProviderTokens("google", {
        accessToken: "access-token-that-must-not-reach-storage",
        refreshToken: "refresh-token-that-must-not-reach-storage",
        expiresAt: T1
    });
    assert.deepEqual(tokenStatus, {
        provider: "google",
        createdAt: T0,
        expiresAt: T1,
        encrypted: true,
        renewalRequired: true
    });
    assert.equal(storage.dump().includes("access-token-that-must-not-reach-storage"), false);
    const envelope = service.getProviderTokenEnvelope("google");
    assert.equal(JSON.stringify(envelope).includes("access-token-that-must-not-reach-storage"), false);

    const external = await service.completeExternalIdentity({
        provider: "google",
        identity: {
            provider: "google",
            subject: "google-subject-1",
            displayName: "Google Operator",
            email: "operator@example.test"
        },
        tokenEnvelope: envelope
    });
    assert.equal(external.identityState, IDENTITY_STATES.GOOGLE_USER);
    assert.equal(external.accountId, "google:google-subject-1");
    assert.equal(external.localAccountId.startsWith("local-"), true);
    assert.equal(service.getIdentity().identityState, IDENTITY_STATES.GOOGLE_USER);
    assert.equal(service.useLocalIdentity().identityState, IDENTITY_STATES.LOCAL_USER);
    assert.equal((await service.startExternalSession({ provider: "google", subject: "google-subject-1" })).identityState, IDENTITY_STATES.GOOGLE_USER);
    await assert.rejects(
        () => service.completeExternalIdentity({
            provider: "google",
            identity: { provider: "google", subject: "unsafe", displayName: "Unsafe", accessToken: "never" },
            tokenEnvelope: envelope
        }),
        rejectsWithCode("EXTERNAL_IDENTITY_INVALID")
    );
    assert.equal(await service.removeProviderTokens("google"), true);
    assert.equal(service.getIdentity().identityState, IDENTITY_STATES.LOCAL_USER, "unlinking tokens also exits the linked identity");
    await assert.rejects(
        () => service.startExternalSession({ provider: "google", subject: "google-subject-1" }),
        rejectsWithCode("EXTERNAL_IDENTITY_NOT_LINKED")
    );
});

test("conditional provider-token cleanup re-reads the encrypted vault so a newer tab envelope survives", async () => {
    const storage = new MemoryStorage();
    const firstTab = serviceFor(storage);
    await firstTab.registerLocalAccount({ identifier: "operator@orbit.test", password: PASSWORD });
    const secondTab = serviceFor(storage);
    await secondTab.loginLocalAccount({ identifier: "operator@orbit.test", password: PASSWORD });

    await firstTab.storeProviderTokens("google", {
        accessToken: "first-tab-token",
        expiresAt: T1
    });
    const cancelledArtifact = firstTab.getProviderTokenEnvelope("google");

    await secondTab.storeProviderTokens("google", {
        accessToken: "second-tab-newer-token",
        expiresAt: T1
    });
    const newerArtifact = secondTab.getProviderTokenEnvelope("google");
    assert.notDeepEqual(newerArtifact, cancelledArtifact, "AES-GCM writes are distinct opaque artifacts");

    assert.equal(
        await firstTab.removeProviderTokensIfMatching("google", cancelledArtifact),
        false,
        "a stale cancellation must not remove a later tab's envelope"
    );

    const verifier = serviceFor(storage);
    await verifier.loginLocalAccount({ identifier: "operator@orbit.test", password: PASSWORD });
    assert.deepEqual(verifier.getProviderTokenEnvelope("google"), newerArtifact);

    assert.equal(
        await verifier.removeProviderTokensIfMatching("google", newerArtifact),
        true,
        "the exact current envelope is removed atomically"
    );
    const afterExactRemoval = serviceFor(storage);
    await afterExactRemoval.loginLocalAccount({ identifier: "operator@orbit.test", password: PASSWORD });
    assert.equal(afterExactRemoval.getProviderTokenEnvelope("google"), null);
});

test("external providers are fail-closed while offline, while local work remains available", async () => {
    const storage = new MemoryStorage();
    const service = serviceFor(storage, { online: false });
    await service.registerLocalAccount({ identifier: "operator@orbit.test", password: PASSWORD });
    assert.equal(service.getSession().identityState, IDENTITY_STATES.LOCAL_USER);
    await assert.rejects(
        () => service.storeProviderTokens("microsoft", { accessToken: "not-used", expiresAt: T1 }),
        rejectsWithCode("EXTERNAL_PROVIDER_OFFLINE")
    );
});
