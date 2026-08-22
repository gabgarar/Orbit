import assert from "node:assert/strict";
import test from "node:test";

import {
    createUserProjectLibrary,
    normalizeProjectLinkage,
    normalizeProjectModulePolicies,
    normalizeProjectSyncPreference,
    normalizeUserProjectMetadata,
    PROJECT_CREATION_MODES,
    PROJECT_LINKAGE_STATES,
    PROJECT_SYNC_STATES,
    USER_PROJECT_ENVELOPE_VERSION,
    UserProjectLibraryIntegrityError,
    UserProjectLibraryValidationError,
    UserProjectLibraryVersionError,
    UserProjectNotFoundError
} from "../../js/features/projects/userProjectLibrary.js";
import { createInMemoryIdentitySelectorKeyStore } from "../../js/features/identity/identityVault.js";
import { createLocalIdentityService } from "../../js/features/identity/localIdentity.js";

function createMemoryStorage() {
    const values = new Map();
    return {
        values,
        async getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        async setItem(key, value) {
            values.set(key, value);
        },
        async removeItem(key) {
            values.delete(key);
        }
    };
}

function createSynchronousMemoryStorage() {
    const values = new Map();
    return {
        values,
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        }
    };
}

function createVault(accountId) {
    const sealedValues = new Map();
    let sequence = 0;
    return {
        accountId,
        sealedValues,
        async seal(value, { purpose }) {
            sequence += 1;
            const nonce = `${accountId}:${sequence}`;
            sealedValues.set(nonce, { purpose, value: structuredClone(value) });
            // The storage artifact intentionally has no application plaintext.
            return { algorithm: "test-vault", nonce };
        },
        async open(envelope, { purpose }) {
            const sealed = sealedValues.get(envelope?.nonce);
            if (!sealed || sealed.purpose !== purpose) {
                throw new Error("The envelope does not belong to this vault purpose.");
            }
            return structuredClone(sealed.value);
        }
    };
}

function projectDocument(name = "Mission") {
    return {
        name,
        satellites: ["ISS"],
        plannerEvents: [
            {
                id: "manual:review",
                kind: "manual",
                title: "Mission review - private",
                start: "2026-08-22T10:00:00.000Z",
                end: "2026-08-22T11:00:00.000Z",
                color: "purple"
            },
            {
                id: "derived:pass",
                kind: "pass-aos",
                time: "2026-08-22T10:15:00.000Z",
                title: "Derived pass - must not persist"
            }
        ],
        plannerHiddenLayerIds: ["station:madrid"],
        simulation: { mode: "range" }
    };
}

function createLibrary({ accountId = "account:alice", storage = createMemoryStorage(), vault = createVault(accountId), clock, idFactory } = {}) {
    return {
        storage,
        vault,
        library: createUserProjectLibrary({
            session: { accountId, vault },
            storage,
            clock: clock || (() => new Date("2026-08-22T10:00:00.000Z")),
            idFactory
        })
    };
}

