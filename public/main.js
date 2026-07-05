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
    getCatalogEntryMeta,
    getActiveSatelliteLayerIds,
    getSatelliteEntity,
    getSatelliteTelemetry,
    isSatelliteVisible,
    setSatelliteVisible,
    isSatelliteLayerActive,
    setSatelliteLayerActive,
    setAllSatelliteLayersActive,
    setAllSatellitesVisible,
    getMaxActiveSatellites,
    getAvailableActiveSatelliteLayerSlots,
    setSelectedOrbitSatelliteId,
    refreshSatelliteOverlays,
    getSatelliteVisualizationConfig,
    setSatelliteVisualizationConfig,
    clearSatelliteVisualizationConfig,
    clearAllSatelliteVisualizationConfigs,
    setSimulationTimelineProvider,
    importOemEphemerisTrack,
    hasLoadedOemEphemerisTracks,
    getLoadedOemEphemerisTimeBounds
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

logger.info("Creando SingleTileImageryProvider para assets/earth3km.jpg...");

const initialBootConfig = await loadConfig();
const offlineModeEnabledAtBoot = initialBootConfig?.data?.offline_mode === true;

async function resolveTerrainProviderForBoot() {
    if (offlineModeEnabledAtBoot) {
        logger.warn("Modo offline activo: usando terreno elipsoidal local.");
        return new Cesium.EllipsoidTerrainProvider();
    }

    try {
        return await Cesium.createWorldTerrainAsync();
    } catch (error) {
        logger.warn("No se pudo cargar Cesium World Terrain. Se usa terreno elipsoidal local.", error);
        return new Cesium.EllipsoidTerrainProvider();
    }
}

const startupTerrainProvider = await resolveTerrainProviderForBoot();

const localProvider = new Cesium.SingleTileImageryProvider({
    url: "assets/earth3km.jpg",
    rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
});

const nightProvider = new Cesium.SingleTileImageryProvider({
    url: "assets/earthnight3km.jpg",
    rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
});

