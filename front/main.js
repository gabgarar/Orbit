import {
    initSatelliteReceiver,
    preloadSatelliteCatalog,
    fetchCatalogPage,
    refreshSatelliteCatalog,
    setOrbitConfig,
    getSatelliteIds,
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
    setSelectedOrbitSatelliteId,
    refreshSatelliteOverlays,
    getSatelliteVisualizationConfig,
    setSatelliteVisualizationConfig,
    clearSatelliteVisualizationConfig,
    clearAllSatelliteVisualizationConfigs,
    setSatelliteVectorVisualization,
    setSimulationTimelineProvider,
    importOemEphemerisTrack,
    importManualOrbitTrack,
    replaceManualOrbitTrack,
    getManualOrbitProjectEntries,
    getManualOrbitProjectEntry,
    renderManualOrbitPreview,
    setManualOrbitPreviewVectorVisualization,
    setManualOrbitPreviewGroundTrack,
    clearManualOrbitPreview,
    hasLoadedOemEphemerisTracks,
    getLoadedOemEphemerisTimeBounds
} from "./js/satellites.js";
import { setupRuntimeConfigPanel } from "./js/configPanel.js";
import { setupObjectSidebar } from "./js/objectSidebar.js";
import { configureLogger, getLogger } from "./js/logger.js";
import { normalizeSystemConfig, toSectionedSystemConfig } from "./js/configAdapter.js";
import { getAdaptiveResolutionScale, getAdaptiveUiScale } from "./js/runtime/adaptiveDisplay.js";
import { setupResizableSidePanel } from "./js/ui/resizableSidePanel.js";
import { loadSystemConfig, saveSystemConfigWithRetry } from "./js/services/systemConfig.js";
import {
    calculateAzimuthDegrees,
    calculateElevationDegrees
} from "./js/features/groundStations/geometry.js";
import { createGroundStationSymbol } from "./js/features/groundStations/symbols.js";
import { createGroundStationTelemetryService } from "./js/features/groundStations/telemetry.js";
import {
    calculateGroundFootprintRadiusKm,
    calculateSatelliteDownlink,
    calculateSatelliteDownlinkEnvelope,
    calculateStationPlanningLink,
    calculateStationRfModel,
    evaluateStationFieldOfRegard,
    MAX_RF_VISUAL_RANGE_KM,
    sampleStationGroundFootprint
} from "./js/features/groundStations/rfModel.js";
import { buildStationFieldOfRegardMesh, buildStationPatternMesh } from "./js/features/groundStations/rfPatternMesh.js";
import {
    GROUND_STATION_EXPORT_FORMATS,
    GroundStationInterchangeError,
    downloadGroundStationsExport,
    parseGroundStationsDocument
} from "./js/features/groundStations/interchange.js";
import {
    buildManualAosLosRequest,
    ManualAosLosRequestError,
    manualAosLosSignature
} from "./js/features/groundStations/manualAosLos.js";
import { createProjectLifecycle } from "./js/runtime/projectLifecycle.js";
import { setupCameraActions } from "./js/runtime/camera/actions.js";
import { createFreeCameraKeyboardControls } from "./js/runtime/camera/freeKeyboardControls.js";
import { formatDurationCompact, parseTleEpochDate } from "./js/runtime/simulation/timeFormatting.js";
import { createSimulationState, setSimulationRange, SIMULATION_MODE_RANGE, SIMULATION_MODE_REALTIME, SIMULATION_MODE_STATIC } from "./js/runtime/simulation/simulationState.js";
import { createSimulationController } from "./js/runtime/simulation/simulationController.js";
import { clamp, getDateAtTimelineRatio, getRangeHours, getTimelineRatio } from "./js/runtime/simulation/timeline.js";
import { createTychoSkyDome } from "./js/rendering/tychoSkyDome.js";
import { createNightImageryLayer } from "./js/rendering/nightImageryLayer.js";
import { createEarthBasemapManager } from "./js/rendering/earthBasemap.js";
import { applyAntialiasMode } from "./js/rendering/antialiasing.js";
import { applyStarsConfig } from "./js/rendering/stars.js";
import {
    createCelestialBodyLayerManager,
    EARTH_LAYER_ID,
    isCelestialBodyLayerId,
    isEarthLayerId
} from "./js/rendering/celestialLayers.js";
import { createCatalogSearch, getCatalogNoradId } from "./js/services/catalogSearch.js";
import { createSatelliteSourceIdResolver, isGroundStationLayerId, isSatelliteDuplicateLayerId } from "./js/features/layers/layerIds.js";
import { createCompositeLayerManager } from "./js/features/layers/compositeLayerManager.js";
import { createAdaptiveDisplayController } from "./js/runtime/adaptiveDisplayController.js";
import { bindProjectLifecycleEvents } from "./js/runtime/projectEventBridge.js";
import { markOrbitRuntimeFailed } from "./js/runtime/runtimeStatus.js";
import { emitObjectStateChanged } from "./js/runtime/objectDetailsEvents.js";
import {
    centerViewOnEarth,
    centerViewOnEntity,
    getCelestialMaximumZoomDistance,
    getSafeCelestialFocusRange
} from "./js/runtime/centerView.js";
import { createBodyCentricCameraController } from "./js/runtime/bodyCentricCamera.js";
import {
    emitPropagatedParametersContext,
    emitPropagatedParametersOpen,
    PROPAGATED_PARAMETERS_OPEN_EVENT
} from "./js/runtime/propagatedParametersEvents.js";
import {
    createDefaultManualOrbitState,
    normalizeManualOrbitForceTerms,
    normalizeManualOrbitPropagator,
    normalizeManualOrbitState,
    synchronizeManualOrbitState,
    toManualOrbitApiPayload
} from "./js/features/manualOrbit/editorState.js";
import { normalizeManualOrbitPreviewReferenceFrame } from "./js/features/frames/referenceFrame.js";
import { createPropagatedParametersContextBuilder } from "./js/features/propagatedParameters/context.js";

const logger = getLogger("main");
logger.info("Iniciando Cesium...");

logger.info("Preparando las capas base locales de la Tierra...");

const initialBootConfig = await loadSystemConfig({
    onError: (error) => logger.error("Could not load system_config.json:", error)
});
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

const nightProvider = new Cesium.SingleTileImageryProvider({
    url: "assets/basemap/earthnight3km.jpg",
    rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
});

logger.info("Creando Cesium Viewer...");

const viewer = new Cesium.Viewer("cesiumContainer", {
    // Orbit owns the imagery catalogue so it can keep the night-light
    // overlay above every base map and avoid Cesium-ion/Bing defaults.
    baseLayerPicker: false,
    baseLayer: false,
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
    refreshGroundStationCoveragePresentation();
});

if (viewer?.cesiumWidget?.creditContainer) {
    viewer.cesiumWidget.creditContainer.style.display = "none";
    viewer.cesiumWidget.creditContainer.setAttribute("aria-hidden", "true");
}

function updateAdaptiveGlobeLighting() {
    const height = viewer.camera.positionCartographic?.height || 0;
    viewer.scene.globe.enableLighting = globeLightingEnabledByConfig && height >= GLOBE_LIGHTING_MIN_HEIGHT_METERS;
    nightImageryLayer.configure(globeLightingEnabledByConfig && height >= GLOBE_LIGHTING_MIN_HEIGHT_METERS);
}

viewer.camera.changed.addEventListener(updateAdaptiveGlobeLighting);

const tychoSkyDomeTextureUrl = "assets/stars/TychoSkyMapHighRes.jpg";
const tychoSkyDomeRadius = 1000000000;
// Keep some of the base map visible on the night side.  A fully opaque night
// texture makes oceans and land disappear almost completely away from cities.
const NIGHT_IMAGERY_ALPHA = 0.72;
const NIGHT_IMAGERY_BRIGHTNESS = 1.45;
let runtimeSystemConfig = null;
let currentRuntimeDataConfig = { satellites_catalog_file: "catalog.json", offline_mode: false };
let persistConfigTimeoutId = null;
let lastPersistedSystemConfigSerialized = "";
let runtimeConfigPanelApi = null;
let cameraNavigationMode = "centered";
const DEFAULT_CAMERA_MAXIMUM_ZOOM_DISTANCE_METERS = 900_000_000;
let sessionRecorder = null;
let sessionRecordingStream = null;
let sessionRecordingChunks = [];
let sessionRecordingMimeType = "video/webm";
let isSessionRecording = false;
let isSessionRecordingProcessing = false;
let runtimeRecordingConfig = {
    quality: "medium",
    output_format: "webm"
};
let timeHudTimer = null;
const tychoSkyDome = createTychoSkyDome({ viewer, Cesium, textureUrl: tychoSkyDomeTextureUrl, radius: tychoSkyDomeRadius });
const nightImageryLayer = createNightImageryLayer({
    viewer,
    provider: nightProvider,
    alpha: NIGHT_IMAGERY_ALPHA,
    brightness: NIGHT_IMAGERY_BRIGHTNESS,
    onAttached: updateAdaptiveGlobeLighting
});
function publishEarthBasemapState(state) {
    const detail = {
        id: "body:earth",
        ...state
    };
    window.dispatchEvent(new CustomEvent("orbit:earth-basemap-state", { detail }));
    return detail;
}
const earthBasemapManager = createEarthBasemapManager({
    viewer,
    Cesium,
    nightImageryLayer,
    logger,
    offlineMode: offlineModeEnabledAtBoot,
    onStateChange: publishEarthBasemapState
});

function publishEarthBasemapChoices() {
    const state = earthBasemapManager.getState();
    window.dispatchEvent(new CustomEvent("orbit:earth-basemap-choices", {
        detail: {
            id: "body:earth",
            ...state
        }
    }));
    return state;
}

window.addEventListener("orbit:earth-basemap-request", (event) => {
    const detail = event.detail || {};
    const targetId = String(detail.id || "body:earth").trim().toLowerCase();
    if (targetId && targetId !== "body:earth") return;

    const requestedBasemapId = String(detail.basemapId || "").trim();
    if (!requestedBasemapId) {
        publishEarthBasemapChoices();
        return;
    }

    const state = earthBasemapManager.apply(requestedBasemapId);
    const selectedBasemapId = state.selectedId;
    if (updatePersistedSystemConfig && runtimeSystemConfig?.earth_basemap !== selectedBasemapId) {
        updatePersistedSystemConfig("rendering", { earth_basemap: selectedBasemapId });
    } else {
        publishEarthBasemapChoices();
    }
});
const adaptiveDisplay = createAdaptiveDisplayController({
    viewer,
    windowRef: window,
    documentRef: document,
    getResolutionScale: getAdaptiveResolutionScale,
    getUiScale: getAdaptiveUiScale,
    logger
});
let selectedSatelliteId = null;
let currentUiLanguage = "es";
let currentUiTheme = "dark";
let updatePersistedSystemConfig = null;
let topSearchSuggestionsRoot = null;
let topSearchSuggestions = [];
let topSearchSelectedIndex = -1;
let topSearchDebounceId = null;
let topSearchRequestToken = 0;
const catalogSearch = createCatalogSearch({});
const tleEpochCacheBySatelliteId = new Map();
let simulationTickTimer = null;
let simulationUiBusy = false;
let topSearchInitialized = false;
const groundStationLayers = new Map();
let groundStationPreview = null;
const satelliteDuplicateLayers = new Map();
const layerDisplayNameOverrides = new Map();
// Native Cesium Sun/Moon visuals are exposed as ordinary workspace layers.
// The manager owns their real ephemerides and transparent focus anchors.
const celestialBodyLayers = createCelestialBodyLayerManager({ viewer, Cesium, logger });
// Moon and ordinary satellite focus use a translation-only local frame after
// their initial flight. This keeps the regular Earth-style drag/zoom
// controller around the selected target without EntityView's dynamic
// orientation taking over the camera.
const bodyCentricCamera = createBodyCentricCameraController({
    viewer,
    Cesium,
    getBodyPosition: (id, time, result) => getLocalCameraTargetPosition(id, time, result)
});
let groundStationSequence = 1;
let groundStationAnalysisLink = null;
let groundStationAnalysisRequestSequence = 0;
let groundStationAnalysisAbortController = null;
const groundStationVisibilityLinks = new Map();
let currentProjectFileHandle = null;
let currentProjectName = null;
let objectSidebar = null;
let manualOrbitEditorState = createDefaultManualOrbitState();
let manualOrbitDefinitionSource = "keplerian";
let manualOrbitCreateInFlight = false;
let manualOrbitCreateRequestId = 0;
let manualOrbitCreateAbortController = null;
let manualOrbitBridgeBound = false;
let propagatedParametersBridgeBound = false;
let propagatedParametersInspectorBound = false;
let propagatedParametersAbortController = null;
let propagatedParametersRequestId = 0;
let propagatedParametersRefreshTimer = null;
let propagatedParametersLastContext = null;
const propagatedParametersInspectorState = {
    open: false,
    status: "idle",
    target: null,
    range: null,
    result: null,
    error: ""
};
let manualOrbitDesignSession = null;
let manualOrbitPreviewTimer = null;
let manualOrbitPreviewAbortController = null;
let manualOrbitPreviewRequestId = 0;
let manualOrbitDesignSettings = null;
// Set only while the design editor is modifying an already-confirmed local
// manual orbit. Catalogue/OEM objects never populate this target.
let manualOrbitEditingTarget = null;
let globeLightingEnabledByConfig = true;
const GLOBE_LIGHTING_MIN_HEIGHT_METERS = 1_200_000;
let runtimeDecayAlertPerigeeKm = 200;

function requestProjectActionDialog(mode) {
    window.dispatchEvent(new CustomEvent("orbit:project-dialog-request", { detail: mode }));
}

const SIMULATION_TIMELINE_STEPS = 10000;
const SIMULATION_LONG_RANGE_WARNING_HOURS = 24 * 7;
const PROPAGATED_PARAMETERS_DEFAULT_HOURS = 24;
const PROPAGATED_PARAMETERS_MIN_SAMPLES = 25;
const PROPAGATED_PARAMETERS_MAX_SAMPLES = 121;
const PROPAGATED_PARAMETERS_MANUAL_REFRESH_DEBOUNCE_MS = 280;
// The detailed AOS/LOS panel remains deliberately dense: it is the
// authoritative operator result and drives the elevation plot.  The station
// sidebar only needs a forecast of the next contact, so it uses a lighter
// request below and never downloads an unused 24-hour sample series.
// Twenty seconds keeps several profile vertices for ordinary LEO contacts
// while avoiding an 8,641-point / 24-hour request. AOS and LOS themselves
// are still refined by the service to its sub-second transition tolerance.
const GROUND_STATION_ANALYSIS_STEP_SECONDS = 20;
const GROUND_STATION_BACKGROUND_PASS_STEP_SECONDS = 30;
const GROUND_STATION_CHART_PADDING_SECONDS = 120;
const PROPAGATED_PARAMETERS_MAX_RANGE_HOURS = 365 * 24;

const simulationState = {
    ...createSimulationState(),
    isPlaying: true,
    rewind: false,
    startDate: new Date(Date.now() - 60 * 60 * 1000),
    endDate: new Date(Date.now() + 60 * 60 * 1000),
    lastTickTimestamp: Date.now()
};

const simulationController = createSimulationController({
    state: simulationState,
    onDateChange: applySimulationDateToViewer
});
// The controller below owns every change to currentTime. Leave Cesium's
// autonomous clock disabled so it cannot drift between controller ticks or
// move the scene while Real time is paused.
syncViewerClockPlayback();

const projectLifecycle = createProjectLifecycle({
    getProjectName: () => currentProjectName,
    setProjectName: (value) => { currentProjectName = value; },
    getProjectFileHandle: () => currentProjectFileHandle,
    setProjectFileHandle: (value) => { currentProjectFileHandle = value; },
    getActiveSatelliteIds: getActiveSatelliteLayerIds,
    setAllSatelliteLayersActive,
    setSatelliteLayerActive,
    getGroundStationLayers: () => groundStationLayers,
    removeGroundStationLayer,
    getCelestialBodies: () => celestialBodyLayers.getSnapshot(),
    restoreCelestialBodies: (entries) => celestialBodyLayers.restore(entries),
    clearCelestialBodies: () => {
        bodyCentricCamera.deactivate();
        celestialBodyLayers.clear();
    },
    clearDuplicateLayers: () => satelliteDuplicateLayers.clear(),
    getLayerNameOverrides: () => layerDisplayNameOverrides,
    clearSatelliteVisualizationConfigs: clearAllSatelliteVisualizationConfigs,
    getObjectSidebar: () => objectSidebar,
    getManualOrbitEntries: getManualOrbitProjectEntries,
    restoreManualOrbits: restoreManualOrbitsFromProject,
    restoreGroundStations: restoreGroundStationsFromProject,
    getSimulationState: () => simulationState,
    applySimulationRange,
    restoreSimulation: restoreProjectSimulationState,
    showConfirm: showAppConfirm,
    showAlert: showAppAlert,
    getAlertTitle: () => uiText("alertTitle")
});

