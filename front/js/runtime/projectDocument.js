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

function normalizeCelestialBodies(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const validKinds = new Set(["sun", "moon"]);
    const seen = new Set();
    return value.reduce((items, entry) => {
        const rawKind = typeof entry === "string" ? entry : entry?.kind || entry?.id;
        const kind = String(rawKind || "").trim().toLowerCase().replace(/^body:/, "");
        if (!validKinds.has(kind) || seen.has(kind)) {
            return items;
        }
        seen.add(kind);
        items.push({ kind, visible: entry?.visible !== false });
        return items;
    }, []);
}

export function buildProjectDocument({ name, satellites, layerNames, layerTree, groundStations, simulation, manualOrbits, celestialBodies }) {
    return {
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        name: normalizeProjectName(name),
        exportedAt: new Date().toISOString(),
        satellites: Array.isArray(satellites) ? satellites : [],
        // Optional in documents produced before manual-orbit design existed.
        // It is kept in the v1 contract so older projects remain readable.
        manualOrbits: normalizeManualOrbits(manualOrbits),
        // Positions are calculated again by Cesium from the current scene
        // clock; project data only preserves the active body layers.
        celestialBodies: normalizeCelestialBodies(celestialBodies),
        layerNames: layerNames && typeof layerNames === "object" ? layerNames : {},
        layerTree: layerTree && typeof layerTree === "object" ? layerTree : { folders: [], layerParents: {} },
        groundStations: Array.isArray(groundStations) ? groundStations : [],
        simulation: simulation && typeof simulation === "object" ? simulation : {}
    };
}

export function isProjectDocument(value) {
    return Boolean(value) && value.format === PROJECT_FORMAT && value.version === PROJECT_VERSION;
}