const earth2kmTilesProvider = new Cesium.UrlTemplateImageryProvider({
    url: "assets/earth2km_tiles/{z}/{x}/{y}.jpg",
    minimumLevel: 0,
    maximumLevel: 6,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    rectangle: Cesium.Rectangle.fromDegrees(-180, -85.05112878, 180, 85.05112878),
    credit: "earth2km local tiles"
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
    terrainProvider: startupTerrainProvider,
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

viewer.scene.morphComplete.addEventListener(() => {
    refreshSatelliteOverlays(viewer);
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
let currentRuntimeDataConfig = { satellites_catalog_file: "catalog.json", offline_mode: false };
let persistConfigTimeoutId = null;
let lastPersistedSystemConfigSerialized = "";
let runtimeConfigPanelApi = null;
let cameraModeToggleBtn = null;
let cameraNavigationMode = "centered";
const freeCameraPressedKeys = new Set();
let freeCameraTickListener = null;
let freeCameraKeyboardAttached = false;
let sessionRecordButton = null;
let sessionRecorder = null;
let sessionRecordingStream = null;
let sessionRecordingChunks = [];
let sessionRecordingMimeType = "video/webm";
let isSessionRecording = false;
let runtimeRecordingConfig = {
    quality: "medium",
    output_format: "webm"
};
let appDialogRoot = null;
let appDialogTitle = null;
let appDialogMessage = null;
let appDialogConfirmBtn = null;
let appDialogCancelBtn = null;
let satelliteContextMenu = null;
let satelliteContextMenuTargetId = null;
let satelliteVizModal = null;
let satelliteVizCurrentTargetId = null;
let timeHudWidget = null;
let timeHudTimer = null;
let earth2kmTilesAvailable = false;
let quickToolbarRoot = null;
let quickToolbarPanel = null;
let selectedSatelliteId = null;
let currentUiLanguage = "es";
let currentUiTheme = "dark";
let presentationModeActive = false;
let updatePersistedSystemConfig = null;
let topSearchSuggestionsRoot = null;
let topSearchSuggestions = [];
let topSearchSelectedIndex = -1;
let topSearchDebounceId = null;
let topSearchRequestToken = 0;
let topSearchLastQuery = "";
const topSearchCache = new Map();
const tleEpochCacheBySatelliteId = new Map();
let simulationControlRoot = null;
let simulationTickTimer = null;
let simulationUiBusy = false;
let simulationDockOpen = false;
let simulationLayoutObserver = null;
let topSearchInitialized = false;
const groundStationLayers = new Map();
const satelliteDuplicateLayers = new Map();
const layerDisplayNameOverrides = new Map();
const groundStationPassCache = new Map();
const groundStationHeatMapEntities = new Map();
let groundStationSequence = 1;
let satelliteDuplicateSequence = 1;
let stationHeatMapTimer = null;
let runtimeDecayAlertPerigeeKm = 200;

const SIMULATION_MODE_REALTIME = "realtime";
const SIMULATION_MODE_RANGE = "range";
const SIMULATION_SPEED_VALUES = [1, 10, 100, 1000];
const SIMULATION_TIMELINE_STEPS = 10000;
const SIMULATION_LONG_RANGE_WARNING_HOURS = 24 * 7;

const simulationState = {
    mode: SIMULATION_MODE_REALTIME,
    isPlaying: true,
    speed: 1,
    rewind: false,
    startDate: new Date(Date.now() - 60 * 60 * 1000),
    endDate: new Date(Date.now() + 60 * 60 * 1000),
    currentDate: new Date(),
    lastTickTimestamp: Date.now()
};

const UI_TEXT = {
    es: {
        toolbarToggle: "Herramientas rapidas",
        future: "Futuro",
        past: "Pasado",
        ground: "Ground",
        presentation: "Presentacion",
        theme: "Tema",
        recordStart: "Grabar",
        recordStop: "Detener",
        selectedScope: "Seleccionado",
        globalScope: "Global",
        timeLabel: "Fecha y hora",
        recordSessionStart: "Iniciar grabacion de la sesion",
        recordSessionStop: "Detener grabacion de la sesion",
        recordSessionProcessing: "Procesando grabacion de sesion",
        recordSessionProcessingTitle: "Procesando grabacion",
        cameraModeToggle: "Cambiar modo de navegacion de camara",
        recordingInProgress: "Grabacion en curso. Pulsar para detener",
        recordingStopTitle: "Detener grabacion de la sesion",
        recordingUnsupported: "Tu navegador no soporta grabacion de pantalla con MediaRecorder.",
        recordingUnavailableTitle: "Grabacion no disponible",
        recordingNoStream: "No se pudo iniciar la grabacion: captureStream no esta disponible.",
        recordingErrorTitle: "Error de grabacion",
        recordingEmpty: "La grabacion termino sin datos para guardar.",
        recordingEmptyTitle: "Grabacion vacia",
        sessionSaveQuestion: "¿Quieres guardar la sesion?",
        sessionSaveTitle: "Guardar sesion",
        recordingError: "Ocurrio un error durante la grabacion de la sesion.",
        recordingStartError: "No se pudo iniciar la grabacion de la sesion.",
        navFree: "Navegacion: Libre (WASD)",
        navCentered: "Navegacion: Centrada",
        navFreeDesc: "Modo libre: WASD mueve, Q/E sube-baja, flechas orientan, arrastre izq mira",
        navCenteredDesc: "Modo centrado: navegacion clasica alrededor del globo",
        navFreeAria: "Modo libre activo. Pulsar para volver a modo centrado",
        navCenteredAria: "Modo centrado activo. Pulsar para activar modo libre",
        alertTitle: "Aviso",
        confirmTitle: "Confirmacion",
        vizOptions: "Opciones de visualizacion",
        configPanelTitle: "Configuracion en tiempo real",
        configHint: "Los cambios se aplican al instante en la vista y se guardan en disco.",
        configApplyGlobal: "Aplicar configuracion global a todos los satelites",
        configResetParams: "Restaurar parametros por defecto",
        configClose: "Cerrar",
        configSaved: "Estado: sincronizado",
        configSaving: "Estado: guardando...",
        configSavedState: "Estado: guardado",
        configError: "Estado: error al guardar",
        applyingGlobal: "Estado: aplicando global a todos...",
        globalApplied: "Estado: global aplicado a todos",
        globalError: "Estado: error al aplicar global",
        resettingParams: "Estado: reiniciando parametros...",
        paramsReset: "Estado: parametros reiniciados",
        resetError: "Estado: error al reiniciar",
        helpParam: "Ayuda del parametro",
        noDesc: "Sin descripcion disponible.",
        satResetBtn: "Resetear satelite",
        applyBtn: "Aplicar",
        explainParams: "Explicar parametros orbitales",
        satInfoTitle: "Informacion satelite",
        confirmBtn: "Aceptar",
        cancelBtn: "Cancelar",
        updateCatalog: "Actualizar Catalogo",
        updateCatalogMsg: "Se descargaran TLEs de CelesTrak y se sobrescribira el catalogo local. Quieres continuar?",
        updateBtn: "Actualizar",
        updatingCatalog: "Actualizando catalogo...",
        downloadingTles: "Descargando TLEs desde CelesTrak...",
        removeAllLayers: "Quitar Todas Las Capas",
        removeAllLayersMsg: "Se quitaran {total} capas activas. Esta accion no se puede deshacer.",
        removeAllBtn: "Quitar todo",
        confirmInclusion: "Confirmar Inclusion",
        includeElementsMsg: "Se incluiran {count} elementos. {skipped} se omitiran para respetar el limite de {maxLayers} capas activas.",
        includeElementsMsgNoSkip: "Se incluiran {count} elementos que aun no estan en capas activas.",
        includeBtn: "Incluir",
        addingLayers: "Anadiendo capas...",
        layersAdded: "Se anadieron {count} capas. {skipped} quedaron fuera por el limite de {maxLayers} activas.",
        latLabel: "Latitud",
        lonLabel: "Longitud",
        altLabel: "Altitud",
        velXLabel: "Velocidad X",
        velYLabel: "Velocidad Y",
        velZLabel: "Velocidad Z",
        speedLabel: "Modulo velocidad",
        speedKmhLabel: "Velocidad",
        distToCameraLabel: "Distancia a camara",
        trailPointsLabel: "Puntos de estela",
        telemetryAgeLabel: "Edad telemetria",
        propagationLabel: "Propagacion",
        orbitTypeLabel: "Tipo orbita",
        futurePropLabel: "Propagacion futura",
        pastPropLabel: "Propagacion pasada",
        pastConfiguredLabel: "Pasado configurado",
        orbitTypeLabel2: "Tipo de orbita",
        estAltLabel: "Altitud estimada",
        tleAgeLabel: "Edad TLE",
        recWindowLabel: "Ventana recomendada",
        unknownLabel: "Desconocida",
        noRefLabel: "Sin referencia",
        tleFreshMsg: "Edad del TLE: {age}. Recomendado para {orbit}: {rec}.",
        catalogLoadingLabel: "Cargando catalogo",
        closeCatalogLabel: "Cerrar catalogo",
        closeFiltersLabel: "Cerrar filtros",
        removeLayerLabel: "Quitar capa",
        noResultsLabel: "Sin resultados",
        globalSearchPlaceholder: "Buscar satélite por nombre o NORAD...",
        globalSearchNoResults: "Sin coincidencias",
        globalSearchAddHint: "Pulsa Enter para seleccionar",
        simRealtime: "Tiempo real",
        simRange: "Rango",
        simHistorical: "Histórico",
        simPlay: "Play",
        simPause: "Pausa",
        simRewind: "Rewind",
        simUseTleEpoch: "Usar epoch TLE",
        simStart: "Inicio",
        simEnd: "Fin",
        simCurrent: "Actual",
        simApplyRange: "Aplicar",
        epochDelta: "Delta epoch",
        simPanelToggle: "Panel temporal",
        simDomainLabel: "Dominio temporal",
        simLargeRangeWarning: "El rango seleccionado es de {days} dias ({hours} h). Puede sobrecargar la aplicacion. Quieres aplicarlo?"
    },
    en: {
        toolbarToggle: "Quick tools",
        future: "Future",
        past: "Past",
        ground: "Ground",
        presentation: "Presentation",
        theme: "Theme",
        recordStart: "Record",
        recordStop: "Stop",
        selectedScope: "Selected",
        globalScope: "Global",
        timeLabel: "Date and time",
        recordSessionStart: "Start session recording",
        recordSessionStop: "Stop session recording",
        recordSessionProcessing: "Processing session recording",
        recordSessionProcessingTitle: "Processing recording",
        cameraModeToggle: "Toggle camera navigation mode",
        recordingInProgress: "Recording in progress. Click to stop.",
        recordingStopTitle: "Stop session recording",
        recordingUnsupported: "Your browser does not support screen recording with MediaRecorder.",
        recordingUnavailableTitle: "Recording unavailable",
        recordingNoStream: "Could not start recording: captureStream not available.",
        recordingErrorTitle: "Recording error",
        recordingEmpty: "Recording ended without data to save.",
        recordingEmptyTitle: "Empty recording",
        sessionSaveQuestion: "Do you want to save the session?",
        sessionSaveTitle: "Save session",
        recordingError: "An error occurred during session recording.",
        recordingStartError: "Could not start session recording.",
        navFree: "Navigation: Free (WASD)",
        navCentered: "Navigation: Centered",
        navFreeDesc: "Free mode: WASD moves, Q/E up/down, arrows look, left drag look",
        navCenteredDesc: "Centered mode: classic navigation around the globe",
        navFreeAria: "Free mode active. Click to return to centered mode",
        navCenteredAria: "Centered mode active. Click to activate free mode",
        alertTitle: "Notice",
        confirmTitle: "Confirmation",
        vizOptions: "Visualization options",
        configPanelTitle: "Real-time Configuration",
        configHint: "Changes apply instantly to the view and are saved to disk.",
        configApplyGlobal: "Apply configuration globally to all satellites",
        configResetParams: "Restore default parameters",
        configClose: "Close",
        configSaved: "State: synchronized",
        configSaving: "State: saving...",
        configSavedState: "State: saved",
        configError: "State: save error",
        applyingGlobal: "State: applying global to all...",
        globalApplied: "State: global applied to all",
        globalError: "State: error applying global",
        resettingParams: "State: resetting parameters...",
        paramsReset: "State: parameters reset",
        resetError: "State: error resetting",
        helpParam: "Parameter help",
        noDesc: "No description available.",
        satResetBtn: "Reset satellite",
        applyBtn: "Apply",
        explainParams: "Explain orbital parameters",
        satInfoTitle: "Satellite information",
        confirmBtn: "Accept",
        cancelBtn: "Cancel",
        updateCatalog: "Update Catalog",
        updateCatalogMsg: "TLEs will be downloaded from CelesTrak and the local catalog will be overwritten. Do you want to continue?",
        updateBtn: "Update",
        updatingCatalog: "Updating catalog...",
        downloadingTles: "Downloading TLEs from CelesTrak...",
        removeAllLayers: "Remove All Layers",
        removeAllLayersMsg: "Will remove {total} active layers. This action cannot be undone.",
        removeAllBtn: "Remove All",
        confirmInclusion: "Confirm Inclusion",
        includeElementsMsg: "Will include {count} elements. {skipped} will be skipped to respect the limit of {maxLayers} active layers.",
        includeElementsMsgNoSkip: "Will include {count} elements that are not yet in active layers.",
        includeBtn: "Include",
        addingLayers: "Adding layers...",
        layersAdded: "Added {count} layers. {skipped} were left out due to the limit of {maxLayers} active layers.",
        latLabel: "Latitude",
        lonLabel: "Longitude",
        altLabel: "Altitude",
        velXLabel: "Velocity X",
        velYLabel: "Velocity Y",
        velZLabel: "Velocity Z",
        speedLabel: "Speed magnitude",
        speedKmhLabel: "Speed",
        distToCameraLabel: "Distance to camera",
        trailPointsLabel: "Trail points",
        telemetryAgeLabel: "Telemetry age",
        propagationLabel: "Propagation",
        orbitTypeLabel: "Orbit type",
        futurePropLabel: "Future propagation",
        pastPropLabel: "Past propagation",
        pastConfiguredLabel: "Past configured",
        orbitTypeLabel2: "Orbit type",
        estAltLabel: "Estimated altitude",
        tleAgeLabel: "TLE age",
        recWindowLabel: "Recommended window",
        unknownLabel: "Unknown",
        noRefLabel: "No reference",
        tleFreshMsg: "TLE age: {age}. Recommended for {orbit}: {rec}.",
        catalogLoadingLabel: "Loading catalog",
        closeCatalogLabel: "Close catalog",
        closeFiltersLabel: "Close filters",
        removeLayerLabel: "Remove layer",
        noResultsLabel: "No results",
        globalSearchPlaceholder: "Search satellite by name or NORAD...",
        globalSearchNoResults: "No matches",
        globalSearchAddHint: "Press Enter to select",
        simRealtime: "Realtime",
        simRange: "Range",
        simHistorical: "Historical",
        simPlay: "Play",
        simPause: "Pause",
        simRewind: "Rewind",
        simUseTleEpoch: "Use TLE epoch",
        simStart: "Start",
        simEnd: "End",
        simCurrent: "Current",
        simApplyRange: "Apply",
        epochDelta: "Epoch delta",
        simPanelToggle: "Time panel",
        simDomainLabel: "Time domain",
        simLargeRangeWarning: "The selected range is {days} days ({hours} h). It may overload the application. Do you want to apply it?"
    }
};

function isEditableTarget(target) {
    if (!target || !(target instanceof HTMLElement)) {
        return false;
    }
    const tag = target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function normalizeFreeCameraKey(key) {
    if (!key) {
        return "";
    }
    return String(key).toLowerCase();
}

function handleFreeCameraKeyDown(event) {
    if (cameraNavigationMode !== "free") {
        return;
    }
    if (isEditableTarget(event.target)) {
        return;
    }

    const key = normalizeFreeCameraKey(event.key);
    if (!key) {
        return;
    }

    const actionableKeys = ["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"];
    if (!actionableKeys.includes(key)) {
        return;
    }

    freeCameraPressedKeys.add(key);
    event.preventDefault();
}

function handleFreeCameraKeyUp(event) {
    const key = normalizeFreeCameraKey(event.key);
    if (!key) {
        return;
    }
    freeCameraPressedKeys.delete(key);
}

function applyFreeCameraKeyboardMotion() {
    if (cameraNavigationMode !== "free") {
        return;
    }

    const camera = viewer.camera;
    const height = Math.max(1, camera.positionCartographic?.height || 5000);
    const moveStep = clamp(height * 0.025, 40, 2500000);
    const lookStep = 0.012;

    if (freeCameraPressedKeys.has("w")) camera.moveForward(moveStep);
    if (freeCameraPressedKeys.has("s")) camera.moveBackward(moveStep);
    if (freeCameraPressedKeys.has("a")) camera.moveLeft(moveStep);
    if (freeCameraPressedKeys.has("d")) camera.moveRight(moveStep);
    if (freeCameraPressedKeys.has("q")) camera.moveDown(moveStep);
    if (freeCameraPressedKeys.has("e")) camera.moveUp(moveStep);

    if (freeCameraPressedKeys.has("arrowup")) camera.lookUp(lookStep);
    if (freeCameraPressedKeys.has("arrowdown")) camera.lookDown(lookStep);
    if (freeCameraPressedKeys.has("arrowleft")) camera.lookLeft(lookStep);
    if (freeCameraPressedKeys.has("arrowright")) camera.lookRight(lookStep);
}

function enableFreeCameraKeyboardControls() {
    if (!freeCameraKeyboardAttached) {
        window.addEventListener("keydown", handleFreeCameraKeyDown, { passive: false });
        window.addEventListener("keyup", handleFreeCameraKeyUp);
        freeCameraKeyboardAttached = true;
    }

    if (!freeCameraTickListener) {
        freeCameraTickListener = () => applyFreeCameraKeyboardMotion();
        viewer.clock.onTick.addEventListener(freeCameraTickListener);
    }
}

function disableFreeCameraKeyboardControls() {
    freeCameraPressedKeys.clear();

    if (freeCameraTickListener) {
        viewer.clock.onTick.removeEventListener(freeCameraTickListener);
        freeCameraTickListener = null;
    }

    if (freeCameraKeyboardAttached) {
        window.removeEventListener("keydown", handleFreeCameraKeyDown);
        window.removeEventListener("keyup", handleFreeCameraKeyUp);
        freeCameraKeyboardAttached = false;
    }
}

function ensureCameraModeToggleButton() {
    if (cameraModeToggleBtn) {
        return cameraModeToggleBtn;
    }

    const button = document.createElement("button");
    button.id = "cameraModeToggleBtn";
    button.type = "button";
    button.className = "camera-mode-toggle centered";
    button.setAttribute("aria-live", "polite");
    button.addEventListener("click", () => {
        const nextMode = cameraNavigationMode === "centered" ? "free" : "centered";
        applyCameraNavigationMode(nextMode);
    });

    document.body.appendChild(button);
    cameraModeToggleBtn = button;
    updateCameraModeToggleTitle();
    return button;
}

function updateCameraModeToggleTitle() {
    if (cameraModeToggleBtn) {
        cameraModeToggleBtn.title = uiText("cameraModeToggle");
    }
}

function ensureSessionRecordButton() {
    if (sessionRecordButton) {
        return sessionRecordButton;
    }

    const button = document.createElement("button");
    button.id = "sessionRecordBtn";
    button.type = "button";
    button.className = "session-record-btn idle";
    button.setAttribute("aria-live", "polite");
    button.addEventListener("click", () => {
        toggleSessionRecording();
    });

    const toolbarSlot = document.querySelector("#quickRecordSlot");
    if (toolbarSlot) {
        toolbarSlot.appendChild(button);
    } else {
        document.body.appendChild(button);
    }
    sessionRecordButton = button;
    updateSessionRecordButtonLabel();
    return button;
}

function formatTimeHudDate(dateValue) {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return "--/--/---- --:--:--";
    }
    const dd = String(date.getDate()).padStart(2, "0");
    const mmDate = String(date.getMonth() + 1).padStart(2, "0");
    const yyyy = String(date.getFullYear());
    const hh = String(date.getHours()).padStart(2, "0");
    const mmTime = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${dd}/${mmDate}/${yyyy} ${hh}:${mmTime}:${ss}`;
}

function formatDateTimeLocalInput(dateValue) {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return "";
    }
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;
}

function parseDateTimeLocalInput(rawValue) {
    const parsed = new Date(String(rawValue || "").trim());
    if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed;
}

function parseTleEpochDate(line1) {
    const raw = String(line1 || "");
    if (raw.length < 32) {
        return null;
    }

    const yy = Number.parseInt(raw.slice(18, 20), 10);
    const dayOfYear = Number.parseFloat(raw.slice(20, 32));
    if (!Number.isFinite(yy) || !Number.isFinite(dayOfYear) || dayOfYear <= 0) {
        return null;
    }

    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    const yearStartUtcMs = Date.UTC(year, 0, 1, 0, 0, 0, 0);
    const epochMs = yearStartUtcMs + (dayOfYear - 1) * 24 * 60 * 60 * 1000;
    const epochDate = new Date(epochMs);
    return Number.isNaN(epochDate.getTime()) ? null : epochDate;
}

function formatDurationCompact(msDiff) {
    if (!Number.isFinite(msDiff)) {
        return "--";
    }
    const sign = msDiff >= 0 ? "+" : "-";
    const totalSeconds = Math.floor(Math.abs(msDiff) / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) {
        return `${sign}${days}d ${hours}h`;
    }
    if (hours > 0) {
        return `${sign}${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
        return `${sign}${minutes}m ${seconds}s`;
    }
    return `${sign}${seconds}s`;
}

function formatSimulationRangeWarning(startDate, endDate) {
    const diffMs = Math.max(0, endDate.getTime() - startDate.getTime());
    const rangeHours = diffMs / (1000 * 60 * 60);
    const rangeDays = rangeHours / 24;
    return uiText("simLargeRangeWarning")
        .replace("{days}", rangeDays.toFixed(1))
        .replace("{hours}", rangeHours.toFixed(1));
}

async function confirmLargeSimulationRangeIfNeeded(startDate, endDate) {
    const diffMs = Math.max(0, endDate.getTime() - startDate.getTime());
    const rangeHours = diffMs / (1000 * 60 * 60);
    if (!Number.isFinite(rangeHours) || rangeHours <= SIMULATION_LONG_RANGE_WARNING_HOURS) {
        return true;
    }
    const message = formatSimulationRangeWarning(startDate, endDate);
    return showAppConfirm(message, uiText("confirmTitle"));
}

function getSimulationModeLabel() {
    if (simulationState.mode === SIMULATION_MODE_RANGE) {
        return uiText("simRange");
    }
    return uiText("simRealtime");
}

function openLeftSatellitesPanel() {
    const satellitesPanel = document.getElementById("leftSatellitesPanel");
    const satellitesBtn = document.getElementById("leftSatellitesBtn");
    const infoPanel = document.getElementById("leftInfoPanel");
    const infoBtn = document.getElementById("leftInfoBtn");

    if (satellitesPanel) {
        satellitesPanel.classList.add("open");
    }
    if (satellitesBtn) {
        satellitesBtn.classList.add("active");
    }
    if (infoPanel) {
        infoPanel.classList.remove("open");
    }
    if (infoBtn) {
        infoBtn.classList.remove("active");
    }
}

function getDisplayedSimulationDate() {
    if (simulationState.mode === SIMULATION_MODE_REALTIME) {
        return new Date();
    }
    const date = simulationState.currentDate instanceof Date ? simulationState.currentDate : new Date(simulationState.currentDate);
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

function getTimelineRatioByDate(dateValue) {
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    const startMs = simulationState.startDate.getTime();
    const endMs = simulationState.endDate.getTime();
    const span = Math.max(1000, endMs - startMs);
    return clamp((date.getTime() - startMs) / span, 0, 1);
}

function getDateFromTimelineRatio(ratio) {
    const clamped = clamp(Number(ratio) || 0, 0, 1);
    const startMs = simulationState.startDate.getTime();
    const endMs = simulationState.endDate.getTime();
    const span = Math.max(1000, endMs - startMs);
    return new Date(startMs + span * clamped);
}

function applySimulationDateToViewer(date) {
    if (!viewer?.clock || !(date instanceof Date) || Number.isNaN(date.getTime())) {
        return;
    }
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(date);
}

async function resolveSatelliteEpochDate(satelliteId) {
    if (isGroundStationLayerId(satelliteId)) {
        return null;
    }
    const satId = getSatelliteSourceIdFromLayerId(String(satelliteId || "").trim());
    if (!satId) {
        return null;
    }
    if (tleEpochCacheBySatelliteId.has(satId)) {
        return tleEpochCacheBySatelliteId.get(satId);
    }

    const tle = getSatelliteTle(satId) || await getSatelliteTleAsync(satId);
    const epochDate = parseTleEpochDate(tle?.line1);
    tleEpochCacheBySatelliteId.set(satId, epochDate);
    return epochDate;
}

async function updateSelectedEpochInfo() {
    const infoEl = document.getElementById("topEpochInfo");
    if (!infoEl) {
        return;
    }

    if (!selectedSatelliteId) {
        infoEl.textContent = `${uiText("epochDelta")}: ${uiText("noRefLabel")}`;
        return;
    }

    const epochDate = await resolveSatelliteEpochDate(selectedSatelliteId);
    if (!epochDate) {
        infoEl.textContent = `${uiText("epochDelta")}: ${uiText("unknownLabel")}`;
        return;
    }

    const current = getDisplayedSimulationDate();
    infoEl.textContent = `${uiText("epochDelta")}: ${formatDurationCompact(current.getTime() - epochDate.getTime())}`;
}

function getNoradIdFromCatalogItem(item) {
    const direct = String(item?.noradId || "").trim();
    if (direct) {
        return direct;
    }
    const fallback = String(item?.line1 || "").slice(2, 7).trim();
    return /^\d+$/.test(fallback) ? fallback : "";
}

function closeTopSearchSuggestions() {
    if (!topSearchSuggestionsRoot) {
        return;
    }
    topSearchSuggestionsRoot.classList.remove("open");
    topSearchSelectedIndex = -1;
}

function renderTopSearchSuggestions() {
    if (!topSearchSuggestionsRoot) {
        return;
    }

    const items = topSearchSuggestions.slice(0, 12);
    topSearchSuggestionsRoot.innerHTML = "";

    if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "toolbar-search-empty";
        empty.textContent = uiText("globalSearchNoResults");
        topSearchSuggestionsRoot.appendChild(empty);
        topSearchSuggestionsRoot.classList.add("open");
        return;
    }

    items.forEach((item, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = `toolbar-search-option${index === topSearchSelectedIndex ? " active" : ""}`;
        const noradId = getNoradIdFromCatalogItem(item);
        option.innerHTML = `
            <span class="toolbar-search-option-name">${item.name}</span>
            <span class="toolbar-search-option-meta">${noradId ? `NORAD ${noradId}` : uiText("globalSearchAddHint")}</span>
        `;
        option.addEventListener("mousedown", (event) => {
            event.preventDefault();
        });
        option.addEventListener("click", () => {
            selectSatelliteFromGlobalSearch(item);
        });
        topSearchSuggestionsRoot.appendChild(option);
    });

    topSearchSuggestionsRoot.classList.add("open");
}

async function fetchTopSearchSuggestions(query) {
    const normalized = String(query || "").trim().toLowerCase();
    if (!normalized) {
        return [];
    }

    const cacheKey = normalized;
    if (topSearchCache.has(cacheKey)) {
        return topSearchCache.get(cacheKey);
    }

    const params = new URLSearchParams({ offset: "0", limit: "15", search: normalized });
    const response = await fetch(`/api/catalog/page?${params.toString()}`, { cache: "no-cache" });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const normalizedItems = items
        .map((item) => ({
            name: String(item?.name || "").trim(),
            line1: String(item?.line1 || "").trim(),
            line2: String(item?.line2 || "").trim(),
            noradId: String(item?.noradId || "").trim()
        }))
        .filter((item) => item.name);

    topSearchCache.set(cacheKey, normalizedItems);
    return normalizedItems;
}

function isGroundStationLayerId(layerId) {
    return String(layerId || "").startsWith("gst:");
}

function isSatelliteDuplicateLayerId(layerId) {
    return String(layerId || "").startsWith("satdup:");
}

function getSatelliteSourceIdFromLayerId(layerId) {
    if (isSatelliteDuplicateLayerId(layerId)) {
        return String(satelliteDuplicateLayers.get(layerId)?.sourceId || "").trim();
    }
    return String(layerId || "").trim();
}

function getLayerDisplayName(layerId) {
    const key = String(layerId || "").trim();
    if (!key) {
        return "";
    }

    if (layerDisplayNameOverrides.has(key)) {
        return String(layerDisplayNameOverrides.get(key) || key);
    }

    if (isGroundStationLayerId(key)) {
        return String(groundStationLayers.get(key)?.name || key);
    }

    return key;
}

function getLayerType(layerId) {
    if (isGroundStationLayerId(layerId)) {
        return "GROUND_STATION";
    }
    return "SATELLITE";
}

function computeStationElevationDeg(stationCartesian, satCartesian) {
    const los = Cesium.Cartesian3.subtract(satCartesian, stationCartesian, new Cesium.Cartesian3());
    const losNorm = Cesium.Cartesian3.normalize(los, new Cesium.Cartesian3());
    const zenith = Cesium.Cartesian3.normalize(stationCartesian, new Cesium.Cartesian3());
    const dot = Cesium.Math.clamp(Cesium.Cartesian3.dot(losNorm, zenith), -1, 1);
    return Cesium.Math.toDegrees(Math.asin(dot));
}

function computeFreeSpacePathLossDb(freqMhz, rangeKm) {
    if (!Number.isFinite(freqMhz) || freqMhz <= 0 || !Number.isFinite(rangeKm) || rangeKm <= 0) {
        return null;
    }
    return 32.45 + (20 * Math.log10(freqMhz)) + (20 * Math.log10(rangeKm));
}

function getCompositeLayerIds() {
    const satelliteIds = getActiveSatelliteLayerIds();
    const duplicateIds = [...satelliteDuplicateLayers.keys()];
    const stationIds = [...groundStationLayers.keys()];
    return [...satelliteIds, ...duplicateIds, ...stationIds];
}

function getCompositeLayerMeta(layerId) {
    if (isGroundStationLayerId(layerId)) {
        return { sourceFormat: "GROUND_STATION", sourceOrigin: "USER" };
    }
    const sourceId = getSatelliteSourceIdFromLayerId(layerId);
    return getCatalogEntryMeta(sourceId) || { sourceFormat: "TLE", sourceOrigin: "CATALOG" };
}

function getCompositeLayerVisibility(layerId) {
    if (isGroundStationLayerId(layerId)) {
        return groundStationLayers.get(layerId)?.visible === true;
    }
    const sourceId = getSatelliteSourceIdFromLayerId(layerId);
    return isSatelliteVisible(sourceId);
}

function setCompositeLayerVisibility(layerId, visible) {
    if (isGroundStationLayerId(layerId)) {
        const station = groundStationLayers.get(layerId);
        if (!station) {
            return;
        }
        station.visible = visible === true;
        if (station.entity) station.entity.show = station.visible;
        if (station.coverageEntity) station.coverageEntity.show = station.visible;
        const heatEntities = groundStationHeatMapEntities.get(layerId) || [];
        for (const entity of heatEntities) {
            entity.show = station.visible;
        }
        return;
    }
    const sourceId = getSatelliteSourceIdFromLayerId(layerId);
    setSatelliteVisible(sourceId, visible);
}

function isCompositeLayerActive(layerId) {
    if (isGroundStationLayerId(layerId)) {
        return groundStationLayers.has(layerId);
    }
    if (isSatelliteDuplicateLayerId(layerId)) {
        return satelliteDuplicateLayers.has(layerId);
    }
    return isSatelliteLayerActive(layerId);
}

function removeGroundStationLayer(layerId) {
    const station = groundStationLayers.get(layerId);
    if (!station) {
        return;
    }
    if (station.entity) viewer.entities.remove(station.entity);
    if (station.coverageEntity) viewer.entities.remove(station.coverageEntity);
    clearGroundStationHeatMap(layerId);
    groundStationLayers.delete(layerId);
    layerDisplayNameOverrides.delete(layerId);
    groundStationPassCache.delete(layerId);
}

function setCompositeLayerActive(layerId, active) {
    const isActive = active === true;
    if (isGroundStationLayerId(layerId)) {
        if (!isActive) {
            removeGroundStationLayer(layerId);
        }
        return true;
    }

    if (isSatelliteDuplicateLayerId(layerId)) {
        if (!isActive) {
            satelliteDuplicateLayers.delete(layerId);
            layerDisplayNameOverrides.delete(layerId);
            return true;
        }
        return false;
    }

    if (!isActive) {
        for (const [dupId, dup] of satelliteDuplicateLayers.entries()) {
            if (dup.sourceId === layerId) {
                satelliteDuplicateLayers.delete(dupId);
                layerDisplayNameOverrides.delete(dupId);
            }
        }
    }

    return setSatelliteLayerActive(layerId, isActive);
}

function buildDuplicateLayerDefaultName(sourceId) {
    const baseName = getLayerDisplayName(sourceId) || sourceId;
    const duplicateCount = [...satelliteDuplicateLayers.values()].filter((entry) => entry.sourceId === sourceId).length;
    return `${baseName} (${duplicateCount + 2})`;
}

function duplicateSatelliteLayer(sourceId) {
    const satId = String(sourceId || "").trim();
    if (!satId) {
        return null;
    }

    if (!isSatelliteLayerActive(satId)) {
        const added = setSatelliteLayerActive(satId, true);
        if (!added) {
            return null;
        }
    }

    const duplicateId = `satdup:${satelliteDuplicateSequence++}`;
    satelliteDuplicateLayers.set(duplicateId, { sourceId: satId });
    layerDisplayNameOverrides.set(duplicateId, buildDuplicateLayerDefaultName(satId));
    return duplicateId;
}

function renameLayer(layerId, nextName) {
    const id = String(layerId || "").trim();
    const name = String(nextName || "").trim();
    if (!id || !name) {
        return false;
    }

    layerDisplayNameOverrides.set(id, name);
    if (isGroundStationLayerId(id)) {
        const station = groundStationLayers.get(id);
        if (station) {
            station.name = name;
            if (station.entity?.label) {
                station.entity.label.text = name;
            }
        }
    }
    return true;
}

function createStationSymbolImage(symbol = "circle", color = "#3cc4ff", size = 11) {
    const px = Math.max(8, Math.min(64, Math.round(Number(size) || 11)));
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        return "";
    }

    const c = String(color || "#3cc4ff");
    const center = px / 2;
    const r = (px / 2) - 1.5;

    ctx.clearRect(0, 0, px, px);
    ctx.fillStyle = c;
    ctx.strokeStyle = "#00131f";
    ctx.lineWidth = 1.8;

    const drawPolygon = (points) => {
        ctx.beginPath();
        points.forEach((p, index) => {
            if (index === 0) ctx.moveTo(p[0], p[1]);
            else ctx.lineTo(p[0], p[1]);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    };

    switch (String(symbol || "circle")) {
    case "square":
        drawPolygon([
            [center - r, center - r],
            [center + r, center - r],
            [center + r, center + r],
            [center - r, center + r]
        ]);
        break;
    case "triangle":
        drawPolygon([
            [center, center - r],
            [center + r, center + r],
            [center - r, center + r]
        ]);
        break;
    case "diamond":
        drawPolygon([
            [center, center - r],
            [center + r, center],
            [center, center + r],
            [center - r, center]
        ]);
        break;
    case "star": {
        const points = [];
        for (let i = 0; i < 10; i += 1) {
            const angle = (-Math.PI / 2) + (i * Math.PI / 5);
            const radius = i % 2 === 0 ? r : r * 0.45;
            points.push([center + Math.cos(angle) * radius, center + Math.sin(angle) * radius]);
        }
        drawPolygon(points);
        break;
    }
    default:
        ctx.beginPath();
        ctx.arc(center, center, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
    }

    return canvas.toDataURL("image/png");
}

function applyGroundStationVisuals(station) {
    if (!station || !station.entity) {
        return;
    }

    const symbolImage = createStationSymbolImage(station.point_symbol, station.point_color, station.point_size_px);
    station.entity.billboard = {
        image: symbolImage,
        width: Math.max(8, Number(station.point_size_px) || 11),
        height: Math.max(8, Number(station.point_size_px) || 11),
        verticalOrigin: Cesium.VerticalOrigin.CENTER
    };
    station.entity.point = undefined;

    if (station.coverageEntity?.ellipse) {
        station.coverageEntity.ellipse.semiMajorAxis = station.coverage_radius_km * 1000;
        station.coverageEntity.ellipse.semiMinorAxis = station.coverage_radius_km * 1000;
        station.coverageEntity.ellipse.height = Math.max(3000, Number(station.altitude_m) + 3000);
        station.coverageEntity.ellipse.material = Cesium.Color.fromCssColorString(station.point_color || "#3cc4ff").withAlpha(0.11);
        station.coverageEntity.ellipse.outlineColor = Cesium.Color.fromCssColorString(station.point_color || "#3cc4ff").withAlpha(0.74);
    }
}

function createGroundStationLayer(params = {}) {
    const lat = Number(params.latitude_deg);
    const lon = Number(params.longitude_deg);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
    }

    const stationId = `gst:${groundStationSequence++}`;
    const altitudeM = Number.isFinite(Number(params.altitude_m)) ? Number(params.altitude_m) : 0;
    const minElevationDeg = Number.isFinite(Number(params.min_elevation_deg)) ? Number(params.min_elevation_deg) : 10;
    const frequencyMhz = Number.isFinite(Number(params.frequency_mhz)) ? Number(params.frequency_mhz) : 2200;
    const txPowerDbm = Number.isFinite(Number(params.tx_power_dbm)) ? Number(params.tx_power_dbm) : 38;
    const txGainDbi = Number.isFinite(Number(params.tx_gain_dbi)) ? Number(params.tx_gain_dbi) : 18;
    const rxGainDbi = Number.isFinite(Number(params.rx_gain_dbi)) ? Number(params.rx_gain_dbi) : 21;
    const coverageRadiusKm = Number.isFinite(Number(params.coverage_radius_km)) ? Number(params.coverage_radius_km) : 1200;
    const pointSizePx = Number.isFinite(Number(params.point_size_px)) ? Number(params.point_size_px) : 11;
    const pointColor = String(params.point_color || "#3cc4ff").trim() || "#3cc4ff";
    const pointSymbol = String(params.point_symbol || "circle").trim() || "circle";
    const heatmapEnabled = params.heatmap_enabled !== false;
    const displayName = String(params.name || `Estacion ${groundStationSequence - 1}`).trim() || `Estacion ${groundStationSequence - 1}`;

    const position = Cesium.Cartesian3.fromDegrees(lon, lat, altitudeM);
    const stationEntity = viewer.entities.add({
        id: `${stationId}-entity`,
        position,
        label: {
            text: displayName,
            font: "600 12px sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -14)
        },
        properties: {
            orbitLayerId: stationId,
            layerType: "GROUND_STATION"
        }
    });

    const coverageEntity = viewer.entities.add({
        id: `${stationId}-coverage`,
        position,
        ellipse: {
            semiMajorAxis: coverageRadiusKm * 1000,
            semiMinorAxis: coverageRadiusKm * 1000,
            material: Cesium.Color.fromCssColorString("#3cc4ff").withAlpha(0.12),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#3cc4ff").withAlpha(0.7),
            height: Math.max(3000, altitudeM + 3000)
        },
        properties: {
            orbitLayerId: stationId,
            layerType: "GROUND_STATION"
        }
    });

    groundStationLayers.set(stationId, {
        id: stationId,
        name: displayName,
        latitude_deg: lat,
        longitude_deg: lon,
        altitude_m: altitudeM,
        min_elevation_deg: minElevationDeg,
        frequency_mhz: frequencyMhz,
        tx_power_dbm: txPowerDbm,
        tx_gain_dbi: txGainDbi,
        rx_gain_dbi: rxGainDbi,
        coverage_radius_km: coverageRadiusKm,
        point_size_px: pointSizePx,
        point_color: pointColor,
        point_symbol: pointSymbol,
        heatmap_enabled: heatmapEnabled,
        heatmap_samples: new Map(),
        visible: true,
        entity: stationEntity,
        coverageEntity
    });

    applyGroundStationVisuals(groundStationLayers.get(stationId));

    layerDisplayNameOverrides.set(stationId, displayName);
    return stationId;
}

function getGroundStationParams(layerId) {
    const station = groundStationLayers.get(layerId);
    if (!station) {
        return null;
    }
    return {
        name: station.name,
        latitude_deg: station.latitude_deg,
        longitude_deg: station.longitude_deg,
        altitude_m: station.altitude_m,
        min_elevation_deg: station.min_elevation_deg,
        frequency_mhz: station.frequency_mhz,
        tx_power_dbm: station.tx_power_dbm,
        tx_gain_dbi: station.tx_gain_dbi,
        rx_gain_dbi: station.rx_gain_dbi,
        coverage_radius_km: station.coverage_radius_km,
        point_size_px: station.point_size_px,
        point_symbol: station.point_symbol,
        point_color: station.point_color,
        heatmap_enabled: station.heatmap_enabled !== false
    };
}

function updateGroundStationLayer(layerId, patch = {}) {
    const station = groundStationLayers.get(layerId);
    if (!station) {
        return false;
    }

    const nextLat = Number.isFinite(Number(patch.latitude_deg)) ? Number(patch.latitude_deg) : station.latitude_deg;
    const nextLon = Number.isFinite(Number(patch.longitude_deg)) ? Number(patch.longitude_deg) : station.longitude_deg;
    const nextAlt = Number.isFinite(Number(patch.altitude_m)) ? Number(patch.altitude_m) : station.altitude_m;
    const nextName = String(patch.name || station.name).trim() || station.name;

    station.name = nextName;
    station.latitude_deg = nextLat;
    station.longitude_deg = nextLon;
    station.altitude_m = nextAlt;
    station.min_elevation_deg = Number.isFinite(Number(patch.min_elevation_deg)) ? Number(patch.min_elevation_deg) : station.min_elevation_deg;
    station.frequency_mhz = Number.isFinite(Number(patch.frequency_mhz)) ? Number(patch.frequency_mhz) : station.frequency_mhz;
    station.tx_power_dbm = Number.isFinite(Number(patch.tx_power_dbm)) ? Number(patch.tx_power_dbm) : station.tx_power_dbm;
    station.tx_gain_dbi = Number.isFinite(Number(patch.tx_gain_dbi)) ? Number(patch.tx_gain_dbi) : station.tx_gain_dbi;
    station.rx_gain_dbi = Number.isFinite(Number(patch.rx_gain_dbi)) ? Number(patch.rx_gain_dbi) : station.rx_gain_dbi;
    station.coverage_radius_km = Number.isFinite(Number(patch.coverage_radius_km)) ? Number(patch.coverage_radius_km) : station.coverage_radius_km;
    station.point_size_px = Number.isFinite(Number(patch.point_size_px)) ? Number(patch.point_size_px) : station.point_size_px;
    station.point_symbol = String(patch.point_symbol || station.point_symbol || "circle").trim() || "circle";
    station.point_color = String(patch.point_color || station.point_color || "#3cc4ff").trim() || "#3cc4ff";
    station.heatmap_enabled = patch.heatmap_enabled !== false;

    const nextPosition = Cesium.Cartesian3.fromDegrees(station.longitude_deg, station.latitude_deg, station.altitude_m);
    if (station.entity) {
        station.entity.position = nextPosition;
        if (station.entity.label) {
            station.entity.label.text = station.name;
        }
    }
    if (station.coverageEntity) {
        station.coverageEntity.position = nextPosition;
    }

    layerDisplayNameOverrides.set(layerId, station.name);
    applyGroundStationVisuals(station);
    return true;
}

function clearGroundStationHeatMap(layerId) {
    const entities = groundStationHeatMapEntities.get(layerId) || [];
    for (const entity of entities) {
        viewer.entities.remove(entity);
    }
    groundStationHeatMapEntities.delete(layerId);
}

function updateGroundStationHeatMap(layerId) {
    const station = groundStationLayers.get(layerId);
    if (!station || station.visible !== true) {
        clearGroundStationHeatMap(layerId);
        return;
    }
    if (station.heatmap_enabled === false) {
        clearGroundStationHeatMap(layerId);
        return;
    }

    const satIds = getActiveSatelliteLayerIds().slice(0, 80);
    if (!satIds.length) {
        clearGroundStationHeatMap(layerId);
        return;
    }

    const existing = groundStationHeatMapEntities.get(layerId) || [];
    for (const entity of existing) {
        viewer.entities.remove(entity);
    }

    const entities = [];
    const latCenter = station.latitude_deg;
    const lonCenter = station.longitude_deg;
    const gridRadius = 3;
    const stepDeg = 2;

    for (let yi = -gridRadius; yi <= gridRadius; yi += 1) {
        for (let xi = -gridRadius; xi <= gridRadius; xi += 1) {
            const lat = latCenter + (yi * stepDeg);
            const lon = lonCenter + (xi * stepDeg);

            if (lat < -89.9 || lat > 89.9) {
                continue;
            }

            const wrappedLon = lon > 180 ? lon - 360 : (lon < -180 ? lon + 360 : lon);
            const groundPos = Cesium.Cartesian3.fromDegrees(wrappedLon, lat, 0);
            let covered = false;

            for (const satId of satIds) {
                const telemetry = getSatelliteTelemetry(satId);
                const g = telemetry?.geo;
                if (!g) {
                    continue;
                }

                const satPos = Cesium.Cartesian3.fromDegrees(Number(g.longitude_deg) || 0, Number(g.latitude_deg) || 0, Number(g.altitude_m) || 0);
                const el = computeStationElevationDeg(groundPos, satPos);
                if (el >= station.min_elevation_deg) {
                    covered = true;
                    break;
                }
            }

            const key = `${lat.toFixed(3)}:${lon.toFixed(3)}`;
            const sample = station.heatmap_samples.get(key) || { hits: 0, total: 0 };
            sample.total += 1;
            if (covered) {
                sample.hits += 1;
            }
            station.heatmap_samples.set(key, sample);

            const ratio = sample.total > 0 ? sample.hits / sample.total : 0;
            const color = ratio > 0.8
                ? Cesium.Color.fromCssColorString("#3af27a")
                : ratio > 0.55
                    ? Cesium.Color.fromCssColorString("#f7d34d")
                    : ratio > 0.3
                        ? Cesium.Color.fromCssColorString("#f29a3a")
                        : Cesium.Color.fromCssColorString("#cc3d55");

            const pointEntity = viewer.entities.add({
                id: `${layerId}-heat-${lat.toFixed(3)}-${lon.toFixed(3)}`,
                position: Cesium.Cartesian3.fromDegrees(lon, lat, 2200),
                point: {
                    pixelSize: 6,
                    color: color.withAlpha(0.58),
                    outlineColor: Cesium.Color.BLACK.withAlpha(0.35),
                    outlineWidth: 1
                },
                show: station.visible === true,
                properties: {
                    orbitLayerId: layerId,
                    layerType: "GROUND_STATION_HEAT"
                }
            });
            entities.push(pointEntity);
        }
    }

    groundStationHeatMapEntities.set(layerId, entities);
}

function refreshAllGroundStationHeatMaps() {
    for (const layerId of groundStationLayers.keys()) {
        updateGroundStationHeatMap(layerId);
    }
}

async function refreshGroundStationPasses(stationId) {
    const station = groundStationLayers.get(stationId);
    if (!station) {
        return;
    }

    const cache = groundStationPassCache.get(stationId) || {};
    if (cache.loading === true) {
        return;
    }
    groundStationPassCache.set(stationId, { ...cache, loading: true });

    try {
        const now = getDisplayedSimulationDate();
        const startDate = simulationState.mode === SIMULATION_MODE_RANGE ? simulationState.startDate : now;
        const endDate = simulationState.mode === SIMULATION_MODE_RANGE
            ? simulationState.endDate
            : new Date(now.getTime() + (6 * 3600 * 1000));

        const satIds = getActiveSatelliteLayerIds().slice(0, 10);
        const requests = satIds.map(async (satId) => {
            const query = new URLSearchParams({
                sat_id: satId,
                station_lat_deg: String(station.latitude_deg),
                station_lon_deg: String(station.longitude_deg),
                min_elevation_deg: String(station.min_elevation_deg),
                start_time: startDate.toISOString(),
                end_time: endDate.toISOString(),
                step_seconds: "60"
            });

            const response = await fetch(`/api/aos-los?${query.toString()}`);
            if (!response.ok) {
                return null;
            }

            const payload = await response.json();
            const firstPass = Array.isArray(payload?.passes) && payload.passes.length > 0 ? payload.passes[0] : null;
            if (!firstPass) {
                return null;
            }

            return {
                satellite: satId,
                aos: firstPass.aos || "-",
                los: firstPass.los || "-",
                max_elevation_deg: Number(firstPass.max_elevation_deg)
            };
        });

        const rows = (await Promise.allSettled(requests))
            .filter((item) => item.status === "fulfilled" && item.value)
            .map((item) => item.value)
            .slice(0, 10);

        groundStationPassCache.set(stationId, {
            loading: false,
            updatedAt: Date.now(),
            rows
        });
    } catch {
        groundStationPassCache.set(stationId, {
            loading: false,
            updatedAt: Date.now(),
            rows: []
        });
    }
}

function buildGroundStationTelemetry(layerId) {
    const station = groundStationLayers.get(layerId);
    if (!station) {
        return null;
    }

    const stationCartesian = Cesium.Cartesian3.fromDegrees(
        station.longitude_deg,
        station.latitude_deg,
        station.altitude_m
    );

    let visibleCount = 0;
    let totalActiveSatellites = 0;
    let bestElevationDeg = null;
    let bestRangeKm = null;
    let bestLinkDbm = null;

    const activeSatelliteLayers = getCompositeLayerIds().filter((layerId) => !isGroundStationLayerId(layerId));
    for (const layerId of activeSatelliteLayers) {
        const satId = getSatelliteSourceIdFromLayerId(layerId);
        const telemetry = getSatelliteTelemetry(satId);
        const g = telemetry?.geo;
        if (!g) {
            continue;
        }

        totalActiveSatellites += 1;
        const satCartesian = Cesium.Cartesian3.fromDegrees(
            Number(g.longitude_deg) || 0,
            Number(g.latitude_deg) || 0,
            Number(g.altitude_m) || 0
        );

        const los = Cesium.Cartesian3.subtract(satCartesian, stationCartesian, new Cesium.Cartesian3());
        const rangeKm = Cesium.Cartesian3.magnitude(los) / 1000;
        const elevationDeg = computeStationElevationDeg(stationCartesian, satCartesian);

        if (elevationDeg >= station.min_elevation_deg) {
            visibleCount += 1;
            const fsplDb = computeFreeSpacePathLossDb(station.frequency_mhz, rangeKm);
            const rxDbm = Number.isFinite(fsplDb)
                ? station.tx_power_dbm + station.tx_gain_dbi + station.rx_gain_dbi - fsplDb
                : null;

            if (bestElevationDeg === null || elevationDeg > bestElevationDeg) {
                bestElevationDeg = elevationDeg;
                bestRangeKm = rangeKm;
                bestLinkDbm = rxDbm;
            }
        }
    }

    const passCache = groundStationPassCache.get(layerId);
    if (!passCache || (Date.now() - Number(passCache.updatedAt || 0)) > 45_000) {
        refreshGroundStationPasses(layerId);
    }

    return {
        id: getLayerDisplayName(layerId),
        source_format: "GROUND_STATION",
        source_origin: "USER",
        station: {
            name: station.name,
            latitude_deg: station.latitude_deg,
            longitude_deg: station.longitude_deg,
            altitude_m: station.altitude_m,
            min_elevation_deg: station.min_elevation_deg,
            frequency_mhz: station.frequency_mhz,
            tx_power_dbm: station.tx_power_dbm,
            tx_gain_dbi: station.tx_gain_dbi,
            rx_gain_dbi: station.rx_gain_dbi
        },
        realtime: {
            visible_satellites: visibleCount,
            active_satellites: totalActiveSatellites,
            best_elevation_deg: bestElevationDeg,
            best_range_km: bestRangeKm,
            best_link_dbm: bestLinkDbm
        },
        next_passes: Array.isArray(passCache?.rows) ? passCache.rows : []
    };
}

function getCompositeLayerTelemetry(layerId) {
    if (isGroundStationLayerId(layerId)) {
        return buildGroundStationTelemetry(layerId);
    }

    const sourceId = getSatelliteSourceIdFromLayerId(layerId);
    const telemetry = getSatelliteTelemetry(sourceId);
    if (!telemetry) {
        return null;
    }

    return {
        ...telemetry,
        id: getLayerDisplayName(layerId)
    };
}

function getCompositeLayerEntity(layerId) {
    if (isGroundStationLayerId(layerId)) {
        return groundStationLayers.get(layerId)?.entity || null;
    }
    const sourceId = getSatelliteSourceIdFromLayerId(layerId);
    return getSatelliteEntity(sourceId);
}

function getCompositeMaxLayers() {
    return getMaxActiveSatellites();
}

function getCompositeAvailableLayerSlots() {
    const max = Math.max(1, Number(getCompositeMaxLayers()) || 100);
    const used = getCompositeLayerIds().length;
    return Math.max(0, max - used);
}

function activateSatelliteSelection(satelliteId, focus = true) {
    const satId = String(satelliteId || "").trim();
    if (!satId) {
        return;
    }

    objectSidebar?.selectObject?.(satId);
    setCurrentSelectedSatellite(satId);
    setSelectedOrbitSatelliteId(satId);

    const tryFocus = (attempt = 0) => {
        const entity = getSatelliteEntity(satId);
        if (entity) {
            viewer.selectedEntity = entity;
            if (focus) {
                focusSatellite(entity);
            }
            return;
        }
        if (attempt >= 30) {
            return;
        }
        setTimeout(() => tryFocus(attempt + 1), 120);
    };

    tryFocus();
}

async function selectSatelliteFromGlobalSearch(item) {
    const satId = String(item?.name || "").trim();
    if (!satId) {
        return;
    }

    const searchInput = document.getElementById("objectSearch");
    if (searchInput) {
        searchInput.value = "";
    }
    closeTopSearchSuggestions();

    const alreadyActive = isSatelliteLayerActive(satId);
    if (!alreadyActive) {
        const added = setSatelliteLayerActive(satId, true);
        if (!added) {
            await showAppAlert(`No hay hueco para activar la capa de ${satId}.`, uiText("alertTitle"));
            return;
        }
    }

    openLeftSatellitesPanel();
    activateSatelliteSelection(satId, true);
}

function setupTopSearchAutocomplete() {
    const searchInput = document.getElementById("objectSearch");
    const searchWrap = document.querySelector("#topToolbar .toolbar-search-wrap");
    if (!searchInput || !searchWrap) {
        return;
    }

    searchInput.placeholder = uiText("globalSearchPlaceholder");
    searchInput.dataset.globalSearchMode = "true";

    if (topSearchInitialized) {
        return;
    }

    if (!topSearchSuggestionsRoot) {
        topSearchSuggestionsRoot = document.getElementById("topSearchSuggestions");
    }
    if (!topSearchSuggestionsRoot) {
        topSearchSuggestionsRoot = document.createElement("div");
        topSearchSuggestionsRoot.id = "topSearchSuggestions";
        searchWrap.appendChild(topSearchSuggestionsRoot);
    }

    const runSearch = async (rawQuery) => {
        const query = String(rawQuery || "").trim();
        topSearchLastQuery = query;
        if (!query) {
            topSearchSuggestions = [];
            closeTopSearchSuggestions();
            return;
        }

        const token = ++topSearchRequestToken;
        try {
            const items = await fetchTopSearchSuggestions(query);
            if (token !== topSearchRequestToken) {
                return;
            }
            topSearchSuggestions = items;
            topSearchSelectedIndex = items.length ? 0 : -1;
            renderTopSearchSuggestions();
        } catch (error) {
            logger.warn("Busqueda global: error cargando sugerencias", error);
            topSearchSuggestions = [];
            topSearchSelectedIndex = -1;
            renderTopSearchSuggestions();
        }
    };

    searchInput.addEventListener("input", () => {
        if (topSearchDebounceId) {
            clearTimeout(topSearchDebounceId);
        }
        topSearchDebounceId = setTimeout(() => {
            runSearch(searchInput.value);
        }, 120);
    });

    searchInput.addEventListener("focus", () => {
        if (searchInput.value.trim()) {
            runSearch(searchInput.value);
        }
    });

    searchInput.addEventListener("keydown", (event) => {
        if (!topSearchSuggestions.length) {
            if (event.key === "Enter") {
                const raw = String(searchInput.value || "").trim();
                if (raw) {
                    selectSatelliteFromGlobalSearch({ name: raw });
                }
            }
            return;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            topSearchSelectedIndex = (topSearchSelectedIndex + 1) % topSearchSuggestions.length;
            renderTopSearchSuggestions();
            return;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            topSearchSelectedIndex = (topSearchSelectedIndex - 1 + topSearchSuggestions.length) % topSearchSuggestions.length;
            renderTopSearchSuggestions();
            return;
        }

        if (event.key === "Enter") {
            event.preventDefault();
            const selected = topSearchSuggestions[topSearchSelectedIndex] || topSearchSuggestions[0];
            if (selected) {
                selectSatelliteFromGlobalSearch(selected);
            }
            return;
        }

        if (event.key === "Escape") {
            closeTopSearchSuggestions();
        }
    });

    document.addEventListener("click", (event) => {
        if (!searchWrap.contains(event.target)) {
            closeTopSearchSuggestions();
        }
    });

    topSearchInitialized = true;
}

function updateSimulationTimelineUi() {
    const root = simulationControlRoot;
    if (!root) {
        return;
    }

    const timeline = root.querySelector("#simTimeline");
    const currentInfo = root.querySelector("#simCurrentInfo");
    const modeInfo = root.querySelector("#simModeInfo");
    const speedInfo = root.querySelector("#simSpeedInfo");
    if (timeline) {
        const ratio = getTimelineRatioByDate(getDisplayedSimulationDate());
        timeline.value = String(Math.floor(ratio * SIMULATION_TIMELINE_STEPS));
    }
    if (currentInfo) {
        currentInfo.textContent = `${uiText("simCurrent")}: ${formatTimeHudDate(getDisplayedSimulationDate())}`;
    }
    if (modeInfo) {
        modeInfo.textContent = getSimulationModeLabel();
    }
    if (speedInfo) {
        speedInfo.textContent = simulationState.mode === SIMULATION_MODE_REALTIME
            ? ""
            : `x${simulationState.speed}`;
    }
}

function updateSimulationDockLayout() {
    if (!simulationControlRoot) {
        return;
    }

    const satPanelOpen = document.getElementById("leftSatellitesPanel")?.classList.contains("open");
    const infoPanelOpen = document.getElementById("leftInfoPanel")?.classList.contains("open");
    const panelOpen = satPanelOpen || infoPanelOpen;
    const leftOffset = panelOpen ? 390 : 62;

    simulationControlRoot.style.left = `${leftOffset}px`;
}

function setSimulationDockOpen(open) {
    simulationDockOpen = Boolean(open);
    if (!simulationControlRoot) {
        return;
    }

    simulationControlRoot.classList.toggle("open", simulationDockOpen);
    simulationControlRoot.classList.toggle("collapsed", !simulationDockOpen);
    updateSimulationDockLayout();
}

function toggleSimulationDock() {
    setSimulationDockOpen(!simulationDockOpen);
    updateTopToolbarState();
}

function refreshSimulationControlsUi() {
    const root = simulationControlRoot;
    if (!root || simulationUiBusy) {
        return;
    }

    simulationUiBusy = true;
    root.classList.toggle("open", simulationDockOpen);
    root.classList.toggle("collapsed", !simulationDockOpen);

    const startInput = root.querySelector("#simStartInput");
    const endInput = root.querySelector("#simEndInput");
    const playBtn = root.querySelector("#simPlayPauseBtn");
    const stopBtn = root.querySelector("#simStopBtn");
    const restartBtn = root.querySelector("#simRestartBtn");
    const modeButtons = root.querySelectorAll(".sim-mode-btn");
    const speedButtons = root.querySelectorAll(".sim-speed-btn");
    const rangeGroup = root.querySelector("#simRangeGroup, .sim-range-group");
    const actionsGroup = root.querySelector("#simActionsGroup, .sim-actions-group");
    const timelineRow = root.querySelector("#simTimelineRow, .sim-timeline-row");
    const domainIndicator = root.querySelector("#simDomainIndicator");
    const isRealtimeMode = simulationState.mode === SIMULATION_MODE_REALTIME;
    const isRangeMode = simulationState.mode === SIMULATION_MODE_RANGE;
    const oemDomainActive = hasLoadedOemEphemerisTracks();

    root.dataset.mode = simulationState.mode;

    if (rangeGroup) {
        rangeGroup.hidden = !isRangeMode;
    }
    if (actionsGroup) {
        actionsGroup.hidden = isRealtimeMode;
    }
    if (timelineRow) {
        timelineRow.hidden = isRealtimeMode;
    }
    if (domainIndicator) {
        const domainText = oemDomainActive ? "OEM" : "General";
        domainIndicator.textContent = `${uiText("simDomainLabel")}: ${domainText}`;
        domainIndicator.classList.toggle("is-oem", oemDomainActive);
    }

    if (startInput && document.activeElement !== startInput && startInput.dataset.userEdited !== "true") {
        startInput.value = formatDateTimeLocalInput(simulationState.startDate);
    }
    if (endInput && document.activeElement !== endInput && endInput.dataset.userEdited !== "true") {
        endInput.value = formatDateTimeLocalInput(simulationState.endDate);
    }
    if (playBtn) {
        playBtn.textContent = simulationState.isPlaying ? "⏸" : "▶";
        playBtn.title = simulationState.isPlaying ? uiText("simPause") : uiText("simPlay");
    }
    if (stopBtn) {
        stopBtn.classList.toggle("active", !simulationState.isPlaying);
        stopBtn.title = uiText("simPause");
    }
    if (restartBtn) {
        restartBtn.title = uiText("simRewind");
    }

    modeButtons.forEach((btn) => {
        const mode = btn.getAttribute("data-mode");
        btn.classList.toggle("active", mode === simulationState.mode);
    });
    speedButtons.forEach((btn) => {
        const speedValue = Number(btn.getAttribute("data-speed"));
        btn.classList.toggle("active", speedValue === simulationState.speed);
    });

    updateSimulationTimelineUi();
    updateSimulationDockLayout();
    simulationUiBusy = false;
}

function setSimulationMode(mode) {
    const previousMode = simulationState.mode;
    const normalized = [SIMULATION_MODE_REALTIME, SIMULATION_MODE_RANGE].includes(mode)
        ? mode
        : SIMULATION_MODE_REALTIME;

    if (normalized === SIMULATION_MODE_REALTIME && hasLoadedOemEphemerisTracks()) {
        const bounds = getLoadedOemEphemerisTimeBounds();
        if (bounds) {
            applySimulationRange(new Date(bounds.startTimeMs), new Date(bounds.endTimeMs));
        }
        simulationState.mode = SIMULATION_MODE_RANGE;
        showAppAlert("No se puede usar tiempo real mientras haya OEMs cargados. Usa modo Rango.", uiText("alertTitle"));
        simulationState.lastTickTimestamp = Date.now();
        applySimulationDateToViewer(getDisplayedSimulationDate());
        updateTopToolbarTime();
        refreshSimulationControlsUi();
        return;
    }

    simulationState.mode = normalized;

    if (normalized === SIMULATION_MODE_REALTIME) {
        simulationState.isPlaying = true;
        simulationState.rewind = false;
        simulationState.speed = 1;
        simulationState.currentDate = new Date();
    } else {
        if (previousMode !== SIMULATION_MODE_RANGE) {
            simulationState.currentDate = new Date(simulationState.startDate);
        } else {
            const now = getDisplayedSimulationDate();
            if (now < simulationState.startDate) {
                simulationState.currentDate = new Date(simulationState.startDate);
            } else if (now > simulationState.endDate) {
                simulationState.currentDate = new Date(simulationState.endDate);
            } else {
                simulationState.currentDate = now;
            }
        }

        if (!(simulationState.currentDate instanceof Date) || Number.isNaN(simulationState.currentDate.getTime())) {
            simulationState.currentDate = new Date(simulationState.startDate);
        }
    }

    simulationState.lastTickTimestamp = Date.now();
    applySimulationDateToViewer(getDisplayedSimulationDate());
    updateTopToolbarTime();
    refreshSimulationControlsUi();
}

function applySimulationRange(startDate, endDate) {
    let startMs = startDate.getTime();
    let endMs = endDate.getTime();

    if (hasLoadedOemEphemerisTracks()) {
        const bounds = getLoadedOemEphemerisTimeBounds();
        if (bounds) {
            startMs = Number(bounds.startTimeMs);
            endMs = Number(bounds.endTimeMs);
        }
    }

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return false;
    }

    simulationState.startDate = new Date(startMs);
    simulationState.endDate = new Date(endMs);
    simulationState.currentDate = new Date(clamp(getDisplayedSimulationDate().getTime(), startMs, endMs));
    simulationState.rewind = false;

    const rangeHours = (endMs - startMs) / (1000 * 60 * 60);
    const targetHours = Math.max(0, rangeHours);
    if (Number.isFinite(targetHours) && targetHours > 0) {
        setOrbitConfig({ propagation_hours: targetHours });
        persistSystemSectionPatch("orbit", { propagation_hours: targetHours });
    }

    if (simulationState.mode === SIMULATION_MODE_REALTIME) {
        simulationState.mode = SIMULATION_MODE_RANGE;
    }
    applySimulationDateToViewer(simulationState.currentDate);
    refreshSimulationControlsUi();
    updateTopToolbarTime();
    return true;
}

function tickSimulationClock() {
    const nowTs = Date.now();
    const deltaMs = Math.max(0, nowTs - simulationState.lastTickTimestamp);
    simulationState.lastTickTimestamp = nowTs;

    if (simulationState.mode === SIMULATION_MODE_REALTIME) {
        simulationState.currentDate = new Date();
        applySimulationDateToViewer(simulationState.currentDate);
        return;
    }

    if (!simulationState.isPlaying) {
        return;
    }

    const direction = simulationState.rewind ? -1 : 1;
    const nextMs = simulationState.currentDate.getTime() + deltaMs * simulationState.speed * direction;
    const startMs = simulationState.startDate.getTime();
    const endMs = simulationState.endDate.getTime();

    if (nextMs <= startMs) {
        simulationState.currentDate = new Date(startMs);
        simulationState.isPlaying = false;
    } else if (nextMs >= endMs) {
        simulationState.currentDate = new Date(endMs);
        simulationState.isPlaying = false;
    } else {
        simulationState.currentDate = new Date(nextMs);
    }

    applySimulationDateToViewer(simulationState.currentDate);
}

function ensureSimulationControlDock() {
    if (simulationControlRoot) {
        return simulationControlRoot;
    }

    const root = document.createElement("div");
    root.id = "simulationControlDock";
    root.innerHTML = `
        <div class="sim-controls-row">
            <div class="sim-mode-group">
                <button class="sim-mode-btn" data-mode="realtime" type="button">${uiText("simRealtime")}</button>
                <button class="sim-mode-btn" data-mode="range" type="button">${uiText("simRange")}</button>
            </div>
            <div id="simDomainIndicator" class="sim-domain-indicator" aria-live="polite"></div>
            <div id="simRangeGroup" class="sim-range-group">
                <label>${uiText("simStart")}<input id="simStartInput" type="datetime-local"></label>
                <label>${uiText("simEnd")}<input id="simEndInput" type="datetime-local"></label>
            </div>
            <div id="simActionsGroup" class="sim-actions-group">
                <button id="simPlayPauseBtn" class="sim-icon-btn" type="button" title="${uiText("simPlay")}">▶</button>
                <button id="simStopBtn" class="sim-icon-btn" type="button" title="${uiText("simPause")}">⏹</button>
                <button id="simRestartBtn" class="sim-icon-btn" type="button" title="${uiText("simRewind")}">⏮</button>
                <div class="sim-speed-group">
                    ${SIMULATION_SPEED_VALUES.map((value) => `<button class="sim-speed-btn" data-speed="${value}" type="button">x${value}</button>`).join("")}
                </div>
            </div>
        </div>
        <div id="simTimelineRow" class="sim-timeline-row">
            <input id="simTimeline" type="range" min="0" max="${SIMULATION_TIMELINE_STEPS}" step="1" value="0">
            <div class="sim-timeline-info">
                <span id="simModeInfo"></span>
                <span id="simSpeedInfo"></span>
                <span id="simCurrentInfo"></span>
            </div>
        </div>
    `;
    document.body.appendChild(root);
    simulationControlRoot = root;

    root.querySelectorAll(".sim-mode-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const mode = btn.getAttribute("data-mode");
            setSimulationMode(mode);
        });
    });

    const tryApplySimulationRangeFromInputs = async () => {
        const startInput = root.querySelector("#simStartInput");
        const endInput = root.querySelector("#simEndInput");
        const startDate = parseDateTimeLocalInput(startInput?.value);
        const endDate = parseDateTimeLocalInput(endInput?.value);
        if (!startDate || !endDate || endDate <= startDate) {
            return false;
        }

        const confirmed = await confirmLargeSimulationRangeIfNeeded(startDate, endDate);
        if (!confirmed) {
            if (startInput) {
                startInput.value = formatDateTimeLocalInput(simulationState.startDate);
                startInput.dataset.userEdited = "false";
            }
            if (endInput) {
                endInput.value = formatDateTimeLocalInput(simulationState.endDate);
                endInput.dataset.userEdited = "false";
            }
            return false;
        }

        applySimulationRange(startDate, endDate);
        if (startInput) {
            startInput.dataset.userEdited = "false";
        }
        if (endInput) {
            endInput.dataset.userEdited = "false";
        }
        setSimulationMode(SIMULATION_MODE_RANGE);
        return true;
    };

    root.querySelector("#simStartInput")?.addEventListener("input", async (event) => {
        const input = event.currentTarget;
        if (input) {
            input.dataset.userEdited = "true";
        }
        await tryApplySimulationRangeFromInputs();
    });

    root.querySelector("#simEndInput")?.addEventListener("input", async (event) => {
        const input = event.currentTarget;
        if (input) {
            input.dataset.userEdited = "true";
        }
        await tryApplySimulationRangeFromInputs();
    });

    root.querySelector("#simPlayPauseBtn")?.addEventListener("click", () => {
        simulationState.isPlaying = !simulationState.isPlaying;
        simulationState.rewind = false;
        simulationState.lastTickTimestamp = Date.now();
        refreshSimulationControlsUi();
        updateTopToolbarTime();
    });

    root.querySelector("#simStopBtn")?.addEventListener("click", () => {
        simulationState.isPlaying = false;
        simulationState.rewind = false;
        simulationState.lastTickTimestamp = Date.now();
        refreshSimulationControlsUi();
        updateTopToolbarTime();
    });

    root.querySelector("#simRestartBtn")?.addEventListener("click", () => {
        if (simulationState.mode === SIMULATION_MODE_RANGE) {
            simulationState.currentDate = new Date(simulationState.startDate);
        } else {
            simulationState.currentDate = new Date();
        }
        simulationState.isPlaying = false;
        simulationState.rewind = false;
        simulationState.lastTickTimestamp = Date.now();
        applySimulationDateToViewer(simulationState.currentDate);
        refreshSimulationControlsUi();
        updateTopToolbarTime();
    });

    root.querySelectorAll(".sim-speed-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const nextSpeed = Number(btn.getAttribute("data-speed")) || 1;
            simulationState.speed = nextSpeed;
            simulationState.lastTickTimestamp = Date.now();
            refreshSimulationControlsUi();
            updateTopToolbarTime();
        });
    });

    root.querySelector("#simTimeline")?.addEventListener("input", (event) => {
        const rawValue = Number(event.target?.value);
        const ratio = clamp(rawValue / SIMULATION_TIMELINE_STEPS, 0, 1);
        simulationState.currentDate = getDateFromTimelineRatio(ratio);
        simulationState.isPlaying = false;
        if (simulationState.mode === SIMULATION_MODE_REALTIME) {
            simulationState.mode = SIMULATION_MODE_RANGE;
        }
        applySimulationDateToViewer(simulationState.currentDate);
        refreshSimulationControlsUi();
        updateTopToolbarTime();
    });

    const leftSatellitesPanel = document.getElementById("leftSatellitesPanel");
    const leftInfoPanel = document.getElementById("leftInfoPanel");
    if (leftSatellitesPanel || leftInfoPanel) {
        simulationLayoutObserver = new MutationObserver(() => {
            updateSimulationDockLayout();
        });
        if (leftSatellitesPanel) {
            simulationLayoutObserver.observe(leftSatellitesPanel, { attributes: true, attributeFilter: ["class"] });
        }
        if (leftInfoPanel) {
            simulationLayoutObserver.observe(leftInfoPanel, { attributes: true, attributeFilter: ["class"] });
        }
    }

    refreshSimulationControlsUi();
    return root;
}

