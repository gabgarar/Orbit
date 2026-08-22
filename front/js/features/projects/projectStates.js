import { PROJECT_CREATION_MODES } from "./userProjectLibrary.js";

// Keep workspace state separate from encrypted metadata. `creationMode` is a
// durable origin hint; this compact projection gives React/runtime consumers a
// common, serialisable vocabulary without exposing a project document.
export const PROJECT_WORKSPACE_STATES = Object.freeze({
    NO_PROJECT_OPEN: "no_project_open",
    PROJECT_OPEN: "project_open",
    PROJECT_NEW: "project_new",
    PROJECT_GENERATED: "project_generated"
});

const KNOWN_PROJECT_WORKSPACE_STATES = new Set(Object.values(PROJECT_WORKSPACE_STATES));

export function isProjectWorkspaceState(value) {
    return KNOWN_PROJECT_WORKSPACE_STATES.has(String(value || "").trim().toLowerCase());
}

/** Derive the UI/runtime state without treating a creation origin as a sync state. */
export function projectWorkspaceStateForMetadata(metadata) {
    if (!metadata || typeof metadata !== "object" || !String(metadata.id || "").trim()) {
        return PROJECT_WORKSPACE_STATES.NO_PROJECT_OPEN;
    }
    if (metadata.creationMode === PROJECT_CREATION_MODES.GENERATED) {
        return PROJECT_WORKSPACE_STATES.PROJECT_GENERATED;
    }
    if (metadata.creationMode === PROJECT_CREATION_MODES.NEW) {
        return PROJECT_WORKSPACE_STATES.PROJECT_NEW;
    }
    return PROJECT_WORKSPACE_STATES.PROJECT_OPEN;
}
