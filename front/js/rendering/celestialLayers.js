/**
 * Workspace layers for Cesium's physical Sun and Moon surfaces.
 *
 * Orbit's Tycho sky dome is an ordinary opaque primitive. Cesium submits its
 * native Sun/Moon in the environment pass first, so the dome can overwrite
 * them afterwards. The visible surfaces are therefore custom physical
 * EllipsoidPrimitives in the normal scene collection; the built-in bodies are
 * explicitly suppressed to avoid a duplicate render path.
 *
 * A non-rendering entity stays as the layer's stable selection/focus anchor.
 * The surface primitive points back to it through Cesium's pick id, so a click
 * on a real lunar/solar surface still selects the corresponding layer.
 */

import {
    MOON_TEXTURE_URL as MOON_TEXTURE_ASSET_URL,
    createCelestialSurfaceRenderer
} from "./celestialSurfaceRenderer.js";

export const CELESTIAL_LAYER_IDS = Object.freeze({
    earth: "body:earth",
    sun: "body:sun",
    moon: "body:moon"
});

// Cesium's globe is already the authoritative Earth renderer.  It is exposed
// in the workspace as a first-class layer so the user can select and focus it
// alongside Moon/Sun, but it must never create a second ellipsoid on top of
// the globe.  The WGS84 semi-major radius is also the safe camera-focus
// radius used by the runtime.
export const EARTH_LAYER_ID = CELESTIAL_LAYER_IDS.earth;
export const EARTH_RADIUS_METERS = 6_378_137;

// Browsers do not reliably decode the supplied 16-bit TIFF. This is its 4k
// browser-ready conversion, kept as a project asset rather than fetched from
// a third party at runtime.
export const MOON_TEXTURE_URL = MOON_TEXTURE_ASSET_URL;

export const CELESTIAL_BODY_DEFINITIONS = Object.freeze({
    earth: Object.freeze({
        id: CELESTIAL_LAYER_IDS.earth,
        kind: "earth",
        name: "Earth",
        radiusMeters: EARTH_RADIUS_METERS,
        layerType: "EARTH",
        // This layer is the scene's central reference body. It remains in
        // every project and is intentionally absent from project snapshots.
        persistent: true,
        renderer: "globe"
    }),
    sun: Object.freeze({
        id: CELESTIAL_LAYER_IDS.sun,
        kind: "sun",
        name: "Sun",
        radiusMeters: 695_700_000,
        layerType: "CELESTIAL_BODY",
        renderer: "surface",
        ephemerisMethod: "computeSunPositionInEarthInertialFrame"
    }),
    moon: Object.freeze({
        id: CELESTIAL_LAYER_IDS.moon,
        kind: "moon",
        name: "Moon",
        radiusMeters: 1_737_400,
        layerType: "CELESTIAL_BODY",
        renderer: "surface",
        ephemerisMethod: "computeMoonPositionInEarthInertialFrame"
    })
});

export function normalizeCelestialBodyKind(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return Object.hasOwn(CELESTIAL_BODY_DEFINITIONS, normalized) ? normalized : null;
}

export function getCelestialLayerId(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (Object.values(CELESTIAL_LAYER_IDS).includes(normalized)) {
        return normalized;
    }
    const kind = normalizeCelestialBodyKind(normalized.replace(/^body:/, ""));
    return kind ? CELESTIAL_BODY_DEFINITIONS[kind].id : null;
}

export function isCelestialBodyLayerId(value) {
    return Boolean(getCelestialLayerId(value));
}

export function isEarthLayerId(value) {
    return getCelestialLayerId(value) === EARTH_LAYER_ID;
}

export function getCelestialBodyDefinition(value) {
    const id = getCelestialLayerId(value);
    return Object.values(CELESTIAL_BODY_DEFINITIONS).find((definition) => definition.id === id) || null;
}

function createCartesian(Cesium, x = 0, y = 0, z = 0) {
    return typeof Cesium?.Cartesian3 === "function"
        ? new Cesium.Cartesian3(x, y, z)
        : { x, y, z };
}

