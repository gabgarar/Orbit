console.log("Iniciando Cesium...");

import { initSatelliteReceiver, setOrbitConfig } from "./js/satellites.js";

async function loadConfig() {
    try {
        const response = await fetch("/config/system_config.json", { cache: "no-cache" });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("No se pudo cargar system_config.json:", error);
        return null;
    }
}


// ===============================
// 1) Crear el SingleTileImageryProvider
// ===============================

console.log("Creando SingleTileImageryProvider para assets/earth8.jpg...");

const localProvider = new Cesium.SingleTileImageryProvider({
    url: "assets/earth8km.jpg",
    rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
});

// ===============================
// 2) Crear el viewer usando SOLO tu textura
// ===============================

console.log("Creando Cesium Viewer...");

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
  // ========== OPTIMIZACIONES PARA FLUIDEZ ==========
  contextOptions: {
    webgl: {
      antialias: true,           // ✅ Antialiasing para bordes suaves
      alpha: false,
      depth: true,
      stencil: false,
      preserveDrawingBuffer: false
    }
  },
  targetFrameRate: 60,           // ✅ Target 60 FPS
  requestRenderMode: false,      // Renderizar continuamente (más fluido)
  enableLighting: true,          // ✅ Lighting para sombras
  scene3DOnly: false             // Optimizar para 3D
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

    console.log(`⭐ Stars: ${starsEnabled ? "on" : "off"} | skybox: TychoSkyMapHighRes`);
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

    console.log(`🪄 Antialias: ${antialiasEnabled ? "on" : "off"}`);
}

// Forzar la adición de la capa local al viewer (garantiza que exista antes de ajustar)
try {
  viewer.scene.imageryLayers.removeAll();
  viewer.scene.imageryLayers.addImageryProvider(localProvider);
  console.log('Se añadió localProvider a imageryLayers');
} catch (e) {
  console.error('No se pudo añadir localProvider directamente:', e);
}

// Comprobar si el archivo local está disponible (diagnóstico)
fetch('assets/earth8km.jpg', { cache: 'no-cache' }).then(function(resp) {
    console.log('Fetch assets/earth8km.jpg status', resp.status);
    if (!resp.ok) {
        console.warn('Imagen local no encontrada o no accesible: se mantiene solo la textura local si está disponible.');
    } else {
        console.log('Imagen local cargada correctamente (status ' + resp.status + ')');
    }
}).catch(function(err) {
    console.error('Error al hacer fetch de assets/earth8km.jpg:', err);
});

console.log("Cesium Viewer creado exitosamente.");

// ===============================
// 3) Detectar si la textura se carga o falla
// ===============================

viewer.scene.imageryLayers.layerAdded.addEventListener((layer) => {
    console.log("Capa añadida:", layer);

    layer.imageryProvider.errorEvent.addEventListener((err) => {
        console.error("❌ ERROR cargando earth8.jpg:", err);
    });

    console.log("Intentando cargar earth8.jpg...");
});

// ===============================
// 4) Ajustes visuales
// ===============================

viewer.scene.skyAtmosphere.show = true;
viewer.scene.globe.enableLighting = true;
viewer.scene.backgroundColor = Cesium.Color.BLACK;
viewer.scene.globe.depthTestAgainstTerrain = true;

// Mostrar qué proveedor está activo y su URL (diagnóstico)
const activeLayer = viewer.scene.imageryLayers.get(0);
if (activeLayer && activeLayer.imageryProvider) {
    const prov = activeLayer.imageryProvider;
    const infoUrl = prov.url || prov._url || (prov._imageryLayer && prov._imageryLayer.url) || 'unknown';
    console.log('Proveedor activo:', prov.constructor && prov.constructor.name, infoUrl);
} else {
    console.warn('No hay proveedor activo detectado en imageryLayers[0]');
}

// Activar atmósfera e iluminación para mejorar apariencia (si quieres look realista)
viewer.scene.skyAtmosphere.show = true;
viewer.scene.globe.enableLighting = true;

const baseLayer = viewer.scene.imageryLayers.get(0);
if (baseLayer) {
    baseLayer.brightness = 1.1;
    baseLayer.contrast = 1.05;
    baseLayer.gamma = 1.00;

    console.log("Ajustes de brillo/contraste aplicados.");
} else {
    console.warn("⚠ No se encontró ninguna capa base para ajustar.");
}

// ===============================
// 5) Cámara inicial
// ===============================

viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(0.0, 20.0, 20000000.0),
    duration: 2
});

console.log("🚀 Cámara posicionada.");

(async function init() {
    const config = await loadConfig();
    if (config && config.system) {
        setOrbitConfig(config.system);
        if (config.system.background_color) {
            viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(config.system.background_color);
        }
        applyStarsConfig(config.system);
        applyAntialiasConfig(config.system);
        viewer.scene.skyAtmosphere.show = config.system.sky_atmosphere !== false;
        viewer.scene.globe.enableLighting = config.system.globe_lighting !== false;
    }

    initSatelliteReceiver(viewer);
    console.log("🛰️ Receptor de satélites inicializado.");
})();