test("the encrypted user project library creates, saves, loads, renames, duplicates and removes isolated projects", async () => {
    const times = [
        "2026-08-22T10:00:00.000Z",
        "2026-08-22T10:10:00.000Z",
        "2026-08-22T10:20:00.000Z",
        "2026-08-22T10:30:00.000Z"
    ];
    let current = 0;
    const { library, storage } = createLibrary({
        clock: () => new Date(times[Math.min(current++, times.length - 1)]),
        idFactory: () => "mission-alpha"
    });

    const created = await library.createProject({
        name: "  Mission Alpha  ",
        document: projectDocument("Document name ignored"),
        metadata: { creationMode: PROJECT_CREATION_MODES.GENERATED }
    });
    assert.equal(created.id, "project:mission-alpha");
    assert.equal(created.ownerId, "account:alice");
    assert.equal(created.schemaVersion, 1);
    assert.equal(created.creationMode, PROJECT_CREATION_MODES.GENERATED);
    assert.equal(created.name, "Mission Alpha");
    assert.equal(created.linkage.state, PROJECT_LINKAGE_STATES.LOCAL_ONLY);
    assert.deepEqual(created.syncPreference, { enabled: false, state: PROJECT_SYNC_STATES.DISABLED });
    assert.deepEqual(created.modulePolicies.planner, {
        enabled: true,
        eventRetention: "manual_only",
        storage: "project_local",
        exportFormats: ["ics"],
        canImportEvents: false,
        canUseExternalSync: false,
        syncPreference: { enabled: false, state: PROJECT_SYNC_STATES.DISABLED }
    });

    const diskText = [...storage.values.values()].join("\n");
    assert.equal(diskText.includes("Mission Alpha"), false, "the encrypted index must not expose project metadata");
    assert.equal(diskText.includes("Mission review - private"), false, "the encrypted document must not expose planner events");
    assert.equal(diskText.includes("Derived pass - must not persist"), false);

    const opened = await library.loadProject(created.id);
    assert.equal(opened.document.name, "Mission Alpha");
    assert.deepEqual(opened.document.plannerEvents.map((event) => event.id), ["manual:review"]);
    assert.deepEqual(opened.document.plannerHiddenLayerIds, ["station:madrid"]);

    const saved = await library.saveProject(created.id, {
        ...opened.document,
        name: "Attempted implicit rename",
        plannerEvents: [
            ...opened.document.plannerEvents,
            { id: "derived:again", kind: "pass-los", time: "2026-08-22T11:30:00.000Z" }
        ]
    });
    assert.equal(saved.name, "Mission Alpha");
    assert.equal(saved.documentRevision, 2);
    assert.equal((await library.loadProject(created.id)).document.name, "Mission Alpha");
    assert.deepEqual((await library.loadProject(created.id)).document.plannerEvents.map((event) => event.id), ["manual:review"]);

    const renamed = await library.renameProject(created.id, "Mission Beta");
    assert.equal(renamed.name, "Mission Beta");
    assert.equal((await library.loadProject(created.id)).document.name, "Mission Beta");

    const duplicate = await library.duplicateProject(created.id, { id: "project:copy" });
    assert.equal(duplicate.name, "Mission Beta copy");
    assert.notEqual(duplicate.id, created.id);
    assert.deepEqual((await library.listProjects()).map((project) => project.id).sort(), [created.id, duplicate.id].sort());

    const deleted = await library.deleteProject(created.id);
    assert.equal(deleted.id, created.id);
    await assert.rejects(() => library.loadProject(created.id), UserProjectNotFoundError);
    assert.equal((await library.listProjects()).length, 1);
});

test("linked project policy stores only user preferences and enables no external synchronization itself", async () => {
    const { library } = createLibrary({ idFactory: () => "linked" });
    const created = await library.createProject({
        name: "Linked mission",
        document: projectDocument(),
        linkage: { provider: "google", remoteProjectId: "remote-project-17" },
        syncPreference: true
    });
    assert.deepEqual(created.linkage, {
        provider: "google",
        state: PROJECT_LINKAGE_STATES.GOOGLE_LINKED,
        linked: true,
        remoteProjectId: "remote-project-17"
    });
    assert.deepEqual(created.syncPreference, { enabled: true, state: PROJECT_SYNC_STATES.ENABLED });
    assert.equal(created.modulePolicies.planner.canImportEvents, true);
    assert.equal(created.modulePolicies.planner.canUseExternalSync, true);
    assert.deepEqual(created.modulePolicies.planner.syncPreference, { enabled: true, state: PROJECT_SYNC_STATES.ENABLED });

    const duplicate = await library.duplicateProject(created.id, { id: "project:linked-copy" });
    assert.equal(duplicate.linkage.provider, "google");
    assert.equal(duplicate.linkage.remoteProjectId, null);
    assert.deepEqual(duplicate.syncPreference, { enabled: false, state: PROJECT_SYNC_STATES.DISABLED });

    const movedProvider = await library.setProjectLinkage(created.id, { provider: "microsoft", remoteProjectId: "m-9" });
    assert.equal(movedProvider.linkage.state, PROJECT_LINKAGE_STATES.MICROSOFT_LINKED);
    assert.deepEqual(movedProvider.syncPreference, { enabled: false, state: PROJECT_SYNC_STATES.DISABLED });

    const local = await library.setProjectLinkage(created.id, "local");
    assert.equal(local.linkage.state, PROJECT_LINKAGE_STATES.LOCAL_ONLY);
    assert.deepEqual(local.syncPreference, { enabled: false, state: PROJECT_SYNC_STATES.DISABLED });
    assert.equal(local.modulePolicies.planner.canImportEvents, false);

    const microsoft = await library.setProjectLinkage(created.id, { provider: "microsoft", remoteProjectId: "m-10" });
    assert.equal(microsoft.linkage.state, PROJECT_LINKAGE_STATES.MICROSOFT_LINKED);
    const synced = await library.setPlannerSyncPreference(created.id, true);
    assert.deepEqual(synced.syncPreference, { enabled: true, state: PROJECT_SYNC_STATES.ENABLED });
    assert.deepEqual(synced.modulePolicies.planner.syncPreference, { enabled: true, state: PROJECT_SYNC_STATES.ENABLED });
});