const UI_TEXT = {
    es: {
        toolbarToggle: "Herramientas rapidas",
        future: "Futuro",
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
        tleInfoTitle: "Parametros TLE",
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
        includeElementsMsg: "Se incluiran {count} elementos que aun no estan en capas activas.",
        includeBtn: "Incluir",
        addingLayers: "Anadiendo capas...",
        latLabel: "Latitud",
        lonLabel: "Longitud",
        altLabel: "Altitud",
        velXLabel: "Velocidad X",
        velYLabel: "Velocidad Y",
        velZLabel: "Velocidad Z",
        speedLabel: "Modulo velocidad",
        speedKmhLabel: "Velocidad",
        distToCameraLabel: "Distancia a camara",
        telemetryAgeLabel: "Edad telemetria",
        propagationLabel: "Propagacion",
        orbitTypeLabel: "Tipo orbita",
        futurePropLabel: "Propagacion futura",
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
        simStatic: "Estatico",
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
        tleInfoTitle: "TLE parameters",
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
        includeElementsMsg: "Will include {count} elements that are not yet in active layers.",
        includeBtn: "Include",
        addingLayers: "Adding layers...",
        latLabel: "Latitude",
        lonLabel: "Longitude",
        altLabel: "Altitude",
        velXLabel: "Velocity X",
        velYLabel: "Velocity Y",
        velZLabel: "Velocity Z",
        speedLabel: "Speed magnitude",
        speedKmhLabel: "Speed",
        distToCameraLabel: "Distance to camera",
        telemetryAgeLabel: "Telemetry age",
        propagationLabel: "Propagation",
        orbitTypeLabel: "Orbit type",
        futurePropLabel: "Future propagation",
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
        simStatic: "Static",
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

const freeCameraKeyboardControls = createFreeCameraKeyboardControls({
    viewer,
    isFreeMode: () => cameraNavigationMode === "free"
});

function formatSimulationRangeWarning(startDate, endDate) {
    const rangeHours = getRangeHours(startDate, endDate);
    const rangeDays = rangeHours / 24;
    return uiText("simLargeRangeWarning")
        .replace("{days}", rangeDays.toFixed(1))
        .replace("{hours}", rangeHours.toFixed(1));
}

async function confirmLargeSimulationRangeIfNeeded(startDate, endDate) {
    const rangeHours = getRangeHours(startDate, endDate);
    if (!Number.isFinite(rangeHours) || rangeHours <= SIMULATION_LONG_RANGE_WARNING_HOURS) {
        return true;
    }
    const message = formatSimulationRangeWarning(startDate, endDate);
    return showAppConfirm(message, uiText("confirmTitle"));
}

function isManualOrbitDesignActive() {
    return manualOrbitDesignSession?.active === true;
}

function openLeftSatellitesPanel() {
    // The React trigger is hidden during manual design, but several legacy
    // command paths can still call this helper. Never let one reopen Layers
    // over the isolated editor.
    if (isManualOrbitDesignActive()) {
        return false;
    }
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
    // React owns the rendered panel classes. Keep imperative legacy actions
    // in sync with that state so the next sidebar click always toggles once.
    window.dispatchEvent(new CustomEvent("orbit:layers-panel-state", { detail: { open: true } }));
    return true;
}

function getDisplayedSimulationDate() {
    if (simulationState.mode === SIMULATION_MODE_REALTIME && simulationState.isPlaying !== false) {
        return new Date();
    }
    const date = simulationState.currentDate instanceof Date ? simulationState.currentDate : new Date(simulationState.currentDate);
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

function getGroundStationAnalysisWindow() {
    // A pass list must describe the same temporal domain as the visible
    // simulation timeline.  Previously analysis always started at the playhead
    // and extended 24 hours, which could put AOS/LOS rows outside the bar the
    // operator was looking at.
    if (simulationState.mode === SIMULATION_MODE_RANGE) {
        const startDate = new Date(simulationState.startDate);
        const endDate = new Date(simulationState.endDate);
        if (!Number.isNaN(startDate.getTime())
            && !Number.isNaN(endDate.getTime())
            && endDate > startDate) {
            return { startDate, endDate, source: "simulation-range" };
        }
    }

    const startDate = getDisplayedSimulationDate();
    return {
        startDate,
        endDate: new Date(startDate.getTime() + (24 * 3600 * 1000)),
        source: "rolling-24h"
    };
}

function formatObjectTimeRangeHours(hours) {
    const rounded = Math.round(Math.max(0, Number(hours) || 0) * 100) / 100;
    return `${rounded} h`;
}

// The visible future orbit is anchored to the current clock in realtime, while
// range mode maps it onto the explicit simulation interval. Keep that exact
// domain with the selected-object payload so the details card never presents
// stale bootstrap dates as its start/end range.
function getObjectTimeRange(layerId, telemetry) {
    // A confirmed manual orbit owns an explicit design interval.  Keep that
    // interval on its Overview card even after the workspace returns to real
    // time, instead of replacing it with the global future-line horizon.
    const manualOrbit = telemetry?.manual_orbit || telemetry?.manualOrbit;
    const manualStart = manualOrbit?.startTime || manualOrbit?.start_time;
    const manualEnd = manualOrbit?.endTime || manualOrbit?.end_time;
    const manualStartDate = manualStart ? new Date(manualStart) : null;
    const manualEndDate = manualEnd ? new Date(manualEnd) : null;
    if (
        manualStartDate instanceof Date
        && manualEndDate instanceof Date
        && !Number.isNaN(manualStartDate.getTime())
        && !Number.isNaN(manualEndDate.getTime())
        && manualEndDate.getTime() > manualStartDate.getTime()
    ) {
        const manualRangeHours = getRangeHours(manualStartDate.getTime(), manualEndDate.getTime());
        return {
            mode: SIMULATION_MODE_RANGE,
            startDate: manualStartDate.toISOString(),
            endDate: manualEndDate.toISOString(),
            oemRangeHours: manualRangeHours,
            label: `${formatObjectTimeRangeHours(manualRangeHours)} (manual design)`
        };
    }

    const isRangeMode = simulationState.mode === SIMULATION_MODE_RANGE;
    const startDate = isRangeMode
        ? new Date(simulationState.startDate)
        : getDisplayedSimulationDate();
    if (Number.isNaN(startDate.getTime())) {
        return null;
    }

    if (isRangeMode) {
        const endDate = new Date(simulationState.endDate);
        if (Number.isNaN(endDate.getTime())) {
            return null;
        }
        const oemRangeHours = getRangeHours(startDate, endDate);
        return {
            mode: SIMULATION_MODE_RANGE,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            oemRangeHours,
            label: `${formatObjectTimeRangeHours(oemRangeHours)} (inicio → fin)`
        };
    }

    const sourceId = isGroundStationLayerId(layerId) || isCelestialBodyLayerId(layerId)
        ? ""
        : getSatelliteSourceIdFromLayerId(layerId);
    const configuredHours = sourceId
        ? getSatelliteVisualizationConfig(sourceId)?.effective?.propagation_hours
        : undefined;
    const requestedHours = Number(telemetry?.propagation_future_hours ?? configuredHours);
    const oemRangeHours = Number.isFinite(requestedHours) && requestedHours >= 0
        ? requestedHours
        : 0;
    const endDate = new Date(startDate.getTime() + (oemRangeHours * 60 * 60 * 1000));

    return {
        mode: SIMULATION_MODE_REALTIME,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        oemRangeHours,
        label: `${formatObjectTimeRangeHours(oemRangeHours)} hacia futuro`
    };
}

function getTimelineRatioByDate(dateValue) {
    return getTimelineRatio(dateValue, simulationState.startDate, simulationState.endDate);
}

function getDateFromTimelineRatio(ratio) {
    return getDateAtTimelineRatio(ratio, simulationState.startDate, simulationState.endDate);
}

function applySimulationDateToViewer(date) {
    if (!viewer?.clock || !(date instanceof Date) || Number.isNaN(date.getTime())) {
        return;
    }
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(date);
}

function syncViewerClockPlayback() {
    if (!viewer?.clock) return;
    // Cesium also advances its own clock between our controller ticks. Orbit
    // keeps a single source of truth in simulationController, which makes a
    // paused Real time date deterministic and avoids double progression.
    viewer.clock.shouldAnimate = false;
}

function pauseRealtimeClock() {
    if (simulationState.mode !== SIMULATION_MODE_REALTIME) return false;
    const frozenAt = simulationState.isPlaying === false
        ? getDisplayedSimulationDate()
        : new Date();
    simulationState.currentDate = new Date(frozenAt);
    simulationState.isPlaying = false;
    simulationState.playing = false;
    simulationState.rewind = false;
    simulationState.lastTickTimestamp = Date.now();
    applySimulationDateToViewer(simulationState.currentDate);
    syncViewerClockPlayback();
    return true;
}

function resumeRealtimeClock() {
    if (simulationState.mode !== SIMULATION_MODE_REALTIME) return false;
    // Realtime deliberately resumes at the current wall-clock instant rather
    // than integrating the duration for which it was paused.
    simulationState.currentDate = new Date();
    simulationState.isPlaying = true;
    simulationState.playing = true;
    simulationState.rewind = false;
    simulationState.lastTickTimestamp = Date.now();
    applySimulationDateToViewer(simulationState.currentDate);
    syncViewerClockPlayback();
    return true;
}

async function resolveSatelliteEpochDate(satelliteId) {
    if (isGroundStationLayerId(satelliteId) || isCelestialBodyLayerId(satelliteId)) {
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
        const noradId = getCatalogNoradId(item);
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

const getSatelliteSourceIdFromLayerId = createSatelliteSourceIdResolver(satelliteDuplicateLayers);
const compositeLayers = createCompositeLayerManager({
    celestialBodies: celestialBodyLayers,
    groundStations: groundStationLayers,
    duplicates: satelliteDuplicateLayers,
    names: layerDisplayNameOverrides,
    getSatelliteSourceId: getSatelliteSourceIdFromLayerId,
    satellites: {
        getActiveIds: getActiveSatelliteLayerIds,
        isActive: isSatelliteLayerActive,
        setActive: setSatelliteLayerActive,
        isVisible: isSatelliteVisible,
        setVisible: setSatelliteVisible
    },
    applyGroundStationVisibility: (station, visible) => {
        station.visible = visible === true;
        if (station.entity) station.entity.show = station.visible;
        applyGroundStationVisuals(station);
    }
});

function getLayerDisplayName(layerId) {
    // Project files from an older/runtime-customized session may contain a
    // stale name override. Earth is the immutable reference body and keeps a
    // stable label across projects.
    if (isEarthLayerId(layerId)) {
        return celestialBodyLayers.getName(layerId);
    }
    return compositeLayers.getName(layerId);
}

function getLayerType(layerId) {
    if (isEarthLayerId(layerId)) {
        return "EARTH";
    }
    if (isCelestialBodyLayerId(layerId)) {
        return "CELESTIAL_BODY";
    }
    if (isGroundStationLayerId(layerId)) {
        return "GROUND_STATION";
    }
    return "SATELLITE";
}

function isSatelliteLayer(layerId) {
    return String(getLayerType(layerId) || "SATELLITE").toUpperCase() === "SATELLITE";
}

/**
 * Resolves the moving centre used by the local focus camera. Celestial bodies
 * already expose ephemerides through their manager; satellites are pooled
 * Cesium entities, so confirm the pool record still belongs to the requested
 * satellite before reading its dynamic position property.
 */
function getLocalCameraTargetPosition(layerId, time, result) {
    const id = String(layerId || "").trim();
    if (!id) {
        return null;
    }
    if (isCelestialBodyLayerId(id)) {
        return celestialBodyLayers.getPosition(id, time, result);
    }
    if (!isSatelliteLayer(id)) {
        return null;
    }

    const sourceId = getSatelliteSourceIdFromLayerId(id);
    const entity = getSatelliteEntity(sourceId);
    if (!entity || entity.satelliteId !== sourceId) {
        return null;
    }
    const position = entity.position;
    if (typeof position?.getValue === "function") {
        return position.getValue(time, result) || null;
    }
    if (position && typeof Cesium?.Cartesian3?.clone === "function") {
        return Cesium.Cartesian3.clone(position, result);
    }
    return position && Number.isFinite(Number(position.x))
        && Number.isFinite(Number(position.y))
        && Number.isFinite(Number(position.z))
        ? position
        : null;
}

function syncSelectedOrbitLayer(layerId) {
    setSelectedOrbitSatelliteId(
        isSatelliteLayer(layerId)
            ? getSatelliteSourceIdFromLayerId(layerId)
            : null
    );
}

function getCartesianMagnitude(value) {
    if (!value) {
        return 0;
    }
    if (typeof Cesium?.Cartesian3?.magnitude === "function") {
        return Cesium.Cartesian3.magnitude(value);
    }
    return Math.hypot(Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0);
}

function getCelestialFocusMetrics(layerId) {
    if (!isCelestialBodyLayerId(layerId)) {
        return null;
    }

    const definition = celestialBodyLayers.getDefinition(layerId);
    // The Moon is a textured inspection target rather than a point target:
    // frame it farther away than the generic celestial default so the full
    // disc and its surface remain legible without an overly magnified view.
    const focusRangeMultiplier = definition?.kind === "moon" ? 4.25 : undefined;
    const focusRangeMeters = getSafeCelestialFocusRange(
        definition?.radiusMeters,
        focusRangeMultiplier
    );
    if (!focusRangeMeters) {
        return null;
    }

    const earthCenterDistanceMeters = getCartesianMagnitude(celestialBodyLayers.getPosition(layerId));
    return {
        focusRangeMeters,
        maximumZoomDistanceMeters: getCelestialMaximumZoomDistance({
            focusRangeMeters,
            earthCenterDistanceMeters,
            fallbackMeters: DEFAULT_CAMERA_MAXIMUM_ZOOM_DISTANCE_METERS
        })
    };
}

function getCameraMaximumZoomDistance() {
    const trackedMetrics = getCelestialFocusMetrics(
        viewer?.trackedEntity?.id || bodyCentricCamera.getFocusedBodyId()
    );
    return Math.max(
        DEFAULT_CAMERA_MAXIMUM_ZOOM_DISTANCE_METERS,
        Number(trackedMetrics?.maximumZoomDistanceMeters) || 0
    );
}

function computeStationElevationDeg(stationCartesian, satCartesian) {
    return calculateElevationDegrees(Cesium, stationCartesian, satCartesian);
}

function resetCameraView({ immediate = false } = {}) {
    bodyCentricCamera.deactivate();
    viewer.trackedEntity = undefined;
    const destination = Cesium.Cartesian3.fromDegrees(0, 20, 20_000_000);
    // `setView` otherwise retains the last local-camera orientation. After
    // following an object, that direction can point away from the Earth and
    // show only the star field at the neutral destination.
    const orientation = { heading: 0, pitch: -Math.PI / 2, roll: 0 };
    if (immediate && typeof viewer.camera?.setView === "function") {
        viewer.camera.cancelFlight?.();
        viewer.camera.setView({ destination, orientation });
        return;
    }
    viewer.camera.flyTo({ destination, orientation, duration: 0.8 });
}

function cloneCameraVector(vector) {
    if (!vector || typeof Cesium?.Cartesian3?.clone !== "function") {
        return null;
    }
    return Cesium.Cartesian3.clone(vector);
}

function captureCameraView() {
    const camera = viewer?.camera;
    const destination = cloneCameraVector(camera?.positionWC || camera?.position);
    const direction = cloneCameraVector(camera?.directionWC || camera?.direction);
    const up = cloneCameraVector(camera?.upWC || camera?.up);
    return destination && direction && up ? { destination, direction, up } : null;
}

function restoreCameraView(snapshot) {
    if (!snapshot || typeof viewer?.camera?.setView !== "function") {
        return false;
    }
    try {
        bodyCentricCamera.deactivate();
        viewer.camera.cancelFlight?.();
        viewer.camera.setView({
            destination: snapshot.destination,
            orientation: { direction: snapshot.direction, up: snapshot.up }
        });
        return true;
    } catch (error) {
        logger.warn("No se pudo restaurar la vista anterior al cerrar el diseÃ±ador orbital:", error);
        return false;
    }
}

function focusManualOrbitDesignEarth() {
    bodyCentricCamera.deactivate();
    viewer.selectedEntity = undefined;
    viewer.trackedEntity = undefined;

    // Cesium's Home action is its stable, Earth-aware framing. Unlike moving
    // a camera position alone, it also resets the viewing direction after a
    // satellite/local-body camera session.
    const centered = centerViewOnEarth({
        viewer,
        entity: celestialBodyLayers.getEntity(EARTH_LAYER_ID),
        duration: 0,
        logger
    });
    viewer.selectedEntity = undefined;
    viewer.trackedEntity = undefined;
    if (!centered) {
        resetCameraView({ immediate: true });
    }
    viewer.scene?.requestRender?.();
}


const groundStationTelemetryService = createGroundStationTelemetryService({
    getLayerName: getLayerDisplayName,
    getSatelliteStates: () => getCompositeLayerIds()
        .filter((layerId) => !isGroundStationLayerId(layerId) && !isCelestialBodyLayerId(layerId))
        .map((layerId) => {
            const id = getSatelliteSourceIdFromLayerId(layerId);
            return { id, geo: getSatelliteTelemetry(id)?.geo, rf_profile: getCatalogEntryMeta(id)?.rfProfile || null };
        })
        .filter((satellite) => satellite.geo),
    calculateElevationDegrees: (station, satellite) => {
        const stationPosition = Cesium.Cartesian3.fromDegrees(station.longitude_deg, station.latitude_deg, station.altitude_m);
        const geo = satellite.geo;
        const satellitePosition = Cesium.Cartesian3.fromDegrees(Number(geo.longitude_deg) || 0, Number(geo.latitude_deg) || 0, Number(geo.altitude_m) || 0);
        const rangeKm = Cesium.Cartesian3.distance(stationPosition, satellitePosition) / 1000;
        return {
            elevationDeg: computeStationElevationDeg(stationPosition, satellitePosition),
            azimuthDeg: calculateAzimuthDegrees(Cesium, stationPosition, satellitePosition),
            rangeKm
        };
    },
    calculatePlanningLink: calculateStationPlanningLink,
    calculateSatelliteDownlink,
    calculateRfModel: calculateStationRfModel,
    getPasses: async (satelliteId, station, startDate, endDate) => {
        const request = createGroundStationPassRequest(station, satelliteId, startDate, endDate, {
            stepSeconds: GROUND_STATION_BACKGROUND_PASS_STEP_SECONDS,
            includeSamples: false
        });
        // The catalogue explicitly supplied RF metadata but it cannot close
        // this station's receiver contract. Returning no operational pass is
        // more truthful than quietly switching to reciprocal planning.
        if (!request.linkContract.available) return [];
        const response = await fetch(request.url, request.requestOptions);
        return response.ok ? (await response.json()).passes : [];
    }
});

function getCompositeLayerIds() {
    return compositeLayers.getIds();
}

function getCompositeLayerMeta(layerId) {
    if (isCelestialBodyLayerId(layerId)) {
        const definition = celestialBodyLayers.getDefinition(layerId);
        return {
            sourceFormat: "CELESTIAL",
            sourceOrigin: "CESIUM",
            celestialBody: definition?.kind || null,
            bodyRadiusMeters: definition?.radiusMeters || null
        };
    }
    if (isGroundStationLayerId(layerId)) {
        return { sourceFormat: "GROUND_STATION", sourceOrigin: "USER" };
    }
    const sourceId = getSatelliteSourceIdFromLayerId(layerId);
    return getCatalogEntryMeta(sourceId) || { sourceFormat: "TLE", sourceOrigin: "CATALOG" };
}

function getCompositeLayerVisibility(layerId) {
    return compositeLayers.getVisibility(layerId);
}

function setCompositeLayerVisibility(layerId, visible) {
    if (isCelestialBodyLayerId(layerId)) {
        if (visible !== true) {
            deactivateLocalCameraForLayer(layerId);
        }
        const changed = celestialBodyLayers.setVisibility(layerId, visible);
        if (changed) {
            emitObjectStateChanged({ layerId, sourceId: layerId, reason: "visibility" });
        }
        return;
    }
    if (isGroundStationLayerId(layerId)) {
        const station = groundStationLayers.get(layerId);
        if (!station) {
            return;
        }
        compositeLayers.setVisibility(layerId, visible);
        emitObjectStateChanged({ layerId, sourceId: layerId, reason: "visibility" });
        return;
    }
    if (visible !== true) {
        // A duplicate controls the source entity's visibility too, so source
        // matching is intentional for this path.
        deactivateLocalCameraForLayer(layerId, { matchSatelliteSource: true });
    }
    compositeLayers.setVisibility(layerId, visible);
}

function isCompositeLayerActive(layerId) {
    return compositeLayers.isActive(layerId);
}

// The local camera stores either a source satellite id (direct globe/search
// focus) or a workspace layer id (tree/context focus). Before a pooled
// satellite disappears, clear either form of that focus so its last local
// transform cannot survive without a live target. A duplicate removal is a
// special case: it must not cancel a focus on its still-active source layer.
function deactivateLocalCameraForLayer(layerId, { matchSatelliteSource = false } = {}) {
    const focusedId = bodyCentricCamera.getFocusedBodyId();
    if (!focusedId) {
        return false;
    }
    if (focusedId === layerId) {
        bodyCentricCamera.deactivate();
        return true;
    }
    if (!matchSatelliteSource || !isSatelliteLayer(focusedId) || !isSatelliteLayer(layerId)) {
        return false;
    }
    if (getSatelliteSourceIdFromLayerId(focusedId) !== getSatelliteSourceIdFromLayerId(layerId)) {
        return false;
    }
    bodyCentricCamera.deactivate();
    return true;
}

function removeGroundStationLayer(layerId) {
    const station = groundStationLayers.get(layerId);
    if (!station) {
        return;
    }
    if (station.entity) viewer.entities.remove(station.entity);
    if (station.coverageEntity) viewer.entities.remove(station.coverageEntity);
    if (station.coverageVolumeEntity) viewer.entities.remove(station.coverageVolumeEntity);
    removeGroundStationPatternMesh(station);
    groundStationLayers.delete(layerId);
    syncGroundStationVisibilityLinks();
    layerDisplayNameOverrides.delete(layerId);
    emitObjectStateChanged({ layerId, sourceId: layerId, reason: "activation" });
}

function setCompositeLayerActive(layerId, active) {
    const isActive = active === true;
    // Earth is the workspace's permanent reference body. A remove-all or
    // stale UI action must not erase its anchor/selection contract; visibility
    // remains controllable through the regular eye control instead.
    if (isEarthLayerId(layerId)) {
        return isActive && celestialBodyLayers.has(layerId);
    }
    if (isCelestialBodyLayerId(layerId)) {
        if (!isActive) {
            const entity = celestialBodyLayers.getEntity(layerId);
            deactivateLocalCameraForLayer(layerId);
            if (viewer.trackedEntity === entity) {
                viewer.trackedEntity = undefined;
            }
            if (viewer.selectedEntity === entity) {
                viewer.selectedEntity = undefined;
            }
            const removed = celestialBodyLayers.remove(layerId);
            if (removed) {
                layerDisplayNameOverrides.delete(layerId);
                emitObjectStateChanged({ layerId, sourceId: layerId, reason: "activation" });
            }
            return removed;
        }
        // Re-adding a body is always explicit through Add body; retain this
        // branch as a safe idempotent activation path for generic callers.
        return Boolean(celestialBodyLayers.add(layerId));
    }
    if (isGroundStationLayerId(layerId)) {
        if (!isActive) {
            removeGroundStationLayer(layerId);
        }
        return true;
    }

    if (isSatelliteDuplicateLayerId(layerId)) {
        if (!isActive) {
            const sourceId = getSatelliteSourceIdFromLayerId(layerId);
            deactivateLocalCameraForLayer(layerId);
            satelliteDuplicateLayers.delete(layerId);
            layerDisplayNameOverrides.delete(layerId);
            emitObjectStateChanged({ layerId, sourceId, reason: "activation" });
            return true;
        }
        return false;
    }

    if (!isActive) {
        deactivateLocalCameraForLayer(layerId, { matchSatelliteSource: true });
        for (const [dupId, dup] of satelliteDuplicateLayers.entries()) {
            if (dup.sourceId === layerId) {
                satelliteDuplicateLayers.delete(dupId);
                layerDisplayNameOverrides.delete(dupId);
            }
        }
    }

    const changed = setSatelliteLayerActive(layerId, isActive);
    if (changed) {
        syncGroundStationVisibilityLinks();
    }
    return changed;
}

function duplicateSatelliteLayer(sourceId) {
    return compositeLayers.duplicate(String(sourceId || "").trim());
}

function renameLayer(layerId, nextName) {
    const id = String(layerId || "").trim();
    const name = String(nextName || "").trim();
    if (!id || !name || isEarthLayerId(id)) {
        return false;
    }

    layerDisplayNameOverrides.set(id, name);
    if (isCelestialBodyLayerId(id)) {
        emitObjectStateChanged({ layerId: id, sourceId: id, reason: "rename" });
        return true;
    }
    const satelliteEntity = getSatelliteEntity(getSatelliteSourceIdFromLayerId(id));
    if (satelliteEntity?.label) {
        satelliteEntity.label.text = name;
    }
    if (isGroundStationLayerId(id)) {
        const station = groundStationLayers.get(id);
        if (station) {
            station.name = name;
            if (station.entity?.label) {
                station.entity.label.text = name;
            }
        }
    }
    emitObjectStateChanged({ layerId: id, sourceId: getSatelliteSourceIdFromLayerId(id), reason: "rename" });
    return true;
}

function createStationSymbolImage(symbol = "circle", color = "#3cc4ff", size = 11) {
    return createGroundStationSymbol(symbol, color, size);
}

// RF calculations live in one pure module. Store only its small derived
// presentation values on the runtime station; the authored antenna contract
// remains the source persisted in a project document.
function getGroundStationRfModel(station) {
    const model = calculateStationRfModel(station || {});
    if (station) {
        station.radio_range_km = Number.isFinite(model.max_range_km)
            ? Math.max(0, model.max_range_km)
            : 0;
        station.operational_radio_range_km = Number.isFinite(model.operational_range_km)
            ? model.operational_range_km
            : 0;
        station.visual_radio_range_km = Number.isFinite(model.visual_range_km)
            ? model.visual_range_km
            : Math.min(MAX_RF_VISUAL_RANGE_KM, Math.max(0, station.operational_radio_range_km));
        station.ground_footprint_radius_km = Number.isFinite(model.ground_footprint_radius_km)
            ? model.ground_footprint_radius_km
            : calculateGroundFootprintRadiusKm(station.radio_range_km, station.min_elevation_deg);
    }
    return model;
}

function getGroundStationRfAuthoredFields(values = {}) {
    const model = calculateStationRfModel(values);
    const optionalNumber = (value) => {
        if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return null;
        return Number.isFinite(Number(value)) ? Number(value) : null;
    };
    return {
        station_schema_version: 2,
        antenna_diameter_m: model.antenna_diameter_m,
        antenna_efficiency: model.antenna_efficiency,
        frequency_unit: model.frequency_unit,
        frequency_mhz: model.frequency_mhz,
        frequency_hz: model.frequency_mhz * 1e6,
        polarization: model.polarization,
        polarization_tilt_deg: model.polarization_tilt_deg,
        tx_power_unit: model.tx_power_unit,
        tx_power_dbm: model.tx_power_dbm,
        tx_power_w: model.tx_power_w,
        tx_gain_mode: model.tx_gain_mode,
        rx_gain_mode: model.rx_gain_mode,
        tx_gain_override_dbi: model.tx_gain_override_dbi,
        rx_gain_override_dbi: model.rx_gain_override_dbi,
        // Keep legacy flat aliases readable by older saved project files and
        // existing inspector surfaces. In derived mode they are refreshed
        // from the aperture instead of becoming an implicit override.
        tx_gain_dbi: model.tx_gain_dbi,
        rx_gain_dbi: model.rx_gain_dbi,
        min_link_power_dbm: model.min_link_power_dbm,
        hpbw_azimuth_deg: optionalNumber(values.hpbw_azimuth_deg),
        hpbw_elevation_deg: optionalNumber(values.hpbw_elevation_deg),
        pattern_type: model.pattern_type,
        side_lobe_level_db: model.side_lobe_level_db,
        system_temperature_k: model.system_temperature_k,
        atmospheric_loss_db: model.atmospheric_loss_db,
        rain_loss_db: model.rain_loss_db,
        cable_loss_db: model.cable_loss_db,
        connector_loss_db: model.connector_loss_db,
        pointing_rms_mdeg: model.pointing_rms_mdeg,
        receiver_bandwidth_hz: model.receiver_bandwidth_hz,
        required_snr_db: model.required_snr_db,
        operation_mode: model.operation_mode,
        boresight_azimuth_deg: model.boresight_azimuth_deg,
        boresight_elevation_deg: model.boresight_elevation_deg,
        mechanical_elevation_min_deg: model.mechanical_elevation_min_deg,
        mechanical_elevation_max_deg: model.mechanical_elevation_max_deg,
        mechanical_azimuth_min_deg: model.mechanical_azimuth_min_deg,
        mechanical_azimuth_max_deg: model.mechanical_azimuth_max_deg,
        reference_rx_gain_dbi: model.reference_rx_gain_dbi,
        reference_rx_threshold_dbm: model.reference_rx_threshold_dbm
    };
}

function calculateGroundStationRadioRangeKm(station) {
    const model = getGroundStationRfModel(station);
    return Number.isFinite(model.operational_range_km)
        && model.operational_range_km > 0
        ? model.operational_range_km
        // This only protects the HTTP contract for a malformed legacy record.
        // A valid RF model preserves its calculated range, even below 1 km.
        : 0.001;
}

// A published satellite RF profile changes the meaning of a pass from the
// station's reciprocal *planning* envelope to a validated satellite-to-
// station downlink. Never silently fall back to planning if the profile is
// incomplete or off-channel: that would turn a known unavailable link green.
function getGroundStationPassLinkContract(station, satelliteId) {
    const profile = getCatalogEntryMeta(satelliteId)?.rfProfile;
    if (profile && typeof profile === "object") {
        const envelope = calculateSatelliteDownlinkEnvelope(station, profile);
        return {
            kind: "actual-downlink",
            profile,
            envelope,
            available: envelope.available === true,
            reason: envelope.reason || null,
            maxRangeKm: envelope.available === true
                ? Math.max(0.001, Number(envelope.operational_max_range_km) || 0.001)
                : 0.001
        };
    }
    return {
        kind: "reciprocal-planning",
        profile: null,
        envelope: null,
        available: true,
        reason: null,
        maxRangeKm: calculateGroundStationRadioRangeKm(station)
    };
}

function satelliteRfProfileSignature(satelliteId) {
    const profile = getCatalogEntryMeta(satelliteId)?.rfProfile;
    if (!profile || typeof profile !== "object") return "planning";
    return [
        "downlink",
        profile.eirp_dbm,
        profile.frequency_mhz,
        profile.frequency_hz,
        profile.polarization,
        profile.polarization_tilt_deg,
        profile.bandwidth_hz
    ].join("|");
}

function createGroundStationPassStationInput(station, linkContract) {
    const rf = getGroundStationRfModel(station);
    return {
        lat_deg: Number(station.latitude_deg),
        lon_deg: Number(station.longitude_deg),
        height_m: Number(station.altitude_m),
        min_elevation_deg: Number(station.min_elevation_deg),
        // The backend applies the identical directional range law. For an
        // actual remote profile this is the downlink's boresight envelope;
        // otherwise it remains explicitly the reciprocal planning envelope.
        max_range_km: Number(linkContract.maxRangeKm),
        mechanical_elevation_min_deg: Number(rf.mechanical_elevation_min_deg),
        mechanical_elevation_max_deg: Number(rf.mechanical_elevation_max_deg),
        mechanical_azimuth_min_deg: Number(rf.mechanical_azimuth_min_deg),
        mechanical_azimuth_max_deg: Number(rf.mechanical_azimuth_max_deg),
        operation_mode: String(rf.operation_mode),
        boresight_azimuth_deg: Number(rf.boresight_azimuth_deg),
        boresight_elevation_deg: Number(rf.boresight_elevation_deg),
        beam_half_angle_deg: Number(Math.max(rf.hpbw_azimuth_deg, rf.hpbw_elevation_deg) / 2),
        pattern_type: String(rf.pattern_type),
        hpbw_azimuth_deg: Number(rf.hpbw_azimuth_deg),
        hpbw_elevation_deg: Number(rf.hpbw_elevation_deg),
        side_lobe_level_db: Number(rf.side_lobe_level_db)
    };
}

function createGroundStationPassQuery(station, satelliteId, startDate, endDate, {
    stepSeconds = GROUND_STATION_ANALYSIS_STEP_SECONDS,
    includeSamples = true,
    chartPaddingSeconds = null
} = {}) {
    const linkContract = getGroundStationPassLinkContract(station, satelliteId);
    const stationInput = createGroundStationPassStationInput(station, linkContract);
    const query = new URLSearchParams({
        sat_id: satelliteId,
        station_lat_deg: String(stationInput.lat_deg),
        station_lon_deg: String(stationInput.lon_deg),
        station_height_m: String(stationInput.height_m),
        min_elevation_deg: String(stationInput.min_elevation_deg),
        max_range_km: String(stationInput.max_range_km),
        mechanical_elevation_min_deg: String(stationInput.mechanical_elevation_min_deg),
        mechanical_elevation_max_deg: String(stationInput.mechanical_elevation_max_deg),
        mechanical_azimuth_min_deg: String(stationInput.mechanical_azimuth_min_deg),
        mechanical_azimuth_max_deg: String(stationInput.mechanical_azimuth_max_deg),
        operation_mode: stationInput.operation_mode,
        boresight_azimuth_deg: String(stationInput.boresight_azimuth_deg),
        boresight_elevation_deg: String(stationInput.boresight_elevation_deg),
        beam_half_angle_deg: String(stationInput.beam_half_angle_deg),
        pattern_type: stationInput.pattern_type,
        hpbw_azimuth_deg: String(stationInput.hpbw_azimuth_deg),
        hpbw_elevation_deg: String(stationInput.hpbw_elevation_deg),
        side_lobe_level_db: String(stationInput.side_lobe_level_db),
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        step_seconds: String(stepSeconds),
        // The next-pass cards need only AOS/LOS.  Keeping this explicit lets
        // the API skip several megabytes of 24-hour chart vertices. The
        // dedicated analysis explicitly requests only the windows needed by
        // its selected-pass elevation chart.
        include_samples: String(Boolean(includeSamples)),
        ...(Number.isFinite(chartPaddingSeconds) && chartPaddingSeconds >= 0
            ? { chart_padding_seconds: String(chartPaddingSeconds) }
            : {})
    });
    return { query, linkContract, stationInput };
}

/**
 * Catalogue objects have a runtime `sat_id` and retain the inexpensive GET
 * route. A workspace manual orbit has no catalogue propagator, so it must
 * post its complete authored definition to the same AOS/LOS endpoint.
 */
function createGroundStationPassRequest(station, satelliteId, startDate, endDate, options = {}) {
    const { query, linkContract, stationInput } = createGroundStationPassQuery(
        station,
        satelliteId,
        startDate,
        endDate,
        options
    );
    const manualOrbit = getManualOrbitProjectEntry(satelliteId);
    if (!manualOrbit) {
        return {
            linkContract,
            method: "GET",
            url: `/api/aos-los?${query}`,
            requestOptions: {},
            analysisWindow: null,
            manualOrbitSignature: ""
        };
    }

    const manualRequest = buildManualAosLosRequest({
        manualOrbit,
        station: stationInput,
        stepSeconds: options.stepSeconds,
        includeSamples: options.includeSamples,
        chartPaddingSeconds: options.chartPaddingSeconds
    });
    return {
        linkContract,
        method: "POST",
        url: "/api/aos-los",
        requestOptions: {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(manualRequest.body)
        },
        analysisWindow: manualRequest.window,
        manualOrbitSignature: manualAosLosSignature(manualOrbit)
    };
}

function evaluateGroundStationTarget(station, stationPosition, satellitePosition, satelliteRfProfile = null) {
    if (!station || !stationPosition || !satellitePosition) {
        return { usable: false, rangeKm: Number.NaN, elevationDeg: Number.NaN, azimuthDeg: Number.NaN, link: null, planningLink: null, downlink: null, fieldOfRegard: null };
    }
    const rangeKm = Cesium.Cartesian3.distance(stationPosition, satellitePosition) / 1000;
    const elevationDeg = computeStationElevationDeg(stationPosition, satellitePosition);
    const azimuthDeg = calculateAzimuthDegrees(Cesium, stationPosition, satellitePosition);
    const fieldOfRegard = evaluateStationFieldOfRegard(station, azimuthDeg, elevationDeg);
    const planningLink = calculateStationPlanningLink(station, rangeKm, { azimuthDeg, elevationDeg });
    const hasSatelliteProfile = satelliteRfProfile && typeof satelliteRfProfile === "object";
    const downlink = hasSatelliteProfile
        ? calculateSatelliteDownlink(station, satelliteRfProfile, rangeKm, { azimuthDeg, elevationDeg })
        : null;
    const link = downlink || planningLink;
    return {
        rangeKm,
        elevationDeg,
        azimuthDeg,
        fieldOfRegard,
        link,
        planningLink,
        downlink,
        link_contract: hasSatelliteProfile ? "actual-downlink" : "reciprocal-planning",
        usable: fieldOfRegard.usable === true && link.usable === true
    };
}

function isGroundStationCoverageVolumeVisible() {
    return viewer?.scene?.mode === Cesium.SceneMode.SCENE3D;
}

function getGroundStationCoverageHalfAngleRadians(station) {
    const model = getGroundStationRfModel(station);
    if (model.operation_mode === "stationary") {
        return Cesium.Math.toRadians(Math.max(0.1, Math.min(89, Math.max(model.hpbw_azimuth_deg, model.hpbw_elevation_deg) / 2)));
    }
    const maskDeg = Math.max(
        model.min_elevation_deg,
        model.mechanical_elevation_min_deg
    );
    // Cesium measures the ellipsoid cone from the local +Z axis. Local +Z is
    // the antenna zenith, therefore elevation 90° is 0° from that axis.
    return Cesium.Math.toRadians(Math.max(0, Math.min(90, 90 - maskDeg)));
}

function getGroundStationUpOrientation(position) {
    return Cesium.Transforms.headingPitchRollQuaternion(
        position,
        new Cesium.HeadingPitchRoll(0, 0, 0)
    );
}

function getGroundStationCoverageOrientation(position, station) {
    const model = getGroundStationRfModel(station);
    if (model.operation_mode !== "stationary") {
        return getGroundStationUpOrientation(position);
    }
    // EllipsoidGraphics uses its local +Z axis as the cone axis. The station
    // mount is expressed in local ENU: azimuth is the heading and the tilt
    // from zenith is 90 degrees minus the requested elevation.
    return Cesium.Transforms.headingPitchRollQuaternion(
        position,
        new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(model.boresight_azimuth_deg),
            Cesium.Math.toRadians(90 - model.boresight_elevation_deg),
            0
        )
    );
}

function removeGroundStationPatternMesh(station) {
    if (!station?.patternPrimitive || !viewer.scene?.primitives) return;
    viewer.scene.primitives.remove(station.patternPrimitive);
    station.patternPrimitive = null;
    station.patternMeshSignature = null;
}

function getGroundStationPatternMeshSignature(station, position, model) {
    const coordinate = (value) => Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "?";
    return [
        station?.id,
        coordinate(position?.x), coordinate(position?.y), coordinate(position?.z),
        station?.point_color,
        coordinate(model?.visual_range_km),
        coordinate(model?.hpbw_azimuth_deg), coordinate(model?.hpbw_elevation_deg),
        coordinate(model?.side_lobe_level_db), model?.pattern_type,
        coordinate(model?.boresight_azimuth_deg), coordinate(model?.boresight_elevation_deg),
        coordinate(model?.min_elevation_deg), coordinate(model?.mechanical_elevation_min_deg), coordinate(model?.mechanical_elevation_max_deg),
        coordinate(model?.mechanical_azimuth_min_deg), coordinate(model?.mechanical_azimuth_max_deg), model?.operation_mode
    ].join("|");
}

function createGroundStationPatternPrimitive(station, position, model) {
    const mesh = model.operation_mode === "stationary"
        ? buildStationPatternMesh(station, { maxRangeKm: model.visual_range_km, azimuthSamples: 48, radialSamples: 12 })
        : buildStationFieldOfRegardMesh(station, { maxRangeKm: model.visual_range_km, azimuthSamples: 48, elevationSamples: 12 });
    if (!mesh.valid || !mesh.positions_enu_m.length || !mesh.indices.length) return null;

    const localToFixed = Cesium.Transforms.eastNorthUpToFixedFrame(position);
    const values = new Float64Array(mesh.positions_enu_m.length);
    const localPoint = new Cesium.Cartesian3();
    const fixedPoint = new Cesium.Cartesian3();
    for (let index = 0; index < mesh.positions_enu_m.length; index += 3) {
        localPoint.x = mesh.positions_enu_m[index];
        localPoint.y = mesh.positions_enu_m[index + 1];
        localPoint.z = mesh.positions_enu_m[index + 2];
        Cesium.Matrix4.multiplyByPoint(localToFixed, localPoint, fixedPoint);
        values[index] = fixedPoint.x;
        values[index + 1] = fixedPoint.y;
        values[index + 2] = fixedPoint.z;
    }
    const geometry = new Cesium.Geometry({
        attributes: {
            position: new Cesium.GeometryAttribute({
                componentDatatype: Cesium.ComponentDatatype.DOUBLE,
                componentsPerAttribute: 3,
                values
            })
        },
        indices: Uint32Array.from(mesh.indices),
        primitiveType: Cesium.PrimitiveType.TRIANGLES,
        boundingSphere: Cesium.BoundingSphere.fromVertices(values)
    });
    const color = Cesium.Color.fromCssColorString(station.point_color || "#3cc4ff").withAlpha(0.18);
    const primitive = new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
            geometry,
            attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(color)
            }
        }),
        appearance: new Cesium.PerInstanceColorAppearance({
            flat: true,
            translucent: true,
            closed: false,
            faceForward: true,
            renderState: {
                depthTest: { enabled: true },
                depthMask: false,
                blending: Cesium.BlendingState.ALPHA_BLEND
            }
        }),
        asynchronous: false,
        allowPicking: false
    });
    return viewer.scene.primitives.add(primitive);
}

