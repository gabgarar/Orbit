import {
    initSatelliteReceiver,
    preloadSatelliteCatalog,
    fetchCatalogPage,
    refreshSatelliteCatalog,
    setOrbitConfig,
    getSatelliteIds,
    isCatalogLoaded,
    getSatelliteTle,
    getSatelliteTleAsync,
    getActiveSatelliteLayerIds,
    getSatelliteEntity,
    getSatelliteTelemetry,
    isSatelliteVisible,
    setSatelliteVisible,
    isSatelliteLayerActive,
    setSatelliteLayerActive,
    setAllSatelliteLayersActive,
    setAllSatellitesVisible,
    setSelectedOrbitSatelliteId
} from "./js/satellites.js";
import { setupRuntimeConfigPanel } from "./js/configPanel.js";
import { setupObjectSidebar } from "./js/objectSidebar.js";
import { configureLogger, getLogger } from "./js/logger.js";
import { normalizeSystemConfig, toSectionedSystemConfig } from "./js/configAdapter.js";

const logger = getLogger("main");
logger.info("Iniciando Cesium...");

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

async function loadConfig() {
    try {
        const response = await fetch("/config/system_config.json", { cache: "no-cache" });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        logger.error("No se pudo cargar system_config.json:", error);
        return null;
    }
}

async function persistSystemConfig(sectionedSystemConfig, dataConfig) {
    const response = await fetch("/api/system-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            system: sectionedSystemConfig,
            data: dataConfig
        })
    });

    if (!response.ok) {
        let detail = "";
        try {
            const payload = await response.json();
            detail = payload?.error ? `: ${payload.error}` : "";
        } catch {
            detail = "";
        }
        throw new Error(`HTTP ${response.status}${detail}`);
    }
}

async function persistSystemConfigWithRetry(sectionedSystemConfig, dataConfig, retries = 2) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            await persistSystemConfig(sectionedSystemConfig, dataConfig);
            return;
        } catch (error) {
            lastError = error;
            if (attempt >= retries) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
        }
    }

    throw lastError;
}

logger.info("Creando SingleTileImageryProvider para assets/earth8.jpg...");

const localProvider = new Cesium.SingleTileImageryProvider({
    url: "assets/earth8km.jpg",
    rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
});

const nightProvider = new Cesium.SingleTileImageryProvider({
    url: "assets/earthnight3km.jpg",
    rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
});

logger.info("Creando Cesium Viewer...");

const viewer = new Cesium.Viewer("cesiumContainer", {
    imageryProvider: localProvider,
    baseLayerPicker: false,
    geocoder: false,
    infoBox: false,
    selectionIndicator: true,
    timeline: false,
    animation: false,
    sceneModePicker: true,
    fullscreenButton: false,
    homeButton: true,
    terrainProvider: await Cesium.createWorldTerrainAsync(),
    contextOptions: {
        webgl: {
            antialias: true,
            alpha: false,
            depth: true,
            stencil: false,
            preserveDrawingBuffer: false
        }
    },
    targetFrameRate: 60,
    requestRenderMode: false,
    enableLighting: true,
    scene3DOnly: false
});

if (viewer?.cesiumWidget?.creditContainer) {
    viewer.cesiumWidget.creditContainer.style.display = "none";
    viewer.cesiumWidget.creditContainer.setAttribute("aria-hidden", "true");
}

const tychoSkyDomeTextureUrl = "assets/stars/TychoSkyMapHighRes.jpg";
const tychoSkyDomeRadius = 1000000000;

let tychoSkyDome = null;
let tychoSkyDomeUpdateListener = null;
let nightImageryLayer = null;
let runtimeSystemConfig = null;
let lastAppliedResolutionScale = null;
let lastAppliedUiScale = null;
let resizeAnimationFrameId = null;
let currentRuntimeDataConfig = { satellites_catalog_file: "catalog.json" };
let persistConfigTimeoutId = null;
let lastPersistedSystemConfigSerialized = "";
let runtimeConfigPanelApi = null;

function setConfigSaveState(state, message) {
    if (runtimeConfigPanelApi && typeof runtimeConfigPanelApi.setSaveState === "function") {
        runtimeConfigPanelApi.setSaveState(state, message);
    }
}

