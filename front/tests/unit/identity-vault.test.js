import assert from "node:assert/strict";
import test from "node:test";

import {
    createEmptyIdentityVaultIndex,
    createEncryptedAccountVault,
    createGuardedLocalStorageAdapter,
    createInMemoryIdentitySelectorKeyStore,
    createProviderTokenEnvelope,
    hashLocalIdentifier,
    hashLocalIdentifierWithSelectorKey,
    openAccountJson,
    openProviderTokenEnvelope,
    sealAccountJson,
    unlockEncryptedAccountVault
} from "../../js/features/identity/identityVault.js";

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
const T1 = "2026-08-22T11:00:00.000Z";

function rejectsWithCode(code) {
    return (error) => error?.code === code;
}

test("new identifier selectors are keyed per installation and cannot be reproduced from a legacy SHA-256 selector", async () => {
    const firstInstallation = createInMemoryIdentitySelectorKeyStore();
    const secondInstallation = createInMemoryIdentitySelectorKeyStore();
    const firstKey = await firstInstallation.create();
    const secondKey = await secondInstallation.create();

    const first = await hashLocalIdentifierWithSelectorKey("operator@orbit.test", firstKey.key);
    const repeated = await hashLocalIdentifierWithSelectorKey("OPERATOR@ORBIT.TEST", firstKey.key);
    const second = await hashLocalIdentifierWithSelectorKey("operator@orbit.test", secondKey.key);
    const legacy = await hashLocalIdentifier("operator@orbit.test");

    assert.equal(first, repeated, "normalization remains stable inside one installation");
    assert.notEqual(first, second, "a different installation key produces a different selector");
    assert.notEqual(first, legacy, "new accounts no longer publish the legacy deterministic selector");
});

test("guarded local storage only accepts a versioned encrypted account index", async () => {
    const storage = new MemoryStorage();
    const adapter = createGuardedLocalStorageAdapter(storage);
    const identifierHash = await hashLocalIdentifier("operator@orbit.test");
    const privateData = {
        account: { identifier: "operator@orbit.test", displayName: "Operator" },
        profile: { callsign: "ORBIT-1" }
    };
    const encrypted = await createEncryptedAccountVault({
        accountId: "local-demo",
        identifierHash,
        password: "correct horse battery staple",
        data: privateData,
        pbkdf2Iterations: 100_000
    });
    const index = createEmptyIdentityVaultIndex(T0);
    adapter.write({
        ...index,
        entries: [{
            id: "local-demo",
            selector: { algorithm: "SHA-256", value: identifierHash },
            vault: encrypted.vault
        }]
    });

    const stored = storage.getItem(adapter.storageKey);
    assert.ok(stored);
    assert.equal(stored.includes("operator@orbit.test"), false);
    assert.equal(stored.includes("correct horse battery staple"), false);
    assert.equal(stored.includes("ORBIT-1"), false);
    assert.equal(adapter.read().entries[0].vault.cipher.name, "AES-GCM");

    assert.throws(
        () => adapter.write({ schema: "plain", version: 1, entries: [{ password: "leak" }] }),
        rejectsWithCode("VAULT_FORMAT_INVALID")
    );
});

test("an account key seals owner/purpose-bound project data and cannot be reused after a binding change", async () => {
    const identifierHash = await hashLocalIdentifier("operator@orbit.test");
    const encrypted = await createEncryptedAccountVault({
        accountId: "local-demo",
        identifierHash,
        password: "correct horse battery staple",
        data: { private: true },
        pbkdf2Iterations: 100_000
    });
    const opened = await unlockEncryptedAccountVault({
        vault: encrypted.vault,
        password: "correct horse battery staple"
    });
    const sealed = await sealAccountJson({
        accountId: "local-demo",
        purpose: "project:demo",
        key: opened.key,
        value: { name: "Mission Alpha", localOnly: true }
    });
    assert.equal(JSON.stringify(sealed).includes("Mission Alpha"), false);
    assert.deepEqual(await openAccountJson({
        accountId: "local-demo",
        purpose: "project:demo",
        key: opened.key,
        envelope: sealed
    }), { name: "Mission Alpha", localOnly: true });
    await assert.rejects(
        () => openAccountJson({
            accountId: "local-demo",
            purpose: "project:other",
            key: opened.key,
            envelope: sealed
        }),
        rejectsWithCode("SEALED_DATA_BINDING_INVALID")
    );
});

test("provider token envelopes remain encrypted even before the outer account vault is persisted", async () => {
    const identifierHash = await hashLocalIdentifier("operator@orbit.test");
    const encrypted = await createEncryptedAccountVault({
        accountId: "local-demo",
        identifierHash,
        password: "correct horse battery staple",
        data: { private: true },
        pbkdf2Iterations: 100_000
    });
    const opened = await unlockEncryptedAccountVault({ vault: encrypted.vault, password: "correct horse battery staple" });
    const tokens = { accessToken: "access-token-must-never-be-plain", refreshToken: "refresh-token-must-never-be-plain", expiresAt: T1 };
    const envelope = await createProviderTokenEnvelope({
        accountId: "local-demo",
        provider: "google",
        key: opened.key,
        tokens,
        createdAt: T0,
        expiresAt: T1
    });
    assert.equal(JSON.stringify(envelope).includes(tokens.accessToken), false);
    assert.equal(envelope.renewalRequired, true);
    assert.deepEqual(await openProviderTokenEnvelope({
        accountId: "local-demo",
        provider: "google",
        key: opened.key,
        envelope
    }), tokens);
    await assert.rejects(
        () => openProviderTokenEnvelope({ accountId: "local-demo", provider: "microsoft", key: opened.key, envelope }),
        rejectsWithCode("PROVIDER_TOKEN_BINDING_INVALID")
    );
});