function syncGroundStationPatternMesh(station, position, model, show) {
    const shouldShow = show && viewer.scene?.mode === Cesium.SceneMode.SCENE3D;
    if (!shouldShow || !position) {
        removeGroundStationPatternMesh(station);
        return false;
    }
    const signature = getGroundStationPatternMeshSignature(station, position, model);
    if (station.patternPrimitive && station.patternMeshSignature === signature) {
        station.patternPrimitive.show = true;
        return true;
    }
    removeGroundStationPatternMesh(station);
    try {
        station.patternPrimitive = createGroundStationPatternPrimitive(station, position, model);
        station.patternMeshSignature = station.patternPrimitive ? signature : null;
        return Boolean(station.patternPrimitive);
    } catch (error) {
        // The operational gate never relies on this visual mesh. A renderer
        // capability issue should therefore fall back to the Cesium cone,
        // without breaking the station designer or AOS/LOS calculations.
        logger.warn("No se pudo construir la malla RF de la estación", error);
        removeGroundStationPatternMesh(station);
        return false;
    }
}

function refreshGroundStationCoveragePresentation() {
    for (const station of groundStationLayers.values()) {
        applyGroundStationVisuals(station);
    }
    viewer.scene?.requestRender?.();
}

function stationGroundProjectionPoint(station, azimuthDeg, groundRadiusKm, heightMeters) {
    // This is a visual WGS-84-near great-circle projection of the already
    // sampled local RF envelope. It never feeds AOS/LOS; the backend retains
    // exact ITRF/WGS-84 line-of-sight geometry for access decisions.
    const earthRadiusKm = 6_371.0088;
    const angularDistance = Math.max(0, Number(groundRadiusKm) || 0) / earthRadiusKm;
    const latitude = Cesium.Math.toRadians(Number(station.latitude_deg) || 0);
    const longitude = Cesium.Math.toRadians(Number(station.longitude_deg) || 0);
    const bearing = Cesium.Math.toRadians(Number(azimuthDeg) || 0);
    const projectedLatitude = Math.asin(
        (Math.sin(latitude) * Math.cos(angularDistance))
        + (Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing))
    );
    const projectedLongitude = longitude + Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
        Math.cos(angularDistance) - (Math.sin(latitude) * Math.sin(projectedLatitude))
    );
    return Cesium.Cartesian3.fromRadians(projectedLongitude, projectedLatitude, heightMeters);
}

function applyGroundStationFootprint(station, model, visualRangeKm, coverageVisible, showVolume) {
    const entity = station?.coverageEntity;
    if (!entity) return;
    const footprint = sampleStationGroundFootprint(station, {
        azimuthSamples: 72,
        maxRangeKm: visualRangeKm
    });
    if (!footprint.valid || !footprint.samples.length) {
        entity.show = false;
        return;
    }
    const color = Cesium.Color.fromCssColorString(station.point_color || "#3cc4ff");
    const heightMeters = Math.max(250, Number(station.altitude_m) + 250);
    const fullAzimuth = footprint.azimuth_span_deg >= 359.999;
    const simpleDisk = fullAzimuth
        && footprint.max_elevation_deg >= 89.999
        && model.operation_mode !== "stationary";

    if (simpleDisk) {
        const radiusMeters = Math.max(1, Number(footprint.samples[0]?.outer_radius_km) || 0) * 1000;
        entity.polygon = undefined;
        entity.ellipse = {
            semiMajorAxis: radiusMeters,
            semiMinorAxis: radiusMeters,
            granularity: Cesium.Math.toRadians(0.25),
            height: heightMeters,
            material: color.withAlpha(0.11),
            outline: true,
            outlineColor: color.withAlpha(0.74)
        };
    } else {
        const outer = footprint.samples.map((sample) => stationGroundProjectionPoint(
            station,
            sample.azimuth_deg,
            sample.outer_radius_km,
            heightMeters
        ));
        const inner = footprint.samples
            .filter((sample) => Number(sample.inner_radius_km) > 0.001)
            .map((sample) => stationGroundProjectionPoint(
                station,
                sample.azimuth_deg,
                sample.inner_radius_km,
                heightMeters
            ))
            .reverse();
        let hierarchy;
        if (fullAzimuth) {
            // A full elevation-limited mount is a true annulus: the inner
            // ring is the ground intersection at its upper elevation stop.
            hierarchy = new Cesium.PolygonHierarchy(
                outer,
                inner.length >= 3 ? [new Cesium.PolygonHierarchy(inner)] : []
            );
        } else {
            // A restricted azimuth mount is a sector, not a clipped circle.
            // Build one closed contour so its radial side walls connect the
            // outer/inner boundaries. When the upper elevation reaches the
            // zenith there is no inner boundary, so close it at the station.
            const stationCenter = stationGroundProjectionPoint(station, 0, 0, heightMeters);
            const sectorPositions = inner.length >= 2
                ? [...outer, ...inner]
                : [...outer, stationCenter];
            hierarchy = new Cesium.PolygonHierarchy(sectorPositions);
        }
        entity.ellipse = undefined;
        entity.polygon = {
            hierarchy,
            height: heightMeters,
            perPositionHeight: false,
            arcType: Cesium.ArcType.GEODESIC,
            granularity: Cesium.Math.toRadians(0.25),
            material: color.withAlpha(0.11),
            outline: true,
            outlineColor: color.withAlpha(0.74)
        };
    }
    entity.show = coverageVisible && !showVolume;
}

function applyGroundStationVisuals(station) {
    if (!station || !station.entity) {
        return;
    }

    // Restoration can create an initially hidden station. Set this here,
    // alongside its coverage entities, so loading a project has the same
    // visibility result as toggling the Layer eye in a live workspace.
    station.entity.show = station.visible === true;

    const symbolImage = createStationSymbolImage(station.point_symbol, station.point_color, station.point_size_px);
    station.entity.billboard = {
        image: symbolImage,
        width: Math.max(8, Number(station.point_size_px) || 11),
        height: Math.max(8, Number(station.point_size_px) || 11),
        verticalOrigin: Cesium.VerticalOrigin.CENTER
    };
    station.entity.point = undefined;

    const rfModel = getGroundStationRfModel(station);
    const visualRangeKm = Number.isFinite(rfModel.visual_range_km)
        ? rfModel.visual_range_km
        : calculateGroundStationRadioRangeKm(station);
    const coverageVisible = station.visible === true && station.coverage_visible !== false;
    const showVolume = coverageVisible && isGroundStationCoverageVolumeVisible();
    // A full-travel tracking/scan mount is a disk. Restricted azimuth,
    // elevation ceilings, and stationary directivity instead become a sector
    // or annular sector. Never draw a convenient but false 360 degree circle.
    applyGroundStationFootprint(station, rfModel, visualRangeKm, coverageVisible, showVolume);

    const coveragePosition = station.coverageVolumeEntity?.position?.getValue(Cesium.JulianDate.now());
    const hasPatternMesh = syncGroundStationPatternMesh(station, coveragePosition, rfModel, showVolume);
    if (station.coverageVolumeEntity?.ellipsoid) {
        const rangeMeters = visualRangeKm * 1000;
        station.coverageVolumeEntity.ellipsoid.radii = new Cesium.Cartesian3(rangeMeters, rangeMeters, rangeMeters);
        station.coverageVolumeEntity.ellipsoid.minimumCone = 0;
        station.coverageVolumeEntity.ellipsoid.maximumCone = getGroundStationCoverageHalfAngleRadians(station);
        station.coverageVolumeEntity.ellipsoid.material = Cesium.Color.fromCssColorString(station.point_color || "#3cc4ff").withAlpha(0.09);
        station.coverageVolumeEntity.ellipsoid.outlineColor = Cesium.Color.fromCssColorString(station.point_color || "#3cc4ff").withAlpha(0.78);
        station.coverageVolumeEntity.orientation = getGroundStationCoverageOrientation(coveragePosition, station);
        // This is only a fallback for renderer capability failures. The
        // custom mesh above is the accurate visual: it clips mount azimuth
        // and elevation in tracking/scan and uses the directional pattern in
        // stationary mode. Do not expose a misleading circular fallback for
        // a restricted mount.
        const fullAzimuthTravel = Math.abs(Number(rfModel.mechanical_azimuth_max_deg) - Number(rfModel.mechanical_azimuth_min_deg)) >= 359.999
            || Math.abs(Number(rfModel.mechanical_azimuth_max_deg) - Number(rfModel.mechanical_azimuth_min_deg)) < 1e-9;
        const genericFallbackIsFaithful = fullAzimuthTravel
            && Number(rfModel.mechanical_elevation_max_deg) >= 89.999
            && rfModel.operation_mode !== "stationary";
        station.coverageVolumeEntity.show = showVolume && !hasPatternMesh && genericFallbackIsFaithful;
    }
}

function clearGroundStationPreview() {
    if (!groundStationPreview) return;
    removeGroundStationPatternMesh(groundStationPreview);
    for (const entity of [groundStationPreview.entity, groundStationPreview.coverageEntity, groundStationPreview.coverageVolumeEntity]) {
        if (entity) viewer.entities.remove(entity);
    }
    groundStationPreview = null;
}

// The station designer must be able to show the exact RF envelope without
// publishing a temporary layer into Layers, the project document, or pass
// analysis. Confirmation is the only operation that creates a station layer.
function previewGroundStation(params = {}) {
    const latitudeDeg = Number(params.latitude_deg);
    const longitudeDeg = Number(params.longitude_deg);
    if (!Number.isFinite(latitudeDeg) || latitudeDeg < -90 || latitudeDeg > 90
        || !Number.isFinite(longitudeDeg) || longitudeDeg < -180 || longitudeDeg > 180) {
        clearGroundStationPreview();
        return null;
    }
    const altitudeM = Number.isFinite(Number(params.altitude_m)) ? Number(params.altitude_m) : 0;
    const position = Cesium.Cartesian3.fromDegrees(longitudeDeg, latitudeDeg, altitudeM);
    if (!groundStationPreview) {
        groundStationPreview = {
            id: "__ground-station-preview__",
            visible: true,
            entity: viewer.entities.add({
                id: "__ground-station-preview__-entity",
                position,
                label: {
                    text: "PREVIEW",
                    font: "600 12px sans-serif",
                    fillColor: Cesium.Color.fromCssColorString("#9ef1b9"),
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -14)
                }
            }),
            coverageEntity: viewer.entities.add({
                id: "__ground-station-preview__-coverage",
                position,
                ellipse: { semiMajorAxis: 1, semiMinorAxis: 1, outline: true }
            }),
            coverageVolumeEntity: viewer.entities.add({
                id: "__ground-station-preview__-coverage-volume",
                position,
                ellipsoid: { radii: new Cesium.Cartesian3(1, 1, 1), minimumCone: 0, maximumCone: Cesium.Math.PI_OVER_TWO, outline: true },
                orientation: getGroundStationUpOrientation(position)
            })
        };
    }
    Object.assign(groundStationPreview, {
        name: String(params.name || "Estación terrestre").trim() || "Estación terrestre",
        latitude_deg: latitudeDeg,
        longitude_deg: longitudeDeg,
        altitude_m: altitudeM,
        time_zone: String(params.time_zone || "UTC").trim() || "UTC",
        min_elevation_deg: Number.isFinite(Number(params.min_elevation_deg)) ? Number(params.min_elevation_deg) : 10,
        ...getGroundStationRfAuthoredFields(params),
        point_size_px: Number(params.point_size_px),
        point_color: String(params.point_color || "#3cc4ff"),
        point_symbol: String(params.point_symbol || "circle"),
        coverage_visible: params.coverage_visible !== false
    });
    groundStationPreview.entity.position = position;
    groundStationPreview.coverageEntity.position = position;
    groundStationPreview.coverageVolumeEntity.position = position;
    groundStationPreview.entity.label.text = `PREVIEW · ${groundStationPreview.name}`;
    applyGroundStationVisuals(groundStationPreview);
    const rfModel = getGroundStationRfModel(groundStationPreview);
    return {
        radio_range_km: groundStationPreview.radio_range_km,
        ground_footprint_radius_km: groundStationPreview.ground_footprint_radius_km,
        rf: rfModel
    };
}

function getReusableGroundStationSequence(value) {
    const match = /^gst:([1-9]\d{0,6})$/.exec(String(value || "").trim());
    if (!match) {
        return null;
    }
    const sequence = Number(match[1]);
    return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : null;
}

function reserveGroundStationLayerId(requestedId = null) {
    const requested = String(requestedId || "").trim();
    const requestedSequence = getReusableGroundStationSequence(requested);
    if (requestedSequence !== null && !groundStationLayers.has(requested)) {
        groundStationSequence = Math.max(groundStationSequence, requestedSequence + 1);
        return requested;
    }

    let stationId = `gst:${groundStationSequence++}`;
    while (groundStationLayers.has(stationId)) {
        stationId = `gst:${groundStationSequence++}`;
    }
    return stationId;
}

function restoreGroundStationsFromProject(entries) {
    const restored = [];
    const failed = [];
    const idMap = {};
    const seenRequestedIds = new Set();

    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            failed.push({ id: null, reason: "invalid-record" });
            continue;
        }
        const requestedId = String(entry.id || "").trim();
        if (requestedId && seenRequestedIds.has(requestedId)) {
            failed.push({ id: requestedId, reason: "duplicate-id" });
            continue;
        }
        if (requestedId) {
            seenRequestedIds.add(requestedId);
        }

        try {
            const stationId = createGroundStationLayer(entry);
            if (!stationId) {
                failed.push({ id: requestedId || null, reason: "invalid-geometry" });
                continue;
            }
            if (requestedId && requestedId !== stationId) {
                idMap[requestedId] = stationId;
            }
            restored.push(stationId);
        } catch (error) {
            logger.warn("No se pudo restaurar una estacion terrestre", error);
            failed.push({ id: requestedId || null, reason: "restore-failed" });
        }
    }

    return { restored, failed, idMap };
}

function createGroundStationLayer(params = {}) {
    const lat = Number(params.latitude_deg);
    const lon = Number(params.longitude_deg);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
    }

    const stationId = reserveGroundStationLayerId(params.id);
    const altitudeM = Number.isFinite(Number(params.altitude_m)) ? Number(params.altitude_m) : 0;
    const timeZone = String(params.time_zone || "UTC").trim() || "UTC";
    const minElevationDeg = Number.isFinite(Number(params.min_elevation_deg)) ? Number(params.min_elevation_deg) : 10;
    const rfAuthoredFields = getGroundStationRfAuthoredFields(params);
    const rfModel = calculateStationRfModel({ ...params, ...rfAuthoredFields });
    const coverageRadiusKm = Number.isFinite(rfModel.ground_footprint_radius_km) ? rfModel.ground_footprint_radius_km : 1;
    const pointSizePx = Number.isFinite(Number(params.point_size_px)) ? Number(params.point_size_px) : 11;
    const pointColor = String(params.point_color || "#3cc4ff").trim() || "#3cc4ff";
    const pointSymbol = String(params.point_symbol || "circle").trim() || "circle";
    const coverageVisible = params.coverage_visible !== false;
    const monitoredSatelliteIds = Array.isArray(params.monitor_satellite_ids)
        ? params.monitor_satellite_ids.map((id) => String(id || "").trim()).filter(Boolean)
        : [];
    const stationSequence = getReusableGroundStationSequence(stationId) || Math.max(1, groundStationSequence - 1);
    const displayName = String(params.name || `Estacion ${stationSequence}`).trim() || `Estacion ${stationSequence}`;

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
            granularity: Cesium.Math.toRadians(0.25),
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
    const coverageVolumeEntity = viewer.entities.add({
        id: `${stationId}-coverage-volume`,
        position,
        ellipsoid: {
            radii: new Cesium.Cartesian3(1, 1, 1),
            minimumCone: 0,
            maximumCone: Cesium.Math.PI_OVER_TWO,
            material: Cesium.Color.fromCssColorString(pointColor).withAlpha(0.09),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString(pointColor).withAlpha(0.78)
        },
        orientation: getGroundStationUpOrientation(position),
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
        time_zone: timeZone,
        min_elevation_deg: minElevationDeg,
        ...rfAuthoredFields,
        coverage_radius_km: coverageRadiusKm,
        point_size_px: pointSizePx,
        point_color: pointColor,
        point_symbol: pointSymbol,
        coverage_visible: coverageVisible,
        monitor_satellite_ids: monitoredSatelliteIds,
        visible: params.visible !== false,
        entity: stationEntity,
        coverageEntity,
        coverageVolumeEntity
    });

    applyGroundStationVisuals(groundStationLayers.get(stationId));
    syncGroundStationVisibilityLinks();

    if (!layerDisplayNameOverrides.has(stationId)) {
        layerDisplayNameOverrides.set(stationId, displayName);
    }
    return stationId;
}