function ensureTimeHudWidget() {
    if (timeHudWidget) {
        return timeHudWidget;
    }

    const root = document.createElement("div");
    root.id = "timeHudWidget";
    root.innerHTML = `
        <div class="time-hud-row"><span class="time-hud-label"></span><span id="timeHudNow">--/--/---- --:--:--</span></div>
    `;

    document.body.appendChild(root);
    timeHudWidget = root;
    updateTimeHudLabel();
    return root;
}

function updateTimeHudLabel() {
    const timeHudLabel = document.querySelector(".time-hud-label");
    if (timeHudLabel) {
        timeHudLabel.textContent = uiText("timeLabel");
    }
}

function updateTimeHudWidget() {
    const root = ensureTimeHudWidget();
    const nowEl = root.querySelector("#timeHudNow");
    if (!nowEl) {
        return;
    }

    const now = new Date();
    nowEl.textContent = formatTimeHudDate(now);
}

function applyTimeHudVisibilityConfig(systemConfig) {
    const widget = ensureTimeHudWidget();
    const visible = systemConfig.log_show_top_clock !== false;
    widget.style.display = visible ? "grid" : "none";
}

function updateSessionRecordButtonLabel(options = {}) {
    const button = ensureSessionRecordButton();
    const isProcessing = options.processing === true;

    if (isProcessing) {
        button.textContent = "...";
        button.disabled = true;
        button.classList.remove("idle", "recording");
        button.classList.add("processing");
        button.setAttribute("aria-label", uiText("recordSessionProcessing"));
        button.title = uiText("recordSessionProcessingTitle");
        return;
    }

    button.disabled = false;
    button.classList.remove("processing");

    if (isSessionRecording) {
        button.textContent = "Ⅱ";
        button.classList.remove("idle");
        button.classList.add("recording");
        button.setAttribute("aria-label", uiText("recordingInProgress"));
        button.title = uiText("recordSessionStop");
        return;
    }

    button.textContent = "●";
    button.classList.remove("recording");
    button.classList.add("idle");
    button.setAttribute("aria-label", uiText("recordSessionStart"));
    button.title = uiText("recordSessionStart");
}