test("metadata exports contain no decrypted document, and all library records remain user scoped", async () => {
    const storage = createMemoryStorage();
    const alice = createLibrary({ accountId: "account:alice", storage, idFactory: () => "alice" }).library;
    const bob = createLibrary({ accountId: "account:bob", storage, idFactory: () => "bob" }).library;
    const aliceProject = await alice.createProject({ name: "Alice mission", document: projectDocument() });
    await bob.createProject({ name: "Bob mission", document: projectDocument() });

    assert.deepEqual((await alice.listProjects()).map((project) => project.name), ["Alice mission"]);
    assert.deepEqual((await bob.listProjects()).map((project) => project.name), ["Bob mission"]);

    const metadata = await alice.exportProjectMetadata(aliceProject.id);
    assert.equal(metadata.project.name, "Alice mission");
    assert.equal("document" in metadata, false);
    assert.equal(JSON.stringify(metadata).includes("Mission review - private"), false);
    const libraryMetadata = await alice.exportLibraryMetadata();
    assert.deepEqual(libraryMetadata.projects.map((project) => project.id), [aliceProject.id]);
});

test("an external logical account uses its opaque companion vault scope for storage keys and envelopes", async () => {
    const storage = createMemoryStorage();
    const vault = createVault("vault-account-opaque-47");
    const library = createUserProjectLibrary({
        session: { accountId: "google:provider-subject-47" },
        vault,
        storage,
        idFactory: () => "opaque-scope"
    });
    const created = await library.createProject({ name: "Scoped mission", document: projectDocument() });
    assert.equal(created.ownerId, "google:provider-subject-47");
    assert.equal(library.storageScope, "vault-account-opaque-47");
    assert.equal(library.storageKeys.prefix.includes("google%3Aprovider-subject-47"), false);
    const rawStorage = [...storage.values.entries()].flat().join("\n");
    assert.equal(rawStorage.includes("google:provider-subject-47"), false);
});

test("local and linked identities sharing one vault protector keep independent encrypted project indexes", async () => {
    const storage = createMemoryStorage();
    const vault = createVault("vault:shared-local-protector");
    const local = createUserProjectLibrary({
        session: { accountId: "local:operator-47", vault },
        storage,
        idFactory: () => "local-project"
    });
    const google = createUserProjectLibrary({
        session: { accountId: "google:provider-subject-47", vault },
        storage,
        idFactory: () => "google-project"
    });

    const [localProject, googleProject] = await Promise.all([
        local.createProject({ name: "Local mission", document: projectDocument("Local mission") }),
        google.createProject({ name: "Google mission", document: projectDocument("Google mission") })
    ]);

    assert.notEqual(local.storageKeys.prefix, google.storageKeys.prefix);
    assert.deepEqual((await local.listProjects()).map((project) => project.id), [localProject.id]);
    assert.deepEqual((await google.listProjects()).map((project) => project.id), [googleProject.id]);
    await assert.rejects(() => local.loadProject(googleProject.id), UserProjectNotFoundError);
    await assert.rejects(() => google.loadProject(localProject.id), UserProjectNotFoundError);
});

test("concurrent library instances serialise index mutations for the same local owner", async () => {
    const storage = createMemoryStorage();
    const vault = createVault("vault:concurrent-owner");
    let sequence = 0;
    const makeLibrary = () => createUserProjectLibrary({
        session: { accountId: "local:concurrent-owner", vault },
        storage,
        idFactory: () => `concurrent-${sequence++}`
    });
    const libraries = Array.from({ length: 12 }, makeLibrary);
    const created = await Promise.all(libraries.map((library, index) => library.createProject({
        name: `Concurrent ${index + 1}`,
        document: projectDocument(`Concurrent ${index + 1}`)
    })));

    const verifier = makeLibrary();
    const listed = await verifier.listProjects();
    assert.equal(listed.length, created.length);
    assert.deepEqual(new Set(listed.map((project) => project.id)), new Set(created.map((project) => project.id)));
});

test("corrupt envelopes, wrong vault capabilities and unsupported envelope versions fail closed", async () => {
    const { library, storage } = createLibrary({ idFactory: () => "tamper" });
    const project = await library.createProject({ name: "Tamper test", document: projectDocument() });
    const rawIndex = JSON.parse(storage.values.get(library.storageKeys.index));
    rawIndex.version = USER_PROJECT_ENVELOPE_VERSION + 1;
    storage.values.set(library.storageKeys.index, JSON.stringify(rawIndex));
    await assert.rejects(() => library.listProjects(), UserProjectLibraryVersionError);

    const second = createLibrary({ idFactory: () => "integrity" });
    const otherProject = await second.library.createProject({ name: "Integrity", document: projectDocument() });
    const rawProjectKey = second.library.storageKeys.prefix + `:project:${encodeURIComponent(otherProject.id)}`;
    const rawProject = JSON.parse(second.storage.values.get(rawProjectKey));
    rawProject.projectId = "project:wrong";
    second.storage.values.set(rawProjectKey, JSON.stringify(rawProject));
    await assert.rejects(() => second.library.loadProject(otherProject.id), UserProjectLibraryIntegrityError);
    assert.ok(project.id);
});