function getGroundStationParams(layerId) {
    const station = groundStationLayers.get(layerId);
    if (!station) {
        return null;
    }
    const rfModel = getGroundStationRfModel(station);
    return {
        name: station.name,
        latitude_deg: station.latitude_deg,
        longitude_deg: station.longitude_deg,
        altitude_m: station.altitude_m,
        time_zone: station.time_zone || "UTC",
        min_elevation_deg: station.min_elevation_deg,
        ...getGroundStationRfAuthoredFields(station),
        radio_range_km: station.radio_range_km,
        ground_footprint_radius_km: station.ground_footprint_radius_km,
        point_size_px: station.point_size_px,
        point_symbol: station.point_symbol,
        point_color: station.point_color,
        coverage_visible: station.coverage_visible !== false,
        monitor_satellite_ids: [...(station.monitor_satellite_ids || [])],
        rf_metrics: rfModel
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
    station.time_zone = String(patch.time_zone || station.time_zone || "UTC").trim() || "UTC";
    station.min_elevation_deg = Number.isFinite(Number(patch.min_elevation_deg)) ? Number(patch.min_elevation_deg) : station.min_elevation_deg;
    Object.assign(station, getGroundStationRfAuthoredFields({ ...station, ...patch }));
    station.point_size_px = Number.isFinite(Number(patch.point_size_px)) ? Number(patch.point_size_px) : station.point_size_px;
    station.point_symbol = String(patch.point_symbol || station.point_symbol || "circle").trim() || "circle";
    station.point_color = String(patch.point_color || station.point_color || "#3cc4ff").trim() || "#3cc4ff";
    // An edit to an RF/text field must not resurrect a deliberately hidden
    // coverage overlay. Only an explicit checkbox value changes visibility.
    if (patch.coverage_visible !== undefined) {
        station.coverage_visible = patch.coverage_visible !== false;
    }

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
    if (station.coverageVolumeEntity) {
        station.coverageVolumeEntity.position = nextPosition;
    }

    layerDisplayNameOverrides.set(layerId, station.name);
    applyGroundStationVisuals(station);
    syncGroundStationVisibilityLinks();
    // A pass table is derived from the station contract, so never retain a
    // calculation made with its previous mask/RF/location values.
    cancelGroundStationPassAnalysis();
    window.dispatchEvent(new CustomEvent("orbit:ground-stations-analysis-result", {
        detail: {
            error: "La configuración de la estación ha cambiado. Vuelve a analizar los pases.",
            passes: [],
            samples: [],
            visibleNow: false
        }
    }));
    emitObjectStateChanged({ layerId, sourceId: layerId, reason: "configuration" });
    publishGroundStationsState();
    return true;
}

function buildGroundStationTelemetry(layerId) {
    const station = groundStationLayers.get(layerId);
    if (!station) {
        return null;
    }

    const now = getDisplayedSimulationDate();
    return groundStationTelemetryService.build(station, {
        startDate: simulationState.mode === SIMULATION_MODE_RANGE ? simulationState.startDate : now,
        endDate: simulationState.mode === SIMULATION_MODE_RANGE ? simulationState.endDate : new Date(now.getTime() + (6 * 3600 * 1000))
    });
}

function getSimulationTelemetryContext() {
    const isRangeMode = simulationState.mode === SIMULATION_MODE_RANGE;
    const isStaticMode = simulationState.mode === SIMULATION_MODE_STATIC;
    const currentDate = getDisplayedSimulationDate();
    const currentTime = currentDate instanceof Date && !Number.isNaN(currentDate.getTime())
        ? currentDate.toISOString()
        : null;
    const configuredScale = Number(simulationState.speed);

    return {
        mode: isRangeMode ? "simulated" : (isStaticMode ? "static" : "realtime"),
        current_time: currentTime,
        time_scale: isRangeMode && Number.isFinite(configuredScale) && configuredScale > 0 ? configuredScale : 1,
        is_playing: isStaticMode ? false : Boolean(simulationState.isPlaying)
    };
}

function getCompositeLayerTelemetry(layerId) {
    if (isCelestialBodyLayerId(layerId)) {
        const telemetry = celestialBodyLayers.getTelemetry(layerId);
        return telemetry ? { ...telemetry, id: getLayerDisplayName(layerId), simulation: getSimulationTelemetryContext() } : null;
    }
    if (isGroundStationLayerId(layerId)) {
        const telemetry = buildGroundStationTelemetry(layerId);
        return telemetry ? { ...telemetry, simulation: getSimulationTelemetryContext() } : null;
    }

    const sourceId = getSatelliteSourceIdFromLayerId(layerId);
    const telemetry = getSatelliteTelemetry(sourceId);
    if (!telemetry) {
        return null;
    }

    return {
        ...telemetry,
        id: getLayerDisplayName(layerId),
        simulation: getSimulationTelemetryContext()
    };
}

function getCompositeLayerEntity(layerId) {
    if (isCelestialBodyLayerId(layerId)) {
        return celestialBodyLayers.getEntity(layerId);
    }
    if (isGroundStationLayerId(layerId)) {
        return groundStationLayers.get(layerId)?.entity || null;
    }
    const sourceId = getSatelliteSourceIdFromLayerId(layerId);
    return getSatelliteEntity(sourceId);
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
    // The manual editor deliberately owns a clean scene. The global search
    // remains visible in the top toolbar, so guard its command path as well
    // as the disabled Layers controls; otherwise a search result could add a
    // live satellite in the middle of an isolated design session.
    if (manualOrbitDesignSession?.active) {
        publishManualOrbitStatus("error", "Cierra el modo de diseño orbital antes de añadir o seleccionar capas.");
        return;
    }

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

window.addEventListener("orbit:global-search-select", (event) => {
    selectSatelliteFromGlobalSearch(event.detail);
});

function setupTopSearchAutocomplete() {
    const searchInput = document.getElementById("objectSearch");
    const searchWrap = document.querySelector("#topToolbar .toolbar-search-wrap");
    if (!searchInput || !searchWrap) {
        return;
    }

    if (searchInput.dataset.reactOwned === "true") {
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
        if (!query) {
            topSearchSuggestions = [];
            closeTopSearchSuggestions();
            return;
        }

        const token = ++topSearchRequestToken;
        try {
            const items = await catalogSearch.search(query);
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
    // React owns the visible controls and receives a complete state snapshot.
    window.dispatchEvent(new CustomEvent("orbit:simulation-state", {
        detail: {
            mode: simulationState.mode,
            isPlaying: simulationState.isPlaying,
            isPaused: simulationState.isPlaying === false,
            speed: simulationState.speed,
            oemDomainActive: hasLoadedOemEphemerisTracks(),
            currentDate: getDisplayedSimulationDate().toISOString(),
            startDate: simulationState.startDate.toISOString(),
            endDate: simulationState.endDate.toISOString(),
            timelineStep: Math.floor(getTimelineRatioByDate(getDisplayedSimulationDate()) * SIMULATION_TIMELINE_STEPS),
            timelineSteps: SIMULATION_TIMELINE_STEPS
        }
    }));
}

function refreshSimulationControlsUi() {
    if (simulationUiBusy) {
        return;
    }

    simulationUiBusy = true;
    updateTelemetryTimeContext();
    updateSimulationTimelineUi();
    simulationUiBusy = false;
}

function updateTelemetryTimeContext() {
    // Keep the telemetry panel status aligned with the active time domain.
    const subtitle = document.querySelector("#leftInfoPanel .telemetry-panel-subtitle");
    if (!subtitle) return;
    const isRangeMode = simulationState.mode === SIMULATION_MODE_RANGE;
    const isStaticMode = simulationState.mode === SIMULATION_MODE_STATIC;
    subtitle.classList.toggle("is-simulated", isRangeMode);
    subtitle.lastChild.textContent = isRangeMode
        ? " SIMULACIÓN EN RANGO"
        : (isStaticMode ? " TIEMPO ESTATICO" : (simulationState.isPlaying === false ? " REAL TIME PAUSED" : " DATOS EN TIEMPO REAL"));
}

function setSimulationMode(mode) {
    const previousMode = simulationState.mode;
    const displayedDate = getDisplayedSimulationDate();
    const normalized = [SIMULATION_MODE_REALTIME, SIMULATION_MODE_RANGE, SIMULATION_MODE_STATIC].includes(mode)
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

    cancelGroundStationPassAnalysis();
    simulationState.mode = normalized;

    if (normalized === SIMULATION_MODE_REALTIME) {
        simulationState.isPlaying = true;
        simulationState.playing = true;
        simulationState.rewind = false;
        simulationState.speed = 1;
        simulationState.currentDate = new Date();
    } else if (normalized === SIMULATION_MODE_STATIC) {
        // Static mode freezes the exact frame currently on screen. Keeping it
        // distinct from paused realtime makes renderers sample this orbital
        // state instead of continuing to consume live WebSocket positions.
        simulationState.currentDate = new Date(displayedDate);
        simulationState.isPlaying = false;
        simulationState.playing = false;
        simulationState.rewind = false;
        simulationState.speed = 1;
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
        simulationState.playing = simulationState.isPlaying === true;
    }

    simulationState.lastTickTimestamp = Date.now();
    applySimulationDateToViewer(getDisplayedSimulationDate());
    syncViewerClockPlayback();
    refreshSatelliteOverlays(viewer);
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

    const displayedTimeMs = getDisplayedSimulationDate().getTime();
    if (!setSimulationRange(simulationState, new Date(startMs), new Date(endMs))) {
        return false;
    }
    cancelGroundStationPassAnalysis();
    simulationState.currentDate = new Date(clamp(displayedTimeMs, startMs, endMs));
    simulationState.rewind = false;

    const targetHours = getRangeHours(startMs, endMs);
    if (Number.isFinite(targetHours) && targetHours > 0) {
        setOrbitConfig({ propagation_hours: targetHours });
        persistSystemSectionPatch("orbit", { propagation_hours: targetHours });
    }

    if (simulationState.mode === SIMULATION_MODE_REALTIME) {
        simulationState.mode = SIMULATION_MODE_RANGE;
    }
    applySimulationDateToViewer(simulationState.currentDate);
    syncViewerClockPlayback();
    refreshSatelliteOverlays(viewer);
    refreshSimulationControlsUi();
    updateTopToolbarTime();
    return true;
}

function clearGroundStationAnalysisVisuals() {
    if (groundStationAnalysisLink) {
        viewer.entities.remove(groundStationAnalysisLink);
        groundStationAnalysisLink = null;
    }
}

// Every active orbital layer gets a lightweight callback polyline for every
// visible ground station. The callback returns no positions below the station
// mask or outside the RF envelope, so no station/satellite association is
// persisted merely to show the live operational geometry.
function syncGroundStationVisibilityLinks() {
    const desired = new Set();
    const satelliteLayerIds = getCompositeLayerIds()
        .filter((id) => !isGroundStationLayerId(id) && !isCelestialBodyLayerId(id))
        .filter((id) => isCompositeLayerActive(id));
    for (const station of groundStationLayers.values()) {
        if (!station?.visible) continue;
        for (const satelliteLayerId of satelliteLayerIds) {
            const satellite = getCompositeLayerEntity(satelliteLayerId);
            if (!satellite?.position) continue;
            const key = `${station.id}:${satelliteLayerId}`;
            desired.add(key);
            if (groundStationVisibilityLinks.has(key)) continue;
            const entity = viewer.entities.add({
                id: `ground-station-visibility:${key}`,
                polyline: {
                    positions: new Cesium.CallbackProperty((time) => {
                        const currentStation = groundStationLayers.get(station.id);
                        const satellitePosition = satellite.position?.getValue?.(time);
                        if (!currentStation?.visible || !isCompositeLayerActive(satelliteLayerId) || !satellitePosition) return [];
                        const stationPosition = Cesium.Cartesian3.fromDegrees(currentStation.longitude_deg, currentStation.latitude_deg, currentStation.altitude_m);
                        const satelliteId = getSatelliteSourceIdFromLayerId(satelliteLayerId);
                        const satelliteRfProfile = getCatalogEntryMeta(satelliteId)?.rfProfile || null;
                        // If a remote RF profile is present, a green line is a
                        // real downlink that closes, not a planning-only
                        // envelope. Layers without RF metadata retain the
                        // explicitly reciprocal planning presentation.
                        return evaluateGroundStationTarget(currentStation, stationPosition, satellitePosition, satelliteRfProfile).usable
                            ? [stationPosition, satellitePosition]
                            : [];
                    }, false),
                    width: 1.7,
                    material: Cesium.Color.fromCssColorString("#69f0a5").withAlpha(0.9)
                },
                properties: { layerType: "GROUND_STATION_VISIBILITY", stationId: station.id, satelliteLayerId }
            });
            groundStationVisibilityLinks.set(key, entity);
        }
    }
    for (const [key, entity] of groundStationVisibilityLinks) {
        if (!desired.has(key)) {
            viewer.entities.remove(entity);
            groundStationVisibilityLinks.delete(key);
        }
    }
}

function showGroundStationAnalysisVisuals(station, satelliteLayerId, minimumElevationDeg) {
    clearGroundStationAnalysisVisuals();
    const satellite = getCompositeLayerEntity(satelliteLayerId);
    if (!station || !satellite?.position) return;
    const satelliteId = getSatelliteSourceIdFromLayerId(satelliteLayerId);
    const satelliteRfProfile = getCatalogEntryMeta(satelliteId)?.rfProfile || null;
    const stationPosition = Cesium.Cartesian3.fromDegrees(station.longitude_deg, station.latitude_deg, station.altitude_m);
    groundStationAnalysisLink = viewer.entities.add({
        id: `ground-station-link:${station.id}`,
        polyline: {
            positions: new Cesium.CallbackProperty((time) => {
                const satellitePosition = satellite.position?.getValue?.(time);
                if (!satellitePosition) return [];
                const target = evaluateGroundStationTarget(station, stationPosition, satellitePosition, satelliteRfProfile);
                if (!target.usable || target.elevationDeg < minimumElevationDeg) return [];
                return [stationPosition, satellitePosition];
            }, false),
            width: 1.8,
            material: Cesium.Color.fromCssColorString("#69f0a5").withAlpha(0.88)
        },
        properties: { layerType: "GROUND_STATION_ANALYSIS" }
    });
}

function publishGroundStationsState() {
    const stations = [...groundStationLayers.values()].map((station) => {
        const rf = getGroundStationRfModel(station);
        return {
            id: station.id,
            name: station.name,
            latitude_deg: station.latitude_deg,
            longitude_deg: station.longitude_deg,
            altitude_m: station.altitude_m,
            time_zone: station.time_zone || "UTC",
            min_elevation_deg: station.min_elevation_deg,
            frequency_mhz: rf.frequency_mhz,
            frequency_hz: rf.frequency_mhz * 1e6,
            frequency_unit: rf.frequency_unit,
            tx_power_unit: rf.tx_power_unit,
            tx_power_dbm: rf.tx_power_dbm,
            tx_power_w: rf.tx_power_w,
            tx_gain_dbi: rf.tx_gain_dbi,
            rx_gain_dbi: rf.rx_gain_dbi,
            min_link_power_dbm: rf.min_link_power_dbm,
            radio_range_km: station.radio_range_km,
            ground_footprint_radius_km: station.ground_footprint_radius_km,
            monitor_satellite_ids: [...(station.monitor_satellite_ids || [])],
            rf: {
                station_schema_version: station.station_schema_version || 2,
                antenna_diameter_m: rf.antenna_diameter_m,
                antenna_efficiency: rf.antenna_efficiency,
                polarization: rf.polarization,
                pattern_type: rf.pattern_type,
                operation_mode: rf.operation_mode,
                gain_max_dbi: rf.gain_max_dbi,
                hpbw_azimuth_deg: rf.hpbw_azimuth_deg,
                hpbw_elevation_deg: rf.hpbw_elevation_deg,
                pointing_loss_db: rf.pointing_loss_db,
                total_system_loss_db: rf.total_system_loss_db,
                system_gt_db_per_k: rf.system_gt_db_per_k,
                receiver_noise_floor_dbm: rf.receiver_noise_floor_dbm,
                range_contract: rf.range_contract
            }
        };
    });
    const satellites = getCompositeLayerIds()
        .filter((id) => !isGroundStationLayerId(id) && !isCelestialBodyLayerId(id))
        .map((id) => ({ id, name: getLayerDisplayName(id) }));
    window.dispatchEvent(new CustomEvent("orbit:ground-stations-state", {
        detail: { stations, satellites, now: getDisplayedSimulationDate()?.toISOString?.() || null }
    }));
}

const GROUND_STATION_IMPORT_ACCEPT = ".geojson,.geo.json,.orbit-ground-stations.json,.orbit.json,.json,.csv,application/geo+json,application/json,text/csv";
const GROUND_STATION_IMPORT_MAX_BYTES = 5 * 1024 * 1024;

function groundStationExportFileName(stations, format) {
    const extensionByFormat = {
        [GROUND_STATION_EXPORT_FORMATS.GEOJSON]: ".geojson",
        [GROUND_STATION_EXPORT_FORMATS.ORBIT_JSON]: ".json",
        [GROUND_STATION_EXPORT_FORMATS.CSV]: ".csv"
    };
    const extension = extensionByFormat[format] || ".geojson";
    if (stations.length !== 1) return `orbit-ground-stations${extension}`;
    const stem = String(stations[0]?.name || stations[0]?.id || "station")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^-+|-+$/g, "") || "station";
    return `orbit-ground-station-${stem}${extension}`;
}

function groundStationExportLabel(format) {
    if (format === GROUND_STATION_EXPORT_FORMATS.ORBIT_JSON) return "Orbit JSON";
    if (format === GROUND_STATION_EXPORT_FORMATS.CSV) return "CSV";
    return "GeoJSON";
}

function getGroundStationsForExport(stationId = null) {
    const requestedId = String(stationId || "").trim();
    const selected = requestedId ? groundStationLayers.get(requestedId) : null;
    return requestedId ? (selected ? [selected] : []) : [...groundStationLayers.values()];
}

function exportGroundStations(stationId = null, format = GROUND_STATION_EXPORT_FORMATS.GEOJSON) {
    const stations = getGroundStationsForExport(stationId);
    if (!stations.length) {
        void showAppAlert(stationId
            ? "La estación seleccionada ya no está disponible para exportar."
            : "No hay estaciones de tierra para exportar.");
        return null;
    }

    try {
        const exported = downloadGroundStationsExport(stations, format, {
            fileName: groundStationExportFileName(stations, format)
        });
        const exportedCount = format === GROUND_STATION_EXPORT_FORMATS.GEOJSON
            ? exported.document.features.length
            : (format === GROUND_STATION_EXPORT_FORMATS.ORBIT_JSON
                ? exported.document.stations.length
                : stations.filter((station) => Number.isFinite(Number(station?.latitude_deg)) && Number.isFinite(Number(station?.longitude_deg))).length);
        if (!exportedCount) {
            void showAppAlert("No se pudo exportar ninguna estación: revisa que las coordenadas WGS-84 sean válidas.");
            return exported;
        }
        void showAppAlert(`${groundStationExportLabel(format)} exportado: ${exportedCount} ${exportedCount === 1 ? "estación" : "estaciones"}.`);
        return exported;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        void showAppAlert(`No se pudo exportar las estaciones: ${reason}`);
        return null;
    }
}

async function importGroundStationsFile(file) {
    if (!file || typeof file.text !== "function") {
        return { imported: [], rejected: [], error: "No se seleccionó ningún archivo de estaciones." };
    }
    if (Number.isFinite(Number(file.size)) && Number(file.size) > GROUND_STATION_IMPORT_MAX_BYTES) {
        const limitMb = GROUND_STATION_IMPORT_MAX_BYTES / (1024 * 1024);
        const message = `El archivo de estaciones supera el límite de ${limitMb} MB.`;
        void showAppAlert(message);
        return { imported: [], rejected: [], error: message };
    }

    try {
        const parsed = parseGroundStationsDocument(await file.text(), { fileName: file.name || "" });
        const imported = [];
        const rejected = [...parsed.rejected];
        for (const station of parsed.stations) {
            try {
                const id = createGroundStationLayer(station);
                if (id) {
                    imported.push(id);
                } else {
                    rejected.push({ id: station.id || null, reason: "invalid-station" });
                }
            } catch (error) {
                logger.warn("No se pudo importar una estación terrestre", error);
                rejected.push({ id: station.id || null, reason: "create-failed" });
            }
        }

        if (imported.length) {
            openLeftSatellitesPanel();
            objectSidebar?.renderList?.();
            publishGroundStationsState();
        }
        const format = groundStationExportLabel(parsed.format);
        if (!imported.length) {
            const message = `No se pudo importar ninguna estación desde ${file.name || "el archivo"}.`;
            void showAppAlert(rejected.length ? `${message} Se rechazaron ${rejected.length} registros inválidos.` : message);
        } else {
            const rejectedText = rejected.length ? ` Se omitieron ${rejected.length} registros inválidos.` : "";
            void showAppAlert(`${format}: se importaron ${imported.length} ${imported.length === 1 ? "estación" : "estaciones"}.${rejectedText}`);
        }
        return { imported, rejected, format: parsed.format };
    } catch (error) {
        const message = error instanceof GroundStationInterchangeError || error instanceof Error
            ? error.message
            : String(error);
        void showAppAlert(`No se pudo importar ${file.name || "el archivo"}: ${message}`);
        return { imported: [], rejected: [], error: message };
    }
}

function requestGroundStationImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = GROUND_STATION_IMPORT_ACCEPT;
    input.hidden = true;
    input.addEventListener("change", () => {
        const file = input.files?.[0] || null;
        input.remove();
        if (file) {
            void importGroundStationsFile(file);
        }
    }, { once: true });
    document.body.appendChild(input);
    input.click();
}

function cancelGroundStationPassAnalysis() {
    groundStationAnalysisRequestSequence += 1;
    if (groundStationAnalysisAbortController) {
        groundStationAnalysisAbortController.abort();
        groundStationAnalysisAbortController = null;
    }
}

function groundStationAnalysisSignature(station) {
    if (!station) return "";
    const rf = getGroundStationRfModel(station);
    return [
        station.latitude_deg,
        station.longitude_deg,
        station.altitude_m,
        station.min_elevation_deg,
        rf.frequency_mhz,
        rf.tx_power_dbm,
        rf.tx_gain_dbi,
        rf.rx_gain_dbi,
        rf.min_link_power_dbm,
        rf.antenna_diameter_m,
        rf.antenna_efficiency,
        rf.hpbw_azimuth_deg,
        rf.hpbw_elevation_deg,
        rf.pattern_type,
        rf.side_lobe_level_db,
        rf.system_temperature_k,
        rf.atmospheric_loss_db,
        rf.rain_loss_db,
        rf.cable_loss_db,
        rf.connector_loss_db,
        rf.pointing_rms_mdeg,
        rf.operation_mode,
        rf.boresight_azimuth_deg,
        rf.boresight_elevation_deg,
        rf.mechanical_elevation_min_deg,
        rf.mechanical_elevation_max_deg,
        rf.mechanical_azimuth_min_deg,
        rf.mechanical_azimuth_max_deg,
        rf.reference_rx_gain_dbi,
        rf.reference_rx_threshold_dbm
    ].join("|");
}

function isCurrentGroundStationPassAnalysis({ requestId, stationId, station, stationSignature, satelliteLayerId, satelliteId, satelliteRfSignature, manualOrbitSignature = "", analysisWindow }) {
    if (requestId !== groundStationAnalysisRequestSequence) return false;
    if (groundStationLayers.get(stationId) !== station) return false;
    if (groundStationAnalysisSignature(station) !== stationSignature) return false;
    if (getSatelliteSourceIdFromLayerId(satelliteLayerId) !== satelliteId) return false;
    if (satelliteRfProfileSignature(satelliteId) !== satelliteRfSignature) return false;

    // A manual layer owns a fixed design interval. It is intentionally not
    // invalidated when an operator changes the global simulation clock, but
    // must be discarded if the authored orbit itself is edited or removed.
    if (manualOrbitSignature) {
        try {
            return manualAosLosSignature(getManualOrbitProjectEntry(satelliteId)) === manualOrbitSignature;
        } catch {
            return false;
        }
    }

    const currentWindow = getGroundStationAnalysisWindow();
    if (currentWindow.source !== analysisWindow.source) return false;
    // Range simulation has fixed endpoints, therefore its response must be
    // discarded if the operator has changed either endpoint while it was in
    // flight. Realtime deliberately advances while an analysis is running.
    if (analysisWindow.source !== "simulation-range") return true;
    return currentWindow.startDate.getTime() === analysisWindow.startDate.getTime()
        && currentWindow.endDate.getTime() === analysisWindow.endDate.getTime();
}

async function groundStationPassResponseError(response) {
    let detail = null;
    try {
        const payload = await response.json();
        detail = payload?.detail ?? payload?.message ?? payload?.error ?? null;
    } catch {
        // A proxy or an unexpected upstream failure may not return JSON.
        try {
            detail = (await response.text()).trim() || null;
        } catch {
            detail = null;
        }
    }

    const describeDetail = (value) => {
        if (Array.isArray(value)) {
            return value.map((item) => {
                if (typeof item === "string") return item;
                if (!item || typeof item !== "object") return "";
                const location = Array.isArray(item.loc) ? item.loc.filter((part) => part !== "body").join(".") : "";
                const message = String(item.msg || item.message || "").trim();
                return location && message ? `${location}: ${message}` : message;
            }).filter(Boolean).join("; ");
        }
        if (value && typeof value === "object") {
            return String(value.message || value.error || JSON.stringify(value)).trim();
        }
        return typeof value === "string" ? value.trim() : "";
    };

    const reason = describeDetail(detail);
    return new Error(`El servicio AOS/LOS rechazó la solicitud (HTTP ${response.status})${reason ? `: ${reason}` : "."}`);
}

async function analyzeGroundStationPasses(detail = {}) {
    const stationId = String(detail.stationId || "").trim();
    const satelliteLayerId = String(detail.satelliteId || "").trim();
    const station = groundStationLayers.get(stationId);
    const satelliteId = getSatelliteSourceIdFromLayerId(satelliteLayerId);
    // Visibility is defined by the station contract. Never accept a separate
    // analysis threshold, otherwise a stale panel can disagree with the
    // station shown in Layers and with the live antenna links.
    const minElevationDeg = Math.max(0, Math.min(90, Number(station?.min_elevation_deg)));
    if (!station || !satelliteId || !Number.isFinite(minElevationDeg)) {
        window.dispatchEvent(new CustomEvent("orbit:ground-stations-analysis-result", { detail: { error: "Selecciona una estación, satélite y máscara válidos.", passes: [] } }));
        return;
    }
    if (groundStationAnalysisAbortController) {
        groundStationAnalysisAbortController.abort();
    }
    const requestId = ++groundStationAnalysisRequestSequence;
    const abortController = new AbortController();
    groundStationAnalysisAbortController = abortController;
    const stationSignature = groundStationAnalysisSignature(station);
    let requestContext = null;
    try {
        const fallbackWindow = getGroundStationAnalysisWindow();
        const request = createGroundStationPassRequest(station, satelliteId, fallbackWindow.startDate, fallbackWindow.endDate, {
            stepSeconds: GROUND_STATION_ANALYSIS_STEP_SECONDS,
            includeSamples: true,
            chartPaddingSeconds: GROUND_STATION_CHART_PADDING_SECONDS
        });
        const analysisWindow = request.analysisWindow || fallbackWindow;
        const { startDate, endDate } = analysisWindow;
        requestContext = {
            requestId,
            stationId,
            station,
            stationSignature,
            satelliteLayerId,
            satelliteId,
            satelliteRfSignature: satelliteRfProfileSignature(satelliteId),
            manualOrbitSignature: request.manualOrbitSignature,
            analysisWindow
        };
        const { linkContract } = request;
        if (!linkContract.available) {
            if (isCurrentGroundStationPassAnalysis(requestContext)) {
                clearGroundStationAnalysisVisuals();
                window.dispatchEvent(new CustomEvent("orbit:ground-stations-analysis-result", {
                    detail: {
                        error: `El perfil RF del satélite no permite un enlace de bajada (${linkContract.reason || "perfil incompleto"}).`,
                        passes: [],
                        samples: [],
                        stationName: String(station.name || stationId),
                        satelliteName: String(getLayerDisplayName(satelliteLayerId) || satelliteId),
                        stationTimeZone: station.time_zone || "UTC",
                        referenceFrame: "ITRF",
                        timeScale: "UTC",
                        analysisSelection: { stationId, satelliteLayerId },
                        linkContract: linkContract.kind,
                        satelliteRfProfile: linkContract.profile || null,
                        satelliteLinkAvailable: false,
                        satelliteLinkStatus: linkContract.reason || "satellite-rf-profile-required",
                        visibleNow: false
                    }
                }));
            }
            return;
        }
        const response = await fetch(request.url, { ...request.requestOptions, signal: abortController.signal });
        if (!response.ok) throw await groundStationPassResponseError(response);
        const result = await response.json();
        if (!isCurrentGroundStationPassAnalysis(requestContext)) return;
        showGroundStationAnalysisVisuals(station, satelliteLayerId, minElevationDeg);
        const satelliteEntity = getCompositeLayerEntity(satelliteLayerId);
        const stationPosition = Cesium.Cartesian3.fromDegrees(station.longitude_deg, station.latitude_deg, station.altitude_m);
        // Calculate the instantaneous link budget against the same canonical
        // simulation clock that supplied the pass-analysis request.  It avoids
        // a stale Cesium frame producing a range from a different instant.
        const displayedDate = getDisplayedSimulationDate();
        const displayedJulianDate = Cesium.JulianDate.fromDate(displayedDate);
        const satellitePosition = satelliteEntity?.position?.getValue?.(displayedJulianDate);
        const satelliteRfProfile = linkContract.profile;
        const currentTarget = satellitePosition
            ? evaluateGroundStationTarget(station, stationPosition, satellitePosition, satelliteRfProfile)
            : null;
        const rangeKm = currentTarget?.rangeKm ?? Number.NaN;
        const currentElevation = currentTarget?.elevationDeg ?? Number.NaN;
        const currentAzimuth = currentTarget?.azimuthDeg ?? Number.NaN;
        const planningLink = currentTarget?.planningLink ?? null;
        const satelliteLink = currentTarget?.downlink ?? null;
        window.dispatchEvent(new CustomEvent("orbit:ground-stations-analysis-result", {
            detail: {
                ...result,
                stationName: String(station.name || stationId),
                satelliteName: String(getLayerDisplayName(satelliteLayerId) || satelliteId),
                stationTimeZone: station.time_zone || "UTC",
                referenceFrame: String(result.reference_frame || "ITRF"),
                timeScale: String(result.time_scale || "UTC"),
                analysisWindow: {
                    startTime: result.start_time || startDate.toISOString(),
                    endTime: result.end_time || endDate.toISOString(),
                    source: analysisWindow.source
                },
                analysisSelection: { stationId, satelliteLayerId },
                linkContract: linkContract.kind,
                satelliteRfProfile: linkContract.profile || null,
                rangeKm,
                linkBudgetDbm: planningLink?.received_power_dbm ?? Number.NaN,
                linkMarginDb: planningLink?.link_margin_db ?? Number.NaN,
                satelliteLinkAvailable: satelliteLink?.available === true,
                satelliteReceivedPowerDbm: satelliteLink?.received_power_dbm ?? Number.NaN,
                satelliteSnrDb: satelliteLink?.snr_db ?? Number.NaN,
                satelliteLinkMarginDb: satelliteLink?.link_margin_db ?? Number.NaN,
                satelliteLinkStatus: satelliteLink?.available === true ? "available" : satelliteLink?.reason || "satellite-rf-profile-required",
                azimuthDeg: currentAzimuth,
                rfModel: getGroundStationRfModel(station),
                visibleNow: Number.isFinite(currentElevation) && Number.isFinite(rangeKm)
                    ? currentTarget?.usable === true && currentElevation >= minElevationDeg
                    : false
            }
        }));
    } catch (error) {
        if (error?.name === "AbortError") return;
        if (requestContext && !isCurrentGroundStationPassAnalysis(requestContext)) return;
        logger.warn("No se pudo calcular la visibilidad de la estación:", error);
        const reason = error instanceof ManualAosLosRequestError || error instanceof Error
            ? error.message
            : String(error || "");
        window.dispatchEvent(new CustomEvent("orbit:ground-stations-analysis-result", {
            detail: {
                error: reason || "No se pudieron calcular los pases.",
                passes: [],
                samples: [],
                analysisSelection: { stationId, satelliteLayerId },
                visibleNow: false
            }
        }));
    } finally {
        if (requestId === groundStationAnalysisRequestSequence && groundStationAnalysisAbortController === abortController) {
            groundStationAnalysisAbortController = null;
        }
    }
}

function restoreProjectSimulationState(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
        return false;
    }

    const hasSavedState = ["mode", "startDate", "endDate", "currentDate"].some((key) => snapshot[key] !== undefined && snapshot[key] !== null);
    if (!hasSavedState) {
        return false;
    }

    const requestedMode = [SIMULATION_MODE_REALTIME, SIMULATION_MODE_RANGE, SIMULATION_MODE_STATIC].includes(snapshot.mode)
        ? snapshot.mode
        : SIMULATION_MODE_RANGE;
    const savedStart = new Date(snapshot.startDate);
    const savedEnd = new Date(snapshot.endDate);
    const hasSavedRange = !Number.isNaN(savedStart.getTime())
        && !Number.isNaN(savedEnd.getTime())
        && savedEnd > savedStart;

    if (hasSavedRange) {
        applySimulationRange(savedStart, savedEnd);
    }

    const savedCurrent = new Date(snapshot.currentDate);
    const hasSavedCurrent = !Number.isNaN(savedCurrent.getTime());
    const rangeStartMs = simulationState.startDate.getTime();
    const rangeEndMs = simulationState.endDate.getTime();
    const hasActiveRange = Number.isFinite(rangeStartMs)
        && Number.isFinite(rangeEndMs)
        && rangeEndMs >= rangeStartMs;
    let restoredDate = hasSavedCurrent ? new Date(savedCurrent) : getDisplayedSimulationDate();
    if (requestedMode === SIMULATION_MODE_RANGE && hasActiveRange && !Number.isNaN(restoredDate.getTime())) {
        restoredDate = new Date(clamp(restoredDate.getTime(), rangeStartMs, rangeEndMs));
    }

    if (requestedMode === SIMULATION_MODE_REALTIME && !hasLoadedOemEphemerisTracks()) {
        simulationState.mode = SIMULATION_MODE_REALTIME;
        simulationState.currentDate = new Date();
        simulationState.isPlaying = true;
        simulationState.playing = true;
        simulationState.rewind = false;
        simulationState.speed = 1;
    } else if (requestedMode === SIMULATION_MODE_STATIC) {
        simulationState.mode = SIMULATION_MODE_STATIC;
        simulationState.currentDate = restoredDate;
        simulationState.isPlaying = false;
        simulationState.playing = false;
        simulationState.rewind = false;
        simulationState.speed = 1;
    } else {
        const savedSpeed = Number(snapshot.speed);
        simulationState.mode = SIMULATION_MODE_RANGE;
        simulationState.currentDate = restoredDate;
        simulationState.isPlaying = snapshot.isPlaying !== false;
        simulationState.playing = simulationState.isPlaying;
        simulationState.rewind = false;
        simulationState.speed = Number.isFinite(savedSpeed) && savedSpeed > 0 ? savedSpeed : 1;
    }

    simulationState.lastTickTimestamp = Date.now();
    applySimulationDateToViewer(getDisplayedSimulationDate());
    syncViewerClockPlayback();
    refreshSimulationControlsUi();
    updateTopToolbarTime();
    return true;
}

function tickSimulationClock() {
    simulationController.tick();
}

// React owns the visible controls. Keep command handling here so it talks to
// the simulation state directly rather than routing through a hidden DOM dock.
window.addEventListener("orbit:simulation-action", async (event) => {
    const { type, value } = event.detail || {};

    if (type === "mode") {
        setSimulationMode(value);
    } else if (type === "play-toggle") {
        if (simulationState.mode === SIMULATION_MODE_REALTIME) {
            if (simulationState.isPlaying === false) {
                resumeRealtimeClock();
            } else {
                pauseRealtimeClock();
            }
        } else if (simulationState.mode === SIMULATION_MODE_STATIC) {
            setSimulationMode(SIMULATION_MODE_REALTIME);
        } else {
            simulationState.isPlaying = !simulationState.isPlaying;
            simulationState.playing = simulationState.isPlaying;
            simulationState.rewind = false;
            simulationState.lastTickTimestamp = Date.now();
            syncViewerClockPlayback();
        }
        refreshSimulationControlsUi();
        updateTopToolbarTime();
    } else if (type === "pause") {
        if (simulationState.mode === SIMULATION_MODE_REALTIME) {
            pauseRealtimeClock();
        } else {
            simulationState.isPlaying = false;
            simulationState.playing = false;
            simulationState.rewind = false;
            simulationState.lastTickTimestamp = Date.now();
            syncViewerClockPlayback();
        }
        refreshSimulationControlsUi();
        updateTopToolbarTime();
    } else if (type === "rewind") {
        simulationState.currentDate = simulationState.mode === SIMULATION_MODE_RANGE
            ? new Date(simulationState.startDate)
            : new Date();
        simulationState.isPlaying = false;
        simulationState.playing = false;
        simulationState.rewind = false;
        simulationState.lastTickTimestamp = Date.now();
        applySimulationDateToViewer(simulationState.currentDate);
        syncViewerClockPlayback();
        refreshSimulationControlsUi();
        updateTopToolbarTime();
    } else if (type === "speed") {
        simulationState.speed = Number(value) || 1;
        simulationState.lastTickTimestamp = Date.now();
        refreshSimulationControlsUi();
        updateTopToolbarTime();
    } else if (type === "timeline") {
        const ratio = clamp(Number(value) / SIMULATION_TIMELINE_STEPS, 0, 1);
        simulationState.currentDate = getDateFromTimelineRatio(ratio);
        simulationState.isPlaying = false;
        simulationState.playing = false;
        if (simulationState.mode === SIMULATION_MODE_REALTIME) {
            simulationState.mode = SIMULATION_MODE_RANGE;
        }
        applySimulationDateToViewer(simulationState.currentDate);
        syncViewerClockPlayback();
        refreshSimulationControlsUi();
        updateTopToolbarTime();
    } else if (type === "timeline-jump") {
        // Pass markers carry an exact UTC instant. Do not route this through
        // the range slider, whose finite number of steps would quantize the
        // selected AOS/LOS or maximum-elevation time.
        const targetIso = typeof value === "object" && value !== null ? value.time : value;
        if (typeof targetIso !== "string") return;

        const targetDate = new Date(targetIso);
        const startDate = new Date(simulationState.startDate);
        const endDate = new Date(simulationState.endDate);
        if (Number.isNaN(targetDate.getTime())
            || Number.isNaN(startDate.getTime())
            || Number.isNaN(endDate.getTime())
            || endDate <= startDate
            || targetDate < startDate
            || targetDate > endDate) {
            return;
        }

        simulationState.currentDate = targetDate;
        simulationState.isPlaying = false;
        simulationState.playing = false;
        simulationState.rewind = false;
        simulationState.lastTickTimestamp = Date.now();
        if (simulationState.mode === SIMULATION_MODE_REALTIME) {
            simulationState.mode = SIMULATION_MODE_RANGE;
        }
        applySimulationDateToViewer(simulationState.currentDate);
        syncViewerClockPlayback();
        refreshSimulationControlsUi();
        updateTopToolbarTime();
    } else if (type === "range") {
        const startDate = new Date(value?.startDate);
        const endDate = new Date(value?.endDate);
        if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && endDate > startDate) {
            const confirmed = await confirmLargeSimulationRangeIfNeeded(startDate, endDate);
            if (confirmed && applySimulationRange(startDate, endDate)) {
                setSimulationMode(SIMULATION_MODE_RANGE);
            }
        }
    } else if (type === "record-toggle") {
        toggleSessionRecording();
    }
});