function uiText(key) {
    const lang = currentUiLanguage === "en" ? "en" : "es";
    return UI_TEXT[lang]?.[key] || UI_TEXT.es[key] || key;
}

function getToolbarScopeLabel() {
    return selectedSatelliteId ? uiText("selectedScope") : uiText("globalScope");
}

function applyUiTheme(theme) {
    currentUiTheme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = currentUiTheme;
    localStorage.setItem("orbit-theme", currentUiTheme);
}

function applyUiLanguage(language) {
    currentUiLanguage = language === "en" ? "en" : "es";
    document.documentElement.lang = currentUiLanguage;
    document.title = "Orbit Tracker";
    localStorage.setItem("orbit-language", currentUiLanguage);
    updateTimeHudLabel();
    updateSessionRecordButtonLabel();
    updateCameraModeToggleTitle();
    updateQuickToolbarLabels();
    updateSatelliteContextMenuLang();
    updateSatelliteVizModalLang();
    setupTopSearchAutocomplete();
    refreshSimulationControlsUi();
}

function persistSystemSectionPatch(sectionName, patch) {
    if (typeof updatePersistedSystemConfig === "function") {
        updatePersistedSystemConfig(sectionName, patch);
    }
}

function getOrbitToggleState(kind) {
    const selectedConfig = selectedSatelliteId ? getSatelliteVisualizationConfig(selectedSatelliteId) : null;
    const effectiveKey = kind === "ground" ? "orbit_ground_track_show" : (kind === "future" ? "orbit_future_show" : "orbit_past_show");

    if (selectedConfig) {
        return Boolean(selectedConfig.effective[effectiveKey]);
    }

    return Boolean(runtimeSystemConfig?.[effectiveKey]);
}

