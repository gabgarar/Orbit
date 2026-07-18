export const PROJECT_FORMAT = "orbit-project";
export const PROJECT_VERSION = 1;

export function normalizeProjectName(value, fallback = "Untitled project") {
    return String(value || "").trim() || fallback;
}

export function buildProjectDocument({ name, satellites, layerNames, layerTree, groundStations, simulation }) {
    return {
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        name: normalizeProjectName(name),
        exportedAt: new Date().toISOString(),
        satellites: Array.isArray(satellites) ? satellites : [],
        layerNames: layerNames && typeof layerNames === "object" ? layerNames : {},
        layerTree: layerTree && typeof layerTree === "object" ? layerTree : { folders: [], layerParents: {} },
        groundStations: Array.isArray(groundStations) ? groundStations : [],
        simulation: simulation && typeof simulation === "object" ? simulation : {}
    };
}

export function isProjectDocument(value) {
    return Boolean(value) && value.format === PROJECT_FORMAT && value.version === PROJECT_VERSION;
}
