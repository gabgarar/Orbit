import {
    buildProjectDocument,
    isProjectDocument,
    normalizeProjectName
} from "../../runtime/projectDocument.js";

/**
 * A user-owned, local-only project library.
 *
 * The library deliberately has no knowledge of OAuth, network transports or
 * renderer state.  It receives an unlocked identity-vault capability and a
 * local storage adapter from its caller.  Both the index (project names,
 * linkage and module preferences) and every project document are sealed
 * independently, so a local-storage inspection never exposes project names,
 * planner events, or scene data.
 *
 * Identity integration:
 *
 * ```js
 * const vault = await identity.getUnlockedVault();
 * const library = createUserProjectLibrary({
 *   session: { accountId: (await identity.getSession()).accountId, vault },
 *   storage: window.localStorage
 * });
 * ```
 *
 * `vault` is an opaque capability.  The built-in local identity service
 * provides `seal(value, { purpose })` / `open(envelope, { purpose })`; the
 * `sealJson` / `openJson` aliases and a generic `crypto.encrypt` /
 * `crypto.decrypt` adapter are accepted as well.  No key material, token or
 * remote request is ever handled by this module.  When a generic provider
 * session exposes a human-readable `userId`, pass its opaque vault account id
 * as `storageScope`; account ids from the built-in vault are used by default.
 */

export const USER_PROJECT_LIBRARY_FORMAT = "orbit-user-project-library";
export const USER_PROJECT_LIBRARY_VERSION = 1;
export const USER_PROJECT_ENVELOPE_FORMAT = "orbit-user-project-envelope";
export const USER_PROJECT_ENVELOPE_VERSION = 1;
export const USER_PROJECT_RECORD_FORMAT = "orbit-user-project-record";
export const USER_PROJECT_RECORD_VERSION = 1;
export const USER_PROJECT_METADATA_VERSION = 1;
export const USER_PROJECT_METADATA_EXPORT_FORMAT = "orbit-user-project-metadata-export";
export const USER_PROJECT_METADATA_EXPORT_VERSION = 1;
export const USER_PROJECT_LIBRARY_NAMESPACE = "orbit.user-project-library";

export const PROJECT_LINKAGE_PROVIDERS = Object.freeze({
    LOCAL: "local",
    GOOGLE: "google",
    MICROSOFT: "microsoft"
});

export const PROJECT_LINKAGE_STATES = Object.freeze({
    LOCAL_ONLY: "local_only",
    GOOGLE_LINKED: "google_linked",
    MICROSOFT_LINKED: "microsoft_linked"
});

export const PROJECT_SYNC_STATES = Object.freeze({
    ENABLED: "sync_enabled",
    DISABLED: "sync_disabled"
});

export const PROJECT_MODULE_IDS = Object.freeze({
    PLANNER: "planner"
});

// This is an authored origin hint for the project hub, not the current UI
// state.  A project can later be open regardless of how it was created.
export const PROJECT_CREATION_MODES = Object.freeze({
    NEW: "project_new",
    GENERATED: "project_generated",
    IMPORTED: "project_imported"
});

const ENVELOPE_KINDS = Object.freeze({
    INDEX: "index",
    PROJECT: "project"
});

// IDs are also used in the identity-vault authenticated purpose.  Keep the
// grammar compact and portable so the real vault's strict purpose binding can
// accept every locally generated project id.
const MAX_PROJECT_ID_LENGTH = 80;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const MAX_OWNER_ID_LENGTH = 320;
const MAX_STORAGE_SCOPE_LENGTH = 180;
const MAX_PROJECT_NAME_LENGTH = 160;
const MAX_REMOTE_PROJECT_ID_LENGTH = 512;
let fallbackIdSequence = 0;
// `createUserProjectLibrary` instances are intentionally short lived (one per
// unlocked UI session).  A page may still have more than one instance during
// React hand-off or in another tab, so an instance-local promise chain alone
// cannot protect an index read/modify/write cycle.  Use Web Locks where the
// browser provides them and retain this process-local queue as the safe
// fallback for browsers/tests without that API.
const inProcessStorageLocks = new Map();

function withInProcessStorageLock(lockName, operation) {
    const prior = inProcessStorageLocks.get(lockName) || Promise.resolve();
    let release;
    const tail = new Promise((resolve) => { release = resolve; });
    inProcessStorageLocks.set(lockName, tail);
    return prior
        .catch(() => {})
        .then(operation)
        .finally(() => {
            release();
            if (inProcessStorageLocks.get(lockName) === tail) {
                inProcessStorageLocks.delete(lockName);
            }
        });
}

function withProjectStorageLock(lockName, operation) {
    const lockManager = globalThis.navigator?.locks;
    if (lockManager && typeof lockManager.request === "function") {
        return lockManager.request(lockName, { mode: "exclusive" }, operation);
    }
    return withInProcessStorageLock(lockName, operation);
}

export class UserProjectLibraryError extends Error {
    constructor(message, options = {}) {
        super(message, options);
        this.name = "UserProjectLibraryError";
    }
}

export class UserProjectLibraryValidationError extends UserProjectLibraryError {
    constructor(message, options = {}) {
        super(message, options);
        this.name = "UserProjectLibraryValidationError";
    }
}