function schedulePersistSystemConfig(nextSectionedSystemConfig) {
    const serialized = JSON.stringify(nextSectionedSystemConfig || {});
    if (serialized === lastPersistedSystemConfigSerialized) {
        setConfigSaveState("saved", "Estado: guardado");
        return;
    }

    setConfigSaveState("saving", "Estado: guardando...");

    if (persistConfigTimeoutId !== null) {
        clearTimeout(persistConfigTimeoutId);
    }

    persistConfigTimeoutId = setTimeout(async () => {
        persistConfigTimeoutId = null;
        try {
            await persistSystemConfigWithRetry(nextSectionedSystemConfig, currentRuntimeDataConfig, 2);
            lastPersistedSystemConfigSerialized = serialized;
            const savedAt = new Date();
            const hh = String(savedAt.getHours()).padStart(2, "0");
            const mm = String(savedAt.getMinutes()).padStart(2, "0");
            const ss = String(savedAt.getSeconds()).padStart(2, "0");
            setConfigSaveState("saved", `Estado: guardado ${hh}:${mm}:${ss}`);
        } catch (error) {
            logger.error("No se pudo persistir system_config en servidor:", error);
            const detail = error instanceof Error ? error.message : String(error);
            const shortDetail = detail.length > 56 ? `${detail.slice(0, 56)}...` : detail;
            setConfigSaveState("error", `Estado: error al guardar (${shortDetail})`);
        }
    }, 250);
}

function updateTychoSkyDomeTransform() {
    if (!tychoSkyDome || !viewer?.camera?.positionWC) {
        return;
    }

    tychoSkyDome.modelMatrix = Cesium.Matrix4.fromTranslation(viewer.camera.positionWC, tychoSkyDome.modelMatrix);
}

function getTychoSkyDome() {
    if (!tychoSkyDome) {
        const skyMaterial = Cesium.Material.fromType("Image", {
            image: tychoSkyDomeTextureUrl,
            repeat: new Cesium.Cartesian2(1.0, 1.0),
            transparent: false
        });

        tychoSkyDome = viewer.scene.primitives.add(new Cesium.Primitive({
            geometryInstances: new Cesium.GeometryInstance({
                geometry: new Cesium.SphereGeometry({
                    radius: tychoSkyDomeRadius,
                    vertexFormat: Cesium.VertexFormat.POSITION_AND_ST
                })
            }),
            appearance: new Cesium.MaterialAppearance({
                material: skyMaterial,
                faceForward: true,
                closed: false,
                translucent: false,
                flat: true
            }),
            asynchronous: false
        }));

        updateTychoSkyDomeTransform();
        tychoSkyDomeUpdateListener = () => updateTychoSkyDomeTransform();
        viewer.scene.preRender.addEventListener(tychoSkyDomeUpdateListener);
    }

    return tychoSkyDome;
}

function releaseTychoSkyDome() {
    if (tychoSkyDomeUpdateListener) {
        viewer.scene.preRender.removeEventListener(tychoSkyDomeUpdateListener);
        tychoSkyDomeUpdateListener = null;
    }

    if (!tychoSkyDome) {
        return;
    }

    viewer.scene.primitives.remove(tychoSkyDome);
    if (typeof tychoSkyDome.destroy === "function" && !tychoSkyDome.isDestroyed?.()) {
        tychoSkyDome.destroy();
    }
    tychoSkyDome = null;
}

function applyStarsConfig(systemConfig) {
    const starsEnabled = systemConfig.stars_enabled !== false;

    if (starsEnabled) {
        viewer.scene.skyBox = undefined;
        getTychoSkyDome();
    } else {
        viewer.scene.skyBox = undefined;
        releaseTychoSkyDome();
    }

    viewer.scene.sun.show = starsEnabled;
    viewer.scene.moon.show = false;

    if (!starsEnabled) {
        viewer.scene.backgroundColor = Cesium.Color.BLACK;
    }

    logger.info(`Stars: ${starsEnabled ? "on" : "off"} | skydome: TychoSkyMapHighRes`);
}