function setOrbitVisibilityFromToolbar(kind) {
    const currentValue = getOrbitToggleState(kind);
    const nextValue = !currentValue;
    const overrideKey = kind === "ground" ? "orbit_ground_track_show" : (kind === "future" ? "orbit_future_show" : "orbit_past_show");
    const globalKey = kind === "ground" ? "ground_track_show" : (kind === "future" ? "future_show" : "past_show");

    if (selectedSatelliteId) {
        setSatelliteVisualizationConfig(selectedSatelliteId, {
            [overrideKey]: nextValue
        });
    } else {
        persistSystemSectionPatch("orbit", {
            [globalKey]: nextValue
        });
    }

    updateQuickToolbarLabels();
    updateTopToolbarState();
}

function togglePresentationMode() {
    presentationModeActive = !presentationModeActive;
    document.body.classList.toggle("presentation-mode", presentationModeActive);
    updateQuickToolbarLabels();
    updateTopToolbarState();
}

function toggleUiThemeFromToolbar() {
    const nextTheme = currentUiTheme === "light" ? "dark" : "light";
    applyUiTheme(nextTheme);
    persistSystemSectionPatch("ui", { theme: nextTheme });
    updateQuickToolbarLabels();
    updateTopToolbarState();
}

function initUiTheme() {
    const savedTheme = localStorage.getItem("orbit-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
        applyUiTheme(savedTheme);
    } else {
        applyUiTheme("dark");
    }
}

function initUiLanguage() {
    const savedLanguage = localStorage.getItem("orbit-language");
    if (savedLanguage === "en" || savedLanguage === "es") {
        currentUiLanguage = savedLanguage;
        document.documentElement.lang = currentUiLanguage;
    } else {
        currentUiLanguage = "es";
        document.documentElement.lang = "es";
    }
}

function setQuickButtonState(button, enabled) {
    if (!button) {
        return;
    }

    button.classList.toggle("enabled", Boolean(enabled));
    button.classList.toggle("blocked", !enabled);
}

function updateQuickToolbarLabels() {
    if (!quickToolbarRoot) {
        return;
    }

    const toggle = quickToolbarRoot.querySelector("#quickToolbarToggle");
    if (toggle) {
        toggle.title = uiText("toolbarToggle");
        toggle.setAttribute("aria-label", uiText("toolbarToggle"));
    }

    const scope = quickToolbarRoot.querySelector("#quickToolbarScope");
    if (scope) {
        scope.textContent = selectedSatelliteId ? `${getToolbarScopeLabel()}: ${selectedSatelliteId}` : getToolbarScopeLabel();
    }

    const future = quickToolbarRoot.querySelector("#quickToggleFutureBtn");
    if (future) {
        future.textContent = uiText("future");
        setQuickButtonState(future, getOrbitToggleState("future"));
    }
    const past = quickToolbarRoot.querySelector("#quickTogglePastBtn");
    if (past) {
        past.textContent = uiText("past");
        setQuickButtonState(past, getOrbitToggleState("past"));
    }
    const presentation = quickToolbarRoot.querySelector("#quickPresentationBtn");
    if (presentation) {
        presentation.textContent = uiText("presentation");
        presentation.classList.toggle("active", presentationModeActive);
        setQuickButtonState(presentation, presentationModeActive);
    }
    const ground = quickToolbarRoot.querySelector("#quickGroundTrackBtn");
    if (ground) {
        ground.textContent = uiText("ground");
        setQuickButtonState(ground, getOrbitToggleState("ground"));
    }

    updateSessionRecordButtonLabel();
}