export class UserProjectLibraryIntegrityError extends UserProjectLibraryError {
    constructor(message, options = {}) {
        super(message, options);
        this.name = "UserProjectLibraryIntegrityError";
    }
}

export class UserProjectLibraryVersionError extends UserProjectLibraryError {
    constructor(message, options = {}) {
        super(message, options);
        this.name = "UserProjectLibraryVersionError";
    }
}

export class UserProjectNotFoundError extends UserProjectLibraryError {
    constructor(projectId) {
        super("The requested local project was not found.");
        this.name = "UserProjectNotFoundError";
        this.projectId = projectId;
    }
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asTrimmedString(value) {
    return typeof value === "string" ? value.trim() : String(value || "").trim();
}

function cloneJson(value, label = "value") {
    try {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) {
            throw new TypeError("The value is not JSON serializable.");
        }
        return JSON.parse(serialized);
    } catch (error) {
        throw new UserProjectLibraryValidationError(`The ${label} must be JSON serializable.`, { cause: error });
    }
}

function normalizeProjectId(value, { required = true } = {}) {
    const id = asTrimmedString(value);
    if (!id && !required) return null;
    if (!id) {
        throw new UserProjectLibraryValidationError("A local project id is required.");
    }
    if (id.length > MAX_PROJECT_ID_LENGTH) {
        throw new UserProjectLibraryValidationError("The local project id is too long.");
    }
    if (!PROJECT_ID_PATTERN.test(id)) {
        throw new UserProjectLibraryValidationError("The local project id contains unsupported characters.");
    }
    return id;
}

function normalizeOptionalText(value, maximum, label) {
    if (value === null || value === undefined || value === "") return null;
    const normalized = asTrimmedString(value);
    if (!normalized) return null;
    if (normalized.length > maximum) {
        throw new UserProjectLibraryValidationError(`The ${label} is too long.`);
    }
    return normalized;
}

function normalizeIsoDate(value, fallback) {
    const candidate = value instanceof Date ? value : new Date(value || fallback);
    if (Number.isNaN(candidate.getTime())) return fallback;
    return candidate.toISOString();
}

function nowIso(clock) {
    const value = typeof clock === "function" ? clock() : new Date();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new UserProjectLibraryValidationError("The project-library clock returned an invalid date.");
    }
    return date.toISOString();
}

function normalizedProvider(value) {
    const candidate = asTrimmedString(value).toLowerCase();
    if (["google", "google_linked"].includes(candidate)) return PROJECT_LINKAGE_PROVIDERS.GOOGLE;
    if (["microsoft", "microsoft_linked", "ms"].includes(candidate)) return PROJECT_LINKAGE_PROVIDERS.MICROSOFT;
    return PROJECT_LINKAGE_PROVIDERS.LOCAL;
}

/** Normalize non-secret, per-project linkage metadata. */
export function normalizeProjectLinkage(value) {
    const source = isPlainObject(value) ? value : { provider: value };
    const provider = normalizedProvider(source.provider || source.type || source.state);
    const linked = provider !== PROJECT_LINKAGE_PROVIDERS.LOCAL;
    return {
        provider,
        state: provider === PROJECT_LINKAGE_PROVIDERS.GOOGLE
            ? PROJECT_LINKAGE_STATES.GOOGLE_LINKED
            : provider === PROJECT_LINKAGE_PROVIDERS.MICROSOFT
                ? PROJECT_LINKAGE_STATES.MICROSOFT_LINKED
                : PROJECT_LINKAGE_STATES.LOCAL_ONLY,
        linked,
        // This is only a future provider-side project reference.  The library
        // never stores OAuth credentials and never calls a provider.
        remoteProjectId: linked
            ? normalizeOptionalText(source.remoteProjectId || source.externalId, MAX_REMOTE_PROJECT_ID_LENGTH, "linked project id")
            : null
    };
}

function requestedSyncEnabled(value) {
    if (typeof value === "boolean") return value;
    if (!isPlainObject(value)) {
        return asTrimmedString(value).toLowerCase() === PROJECT_SYNC_STATES.ENABLED;
    }
    if (typeof value.enabled === "boolean") return value.enabled;
    return asTrimmedString(value.state || value.value).toLowerCase() === PROJECT_SYNC_STATES.ENABLED;
}

/**
 * Normalize a stored preference, rather than a live synchronization status.
 * Local projects always remain disabled; a linked project may retain an
 * enabled preference for a future, explicit synchronization adapter.
 */
export function normalizeProjectSyncPreference(value, linkage = PROJECT_LINKAGE_PROVIDERS.LOCAL) {
    const normalizedLinkage = normalizeProjectLinkage(linkage);
    const enabled = normalizedLinkage.linked && requestedSyncEnabled(value);
    return {
        enabled,
        state: enabled ? PROJECT_SYNC_STATES.ENABLED : PROJECT_SYNC_STATES.DISABLED
    };
}