test("the encrypted index and encrypted document must agree on the project name", async () => {
    const { library, storage, vault } = createLibrary({ idFactory: () => "name-binding" });
    const created = await library.createProject({ name: "Bound name", document: projectDocument() });
    const documentKey = `${library.storageKeys.prefix}:project:${encodeURIComponent(created.id)}`;
    const envelope = JSON.parse(storage.values.get(documentKey));
    vault.sealedValues.get(envelope.sealed.nonce).value.document.name = "A different document name";
    await assert.rejects(() => library.loadProject(created.id), UserProjectLibraryIntegrityError);
});

test("invalid encrypted document revisions fail closed instead of being coerced", async () => {
    const { library, storage, vault } = createLibrary({ idFactory: () => "revision-binding" });
    const created = await library.createProject({ name: "Revision binding", document: projectDocument() });
    const documentKey = `${library.storageKeys.prefix}:project:${encodeURIComponent(created.id)}`;
    const envelope = JSON.parse(storage.values.get(documentKey));
    vault.sealedValues.get(envelope.sealed.nonce).value.documentRevision = 0;
    await assert.rejects(() => library.loadProject(created.id), UserProjectLibraryIntegrityError);
});

test("project ids are kept compatible with the identity-vault authenticated purpose grammar", async () => {
    const { library } = createLibrary();
    await assert.rejects(
        () => library.createProject({ id: "project/unsafe", name: "Unsafe", document: projectDocument() }),
        UserProjectLibraryValidationError
    );
});

test("linkage, sync and planner policy normalizers make local-only behavior explicit", () => {
    assert.deepEqual(normalizeProjectLinkage("microsoft_linked"), {
        provider: "microsoft",
        state: PROJECT_LINKAGE_STATES.MICROSOFT_LINKED,
        linked: true,
        remoteProjectId: null
    });
    assert.deepEqual(normalizeProjectSyncPreference(true, "local"), {
        enabled: false,
        state: PROJECT_SYNC_STATES.DISABLED
    });
    assert.deepEqual(normalizeProjectModulePolicies({ planner: { enabled: false, syncPreference: true } }, {
        linkage: "google",
        syncPreference: true
    }).planner, {
        enabled: false,
        eventRetention: "manual_only",
        storage: "project_local",
        exportFormats: ["ics"],
        canImportEvents: true,
        canUseExternalSync: true,
        syncPreference: { enabled: true, state: PROJECT_SYNC_STATES.ENABLED }
    });
    assert.throws(
        () => normalizeUserProjectMetadata({ id: "project:legacy", name: "Legacy", schemaVersion: 2 }),
        UserProjectLibraryVersionError
    );
});

test("the library accepts the real unlocked identity-vault capability and rejects it after logout", async () => {
    const storage = createSynchronousMemoryStorage();
    const identity = createLocalIdentityService({
        storage,
        crypto: globalThis.crypto,
        selectorKeyStore: createInMemoryIdentitySelectorKeyStore(),
        now: () => new Date("2026-08-22T10:00:00.000Z")
    });
    const registered = await identity.registerLocalAccount({
        identifier: "project-owner",
        password: "a-strong-local-password",
        displayName: "Project owner"
    });
    const vault = await identity.getUnlockedVault();
    const library = createUserProjectLibrary({
        session: registered.session,
        vault,
        storage
    });
    const created = await library.createProject({ name: "Identity vault project" });
    assert.equal((await library.loadProject(created.id)).document.name, "Identity vault project");

    identity.logout();
    await assert.rejects(() => library.listProjects(), UserProjectLibraryIntegrityError);
});

test("operator-scale concurrent project writes remain serialised and isolated", async () => {
    let sequence = 0;
    const { library } = createLibrary({
        idFactory: () => `bulk-${String(++sequence).padStart(3, "0")}`
    });
    const count = 32;
    const created = await Promise.all(Array.from({ length: count }, (_, index) => library.createProject({
        name: `Bulk project ${index + 1}`,
        document: projectDocument(`Bulk project ${index + 1}`)
    })));

    assert.equal(new Set(created.map((project) => project.id)).size, count);
    assert.equal((await library.listProjects()).length, count);

    await Promise.all(created.map((project, index) => library.saveProject(project.id, projectDocument(`Updated ${index + 1}`))));
    const restored = await Promise.all(created.map((project) => library.loadProject(project.id)));
    assert.ok(restored.every((project) => project.metadata.documentRevision === 2));
    assert.ok(restored.every((project) => project.document.plannerEvents.length === 1));
});
