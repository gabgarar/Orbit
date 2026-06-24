import { initSatelliteReceiver, setOrbitConfig } from "./js/satellites.js";
import { setupRuntimeConfigPanel } from "./js/configPanel.js";
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
    const antialiasEnabled = systemConfig.antialias_enabled !== false;

    viewer.scene.fxaa = antialiasEnabled;
    if (viewer.scene.postProcessStages && viewer.scene.postProcessStages.fxaa) {
        viewer.scene.postProcessStages.fxaa.enabled = antialiasEnabled;
    }

    if (typeof viewer.scene.msaaSamples === "number") {
        viewer.scene.msaaSamples = antialiasEnabled ? 4 : 1;
    }

    logger.info(`Antialias: ${antialiasEnabled ? "on" : "off"}`);
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

(async function init() {
    const config = await loadConfig();
    const currentConfig = {
        ...(config || {}),
        system: toSectionedSystemConfig(config?.system || {})
    };

    setupRuntimeConfigPanel({
        initialSystemConfig: currentConfig.system,
        onSystemConfigChange: (nextSystemConfig) => {
            currentConfig.system = nextSystemConfig;
            applySystemRuntimeConfig(currentConfig.system);
        }
    });

    applySystemRuntimeConfig(currentConfig.system);

    initSatelliteReceiver(viewer);
    logger.info("Receptor de satélites inicializado.");
})();