function normalizePlannerPolicy(value, linkage, fallbackSyncPreference, { forceSyncPreference = false } = {}) {
    const source = isPlainObject(value) ? value : {};
    const syncPreference = normalizeProjectSyncPreference(
        forceSyncPreference ? fallbackSyncPreference : source.syncPreference ?? source.sync ?? fallbackSyncPreference,
        linkage
    );
    const linkedProvider = linkage.linked;
    return {
        enabled: source.enabled !== false,
        // Planner-created events are project authored data.  Derived passes,
        // diagnostics and resource horizons are recomputed rather than saved.
        eventRetention: "manual_only",
        storage: "project_local",
        exportFormats: ["ics"],
        // These are eligibility flags for a future, explicit provider
        // adapter.  They never initiate an import or synchronization here.
        canImportEvents: linkedProvider,
        canUseExternalSync: linkedProvider,
        syncPreference
    };
}

/**
 * Normalize module policy without creating an external integration.  Only the
 * Planner policy exists today, but the shape is intentionally extensible.
 */
export function normalizeProjectModulePolicies(value, { linkage, syncPreference, forceSyncPreference = false } = {}) {
    const source = isPlainObject(value) ? value : {};
    const normalizedLinkage = normalizeProjectLinkage(linkage || source.linkage);
    const normalizedSync = normalizeProjectSyncPreference(syncPreference ?? source.syncPreference, normalizedLinkage);
    const plannerSource = source[PROJECT_MODULE_IDS.PLANNER] || source.planner;
    return {
        [PROJECT_MODULE_IDS.PLANNER]: normalizePlannerPolicy(plannerSource, normalizedLinkage, normalizedSync, { forceSyncPreference })
    };
}

function normalizeDocumentRevision(value, { strict = false } = {}) {
    if (value === undefined || value === null || value === "") return 1;
    const revision = Number(value);
    if (!Number.isInteger(revision) || revision <= 0) {
        if (strict) {
            throw new UserProjectLibraryIntegrityError("The encrypted project revision is invalid.");
        }
        return 1;
    }
    return revision;
}

function normalizeProjectCreationMode(value) {
    const mode = asTrimmedString(value).toLowerCase();
    if (mode === PROJECT_CREATION_MODES.GENERATED) return PROJECT_CREATION_MODES.GENERATED;
    if (mode === PROJECT_CREATION_MODES.IMPORTED) return PROJECT_CREATION_MODES.IMPORTED;
    return PROJECT_CREATION_MODES.NEW;
}

function normalizeMetadataSchemaVersion(value) {
    if (value === undefined || value === null || value === "") return USER_PROJECT_METADATA_VERSION;
    const version = Number(value);
    if (!Number.isInteger(version) || version !== USER_PROJECT_METADATA_VERSION) {
        throw new UserProjectLibraryVersionError("This project metadata version is not supported.");
    }
    return version;
}

function rethrowStoredSchemaError(error, message) {
    if (error instanceof UserProjectLibraryVersionError || error instanceof UserProjectLibraryIntegrityError) {
        throw error;
    }
    throw new UserProjectLibraryIntegrityError(message, { cause: error });
}

/** Normalize the metadata kept in the encrypted project index. */
export function normalizeUserProjectMetadata(value, {
    now = new Date().toISOString(),
    requireId = true,
    ownerId: expectedOwnerId = null,
    strictDocumentRevision = false
} = {}) {
    if (!isPlainObject(value)) {
        throw new UserProjectLibraryValidationError("Project metadata must be an object.");
    }
    const id = normalizeProjectId(value.id, { required: requireId });
    const suppliedOwnerId = normalizeOptionalText(value.ownerId, MAX_OWNER_ID_LENGTH, "project owner id");
    const ownerId = expectedOwnerId
        ? normalizeOptionalText(expectedOwnerId, MAX_OWNER_ID_LENGTH, "project owner id")
        : suppliedOwnerId;
    if (expectedOwnerId && suppliedOwnerId && suppliedOwnerId !== ownerId) {
        throw new UserProjectLibraryValidationError("The project metadata belongs to another user.");
    }
    const requestedName = normalizeProjectName(value.name, "Untitled project");
    if (requestedName.length > MAX_PROJECT_NAME_LENGTH) {
        throw new UserProjectLibraryValidationError("The project name is too long.");
    }
    const createdAt = normalizeIsoDate(value.createdAt, now);
    const requestedUpdatedAt = normalizeIsoDate(value.updatedAt, createdAt);
    const updatedAt = Date.parse(requestedUpdatedAt) < Date.parse(createdAt) ? createdAt : requestedUpdatedAt;
    const linkage = normalizeProjectLinkage(value.linkage || value.provider || value.linkageState);
    const hasTopLevelSyncPreference = Object.hasOwn(value, "syncPreference") || Object.hasOwn(value, "sync");
    const requestedSync = value.syncPreference ?? value.sync ?? value.modulePolicies?.planner?.syncPreference ?? value.modules?.planner?.syncPreference;
    const syncPreference = normalizeProjectSyncPreference(requestedSync, linkage);
    const modulePolicies = normalizeProjectModulePolicies(value.modulePolicies || value.modules, {
        linkage,
        syncPreference,
        forceSyncPreference: hasTopLevelSyncPreference
    });
    return {
        id,
        ownerId,
        schemaVersion: normalizeMetadataSchemaVersion(value.schemaVersion),
        creationMode: normalizeProjectCreationMode(value.creationMode ?? value.origin),
        name: requestedName,
        createdAt,
        updatedAt,
        linkage,
        syncPreference: modulePolicies.planner.syncPreference,
        modulePolicies,
        documentRevision: normalizeDocumentRevision(value.documentRevision, { strict: strictDocumentRevision })
    };
}