function applyAntialiasConfig(systemConfig) {
    const mode = systemConfig.antialias_mode ?? (systemConfig.antialias_enabled !== false ? "fxaa" : "off");

    // FXAA (post-process) vs MSAA (hardware). Keep compatibility con antialias_enabled.
    if (mode === "off") {
        viewer.scene.fxaa = false;
        if (viewer.scene.postProcessStages && viewer.scene.postProcessStages.fxaa) {
            viewer.scene.postProcessStages.fxaa.enabled = false;
        }
        if (typeof viewer.scene.msaaSamples === "number") {
            viewer.scene.msaaSamples = 1;
        }
    } else if (mode === "fxaa") {
        viewer.scene.fxaa = true;
        if (viewer.scene.postProcessStages && viewer.scene.postProcessStages.fxaa) {
            viewer.scene.postProcessStages.fxaa.enabled = true;
        }
        if (typeof viewer.scene.msaaSamples === "number") {
            viewer.scene.msaaSamples = 1;
        }
    } else if (mode === "msaa") {
        viewer.scene.fxaa = false;
        if (viewer.scene.postProcessStages && viewer.scene.postProcessStages.fxaa) {
            viewer.scene.postProcessStages.fxaa.enabled = false;
        }
        if (typeof viewer.scene.msaaSamples === "number") {
            viewer.scene.msaaSamples = 4;
        }
    }

    logger.info(`Antialias mode: ${mode}`);
}

function computeAdaptiveResolutionScale() {
    const width = Math.max(1, window.innerWidth || 1920);
    const height = Math.max(1, window.innerHeight || 1080);
    const referencePixels = 1920 * 1080;
    const viewportRatio = (width * height) / referencePixels;

    // Mantener buena nitidez y ajustar de forma suave solo por resolución visible.
    if (viewportRatio <= 0.55) return 0.84;
    if (viewportRatio <= 0.7) return 0.9;
    if (viewportRatio <= 0.9) return 0.95;
    if (viewportRatio <= 1.2) return 1;
    return 1;
}

function computeAdaptiveUiScale() {
    const width = Math.max(1, window.innerWidth || 1920);
    const height = Math.max(1, window.innerHeight || 1080);
    const scaleByWidth = width / 1920;
    const scaleByHeight = height / 1080;
    const viewportScale = Math.min(scaleByWidth, scaleByHeight);

    // Escala de UI basada en resolución para que la interfaz quepa sin zoom manual.
    return clamp(viewportScale, 0.82, 1.05);
}

function applyResolutionScaleConfig(systemConfig, options = {}) {
    let resolvedScale = computeAdaptiveResolutionScale();

    const antialiasMode = systemConfig.antialias_mode ?? (systemConfig.antialias_enabled !== false ? "fxaa" : "off");
    if (antialiasMode !== "off") {
        // Con AA activo priorizamos nitidez en líneas orbitales.
        resolvedScale = Math.max(1, resolvedScale);
    }

    const shouldUpdate =
        !Number.isFinite(lastAppliedResolutionScale) ||
        Math.abs(lastAppliedResolutionScale - resolvedScale) > 0.005;

    if (!shouldUpdate) {
        return;
    }

    // Tomamos control explícito para mantener resultado consistente entre DPIs.
    viewer.useBrowserRecommendedResolution = false;
    viewer.resolutionScale = resolvedScale;
    viewer.resize();
    lastAppliedResolutionScale = resolvedScale;

    if (!options.silent) {
        logger.info(`Resolution scale: ${resolvedScale.toFixed(3)} (auto)`);
    }
}

function applyUiScaleConfig(systemConfig, options = {}) {
    const resolvedScale = computeAdaptiveUiScale();

    const shouldUpdate =
        !Number.isFinite(lastAppliedUiScale) ||
        Math.abs(lastAppliedUiScale - resolvedScale) > 0.005;

    if (!shouldUpdate) {
        return;
    }

    document.documentElement.style.setProperty("--orbit-ui-scale", resolvedScale.toFixed(3));
    lastAppliedUiScale = resolvedScale;

    if (!options.silent) {
        logger.info(`UI scale: ${resolvedScale.toFixed(3)} (auto)`);
    }
}

function applyEarthDayNightBlend(systemConfig) {
    if (!nightImageryLayer) {
        return;
    }

    const blendEnabled = systemConfig.globe_lighting !== false;
    nightImageryLayer.show = blendEnabled;
    // La capa nocturna solo aparece en la cara de noche, nunca en la de día.
    nightImageryLayer.dayAlpha = 0.0;
    nightImageryLayer.nightAlpha = blendEnabled ? 1.0 : 0.0;
    nightImageryLayer.brightness = 1.2;
}

function applySystemRuntimeConfig(systemConfigRaw) {
    const systemConfig = normalizeSystemConfig(systemConfigRaw);
    runtimeSystemConfig = systemConfig;

    configureLogger(systemConfig);
    setOrbitConfig(systemConfig);

    applyResolutionScaleConfig(systemConfig);
    applyUiScaleConfig(systemConfig);

    if (systemConfig.background_color) {
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(systemConfig.background_color);
    }

    applyStarsConfig(systemConfig);
    applyAntialiasConfig(systemConfig);
    viewer.scene.skyAtmosphere.show = systemConfig.sky_atmosphere !== false;
    viewer.scene.globe.enableLighting = systemConfig.globe_lighting !== false;
    applyEarthDayNightBlend(systemConfig);
}