function updateSessionRecordButtonLabel(options = {}) {
    if (typeof options.processing === "boolean") {
        isSessionRecordingProcessing = options.processing;
    } else if (!isSessionRecording) {
        isSessionRecordingProcessing = false;
    }
    // React owns the visible recording control.
    window.dispatchEvent(new CustomEvent("orbit:recording-state", {
        detail: { active: isSessionRecording, processing: isSessionRecordingProcessing }
    }));
}

function uiText(key) {
    const lang = currentUiLanguage === "en" ? "en" : "es";
    return UI_TEXT[lang]?.[key] || UI_TEXT.es[key] || key;
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
    updateSessionRecordButtonLabel();
    setupTopSearchAutocomplete();
    refreshSimulationControlsUi();
}

function persistSystemSectionPatch(sectionName, patch) {
    if (typeof updatePersistedSystemConfig === "function") {
        updatePersistedSystemConfig(sectionName, patch);
    }
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

function ensureTopToolbar() {
    // Asegurar que la clase esté siempre presente
    document.body.classList.add("with-toolbars");
    
    const existing = document.getElementById("topToolbar");
    if (existing) {
        const settingsButton = existing.querySelector("#topSettingsBtn");
        if (settingsButton && settingsButton.dataset.reactOwned !== "true" && settingsButton.dataset.orbitBound !== "true") {
            settingsButton.dataset.orbitBound = "true";
            settingsButton.addEventListener("click", () => runtimeConfigPanelApi?.toggle?.());
        }
        const helpButton = existing.querySelector("#topHelpBtn");
        if (helpButton && helpButton.dataset.orbitBound !== "true") {
            helpButton.dataset.orbitBound = "true";
            helpButton.addEventListener("click", () => window.dispatchEvent(new Event("orbit:help-open")));
        }
        setupTopSearchAutocomplete();
        return existing;
    }

    const toolbar = document.createElement("div");
    toolbar.id = "topToolbar";
    toolbar.innerHTML = `
        <a class="toolbar-brand" href="#" aria-label="Orbit">
            <img src="assets/icon/favicon.svg" alt="">
            <span>ORBIT</span>
        </a>
        <nav class="toolbar-nav" aria-label="Navegación principal">
            <span class="toolbar-nav-link"><span class="toolbar-nav-icon">⌘</span>Dashboard</span>
            <span class="toolbar-nav-link active" aria-current="page"><span class="toolbar-nav-icon">⌁</span>Satellites</span>
            <span class="toolbar-nav-link"><span class="toolbar-nav-icon">◷</span>Missions</span>
            <span class="toolbar-nav-link"><span class="toolbar-nav-icon">⌖</span>Ground Stations</span>
            <span class="toolbar-nav-link"><span class="toolbar-nav-icon">⌁</span>Analytics</span>
        </nav>
        <div class="toolbar-spacer"></div>
        <div class="toolbar-search-wrap">
            <span class="toolbar-search-icon" aria-hidden="true">⌕</span>
            <input id="objectSearch" class="toolbar-search" type="text" placeholder="Buscar satélite por nombre o NORAD..." autocomplete="off" spellcheck="false" />
            <div id="topSearchSuggestions"></div>
        </div>
        <div class="toolbar-actions">
            <button id="topNotificationsBtn" class="toolbar-icon-btn has-notification" type="button" aria-label="Notificaciones" title="Notificaciones">♧</button>
            <button id="topHelpBtn" class="toolbar-icon-btn" type="button" aria-label="Ayuda" title="Ayuda">?</button>
            <button id="topSettingsBtn" class="toolbar-icon-btn" type="button" aria-label="Configuración" title="Configuración">⚙</button>
            <button id="topUserBtn" class="toolbar-avatar" type="button" aria-label="Perfil de GG" title="Perfil de GG">GG</button>
        </div>
    `;

    toolbar.querySelector("#topSettingsBtn")?.addEventListener("click", () => runtimeConfigPanelApi?.toggle?.());
    toolbar.querySelector("#topHelpBtn")?.addEventListener("click", () => window.dispatchEvent(new Event("orbit:help-open")));

    if (!document.getElementById("projectWelcome")) {
        const welcome = document.createElement("div");
        welcome.id = "projectWelcome";
        welcome.innerHTML = `<section class="project-welcome-card"><div class="project-welcome-orbit">◯</div><div class="project-welcome-mark">O R B I T</div><h1>Welcome to Orbit</h1><div class="project-welcome-rule"></div><p>Create a project to start modelling your space operations,<br>or open an existing one.</p><div class="project-welcome-actions"><button class="primary" data-project-action="new"><span>⊕</span> New project</button><button data-project-action="open"><span>▱</span> Open project</button></div></section>`;
        welcome.querySelector('[data-project-action="new"]').addEventListener("click", () => requestProjectActionDialog("new"));
        welcome.querySelector('[data-project-action="open"]').addEventListener("click", () => requestProjectActionDialog("open"));
        document.body.appendChild(welcome);
    }
    document.body.appendChild(toolbar);
    document.body.classList.add("with-toolbars");

    setupTopSearchAutocomplete();

    updateTopToolbarState();
    updateTopToolbarTime();
    return toolbar;
}

function updateTopToolbarState() {
    window.dispatchEvent(new CustomEvent("orbit:recording-state", {
        detail: { active: isSessionRecording, processing: isSessionRecordingProcessing }
    }));
}

function updateTopToolbarTime() {
    updateSimulationTimelineUi();
    window.dispatchEvent(new CustomEvent("orbit:time-context", {
        detail: {
            date: getDisplayedSimulationDate().toISOString(),
            mode: simulationState.mode,
            isPlaying: simulationState.isPlaying,
            isPaused: simulationState.isPlaying === false,
            oemDomainActive: hasLoadedOemEphemerisTracks()
        }
    }));
}

function bindReactLayersPanelResize() {
    const panel = document.getElementById("leftSatellitesPanel");
    const triggerButton = document.getElementById("leftSatellitesBtn");
    if (!panel || !triggerButton || panel.dataset.orbitResizeBound === "true") {
        return;
    }

    panel.dataset.orbitResizeBound = "true";
    setupResizableSidePanel({
        panel,
        triggerButton,
        storageKey: "orbit.layersPanel.width",
        cssVariable: "--orbit-layers-panel-width",
        maximumWidth: () => Math.min(640, window.innerWidth * 0.72),
        onCollapse: () => window.dispatchEvent(new Event("orbit:layers-panel-collapse"))
    });
}

function ensureLeftSidebar() {
    // Asegurar que la clase esté siempre presente
    document.body.classList.add("with-toolbars");
    
    const existing = document.getElementById("leftSidebar");
    if (existing) {
        bindReactLayersPanelResize();
        updateTelemetryTimeContext();
        return existing;
    }

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
            <div class="sidebar-panel-title" data-project-title>My project</div>
            <div class="sidebar-panel-actions">
                <button class="object-global-remove-btn" id="removeAllLayersHeaderBtn" type="button" title="Quitar todas las capas" aria-label="Quitar todas las capas">🗑</button>
                <button class="object-global-eye-btn" id="toggleAllVisibilityBtn" type="button" title="Ocultar todas las capas" aria-label="Ocultar todas las capas">👁</button>
                <button class="object-add-btn" id="openCatalogBtn" type="button" title="Añadir capa" aria-label="Añadir capa">+</button>
            </div>
        </div>
        <div id="leftSatellitesPanelContent" class="sidebar-panel-content"></div>
        <div class="sidebar-panel-resize-handle" role="separator" aria-orientation="vertical" aria-label="Redimensionar panel de capas"></div>
    `;
    document.body.appendChild(satellitesPanel);

    // Panel de telemetría (pestaña separada)
    const infoPanel = document.createElement("div");
    infoPanel.id = "leftInfoPanel";
    infoPanel.className = "sidebar-panel";
    infoPanel.innerHTML = `
        <div class="sidebar-panel-header telemetry-panel-header">
            <div>
                <div class="sidebar-panel-title">TELEMETRÍA</div>
                <div class="telemetry-panel-subtitle"><span aria-hidden="true"></span>DATOS EN TIEMPO REAL</div>
            </div>
        </div>
        <div id="leftInfoPanelContent" class="sidebar-panel-content"></div>
        <div class="sidebar-panel-resize-handle" role="separator" aria-orientation="vertical" aria-label="Redimensionar panel de telemetría"></div>
    `;
    document.body.appendChild(infoPanel);
    updateTelemetryTimeContext();

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

    const getMaximumPanelWidth = () => Math.min(640, window.innerWidth * 0.72);
    setupResizableSidePanel({
        panel: satellitesPanel,
        triggerButton: satellitesBtn,
        storageKey: "orbit.layersPanel.width",
        cssVariable: "--orbit-layers-panel-width",
        maximumWidth: getMaximumPanelWidth,
        onLayoutChange: undefined
    });
    setupResizableSidePanel({
        panel: infoPanel,
        triggerButton: infoBtn,
        storageKey: "orbit.telemetryPanel.width",
        cssVariable: "--orbit-telemetry-panel-width",
        maximumWidth: getMaximumPanelWidth,
        onLayoutChange: undefined
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

function publishSelectedLayerState() {
    const layerId = selectedSatelliteId;
    window.dispatchEvent(new CustomEvent("orbit:selected-layer-state", {
        detail: {
            id: layerId,
            active: Boolean(layerId && isCompositeLayerActive(layerId)),
            layerType: layerId ? getLayerType(layerId) : "SATELLITE"
        }
    }));
}

function setCurrentSelectedSatellite(id) {
    selectedSatelliteId = id ? String(id) : null;
    updateSelectedEpochInfo();
    publishSelectedLayerState();
}

// React can mount after an object was selected by the imperative runtime.
// Let new controls request the current selection instead of waiting for the
// next click, which keeps selection-dependent toolbar actions reliable.
window.addEventListener("orbit:selected-layer-state-request", publishSelectedLayerState);

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

function openAppDialog({ title, message, showCancel, confirmLabel }) {
    return new Promise((resolve) => {
        const id = `app-dialog-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const onResponse = (event) => { if (event.detail?.id !== id) return; window.removeEventListener("orbit:app-dialog-response", onResponse); resolve(event.detail.accepted === true); };
        window.addEventListener("orbit:app-dialog-response", onResponse);
        window.dispatchEvent(new CustomEvent("orbit:app-dialog-request", { detail: { id, title: title || "Aviso", message: message || "", showCancel: showCancel === true, confirmLabel: confirmLabel || (showCancel ? "Guardar" : "Aceptar") } }));
    });
}

function showAppAlert(message, title = uiText("alertTitle")) {
    return openAppDialog({ title, message, showCancel: false });
}

function showAppConfirm(message, title = uiText("confirmTitle"), confirmLabel) {
    return openAppDialog({ title, message, showCancel: true, confirmLabel });
}

function hideSatelliteContextMenu() {
    window.dispatchEvent(new Event("orbit:satellite-context-close"));
}

function showSatelliteContextMenuAt(satelliteId, x, y) {
    const sourceId = getSatelliteSourceIdFromLayerId(String(satelliteId || "").trim());
    const layerType = String(getLayerType(satelliteId) || "SATELLITE").toUpperCase();
    const isCelestialBody = layerType === "CELESTIAL_BODY" || layerType === "EARTH";
    const isGroundStation = layerType === "GROUND_STATION";
    // The manual registry, not the generic catalog metadata, is the
    // authorization boundary for editing. A catalogue TLE can have a very
    // similar set of Keplerian values but must never gain this action.
    const canEditManualOrbit = Boolean(getManualOrbitProjectEntry(sourceId));

    const viewportPadding = 10;
    // Context menus now include an object header and concise explanations for
    // each action. Clamp against their real visual footprint so the final
    // option never falls behind the timeline or viewport edge.
    const estimatedWidth = 286;
    const estimatedHeight = isCelestialBody ? 98 : (isGroundStation ? 178 : (canEditManualOrbit ? 270 : 222));
    const maxLeft = Math.max(viewportPadding, window.innerWidth - estimatedWidth - viewportPadding);
    const maxTop = Math.max(viewportPadding, window.innerHeight - estimatedHeight - viewportPadding);
    const safeLeft = Math.min(Math.max(viewportPadding, x), maxLeft);
    const safeTop = Math.min(Math.max(viewportPadding, y), maxTop);

    window.dispatchEvent(new CustomEvent("orbit:satellite-context-open", {
        detail: {
            id: satelliteId,
            sourceId,
            name: getLayerDisplayName(satelliteId),
            layerType,
            canEditManualOrbit,
            left: safeLeft,
            top: safeTop
        }
    }));
}

window.addEventListener("orbit:satellite-context-action", (event) => {
    const action = event.detail || {};
    const layerId = String(action.id || "").trim();
    if (action.type === "center-view") {
        if (!layerId || !isCompositeLayerActive(layerId)) {
            return;
        }
        // The globe menu can be invoked for any focusable layer, including a
        // future Sun/Moon entity that has no satellite telemetry.
        objectSidebar?.selectObject?.(layerId);
        centerViewOnObject(layerId);
        return;
    }
    if (action.type === "station") {
        if (layerId && String(getLayerType(layerId) || "").toUpperCase() === "GROUND_STATION") {
            objectSidebar?.openGroundStationEditor?.(layerId);
        }
        return;
    }
    if (action.type === "export-station") {
        if (layerId && String(getLayerType(layerId) || "").toUpperCase() === "GROUND_STATION") {
            window.dispatchEvent(new CustomEvent("orbit:ground-stations-export-menu-open", {
                detail: { stationId: layerId, source: "satellite-context", anchor: null }
            }));
        }
        return;
    }
    // Compatibility with already-mounted UI bundles while the generic export
    // picker is rolled out. New UI dispatches `export-station` above.
    if (action.type === "export-station-geojson") {
        if (layerId && String(getLayerType(layerId) || "").toUpperCase() === "GROUND_STATION") {
            exportGroundStations(layerId, GROUND_STATION_EXPORT_FORMATS.GEOJSON);
        }
        return;
    }
    const sourceId = getSatelliteSourceIdFromLayerId(String(action.sourceId || action.id || "").trim());
    if (!sourceId) {
        return;
    }
    if (action.type === "visualization") {
        openSatelliteVisualizationModal(sourceId);
    } else if (action.type === "edit-manual") {
        // `editManualOrbitFromWorkspace` repeats the registry check, so a
        // synthetic DOM event cannot grant catalogue objects edit access.
        editManualOrbitFromWorkspace(sourceId);
    } else if (action.type === "propagated-parameters") {
        const layerId = String(action.id || "").trim();
        if (!layerId || !isCompositeLayerActive(layerId) || isGroundStationLayerId(layerId) || isCelestialBodyLayerId(layerId)) {
            return;
        }
        // A globe context action is a selection action too. Keep Details,
        // the left-toolbar button and the inspector on the same target.
        objectSidebar?.selectObject?.(layerId);
        setCurrentSelectedSatellite(layerId);
        setSelectedOrbitSatelliteId(getSatelliteSourceIdFromLayerId(layerId));
        const entity = getCompositeLayerEntity(layerId);
        if (entity) {
            viewer.selectedEntity = entity;
        }
        emitPropagatedParametersOpen({ id: layerId, source: "globe" });
    }
});

function closeSatelliteVisualizationModal() {
    window.dispatchEvent(new Event("orbit:satellite-viz-close"));
}

function openSatelliteVisualizationModal(satelliteId) {
    const config = getSatelliteVisualizationConfig(satelliteId);
    if (!config) {
        return;
    }

    const entryMeta = getCatalogEntryMeta(satelliteId) || null;
    const sourceFormat = String(entryMeta?.sourceFormat || "TLE").toUpperCase();
    const isOem = sourceFormat === "OEM";
    const oemDomainActive = hasLoadedOemEphemerisTracks()
        || Boolean(getLoadedOemEphemerisTimeBounds());
    const hidePropagation = isOem || oemDomainActive;

    const effective = config.effective;
    window.dispatchEvent(new CustomEvent("orbit:satellite-viz-open", { detail: { id: satelliteId, values: { ...effective }, hidePropagation, vectorsVisible: satelliteVectorVisibility.has(satelliteId) } }));
}

const satelliteVectorVisibility = new Set();
window.addEventListener("orbit:satellite-vectors-action", (event) => {
    const id = String(event.detail?.id || "").trim();
    if (!id) return;
    const visible = event.detail?.visible === true;
    const manual = getManualOrbitProjectEntry(id);
    const forceTerms = manual?.propagationOptions?.forceTerms || manual?.forceTerms || ["central"];
    setSatelliteVectorVisualization(id, visible, Array.isArray(forceTerms) ? forceTerms : ["central"]);
    if (visible) satelliteVectorVisibility.add(id);
    else satelliteVectorVisibility.delete(id);
});

window.addEventListener("orbit:manual-orbit-vectors-action", (event) => {
    const detail = event.detail || {};
    setManualOrbitPreviewVectorVisualization(detail.visible === true, detail.manualOrbit || {});
});

window.addEventListener("orbit:satellite-viz-action", (event) => {
    const action = event.detail || {};
    if (!action.id) return;
    if (action.type === "reset") { clearSatelliteVisualizationConfig(action.id); closeSatelliteVisualizationModal(); }
    if (action.type === "apply") { setSatelliteVisualizationConfig(action.id, action.patch || {}); closeSatelliteVisualizationModal(); }
});

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
        isSessionRecordingProcessing = false;
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
    window.dispatchEvent(new CustomEvent("orbit:camera-mode-state", {
        detail: {
            mode: cameraNavigationMode,
            isFreeMode: cameraNavigationMode === "free",
            viewMode: getCameraViewMode()
        }
    }));
}

function getCameraViewMode() {
    const sceneMode = viewer?.scene?.mode;
    if (sceneMode === Cesium.SceneMode.SCENE2D) return "2d";
    if (sceneMode === Cesium.SceneMode.COLUMBUS_VIEW) return "columbus";
    return "3d";
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
        bodyCentricCamera.deactivate();
        if (!options.keepTrackedEntity) {
            viewer.trackedEntity = undefined;
        }
        controller.enableCollisionDetection = false;
        controller.minimumZoomDistance = 1.0;
        controller.maximumZoomDistance = getCameraMaximumZoomDistance();
        controller.constrainedAxis = undefined;
        controller.lookEventTypes = [Cesium.CameraEventType.LEFT_DRAG];
        controller.rotateEventTypes = [Cesium.CameraEventType.RIGHT_DRAG];
        controller.tiltEventTypes = [Cesium.CameraEventType.MIDDLE_DRAG];
        controller.zoomEventTypes = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];
        freeCameraKeyboardControls.enable();
        // Soltar cualquier transform de seguimiento para una camara totalmente libre.
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    } else {
        freeCameraKeyboardControls.disable();
        controller.enableCollisionDetection = true;
        controller.minimumZoomDistance = 1000.0;
        controller.maximumZoomDistance = getCameraMaximumZoomDistance();
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

setupCameraActions({
    viewer,
    resetView: resetCameraView,
    toggleNavigation: () => applyCameraNavigationMode(cameraNavigationMode === "free" ? "centered" : "free"),
    setNavigationMode: (mode) => applyCameraNavigationMode(mode),
    publishCameraState: updateCameraModeButtonLabel
});

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
            await saveSystemConfigWithRetry(nextSectionedSystemConfig, currentRuntimeDataConfig, { retries: 2 });
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

function applyEarthDayNightBlend(systemConfig) {
    const blendEnabled = systemConfig.globe_lighting !== false;
    nightImageryLayer.configure(blendEnabled);
}

function applyEarthBaseLayers(systemConfig = runtimeSystemConfig || {}) {
    return earthBasemapManager.apply(systemConfig.earth_basemap);
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
    applyUiTheme(systemConfig.ui_theme || currentUiTheme);
    applyUiLanguage(systemConfig.ui_language || currentUiLanguage);

    adaptiveDisplay.applyResolution(systemConfig);
    adaptiveDisplay.applyUi(systemConfig);

    if (systemConfig.background_color) {
        viewer.scene.backgroundColor = Cesium.Color.fromCssColorString(systemConfig.background_color);
    }

    applyStarsConfig({ viewer, Cesium, skyDome: tychoSkyDome, systemConfig, logger });
    // The star field is only a background. Reassert the independent body
    // layer state after replacing/removing its primitive so Moon/Sun retain
    // their custom surfaces (or their native fallback while a texture loads).
    celestialBodyLayers.syncNativeBodyVisibility();
    applyAntialiasMode({ viewer, systemConfig, logger });
    viewer.scene.skyAtmosphere.show = systemConfig.sky_atmosphere !== false;
    globeLightingEnabledByConfig = systemConfig.globe_lighting !== false;
    updateAdaptiveGlobeLighting();
    applyEarthDayNightBlend(systemConfig);
    applyEarthBaseLayers(systemConfig);
}

window.addEventListener("resize", () => {
    adaptiveDisplay.scheduleResize(() => runtimeSystemConfig);
});

fetch("assets/earth2km_tiles/0/0/0.jpg", { cache: "no-cache" }).then((resp) => {
    earthBasemapManager.setLocalEarth2kmAvailable(resp.ok);
}).catch(() => {
    earthBasemapManager.setLocalEarth2kmAvailable(false);
});

logger.info("Cesium Viewer creado exitosamente.");

viewer.scene.imageryLayers.layerAdded.addEventListener((layer) => {
    const provider = layer?.imageryProvider;
    if (!provider?.errorEvent?.addEventListener) return;
    provider.errorEvent.addEventListener((error) => {
        logger.warn("Error cargando una capa de imagen de la Tierra.", error);
    });
});

viewer.scene.skyAtmosphere.show = true;
viewer.scene.globe.enableLighting = true;
viewer.scene.backgroundColor = Cesium.Color.BLACK;
viewer.scene.globe.depthTestAgainstTerrain = true;

applyCameraNavigationMode("centered", { keepTrackedEntity: true });

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

    const satelliteId = String(entity.satelliteId || "").trim();
    const bodyCameraTicket = satelliteId ? bodyCentricCamera.beginFocus(satelliteId) : null;
    if (!bodyCameraTicket) {
        bodyCentricCamera.deactivate();
    }
    // A normal satellite focus keeps the Earth-style local frame; retain
    // EntityView only as a safe fallback while a pooled entity has no current
    // position. First-person focus below intentionally still tracks.
    viewer.trackedEntity = bodyCameraTicket ? undefined : entity;
    entity.viewFrom = new Cesium.Cartesian3(0, -180000, 90000);
    const flyToOptions = {
        duration: 0.8,
        offset: new Cesium.HeadingPitchRange(0, -0.35, 180000)
    };
    if (bodyCameraTicket) {
        flyToOptions.complete = () => bodyCentricCamera.activateAfterFlight(bodyCameraTicket);
        flyToOptions.cancel = () => bodyCentricCamera.cancelFocus(bodyCameraTicket);
    }
    viewer.flyTo(entity, flyToOptions);
}