function ensureTopToolbar() {
    // Asegurar que la clase esté siempre presente
    document.body.classList.add("with-toolbars");
    
    const existing = document.getElementById("topToolbar");
    if (existing) return existing;

    const toolbar = document.createElement("div");
    toolbar.id = "topToolbar";
    toolbar.innerHTML = `
        <div class="toolbar-brand">ORBIT</div>
        <button id="topConfigBtn" class="toolbar-btn" type="button" title="Configuración">
            <span>⚙</span>
            <span>Config</span>
        </button>
        <button id="topCameraModeBtn" class="toolbar-btn" type="button" title="Modo de cámara">
            <span>🎥</span>
            <span>Camera</span>
        </button>
        <div class="toolbar-separator"></div>
        <button id="topGroundBtn" class="toolbar-btn" type="button" title="Traza de suelo">Ground</button>
        <button id="topSimCtrlBtn" class="toolbar-btn" type="button" title="Panel temporal">
            <span>⏱</span>
            <span>Tiempo</span>
        </button>
        <div class="toolbar-separator"></div>
        <button id="topRecordBtn" class="toolbar-btn" type="button" title="Grabar sesión">
            <span>●</span>
            <span>Grabar</span>
        </button>
        <div class="toolbar-spacer"></div>
        <div class="toolbar-search-wrap">
            <span class="toolbar-search-icon">🔍</span>
            <input id="objectSearch" class="toolbar-search" type="text" placeholder="Buscar satélite..." autocomplete="off" spellcheck="false" />
            <div id="topSearchSuggestions"></div>
        </div>
        <div class="toolbar-spacer"></div>
        <div class="toolbar-time-wrap">
            <div id="topTimeInfo" class="toolbar-info">--/--/---- --:--:--</div>
        </div>
    `;

    document.body.appendChild(toolbar);
    document.body.classList.add("with-toolbars");

    toolbar.querySelector("#topConfigBtn")?.addEventListener("click", () => {
        if (runtimeConfigPanelApi?.toggle) {
            runtimeConfigPanelApi.toggle();
        }
    });

    toolbar.querySelector("#topCameraModeBtn")?.addEventListener("click", () => {
        const nextMode = cameraNavigationMode === "centered" ? "free" : "centered";
        applyCameraNavigationMode(nextMode);
        updateTopToolbarState();
    });

    toolbar.querySelector("#topGroundBtn")?.addEventListener("click", () => {
        setOrbitVisibilityFromToolbar("ground");
        updateTopToolbarState();
    });

    toolbar.querySelector("#topSimCtrlBtn")?.addEventListener("click", () => {
        toggleSimulationDock();
    });

    toolbar.querySelector("#topRecordBtn")?.addEventListener("click", () => {
        toggleSessionRecording();
    });

    setupTopSearchAutocomplete();

    updateTopToolbarState();
    updateTopToolbarTime();
    return toolbar;
}

function updateTopToolbarState() {
    const toolbar = document.getElementById("topToolbar");
    if (!toolbar) return;

    const groundBtn = toolbar.querySelector("#topGroundBtn");
    const simCtrlBtn = toolbar.querySelector("#topSimCtrlBtn");
    const recordBtn = toolbar.querySelector("#topRecordBtn");
    const cameraModeBtn = toolbar.querySelector("#topCameraModeBtn");

    if (groundBtn) {
        groundBtn.classList.toggle("active", getOrbitToggleState("ground"));
    }
    if (simCtrlBtn) {
        simCtrlBtn.classList.toggle("active", simulationDockOpen);
        simCtrlBtn.title = uiText("simPanelToggle");
    }
    if (recordBtn) {
        recordBtn.classList.toggle("recording", isSessionRecording);
        const recordIcon = recordBtn.querySelector("span:first-child");
        const recordText = recordBtn.querySelector("span:last-child");
        if (isSessionRecording) {
            if (recordIcon) recordIcon.textContent = "⏸";
            if (recordText) recordText.textContent = "Detener";
        } else {
            if (recordIcon) recordIcon.textContent = "●";
            if (recordText) recordText.textContent = "Grabar";
        }
    }
    if (cameraModeBtn) {
        const modeText = cameraModeBtn.querySelector("span:last-child");
        if (modeText) {
            modeText.textContent = cameraNavigationMode === "free" ? "Libre" : "Centrado";
        }
    }
}

function updateTopToolbarTime() {
    const timeInfo = document.getElementById("topTimeInfo");
    if (timeInfo) {
        const current = getDisplayedSimulationDate();
        const speedLabel = simulationState.mode === SIMULATION_MODE_REALTIME
            ? ""
            : ` · x${simulationState.speed}${simulationState.isPlaying ? "" : " (pausa)"}`;
        timeInfo.textContent = `${formatTimeHudDate(current)} · ${getSimulationModeLabel()}${speedLabel}`;
    }

    updateSimulationTimelineUi();
}

function ensureLeftSidebar() {
    // Asegurar que la clase esté siempre presente
    document.body.classList.add("with-toolbars");
    
    const existing = document.getElementById("leftSidebar");
    if (existing) return existing;

    const sidebar = document.createElement("div");
    sidebar.id = "leftSidebar";
    sidebar.innerHTML = `
        <button id="leftSatellitesBtn" class="sidebar-btn" type="button" title="Satélites" aria-label="Satélites">
            <span>🛰</span>
        </button>
        <button id="leftInfoBtn" class="sidebar-btn" type="button" title="Telemetría" aria-label="Telemetría">
            <span>ℹ</span>
        </button>
        <button id="leftViewBtn" class="sidebar-btn" type="button" title="Vista" aria-label="Vista">
            <span>👁</span>
        </button>
        <div class="sidebar-spacer"></div>
        <button id="leftSettingsBtn" class="sidebar-btn" type="button" title="Configuración" aria-label="Configuración">
            <span>⚙</span>
        </button>
    `;

    document.body.appendChild(sidebar);

    // Los paneles se anexan directamente al body (fuera del sidebar de iconos)
    // para evitar que queden contenidos/comprimidos dentro de los 48px.
    const satellitesPanel = document.createElement("div");
    satellitesPanel.id = "leftSatellitesPanel";
    satellitesPanel.className = "sidebar-panel";
    satellitesPanel.innerHTML = `
        <div class="sidebar-panel-header">
            <div class="sidebar-panel-title">LAYERS</div>
            <div class="sidebar-panel-actions">
                <button class="object-global-remove-btn" id="removeAllLayersHeaderBtn" type="button" title="Quitar todas las capas" aria-label="Quitar todas las capas">✕</button>
                <button class="object-global-eye-btn" id="toggleAllVisibilityBtn" type="button" title="Ocultar todas las capas" aria-label="Ocultar todas las capas">👁</button>
                <button class="object-add-btn" id="openCatalogBtn" type="button" title="Añadir capa" aria-label="Añadir capa">+</button>
                <button class="sidebar-panel-close" type="button" title="Plegar panel" aria-label="Plegar panel">‹</button>
            </div>
        </div>
        <div id="leftSatellitesPanelContent" class="sidebar-panel-content"></div>
    `;
    document.body.appendChild(satellitesPanel);

    // Panel de telemetría (pestaña separada)
    const infoPanel = document.createElement("div");
    infoPanel.id = "leftInfoPanel";
    infoPanel.className = "sidebar-panel";
    infoPanel.innerHTML = `
        <div class="sidebar-panel-header">
            <div class="sidebar-panel-title">TELEMETRÍA</div>
            <button class="sidebar-panel-close" type="button" aria-label="Cerrar">✕</button>
        </div>
        <div id="leftInfoPanelContent" class="sidebar-panel-content"></div>
    `;
    document.body.appendChild(infoPanel);

    const satellitesBtn = sidebar.querySelector("#leftSatellitesBtn");
    const infoBtn = sidebar.querySelector("#leftInfoBtn");

    // Registro de paneles para gestionarlos como acordeón (solo uno abierto)
    const panels = [
        { btn: satellitesBtn, panel: satellitesPanel },
        { btn: infoBtn, panel: infoPanel }
    ];

    const setActivePanel = (target) => {
        const willOpen = !target.panel.classList.contains("open");
        panels.forEach(({ btn, panel }) => {
            const isTarget = panel === target.panel;
            const open = isTarget && willOpen;
            panel.classList.toggle("open", open);
            btn.classList.toggle("active", open);
        });
    };

    satellitesBtn?.addEventListener("click", () => setActivePanel(panels[0]));
    infoBtn?.addEventListener("click", () => setActivePanel(panels[1]));

    satellitesPanel.querySelector(".sidebar-panel-close")?.addEventListener("click", () => {
        satellitesPanel.classList.remove("open");
        satellitesBtn.classList.remove("active");
    });

    infoPanel.querySelector(".sidebar-panel-close")?.addEventListener("click", () => {
        infoPanel.classList.remove("open");
        infoBtn.classList.remove("active");
    });

    sidebar.querySelector("#leftViewBtn")?.addEventListener("click", () => {
        showAppAlert("Panel de vista próximamente disponible.", "Vista");
    });

    sidebar.querySelector("#leftSettingsBtn")?.addEventListener("click", () => {
        if (runtimeConfigPanelApi?.toggle) {
            runtimeConfigPanelApi.toggle();
        }
    });

    return sidebar;
}

function ensureQuickToolbar() {
    if (quickToolbarRoot) {
        return quickToolbarRoot;
    }

    const root = document.createElement("div");
    root.id = "quickToolbar";
    root.className = "quick-toolbar collapsed";
    root.style.display = "none";
    root.innerHTML = `
        <button id="quickToolbarToggle" class="quick-toolbar-toggle" type="button" aria-expanded="false">☰</button>
        <div id="quickToolbarPanel" class="quick-toolbar-panel">
            <div id="quickToolbarScope" class="quick-toolbar-scope">Global</div>
            <button id="quickToggleFutureBtn" class="quick-tool-btn" type="button"></button>
            <button id="quickTogglePastBtn" class="quick-tool-btn" type="button"></button>
            <button id="quickPresentationBtn" class="quick-tool-btn" type="button"></button>
            <button id="quickGroundTrackBtn" class="quick-tool-btn" type="button"></button>
            <span id="quickRecordSlot" class="quick-record-slot"></span>
        </div>
    `;

    document.body.appendChild(root);
    quickToolbarRoot = root;
    quickToolbarPanel = root.querySelector("#quickToolbarPanel");

    const toggle = root.querySelector("#quickToolbarToggle");
    toggle.addEventListener("click", () => {
        const collapsed = root.classList.toggle("collapsed");
        toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
    root.querySelector("#quickToggleFutureBtn")?.addEventListener("click", () => setOrbitVisibilityFromToolbar("future"));
    root.querySelector("#quickTogglePastBtn")?.addEventListener("click", () => setOrbitVisibilityFromToolbar("past"));
    root.querySelector("#quickPresentationBtn")?.addEventListener("click", togglePresentationMode);
    root.querySelector("#quickGroundTrackBtn")?.addEventListener("click", () => setOrbitVisibilityFromToolbar("ground"));

    updateQuickToolbarLabels();
    return root;
}

function setCurrentSelectedSatellite(id) {
    selectedSatelliteId = id ? String(id) : null;
    updateQuickToolbarLabels();
    updateSelectedEpochInfo();
}

function resolveSupportedRecordingMimeType(preferredOutputFormat = "webm") {
    if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
        return "";
    }

    const webmCandidates = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm"
    ];

    const mp4Candidates = [
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/mp4"
    ];

    const preferred = String(preferredOutputFormat || "webm").toLowerCase() === "mp4"
        ? [...mp4Candidates, ...webmCandidates]
        : [...webmCandidates, ...mp4Candidates];

    for (const candidate of preferred) {
        if (MediaRecorder.isTypeSupported(candidate)) {
            return candidate;
        }
    }

    return "";
}

function getRecordingProfile(quality) {
    const normalized = String(quality || "medium").toLowerCase();
    if (normalized === "low") {
        return { frameRate: 24, videoBitsPerSecond: 4500000 };
    }
    if (normalized === "high") {
        return { frameRate: 60, videoBitsPerSecond: 18000000 };
    }
    return { frameRate: 30, videoBitsPerSecond: 9000000 };
}

function ensureAppDialog() {
    if (appDialogRoot) {
        return;
    }

    const modal = document.createElement("div");
    modal.id = "appDialogModal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
        <div id="appDialogPanel" role="dialog" aria-modal="true" aria-labelledby="appDialogTitle" aria-describedby="appDialogMessage">
            <h4 id="appDialogTitle">Aviso</h4>
            <p id="appDialogMessage"></p>
            <div id="appDialogActions">
                <button id="appDialogCancel" type="button">Cancelar</button>
                <button id="appDialogConfirm" type="button">Aceptar</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    appDialogRoot = modal;
    appDialogTitle = modal.querySelector("#appDialogTitle");
    appDialogMessage = modal.querySelector("#appDialogMessage");
    appDialogConfirmBtn = modal.querySelector("#appDialogConfirm");
    appDialogCancelBtn = modal.querySelector("#appDialogCancel");
}

function openAppDialog({ title, message, showCancel }) {
    ensureAppDialog();

    return new Promise((resolve) => {
        const cleanup = () => {
            appDialogRoot.classList.remove("open");
            appDialogRoot.setAttribute("aria-hidden", "true");
            appDialogConfirmBtn.removeEventListener("click", onConfirm);
            appDialogCancelBtn.removeEventListener("click", onCancel);
            appDialogRoot.removeEventListener("click", onBackdropClick);
            document.removeEventListener("keydown", onKeyDown);
        };

        const onConfirm = () => {
            cleanup();
            resolve(true);
        };

        const onCancel = () => {
            cleanup();
            resolve(false);
        };

        const onBackdropClick = (event) => {
            if (event.target === appDialogRoot) {
                onCancel();
            }
        };

        const onKeyDown = (event) => {
            if (event.key === "Escape") {
                onCancel();
            }
        };

        appDialogTitle.textContent = title || "Aviso";
        appDialogMessage.textContent = message || "";
        appDialogCancelBtn.style.display = showCancel ? "inline-flex" : "none";
        appDialogConfirmBtn.textContent = showCancel ? "Guardar" : "Aceptar";

        appDialogRoot.classList.add("open");
        appDialogRoot.setAttribute("aria-hidden", "false");

        appDialogConfirmBtn.addEventListener("click", onConfirm);
        appDialogCancelBtn.addEventListener("click", onCancel);
        appDialogRoot.addEventListener("click", onBackdropClick);
        document.addEventListener("keydown", onKeyDown);

        appDialogConfirmBtn.focus();
    });
}

function showAppAlert(message, title = uiText("alertTitle")) {
    return openAppDialog({ title, message, showCancel: false });
}

function showAppConfirm(message, title = uiText("confirmTitle")) {
    return openAppDialog({ title, message, showCancel: true });
}

function hideSatelliteContextMenu() {
    if (!satelliteContextMenu) {
        return;
    }
    satelliteContextMenu.classList.remove("open");
    satelliteContextMenuTargetId = null;
}

function ensureSatelliteContextMenu() {
    if (satelliteContextMenu) {
        return satelliteContextMenu;
    }

    const menu = document.createElement("div");
    menu.id = "satelliteContextMenu";
    menu.innerHTML = `<button id="satCtxVizBtn" type="button">${uiText("vizOptions")}</button>`;
    document.body.appendChild(menu);

    const vizButton = menu.querySelector("#satCtxVizBtn");
    vizButton.addEventListener("click", () => {
        const satId = satelliteContextMenuTargetId;
        hideSatelliteContextMenu();
        if (satId) {
            openSatelliteVisualizationModal(satId);
        }
    });

    satelliteContextMenu = menu;

    document.addEventListener("click", (event) => {
        if (!satelliteContextMenu?.classList.contains("open")) {
            return;
        }
        if (!satelliteContextMenu.contains(event.target)) {
            hideSatelliteContextMenu();
        }
    });

    window.addEventListener("resize", () => hideSatelliteContextMenu());
    window.addEventListener("scroll", () => hideSatelliteContextMenu(), { passive: true });

    return satelliteContextMenu;
}

function updateSatelliteContextMenuLang() {
    const vizButton = satelliteContextMenu?.querySelector("#satCtxVizBtn");
    if (vizButton) {
        vizButton.textContent = uiText("vizOptions");
    }
}

function showSatelliteContextMenuAt(satelliteId, x, y) {
    const menu = ensureSatelliteContextMenu();
    satelliteContextMenuTargetId = satelliteId;

    const viewportPadding = 10;
    const estimatedWidth = 230;
    const estimatedHeight = 44;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - estimatedWidth - viewportPadding);
    const maxTop = Math.max(viewportPadding, window.innerHeight - estimatedHeight - viewportPadding);
    const safeLeft = Math.min(Math.max(viewportPadding, x), maxLeft);
    const safeTop = Math.min(Math.max(viewportPadding, y), maxTop);

    menu.style.left = `${safeLeft}px`;
    menu.style.top = `${safeTop}px`;
    menu.classList.add("open");
}