function cartesianMagnitude(Cesium, position) {
    if (!position) return 0;
    if (typeof Cesium?.Cartesian3?.magnitude === "function") {
        return Cesium.Cartesian3.magnitude(position);
    }
    return Math.hypot(Number(position.x) || 0, Number(position.y) || 0, Number(position.z) || 0);
}

/**
 * Simon1994 returns Earth-centred inertial coordinates.  The application
 * renders Earth-fixed entities, so transform at the exact viewer clock time.
 * Cesium can temporarily defer ICRF data while loading; its pseudo-fixed
 * transform is a short-lived continuity fallback, never a second clock.
 */
export function computeCelestialBodyFixedPosition({ Cesium, kind, time, result } = {}) {
    const definition = getCelestialBodyDefinition(kind);
    if (definition?.kind === "earth") {
        const target = result || createCartesian(Cesium);
        target.x = 0;
        target.y = 0;
        target.z = 0;
        return target;
    }
    const planetaryPositions = Cesium?.Simon1994PlanetaryPositions;
    const compute = definition && planetaryPositions?.[definition.ephemerisMethod];
    if (!definition || typeof compute !== "function" || !time) {
        return undefined;
    }

    const inertial = compute(time, createCartesian(Cesium));
    if (!inertial || cartesianMagnitude(Cesium, inertial) <= 0) {
        return undefined;
    }

    const transforms = Cesium?.Transforms;
    const fixedMatrix = typeof transforms?.computeIcrfToFixedMatrix === "function"
        ? transforms.computeIcrfToFixedMatrix(time)
        : undefined;
    const fallbackMatrix = !fixedMatrix && typeof transforms?.computeTemeToPseudoFixedMatrix === "function"
        ? transforms.computeTemeToPseudoFixedMatrix(time)
        : undefined;
    const matrix = fixedMatrix || fallbackMatrix;
    if (!matrix || typeof Cesium?.Matrix3?.multiplyByVector !== "function") {
        return undefined;
    }

    return Cesium.Matrix3.multiplyByVector(matrix, inertial, result || createCartesian(Cesium));
}

function julianDateToTimestampMs(Cesium, time) {
    try {
        const date = Cesium?.JulianDate?.toDate?.(time);
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
    } catch {
        return null;
    }
}

function nativeBody(scene, kind) {
    return kind === "sun" ? scene?.sun : scene?.moon;
}

function callbackProperty(Cesium, callback, initialValue) {
    return typeof Cesium?.CallbackProperty === "function"
        ? new Cesium.CallbackProperty(callback, false)
        : initialValue;
}

function normalizeSnapshot(snapshot) {
    const values = Array.isArray(snapshot) ? snapshot : [];
    const seen = new Set();
    return values.reduce((items, value) => {
        const definition = getCelestialBodyDefinition(typeof value === "string" ? value : value?.kind || value?.id);
        const kind = definition?.kind || null;
        // Earth is a permanent scene layer, not a project-owned ephemeris
        // body. Ignoring it here keeps old/new project files interchangeable
        // and prevents a saved hidden Earth from reopening as an empty scene.
        if (!kind || definition?.persistent === true || seen.has(kind)) return items;
        seen.add(kind);
        items.push({ kind, visible: value?.visible !== false });
        return items;
    }, []);
}

/**
 * Gives the layer tree a small adapter with the same active/visibility shape
 * as satellites and ground stations.  The state is intentionally tiny: the
 * ephemeris is recalculated from viewer.clock.currentTime, never persisted.
 */