function publishManualOrbitState(extra = {}) {
    const detail = {
        ...manualOrbitEditorState,
        ...getManualOrbitDesignSettings(),
        designMode: Boolean(manualOrbitDesignSession?.active),
        // Keep the panel contract self-contained. A React remount can recover
        // from this latest state without waiting for a new editor event.
        open: typeof extra.open === "boolean"
            ? extra.open
            : Boolean(manualOrbitDesignSession?.active),
        editingManualOrbitId: manualOrbitEditingTarget?.id || null,
        ...extra
    };
    window.__orbitManualOrbitState = detail;
    window.dispatchEvent(new CustomEvent("orbit:manual-orbit-state", {
        detail
    }));
}

function centerViewOnObject(layerId) {
    const id = String(layerId || "").trim();
    if (!id || !isCompositeLayerActive(id)) {
        return false;
    }

    const entity = getCompositeLayerEntity(id);
    if (!entity) {
        return false;
    }

    if (cameraNavigationMode === "free") {
        applyCameraNavigationMode("centered", { keepTrackedEntity: true });
    }

    const layerType = String(getLayerType(id) || "SATELLITE").toUpperCase();
    const isMoonBody = layerType === "CELESTIAL_BODY"
        && celestialBodyLayers.getDefinition(id)?.kind === "moon";
    const isSatelliteFocus = layerType === "SATELLITE";
    const usesBodyCentricCamera = isMoonBody || isSatelliteFocus;
    if (!usesBodyCentricCamera) {
        bodyCentricCamera.deactivate();
    }
    // Earth is our reference frame, not a distant external body. Preserve the
    // normal Cesium Home framing while retaining the Earth layer selection.
    if (layerType === "EARTH") {
        return centerViewOnEarth({ viewer, entity, logger, duration: 0.8 });
    }

    const focus = () => {
        let flyToOptions = { offset: new Cesium.HeadingPitchRange(0, -0.35, 180000) };
        let focusBoundingSphere = null;
        let bodyCameraTicket = isSatelliteFocus ? bodyCentricCamera.beginFocus(id) : null;
        if (layerType === "CELESTIAL_BODY") {
            const metrics = getCelestialFocusMetrics(id);
            const definition = celestialBodyLayers.getDefinition(id);
            const bodyPosition = celestialBodyLayers.getPosition(id);
            // Never delegate a body flight to an invisible Entity's optional
            // graphics bounds. The renderer and the camera share this exact
            // physical sphere, so the focus is deterministic.
            if (!metrics || !definition || !bodyPosition || typeof Cesium?.BoundingSphere !== "function") {
                logger.warn("No se pudo determinar un foco físico para el cuerpo celeste.", id);
                return false;
            }

            const controller = viewer?.scene?.screenSpaceCameraController;
            if (controller) {
                controller.maximumZoomDistance = Math.max(
                    Number(controller.maximumZoomDistance) || DEFAULT_CAMERA_MAXIMUM_ZOOM_DISTANCE_METERS,
                    metrics.maximumZoomDistanceMeters
                );
            }

            const range = metrics.focusRangeMeters;
            // Retain a safe EntityView offset as a fallback for any physical
            // body that cannot use the body-centric controller.
            entity.viewFrom = new Cesium.Cartesian3(0, -range, range * 0.24);
            if (definition.kind === "moon") {
                bodyCameraTicket = bodyCentricCamera.beginFocus(id);
            }
            flyToOptions = {
                offset: new Cesium.HeadingPitchRange(0, -0.35, range)
            };
            focusBoundingSphere = new Cesium.BoundingSphere(
                Cesium.Cartesian3.clone(bodyPosition),
                definition.radiusMeters
            );
        }

        if (usesBodyCentricCamera && !bodyCameraTicket) {
            // The selected pooled satellite may have disappeared between UI
            // selection and focus. Fall back to EntityView cleanly instead of
            // leaving a previous Moon/Satellite frame active.
            bodyCentricCamera.deactivate();
        }
        if (bodyCameraTicket) {
            flyToOptions.complete = () => bodyCentricCamera.activateAfterFlight(bodyCameraTicket);
            flyToOptions.cancel = () => bodyCentricCamera.cancelFocus(bodyCameraTicket);
        }

        const centered = centerViewOnEntity({
            viewer,
            entity,
            logger,
            duration: 0.8,
            flyToOptions,
            focusBoundingSphere,
            // Moon and ordinary satellite focus use a translation-only local
            // frame after the flight. If no live target position is available,
            // retain the previous EntityView fallback.
            trackEntity: !usesBodyCentricCamera || !bodyCameraTicket
        });
        if (!centered && bodyCameraTicket) {
            bodyCentricCamera.cancelFocus(bodyCameraTicket);
        }
        return centered;
    };

    // Cesium's physical ellipsoid primitives intentionally render only in
    // 3D. A body focus is therefore also an explicit request to enter the
    // physical scene rather than leaving a selected-but-invisible layer in
    // 2D or Columbus View.
    if (
        layerType === "CELESTIAL_BODY"
        && viewer?.scene?.mode !== Cesium.SceneMode.SCENE3D
        && typeof viewer?.scene?.morphTo3D === "function"
        && viewer?.scene?.morphComplete
    ) {
        const finishMorph = () => {
            viewer.scene.morphComplete.removeEventListener(finishMorph);
            focus();
        };
        viewer.scene.morphComplete.addEventListener(finishMorph);
        viewer.scene.morphTo3D(0.35);
        return true;
    }

    return focus();
}

function publishManualOrbitStatus(kind, message) {
    window.dispatchEvent(new CustomEvent("orbit:manual-orbit-status", {
        detail: { kind, message }
    }));
}

const MANUAL_ORBIT_DEFAULT_WINDOW_HOURS = 24;
const MANUAL_ORBIT_PREVIEW_DEBOUNCE_MS = 320;

function asValidManualOrbitDate(value) {
    const candidate = value instanceof Date ? new Date(value.getTime()) : new Date(value || "");
    return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function getManualOrbitDesignSettings() {
    if (manualOrbitDesignSettings) {
        return { ...manualOrbitDesignSettings };
    }

    const start = asValidManualOrbitDate(manualOrbitEditorState?.epochUtc) || new Date();
    // A new design starts with the workspace propagation horizon, exactly as
    // the normal future-orbit view does. The two editor epochs immediately
    // become authoritative after this default is shown to the user.
    const configuredHours = Number(runtimeSystemConfig?.propagation_hours);
    const defaultWindowHours = Number.isFinite(configuredHours) && configuredHours > 0
        ? configuredHours
        : MANUAL_ORBIT_DEFAULT_WINDOW_HOURS;
    const end = new Date(start.getTime() + (defaultWindowHours * 60 * 60 * 1000));
    manualOrbitDesignSettings = {
        epochStartUtc: start.toISOString(),
        epochEndUtc: end.toISOString(),
        // The design preview can display this physical Earth-fixed projection
        // immediately. The same preference is carried into the confirmed
        // manual object when it is created.
        groundTrackPreview: false,
        // A design can either show the single EME2000 osculating ellipse or
        // the literal ITRF propagation samples. EME2000 is the clean-design
        // default.
        previewReferenceFrame: "eme2000"
    };
    return { ...manualOrbitDesignSettings };
}

function updateManualOrbitDesignSettings(payload = {}) {
    const current = getManualOrbitDesignSettings();
    const startInput = payload.epochStartUtc ?? payload.startTime ?? payload.start_time ?? payload.epochUtc;
    const endInput = payload.epochEndUtc ?? payload.endTime ?? payload.end_time;
    const start = startInput === undefined ? null : asValidManualOrbitDate(startInput);
    const end = endInput === undefined ? null : asValidManualOrbitDate(endInput);

    manualOrbitDesignSettings = {
        epochStartUtc: start ? start.toISOString() : current.epochStartUtc,
        epochEndUtc: end ? end.toISOString() : current.epochEndUtc,
        groundTrackPreview: typeof payload.groundTrackPreview === "boolean"
            ? payload.groundTrackPreview
            : current.groundTrackPreview === true,
        previewReferenceFrame: normalizeManualOrbitPreviewReferenceFrame(
            payload.previewReferenceFrame,
            current.previewReferenceFrame
        )
    };
    return { ...manualOrbitDesignSettings };
}

/**
 * Reopen the design workspace with a confirmed, user-authored manual orbit.
 * The data comes from the local manual-track registry rather than catalogue
 * metadata, so importing/copying a TLE can never make a catalogue satellite
 * editable through this path.
 */
function editManualOrbitFromWorkspace(satelliteId) {
    if (manualOrbitDesignSession?.active) {
        return false;
    }

    const sourceId = getSatelliteSourceIdFromLayerId(String(satelliteId || "").trim());
    const record = getManualOrbitProjectEntry(sourceId);
    if (!record) {
        return false;
    }

    const definitionSource = normalizeManualOrbitDefinitionSource(record.definitionSource, "keplerian");
    try {
        manualOrbitEditorState = normalizeManualOrbitState({
            name: record.name,
            epochUtc: record.epochUtc,
            propagator: record.propagator,
            objectMetadata: manualOrbitRecordValue(record, "objectMetadata", "object_metadata"),
            propagationOptions: manualOrbitRecordValue(record, "propagationOptions", "propagation_options"),
            definitionSource,
            keplerian: record.keplerian,
            stateVector: record.stateVector
        }, { source: definitionSource });
    } catch (error) {
        logger.warn(`No se pudo abrir la orbita manual '${record.id}' para editar:`, error);
        return false;
    }

    manualOrbitDefinitionSource = definitionSource;
    const start = asValidManualOrbitDate(record.startTime)
        || asValidManualOrbitDate(manualOrbitEditorState.epochUtc)
        || new Date();
    const recordedEnd = asValidManualOrbitDate(record.endTime);
    const configuredHours = Number(runtimeSystemConfig?.propagation_hours);
    const fallbackHours = Number.isFinite(configuredHours) && configuredHours > 0
        ? configuredHours
        : MANUAL_ORBIT_DEFAULT_WINDOW_HOURS;
    const end = recordedEnd && recordedEnd.getTime() > start.getTime()
        ? recordedEnd
        : new Date(start.getTime() + (fallbackHours * 60 * 60 * 1000));
    const effectiveGroundTrack = getSatelliteVisualizationConfig(record.id)?.effective?.orbit_ground_track_show;

    manualOrbitDesignSettings = {
        epochStartUtc: start.toISOString(),
        epochEndUtc: end.toISOString(),
        groundTrackPreview: typeof effectiveGroundTrack === "boolean"
            ? effectiveGroundTrack
            : record.groundTrackEnabled === true,
        // This is a view preference only. Restore the confirmed manual
        // object's selected representation without changing its EME2000
        // physical definition.
        previewReferenceFrame: normalizeManualOrbitPreviewReferenceFrame(
            record.previewReferenceFrame ?? record.preview_reference_frame,
            "eme2000"
        )
    };
    manualOrbitEditingTarget = {
        id: record.id,
        visualizationOverrides: { ...(record.visual?.overrides || {}) }
    };

    enterManualOrbitDesignMode();
    publishManualOrbitStatus(null, "");
    publishManualOrbitState({ open: true, tab: definitionSource });
    return true;
}

function getManualOrbitDesignWindow() {
    const settings = getManualOrbitDesignSettings();
    const startTime = asValidManualOrbitDate(settings.epochStartUtc);
    const endTime = asValidManualOrbitDate(settings.epochEndUtc);
    if (!startTime || !endTime || endTime.getTime() <= startTime.getTime()) {
        throw new Error("La fecha final de la órbita debe ser posterior a la fecha inicial.");
    }
    return {
        startTime,
        endTime,
        horizonHours: getRangeHours(startTime.getTime(), endTime.getTime())
    };
}

function publishManualOrbitDesignState(active) {
    const isActive = Boolean(active);
    // React can remount independently of the Cesium runtime (for example
    // after a hot refresh). Persist the state outside the event so each
    // overlay can initialise correctly instead of missing a past transition.
    window.__orbitManualOrbitDesignActive = isActive;
    document.documentElement.dataset.manualOrbitDesign = isActive ? "true" : "false";

    // Keep the legacy/React Layers surface out of the editor even while a
    // React update is pending. The component mirrors this from the persistent
    // state above, so it remains hidden after subsequent re-renders as well.
    for (const id of ["leftSatellitesPanel"]) {
        const element = document.getElementById(id);
        if (element) element.hidden = isActive;
    }
    window.dispatchEvent(new CustomEvent("orbit:manual-orbit-design-state", {
        detail: { active: isActive }
    }));
}

function stopManualOrbitPreviewRequest() {
    if (manualOrbitPreviewTimer) {
        clearTimeout(manualOrbitPreviewTimer);
        manualOrbitPreviewTimer = null;
    }
    if (manualOrbitPreviewAbortController) {
        manualOrbitPreviewAbortController.abort();
        manualOrbitPreviewAbortController = null;
    }
    manualOrbitPreviewRequestId += 1;
}

function stopManualOrbitCreateRequest() {
    // A confirmation request mutates the workspace when it resolves. Give it
    // its own cancellation generation so closing design mode or replacing the
    // project can never import a late result into the new workspace.
    manualOrbitCreateRequestId += 1;
    if (manualOrbitCreateAbortController) {
        manualOrbitCreateAbortController.abort();
        manualOrbitCreateAbortController = null;
    }
    manualOrbitCreateInFlight = false;
}

function applyManualOrbitDesignTimeWindow() {
    if (!manualOrbitDesignSession?.active) {
        return;
    }
    const windowRange = getManualOrbitDesignWindow();
    setSimulationRange(simulationState, windowRange.startTime, windowRange.endTime);
    simulationState.mode = SIMULATION_MODE_RANGE;
    simulationState.currentDate = new Date(windowRange.startTime);
    simulationState.isPlaying = false;
    simulationState.playing = false;
    simulationState.rewind = false;
    simulationState.lastTickTimestamp = Date.now();
    applySimulationDateToViewer(simulationState.currentDate);
    refreshSimulationControlsUi();
    updateTopToolbarTime();
}

function enterManualOrbitDesignMode() {
    if (manualOrbitDesignSession?.active) {
        return;
    }

    // Object-specific overlays can otherwise remain over the isolated Earth
    // even though their source layers are hidden. Close only transient UI;
    // the underlying layer state is captured and restored below.
    hideSatelliteContextMenu();
    window.dispatchEvent(new Event("orbit:layer-context-menu-close"));
    window.dispatchEvent(new Event("orbit:satellite-viz-close"));
    window.dispatchEvent(new Event("orbit:tle-info-close"));

    // Capture before hiding a focused layer: hiding it can release a local
    // body camera, which would otherwise overwrite the view to restore.
    const cameraBeforeDesign = captureCameraView();

    // Earth is a persistent layer, but a previous "hide all" action may have
    // left Cesium's globe disabled. Make the editor's central body explicit
    // before taking the snapshot so it is restored exactly when design mode
    // closes.
    if (!celestialBodyLayers.has(EARTH_LAYER_ID)) {
        celestialBodyLayers.add(EARTH_LAYER_ID);
    }

    const layerVisibility = new Map();
    const activeLayerIds = getCompositeLayerIds().filter((layerId) => isCompositeLayerActive(layerId));
    // Take the whole snapshot before changing a single entity. Duplicated
    // layer rows share a satellite's visible state; snapshotting and hiding
    // in one pass made a duplicate record a false visibility after its source
    // had already been hidden, then restore it incorrectly on exit.
    for (const layerId of activeLayerIds) {
        layerVisibility.set(layerId, getCompositeLayerVisibility(layerId) === true);
    }
    for (const layerId of activeLayerIds) {
        // The manual-orbit editor is Earth-centred. Keep its central body
        // visible even when the user had hidden it before entering design
        // mode; the snapshot above restores that original preference later.
        setCompositeLayerVisibility(layerId, isEarthLayerId(layerId));
    }
    // Do not rely only on the layer tree here. The Earth is Cesium's native
    // globe rather than an ordinary entity, so assert its renderer state too.
    // This covers a global-hide action issued before the editor was opened.
    setCompositeLayerVisibility(EARTH_LAYER_ID, true);
    if (viewer.scene?.globe) {
        viewer.scene.globe.show = true;
    }
    viewer.scene?.requestRender?.();

    const legacyInfoPanel = document.getElementById("leftInfoPanel");
    const legacyInfoButton = document.getElementById("leftInfoBtn");
    const layersPanel = document.getElementById("leftSatellitesPanel");
    const layersButton = document.getElementById("leftSatellitesBtn");
    manualOrbitDesignSession = {
        active: true,
        layerVisibility,
        camera: cameraBeforeDesign,
        selectedSatelliteId,
        selectedEntity: viewer.selectedEntity,
        trackedEntity: viewer.trackedEntity,
        layersPanelWasOpen: layersPanel?.classList.contains("open") === true && layersPanel.hidden !== true,
        legacyInfoPanelWasOpen: legacyInfoPanel?.classList.contains("open") === true,
        legacyInfoButtonWasActive: legacyInfoButton?.classList.contains("active") === true,
        simulation: {
            mode: simulationState.mode,
            isPlaying: simulationState.isPlaying,
            playing: simulationState.playing,
            rewind: simulationState.rewind,
            speed: simulationState.speed,
            currentDate: new Date(simulationState.currentDate),
            startDate: new Date(simulationState.startDate),
            endDate: new Date(simulationState.endDate)
        }
    };

    viewer.selectedEntity = undefined;
    viewer.trackedEntity = undefined;
    layersPanel?.classList.remove("open");
    layersButton?.classList.remove("active");
    legacyInfoPanel?.classList.remove("open");
    legacyInfoButton?.classList.remove("active");
    setCurrentSelectedSatellite(null);
    setSelectedOrbitSatelliteId(null);
    // Design mode always starts from Cesium's Earth-aware Home framing.
    // Releasing a tracked satellite alone is not enough: its old orientation
    // may continue looking into space after the camera moves.
    focusManualOrbitDesignEarth();
    publishManualOrbitDesignState(true);
    window.dispatchEvent(new CustomEvent("orbit:layers-panel-state", { detail: { open: false } }));
    try {
        applyManualOrbitDesignTimeWindow();
        scheduleManualOrbitPreview({ immediate: true });
    } catch (error) {
        // A user can close the editor with an invalid draft range and reopen
        // it later. Keep the isolated design session available so the range
        // can be corrected, but never leave an exception or a stale preview
        // over the otherwise clean scene.
        clearManualOrbitPreview();
        publishManualOrbitStatus(
            "error",
            extractManualOrbitError(error, "Define un intervalo temporal válido para la órbita.")
        );
    }
}

function restoreManualOrbitDesignMode({
    useRealtime = false,
    preserveManualOrbitCreate = false,
    preserveManualOrbitEditing = false
} = {}) {
    const session = manualOrbitDesignSession;
    if (!session) {
        return;
    }

    stopManualOrbitPreviewRequest();
    if (!preserveManualOrbitCreate) {
        stopManualOrbitCreateRequest();
    }
    clearManualOrbitPreview();
    manualOrbitDesignSession = null;
    if (!preserveManualOrbitEditing) {
        // Closing or cancelling an edit never mutates the confirmed object.
        // Drop the target only after restoring the isolated design session.
        manualOrbitEditingTarget = null;
    }

    for (const [layerId, visible] of session.layerVisibility.entries()) {
        if (isCompositeLayerActive(layerId)) {
            setCompositeLayerVisibility(layerId, visible);
        }
    }

    if (useRealtime) {
        setSimulationMode(SIMULATION_MODE_REALTIME);
    } else {
        simulationState.mode = session.simulation.mode;
        simulationState.isPlaying = session.simulation.isPlaying;
        simulationState.playing = session.simulation.playing;
        simulationState.rewind = session.simulation.rewind;
        simulationState.speed = session.simulation.speed;
        simulationState.currentDate = new Date(session.simulation.currentDate);
        simulationState.startDate = new Date(session.simulation.startDate);
        simulationState.endDate = new Date(session.simulation.endDate);
        simulationState.lastTickTimestamp = Date.now();
        applySimulationDateToViewer(getDisplayedSimulationDate());
        refreshSimulationControlsUi();
        updateTopToolbarTime();
        restoreCameraView(session.camera);
        viewer.selectedEntity = session.selectedEntity;
        viewer.trackedEntity = session.trackedEntity;
        setCurrentSelectedSatellite(session.selectedSatelliteId);
        setSelectedOrbitSatelliteId(session.selectedSatelliteId);
        const legacyInfoPanel = document.getElementById("leftInfoPanel");
        const legacyInfoButton = document.getElementById("leftInfoBtn");
        legacyInfoPanel?.classList.toggle("open", session.legacyInfoPanelWasOpen === true);
        legacyInfoButton?.classList.toggle("active", session.legacyInfoButtonWasActive === true);
    }

    publishManualOrbitDesignState(false);
    const layersPanel = document.getElementById("leftSatellitesPanel");
    const layersButton = document.getElementById("leftSatellitesBtn");
    const restoreLayersPanelOpen = session.layersPanelWasOpen === true;
    layersPanel?.classList.toggle("open", restoreLayersPanelOpen);
    layersButton?.classList.toggle("active", restoreLayersPanelOpen);
    window.dispatchEvent(new CustomEvent("orbit:layers-panel-state", {
        detail: { open: restoreLayersPanelOpen }
    }));
    objectSidebar?.renderList?.();
}

function discardManualOrbitDesignForProjectChange() {
    // Project lifecycle has already cleared/loaded its own state when this
    // event fires. Do not replay visibility or simulation snapshots from the
    // old workspace; only invalidate the transient editor requests/entities.
    const hadDesignSession = Boolean(manualOrbitDesignSession?.active);
    stopManualOrbitPreviewRequest();
    stopManualOrbitCreateRequest();
    clearManualOrbitPreview();
    manualOrbitDesignSession = null;
    manualOrbitEditingTarget = null;

    if (hadDesignSession) {
        publishManualOrbitDesignState(false);
        publishManualOrbitState({ open: false });
        publishManualOrbitStatus(null, "");
    }
}

function normalizeManualOrbitDefinitionSource(value, fallback = "keplerian") {
    const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
    if (["statevector", "state-vector", "state_vector", "state"].includes(normalized)) {
        return "state-vector";
    }
    if (["keplerian", "elements"].includes(normalized)) {
        return "keplerian";
    }
    return fallback;
}

function getManualOrbitNumericalIntegratorLabel(value) {
    const normalized = String(value || "rk4").trim().toLowerCase().replace(/[\s_+/]+/g, "-");
    switch (normalized) {
        case "rk4":
        case "rk-4":
        case "runge-kutta-4":
        case "rungekutta4":
            return "RK4";
        default:
            return String(value || "numerical method").trim() || "numerical method";
    }
}

function getManualOrbitForceTermsLabel(propagationOptions = {}) {
    const configured = propagationOptions?.forceTerms ?? propagationOptions?.force_terms
        ?? propagationOptions?.gravityTerms ?? propagationOptions?.gravity_terms;
    const fallback = propagationOptions?.atmosphericDrag === true || propagationOptions?.atmospheric_drag === true
        ? ["central", "drag"]
        : ["central"];
    const labels = {
        central: "central gravity",
        j2: "J2",
        j3: "J3",
        j4: "J4",
        drag: "atmospheric drag"
    };
    return normalizeManualOrbitForceTerms(configured, fallback)
        .map((term) => labels[term] || term)
        .join(" + ");
}

function getManualOrbitPropagatorLabel(value, propagationOptions = {}) {
    switch (normalizeManualOrbitPropagator(value)) {
        case "two-body":
            return "Kepler analytical / central gravity";
        case "j2":
            return "Legacy J2 force preset";
        case "j2-j3-j4":
            return "Legacy J2 + J3 + J4 force preset";
        case "cowell-rk4":
            return `Cowell numerical / ${getManualOrbitNumericalIntegratorLabel(propagationOptions?.numericalIntegrator ?? propagationOptions?.numerical_integrator)} · forces: ${getManualOrbitForceTermsLabel(propagationOptions)}`;
        case "sgp4":
            return "Legacy synthetic TLE (unsupported)";
        default:
            return String(value || "propagador").trim() || "propagador";
    }
}

function getManualOrbitTargetAngularStepDegrees(perigeeAltitudeKm) {
    if (perigeeAltitudeKm <= 2_000) return 0.42;
    if (perigeeAltitudeKm <= 20_000) return 0.65;
    if (perigeeAltitudeKm <= 40_000) return 0.9;
    return 1.15;
}

function getManualOrbitPropagationWindow() {
    const designRange = manualOrbitDesignSession?.active
        ? getManualOrbitDesignWindow()
        : null;
    const rangeStart = designRange?.startTime || simulationState.startDate;
    const rangeEnd = designRange?.endTime || simulationState.endDate;
    const hasExplicitRange = Boolean(designRange) || (simulationState.mode === SIMULATION_MODE_RANGE
        && rangeStart instanceof Date
        && rangeEnd instanceof Date
        && !Number.isNaN(rangeStart.getTime())
        && !Number.isNaN(rangeEnd.getTime())
        && rangeEnd.getTime() > rangeStart.getTime());
    const requestedHours = hasExplicitRange
        ? getRangeHours(rangeStart.getTime(), rangeEnd.getTime())
        : Number(runtimeSystemConfig?.propagation_hours);
    // The manual design range is intentional: never substitute a shortened
    // global future-line horizon for the two epochs selected in the editor.
    // Sampling remains altitude-aware so that a LEO stays smooth without
    // wasting GEO's vertex budget on every revolution.
    const horizonHours = Number.isFinite(requestedHours) && requestedHours > 0
        ? Math.max(1 / 3600, requestedHours)
        : MANUAL_ORBIT_DEFAULT_WINDOW_HOURS;
    const displayedDate = getDisplayedSimulationDate();
    const startTime = hasExplicitRange
        ? new Date(rangeStart.getTime())
        : displayedDate instanceof Date && !Number.isNaN(displayedDate.getTime())
            ? displayedDate
            : new Date();
    const endTime = hasExplicitRange ? new Date(rangeEnd.getTime()) : null;
    const horizonSeconds = horizonHours * 3600;
    const semiMajorAxisKm = Number(manualOrbitEditorState?.keplerian?.semiMajorAxisKm);
    const eccentricity = Number(manualOrbitEditorState?.keplerian?.eccentricity);
    let stepSeconds = Math.max(15, Math.min(3600, Math.ceil(horizonSeconds / 6000)));
    if (Number.isFinite(semiMajorAxisKm) && semiMajorAxisKm > 0 && Number.isFinite(eccentricity) && eccentricity >= 0 && eccentricity < 1) {
        const earthMuKm3S2 = 398600.4418;
        const earthRadiusKm = 6378.137;
        const periodSeconds = 2 * Math.PI * Math.sqrt((semiMajorAxisKm ** 3) / earthMuKm3S2);
        const perigeeAltitudeKm = (semiMajorAxisKm * (1 - eccentricity)) - earthRadiusKm;
        const angularStep = getManualOrbitTargetAngularStepDegrees(perigeeAltitudeKm);
        const requestedSamples = Math.ceil((horizonSeconds / periodSeconds) * (360 / angularStep)) + 1;
        // Match the normal runtime's per-object cap. Each sample remains a
        // true model propagation; only the number of samples is bounded.
        const samples = Math.max(2, Math.min(7_200, requestedSamples));
        stepSeconds = Math.max(1, horizonSeconds / Math.max(1, samples - 1));
    }
    return { startTime, endTime, horizonHours, stepSeconds: clamp(stepSeconds, 1, 3600) };
}

function buildManualOrbitRequestPayload(windowRange) {
    const options = {
        source: manualOrbitDefinitionSource,
        startTime: windowRange.startTime,
        stepSeconds: windowRange.stepSeconds,
        includeVelocity: true
    };
    // Send the final epoch directly in design/range mode.  It makes the
    // server-side interval exact rather than relying on a rounded duration.
    if (windowRange.endTime) {
        options.endTime = windowRange.endTime;
    } else {
        options.horizonHours = windowRange.horizonHours;
    }
    return toManualOrbitApiPayload(manualOrbitEditorState, options);
}

function isManualOrbitProjectId(value) {
    return /^manual:[a-z0-9][a-z0-9_-]{0,95}$/i.test(String(value || "").trim());
}

function manualOrbitRecordValue(record, camelName, snakeName = camelName) {
    if (!record || typeof record !== "object") {
        return undefined;
    }
    return record[camelName] ?? record[snakeName];
}

function normalizePersistedManualOrbitRecord(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new Error("La definicion de orbita manual guardada no es valida.");
    }

    const id = String(record.id || "").trim();
    if (!isManualOrbitProjectId(id)) {
        throw new Error("La orbita manual guardada no tiene un identificador valido.");
    }

    const source = normalizeManualOrbitDefinitionSource(
        manualOrbitRecordValue(record, "definitionSource", "definition_source"),
        "keplerian"
    );
    const state = normalizeManualOrbitState({
        name: record.name,
        epochUtc: manualOrbitRecordValue(record, "epochUtc", "epoch_utc") ?? record.epoch,
        propagator: record.propagator,
        objectMetadata: manualOrbitRecordValue(record, "objectMetadata", "object_metadata"),
        propagationOptions: manualOrbitRecordValue(record, "propagationOptions", "propagation_options"),
        definitionSource: source,
        keplerian: record.keplerian,
        stateVector: manualOrbitRecordValue(record, "stateVector", "state_vector")
    }, { source });
    const startTime = asValidManualOrbitDate(manualOrbitRecordValue(record, "startTime", "start_time"));
    const endTime = asValidManualOrbitDate(manualOrbitRecordValue(record, "endTime", "end_time"));
    if (!startTime || !endTime || endTime.getTime() <= startTime.getTime()) {
        throw new Error("La orbita manual guardada no tiene un intervalo temporal valido.");
    }

    const visual = record.visual && typeof record.visual === "object" && !Array.isArray(record.visual)
        ? record.visual
        : {};
    const overrides = visual.overrides && typeof visual.overrides === "object" && !Array.isArray(visual.overrides)
        ? visual.overrides
        : {};
    const requestedStepSeconds = Number(manualOrbitRecordValue(record, "stepSeconds", "step_seconds"));
    const savedGroundTrackEnabled = manualOrbitRecordValue(record, "groundTrackEnabled", "ground_track_enabled");
    const groundTrackEnabled = typeof overrides.orbit_ground_track_show === "boolean"
        ? overrides.orbit_ground_track_show
        : savedGroundTrackEnabled !== false;
    const previewReferenceFrame = normalizeManualOrbitPreviewReferenceFrame(
        manualOrbitRecordValue(record, "previewReferenceFrame", "preview_reference_frame"),
        "eme2000"
    );
    return {
        id,
        state,
        source,
        startTime,
        endTime,
        stepSeconds: Number.isFinite(requestedStepSeconds) && requestedStepSeconds > 0
            ? clamp(requestedStepSeconds, 1, 3600)
            : null,
        groundTrackEnabled,
        previewReferenceFrame,
        visible: visual.visible !== false,
        visualizationOverrides: { ...overrides }
    };
}