function ensureSatelliteVisualizationModal() {
    if (satelliteVizModal) {
        return satelliteVizModal;
    }

    const modal = document.createElement("div");
    modal.id = "satelliteVizModal";
    modal.innerHTML = `
        <div id="satelliteVizPanel" role="dialog" aria-modal="true" aria-labelledby="satelliteVizTitle">
            <div id="satelliteVizHeader">
                <h4 id="satelliteVizTitle"></h4>
                <button id="satelliteVizCloseBtn" type="button" aria-label="${uiText("closeBtn")}"></button>
            </div>
            <div id="satelliteVizTarget"></div>
            <div id="satelliteVizForm" class="config-grid">
                <div class="config-field"><label for="satVizFutureColor">Future Color</label><input id="satVizFutureColor" type="color"></div>
                <div class="config-field" id="satVizFieldPastColor"><label for="satVizPastColor">Past Color</label><input id="satVizPastColor" type="color"></div>
                <div class="config-field"><label for="satVizFutureLineWidth">Future Line Width</label><input id="satVizFutureLineWidth" type="number" step="0.1" min="0.1"></div>
                <div class="config-field" id="satVizFieldPastLineWidth"><label for="satVizPastLineWidth">Past Line Width</label><input id="satVizPastLineWidth" type="number" step="0.1" min="0.1"></div>
                <div class="config-field" id="satVizFieldPropagationHours"><label for="satVizPropagationHours">Propagation Hours</label><input id="satVizPropagationHours" type="number" step="0.1" min="0" max="240"></div>
                <div class="config-field" id="satVizFieldPastSeconds"><label for="satVizPastSeconds">Past Duration (s)</label><input id="satVizPastSeconds" type="number" step="0.1" min="0" max="86400"></div>
                <div class="config-field"><label for="satVizLabelSize">Label Size (px)</label><input id="satVizLabelSize" type="number" step="1" min="0"></div>
                <div class="config-field"><label for="satVizModelScale">Model Scale</label><input id="satVizModelScale" type="number" step="1" min="0.000001"></div>
                <div class="config-field checkbox"><input id="satVizUse3D" type="checkbox"><label for="satVizUse3D">Use 3D Model</label></div>
                <div class="config-field"><label for="satVizSizeMode">Size Mode</label><select id="satVizSizeMode"><option value="visual">visual</option><option value="physical">physical</option></select></div>
                <div class="config-field checkbox"><input id="satVizFutureShow" type="checkbox"><label for="satVizFutureShow">Future Show</label></div>
                <div class="config-field checkbox" id="satVizFieldPastShow"><input id="satVizPastShow" type="checkbox"><label for="satVizPastShow">Past Show</label></div>
            </div>
            <div id="satelliteVizActions">
                <button id="satelliteVizResetBtn" type="button"></button>
                <button id="satelliteVizApplyBtn" type="button"></button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    satelliteVizModal = modal;

    updateSatelliteVizModalLang();

    const closeButton = modal.querySelector("#satelliteVizCloseBtn");
    closeButton.addEventListener("click", () => closeSatelliteVisualizationModal());
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            closeSatelliteVisualizationModal();
        }
    });

    modal.querySelector("#satelliteVizApplyBtn").addEventListener("click", () => {
        if (!satelliteVizCurrentTargetId) {
            return;
        }

        const entryMeta = getCatalogEntryMeta(satelliteVizCurrentTargetId) || null;
        const sourceFormat = String(entryMeta?.sourceFormat || "TLE").toUpperCase();
        const isOem = sourceFormat === "OEM";
        const oemDomainActive = hasLoadedOemEphemerisTracks()
            || Boolean(getLoadedOemEphemerisTimeBounds())
            || simulationControlRoot?.querySelector("#simDomainIndicator")?.classList.contains("is-oem") === true;
        const hidePastAndPropagation = isOem || oemDomainActive;

        const patch = {
            orbit_future_color: modal.querySelector("#satVizFutureColor").value,
            orbit_past_color: hidePastAndPropagation ? null : modal.querySelector("#satVizPastColor").value,
            orbit_future_line_width: Number(modal.querySelector("#satVizFutureLineWidth").value),
            orbit_past_line_width: hidePastAndPropagation ? null : Number(modal.querySelector("#satVizPastLineWidth").value),
            propagation_hours: hidePastAndPropagation ? null : Number(modal.querySelector("#satVizPropagationHours").value),
            orbit_past_seconds: hidePastAndPropagation ? null : Number(modal.querySelector("#satVizPastSeconds").value),
            satellite_label_size_px: Number(modal.querySelector("#satVizLabelSize").value),
            satellite_model_scale: Number(modal.querySelector("#satVizModelScale").value),
            satellite_use_3d_model: modal.querySelector("#satVizUse3D").checked,
            satellite_size_mode: modal.querySelector("#satVizSizeMode").value,
            orbit_future_show: modal.querySelector("#satVizFutureShow").checked,
            orbit_past_show: hidePastAndPropagation ? null : modal.querySelector("#satVizPastShow").checked
        };

        setSatelliteVisualizationConfig(satelliteVizCurrentTargetId, patch);
        closeSatelliteVisualizationModal();
    });

    modal.querySelector("#satelliteVizResetBtn").addEventListener("click", () => {
        if (!satelliteVizCurrentTargetId) {
            return;
        }
        clearSatelliteVisualizationConfig(satelliteVizCurrentTargetId);
        closeSatelliteVisualizationModal();
    });

    return modal;
}

function updateSatelliteVizModalLang() {
    if (!satelliteVizModal) return;
    const titleEl = satelliteVizModal.querySelector("#satelliteVizTitle");
    if (titleEl) titleEl.textContent = uiText("vizOptions");
    const resetBtn = satelliteVizModal.querySelector("#satelliteVizResetBtn");
    if (resetBtn) resetBtn.textContent = uiText("satResetBtn");
    const applyBtn = satelliteVizModal.querySelector("#satelliteVizApplyBtn");
    if (applyBtn) applyBtn.textContent = uiText("applyBtn");
}

function closeSatelliteVisualizationModal() {
    if (!satelliteVizModal) {
        return;
    }
    satelliteVizModal.classList.remove("open");
    satelliteVizCurrentTargetId = null;
}

function openSatelliteVisualizationModal(satelliteId) {
    const modal = ensureSatelliteVisualizationModal();
    const config = getSatelliteVisualizationConfig(satelliteId);
    if (!config) {
        return;
    }

    const entryMeta = getCatalogEntryMeta(satelliteId) || null;
    const sourceFormat = String(entryMeta?.sourceFormat || "TLE").toUpperCase();
    const isOem = sourceFormat === "OEM";
    const oemDomainActive = hasLoadedOemEphemerisTracks()
        || Boolean(getLoadedOemEphemerisTimeBounds())
        || simulationControlRoot?.querySelector("#simDomainIndicator")?.classList.contains("is-oem") === true;
    const hidePastAndPropagation = isOem || oemDomainActive;

    satelliteVizCurrentTargetId = satelliteId;
    modal.querySelector("#satelliteVizTarget").textContent = `Satelite: ${satelliteId}`;

    const effective = config.effective;
    modal.querySelector("#satVizFutureColor").value = effective.orbit_future_color;
    modal.querySelector("#satVizPastColor").value = effective.orbit_past_color;
    modal.querySelector("#satVizFutureLineWidth").value = String(effective.orbit_future_line_width);
    modal.querySelector("#satVizPastLineWidth").value = String(effective.orbit_past_line_width);
    modal.querySelector("#satVizPropagationHours").value = String(effective.propagation_hours);
    modal.querySelector("#satVizPastSeconds").value = String(effective.orbit_past_seconds);
    modal.querySelector("#satVizLabelSize").value = String(effective.satellite_label_size_px);
    modal.querySelector("#satVizModelScale").value = String(effective.satellite_model_scale);
    modal.querySelector("#satVizUse3D").checked = effective.satellite_use_3d_model === true;
    modal.querySelector("#satVizSizeMode").value = effective.satellite_size_mode;
    modal.querySelector("#satVizFutureShow").checked = effective.orbit_future_show === true;
    modal.querySelector("#satVizPastShow").checked = effective.orbit_past_show === true;

    const oemOnlyHiddenFields = [
        "#satVizFieldPastColor",
        "#satVizFieldPastLineWidth",
        "#satVizFieldPropagationHours",
        "#satVizFieldPastSeconds",
        "#satVizFieldPastShow"
    ];

    const oemOnlyInputs = [
        "#satVizPastColor",
        "#satVizPastLineWidth",
        "#satVizPropagationHours",
        "#satVizPastSeconds",
        "#satVizPastShow"
    ];

    for (const selector of oemOnlyHiddenFields) {
        const field = modal.querySelector(selector);
        if (field) {
            field.hidden = hidePastAndPropagation;
            field.style.display = hidePastAndPropagation ? "none" : "";
        }
    }

    for (const selector of oemOnlyInputs) {
        const input = modal.querySelector(selector);
        if (!input) {
            continue;
        }
        const wrapper = input.closest(".config-field");
        if (wrapper) {
            wrapper.hidden = hidePastAndPropagation;
            wrapper.style.display = hidePastAndPropagation ? "none" : "";
        }
        input.disabled = hidePastAndPropagation;
    }

    modal.classList.add("open");
}

function buildSessionRecordingFilename(mimeType) {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const extension = mimeType.includes("mp4") ? "mp4" : "webm";
    return `orbit-session-${yyyy}${mm}${dd}-${hh}${min}${ss}.${extension}`;
}

function downloadSessionRecording(blob, mimeType) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = buildSessionRecordingFilename(mimeType || "video/webm");
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

function resetSessionRecordingState() {
    if (sessionRecordingStream) {
        for (const track of sessionRecordingStream.getTracks()) {
            track.stop();
        }
    }

    sessionRecordingStream = null;
    sessionRecorder = null;
    sessionRecordingChunks = [];
    isSessionRecording = false;
    updateSessionRecordButtonLabel();
}

async function startSessionRecording() {
    if (isSessionRecording) {
        return;
    }

    if (typeof MediaRecorder === "undefined") {
        await showAppAlert(uiText("recordingUnsupported"), uiText("recordingUnavailableTitle"));
        return;
    }

    const canvas = viewer?.scene?.canvas;
    if (!canvas || typeof canvas.captureStream !== "function") {
        await showAppAlert(uiText("recordingNoStream"), uiText("recordingErrorTitle"));
        return;
    }

    try {
        const quality = runtimeRecordingConfig.quality || "medium";
        const outputFormat = runtimeRecordingConfig.output_format || "webm";
        const profile = getRecordingProfile(quality);
        sessionRecordingStream = canvas.captureStream(profile.frameRate);
        const primaryVideoTrack = sessionRecordingStream.getVideoTracks?.()[0];
        if (primaryVideoTrack) {
            primaryVideoTrack.contentHint = "motion";
        }

        sessionRecordingChunks = [];
        sessionRecordingMimeType = resolveSupportedRecordingMimeType(outputFormat) || "video/webm";

        if (outputFormat === "mp4" && !sessionRecordingMimeType.includes("mp4")) {
            logger.warn("Formato mp4 no soportado por MediaRecorder en este navegador. Se usa webm.");
        }

        const recorderOptions = sessionRecordingMimeType
            ? {
                mimeType: sessionRecordingMimeType,
                videoBitsPerSecond: profile.videoBitsPerSecond
            }
            : {
                videoBitsPerSecond: profile.videoBitsPerSecond
            };

        sessionRecorder = new MediaRecorder(sessionRecordingStream, recorderOptions);

        sessionRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                sessionRecordingChunks.push(event.data);
            }
        };

        sessionRecorder.onstop = async () => {
            const chunks = sessionRecordingChunks.slice();
            const mimeType = sessionRecordingMimeType || "video/webm";
            resetSessionRecordingState();

            if (!chunks.length) {
                showAppAlert(uiText("recordingEmpty"), uiText("recordingEmptyTitle"));
                return;
            }

            const recordingBlob = new Blob(chunks, { type: mimeType });
            const shouldSave = await showAppConfirm(uiText("sessionSaveQuestion"), uiText("sessionSaveTitle"));

            if (shouldSave) {
                downloadSessionRecording(recordingBlob, mimeType);
                logger.info("Grabacion de sesion descargada.");
            } else {
                logger.info("Grabacion de sesion descartada por el usuario.");
            }
        };

        sessionRecorder.onerror = (event) => {
            logger.error("Error en MediaRecorder:", event);
            showAppAlert(uiText("recordingError"), uiText("recordingErrorTitle"));
            resetSessionRecordingState();
        };

        sessionRecorder.start(1000);
        isSessionRecording = true;
        updateSessionRecordButtonLabel();
        updateTopToolbarState();
        logger.info("Grabacion de sesion iniciada.");
    } catch (error) {
        logger.error("No se pudo iniciar la grabacion de sesion:", error);
        const detail = error instanceof Error ? error.message : uiText("recordingStartError");
        await showAppAlert(detail, uiText("recordingErrorTitle"));
        resetSessionRecordingState();
    }
}

function stopSessionRecording() {
    if (!sessionRecorder || sessionRecorder.state !== "recording") {
        resetSessionRecordingState();
        return;
    }

    isSessionRecording = false;
    updateSessionRecordButtonLabel({ processing: true });
    updateTopToolbarState();
    sessionRecorder.stop();
    logger.info("Deteniendo grabacion de sesion...");
}

function toggleSessionRecording() {
    if (isSessionRecording) {
        stopSessionRecording();
        return;
    }

    startSessionRecording();
}

function updateCameraModeButtonLabel() {
    const button = ensureCameraModeToggleButton();
    const isFreeMode = cameraNavigationMode === "free";
    const navFree = uiText("navFree");
    const navCentered = uiText("navCentered");
    button.textContent = isFreeMode ? navFree : navCentered;
    button.classList.toggle("free", isFreeMode);
    button.classList.toggle("centered", !isFreeMode);
    button.title = isFreeMode
        ? uiText("navFreeDesc")
        : uiText("navCenteredDesc");
    button.setAttribute("aria-label", isFreeMode ? uiText("navFreeAria") : uiText("navCenteredAria"));
}

function applyCameraNavigationMode(mode, options = {}) {
    if (!viewer?.scene?.screenSpaceCameraController) {
        return;
    }

    const nextMode = mode === "free" ? "free" : "centered";
    const controller = viewer.scene.screenSpaceCameraController;

    controller.enableRotate = true;
    controller.enableTranslate = true;
    controller.enableZoom = true;
    controller.enableTilt = true;
    controller.enableLook = true;

    if (nextMode === "free") {
        if (!options.keepTrackedEntity) {
            viewer.trackedEntity = undefined;
        }
        controller.enableCollisionDetection = false;
        controller.minimumZoomDistance = 1.0;
        controller.maximumZoomDistance = 900000000.0;
        controller.constrainedAxis = undefined;
        controller.lookEventTypes = [Cesium.CameraEventType.LEFT_DRAG];
        controller.rotateEventTypes = [Cesium.CameraEventType.RIGHT_DRAG];
        controller.tiltEventTypes = [Cesium.CameraEventType.MIDDLE_DRAG];
        controller.zoomEventTypes = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];
        enableFreeCameraKeyboardControls();
        // Soltar cualquier transform de seguimiento para una camara totalmente libre.
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    } else {
        disableFreeCameraKeyboardControls();
        controller.enableCollisionDetection = true;
        controller.minimumZoomDistance = 1000.0;
        controller.maximumZoomDistance = 900000000.0;
        controller.lookEventTypes = [{ eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.SHIFT }];
        controller.rotateEventTypes = [Cesium.CameraEventType.LEFT_DRAG];
        controller.tiltEventTypes = [Cesium.CameraEventType.MIDDLE_DRAG];
        controller.zoomEventTypes = [Cesium.CameraEventType.RIGHT_DRAG, Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];
        // Mantener orientacion estable respecto al globo en modo centrado.
        controller.constrainedAxis = Cesium.Cartesian3.UNIT_Z;
    }

    cameraNavigationMode = nextMode;
    updateCameraModeButtonLabel();
    updateTopToolbarState();
    logger.info(`Modo de navegacion de camara: ${nextMode}`);
}

function setConfigSaveState(state, message) {
    if (runtimeConfigPanelApi && typeof runtimeConfigPanelApi.setSaveState === "function") {
        runtimeConfigPanelApi.setSaveState(state, message);
    }
}

function schedulePersistSystemConfig(nextSectionedSystemConfig) {
    const serialized = JSON.stringify(nextSectionedSystemConfig || {});
    if (serialized === lastPersistedSystemConfigSerialized) {
        setConfigSaveState("saved", uiText("configSavedState"));
        return;
    }

    setConfigSaveState("saving", uiText("configSaving"));

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
            setConfigSaveState("saved", `${uiText("configSavedState")} ${hh}:${mm}:${ss}`);
        } catch (error) {
            logger.error("No se pudo persistir system_config en servidor:", error);
            const detail = error instanceof Error ? error.message : String(error);
            const shortDetail = detail.length > 56 ? `${detail.slice(0, 56)}...` : detail;
            setConfigSaveState("error", `${uiText("configError")} (${shortDetail})`);
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
    nightImageryLayer.dayAlpha = 0.0;
    nightImageryLayer.nightAlpha = blendEnabled ? 1.0 : 0.0;
    nightImageryLayer.brightness = 1.2;
}

function applyEarthBaseLayers() {
    try {
        viewer.scene.imageryLayers.removeAll();
        viewer.scene.imageryLayers.addImageryProvider(localProvider);

        nightImageryLayer = viewer.scene.imageryLayers.addImageryProvider(nightProvider);
        nightImageryLayer.dayAlpha = 0.0;
        nightImageryLayer.nightAlpha = 1.0;
        nightImageryLayer.brightness = 1.2;
        logger.info("Capas de tierra cargadas (earth3km + noche)");
    } catch (e) {
        logger.error("No se pudo añadir capa base/local tiles:", e);
    }
}

function applySystemRuntimeConfig(systemConfigRaw) {
    initUiTheme();
    initUiLanguage();
    const systemConfig = normalizeSystemConfig(systemConfigRaw);
    runtimeSystemConfig = systemConfig;
    runtimeRecordingConfig = {
        quality: ["low", "medium", "high"].includes(systemConfig.recording_quality)
            ? systemConfig.recording_quality
            : "medium",
        output_format: systemConfig.recording_output_format === "mp4" ? "mp4" : "webm"
    };
    runtimeDecayAlertPerigeeKm = Number.isFinite(Number(systemConfig.decay_alert_perigee_km))
        ? Number(systemConfig.decay_alert_perigee_km)
        : 200;
    currentRuntimeDataConfig = {
        ...(currentRuntimeDataConfig || {}),
        decay_alert_perigee_km: runtimeDecayAlertPerigeeKm
    };

    configureLogger(systemConfig);
    setOrbitConfig(systemConfig);
    applyTimeHudVisibilityConfig(systemConfig);
    applyUiTheme(systemConfig.ui_theme || currentUiTheme);
    applyUiLanguage(systemConfig.ui_language || currentUiLanguage);

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

fetch("assets/earth2km_tiles/0/0/0.jpg", { cache: "no-cache" }).then((resp) => {
    earth2kmTilesAvailable = resp.ok;
    applyEarthBaseLayers();
}).catch(() => {
    earth2kmTilesAvailable = false;
    applyEarthBaseLayers();
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

applyCameraNavigationMode("centered", { keepTrackedEntity: true });

// Mantener quickToolbar oculto (legacy)
ensureQuickToolbar();

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

    if (cameraNavigationMode === "free") {
        applyCameraNavigationMode("centered", { keepTrackedEntity: true });
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

    if (cameraNavigationMode === "free") {
        applyCameraNavigationMode("centered", { keepTrackedEntity: true });
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
    const config = initialBootConfig || await loadConfig();
    const currentConfig = {
        ...(config || {}),
        system: toSectionedSystemConfig(config?.system || {})
    };
    currentRuntimeDataConfig = currentConfig?.data || { satellites_catalog_file: "catalog.json", offline_mode: false };
    lastPersistedSystemConfigSerialized = JSON.stringify(currentConfig.system || {});
    updatePersistedSystemConfig = (sectionName, patch) => {
        if (!sectionName || !patch || typeof patch !== "object") {
            return;
        }

        currentConfig.system = {
            ...currentConfig.system,
            [sectionName]: {
                ...(currentConfig.system?.[sectionName] || {}),
                ...patch
            }
        };

        runtimeConfigPanelApi?.setSystemConfig(currentConfig.system);
        applySystemRuntimeConfig(currentConfig.system);
        schedulePersistSystemConfig(currentConfig.system);
    };

    let objectSidebar = null;

    runtimeConfigPanelApi = setupRuntimeConfigPanel({
        initialSystemConfig: currentConfig.system,
        defaultSystemConfig: toSectionedSystemConfig({}),
        onSystemConfigChange: (nextSystemConfig) => {
            currentConfig.system = nextSystemConfig;
            applySystemRuntimeConfig(currentConfig.system);
            schedulePersistSystemConfig(currentConfig.system);
        },
        onApplyGlobalToAll: async () => {
            clearAllSatelliteVisualizationConfigs();
        },
        onResetSpecificConfig: async () => {
            clearAllSatelliteVisualizationConfigs();
        },
        getUiText: () => uiText
    });
    setConfigSaveState("idle", uiText("configSaved"));

    applySystemRuntimeConfig(currentConfig.system);

    // Inicializar toolbars después de setupRuntimeConfigPanel
    ensureTopToolbar();
    ensureLeftSidebar();
    ensureSimulationControlDock();
    setSimulationTimelineProvider(() => ({
        date: getDisplayedSimulationDate(),
        mode: simulationState.mode,
        rangeStart: simulationState.startDate,
        rangeEnd: simulationState.endDate
    }));
    setSimulationDockOpen(false);
    
    // Timer para actualizar la toolbar superior
    if (timeHudTimer) {
        clearInterval(timeHudTimer);
    }
    timeHudTimer = setInterval(() => {
        updateTopToolbarTime();
    }, 1000);

    if (simulationTickTimer) {
        clearInterval(simulationTickTimer);
    }
    simulationState.lastTickTimestamp = Date.now();
    simulationTickTimer = setInterval(() => {
        tickSimulationClock();
        refreshSimulationControlsUi();
    }, 120);

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
    
    // Obtener los contenedores de los paneles de la sidebar izquierda
    const satellitesPanelContent = document.getElementById("leftSatellitesPanelContent");
    const infoPanelContent = document.getElementById("leftInfoPanelContent");
    
    objectSidebar = setupObjectSidebar({
        getCatalogIds: () => getSatelliteIds(),
        fetchCatalogPage: (params) => fetchCatalogPage(params),
        getLayerIds: () => getCompositeLayerIds(),
        getObjectTelemetry: (id) => getCompositeLayerTelemetry(id),
        getObjectVisibility: (id) => getCompositeLayerVisibility(id),
        onToggleObjectVisibility: (id, visible) => setCompositeLayerVisibility(id, visible),
        getObjectLayerActive: (id) => isCompositeLayerActive(id),
        onToggleObjectLayer: (id, active) => setCompositeLayerActive(id, active),
        getMaxActiveLayers: () => getCompositeMaxLayers(),
        getAvailableLayerSlots: () => getCompositeAvailableLayerSlots(),
        onAddAllLayers: () => setAllSatelliteLayersActive(true),
        onRemoveAllLayers: () => {
            setAllSatelliteLayersActive(false);
            for (const stationId of [...groundStationLayers.keys()]) {
                removeGroundStationLayer(stationId);
            }
            satelliteDuplicateLayers.clear();
            layerDisplayNameOverrides.clear();
        },
        onShowAllObjects: () => {
            setAllSatellitesVisible(true);
            for (const stationId of groundStationLayers.keys()) {
                setCompositeLayerVisibility(stationId, true);
            }
        },
        onHideAllObjects: () => {
            setAllSatellitesVisible(false);
            for (const stationId of groundStationLayers.keys()) {
                setCompositeLayerVisibility(stationId, false);
            }
        },
        onFocusObject: (id) => {
            const entity = getCompositeLayerEntity(id);
            if (!entity) {
                return;
            }
            setCurrentSelectedSatellite(id);
            if (!isGroundStationLayerId(id)) {
                setSelectedOrbitSatelliteId(getSatelliteSourceIdFromLayerId(id));
            } else {
                setSelectedOrbitSatelliteId(null);
            }
            focusSatellite(entity);
        },
        onSelectObject: (id) => {
            const entity = getCompositeLayerEntity(id);
            if (!entity) {
                return;
            }
            setCurrentSelectedSatellite(id);
            if (!isGroundStationLayerId(id)) {
                setSelectedOrbitSatelliteId(getSatelliteSourceIdFromLayerId(id));
            } else {
                setSelectedOrbitSatelliteId(null);
            }
            viewer.selectedEntity = entity;
        },
        onOpenVisualizationOptions: (id) => {
            if (!id) {
                return;
            }
            if (isGroundStationLayerId(id)) {
                objectSidebar?.openGroundStationEditor?.(id);
                return;
            }
            const sourceId = getSatelliteSourceIdFromLayerId(id);
            if (!sourceId) {
                return;
            }
            openSatelliteVisualizationModal(sourceId);
        },
        onRequestAddSatellite: () => openLeftSatellitesPanel(),
        onRequestCreateGroundStation: (payload) => {
            const id = createGroundStationLayer(payload);
            if (!id) {
                return null;
            }
            openLeftSatellitesPanel();
            return id;
        },
        onRequestUpdateGroundStation: (id, payload) => updateGroundStationLayer(id, payload),
        onRequestDuplicateLayer: (id) => {
            if (isGroundStationLayerId(id)) {
                return null;
            }
            const sourceId = getSatelliteSourceIdFromLayerId(id);
            if (!sourceId) {
                return null;
            }
            return duplicateSatelliteLayer(sourceId);
        },
        onRequestRenameLayer: (id, newName) => renameLayer(id, newName),
        getLayerDisplayName: (id) => getLayerDisplayName(id),
        getLayerType: (id) => getLayerType(id),
        getGroundStationParams: (id) => getGroundStationParams(id),
        isCatalogReady: () => isCatalogLoaded(),
        getObjectTle: (id) => getSatelliteTle(getSatelliteSourceIdFromLayerId(id)),
        getObjectTleAsync: (id) => getSatelliteTleAsync(getSatelliteSourceIdFromLayerId(id)),
        getCatalogEntryMeta: (id) => getCompositeLayerMeta(id),
        onRefreshCatalog: () => refreshSatelliteCatalog(catalogUrl),
        getLoadedOemTimeBounds: () => getLoadedOemEphemerisTimeBounds(),
        onAlignToOemTimeDomain: () => {
            const bounds = getLoadedOemEphemerisTimeBounds();
            if (!bounds) {
                return false;
            }
            applySimulationRange(new Date(bounds.startTimeMs), new Date(bounds.endTimeMs));
            setSimulationMode(SIMULATION_MODE_RANGE);
            setSimulationDockOpen(true);
            return true;
        },
        onImportOemEphemeris: (content, fileName) => {
            const imported = importOemEphemerisTrack(content, fileName);
            const bounds = getLoadedOemEphemerisTimeBounds();
            if (bounds) {
                applySimulationRange(new Date(bounds.startTimeMs), new Date(bounds.endTimeMs));
            }
            setSimulationMode(SIMULATION_MODE_RANGE);
            setSimulationDockOpen(true);
            return imported;
        },
        getUiText: () => uiText,
        containerElement: satellitesPanelContent,
        infoContainerElement: infoPanelContent
    });

    if (stationHeatMapTimer) {
        clearInterval(stationHeatMapTimer);
    }
    stationHeatMapTimer = setInterval(() => {
        refreshAllGroundStationHeatMaps();
    }, 5000);

    const resolvePickedLayerId = (picked) => {
        const pickedEntity = picked?.id;
        const explicitLayerId = String(pickedEntity?.properties?.orbitLayerId?.getValue?.() || pickedEntity?.orbitLayerId || "").trim();
        if (explicitLayerId && isCompositeLayerActive(explicitLayerId) && getCompositeLayerTelemetry(explicitLayerId)) {
            return explicitLayerId;
        }

        const directCandidate = pickedEntity?.satelliteId || pickedEntity?.name;

        if (directCandidate && isCompositeLayerActive(directCandidate) && getCompositeLayerTelemetry(directCandidate)) {
            return directCandidate;
        }

        const rawId = typeof pickedEntity?.id === "string" ? pickedEntity.id : "";
        if (!rawId) {
            return null;
        }

        const suffixes = ["-orbit", "-trail", "-ground-track", "-footprint"];
        for (const suffix of suffixes) {
            if (!rawId.endsWith(suffix)) {
                continue;
            }
            const candidate = rawId.slice(0, -suffix.length);
            if (candidate && isCompositeLayerActive(candidate) && getCompositeLayerTelemetry(candidate)) {
                return candidate;
            }
        }

        return null;
    };

    viewer.screenSpaceEventHandler.setInputAction((movement) => {
        const picked = viewer.scene.pick(movement.position);
        const pickedId = resolvePickedLayerId(picked);

        if (pickedId && isCompositeLayerActive(pickedId) && getCompositeLayerTelemetry(pickedId)) {
            objectSidebar.selectObject(pickedId);
            const entity = getCompositeLayerEntity(pickedId);
            if (entity) {
                setCurrentSelectedSatellite(pickedId);
                if (!isGroundStationLayerId(pickedId)) {
                    setSelectedOrbitSatelliteId(getSatelliteSourceIdFromLayerId(pickedId));
                } else {
                    setSelectedOrbitSatelliteId(null);
                }
                viewer.selectedEntity = entity;
            }
            return;
        }

        setCurrentSelectedSatellite(null);
        setSelectedOrbitSatelliteId(null);
        viewer.selectedEntity = undefined;
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    viewer.screenSpaceEventHandler.setInputAction((movement) => {
        const picked = viewer.scene.pick(movement.position);
        const pickedId = resolvePickedLayerId(picked);

        if (!pickedId || !isCompositeLayerActive(pickedId) || !getCompositeLayerTelemetry(pickedId)) {
            return;
        }

        objectSidebar.selectObject(pickedId);
        const entity = getCompositeLayerEntity(pickedId);
        if (!entity) {
            return;
        }

        setCurrentSelectedSatellite(pickedId);
        if (!isGroundStationLayerId(pickedId)) {
            setSelectedOrbitSatelliteId(getSatelliteSourceIdFromLayerId(pickedId));
        } else {
            setSelectedOrbitSatelliteId(null);
        }
        viewer.selectedEntity = entity;
        if (isGroundStationLayerId(pickedId)) {
            focusSatellite(entity);
        } else {
            firstPersonSatellite(entity);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    viewer.screenSpaceEventHandler.setInputAction((movement) => {
        const picked = viewer.scene.pick(movement.position);
        const pickedId = resolvePickedLayerId(picked);

        if (!pickedId || !isCompositeLayerActive(pickedId) || !getCompositeLayerTelemetry(pickedId)) {
            hideSatelliteContextMenu();
            return;
        }

        objectSidebar.selectObject(pickedId);
        setCurrentSelectedSatellite(pickedId);
        if (!isGroundStationLayerId(pickedId)) {
            setSelectedOrbitSatelliteId(getSatelliteSourceIdFromLayerId(pickedId));
        } else {
            setSelectedOrbitSatelliteId(null);
        }

        if (isGroundStationLayerId(pickedId)) {
            hideSatelliteContextMenu();
            objectSidebar?.openGroundStationEditor?.(pickedId);
            return;
        }

        const canvasRect = viewer.scene.canvas.getBoundingClientRect();
        const x = canvasRect.left + movement.position.x;
        const y = canvasRect.top + movement.position.y;
        showSatelliteContextMenuAt(pickedId, x, y);
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    if (viewer?.scene?.canvas) {
        viewer.scene.canvas.addEventListener("contextmenu", (event) => {
            event.preventDefault();

            const canvasRect = viewer.scene.canvas.getBoundingClientRect();
            const position = new Cesium.Cartesian2(
                event.clientX - canvasRect.left,
                event.clientY - canvasRect.top
            );

            const picked = viewer.scene.pick(position);
            const pickedId = resolvePickedLayerId(picked);

            if (!pickedId) {
                hideSatelliteContextMenu();
                return;
            }

            objectSidebar.selectObject(pickedId);
            setCurrentSelectedSatellite(pickedId);
            if (!isGroundStationLayerId(pickedId)) {
                setSelectedOrbitSatelliteId(getSatelliteSourceIdFromLayerId(pickedId));
            } else {
                setSelectedOrbitSatelliteId(null);
            }
            if (isGroundStationLayerId(pickedId)) {
                hideSatelliteContextMenu();
                objectSidebar?.openGroundStationEditor?.(pickedId);
                return;
            }
            showSatelliteContextMenuAt(pickedId, event.clientX, event.clientY);
        });
    }

    logger.info("Receptor de satélites inicializado.");
})();
