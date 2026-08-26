import { buildProjectDocument, normalizeProjectName } from "../../../../front/js/runtime/projectDocument.js";
import {
    IDENTITY_STATES,
    isExternalIdentityState
} from "../../../../front/js/features/identity/index.js";
import {
    PROJECT_LINKAGE_PROVIDERS,
    PROJECT_LINKAGE_STATES
} from "../../../../front/js/features/projects/userProjectLibrary.js";

/**
 * Project-hub policy is intentionally pure.  The React surface and the
 * Cesium runtime can agree on these decisions without making storage or
 * provider calls while rendering.
 */
export function projectLinkageForIdentity(session) {
    const state = String((session?.identityState ?? session?.state) || "").trim().toLowerCase();
    if (state === IDENTITY_STATES.GOOGLE_USER) {
        return { provider: PROJECT_LINKAGE_PROVIDERS.GOOGLE, state: PROJECT_LINKAGE_STATES.GOOGLE_LINKED };
    }
    if (state === IDENTITY_STATES.MICROSOFT_USER) {
        return { provider: PROJECT_LINKAGE_PROVIDERS.MICROSOFT, state: PROJECT_LINKAGE_STATES.MICROSOFT_LINKED };
    }
    return { provider: PROJECT_LINKAGE_PROVIDERS.LOCAL, state: PROJECT_LINKAGE_STATES.LOCAL_ONLY };
}

export function canProjectUseExternalSync(project, session) {
    const provider = String(project?.linkage?.provider || "local").trim().toLowerCase();
    return isExternalIdentityState(session?.identityState ?? session?.state)
        && provider !== PROJECT_LINKAGE_PROVIDERS.LOCAL
        && provider === String(session?.provider || "").trim().toLowerCase();
}

/** Build a deliberately empty, serialisable project owned by the user. */
export function createBlankUserProjectDocument(name = "Untitled project") {
    return buildProjectDocument({
        name: normalizeProjectName(name),
        satellites: [],
        manualOrbits: [],
        plannerEvents: [],
        plannerHiddenLayerIds: [],
        propagationHistory: [],
        celestialBodies: [],
        layerNames: {},
        layerTree: { folders: [], layerParents: {} },
        groundStations: [],
        simulation: {}
    });
}

export function projectHubDisplayName(session) {
    const candidate = String(session?.displayName || session?.identifier || "").trim();
    return candidate || "Operador local";
}