/**
 * Canonicalize a project document before it is encrypted.  This deliberately
 * shares the existing .orbit document contract and consequently retains only
 * authored manual planner events/filters, never generated passes or runtime
 * renderer state.
 */
export function normalizeUserProjectDocument(value, { name } = {}) {
    if (value !== undefined && !isPlainObject(value)) {
        throw new UserProjectLibraryValidationError("The project document must be an object.");
    }
    const source = value || {};
    const canonical = buildProjectDocument({
        name: name ?? source.name,
        satellites: source.satellites,
        manualOrbits: source.manualOrbits,
        celestialBodies: source.celestialBodies,
        plannerEvents: source.plannerEvents,
        plannerHiddenLayerIds: source.plannerHiddenLayerIds,
        layerNames: source.layerNames,
        layerTree: source.layerTree,
        groundStations: source.groundStations,
        simulation: source.simulation
    });
    return cloneJson(canonical, "project document");
}

function normalizeIndex(value, { ownerId, now }) {
    if (!isPlainObject(value)) {
        throw new UserProjectLibraryIntegrityError("The encrypted project index is invalid.");
    }
    if (value.format !== USER_PROJECT_LIBRARY_FORMAT) {
        throw new UserProjectLibraryIntegrityError("The encrypted project index belongs to another format.");
    }
    if (value.version !== USER_PROJECT_LIBRARY_VERSION) {
        throw new UserProjectLibraryVersionError("This project-library index version is not supported.");
    }
    if (asTrimmedString(value.ownerId) !== ownerId) {
        throw new UserProjectLibraryIntegrityError("The encrypted project index belongs to another user.");
    }
    if (!Array.isArray(value.projects)) {
        throw new UserProjectLibraryIntegrityError("The encrypted project index has no project list.");
    }
    const ids = new Set();
    let projects;
    try {
        projects = value.projects.map((candidate) => {
            const metadata = normalizeUserProjectMetadata(candidate, { now, ownerId, strictDocumentRevision: true });
            if (ids.has(metadata.id)) {
                throw new UserProjectLibraryIntegrityError("The encrypted project index has duplicate project ids.");
            }
            ids.add(metadata.id);
            return metadata;
        });
    } catch (error) {
        rethrowStoredSchemaError(error, "The encrypted project index has invalid project metadata.");
    }
    return {
        format: USER_PROJECT_LIBRARY_FORMAT,
        version: USER_PROJECT_LIBRARY_VERSION,
        ownerId,
        updatedAt: normalizeIsoDate(value.updatedAt, now),
        projects
    };
}

function emptyIndex(ownerId, now) {
    return {
        format: USER_PROJECT_LIBRARY_FORMAT,
        version: USER_PROJECT_LIBRARY_VERSION,
        ownerId,
        updatedAt: now,
        projects: []
    };
}

function createProjectRecord(projectId, documentRevision, document) {
    return {
        format: USER_PROJECT_RECORD_FORMAT,
        version: USER_PROJECT_RECORD_VERSION,
        projectId,
        documentRevision,
        document
    };
}

function normalizeProjectRecord(value, { projectId, documentRevision, name }) {
    if (!isPlainObject(value)) {
        throw new UserProjectLibraryIntegrityError("The encrypted project document is invalid.");
    }
    if (value.format !== USER_PROJECT_RECORD_FORMAT) {
        throw new UserProjectLibraryIntegrityError("The encrypted project document belongs to another format.");
    }
    if (value.version !== USER_PROJECT_RECORD_VERSION) {
        throw new UserProjectLibraryVersionError("This encrypted project document version is not supported.");
    }
    try {
        if (normalizeProjectId(value.projectId) !== projectId) {
            throw new UserProjectLibraryIntegrityError("The encrypted project document belongs to another project.");
        }
        if (normalizeDocumentRevision(value.documentRevision, { strict: true }) !== documentRevision) {
            throw new UserProjectLibraryIntegrityError("The project index and document revision do not match.");
        }
        if (!isProjectDocument(value.document)) {
            throw new UserProjectLibraryIntegrityError("The encrypted project contains an unsupported document.");
        }
        if (normalizeProjectName(value.document.name, "Untitled project") !== name) {
            throw new UserProjectLibraryIntegrityError("The project index and document name do not match.");
        }
        const document = normalizeUserProjectDocument(value.document, { name });
        return document;
    } catch (error) {
        rethrowStoredSchemaError(error, "The encrypted project document has an invalid schema.");
    }
}

function isSupportedEnvelope(value, expectedKind, projectId = null) {
    return isPlainObject(value)
        && value.format === USER_PROJECT_ENVELOPE_FORMAT
        && value.version === USER_PROJECT_ENVELOPE_VERSION
        && value.kind === expectedKind
        && (expectedKind !== ENVELOPE_KINDS.PROJECT || value.projectId === projectId)
        && Object.hasOwn(value, "sealed");
}