window.addEventListener("resize", () => {
    if (!runtimeSystemConfig) {
        return;
    }

    if (resizeAnimationFrameId !== null) {
        cancelAnimationFrame(resizeAnimationFrameId);
    }

    resizeAnimationFrameId = requestAnimationFrame(() => {
        applyResolutionScaleConfig(runtimeSystemConfig, { silent: true });
        applyUiScaleConfig(runtimeSystemConfig, { silent: true });
        resizeAnimationFrameId = null;
    });
});

try {
    viewer.scene.imageryLayers.removeAll();
    viewer.scene.imageryLayers.addImageryProvider(localProvider);
    nightImageryLayer = viewer.scene.imageryLayers.addImageryProvider(nightProvider);
    nightImageryLayer.dayAlpha = 0.0;
    nightImageryLayer.nightAlpha = 1.0;
    nightImageryLayer.brightness = 1.2;
    logger.info("Se añadieron capas de día y noche a imageryLayers");
} catch (e) {
    logger.error("No se pudo añadir localProvider directamente:", e);
}

fetch("assets/earth8km.jpg", { cache: "no-cache" }).then((resp) => {
    logger.debug("Fetch assets/earth8km.jpg status", resp.status);
    if (!resp.ok) {
        logger.warn("Imagen local no encontrada o no accesible: se mantiene solo la textura local si está disponible.");
    } else {
        logger.debug(`Imagen local cargada correctamente (status ${resp.status})`);
    }
}).catch((err) => {
    logger.error("Error al hacer fetch de assets/earth8km.jpg:", err);
});

logger.info("Cesium Viewer creado exitosamente.");

viewer.scene.imageryLayers.layerAdded.addEventListener((layer) => {
    logger.debug("Capa añadida:", layer);

    layer.imageryProvider.errorEvent.addEventListener((err) => {
        logger.error("ERROR cargando earth8.jpg:", err);
    });

    logger.debug("Intentando cargar earth8.jpg...");
});

viewer.scene.skyAtmosphere.show = true;
viewer.scene.globe.enableLighting = true;
viewer.scene.backgroundColor = Cesium.Color.BLACK;
viewer.scene.globe.depthTestAgainstTerrain = true;
viewer.scene.screenSpaceCameraController.maximumZoomDistance = 900000000.0;
viewer.scene.screenSpaceCameraController.minimumZoomDistance = 1000.0;

const activeLayer = viewer.scene.imageryLayers.get(0);
if (activeLayer && activeLayer.imageryProvider) {
    const prov = activeLayer.imageryProvider;
    const infoUrl = prov.url || prov._url || (prov._imageryLayer && prov._imageryLayer.url) || "unknown";
    logger.debug("Proveedor activo:", prov.constructor && prov.constructor.name, infoUrl);
} else {
    logger.warn("No hay proveedor activo detectado en imageryLayers[0]");
}

const baseLayer = viewer.scene.imageryLayers.get(0);
if (baseLayer) {
    baseLayer.brightness = 1.1;
    baseLayer.contrast = 1.05;
    baseLayer.gamma = 1.0;
    logger.info("Ajustes de brillo/contraste aplicados.");
} else {
    logger.warn("No se encontró ninguna capa base para ajustar.");
}

viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(0.0, 20.0, 20000000.0),
    duration: 2
});

logger.info("Cámara posicionada.");

function focusSatellite(entity) {
    if (!entity) {
        return;
    }

    viewer.trackedEntity = entity;
    entity.viewFrom = new Cesium.Cartesian3(0, -180000, 90000);
    viewer.flyTo(entity, {
        duration: 0.8,
        offset: new Cesium.HeadingPitchRange(0, -0.35, 180000)
    });
}

function firstPersonSatellite(entity) {
    if (!entity) {
        return;
    }

    viewer.trackedEntity = entity;
    // Offsets muy pequeños para sensación de cámara embarcada.
    entity.viewFrom = new Cesium.Cartesian3(0, 0, 2.5);
    viewer.flyTo(entity, {
        duration: 0.55,
        offset: new Cesium.HeadingPitchRange(0, 0, 8)
    });
}

