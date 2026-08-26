import { normalizePlannerEvents } from "../features/planner/plannerEvents.js";
import { normalizePlannerHiddenLayerIds } from "../features/planner/plannerRuntimeContext.js";
import { normalizePropagationHistory } from "../features/propagatedParameters/propagationHistory.js";

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

/** Keep only authored planner blocks in v1 project data. */
export function normalizeProjectPlannerEvents(value) {
    return normalizePlannerEvents(value)
        .filter((event) => event.source === "manual" && event.kind === "manual");
}

/** Keep only the project-owned planner layer filter, never scene visibility. */
export function normalizeProjectPlannerHiddenLayerIds(value) {
    return normalizePlannerHiddenLayerIds(value);
}

/**
 * Persist a compact propagation audit owned by the project. It deliberately
 * contains request/result metadata only; sampled ephemerides stay transient
 * in the inspector and can be exported explicitly when required.
 */
export function normalizeProjectPropagationHistory(value) {
    return normalizePropagationHistory(value);
}

export function buildProjectDocument({ name, satellites, layerNames, layerTree, groundStations, simulation, manualOrbits, celestialBodies, plannerEvents, plannerHiddenLayerIds, propagationHistory }) {
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
        // Only authored planner blocks arrive here. Passes, diagnostics and
        // resource horizons are runtime-derived facts and must be recomputed
        // instead of being frozen into a project document.
        plannerEvents: normalizeProjectPlannerEvents(plannerEvents),
        // Planner-only visibility is authored per project. It intentionally
        // does not mutate `visible` in the scene layer tree.
        plannerHiddenLayerIds: normalizeProjectPlannerHiddenLayerIds(plannerHiddenLayerIds),
        // This is an audit trail of completed/running inspector requests, not
        // a second ephemerides cache. The normalizer drops raw samples.
        propagationHistory: normalizeProjectPropagationHistory(propagationHistory),
        layerNames: layerNames && typeof layerNames === "object" ? layerNames : {},
        layerTree: layerTree && typeof layerTree === "object" ? layerTree : { folders: [], layerParents: {} },
        groundStations: Array.isArray(groundStations) ? groundStations : [],
        simulation: simulation && typeof simulation === "object" ? simulation : {}
    };
}

export function isProjectDocument(value) {
    return Boolean(value) && value.format === PROJECT_FORMAT && value.version === PROJECT_VERSION;
}
