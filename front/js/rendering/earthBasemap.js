/**
 * Earth imagery is deliberately managed separately from the workspace layer
 * tree.  A base map is one globe-wide raster source while the night-light
 * overlay remains an independent, solar-aware layer above it.
 *
 * No Cesium ion token is required by any entry in this registry.  The first
 * option is bundled with Cesium, so an offline Docker deployment always has a
 * useful, deterministic base map.
 */

export const DEFAULT_EARTH_BASEMAP_ID = "natural-earth";

const REMOTE_BASEMAPS = new Set(["openstreetmap", "esri-world-imagery"]);

export const EARTH_BASEMAPS = Object.freeze([
    Object.freeze({
        id: "natural-earth",
        label: "Natural Earth",
        description: "Local physical map bundled with Orbit. Available offline.",
        attribution: "Natural Earth II · Cesium",
        source: "local",
        kind: "natural-earth"
    }),
    Object.freeze({
        id: "earth2km-local",
        label: "Earth 2 km (local)",
        description: "Optional high-detail local tiles generated in this workspace.",
        attribution: "Local Earth 2 km tiles",
        source: "local",
        kind: "earth2km"
    }),
    Object.freeze({
        id: "openstreetmap",
        label: "OpenStreetMap",
        description: "Clean public road and place map. Requires an internet connection.",
        attribution: "© OpenStreetMap contributors",
        source: "remote",
        kind: "openstreetmap"
    }),
    Object.freeze({
        id: "esri-world-imagery",
        label: "World Imagery",
        description: "Public satellite and aerial imagery service. Requires an internet connection.",
        attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        source: "remote",
        kind: "esri-world-imagery"
    })
]);

const basemapById = new Map(EARTH_BASEMAPS.map((entry) => [entry.id, entry]));

function hasImageryLayer(collection, layer) {
    if (!collection || !layer) return false;
    if (typeof collection.contains === "function") return collection.contains(layer);
    const length = Number(collection.length) || 0;
    for (let index = 0; index < length; index += 1) {
        if (collection.get?.(index) === layer) return true;
    }
    return false;
}

function makeCredit(Cesium, text) {
    if (typeof Cesium?.Credit === "function") return new Cesium.Credit(text);
    return text;
}

function createProvider(Cesium, definition) {
    const credit = makeCredit(Cesium, definition.attribution);
    if (definition.kind === "natural-earth") {
        return new Cesium.UrlTemplateImageryProvider({
            // Cesium's bundled Natural Earth II data is EPSG:4326 TMS, hence
            // GeographicTilingScheme plus reverseY rather than Web Mercator.
            url: "/Cesium/Assets/Textures/NaturalEarthII/{z}/{x}/{reverseY}.jpg",
            tilingScheme: new Cesium.GeographicTilingScheme(),
            minimumLevel: 0,
            maximumLevel: 2,
            rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
            credit
        });
    }
    if (definition.kind === "earth2km") {
        return new Cesium.UrlTemplateImageryProvider({
            url: "assets/earth2km_tiles/{z}/{x}/{y}.jpg",
            tilingScheme: new Cesium.WebMercatorTilingScheme(),
            minimumLevel: 0,
            maximumLevel: 6,
            rectangle: Cesium.Rectangle.fromDegrees(-180, -85.05112878, 180, 85.05112878),
            credit
        });
    }
    if (definition.kind === "openstreetmap") {
        return new Cesium.UrlTemplateImageryProvider({
            url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            minimumLevel: 0,
            maximumLevel: 19,
            credit
        });
    }
    if (definition.kind === "esri-world-imagery") {
        return new Cesium.UrlTemplateImageryProvider({
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            minimumLevel: 0,
            maximumLevel: 19,
            credit
        });
    }
    throw new Error(`Unsupported Earth basemap: ${definition?.id || "unknown"}`);
}

function resolveSelection(value, { localEarth2kmAvailable, offlineMode }) {
    const requestedId = basemapById.has(value) ? value : DEFAULT_EARTH_BASEMAP_ID;
    const requested = basemapById.get(requestedId);
    if (requested.kind === "earth2km" && !localEarth2kmAvailable) {
        return {
            requestedId,
            selectedId: DEFAULT_EARTH_BASEMAP_ID,
            fallbackReason: "local-tiles-unavailable"
        };
    }
    if (REMOTE_BASEMAPS.has(requested.id) && offlineMode) {
        return {
            requestedId,
            selectedId: DEFAULT_EARTH_BASEMAP_ID,
            fallbackReason: "offline-mode"
        };
    }
    return { requestedId, selectedId: requestedId, fallbackReason: "" };
}

/**
 * Return presentation-ready records.  `available` is intentionally explicit
 * so UI callers can disable an external source in offline Docker deployments
 * instead of allowing a selection that will render a blank globe.
 */
