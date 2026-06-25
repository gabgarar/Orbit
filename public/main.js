import {
    initSatelliteReceiver,
    preloadSatelliteCatalog,
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
    setAllSatellitesVisible
} from "./js/satellites.js";
import { setupRuntimeConfigPanel } from "./js/configPanel.js";
import { setupObjectSidebar } from "./js/objectSidebar.js";
import { configureLogger, getLogger } from "./js/logger.js";
import { normalizeSystemConfig, toSectionedSystemConfig } from "./js/configAdapter.js";

const logger = getLogger("main");
logger.info("Iniciando Cesium...");

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

logger.info("Creando SingleTileImageryProvider para assets/earth8.jpg...");

const localProvider = new Cesium.SingleTileImageryProvider({
    url: "assets/earth8km.jpg",
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

const tychoSkyMapSources = {
    positiveX: "assets/stars/tycho_highres_cubemap_png/tycho_highres_px.png",
    negativeX: "assets/stars/tycho_highres_cubemap_png/tycho_highres_nx.png",
    positiveY: "assets/stars/tycho_highres_cubemap_png/tycho_highres_py.png",
    negativeY: "assets/stars/tycho_highres_cubemap_png/tycho_highres_ny.png",
    positiveZ: "assets/stars/tycho_highres_cubemap_png/tycho_highres_pz.png",
    negativeZ: "assets/stars/tycho_highres_cubemap_png/tycho_highres_nz.png"
};

let tychoSkyMapHighRes = null;

function getTychoSkyBox() {
    if (!tychoSkyMapHighRes) {
        tychoSkyMapHighRes = new Cesium.SkyBox({
            sources: tychoSkyMapSources
        });
    }
    return tychoSkyMapHighRes;
}

function releaseTychoSkyBox() {
    if (!tychoSkyMapHighRes) {
        return;
    }

    if (typeof tychoSkyMapHighRes.destroy === "function" && !tychoSkyMapHighRes.isDestroyed?.()) {
        tychoSkyMapHighRes.destroy();
    }
    tychoSkyMapHighRes = null;
}

function applyStarsConfig(systemConfig) {
    const starsEnabled = systemConfig.stars_enabled !== false;

    if (starsEnabled) {
        viewer.scene.skyBox = getTychoSkyBox();
        viewer.scene.skyBox.show = true;
    } else {
        viewer.scene.skyBox = undefined;
        releaseTychoSkyBox();
    }

    viewer.scene.sun.show = starsEnabled;
    viewer.scene.moon.show = false;

    if (!starsEnabled) {
        viewer.scene.backgroundColor = Cesium.Color.BLACK;
    }

    logger.info(`Stars: ${starsEnabled ? "on" : "off"} | skybox: TychoSkyMapHighRes`);
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

function applySystemRuntimeConfig(systemConfigRaw) {
    const systemConfig = normalizeSystemConfig(systemConfigRaw);
    configureLogger(systemConfig);
    setOrbitConfig(systemConfig);

    if (systemConfig.background_color) {
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(systemConfig.background_color);
    }

    applyStarsConfig(systemConfig);
    applyAntialiasConfig(systemConfig);
    viewer.scene.skyAtmosphere.show = systemConfig.sky_atmosphere !== false;
    viewer.scene.globe.enableLighting = systemConfig.globe_lighting !== false;
}

try {
    viewer.scene.imageryLayers.removeAll();
    viewer.scene.imageryLayers.addImageryProvider(localProvider);
    logger.info("Se añadió localProvider a imageryLayers");
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

    let objectSidebar = null;

    setupRuntimeConfigPanel({
        initialSystemConfig: currentConfig.system,
        onSystemConfigChange: (nextSystemConfig) => {
            currentConfig.system = nextSystemConfig;
            applySystemRuntimeConfig(currentConfig.system);
        }
    });

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
            focusSatellite(entity);
        },
        onSelectObject: (id) => {
            const entity = getSatelliteEntity(id);
            if (!entity) {
                return;
            }
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
                viewer.selectedEntity = entity;
            }
            return;
        }

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

        viewer.selectedEntity = entity;
        firstPersonSatellite(entity);
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    logger.info("Receptor de satélites inicializado.");
})();