/**
 * Regenerate authored manual tracks after opening a project. The project file
 * stores the compact source definition and selected date range, while the
 * propagation service produces fresh sampled ITRF ephemeris for this session.
 * This deliberately bypasses normal catalogue activation and its WebSocket.
 */
async function restoreManualOrbitsFromProject(records = []) {
    const restored = [];
    const failed = [];
    if (!Array.isArray(records)) {
        return { restored, failed };
    }

    for (const record of records) {
        let persisted;
        try {
            persisted = normalizePersistedManualOrbitRecord(record);
            const options = {
                source: persisted.source,
                startTime: persisted.startTime,
                endTime: persisted.endTime,
                includeVelocity: true
            };
            if (persisted.stepSeconds) {
                options.stepSeconds = persisted.stepSeconds;
            }
            const response = await fetch("/api/manual-orbits", {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify(toManualOrbitApiPayload(persisted.state, options))
            });
            const responsePayload = await response.json().catch(() => null);
            if (!response.ok) {
                throw responsePayload || new Error(`HTTP ${response.status}`);
            }

            const imported = importManualOrbitTrack({
                ...responsePayload,
                projectId: persisted.id,
                groundTrackEnabled: persisted.groundTrackEnabled,
                // Older API deployments may not echo these authored values.
                // Keep the project definition authoritative during restore so
                // a reopen never erases object or drag-model settings.
                name: persisted.state.name,
                propagator: persisted.state.propagator,
                definition_source: persisted.source,
                previewReferenceFrame: persisted.previewReferenceFrame,
                objectMetadata: persisted.state.objectMetadata,
                propagationOptions: persisted.state.propagationOptions
            });
            const propagationHours = Math.max(
                1 / 3600,
                (Number(imported.endTimeMs) - Number(imported.startTimeMs)) / 3_600_000
            );
            setSatelliteVisualizationConfig(imported.id, {
                orbit_ground_track_show: persisted.groundTrackEnabled,
                propagation_hours: propagationHours,
                ...persisted.visualizationOverrides
            });
            setSatelliteVisible(imported.id, persisted.visible);
            restored.push(imported.id);
        } catch (error) {
            const recordName = String(record?.name || record?.id || "orbita manual").trim();
            failed.push({ id: record?.id || null, error: extractManualOrbitError(error) });
            logger.warn(`No se pudo restaurar la orbita manual '${recordName}':`, error);
        }
    }
    return { restored, failed };
}

async function requestManualOrbitPreview() {
    if (!manualOrbitDesignSession?.active || manualOrbitCreateInFlight) {
        return;
    }

    let windowRange;
    try {
        windowRange = getManualOrbitPropagationWindow();
    } catch (error) {
        publishManualOrbitStatus("error", extractManualOrbitError(error, "Define un intervalo temporal válido para la órbita."));
        return;
    }

    const requestId = ++manualOrbitPreviewRequestId;
    if (manualOrbitPreviewAbortController) {
        manualOrbitPreviewAbortController.abort();
    }
    const controller = new AbortController();
    manualOrbitPreviewAbortController = controller;
    try {
        const response = await fetch("/api/manual-orbits", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(buildManualOrbitRequestPayload(windowRange)),
            signal: controller.signal
        });
        const responsePayload = await response.json().catch(() => null);
        if (!response.ok) {
            throw responsePayload || new Error(`HTTP ${response.status}`);
        }
        if (requestId !== manualOrbitPreviewRequestId || !manualOrbitDesignSession?.active) {
            return;
        }
        renderManualOrbitPreview(responsePayload, {
            viewer,
            // This is a live design aid and is preserved for the confirmed
            // object as well. Its projection follows the selected EME2000/ITRF
            // preview frame, so the design view never mixes both geometries.
            showGroundTrack: getManualOrbitDesignSettings().groundTrackPreview === true,
            color: "#65b7ff",
            previewReferenceFrame: getManualOrbitDesignSettings().previewReferenceFrame
        });
        publishManualOrbitStatus(null, "");
    } catch (error) {
        if (error?.name === "AbortError" || requestId !== manualOrbitPreviewRequestId) {
            return;
        }
        // Do not leave the last valid path on screen when the current edited
        // definition is rejected by the propagation service.
        clearManualOrbitPreview();
        logger.warn("No se pudo previsualizar la órbita manual:", error);
        publishManualOrbitStatus("error", extractManualOrbitError(error, "No se pudo actualizar la previsualización orbital."));
    } finally {
        if (manualOrbitPreviewAbortController === controller) {
            manualOrbitPreviewAbortController = null;
        }
    }
}

function scheduleManualOrbitPreview({ immediate = false } = {}) {
    if (!manualOrbitDesignSession?.active) {
        return;
    }
    stopManualOrbitPreviewRequest();
    if (immediate) {
        void requestManualOrbitPreview();
        return;
    }
    manualOrbitPreviewTimer = setTimeout(() => {
        manualOrbitPreviewTimer = null;
        void requestManualOrbitPreview();
    }, MANUAL_ORBIT_PREVIEW_DEBOUNCE_MS);
}

function extractManualOrbitError(error, fallback = "No se pudo crear la orbita manual.") {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    if (typeof error === "string" && error.trim()) {
        return error.trim();
    }
    if (error && typeof error === "object") {
        const detail = error.detail || error.error || error.message;
        if (Array.isArray(detail)) {
            const messages = detail
                .map((item) => String(item?.msg || item?.message || "").trim())
                .filter(Boolean);
            if (messages.length) return messages.join(". ");
        }
        if (typeof detail === "string" && detail.trim()) return detail.trim();
    }
    return fallback;
}

function isManualOrbitMetadataOnlySource(source) {
    const normalized = String(source || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
    return [
        "name",
        "metadata",
        "object-metadata",
        "objectmetadata",
        "object-details",
        "general",
        "general-info"
    ].includes(normalized);
}

function synchronizeManualOrbitEditor(payload, source, { publish = true } = {}) {
    try {
        const resolvedSource = normalizeManualOrbitDefinitionSource(source, "");
        manualOrbitEditorState = synchronizeManualOrbitState(manualOrbitEditorState, payload || {}, source);
        updateManualOrbitDesignSettings(payload);
        if (resolvedSource) {
            manualOrbitDefinitionSource = resolvedSource;
        }
        // Object identity changes are metadata-only: do not re-propagate
        // thousands of samples for every keystroke while the geometry is
        // unchanged. Drag/model options deliberately remain refresh triggers.
        // A ground-track toggle changes only the
        // existing preview entities, so update it immediately without a new
        // propagation request. The exact same preference remains available on
        // confirmation below.
        if (manualOrbitDesignSession?.active && source === "ground-track") {
            setManualOrbitPreviewGroundTrack(
                getManualOrbitDesignSettings().groundTrackPreview === true,
                { viewer }
            );
        }
        const shouldRefreshPreview = !isManualOrbitMetadataOnlySource(source)
            && source !== "preview"
            && source !== "ground-track";
        if (manualOrbitDesignSession?.active && shouldRefreshPreview) {
            try {
                applyManualOrbitDesignTimeWindow();
                scheduleManualOrbitPreview();
            } catch (rangeError) {
                // A previous debounce/fetch can otherwise complete after an
                // invalid range was entered and redraw a stale trajectory.
                stopManualOrbitPreviewRequest();
                clearManualOrbitPreview();
                publishManualOrbitStatus("error", extractManualOrbitError(rangeError, "Define un intervalo temporal válido para la órbita."));
            }
        }
        if (publish) {
            publishManualOrbitState();
        }
        return true;
    } catch (error) {
        if (manualOrbitDesignSession?.active) {
            // Invalid geometry must not retain (or allow an older request to
            // redraw) the preview for the previous valid editor state.
            stopManualOrbitPreviewRequest();
            clearManualOrbitPreview();
        }
        const message = extractManualOrbitError(error, "Los parametros de la orbita no forman una orbita eliptica valida.");
        logger.warn("No se pudieron sincronizar los parametros de la orbita manual:", error);
        publishManualOrbitStatus("error", message);
        return false;
    }
}

async function createManualOrbitFromEditor(payload = {}) {
    if (manualOrbitCreateInFlight) {
        return;
    }

    if (!String(payload?.name || "").trim()) {
        publishManualOrbitStatus("error", "Escribe un nombre para la orbita manual.");
        return;
    }

    // The Create event contains both tabs. Preserve the last representation
    // actually edited so a state-vector definition never gets silently
    // replaced by stale Keplerian fields from the inactive tab.
    if (!synchronizeManualOrbitEditor(payload, manualOrbitDefinitionSource, { publish: false })) {
        return;
    }

    const designSessionAtRequest = manualOrbitDesignSession;
    // Snapshot the replacement contract before the asynchronous propagation
    // starts. The editor can be closed/cancelled while the request is in
    // flight, and a later response must never update a different object.
    const editingTargetAtRequest = manualOrbitEditingTarget
        ? {
            id: manualOrbitEditingTarget.id,
            visualizationOverrides: { ...(manualOrbitEditingTarget.visualizationOverrides || {}) }
        }
        : null;
    const createRequestId = ++manualOrbitCreateRequestId;
    const controller = new AbortController();
    manualOrbitCreateAbortController = controller;
    manualOrbitCreateInFlight = true;
    stopManualOrbitPreviewRequest();
    const propagatorLabel = getManualOrbitPropagatorLabel(
        manualOrbitEditorState?.propagator,
        manualOrbitEditorState?.propagationOptions
    );
    publishManualOrbitStatus("busy", `Generando efemerides ${propagatorLabel}...`);
    try {
        const windowRange = getManualOrbitPropagationWindow();
        const requestPayload = buildManualOrbitRequestPayload(windowRange);
        const response = await fetch("/api/manual-orbits", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(requestPayload),
            signal: controller.signal
        });
        const responsePayload = await response.json().catch(() => null);
        if (!response.ok) {
            throw responsePayload || new Error(`HTTP ${response.status}`);
        }
        if (
            createRequestId !== manualOrbitCreateRequestId
            || (designSessionAtRequest && manualOrbitDesignSession !== designSessionAtRequest)
        ) {
            return;
        }

        const responseSource = normalizeManualOrbitDefinitionSource(
            responsePayload?.definition_source || responsePayload?.definitionSource,
            manualOrbitDefinitionSource
        );
        manualOrbitEditorState = normalizeManualOrbitState({
            ...responsePayload,
            epochUtc: responsePayload?.epochUtc || responsePayload?.epoch || manualOrbitEditorState.epochUtc
        }, {
            source: responseSource,
            fallback: manualOrbitEditorState
        });
        manualOrbitDefinitionSource = responseSource;

        const groundTrackEnabled = getManualOrbitDesignSettings().groundTrackPreview === true;
        const committedPayload = {
            ...responsePayload,
            // Do not depend on an API echo for the locally authored parts of
            // a manual orbit. The canonical state has already merged either
            // response spelling (camel/snake) with the current editor state.
            name: manualOrbitEditorState.name,
            propagator: manualOrbitEditorState.propagator,
            definition_source: manualOrbitDefinitionSource,
            previewReferenceFrame: getManualOrbitDesignSettings().previewReferenceFrame,
            objectMetadata: manualOrbitEditorState.objectMetadata,
            propagationOptions: manualOrbitEditorState.propagationOptions,
            groundTrackEnabled
        };
        // The preview owns separate Cesium entities; remove those before the
        // confirmed local layer is created to avoid a doubled trajectory.
        clearManualOrbitPreview();
        const imported = editingTargetAtRequest
            ? replaceManualOrbitTrack(editingTargetAtRequest.id, committedPayload)
            : importManualOrbitTrack(committedPayload);
        const manualPropagationHours = Math.max(
            1 / 3600,
            (Number(imported.endTimeMs) - Number(imported.startTimeMs)) / 3_600_000
        );
        setSatelliteVisualizationConfig(imported.id, {
            // Replacement discards the old runtime entities by design; retain
            // its visual styling while making the editor's newly selected
            // ground-track preference and interval authoritative.
            ...(editingTargetAtRequest?.visualizationOverrides || {}),
            orbit_ground_track_show: groundTrackEnabled,
            // Keep the confirmed manual path on the exact design interval
            // after returning to realtime instead of clipping it to the
            // workspace's shorter default future-line horizon.
            propagation_hours: manualPropagationHours
        });
        layerDisplayNameOverrides.set(imported.id, imported.name);
        restoreManualOrbitDesignMode({
            useRealtime: true,
            preserveManualOrbitCreate: true,
            preserveManualOrbitEditing: true
        });
        objectSidebar?.renderList?.();
        // Select the new object so its detail card is immediately available,
        // but do not start following it. Returning to the standard Earth
        // camera is much less disorienting after leaving design mode.
        activateSatelliteSelection(imported.id, false);
        resetCameraView();
        manualOrbitEditingTarget = null;
        publishManualOrbitState({ open: false });
        publishManualOrbitStatus(
            "success",
            editingTargetAtRequest
                ? `Orbita manual '${imported.name}' actualizada con ${getManualOrbitPropagatorLabel(manualOrbitEditorState?.propagator, manualOrbitEditorState?.propagationOptions)}.`
                : `Orbita manual '${imported.name}' creada con ${getManualOrbitPropagatorLabel(manualOrbitEditorState?.propagator, manualOrbitEditorState?.propagationOptions)}.`
        );
    } catch (error) {
        if (error?.name === "AbortError" || createRequestId !== manualOrbitCreateRequestId) {
            return;
        }
        const message = extractManualOrbitError(error);
        logger.warn("No se pudo crear la orbita manual:", error);
        publishManualOrbitStatus("error", message);
    } finally {
        if (manualOrbitCreateAbortController === controller) {
            manualOrbitCreateAbortController = null;
        }
        if (createRequestId === manualOrbitCreateRequestId) {
            manualOrbitCreateInFlight = false;
        }
    }
}

function setupManualOrbitEditorBridge() {
    if (manualOrbitBridgeBound) {
        return;
    }
    manualOrbitBridgeBound = true;

    const openManualOrbitDesign = (detail = {}) => {
        // The toolbar creates a new draft. Only the explicit context action
        // below is allowed to carry a stable manual-orbit replacement target.
        manualOrbitEditingTarget = null;
        updateManualOrbitDesignSettings(detail);
        enterManualOrbitDesignMode();
        publishManualOrbitState({ open: true });
    };
    const closeManualOrbitDesign = (detail = {}) => {
        updateManualOrbitDesignSettings(detail);
        restoreManualOrbitDesignMode();
        publishManualOrbitStatus(null, "");
    };

    window.addEventListener("orbit:manual-orbit-toggle", (event) => {
        if (event.detail?.open === true) {
            openManualOrbitDesign(event.detail);
        } else if (event.detail?.open === false) {
            closeManualOrbitDesign(event.detail);
        }
    });
    window.addEventListener("orbit:manual-orbit-open", (event) => openManualOrbitDesign(event.detail || {}));
    window.addEventListener("orbit:manual-orbit-close", (event) => closeManualOrbitDesign(event.detail || {}));
    window.addEventListener("orbit:manual-orbit-cancel", (event) => closeManualOrbitDesign(event.detail || {}));
    window.addEventListener("orbit:project-opened", discardManualOrbitDesignForProjectChange);
    window.addEventListener("orbit:manual-orbit-change", (event) => {
        const detail = event.detail || {};
        synchronizeManualOrbitEditor(detail, detail.source);
    });
    window.addEventListener("orbit:manual-orbit-sync-request", (event) => {
        const detail = event.detail || {};
        synchronizeManualOrbitEditor(detail, detail.source);
    });
    window.addEventListener("orbit:manual-orbit-reset", (event) => {
        manualOrbitDefinitionSource = "keplerian";
        synchronizeManualOrbitEditor(event.detail || {}, "keplerian");
        publishManualOrbitStatus(null, "");
    });
    window.addEventListener("orbit:manual-orbit-create", (event) => {
        void createManualOrbitFromEditor(event.detail || {});
    });
}

const buildPropagatedParametersContext = createPropagatedParametersContextBuilder({
    isCompositeLayerActive,
    isGroundStationLayerId,
    isCelestialBodyLayerId,
    getSatelliteSourceIdFromLayerId,
    getCompositeLayerTelemetry,
    getCompositeLayerMeta,
    getObjectTimeRange,
    getManualOrbitProjectEntry,
    getLayerDisplayName,
    getSimulationTelemetryContext,
    getManualOrbitDefinitionSource: () => manualOrbitDefinitionSource
});

function publishPropagatedParametersInspectorState(patch = {}) {
    Object.assign(propagatedParametersInspectorState, patch);
    window.dispatchEvent(new CustomEvent("orbit:propagated-parameters-state", {
        detail: { ...propagatedParametersInspectorState }
    }));
}

function stopPropagatedParametersRequest() {
    propagatedParametersRequestId += 1;
    if (propagatedParametersAbortController) {
        propagatedParametersAbortController.abort();
        propagatedParametersAbortController = null;
    }
}

function closePropagatedParametersInspector() {
    if (propagatedParametersRefreshTimer) {
        clearTimeout(propagatedParametersRefreshTimer);
        propagatedParametersRefreshTimer = null;
    }
    stopPropagatedParametersRequest();
    propagatedParametersLastContext = null;
    publishPropagatedParametersInspectorState({
        open: false,
        status: "idle",
        target: null,
        range: null,
        result: null,
        error: ""
    });
}

function propagatedParametersDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || "");
    return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePropagatedParametersRange(value = {}) {
    const range = value && typeof value === "object" ? value : {};
    const start = propagatedParametersDate(
        range.startTime
        ?? range.start_time
        ?? range.startUtc
        ?? range.start_utc
        ?? range.startDate
        ?? range.start_date
        ?? range.start
        ?? range.from
    );
    const end = propagatedParametersDate(
        range.endTime
        ?? range.end_time
        ?? range.endUtc
        ?? range.end_utc
        ?? range.endDate
        ?? range.end_date
        ?? range.end
        ?? range.to
    );
    if (!start || !end || end.getTime() <= start.getTime()) {
        throw new Error("La fecha final debe ser posterior a la fecha inicial.");
    }

    const hours = (end.getTime() - start.getTime()) / 3_600_000;
    if (!Number.isFinite(hours) || hours > PROPAGATED_PARAMETERS_MAX_RANGE_HOURS) {
        throw new Error(`El intervalo no puede superar ${PROPAGATED_PARAMETERS_MAX_RANGE_HOURS / 24} dias.`);
    }
    return {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        hours
    };
}

function getPropagatedParametersRangeOverride(context) {
    if (!context?.rangeOverride || typeof context.rangeOverride !== "object") {
        return null;
    }
    return normalizePropagatedParametersRange(context.rangeOverride);
}

function withPropagatedParametersRangeOverride(context, range, mode = "custom") {
    const normalizedRange = normalizePropagatedParametersRange(range);
    return {
        ...context,
        rangeOverride: {
            startTime: normalizedRange.startTime,
            endTime: normalizedRange.endTime,
            mode
        },
        // Keep the context summary coherent for the React Information tab.
        // `rangeOverride` remains the explicit marker that this is a user
        // selection rather than the runtime's default realtime horizon.
        startTime: normalizedRange.startTime,
        endTime: normalizedRange.endTime,
        timeRange: {
            ...(context?.timeRange || {}),
            mode,
            startDate: normalizedRange.startTime,
            endDate: normalizedRange.endTime
        }
    };
}

function withPropagatedParametersSimulationRange(context) {
    const range = normalizePropagatedParametersRange({
        startTime: simulationState.startDate,
        endTime: simulationState.endDate
    });
    return {
        ...context,
        rangeOverride: null,
        startTime: range.startTime,
        endTime: range.endTime,
        timeRange: {
            ...(context?.timeRange || {}),
            mode: "simulated",
            startDate: range.startTime,
            endDate: range.endTime
        },
        simulation: getSimulationTelemetryContext()
    };
}

function propagatedParametersRangeFromEventDetail(detail) {
    const payload = detail && typeof detail === "object" ? detail : {};
    const range = payload.range && typeof payload.range === "object"
        ? payload.range
        : payload;
    return normalizePropagatedParametersRange(range);
}

function propagatedParametersRangeError(error, fallback = "El intervalo de propagacion no es valido.") {
    // A rejected edit supersedes any in-flight propagation. Without this the
    // old response could arrive later and make the invalid dates appear valid.
    stopPropagatedParametersRequest();
    publishPropagatedParametersInspectorState({
        status: "error",
        error: extractManualOrbitError(error, fallback)
    });
}

function resolvePropagatedParametersRange(context) {
    // A user-edited interval belongs to the inspector request, not implicitly
    // to the global clock.  It has priority for both a realtime and a range
    // workspace and survives Refresh through `propagatedParametersLastContext`.
    const rangeOverride = getPropagatedParametersRangeOverride(context);
    if (rangeOverride) {
        return {
            mode: context?.kind === "manual-design" ? "manual-design-override" : "custom",
            ...rangeOverride
        };
    }

    if (context?.kind === "manual-design") {
        const start = propagatedParametersDate(context.startTime || context.timeRange?.startDate || context.manualOrbit?.epochStartUtc || context.manualOrbit?.epochUtc);
        const end = propagatedParametersDate(context.endTime || context.timeRange?.endDate || context.manualOrbit?.epochEndUtc);
        if (!start || !end || end.getTime() <= start.getTime()) {
            throw new Error("Define un intervalo de epochs válido antes de inspeccionar la órbita manual.");
        }
        const hours = (end.getTime() - start.getTime()) / 3_600_000;
        if (hours > PROPAGATED_PARAMETERS_MAX_RANGE_HOURS) {
            throw new Error(`El intervalo no puede superar ${PROPAGATED_PARAMETERS_MAX_RANGE_HOURS / 24} dias.`);
        }
        return {
            mode: "manual-design",
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            hours
        };
    }

    if (simulationState.mode === SIMULATION_MODE_RANGE) {
        const start = propagatedParametersDate(simulationState.startDate);
        const end = propagatedParametersDate(simulationState.endDate);
        if (!start || !end || end.getTime() <= start.getTime()) {
            throw new Error("El intervalo de simulación no es válido.");
        }
        const hours = (end.getTime() - start.getTime()) / 3_600_000;
        if (hours > PROPAGATED_PARAMETERS_MAX_RANGE_HOURS) {
            throw new Error(`El intervalo no puede superar ${PROPAGATED_PARAMETERS_MAX_RANGE_HOURS / 24} dias.`);
        }
        return {
            mode: "simulated",
            startTime: start.toISOString(),
            endTime: end.toISOString(),
            hours
        };
    }

    // Realtime inspection is deliberately independent of the object's
    // original/import range: it starts now and moves into the configured
    // future horizon, exactly like the realtime future-orbit view.
    const start = getDisplayedSimulationDate();
    const sourceId = String(context?.sourceId || getSatelliteSourceIdFromLayerId(context?.id || "") || "").trim();
    const visualization = sourceId ? getSatelliteVisualizationConfig(sourceId) : null;
    const requestedHours = Number(
        context?.telemetry?.propagation_future_hours
        ?? visualization?.effective?.propagation_hours
        ?? runtimeSystemConfig?.propagation_hours
    );
    const hours = Number.isFinite(requestedHours) && requestedHours > 0
        ? Math.min(requestedHours, PROPAGATED_PARAMETERS_MAX_RANGE_HOURS)
        : PROPAGATED_PARAMETERS_DEFAULT_HOURS;
    const end = new Date(start.getTime() + (hours * 3_600_000));
    return {
        mode: "realtime",
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        hours
    };
}