export function createCelestialBodyLayerManager({ viewer, Cesium, logger = null } = {}) {
    const records = new Map();

    const getTime = () => viewer?.clock?.currentTime;
    const getPosition = (idOrKind, time = getTime(), result) => computeCelestialBodyFixedPosition({
        Cesium,
        kind: idOrKind,
        time,
        result
    });

    // A surface is not a successful visual merely because its primitive was
    // allocated. For example, Cesium can briefly defer a frame transform or
    // an image upload. Keep the native ephemeris body as a fallback until the
    // custom opaque surface has actually been made renderable.
    const syncNativeSurfaceFallback = (definition, isRenderable) => {
        const native = nativeBody(viewer?.scene, definition?.kind);
        const record = records.get(definition?.id);
        if (native && typeof native === "object") {
            native.show = record?.visible === true && isRenderable !== true;
        }
    };

    const surfaceRenderers = new Map(Object.values(CELESTIAL_BODY_DEFINITIONS)
        .filter((definition) => definition.renderer === "surface")
        .map((definition) => [
        definition.id,
        createCelestialSurfaceRenderer({
            kind: definition.kind,
            viewer,
            Cesium,
            radiusMeters: definition.radiusMeters,
            textureUrl: definition.kind === "moon" ? MOON_TEXTURE_URL : undefined,
            getPosition: (time, result) => getPosition(definition.kind, time || getTime(), result),
            onRenderStateChange: ({ renderable }) => syncNativeSurfaceFallback(definition, renderable),
            logger
        })
        ]));

    const syncNativeBodyVisibility = () => {
        for (const definition of Object.values(CELESTIAL_BODY_DEFINITIONS)) {
            const record = records.get(definition.id);
            const isVisible = record?.visible === true;
            if (definition.renderer === "globe") {
                // The globe's imagery/terrain are Cesium-owned. Toggle the
                // single real Earth rather than overlaying a second surface.
                if (viewer?.scene?.globe) {
                    viewer.scene.globe.show = isVisible;
                }
                continue;
            }
            const native = nativeBody(viewer?.scene, definition.kind);
            const renderer = surfaceRenderers.get(definition.id);
            renderer?.setVisible(isVisible);
            if (native && typeof native === "object") {
                // A custom surface has its own normal opaque render pass. Do
                // not re-enable Cesium's environment primitive underneath it.
                // If the browser could not construct our material/primitive,
                // retain Cesium's native fallback rather than leaving a layer
                // with no visual at all.
                const hasCustomSurface = renderer?.isRenderable === true;
                native.show = isVisible && !hasCustomSurface;
            }
        }
        viewer?.scene?.requestRender?.();
    };

    const createAnchorEntity = (definition, visible) => {
        const initialPosition = getPosition(definition.kind);
        const position = callbackProperty(
            Cesium,
            (time, result) => getPosition(definition.kind, time || getTime(), result),
            initialPosition
        );
        const entityOptions = {
            id: definition.id,
            name: definition.name,
            position,
            show: visible,
            properties: {
                orbitLayerId: definition.id,
                orbitLayerType: definition.layerType || "CELESTIAL_BODY",
                celestialBody: definition.kind
            }
        };
        return viewer?.entities?.add?.(entityOptions) || { ...entityOptions };
    };

    const add = (kind, { visible = true } = {}) => {
        const definition = getCelestialBodyDefinition(kind);
        if (!definition) return null;
        const existing = records.get(definition.id);
        if (existing) {
            existing.visible = visible !== false;
            existing.entity && (existing.entity.show = existing.visible);
            syncNativeBodyVisibility();
            return definition.id;
        }

        const record = {
            ...definition,
            visible: visible !== false,
            entity: createAnchorEntity(definition, visible !== false)
        };
        records.set(definition.id, record);
        surfaceRenderers.get(definition.id)?.setPickId(record.entity);
        syncNativeBodyVisibility();
        logger?.info?.(`Celestial body layer added: ${definition.name}`);
        return definition.id;
    };

    const remove = (idOrKind) => {
        const id = getCelestialLayerId(idOrKind);
        const record = id ? records.get(id) : null;
        if (!record) return false;
        // Earth is the workspace reference body. It can be hidden through
        // the eye control, but never removed by a generic clear/remove flow.
        if (record.persistent === true) return false;
        if (viewer?.trackedEntity === record.entity) {
            viewer.trackedEntity = undefined;
        }
        if (viewer?.selectedEntity === record.entity) {
            viewer.selectedEntity = undefined;
        }
        if (record.entity && viewer?.entities?.remove) {
            viewer.entities.remove(record.entity);
        }
        records.delete(id);
        surfaceRenderers.get(id)?.destroy();
        syncNativeBodyVisibility();
        logger?.info?.(`Celestial body layer removed: ${record.name}`);
        return true;
    };

    const clear = () => {
        const removed = [...records.keys()]
            .filter((id) => records.get(id)?.persistent !== true)
            .reduce((didRemove, id) => remove(id) || didRemove, false);

        // A new/opened project always starts from the physical Earth rather
        // than inheriting a previous session's global-hide state.
        for (const record of records.values()) {
            if (record.persistent !== true) continue;
            record.visible = true;
            if (record.entity) record.entity.show = true;
        }
        syncNativeBodyVisibility();
        return removed;
    };

    const restore = (snapshot) => {
        clear();
        return normalizeSnapshot(snapshot)
            .map((entry) => add(entry.kind, { visible: entry.visible }))
            .filter(Boolean);
    };

    const has = (idOrKind) => records.has(getCelestialLayerId(idOrKind));
    const isActive = has;
    const getIds = () => [...records.keys()];
    const getEntity = (idOrKind) => records.get(getCelestialLayerId(idOrKind))?.entity || null;
    const getName = (idOrKind) => records.get(getCelestialLayerId(idOrKind))?.name
        || getCelestialBodyDefinition(idOrKind)?.name
        || String(idOrKind || "");
    const getDefinition = (idOrKind) => getCelestialBodyDefinition(idOrKind);
    const getVisibility = (idOrKind) => records.get(getCelestialLayerId(idOrKind))?.visible === true;
    const setVisibility = (idOrKind, visible) => {
        const record = records.get(getCelestialLayerId(idOrKind));
        if (!record) return false;
        record.visible = visible === true;
        if (record.entity) record.entity.show = record.visible;
        syncNativeBodyVisibility();
        return true;
    };
    const getSnapshot = () => [...records.values()]
        .filter(({ persistent }) => persistent !== true)
        .map(({ kind, visible }) => ({ kind, visible }));
    const getTelemetry = (idOrKind) => {
        const record = records.get(getCelestialLayerId(idOrKind));
        if (!record) return null;
        const time = getTime();
        const position = getPosition(record.kind, time);
        const timestampMs = julianDateToTimestampMs(Cesium, time);
        const earthDistance = cartesianMagnitude(Cesium, position);
        return {
            id: record.name,
            name: record.name,
            source_format: "CELESTIAL",
            source_origin: "CESIUM",
            celestial_body: record.kind,
            body_radius_m: record.radiusMeters,
            earth_center_distance_m: Number.isFinite(earthDistance) ? earthDistance : null,
            distance_from_earth_m: Number.isFinite(earthDistance) ? earthDistance : null,
            position_ecef_m: position ? { x: position.x, y: position.y, z: position.z } : null,
            position_frame: "ITRF / ECEF",
            runtime_state: record.visible ? "ACTIVE" : "HIDDEN",
            timestamp_ms: timestampMs,
            telemetry_age_ms: 0,
            propagation_future_hours: 0
        };
    };

    // Earth is the permanent centre body of every workspace.  Moon/Sun remain
    // opt-in so a project never displays an ephemeris body without a matching
    // layer record.
    add("earth");
    syncNativeBodyVisibility();

    return {
        add,
        remove,
        clear,
        restore,
        has,
        isActive,
        getIds,
        getEntity,
        getName,
        getDefinition,
        getVisibility,
        setVisibility,
        getSnapshot,
        getTelemetry,
        getPosition,
        getSurfacePrimitive: (idOrKind) => surfaceRenderers.get(getCelestialLayerId(idOrKind))?.getPrimitive?.() || null,
        syncNativeBodyVisibility
    };
}
