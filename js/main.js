console.log("Iniciando Cesium...");

// ===============================
// 1) Crear el SingleTileImageryProvider
// ===============================

console.log("Creando SingleTileImageryProvider para assets/earth.jpg...");

const localProvider = new Cesium.SingleTileImageryProvider({
    url: "assets/earth2km.jpg",
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
  sceneModePicker: false,
  fullscreenButton: false,
  homeButton: false,
  terrainProvider: new Cesium.EllipsoidTerrainProvider()
});

// Forzar la adición de la capa local al viewer (garantiza que exista antes de ajustar)
try {
  viewer.scene.imageryLayers.removeAll();
  viewer.scene.imageryLayers.addImageryProvider(localProvider);
  console.log('Se añadió localProvider a imageryLayers');
} catch (e) {
  console.error('No se pudo añadir localProvider directamente:', e);
}

// Comprobar si el archivo local está disponible (diagnóstico) y aplicar fallback si hace falta
fetch('assets/earth.jpg', { cache: 'no-cache' }).then(function(resp) {
    console.log('Fetch assets/earth.jpg status', resp.status);
    if (!resp.ok) {
        console.warn('Imagen local no encontrada o no accesible, usando textura pública de fallback');
        const publicProvider = new Cesium.SingleTileImageryProvider({
            url: 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/images/earth.jpg',
            rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
        });
        viewer.scene.imageryLayers.removeAll();
        viewer.scene.imageryLayers.addImageryProvider(publicProvider);
        console.log('Se añadió publicProvider a imageryLayers');
    } else {
        console.log('Imagen local cargada correctamente (status ' + resp.status + ')');
    }
}).catch(function(err) {
    console.error('Error al hacer fetch de assets/earth.jpg:', err);
    try {
        const publicProvider = new Cesium.SingleTileImageryProvider({
            url: 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/images/earth.jpg',
            rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
        });
        viewer.scene.imageryLayers.removeAll();
        viewer.scene.imageryLayers.addImageryProvider(publicProvider);
        console.log('Fallback público añadido tras error');
    } catch (e) { console.error('Fallback público falló:', e); }
});

console.log("Cesium Viewer creado exitosamente.");

// ===============================
// 3) Detectar si la textura se carga o falla
// ===============================

viewer.scene.imageryLayers.layerAdded.addEventListener((layer) => {
    console.log("Capa añadida:", layer);

    layer.imageryProvider.errorEvent.addEventListener((err) => {
        console.error("❌ ERROR cargando earth.jpg:", err);
    });

    console.log("Intentando cargar earth.jpg...");
});

// ===============================
// 4) Ajustes visuales
// ===============================

viewer.scene.skyAtmosphere.show = false;
viewer.scene.globe.enableLighting = false;
viewer.scene.backgroundColor = Cesium.Color.BLACK;
viewer.scene.globe.depthTestAgainstTerrain = false;

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
    baseLayer.brightness = 1.00;
    baseLayer.contrast = 1.00;
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