(async function init() {
    const config = await loadConfig();
    const currentConfig = {
        ...(config || {}),
        system: toSectionedSystemConfig(config?.system || {})
    };
    currentRuntimeDataConfig = currentConfig?.data || { satellites_catalog_file: "catalog.json" };
    lastPersistedSystemConfigSerialized = JSON.stringify(currentConfig.system || {});

    let objectSidebar = null;

    runtimeConfigPanelApi = setupRuntimeConfigPanel({
        initialSystemConfig: currentConfig.system,
        onSystemConfigChange: (nextSystemConfig) => {
            currentConfig.system = nextSystemConfig;
            applySystemRuntimeConfig(currentConfig.system);
            schedulePersistSystemConfig(currentConfig.system);
        }
    });
    setConfigSaveState("idle", "Estado: sincronizado");

    applySystemRuntimeConfig(currentConfig.system);

    const configuredCatalogFile = currentConfig?.data?.satellites_catalog_file || "catalog.json";
    const catalogUrl = configuredCatalogFile.startsWith("/")
        ? configuredCatalogFile
        : `/config/${configuredCatalogFile}`;
    // Esperar a que el catalogo se precargue antes de mostrar capas
    try {
        await preloadSatelliteCatalog(catalogUrl);
    } catch (e) {
        logger.warn("No se pudo precargar el catalogo:", e);
    }

    initSatelliteReceiver(viewer);
    objectSidebar = setupObjectSidebar({
        getCatalogIds: () => getSatelliteIds(),
        fetchCatalogPage: (params) => fetchCatalogPage(params),
        getLayerIds: () => getActiveSatelliteLayerIds(),
        getObjectTelemetry: (id) => getSatelliteTelemetry(id),
        getObjectVisibility: (id) => isSatelliteVisible(id),
        onToggleObjectVisibility: (id, visible) => setSatelliteVisible(id, visible),
        getObjectLayerActive: (id) => isSatelliteLayerActive(id),
        onToggleObjectLayer: (id, active) => setSatelliteLayerActive(id, active),
        onAddAllLayers: () => setAllSatelliteLayersActive(true),
        onRemoveAllLayers: () => setAllSatelliteLayersActive(false),
        onShowAllObjects: () => setAllSatellitesVisible(true),
        onHideAllObjects: () => setAllSatellitesVisible(false),
        onFocusObject: (id) => {
            const entity = getSatelliteEntity(id);
            if (!entity) {
                return;
            }
            setSelectedOrbitSatelliteId(id);
            focusSatellite(entity);
        },
        onSelectObject: (id) => {
            const entity = getSatelliteEntity(id);
            if (!entity) {
                return;
            }
            setSelectedOrbitSatelliteId(id);
            viewer.selectedEntity = entity;
        },
        isCatalogReady: () => isCatalogLoaded(),
        getObjectTle: (id) => getSatelliteTle(id),
        getObjectTleAsync: (id) => getSatelliteTleAsync(id),
        onRefreshCatalog: () => refreshSatelliteCatalog(catalogUrl)
    });

    viewer.screenSpaceEventHandler.setInputAction((movement) => {
        const picked = viewer.scene.pick(movement.position);
        const pickedEntity = picked?.id;
        const pickedId = pickedEntity?.satelliteId || pickedEntity?.name;

        if (pickedId && isSatelliteLayerActive(pickedId) && getSatelliteTelemetry(pickedId)) {
            objectSidebar.selectObject(pickedId);
            const entity = getSatelliteEntity(pickedId);
            if (entity) {
                setSelectedOrbitSatelliteId(pickedId);
                viewer.selectedEntity = entity;
            }
            return;
        }

        setSelectedOrbitSatelliteId(null);
        viewer.selectedEntity = undefined;
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    viewer.screenSpaceEventHandler.setInputAction((movement) => {
        const picked = viewer.scene.pick(movement.position);
        const pickedEntity = picked?.id;
        const pickedId = pickedEntity?.satelliteId || pickedEntity?.name;

        if (!pickedId || !isSatelliteLayerActive(pickedId) || !getSatelliteTelemetry(pickedId)) {
            return;
        }

        objectSidebar.selectObject(pickedId);
        const entity = getSatelliteEntity(pickedId);
        if (!entity) {
            return;
        }

        setSelectedOrbitSatelliteId(pickedId);
        viewer.selectedEntity = entity;
        firstPersonSatellite(entity);
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    logger.info("Receptor de satélites inicializado.");
})();
