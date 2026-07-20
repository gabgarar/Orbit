export const PROJECT_FORMAT = "orbit-project";
export const PROJECT_VERSION = 1;

export function normalizeProjectName(value, fallback = "Untitled project") {
    return String(value || "").trim() || fallback;
}

function cloneProjectValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => cloneProjectValue(item));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneProjectValue(item)]));
    }
    return value;
}

function normalizeManualOrbits(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    // Manual-orbit records are intentionally project data rather than a
    // catalogue cache. Keep the document forward-compatible: the runtime
    // validates each entry while restoring it, but exporting must never keep
    // a live mutable reference to a Cesium/runtime object.
    return value
        .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
        .map((entry) => cloneProjectValue(entry));
}

export function buildProjectDocument({ name, satellites, layerNames, layerTree, groundStations, simulation, manualOrbits }) {
    return {
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        name: normalizeProjectName(name),
        exportedAt: new Date().toISOString(),
        satellites: Array.isArray(satellites) ? satellites : [],
        // Optional in documents produced before manual-orbit design existed.
        // It is kept in the v1 contract so older projects remain readable.
        manualOrbits: normalizeManualOrbits(manualOrbits),
        layerNames: layerNames && typeof layerNames === "object" ? layerNames : {},
        layerTree: layerTree && typeof layerTree === "object" ? layerTree : { folders: [], layerParents: {} },
        groundStations: Array.isArray(groundStations) ? groundStations : [],
        simulation: simulation && typeof simulation === "object" ? simulation : {}
    };
}

export function isProjectDocument(value) {
    return Boolean(value) && value.format === PROJECT_FORMAT && value.version === PROJECT_VERSION;
}