function getPropagatedParametersSampleCount(range) {
    const hours = Number(range?.hours);
    if (!Number.isFinite(hours) || hours <= 0) {
        return 2;
    }
    // Dense enough to reveal secular drift and drag without turning a long
    // design window into an expensive renderer-style ephemeris request.
    const requested = hours <= 48
        ? Math.round(hours * 4) + 1 // 15-minute cadence for short windows
        : Math.round(hours) + 1; // one-hour cadence for longer windows
    return Math.max(
        PROPAGATED_PARAMETERS_MIN_SAMPLES,
        Math.min(PROPAGATED_PARAMETERS_MAX_SAMPLES, requested)
    );
}

function buildPropagatedParametersTarget(context) {
    const isManual = context?.kind === "manual-design" || Boolean(context?.manualOrbit);
    const id = String(context?.id || context?.sourceId || (isManual ? "manual-design" : "")).trim();
    const name = String(context?.name || context?.manualOrbit?.name || id || "Selected orbit").trim();
    return {
        id,
        name: name || "Selected orbit",
        source: isManual ? "manual" : "catalog",
        propagator: context?.manualOrbit?.propagator || context?.propagator || (isManual ? "two-body" : "sgp4"),
        // The selected scene view is distinct from the frame in which the
        // orbital-elements endpoint derives its native state.
        displayReferenceFrame: context?.referenceFrame || null,
        referenceFrame: context?.referenceFrame || null
    };
}

function buildPropagatedParametersManualSource(context) {
    const manualOrbit = context?.manualOrbit;
    if (!manualOrbit || typeof manualOrbit !== "object") {
        throw new Error("La definición de la órbita manual ya no está disponible.");
    }
    const source = normalizeManualOrbitDefinitionSource(
        manualOrbit.definitionSource
        ?? manualOrbit.definition_source
        ?? (context?.kind === "manual-design" ? manualOrbitDefinitionSource : "keplerian"),
        "keplerian"
    );
    return {
        type: "manual",
        // The serialiser preserves the complete EME2000 state, propagator and
        // ballistic drag settings while excluding this inspector's own range.
        manualOrbit: toManualOrbitApiPayload(manualOrbit, { source })
    };
}

async function buildPropagatedParametersRequest(context, range) {
    const isManual = context?.kind === "manual-design" || Boolean(context?.manualOrbit);
    let source;
    if (isManual) {
        source = buildPropagatedParametersManualSource(context);
    } else {
        const sourceFormat = String(context?.catalogMeta?.sourceFormat || context?.catalogMeta?.source_format || "TLE").toUpperCase();
        if (sourceFormat === "OEM") {
            throw new Error("Las efemérides OEM aún no se pueden repropagar como elementos osculantes.");
        }
        const satId = String(context?.sourceId || getSatelliteSourceIdFromLayerId(context?.id || "") || "").trim();
        if (!satId) {
            throw new Error("Selecciona una capa orbital de catálogo válida.");
        }
        // The runtime normally has active catalogue propagators by ID. An
        // explicit TLE is also accepted by the inspector and keeps layers
        // imported in the browser/project usable before that runtime cache
        // has caught up with a catalogue reload.
        const tle = getSatelliteTle(satId) || await getSatelliteTleAsync(satId);
        const line1 = String(tle?.line1 || "").trim();
        const line2 = String(tle?.line2 || "").trim();
        source = line1 && line2
            ? { type: "catalog", line1, line2 }
            : { type: "catalog", satId };
    }
    return {
        source,
        startTime: range.startTime,
        endTime: range.endTime,
        samples: getPropagatedParametersSampleCount(range)
    };
}

function currentManualDesignParametersContext(context) {
    const range = getManualOrbitDesignWindow();
    const settings = getManualOrbitDesignSettings();
    return {
        ...context,
        kind: "manual-design",
        source: "manual-design",
        name: String(manualOrbitEditorState?.name || context?.name || "Manual Orbit").trim() || "Manual Orbit",
        manualOrbit: {
            ...manualOrbitEditorState,
            epochUtc: manualOrbitEditorState?.epochUtc || range.startTime.toISOString(),
            epochStartUtc: range.startTime.toISOString(),
            epochEndUtc: range.endTime.toISOString(),
            definitionSource: manualOrbitDefinitionSource,
            previewReferenceFrame: settings.previewReferenceFrame
        },
        startTime: range.startTime.toISOString(),
        endTime: range.endTime.toISOString(),
        timeRange: {
            mode: "manual-design",
            startDate: range.startTime.toISOString(),
            endDate: range.endTime.toISOString()
        },
        referenceFrame: normalizeManualOrbitPreviewReferenceFrame(
            settings.previewReferenceFrame,
            "eme2000"
        ).toUpperCase(),
        propagator: manualOrbitEditorState?.propagator || context?.propagator || null
    };
}

async function requestPropagatedParameters(context) {
    // Invalidate an earlier request before *any* preparation. Otherwise an
    // invalid next context (for example OEM) would leave the old request
    // alive and allow its late response to overwrite the new error state.
    stopPropagatedParametersRequest();
    const requestId = ++propagatedParametersRequestId;
    const target = buildPropagatedParametersTarget(context);
    let range;
    try {
        range = resolvePropagatedParametersRange(context);
    } catch (error) {
        if (requestId !== propagatedParametersRequestId) {
            return;
        }
        propagatedParametersLastContext = context;
        publishPropagatedParametersInspectorState({
            open: true,
            status: "error",
            target,
            range: null,
            result: null,
            error: extractManualOrbitError(error, "No se pudieron preparar las efemérides.")
        });
        return;
    }

    propagatedParametersLastContext = context;
    const controller = new AbortController();
    propagatedParametersAbortController = controller;
    publishPropagatedParametersInspectorState({
        open: true,
        status: "propagating",
        target,
        range,
        result: null,
        error: ""
    });

    try {
        const requestPayload = await buildPropagatedParametersRequest(context, range);
        if (requestId !== propagatedParametersRequestId || propagatedParametersInspectorState.open !== true) {
            return;
        }
        const response = await fetch("/api/orbit-parameters", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(requestPayload),
            signal: controller.signal
        });
        const responsePayload = await response.json().catch(() => null);
        if (!response.ok) {
            throw responsePayload || new Error(`HTTP ${response.status}`);
        }
        if (requestId !== propagatedParametersRequestId || propagatedParametersInspectorState.open !== true) {
            return;
        }
        const resolvedRange = {
            ...range,
            startTime: responsePayload?.start_time || responsePayload?.startTime || range.startTime,
            endTime: responsePayload?.end_time || responsePayload?.endTime || range.endTime,
            referenceFrame: responsePayload?.reference_frame || responsePayload?.referenceFrame || null
        };
        publishPropagatedParametersInspectorState({
            status: "ready",
            target,
            range: resolvedRange,
            result: responsePayload,
            error: ""
        });
        window.dispatchEvent(new CustomEvent("orbit:propagated-parameters-result", {
            detail: { status: "ready", target, range: resolvedRange, result: responsePayload }
        }));
    } catch (error) {
        if (error?.name === "AbortError" || requestId !== propagatedParametersRequestId) {
            return;
        }
        publishPropagatedParametersInspectorState({
            status: "error",
            target,
            range,
            result: null,
            error: extractManualOrbitError(error, "No se pudieron calcular las efemérides.")
        });
    } finally {
        if (propagatedParametersAbortController === controller) {
            propagatedParametersAbortController = null;
        }
    }
}

function setupPropagatedParametersEntryBridge() {
    if (propagatedParametersBridgeBound) {
        return;
    }
    propagatedParametersBridgeBound = true;

    window.addEventListener(PROPAGATED_PARAMETERS_OPEN_EVENT, (event) => {
        const context = buildPropagatedParametersContext(event.detail || {});
        if (!context) {
            return;
        }
        emitPropagatedParametersContext(context);
    });
}

function setupPropagatedParametersInspector() {
    if (propagatedParametersInspectorBound) {
        return;
    }
    propagatedParametersInspectorBound = true;

    window.addEventListener("orbit:propagated-parameters-context", (event) => {
        const context = event.detail && typeof event.detail === "object" ? event.detail : null;
        if (!context) {
            return;
        }
        void requestPropagatedParameters(context);
    });
    window.addEventListener("orbit:propagated-parameters-refresh", () => {
        if (propagatedParametersLastContext) {
            void requestPropagatedParameters(propagatedParametersLastContext);
        }
    });
    window.addEventListener("orbit:propagated-parameters-range-change", (event) => {
        const context = propagatedParametersLastContext;
        if (!context) {
            return;
        }
        try {
            const range = propagatedParametersRangeFromEventDetail(event.detail);
            const nextContext = withPropagatedParametersRangeOverride(
                context,
                range,
                context.kind === "manual-design" ? "manual-design-override" : "custom"
            );
            void requestPropagatedParameters(nextContext);
        } catch (error) {
            propagatedParametersRangeError(error);
        }
    });
    window.addEventListener("orbit:propagated-parameters-apply-simulation", (event) => {
        const context = propagatedParametersLastContext;
        if (!context) {
            return;
        }

        let requestedRange;
        try {
            requestedRange = propagatedParametersRangeFromEventDetail(event.detail);
        } catch (error) {
            propagatedParametersRangeError(error);
            return;
        }

        if (context.kind === "manual-design") {
            // The manual-design session already owns the global clock and
            // keeps it aligned to the editor epochs. Applying an arbitrary
            // inspector interval globally would make the preview and its
            // epoch fields disagree, so it is deliberately a local override
            // until the user changes the design window itself.
            const nextContext = withPropagatedParametersRangeOverride(
                context,
                requestedRange,
                "manual-design-override"
            );
            void requestPropagatedParameters(nextContext);
            return;
        }

        // This command intentionally applies immediately: the dates were
        // already explicitly entered in the inspector, and the same runtime
        // path updates Cesium, the timeline and telemetry context together.
        if (!applySimulationRange(
            new Date(requestedRange.startTime),
            new Date(requestedRange.endTime)
        )) {
            propagatedParametersRangeError(new Error("No se pudo aplicar el intervalo de simulacion."));
            return;
        }
        setSimulationMode(SIMULATION_MODE_RANGE);
        simulationState.currentDate = new Date(simulationState.startDate);
        simulationState.isPlaying = false;
        simulationState.playing = false;
        simulationState.rewind = false;
        simulationState.lastTickTimestamp = Date.now();
        applySimulationDateToViewer(simulationState.currentDate);
        refreshSimulationControlsUi();
        updateTopToolbarTime();

        try {
            // Drop the local override after it becomes the shared range, so a
            // later Refresh follows any normal simulation timeline changes.
            void requestPropagatedParameters(withPropagatedParametersSimulationRange(context));
        } catch (error) {
            propagatedParametersRangeError(error);
        }
    });
    window.addEventListener("orbit:propagated-parameters-close", () => {
        closePropagatedParametersInspector();
    });
    window.addEventListener("orbit:propagated-parameters-cancel", () => {
        closePropagatedParametersInspector();
    });
    window.addEventListener("orbit:selected-layer-state", (event) => {
        if (propagatedParametersInspectorState.open !== true || propagatedParametersLastContext?.kind === "manual-design") {
            return;
        }
        const detail = event.detail || {};
        const id = String(detail.id || "").trim();
        const isOrbital = detail.active === true && String(detail.layerType || "SATELLITE").toUpperCase() === "SATELLITE";
        if (!isOrbital || !id) {
            closePropagatedParametersInspector();
            return;
        }
        if (id !== propagatedParametersLastContext?.id) {
            emitPropagatedParametersOpen({ id, source: "selection" });
        }
    });
    window.addEventListener("orbit:object-state-changed", (event) => {
        if (propagatedParametersInspectorState.open !== true || propagatedParametersLastContext?.kind === "manual-design") {
            return;
        }
        const context = propagatedParametersLastContext;
        const targetId = String(context?.id || "").trim();
        if (!targetId) {
            return;
        }
        const change = event.detail || {};
        const changedLayerId = String(change.layerId || "").trim();
        const changedSourceId = String(change.sourceId || changedLayerId).trim();
        const targetSourceId = String(context?.sourceId || getSatelliteSourceIdFromLayerId(targetId) || "").trim();
        const affectsTarget = change.scope === "all-satellites"
            || changedLayerId === targetId
            || (targetSourceId && changedSourceId === targetSourceId);
        if (!affectsTarget || isCompositeLayerActive(targetId)) {
            return;
        }
        if (selectedSatelliteId === targetId || getSatelliteSourceIdFromLayerId(selectedSatelliteId || "") === targetSourceId) {
            setCurrentSelectedSatellite(null);
            setSelectedOrbitSatelliteId(null);
            viewer.selectedEntity = undefined;
        }
        closePropagatedParametersInspector();
    });
    window.addEventListener("orbit:manual-orbit-change", (event) => {
        if (propagatedParametersInspectorState.open !== true || propagatedParametersLastContext?.kind !== "manual-design") {
            return;
        }
        const source = String(event.detail?.source || "").trim().toLowerCase();
        if (source === "preview-reference-frame") {
            // This changes only the scene preview. Preserve the computed
            // orbital elements while making their display-frame provenance
            // update immediately in the inspector.
            const context = currentManualDesignParametersContext(propagatedParametersLastContext);
            propagatedParametersLastContext = context;
            publishPropagatedParametersInspectorState({
                target: buildPropagatedParametersTarget(context)
            });
            return;
        }
        if (isManualOrbitMetadataOnlySource(source) || source === "ground-track") {
            return;
        }
        if (propagatedParametersRefreshTimer) {
            clearTimeout(propagatedParametersRefreshTimer);
        }
        propagatedParametersRefreshTimer = setTimeout(() => {
            propagatedParametersRefreshTimer = null;
            try {
                void requestPropagatedParameters(currentManualDesignParametersContext(propagatedParametersLastContext));
            } catch (error) {
                publishPropagatedParametersInspectorState({
                    status: "error",
                    result: null,
                    error: extractManualOrbitError(error, "El intervalo de diseño no es válido.")
                });
            }
        }, PROPAGATED_PARAMETERS_MANUAL_REFRESH_DEBOUNCE_MS);
    });
    window.addEventListener("orbit:manual-orbit-design-state", (event) => {
        if (event.detail?.active !== true && propagatedParametersLastContext?.kind === "manual-design") {
            closePropagatedParametersInspector();
        }
    });
}

(async function init() {
    const config = initialBootConfig || await loadSystemConfig({
        onError: (error) => logger.error("Could not load system_config.json:", error)
    });
    const currentConfig = {
        ...(config || {}),
        system: toSectionedSystemConfig(config?.system || {})
    };
    currentRuntimeDataConfig = currentConfig?.data || { satellites_catalog_file: "catalog.json", offline_mode: false };
    earthBasemapManager.setOfflineMode(currentRuntimeDataConfig.offline_mode === true);
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

    objectSidebar = null;

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
    setSimulationTimelineProvider(() => ({
        date: getDisplayedSimulationDate(),
        mode: simulationState.mode,
        rangeStart: simulationState.startDate,
        rangeEnd: simulationState.endDate
    }));
    refreshSimulationControlsUi();
    
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
    const infoPanelContent = document.getElementById("legacyHiddenInfo");
    
    objectSidebar = setupObjectSidebar({
        getCatalogIds: () => getSatelliteIds(),
        fetchCatalogPage: (params) => fetchCatalogPage(params),
        getLayerIds: () => getCompositeLayerIds(),
        getObjectTelemetry: (id) => getCompositeLayerTelemetry(id),
        getObjectTimeRange: (id, telemetry) => getObjectTimeRange(id, telemetry),
        getObjectVisibility: (id) => getCompositeLayerVisibility(id),
        onToggleObjectVisibility: (id, visible) => {
            if (isManualOrbitDesignActive()) return false;
            setCompositeLayerVisibility(id, visible);
            return true;
        },
        getObjectLayerActive: (id) => isCompositeLayerActive(id),
        onToggleObjectLayer: (id, active) => {
            if (isManualOrbitDesignActive()) return false;
            return setCompositeLayerActive(id, active);
        },
        onAddAllLayers: () => {
            if (isManualOrbitDesignActive()) return false;
            return setAllSatelliteLayersActive(true);
        },
        onRemoveAllLayers: () => {
            if (isManualOrbitDesignActive()) return false;
            bodyCentricCamera.deactivate();
            setAllSatelliteLayersActive(false);
            for (const stationId of [...groundStationLayers.keys()]) {
                removeGroundStationLayer(stationId);
            }
            for (const bodyId of [...celestialBodyLayers.getIds()]) {
                setCompositeLayerActive(bodyId, false);
            }
            satelliteDuplicateLayers.clear();
            layerDisplayNameOverrides.clear();
            objectSidebar?.clearProjectTree?.();
            return true;
        },
        onShowAllObjects: () => {
            if (isManualOrbitDesignActive()) return false;
            setAllSatellitesVisible(true);
            for (const stationId of groundStationLayers.keys()) {
                setCompositeLayerVisibility(stationId, true);
            }
            for (const bodyId of celestialBodyLayers.getIds()) {
                setCompositeLayerVisibility(bodyId, true);
            }
            return true;
        },
        onHideAllObjects: () => {
            if (isManualOrbitDesignActive()) return false;
            bodyCentricCamera.deactivate();
            setAllSatellitesVisible(false);
            for (const stationId of groundStationLayers.keys()) {
                setCompositeLayerVisibility(stationId, false);
            }
            for (const bodyId of celestialBodyLayers.getIds()) {
                setCompositeLayerVisibility(bodyId, false);
            }
            return true;
        },
        onFocusObject: (id) => {
            if (isManualOrbitDesignActive()) return false;
            const entity = getCompositeLayerEntity(id);
            if (!entity) {
                return false;
            }
            setCurrentSelectedSatellite(id);
            syncSelectedOrbitLayer(id);
            centerViewOnObject(id);
            return true;
        },
        onSelectObject: (id) => {
            if (isManualOrbitDesignActive()) return false;
            const entity = getCompositeLayerEntity(id);
            if (!entity) {
                return false;
            }
            setCurrentSelectedSatellite(id);
            syncSelectedOrbitLayer(id);
            viewer.selectedEntity = entity;
            return true;
        },
        onOpenVisualizationOptions: (id) => {
            if (isManualOrbitDesignActive()) return;
            if (!id) {
                return;
            }
            if (isCelestialBodyLayerId(id)) {
                return;
            }
            if (isGroundStationLayerId(id)) {
                openLeftSatellitesPanel();
                objectSidebar?.openGroundStationEditor?.(id);
                return;
            }
            const sourceId = getSatelliteSourceIdFromLayerId(id);
            if (!sourceId) {
                return;
            }
            openSatelliteVisualizationModal(sourceId);
        },
        // The layer-tree context action is deliberately backed by the same
        // local registry as the globe context menu.  It is not enough for an
        // object to expose TLE-like fields: only a workspace-authored manual
        // track can be reopened in the orbital editor.
        onRequestEditManualOrbit: (id) => editManualOrbitFromWorkspace(id),
        canEditManualOrbit: (id) => Boolean(
            getManualOrbitProjectEntry(getSatelliteSourceIdFromLayerId(id))
        ),
        getGroundTrackVisible: (id) => getSatelliteVisualizationConfig(getSatelliteSourceIdFromLayerId(id))?.effective?.orbit_ground_track_show === true,
        onToggleGroundTrack: (id) => {
            const sourceId = getSatelliteSourceIdFromLayerId(id);
            const current = getSatelliteVisualizationConfig(sourceId)?.effective?.orbit_ground_track_show === true;
            setSatelliteVisualizationConfig(sourceId, { orbit_ground_track_show: !current });
        },
        onRequestAddSatellite: () => openLeftSatellitesPanel(),
        onRequestAddCelestialBody: (kind) => {
            const layerId = celestialBodyLayers.add(kind);
            if (!layerId) {
                return null;
            }
            openLeftSatellitesPanel();
            objectSidebar?.renderList?.();
            emitObjectStateChanged({ layerId, sourceId: layerId, reason: "activation" });
            return layerId;
        },
        onRequestCreateGroundStation: (payload) => {
            const id = createGroundStationLayer(payload);
            if (!id) {
                return null;
            }
            clearGroundStationPreview();
            openLeftSatellitesPanel();
            publishGroundStationsState();
            return id;
        },
        onRequestUpdateGroundStation: (id, payload) => updateGroundStationLayer(id, payload),
        onPreviewGroundStation: (payload) => previewGroundStation(payload),
        onClearGroundStationPreview: () => clearGroundStationPreview(),
        onRequestDuplicateLayer: (id) => {
            if (isGroundStationLayerId(id) || isCelestialBodyLayerId(id)) {
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
        getObjectSourceId: (id) => (isGroundStationLayerId(id) || isCelestialBodyLayerId(id))
            ? String(id || "")
            : getSatelliteSourceIdFromLayerId(id),
        getGroundStationParams: (id) => getGroundStationParams(id),
        getObjectTle: (id) => isCelestialBodyLayerId(id) ? null : getSatelliteTle(getSatelliteSourceIdFromLayerId(id)),
        getObjectTleAsync: (id) => isCelestialBodyLayerId(id) ? Promise.resolve(null) : getSatelliteTleAsync(getSatelliteSourceIdFromLayerId(id)),
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
            return true;
        },
        onImportOemEphemeris: (content, fileName) => {
            const imported = importOemEphemerisTrack(content, fileName);
            const bounds = getLoadedOemEphemerisTimeBounds();
            if (bounds) {
                applySimulationRange(new Date(bounds.startTimeMs), new Date(bounds.endTimeMs));
            }
            setSimulationMode(SIMULATION_MODE_RANGE);
            return imported;
        },
        getUiText: () => uiText,
        containerElement: satellitesPanelContent,
        infoContainerElement: infoPanelContent
    });

    setupManualOrbitEditorBridge();
    setupPropagatedParametersEntryBridge();
    setupPropagatedParametersInspector();

    window.addEventListener("orbit:ground-stations-request-state", publishGroundStationsState);
    window.addEventListener("orbit:ground-stations-export-request", (event) => {
        const detail = event.detail || {};
        exportGroundStations(detail.stationId, detail.format);
    });
    window.addEventListener("orbit:ground-stations-import-request", requestGroundStationImport);
    window.addEventListener("orbit:ground-stations-export-geojson", (event) => {
        // Kept for legacy controls that have not yet mounted the format picker.
        exportGroundStations(event.detail?.stationId, GROUND_STATION_EXPORT_FORMATS.GEOJSON);
    });
    window.addEventListener("orbit:project-action", (event) => {
        if (event.detail === "export-ground-stations") {
            window.dispatchEvent(new CustomEvent("orbit:ground-stations-export-menu-open", {
                detail: { stationId: null, source: "project", anchor: null }
            }));
        }
        if (event.detail === "import-ground-stations") {
            requestGroundStationImport();
        }
    });
    window.addEventListener("orbit:ground-stations-create-request", () => {
        // Entering the station designer replaces the operational workspace
        // with an isolated preview. Ask first so cancelling leaves the
        // current Layers view completely untouched.
        void objectSidebar?.requestNewGroundStationDesign?.();
    });
    window.addEventListener("orbit:ground-stations-analyze", (event) => {
        void analyzeGroundStationPasses(event.detail || {});
    });
    window.addEventListener("orbit:ground-stations-analysis-cancel", cancelGroundStationPassAnalysis);

    // A welcome action submitted while the catalogue is loading is queued by
    // React. Bind and publish `ready` only after the sidebar can restore the
    // project's layer tree, then replay that queue without losing folders.
    bindProjectLifecycleEvents({
        projectLifecycle,
        requestDialog: requestProjectActionDialog,
        getProjectFileHandle: () => currentProjectFileHandle,
        setProjectFileHandle: (value) => { currentProjectFileHandle = value; },
        isProjectFile: (file) => file instanceof File,
        showAlert: showAppAlert,
        getAlertTitle: () => uiText("alertTitle"),
        logger: console
    });

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

        const suffixes = ["-orbit", "-ground-track", "-footprint"];
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
        // The preview is the only selectable visual in a design session.  Do
        // not let an incidental globe click reopen telemetry for a hidden
        // operational layer while the user is editing orbital parameters.
        if (manualOrbitDesignSession?.active) {
            return;
        }
        const picked = viewer.scene.pick(movement.position);
        const pickedId = resolvePickedLayerId(picked);

        if (pickedId && isCompositeLayerActive(pickedId) && getCompositeLayerTelemetry(pickedId)) {
            objectSidebar.selectObject(pickedId);
            const entity = getCompositeLayerEntity(pickedId);
            if (entity) {
                setCurrentSelectedSatellite(pickedId);
                syncSelectedOrbitLayer(pickedId);
                viewer.selectedEntity = entity;
            }
            return;
        }

        setCurrentSelectedSatellite(null);
        setSelectedOrbitSatelliteId(null);
        viewer.selectedEntity = undefined;
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    viewer.screenSpaceEventHandler.setInputAction((movement) => {
        if (manualOrbitDesignSession?.active) {
            return;
        }
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
        syncSelectedOrbitLayer(pickedId);
        viewer.selectedEntity = entity;
        if (isGroundStationLayerId(pickedId)) {
            focusSatellite(entity);
        } else if (isSatelliteLayer(pickedId)) {
            // Double-click now uses the same stable local-orbit camera as
            // regular satellite focus. The dedicated first-person helper is
            // retained for an explicit cockpit action rather than being the
            // default interaction.
            focusSatellite(entity);
        } else {
            centerViewOnObject(pickedId);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    viewer.screenSpaceEventHandler.setInputAction((movement) => {
        if (manualOrbitDesignSession?.active) {
            hideSatelliteContextMenu();
            return;
        }
        const picked = viewer.scene.pick(movement.position);
        const pickedId = resolvePickedLayerId(picked);

        if (!pickedId || !isCompositeLayerActive(pickedId) || !getCompositeLayerTelemetry(pickedId)) {
            hideSatelliteContextMenu();
            return;
        }

        objectSidebar.selectObject(pickedId);
        setCurrentSelectedSatellite(pickedId);
        syncSelectedOrbitLayer(pickedId);

        const canvasRect = viewer.scene.canvas.getBoundingClientRect();
        const x = canvasRect.left + movement.position.x;
        const y = canvasRect.top + movement.position.y;
        showSatelliteContextMenuAt(pickedId, x, y);
    }, Cesium.ScreenSpaceEventType.RIGHT_CLICK);

    if (viewer?.scene?.canvas) {
        viewer.scene.canvas.addEventListener("contextmenu", (event) => {
            event.preventDefault();

            if (manualOrbitDesignSession?.active) {
                hideSatelliteContextMenu();
                return;
            }

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
            syncSelectedOrbitLayer(pickedId);
            showSatelliteContextMenuAt(pickedId, event.clientX, event.clientY);
        });
    }

    logger.info("Receptor de satélites inicializado.");
})().catch((error) => {
    logger.error("Orbit runtime initialization failed:", error);
    markOrbitRuntimeFailed(error);
});