export function getEarthBasemapChoices({ localEarth2kmAvailable = false, offlineMode = false } = {}) {
    return EARTH_BASEMAPS.map((entry) => ({
        ...entry,
        available: entry.kind !== "earth2km"
            ? !(REMOTE_BASEMAPS.has(entry.id) && offlineMode)
            : Boolean(localEarth2kmAvailable),
        unavailableReason: entry.kind === "earth2km" && !localEarth2kmAvailable
            ? "local-tiles-unavailable"
            : REMOTE_BASEMAPS.has(entry.id) && offlineMode
                ? "offline-mode"
                : ""
    }));
}

export function normalizeEarthBasemapId(value, options = {}) {
    return resolveSelection(value, options).selectedId;
}

/**
 * Owns exactly one day/base imagery layer.  It never removes the night
 * overlay; after every switch that overlay is raised above the new base layer.
 */
export function createEarthBasemapManager({
    viewer,
    Cesium,
    nightImageryLayer,
    logger = console,
    localEarth2kmAvailable = false,
    offlineMode = false,
    onStateChange = null
} = {}) {
    let baseLayer = null;
    let requestedId = DEFAULT_EARTH_BASEMAP_ID;
    let selectedId = DEFAULT_EARTH_BASEMAP_ID;
    let fallbackReason = "";
    let localTilesAvailable = Boolean(localEarth2kmAvailable);
    let offline = Boolean(offlineMode);
    let providerErrorUnsubscribe = null;
    let providerErrorCount = 0;

    const getState = () => ({
        requestedId,
        selectedId,
        fallbackReason,
        definition: basemapById.get(selectedId),
        choices: getEarthBasemapChoices({ localEarth2kmAvailable: localTilesAvailable, offlineMode: offline })
    });

    const publishState = () => {
        const state = getState();
        onStateChange?.(state);
        return state;
    };

    const detachProviderErrorListener = () => {
        providerErrorUnsubscribe?.();
        providerErrorUnsubscribe = null;
        providerErrorCount = 0;
    };

    const keepNightLayerAboveBase = () => {
        const collection = viewer?.scene?.imageryLayers;
        if (!collection) return;
        const nightLayer = nightImageryLayer?.attach?.() || nightImageryLayer?.getLayer?.();
        if (nightLayer && typeof collection.raiseToTop === "function") {
            collection.raiseToTop(nightLayer);
        }
    };

    const attachProviderErrorListener = (provider, activeId) => {
        if (!REMOTE_BASEMAPS.has(activeId) || !provider?.errorEvent?.addEventListener) return;
        const listener = (error) => {
            providerErrorCount += 1;
            logger?.warn?.(`Earth basemap '${activeId}' request failed (${providerErrorCount}).`, error);
            // Do not flicker on a single transient request.  Repeated failures
            // normally mean the browser has no external network route.
            if (providerErrorCount >= 2 && selectedId === activeId) {
                logger?.warn?.(`Restoring local Earth basemap after repeated '${activeId}' failures.`);
                apply(DEFAULT_EARTH_BASEMAP_ID, { preserveRequestedId: true });
                fallbackReason = "remote-provider-unavailable";
                publishState();
            }
        };
        const unsubscribe = provider.errorEvent.addEventListener(listener);
        providerErrorUnsubscribe = typeof unsubscribe === "function"
            ? unsubscribe
            : () => provider.errorEvent?.removeEventListener?.(listener);
    };

    const apply = (value, { preserveRequestedId = false, force = false } = {}) => {
        const resolution = resolveSelection(value, {
            localEarth2kmAvailable: localTilesAvailable,
            offlineMode: offline
        });
        requestedId = preserveRequestedId ? requestedId : resolution.requestedId;
        selectedId = resolution.selectedId;
        fallbackReason = resolution.fallbackReason;

        const collection = viewer?.scene?.imageryLayers;
        if (!collection || !Cesium) return publishState();
        if (!force && baseLayer && hasImageryLayer(collection, baseLayer)
            && baseLayer.__orbitBasemapId === selectedId) {
            keepNightLayerAboveBase();
            return publishState();
        }

        detachProviderErrorListener();
        if (baseLayer && hasImageryLayer(collection, baseLayer)) {
            collection.remove(baseLayer, true);
        }

        const definition = basemapById.get(selectedId);
        const provider = createProvider(Cesium, definition);
        baseLayer = collection.addImageryProvider(provider, 0);
        // A private marker avoids touching other future imagery overlays.
        baseLayer.__orbitBasemapId = selectedId;
        attachProviderErrorListener(provider, selectedId);
        keepNightLayerAboveBase();
        return publishState();
    };

    const setLocalEarth2kmAvailable = (value) => {
        localTilesAvailable = Boolean(value);
        return apply(requestedId, { force: requestedId !== selectedId });
    };

    const setOfflineMode = (value) => {
        offline = Boolean(value);
        return apply(requestedId, { force: requestedId !== selectedId });
    };

    const dispose = () => {
        detachProviderErrorListener();
        const collection = viewer?.scene?.imageryLayers;
        if (baseLayer && hasImageryLayer(collection, baseLayer)) {
            collection.remove(baseLayer, true);
        }
        baseLayer = null;
    };

    return {
        apply,
        dispose,
        getState,
        setLocalEarth2kmAvailable,
        setOfflineMode
    };
}
