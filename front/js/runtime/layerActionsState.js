export const LAYER_ACTIONS_STATE_EVENT = "orbit:layer-actions-state";

const EMPTY_LAYER_ACTIONS_STATE = Object.freeze({
    activeLayerCount: 0,
    hasActiveLayers: false
});

// The legacy runtime can publish before React's effects have subscribed. Keep
// the last known value so the React shell initializes from the real tree state.
let latestLayerActionsState = EMPTY_LAYER_ACTIONS_STATE;

function getValidLayerIds(layerIds) {
    if (!Array.isArray(layerIds)) {
        return [];
    }

    const ids = new Set();
    for (const candidate of layerIds) {
        const id = candidate === null || candidate === undefined ? "" : String(candidate).trim();
        if (id) {
            ids.add(id);
        }
    }
    return [...ids];
}

/**
 * Produces the small UI contract shared by the legacy layer runtime and the
 * React shell. The global hide/show and remove controls only make sense when
 * at least one active layer exists.
 */
export function deriveLayerActionsState(layerIds) {
    const activeLayerCount = getValidLayerIds(layerIds).length;
    return {
        activeLayerCount,
        hasActiveLayers: activeLayerCount > 0
    };
}

export function getLayerActionsState() {
    return latestLayerActionsState;
}

export function emitLayerActionsState(layerIds) {
    const state = deriveLayerActionsState(layerIds);
    latestLayerActionsState = state;

    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
        return state;
    }

    const EventConstructor = typeof CustomEvent === "function" ? CustomEvent : window.CustomEvent;
    if (typeof EventConstructor !== "function") {
        return state;
    }

    window.dispatchEvent(new EventConstructor(LAYER_ACTIONS_STATE_EVENT, {
        detail: state
    }));

    return state;
}