function parseStoredEnvelope(raw, expectedKind, projectId = null) {
    let parsed;
    try {
        parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (error) {
        throw new UserProjectLibraryIntegrityError("An encrypted project envelope cannot be read.", { cause: error });
    }
    if (isPlainObject(parsed)
        && parsed.format === USER_PROJECT_ENVELOPE_FORMAT
        && parsed.version !== USER_PROJECT_ENVELOPE_VERSION) {
        throw new UserProjectLibraryVersionError("This encrypted project-envelope version is not supported.");
    }
    if (!isSupportedEnvelope(parsed, expectedKind, projectId)) {
        throw new UserProjectLibraryIntegrityError("An encrypted project envelope is invalid or belongs elsewhere.");
    }
    return parsed;
}

function serializeEnvelope({ kind, projectId = null, sealed }) {
    try {
        return JSON.stringify({
            format: USER_PROJECT_ENVELOPE_FORMAT,
            version: USER_PROJECT_ENVELOPE_VERSION,
            kind,
            projectId: kind === ENVELOPE_KINDS.PROJECT ? projectId : null,
            sealed: cloneJson(sealed, "encrypted envelope")
        });
    } catch (error) {
        if (error instanceof UserProjectLibraryError) throw error;
        throw new UserProjectLibraryIntegrityError("The encrypted project envelope cannot be stored.", { cause: error });
    }
}

function resolveStorageAdapter(storage) {
    const get = storage?.getItem || storage?.get;
    const set = storage?.setItem || storage?.set;
    const remove = storage?.removeItem || storage?.delete;
    if (typeof get !== "function" || typeof set !== "function" || typeof remove !== "function") {
        throw new UserProjectLibraryValidationError("A local storage adapter with get/set/remove methods is required.");
    }
    return {
        get: (key) => get.call(storage, key),
        set: (key, value) => set.call(storage, key, value),
        remove: (key) => remove.call(storage, key)
    };
}

function resolveVaultAdapter(vaultOrCrypto) {
    const seal = vaultOrCrypto?.seal || vaultOrCrypto?.sealJson || vaultOrCrypto?.encrypt;
    const open = vaultOrCrypto?.open || vaultOrCrypto?.openJson || vaultOrCrypto?.decrypt;
    if (typeof seal !== "function" || typeof open !== "function") {
        throw new UserProjectLibraryValidationError("An unlocked vault with seal/open methods is required.");
    }
    return {
        seal: (value, purpose) => seal.call(vaultOrCrypto, value, { purpose }),
        open: (sealed, purpose) => open.call(vaultOrCrypto, sealed, { purpose })
    };
}

function resolveSession(config) {
    const session = isPlainObject(config.session) ? config.session : {};
    const vaultInput = config.vault || session.vault || config.crypto;
    const ownerId = normalizeOptionalText(
        config.ownerId ?? config.userId ?? session.ownerId ?? session.accountId ?? session.userId ?? vaultInput?.accountId,
        MAX_OWNER_ID_LENGTH,
        "user id"
    );
    if (!ownerId) {
        throw new UserProjectLibraryValidationError("An authenticated user id is required for the project library.");
    }
    const storageScope = normalizeOptionalText(
        config.storageScope ?? session.storageScope ?? vaultInput?.accountId ?? session.accountId ?? ownerId,
        MAX_STORAGE_SCOPE_LENGTH,
        "project storage scope"
    );
    if (!storageScope) {
        throw new UserProjectLibraryValidationError("An opaque project storage scope is required.");
    }
    return { ownerId, storageScope, vault: resolveVaultAdapter(vaultInput) };
}

// Storage-key privacy is a naming boundary, not the cryptographic protection
// boundary: envelopes are still authenticated by the unlocked vault. Mixing
// the physical vault scope with the logical owner gives local and external
// identities independent records even when they share one vault protector.
function opaqueStoragePartition(storageScope, ownerId) {
    const source = `${storageScope}\u0000${ownerId}`;
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < source.length; index += 1) {
        const code = source.charCodeAt(index);
        first = Math.imul(first ^ code, 0x01000193);
        second = Math.imul(second ^ ((code << (index % 13)) | (code >>> (13 - (index % 13)))), 0x85ebca6b);
    }
    return `p${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

/**
 * Return storage keys without exposing a logical account id. `storageScope`
 * identifies the physical vault; the resulting partition additionally binds
 * the logical project owner so a linked provider never collides with its
 * local protector's project index.
 */
export function userProjectLibraryStorageKeys(ownerId, {
    namespace = USER_PROJECT_LIBRARY_NAMESPACE,
    projectId = null,
    storageScope = null
} = {}) {
    const normalizedOwner = normalizeOptionalText(ownerId, MAX_OWNER_ID_LENGTH, "project owner id");
    const normalizedScope = normalizeOptionalText(storageScope ?? ownerId, MAX_STORAGE_SCOPE_LENGTH, "project storage scope");
    if (!normalizedOwner || !normalizedScope) {
        throw new UserProjectLibraryValidationError("An opaque project storage scope is required.");
    }
    const normalizedNamespace = asTrimmedString(namespace) || USER_PROJECT_LIBRARY_NAMESPACE;
    const prefix = `${normalizedNamespace}:v${USER_PROJECT_LIBRARY_VERSION}:owner:${opaqueStoragePartition(normalizedScope, normalizedOwner)}`;
    if (projectId === null || projectId === undefined) {
        return { index: `${prefix}:index`, prefix };
    }
    return {
        index: `${prefix}:index`,
        project: `${prefix}:project:${encodeURIComponent(normalizeProjectId(projectId))}`,
        prefix
    };
}

function sortedMetadata(projects) {
    return projects
        .map((project) => cloneJson(project, "project metadata"))
        .sort((left, right) => {
            const newest = right.updatedAt.localeCompare(left.updatedAt);
            if (newest) return newest;
            const created = right.createdAt.localeCompare(left.createdAt);
            if (created) return created;
            return left.id.localeCompare(right.id);
        });
}

function nextProjectId(idFactory) {
    const proposed = typeof idFactory === "function" ? idFactory() : globalThis.crypto?.randomUUID?.();
    if (proposed) return normalizeProjectId(`project:${proposed}`);
    fallbackIdSequence += 1;
    return `project:${Date.now()}-${fallbackIdSequence}`;
}

/**
 * Build an encrypted, local-only per-user project library.
 *
 * All methods return Promises so callers can use browser localStorage, an
 * IndexedDB wrapper, or tests' in-memory adapters interchangeably.  No method
 * performs a network request or contacts an identity provider.
 */
export function createUserProjectLibrary(config = {}) {
    const { ownerId, storageScope, vault } = resolveSession(config);
    const storage = resolveStorageAdapter(config.storage || globalThis.localStorage);
    const namespace = asTrimmedString(config.namespace) || USER_PROJECT_LIBRARY_NAMESPACE;
    const clock = config.clock;
    const idFactory = config.idFactory;
    const keys = userProjectLibraryStorageKeys(ownerId, { namespace, storageScope });
    const storagePartition = keys.prefix.split(":").at(-1);
    const storageLockName = `${namespace}:v${USER_PROJECT_LIBRARY_VERSION}:${storagePartition}`;
    let pending = Promise.resolve();

    const runSerialized = (operation) => {
        const guardedOperation = () => withProjectStorageLock(storageLockName, operation);
        const result = pending.then(guardedOperation, guardedOperation);
        // A failed caller operation must not permanently block later work.
        pending = result.catch(() => {});
        return result;
    };

    const operationNow = () => nowIso(clock);
    // `sealAccountJson` already binds every envelope to the unlocked vault's
    // account id.  Do not repeat a potentially long storage scope here: the
    // vault deliberately limits purposes to a compact safe grammar.
    const purposeForIndex = () => `orbit-projects:v${USER_PROJECT_LIBRARY_VERSION}:owner:${storagePartition}:index`;
    const purposeForProject = (projectId) => `orbit-projects:v${USER_PROJECT_LIBRARY_VERSION}:owner:${storagePartition}:project:${projectId}`;
    const projectKey = (projectId) => userProjectLibraryStorageKeys(ownerId, { namespace, projectId, storageScope }).project;

    const storageGet = async (key) => {
        try {
            return await storage.get(key);
        } catch (error) {
            throw new UserProjectLibraryError("Local project storage could not be read.", { cause: error });
        }
    };
    const storageSet = async (key, value) => {
        try {
            await storage.set(key, value);
        } catch (error) {
            throw new UserProjectLibraryError("Local project storage could not be updated.", { cause: error });
        }
    };
    const storageRemove = async (key) => {
        try {
            await storage.remove(key);
        } catch (error) {
            throw new UserProjectLibraryError("Local project storage could not be updated.", { cause: error });
        }
    };

    const seal = async (value, purpose) => {
        try {
            return await vault.seal(cloneJson(value, "encrypted project value"), purpose);
        } catch (error) {
            if (error instanceof UserProjectLibraryError) throw error;
            throw new UserProjectLibraryIntegrityError("Local project data could not be encrypted.", { cause: error });
        }
    };
    const open = async (sealed, purpose) => {
        try {
            return await vault.open(sealed, purpose);
        } catch (error) {
            throw new UserProjectLibraryIntegrityError("Local project data could not be decrypted or verified.", { cause: error });
        }
    };
    const encodeEnvelope = async ({ kind, projectId = null, value, purpose }) => serializeEnvelope({
        kind,
        projectId,
        sealed: await seal(value, purpose)
    });
    const readIndex = async () => {
        const raw = await storageGet(keys.index);
        if (raw === null || raw === undefined || raw === "") {
            return emptyIndex(ownerId, operationNow());
        }
        const envelope = parseStoredEnvelope(raw, ENVELOPE_KINDS.INDEX);
        const opened = await open(envelope.sealed, purposeForIndex());
        return normalizeIndex(opened, { ownerId, now: operationNow() });
    };
    const encodeIndex = (index) => encodeEnvelope({
        kind: ENVELOPE_KINDS.INDEX,
        value: index,
        purpose: purposeForIndex()
    });
    const readProjectDocument = async (metadata) => {
        const raw = await storageGet(projectKey(metadata.id));
        if (raw === null || raw === undefined || raw === "") {
            throw new UserProjectLibraryIntegrityError("The project index refers to a missing encrypted document.");
        }
        const envelope = parseStoredEnvelope(raw, ENVELOPE_KINDS.PROJECT, metadata.id);
        const opened = await open(envelope.sealed, purposeForProject(metadata.id));
        return normalizeProjectRecord(opened, {
            projectId: metadata.id,
            documentRevision: metadata.documentRevision,
            name: metadata.name
        });
    };
    const encodeProjectDocument = (metadata, document) => encodeEnvelope({
        kind: ENVELOPE_KINDS.PROJECT,
        projectId: metadata.id,
        value: createProjectRecord(metadata.id, metadata.documentRevision, document),
        purpose: purposeForProject(metadata.id)
    });
    const findProject = (index, projectId) => {
        const normalizedId = normalizeProjectId(projectId);
        const metadata = index.projects.find((candidate) => candidate.id === normalizedId);
        if (!metadata) throw new UserProjectNotFoundError(normalizedId);
        return metadata;
    };
    const replaceIndex = (index, projects, now) => ({
        ...index,
        updatedAt: now,
        projects
    });
    const updateMetadataOnly = async (projectId, transform) => {
        const now = operationNow();
        const index = await readIndex();
        const current = findProject(index, projectId);
        const candidate = transform(cloneJson(current, "project metadata"), now);
        const metadata = normalizeUserProjectMetadata(candidate, { now, ownerId });
        const nextIndex = replaceIndex(index, index.projects.map((entry) => entry.id === metadata.id ? metadata : entry), now);
        const encodedIndex = await encodeIndex(nextIndex);
        await storageSet(keys.index, encodedIndex);
        return cloneJson(metadata, "project metadata");
    };
    const replaceDocumentAndIndex = async ({ index, current, metadata, document, now }) => {
        const currentKey = projectKey(current.id);
        const priorDocument = await storageGet(currentKey);
        if (priorDocument === null || priorDocument === undefined || priorDocument === "") {
            throw new UserProjectLibraryIntegrityError("The project index refers to a missing encrypted document.");
        }
        const nextIndex = replaceIndex(index, index.projects.map((entry) => entry.id === current.id ? metadata : entry), now);
        const [encodedDocument, encodedIndex] = await Promise.all([
            encodeProjectDocument(metadata, document),
            encodeIndex(nextIndex)
        ]);
        await storageSet(currentKey, encodedDocument);
        try {
            await storageSet(keys.index, encodedIndex);
        } catch (error) {
            // Keep index and document revisions aligned when the second write
            // fails.  If restoration itself fails, the original error still
            // tells the caller that the operation did not commit.
            try {
                await storageSet(currentKey, priorDocument);
            } catch {
                // The next read will surface the integrity failure explicitly.
            }
            throw error;
        }
        return cloneJson(metadata, "project metadata");
    };

    const createProjectInternal = async (options = {}) => {
        const now = operationNow();
        const index = await readIndex();
        let id = options.id ? normalizeProjectId(options.id) : null;
        if (!id) {
            for (let attempt = 0; attempt < 12; attempt += 1) {
                const candidate = nextProjectId(idFactory);
                if (!index.projects.some((project) => project.id === candidate)) {
                    id = candidate;
                    break;
                }
            }
        }
        if (!id || index.projects.some((project) => project.id === id)) {
            throw new UserProjectLibraryValidationError("A unique local project id could not be created.");
        }
        const sourceMetadata = isPlainObject(options.metadata) ? options.metadata : {};
        const documentInput = options.document;
        const metadata = normalizeUserProjectMetadata({
            ...sourceMetadata,
            id,
            ownerId,
            schemaVersion: USER_PROJECT_METADATA_VERSION,
            name: options.name ?? sourceMetadata.name ?? documentInput?.name,
            createdAt: options.createdAt ?? sourceMetadata.createdAt ?? now,
            updatedAt: now,
            linkage: options.linkage ?? sourceMetadata.linkage,
            syncPreference: options.syncPreference ?? sourceMetadata.syncPreference,
            modulePolicies: options.modulePolicies ?? options.modules ?? sourceMetadata.modulePolicies ?? sourceMetadata.modules,
            documentRevision: 1
        }, { now });
        const document = normalizeUserProjectDocument(documentInput, { name: metadata.name });
        const nextIndex = replaceIndex(index, [...index.projects, metadata], now);
        const [encodedDocument, encodedIndex] = await Promise.all([
            encodeProjectDocument(metadata, document),
            encodeIndex(nextIndex)
        ]);
        const key = projectKey(metadata.id);
        await storageSet(key, encodedDocument);
        try {
            await storageSet(keys.index, encodedIndex);
        } catch (error) {
            try {
                await storageRemove(key);
            } catch {
                // An orphaned sealed document is harmless and unreadable
                // without the index/vault; preserve the primary write error.
            }
            throw error;
        }
        return cloneJson(metadata, "project metadata");
    };

    return Object.freeze({
        ownerId,
        storageScope,
        storageKeys: Object.freeze({ ...keys }),
        async listProjects() {
            return runSerialized(async () => sortedMetadata((await readIndex()).projects));
        },
        async getProjectMetadata(projectId) {
            return runSerialized(async () => cloneJson(findProject(await readIndex(), projectId), "project metadata"));
        },
        async createProject(options = {}) {
            return runSerialized(() => createProjectInternal(options));
        },
        async loadProject(projectId) {
            return runSerialized(async () => {
                const index = await readIndex();
                const metadata = findProject(index, projectId);
                const document = await readProjectDocument(metadata);
                return {
                    metadata: cloneJson(metadata, "project metadata"),
                    document: cloneJson(document, "project document")
                };
            });
        },
        async saveProject(projectId, document) {
            return runSerialized(async () => {
                const now = operationNow();
                const index = await readIndex();
                const current = findProject(index, projectId);
                const metadata = normalizeUserProjectMetadata({
                    ...current,
                    updatedAt: now,
                    documentRevision: current.documentRevision + 1
                }, { now });
                // Project identity lives in metadata.  A document save cannot
                // accidentally rename a project; use renameProject instead.
                const normalizedDocument = normalizeUserProjectDocument(document, { name: metadata.name });
                return replaceDocumentAndIndex({ index, current, metadata, document: normalizedDocument, now });
            });
        },
        async renameProject(projectId, name) {
            return runSerialized(async () => {
                const now = operationNow();
                const index = await readIndex();
                const current = findProject(index, projectId);
                const document = await readProjectDocument(current);
                const metadata = normalizeUserProjectMetadata({
                    ...current,
                    name,
                    updatedAt: now,
                    documentRevision: current.documentRevision + 1
                }, { now });
                const renamedDocument = normalizeUserProjectDocument(document, { name: metadata.name });
                return replaceDocumentAndIndex({ index, current, metadata, document: renamedDocument, now });
            });
        },
        async duplicateProject(projectId, options = {}) {
            return runSerialized(async () => {
                const index = await readIndex();
                const source = findProject(index, projectId);
                const document = await readProjectDocument(source);
                const sourceModulePolicies = cloneJson(source.modulePolicies, "project module policies");
                // A duplicate must never inherit a remote project identity or
                // an enabled future sync preference; doing so could make a
                // future connector target the original remote project.
                const duplicateOptions = {
                    ...options,
                    name: options.name ?? `${source.name} copy`,
                    document,
                    linkage: options.linkage ?? {
                        ...source.linkage,
                        remoteProjectId: null
                    },
                    syncPreference: options.syncPreference ?? false,
                    modulePolicies: options.modulePolicies ?? options.modules ?? sourceModulePolicies
                };
                return createProjectInternal(duplicateOptions);
            });
        },
        async deleteProject(projectId) {
            return runSerialized(async () => {
                const now = operationNow();
                const index = await readIndex();
                const current = findProject(index, projectId);
                const nextIndex = replaceIndex(index, index.projects.filter((entry) => entry.id !== current.id), now);
                const encodedIndex = await encodeIndex(nextIndex);
                // Make the removal visible only after its index is ready.  A
                // failed document removal attempts to restore the old index.
                await storageSet(keys.index, encodedIndex);
                try {
                    await storageRemove(projectKey(current.id));
                } catch (error) {
                    try {
                        await storageSet(keys.index, await encodeIndex(index));
                    } catch {
                        // The document remains encrypted but may be an orphan;
                        // no plaintext data is exposed either way.
                    }
                    throw error;
                }
                return cloneJson(current, "project metadata");
            });
        },
        async setProjectLinkage(projectId, linkage, { syncPreference } = {}) {
            return runSerialized(() => updateMetadataOnly(projectId, (current, now) => {
                const normalizedLinkage = normalizeProjectLinkage({
                    ...current.linkage,
                    ...(isPlainObject(linkage) ? linkage : { provider: linkage })
                });
                const linkageChanged = normalizedLinkage.provider !== current.linkage.provider
                    || normalizedLinkage.remoteProjectId !== current.linkage.remoteProjectId;
                return {
                    ...current,
                    linkage: normalizedLinkage,
                    // A new provider/destination is never implicitly
                    // authorized by the old one.  Callers may opt in again
                    // explicitly in this same operation.
                    syncPreference: syncPreference ?? (linkageChanged ? false : current.syncPreference),
                    updatedAt: now
                };
            }));
        },
        async setProjectSyncPreference(projectId, syncPreference) {
            return runSerialized(() => updateMetadataOnly(projectId, (current, now) => ({
                ...current,
                syncPreference,
                updatedAt: now
            })));
        },
        // Explicit alias for UI code that speaks in Planner terms.  It updates
        // the only existing module preference while retaining a future generic
        // project-level preference API above.
        async setPlannerSyncPreference(projectId, syncPreference) {
            return runSerialized(() => updateMetadataOnly(projectId, (current, now) => ({
                ...current,
                syncPreference,
                modulePolicies: {
                    ...current.modulePolicies,
                    planner: {
                        ...current.modulePolicies.planner,
                        syncPreference
                    }
                },
                updatedAt: now
            })));
        },
        async exportProjectMetadata(projectId) {
            return runSerialized(async () => ({
                format: USER_PROJECT_METADATA_EXPORT_FORMAT,
                version: USER_PROJECT_METADATA_EXPORT_VERSION,
                exportedAt: operationNow(),
                project: cloneJson(findProject(await readIndex(), projectId), "project metadata")
            }));
        },
        async exportLibraryMetadata() {
            return runSerialized(async () => ({
                format: USER_PROJECT_METADATA_EXPORT_FORMAT,
                version: USER_PROJECT_METADATA_EXPORT_VERSION,
                exportedAt: operationNow(),
                projects: sortedMetadata((await readIndex()).projects)
            }));
        }
    });
}
