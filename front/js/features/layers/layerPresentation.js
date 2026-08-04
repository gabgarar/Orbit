/**
 * Visual semantics for entries in the workspace layer tree.
 *
 * Keep this separate from the renderer so the UI can consistently classify
 * an object even while a project is being restored or a specialised layer is
 * being added by another subsystem.
 */

const ICONS = Object.freeze({
    satellite: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="8" width="6" height="8" rx="1.1"/><path d="M9 10H4.5v4H9m6-4h4.5v4H15M11 8V5m2 0v3m-2 8v3m2-3v3"/><path d="m10.4 5 1.6-2 1.6 2M10.4 19l1.6 2 1.6-2"/></svg>',
    groundStation: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16M8.4 19l2.2-7h2.8l2.2 7M9.5 8.8a3.6 3.6 0 0 1 5 0M7.1 6.1a7 7 0 0 1 9.8 0"/><circle cx="12" cy="10.4" r="1.1"/></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.8 15.5A8.1 8.1 0 0 1 8.5 5.2 8.1 8.1 0 1 0 18.8 15.5Z"/><path d="M10.1 10.2h.01M13.4 14h.01M15.1 8.2h.01"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.1"/><path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7 5.3 5.3"/></svg>',
    earth: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.2"/><path d="M3.9 12h16.2M12 3.8c2.1 2.2 3.2 5 3.2 8.2S14.1 18 12 20.2C9.9 18 8.8 15.2 8.8 12S9.9 6 12 3.8"/><path d="M5.7 7.5c1.9.9 4 1.3 6.3 1.3s4.4-.4 6.3-1.3M5.7 16.5c1.9-.9 4-1.3 6.3-1.3s4.4.4 6.3 1.3"/></svg>',
    bodies: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.4"/><path d="M3 12c2.4-3.1 5.5-4.7 9-4.7 3.5 0 6.6 1.6 9 4.7-2.4 3.1-5.5 4.7-9 4.7-3.5 0-6.6-1.6-9-4.7Z"/><circle cx="18.5" cy="6.2" r="1.35"/><path d="M5.1 18.1h4.4"/></svg>',
    point: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>',
    layer: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 8 4.2-8 4.2-8-4.2 8-4.2Z"/><path d="m4 12 8 4.2 8-4.2M4 16.3l8 4.2 8-4.2"/></svg>'
});

const PRESENTATIONS = Object.freeze({
    satellite: Object.freeze({ key: "satellite", label: "Satélite", icon: ICONS.satellite, isBody: false }),
    groundStation: Object.freeze({ key: "ground-station", label: "Estación terrestre", icon: ICONS.groundStation, isBody: false }),
    moon: Object.freeze({ key: "moon", label: "Luna", icon: ICONS.moon, isBody: true }),
    sun: Object.freeze({ key: "sun", label: "Sol", icon: ICONS.sun, isBody: true }),
    earth: Object.freeze({ key: "earth", label: "Tierra", icon: ICONS.earth, isBody: true }),
    bodies: Object.freeze({ key: "bodies", label: "Bodies", icon: ICONS.bodies, isBody: false }),
    point: Object.freeze({ key: "point", label: "Punto", icon: ICONS.point, isBody: false }),
    layer: Object.freeze({ key: "layer", label: "Capa", icon: ICONS.layer, isBody: false })
});

function normalized(value) {
    return String(value || "").trim().toUpperCase();
}

/**
 * Resolve a stable presentation without tying the layer tree to a particular
 * physics/renderer implementation. `body:earth` is accepted while the Earth
 * layer is restored before its type adapter has been initialised.
 */
export function getLayerPresentation(layerType, layerId = "") {
    const type = normalized(layerType);
    const id = String(layerId || "").trim().toLowerCase();

    if (type === "EARTH" || id === "body:earth") return PRESENTATIONS.earth;
    if (type === "CELESTIAL_BODY" || type === "BODY") {
        if (id === "body:moon" || id.endsWith(":moon")) return PRESENTATIONS.moon;
        if (id === "body:sun" || id.endsWith(":sun")) return PRESENTATIONS.sun;
        if (id === "body:earth" || id.endsWith(":earth")) return PRESENTATIONS.earth;
        return PRESENTATIONS.layer;
    }
    if (type === "GROUND_STATION" || type === "GROUNDSTATION") return PRESENTATIONS.groundStation;
    if (type === "POINT") return PRESENTATIONS.point;
    if (type === "SATELLITE" || !type) return PRESENTATIONS.satellite;
    return PRESENTATIONS.layer;
}

export function isBodyLayer(layerType, layerId = "") {
    return getLayerPresentation(layerType, layerId).isBody;
}

export function isEarthLayer(layerType, layerId = "") {
    return getLayerPresentation(layerType, layerId).key === "earth";
}

/** Presentation for the permanent, collapsible Bodies group in Layers. */
export function getBodyGroupPresentation() {
    return PRESENTATIONS.bodies;
}
