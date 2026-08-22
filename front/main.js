import {
    initSatelliteReceiver,
    preloadSatelliteCatalog,
    fetchCatalogPage,
    refreshSatelliteCatalog,
    hydrateCatalogEntries,
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
    parseOemEphemerisContent,
    importOemEphemerisTrack,
    importManualOrbitTrack,
    replaceManualOrbitTrack,
    registerPreciseProductSatelliteEntries,
    hydratePreciseProductSatelliteEntries,
    getSatelliteDisplayName,
    getObjectIntrinsicTimeRange,
    getObjectIntrinsicTimeRangeUnion,
    getManualOrbitProjectEntries,
    getManualOrbitProjectEntry,
    renderManualOrbitPreview,
    setManualOrbitPreviewVectorVisualization,
    setManualOrbitPreviewGroundTrack,
    clearManualOrbitPreview,
    hasLoadedOemEphemerisTracks,
    getLoadedOemEphemerisTimeBounds,
    getLoadedOemEphemerisTimeRanges,
    getLoadedManualOrbitTimeRanges,
    getLoadedPreciseProductTimeRanges
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
    normalizeGroundStationExportRecords,
    parseGroundStationsDocument,
    requiresGroundStationExportService
} from "./js/features/groundStations/interchange.js";
import {
    buildManualAosLosRequest,
    ManualAosLosRequestError,
    manualAosLosSignature
} from "./js/features/groundStations/manualAosLos.js";
import {
    assessFiniteEphemerisAnalysisRange,
    finiteEphemerisAnalysisRangeMessage
} from "./js/features/groundStations/timeRangeContract.js";
import {
    buildGroundStationPassTimelineEvents,
    filterGroundStationPassTimelineEvents,
    GROUND_STATION_TIMELINE_EVENTS_EVENT
} from "./js/features/groundStations/passTimelineEvents.js";
import {
    buildPlannerLayerEvents,
    buildPlannerEopCoverageEvents,
    buildPlannerProductErpCoverageEvents,
    buildPlannerPassEvents,
    buildPlannerResourceEvents,
    normalizeManualPlannerEvent,
    normalizePlannerEvents,
    normalizePlannerState,
    PLANNER_EVENT_KINDS,
    PLANNER_MANUAL_EVENT_REMOVE_EVENT,
    PLANNER_MANUAL_EVENT_UPSERT_EVENT,
    PLANNER_STATE_EVENT,
    toPlannerEpochMs
} from "./js/features/planner/plannerEvents.js";
import { buildPlannerSourceSnapshot } from "./js/features/planner/plannerRuntimeSources.js";
import {
    assessPlannerForecastRange,
    clampPlannerViewRangeToSimulationDomain,
    defaultPlannerViewRange,
    normalizePlannerHiddenLayerIds,
    normalizePlannerViewRange,
    plannerViewRangeKey
} from "./js/features/planner/plannerRuntimeContext.js";
import { createProjectLifecycle } from "./js/runtime/projectLifecycle.js";
import { setupCameraActions } from "./js/runtime/camera/actions.js";
import { createFreeCameraKeyboardControls } from "./js/runtime/camera/freeKeyboardControls.js";
import { formatDurationCompact, parseTleEpochDate } from "./js/runtime/simulation/timeFormatting.js";
import { createSimulationState, setSimulationRange, SIMULATION_MODE_RANGE, SIMULATION_MODE_REALTIME, SIMULATION_MODE_STATIC } from "./js/runtime/simulation/simulationState.js";
import { createSimulationController } from "./js/runtime/simulation/simulationController.js";
import { resolveSimulationModeRequest } from "./js/runtime/simulation/modePolicy.js";
import {
    clearMasterTimeRange,
    clampToMasterRange,
    expandMasterTimeRange,
    getMasterTimeRange,
    isInsideMasterRange,
    setMasterTimeRange,
    validateObjectFitsMTR,
    validateObjectRange
} from "./js/runtime/simulation/masterTimeRange.js";
import { clamp, getDateAtTimelineRatio, getRangeHours, getTimelineRatio } from "./js/runtime/simulation/timeline.js";
import { requestMasterTimeRangeExpansion } from "./js/features/masterTimeRange/ui.js";
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
import { startNonBlockingStartupTask } from "./js/runtime/nonBlockingStartupTask.js";
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
import { resolvePreciseProductFrameStatus } from "./js/features/preciseProducts/frameStatus.js";
import { arrayBufferToBase64 } from "./js/features/preciseProducts/import.js";
import {
    physicalEpochAtDesignWindowStart,
    resolveManualOrbitTimePolicy
} from "./js/features/manualOrbit/timePolicy.js";
import {
    assessEarthOrientationCoverage,
    describeEarthOrientationCoverage,
    earthOrientationCoverageDetail,
    normalizeEarthOrientationWindow
} from "./js/features/timekeeping/eopCoveragePolicy.js";
import { createManualErpUploadGate } from "./js/features/manualOrbit/erpUploadGate.js";
import { createManualOrbitPreviewCheckpoint } from "./js/features/manualOrbit/previewCheckpoint.js";
import {
    OPERATION_SCOPES,
    cancelOperation,
    clearOperationsForScope,
    completeOperation,
    failOperation,
    startOperation,
    updateOperation
} from "./js/features/operations/operationsContract.js";
import { createPropagatedParametersContextBuilder } from "./js/features/propagatedParameters/context.js";
import {
    DIAGNOSTICS_STATE_EVENT,
    DIAGNOSTICS_LOCAL_STATE_EVENT,
    DIAGNOSTICS_LOCAL_STATE_REQUEST_EVENT,
    findDiagnosticComponent
} from "./js/features/diagnostics/diagnosticsContract.js";
import {
    publishStartupStatus,
    STARTUP_STATUS_REQUEST_EVENT
} from "./js/features/diagnostics/startupStatus.js";

const logger = getLogger("main");
publishStartupStatus({
    source: "frontend-runtime",
    status: "running",
    startedAt: new Date().toISOString(),
    step: {
        id: "configuration",
        label: "Comprobando configuración…",
        status: "pending"
    }
});
logger.info("Iniciando Cesium...");

logger.info("Preparando las capas base locales de la Tierra...");

const initialBootConfig = await loadSystemConfig({
    onError: (error) => {
        logger.error("Could not load system_config.json:", error);
        publishStartupStatus({
            source: "frontend-runtime",
            status: "warning",
            step: {
                id: "configuration",
                label: "Comprobando configuración…",
                status: "warning",
                message: "No se pudo leer la configuración local; se usarán valores seguros por defecto."
            }
        });
    }
});
publishStartupStatus({
    source: "frontend-runtime",
    step: initialBootConfig
        ? {
            id: "configuration",
            label: "Comprobando configuración…",
            status: "healthy",
            message: "Configuración local cargada."
        }
        : {
            id: "configuration",
            label: "Comprobando configuración…",
            status: "warning",
            message: "No se publicó una configuración local; se aplican valores por defecto."
        }
});
// ERP and gravity are validated by the service rather than the browser.  The
// pending entries make that ownership visible without fabricating a local
// success while the startup diagnostic is still being published.
publishStartupStatus({
    source: "frontend-runtime",
    step: {
        id: "erp",
        label: "Verificando parámetros de orientación terrestre (ERP)…",
        status: "pending",
        message: "Esperando la validación del servicio Orbit."
    }
});
publishStartupStatus({
    source: "frontend-runtime",
    step: {
        id: "gravity",
        label: "Comprobando modelos de gravedad locales (EGM96 / EGM2008)…",
        status: "pending",
        message: "Esperando la validación del servicio Orbit."
    }
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
let groundStationAnalysisOperationId = null;
const groundStationVisibilityLinks = new Map();
// The simulation timeline owns a separate, aggregate access forecast.  It
// must never replace the detailed single-pair AOS/LOS result (table, chart
// and live selected-link), which remains intentionally independent below.
let groundStationTimelineSelection = null;
let groundStationTimelineRequestSequence = 0;
let groundStationTimelineAbortController = null;
let groundStationTimelineOperationId = null;
let groundStationTimelineContextKey = "";
const groundStationTimelinePairResults = new Map();
const groundStationTimelinePairCache = new Map();
const groundStationTimelinePairFailures = new Map();
// Planner facts are a read-only aggregation of the scene. Only
// `plannerManualEvents` is authored state and is therefore eligible for a
// project document; passes and resource horizons always refresh from source.
const plannerPassSource = {
    status: "ready",
    events: [],
    context: null,
    failures: [],
    message: ""
};
// The planner owns a second aggregate that is deliberately independent from
// the selected-object timeline. It is populated only while the planner is
// open in Simulated mode, so opening the calendar never changes the markers
// presented by TimeControlBar or the selected station/satellite.
const plannerPassForecast = {
    status: "ready",
    events: [],
    context: null,
    failures: [],
    message: "",
    totalPairs: 0,
    completedPairs: 0,
    skippedPairs: 0
};
let plannerPassForecastOpen = false;
let plannerPassForecastRequestSequence = 0;
let plannerPassForecastAbortController = null;
let plannerPassForecastOperationId = null;
let plannerPassForecastContextKey = "";
let plannerPassForecastObservedSimulationKey = "";
const plannerPassForecastPairResults = new Map();
const plannerPassForecastPairFailures = new Map();
// React's continuous diagnostics owner can already have published before a
// hot reload / late main-runtime initialization. Seed from its cache as well
// as listening for future events so the planner never waits for the next poll.
let plannerRemoteDiagnostics = window.__orbitDiagnosticsState ?? null;
let plannerLocalDiagnostics = window.__orbitDiagnosticsLocalState ?? null;
let plannerManualEvents = [];
let plannerPassForecastViewRange = null;
let plannerHiddenLayerIds = new Set();
const plannerRuntimeErrors = new Map();
let currentProjectFileHandle = null;
let currentProjectName = null;
let objectSidebar = null;
let manualOrbitEditorState = createDefaultManualOrbitState();
let manualOrbitDefinitionSource = "keplerian";
let manualOrbitCreateInFlight = false;
let manualOrbitCreateRequestId = 0;
let manualOrbitCreateAbortController = null;
let manualOrbitCreateOperationId = null;
let manualOrbitBridgeBound = false;
let propagatedParametersBridgeBound = false;
let propagatedParametersInspectorBound = false;
let propagatedParametersAbortController = null;
let propagatedParametersRequestId = 0;
let propagatedParametersOperationId = null;
let propagatedParametersRefreshTimer = null;
let propagatedParametersLastContext = null;
const propagatedParametersInspectorState = {
    open: false,
    status: "idle",
    target: null,
    range: null,
    result: null,
    earthOrientationPreflight: null,
    earthOrientationProvenance: null,
    error: ""
};
let manualOrbitDesignSession = null;
let manualOrbitPreviewTimer = null;
let manualOrbitPreviewAbortController = null;
let manualOrbitPreviewRequestId = 0;
let manualOrbitPreviewOperationId = null;
// The panel may optimistically show new force selections while their
// propagation is running. Retain the last configuration that actually drew
// a preview so an explicit cancellation can restore a coherent editor/view.
const manualOrbitPreviewCheckpoint = createManualOrbitPreviewCheckpoint();
const manualOrbitErpUploadGate = createManualErpUploadGate();
let manualOrbitErpUploadOperationId = null;
let manualOrbitErpUploadOperationSequence = 0;
let manualOrbitDesignSettings = null;
// Set only while the design editor is modifying an already-confirmed local
// manual orbit. Catalogue/OEM objects never populate this target.
let manualOrbitEditingTarget = null;
let globeLightingEnabledByConfig = true;
const GLOBE_LIGHTING_MIN_HEIGHT_METERS = 1_200_000;
let runtimeDecayAlertPerigeeKm = 200;

// Main-runtime work that can outlive a click is reported through the same
// live ledger as sidebar imports and manual design.  Keep cancellation local
// to the actual owner: clearing a panel or changing a project aborts only
// its own request, never an unrelated scene/project operation.
let runtimeSceneOperationSequence = 0;
const runtimeSceneOperationCancels = new Map();

function runtimeSceneOperationId(kind) {
    runtimeSceneOperationSequence += 1;
    return `scene-runtime:${String(kind || "work")}:${Date.now()}:${runtimeSceneOperationSequence}`;
}

function beginRuntimeSceneOperation(kind, {
    title,
    stage = "",
    message = "",
    progress = null,
    cancelWork = null
} = {}) {
    const id = runtimeSceneOperationId(kind);
    startOperation({
        id,
        title: title || "Operaci\u00f3n de escena",
        scope: OPERATION_SCOPES.SCENE,
        stage,
        message,
        progress,
        cancellable: typeof cancelWork === "function"
    });
    if (typeof cancelWork === "function") {
        runtimeSceneOperationCancels.set(id, cancelWork);
    }
    return id;
}

function advanceRuntimeSceneOperation(id, detail = {}) {
    if (!id) return;
    updateOperation({ id, ...detail });
}

function completeRuntimeSceneOperation(id, message = "") {
    if (!id) return;
    runtimeSceneOperationCancels.delete(id);
    completeOperation({ id, message });
}

function failRuntimeSceneOperation(id, error) {
    if (!id) return;
    runtimeSceneOperationCancels.delete(id);
    const message = error instanceof Error ? error.message : String(error || "No se pudo completar la operaci\u00f3n de escena.");
    failOperation({ id, message });
}

function cancelRuntimeSceneOperation(id, message = "") {
    if (!id) return;
    const cancelWork = runtimeSceneOperationCancels.get(id);
    runtimeSceneOperationCancels.delete(id);
    try {
        cancelWork?.(message);
    } finally {
        cancelOperation({ id, message });
    }
}

function isRuntimeSceneRequestCancellation(error, controller = null) {
    return controller?.signal?.aborted === true
        || error?.name === "AbortError"
        || error?.code === "ABORT_ERR";
}

function cancelAllRuntimeSceneOperations(message = "La operaci\u00f3n de escena se cancel\u00f3 al cambiar de proyecto.") {
    for (const id of [...runtimeSceneOperationCancels.keys()]) {
        cancelRuntimeSceneOperation(id, message);
    }
}

window.addEventListener("orbit:operation-cancel-request", (event) => {
    const detail = event?.detail && typeof event.detail === "object" ? event.detail : {};
    const scope = String(detail.scope || "").trim();
    if (scope && scope !== OPERATION_SCOPES.SCENE) return;
    cancelRuntimeSceneOperation(String(detail.id || "").trim(), "Operaci\u00f3n de escena cancelada por el usuario.");
});
window.addEventListener("orbit:scene-operations-cancel", (event) => {
    const message = String(event?.detail?.message || "La operaci\u00f3n de escena se cancel\u00f3 al cambiar de proyecto.").trim();
    cancelAllRuntimeSceneOperations(message);
});

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
// Aggregate forecasts can cover many visible layers.  Limit browser/API work
// so clicking one station cannot fan out into an unbounded burst of numerical
// or precise-product propagations.
const GROUND_STATION_TIMELINE_MAX_CONCURRENCY = 2;
// The planner can inspect every visible station/satellite pair, so keep the
// same deliberately small fan-out as the selected timeline forecast.
const PLANNER_PASS_FORECAST_MAX_CONCURRENCY = 2;
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
// The precise-products endpoint is optional, but its completion state is
// still needed to fail closed when a saved `precise:` id is no longer present.
// Until it completes, project restoration keeps only a deferred identifier.
let preciseProductRegistryHydrated = false;
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
    getPlannerManualEvents: getPlannerManualEventsForProject,
    restorePlannerManualEvents: restorePlannerManualEventsFromProject,
    clearPlannerManualEvents,
    getPlannerHiddenLayerIds: getPlannerHiddenLayerIdsForProject,
    restorePlannerHiddenLayerIds: restorePlannerHiddenLayerIdsFromProject,
    clearPlannerHiddenLayerIds,
    getSimulationState: () => simulationState,
    getMasterTimeRange: () => masterTimeRangeDetail(),
    clearMasterTimeRange: clearMasterTimeRangeForProject,
    applySimulationRange,
    restoreSimulation: restoreProjectSimulationState,
    shouldPersistSatellite: shouldPersistSatelliteInProject,
    shouldClearSatelliteOnProjectReset: shouldClearSatelliteOnProjectReset,
    getSatelliteRestoreDisposition: getSatelliteRestoreDisposition,
    onSatelliteLayersRestored: revalidateRestoredProjectSatelliteLayers,
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

/** Explicit user edit of the timeline is an MTR change, never a second range. */
async function requestMasterTimeRangeFromTimeline(startDate, endDate) {
    const candidate = { startDate, endDate };
    const approval = await approveObjectRangeForMasterTimeRange(candidate, {
        objectName: "Rango seleccionado"
    });
    if (!approval.accepted) return false;
    const finalRange = approval.action === "expand" && approval.fit.masterRange
        ? {
            startDate: new Date(Math.min(approval.fit.masterRange.startDate.getTime(), startDate.getTime())),
            endDate: new Date(Math.max(approval.fit.masterRange.endDate.getTime(), endDate.getTime()))
        }
        : candidate;
    if (!await confirmLargeSimulationRangeIfNeeded(finalRange.startDate, finalRange.endDate)) {
        return false;
    }
    commitObjectRangeToMasterTimeRange(candidate);
    return applyMasterTimeRangeToSimulation({ resetCurrent: true });
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

/**
 * Return the one temporal domain in which the lower simulation dock exists.
 * Timeline events are deliberately never generated for realtime/static: a
 * rolling forecast would move beneath the operator and make a future calendar
 * ambiguous about which interval was actually analysed.
 */
function getGroundStationTimelineRange() {
    if (simulationState.mode !== SIMULATION_MODE_RANGE) return null;
    const startDate = new Date(simulationState.startDate);
    const endDate = new Date(simulationState.endDate);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
        return null;
    }
    return {
        startDate,
        endDate,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        source: "simulation-range"
    };
}

function sameGroundStationTimelineRange(left, right) {
    if (!left || !right) return false;
    const leftStart = new Date(left.startDate ?? left.startTime).getTime();
    const leftEnd = new Date(left.endDate ?? left.endTime).getTime();
    const rightStart = new Date(right.startDate ?? right.startTime).getTime();
    const rightEnd = new Date(right.endDate ?? right.endTime).getTime();
    return [leftStart, leftEnd, rightStart, rightEnd].every(Number.isFinite)
        && Math.abs(leftStart - rightStart) < 1_000
        && Math.abs(leftEnd - rightEnd) < 1_000;
}

function resolveGroundStationTimelineSelection(layerId = selectedSatelliteId) {
    const id = String(layerId || "").trim();
    if (!id || !getGroundStationTimelineRange() || !isCompositeLayerActive(id) || getCompositeLayerVisibility(id) !== true) {
        return null;
    }
    if (isGroundStationLayerId(id)) {
        return groundStationLayers.has(id) ? { kind: "station", id } : null;
    }
    if (isCelestialBodyLayerId(id)) return null;
    return { kind: "satellite", id };
}

function groundStationTimelineSelectionKey(selection, range = getGroundStationTimelineRange()) {
    if (!selection || !range) return "";
    return `${selection.kind}:${selection.id}:${range.startTime}:${range.endTime}`;
}

function isGroundStationTimelinePairVisible(stationId, satelliteLayerId) {
    const station = groundStationLayers.get(stationId);
    return station?.visible === true
        && isCompositeLayerActive(satelliteLayerId)
        && getCompositeLayerVisibility(satelliteLayerId) === true;
}

function groundStationTimelineEvents() {
    const events = [...groundStationTimelinePairResults.values()]
        .flatMap((result) => Array.isArray(result?.events) ? result.events : []);
    return filterGroundStationPassTimelineEvents(events, isGroundStationTimelinePairVisible);
}

/** Publish the aggregate contract consumed by the simulation timeline UI. */
function publishGroundStationTimelineEvents({ status = "ready", message = "", totalPairs = null, completedPairs = null, skippedPairs = null } = {}) {
    const range = getGroundStationTimelineRange();
    const selection = groundStationTimelineSelection;
    const context = selection && range
        ? {
            kind: selection.kind,
            id: selection.id,
            startTime: range.startTime,
            endTime: range.endTime,
            source: range.source
        }
        : null;
    const failures = [...groundStationTimelinePairFailures.values()].map((failure) => ({ ...failure }));
    window.dispatchEvent(new CustomEvent(GROUND_STATION_TIMELINE_EVENTS_EVENT, {
        detail: {
            context,
            status: ["loading", "ready", "error"].includes(status) ? status : "ready",
            events: context ? groundStationTimelineEvents() : [],
            ...(message ? { message: String(message) } : {}),
            ...(Number.isFinite(totalPairs) ? { totalPairs } : {}),
            ...(Number.isFinite(completedPairs) ? { completedPairs } : {}),
            ...(Number.isFinite(skippedPairs) ? { skippedPairs } : {}),
            ...(failures.length ? { failures } : {})
        }
    }));
}

function cancelGroundStationTimelinePasses(message = "C\u00e1lculo de eventos de pases cancelado.") {
    const operationId = groundStationTimelineOperationId;
    const controller = groundStationTimelineAbortController;
    if (operationId) {
        cancelRuntimeSceneOperation(operationId, message);
        return;
    }
    groundStationTimelineOperationId = null;
    groundStationTimelineAbortController = null;
    groundStationTimelineRequestSequence += 1;
    controller?.abort();
}

function clearGroundStationTimelinePasses({ clearCache = false, message = "" } = {}) {
    cancelGroundStationTimelinePasses(message || "El contexto de pases de la simulaci\u00f3n ha cambiado.");
    groundStationTimelineSelection = null;
    groundStationTimelineContextKey = "";
    groundStationTimelinePairResults.clear();
    groundStationTimelinePairFailures.clear();
    if (clearCache) groundStationTimelinePairCache.clear();
    publishGroundStationTimelineEvents({ status: "ready", message });
}

function invalidateGroundStationTimelineCache() {
    groundStationTimelinePairCache.clear();
    if (groundStationTimelineContextKey) {
        void refreshGroundStationTimelinePasses();
    }
    if (plannerPassForecastOpen) {
        void refreshPlannerPassForecast({ force: true });
    }
}

function timelinePairFailure(pair, reason) {
    return {
        stationId: pair.stationId,
        stationName: pair.stationName,
        satelliteId: pair.satelliteLayerId,
        satelliteLayerId: pair.satelliteLayerId,
        sourceSatelliteId: pair.sourceSatelliteId,
        satelliteName: pair.satelliteName,
        reason: String(reason || "No se pudieron calcular los pases.")
    };
}

function groundStationTimelineCacheKey(pair, range) {
    return [
        pair.stationId,
        pair.satelliteLayerId,
        pair.sourceSatelliteId,
        range.startTime,
        range.endTime,
        groundStationAnalysisSignature(pair.station),
        satelliteRfProfileSignature(pair.sourceSatelliteId),
        pair.request.method,
        pair.request.url,
        pair.request.requestOptions?.body || ""
    ].join("|");
}

function collectGroundStationTimelinePairs(selection, range) {
    const pairs = [];
    const skipped = [];
    const satelliteLayerIds = getCompositeLayerIds()
        .filter((id) => !isGroundStationLayerId(id) && !isCelestialBodyLayerId(id))
        .filter((id) => isCompositeLayerActive(id) && getCompositeLayerVisibility(id) === true);
    const stations = [...groundStationLayers.values()].filter((station) => station?.visible === true);

    const candidates = selection.kind === "planner"
        ? stations.flatMap((station) => satelliteLayerIds.map((satelliteLayerId) => ({
            station,
            satelliteLayerId
        })))
        : selection.kind === "station"
            ? satelliteLayerIds.map((satelliteLayerId) => ({
                station: groundStationLayers.get(selection.id),
                satelliteLayerId
            }))
            : stations.map((station) => ({ station, satelliteLayerId: selection.id }));

    for (const candidate of candidates) {
        const station = candidate.station;
        const satelliteLayerId = String(candidate.satelliteLayerId || "").trim();
        const sourceSatelliteId = getSatelliteSourceIdFromLayerId(satelliteLayerId);
        if (!station || !satelliteLayerId || !sourceSatelliteId || !isGroundStationTimelinePairVisible(station.id, satelliteLayerId)) {
            continue;
        }

        const pair = {
            key: `${station.id}:${satelliteLayerId}`,
            station,
            stationId: station.id,
            stationName: String(station.name || station.id),
            satelliteLayerId,
            sourceSatelliteId,
            satelliteName: String(getLayerDisplayName(satelliteLayerId) || sourceSatelliteId)
        };
        const sourceMeta = getCatalogEntryMeta(sourceSatelliteId) || {};
        const sourceFormat = String(sourceMeta.sourceFormat ?? sourceMeta.source_format ?? "").toUpperCase();
        if (sourceFormat === "OEM") {
            skipped.push(timelinePairFailure(pair, "AOS/LOS no est\u00e1 disponible para una OEM local."));
            continue;
        }
        if (String(getGroundStationRfModel(station).operation_mode || "").toLowerCase() === "scan") {
            skipped.push(timelinePairFailure(pair, "La estaci\u00f3n requiere una agenda de barrido para publicar pases operativos."));
            continue;
        }
        const linkContract = getGroundStationPassLinkContract(station, sourceSatelliteId);
        if (!linkContract.available) {
            skipped.push(timelinePairFailure(pair, `El perfil RF no permite el enlace (${linkContract.reason || "perfil incompleto"}).`));
            continue;
        }
        const finiteRange = assessFiniteEphemerisAnalysisRange(
            getObjectIntrinsicTimeRange(sourceSatelliteId),
            range
        );
        if (!finiteRange.allowed) {
            skipped.push(timelinePairFailure(pair, finiteEphemerisAnalysisRangeMessage(finiteRange)));
            continue;
        }
        const declaredFrameStatus = resolveGroundPassFrameStatus(sourceSatelliteId);
        if (isPreciseProductLayer(sourceSatelliteId) && declaredFrameStatus.available === false) {
            skipped.push(timelinePairFailure(pair, unavailablePreciseGroundPassMessage(declaredFrameStatus)));
            continue;
        }
        try {
            const request = createGroundStationPassRequest(station, sourceSatelliteId, range.startDate, range.endDate, {
                stepSeconds: GROUND_STATION_BACKGROUND_PASS_STEP_SECONDS,
                includeSamples: false
            });
            // A manual source owns its design window. It participates only
            // when that authored interval is exactly the range on screen;
            // never fabricate timeline events from another time domain.
            if (request.analysisWindow && !sameGroundStationTimelineRange(request.analysisWindow, range)) {
                skipped.push(timelinePairFailure(pair, "La ventana de dise\u00f1o de la \u00f3rbita manual no coincide con el rango de simulaci\u00f3n."));
                continue;
            }
            pair.request = request;
            pair.cacheKey = groundStationTimelineCacheKey(pair, range);
            pairs.push(pair);
        } catch (error) {
            skipped.push(timelinePairFailure(pair, error instanceof Error ? error.message : String(error)));
        }
    }
    return { pairs, skipped };
}

function isCurrentGroundStationTimelineRequest({ requestId, selectionKey, range, controller }) {
    return requestId === groundStationTimelineRequestSequence
        && controller === groundStationTimelineAbortController
        && selectionKey === groundStationTimelineContextKey
        && sameGroundStationTimelineRange(range, getGroundStationTimelineRange());
}

async function fetchGroundStationTimelinePair(pair, controller) {
    const response = await fetch(pair.request.url, {
        ...pair.request.requestOptions,
        signal: controller.signal
    });
    if (!response.ok) throw await groundStationPassResponseError(response);
    const payload = await response.json();
    return {
        ...pair,
        passes: Array.isArray(payload?.passes) ? payload.passes : [],
        events: buildGroundStationPassTimelineEvents({
            stationId: pair.stationId,
            stationName: pair.stationName,
            satelliteLayerId: pair.satelliteLayerId,
            sourceSatelliteId: pair.sourceSatelliteId,
            satelliteName: pair.satelliteName,
            passes: payload?.passes
        })
    };
}

async function refreshGroundStationTimelinePasses() {
    const selection = resolveGroundStationTimelineSelection();
    const range = getGroundStationTimelineRange();
    const selectionKey = groundStationTimelineSelectionKey(selection, range);
    if (!selection || !range || !selectionKey) {
        clearGroundStationTimelinePasses();
        return;
    }

    cancelGroundStationTimelinePasses("La selecci\u00f3n o el rango de pases cambi\u00f3.");
    groundStationTimelineSelection = selection;
    groundStationTimelineContextKey = selectionKey;
    groundStationTimelinePairResults.clear();
    groundStationTimelinePairFailures.clear();

    const { pairs, skipped } = collectGroundStationTimelinePairs(selection, range);
    skipped.forEach((failure) => groundStationTimelinePairFailures.set(
        `${failure.stationId}:${failure.satelliteLayerId}`,
        failure
    ));
    const pending = [];
    for (const pair of pairs) {
        const cached = groundStationTimelinePairCache.get(pair.cacheKey);
        if (cached) {
            groundStationTimelinePairResults.set(pair.key, cached);
        } else {
            pending.push(pair);
        }
    }

    const totalPairs = pairs.length;
    let completedPairs = totalPairs - pending.length;
    if (!pending.length) {
        const allFailed = totalPairs === 0 && skipped.length > 0;
        publishGroundStationTimelineEvents({
            status: allFailed ? "error" : "ready",
            message: totalPairs ? "Eventos de pases listos desde cache." : "No hay pares visibles con pases operativos disponibles.",
            totalPairs,
            completedPairs,
            skippedPairs: skipped.length
        });
        return;
    }

    const requestId = ++groundStationTimelineRequestSequence;
    const controller = new AbortController();
    groundStationTimelineAbortController = controller;
    let operationId = null;
    let terminal = false;
    operationId = beginRuntimeSceneOperation("ground-station-timeline", {
        title: "Calculando eventos de pases",
        stage: "Analizando pares visibles",
        message: `Calculando AOS/LOS para ${pending.length} pares visibles.`,
        progress: totalPairs ? Math.round((completedPairs / totalPairs) * 100) : null,
        cancelWork: () => {
            const ownsForecast = groundStationTimelineAbortController === controller
                || groundStationTimelineOperationId === operationId;
            if (!ownsForecast) return;
            groundStationTimelineAbortController = null;
            groundStationTimelineOperationId = null;
            groundStationTimelineRequestSequence += 1;
            controller.abort();
            // A cancellation is an explicit decision not to present a
            // partial forecast. The cache retains completed pair responses
            // for a later deliberate refresh, while only this aggregate
            // timeline state is cleared; detailed single-pair AOS/LOS and
            // live station links remain entirely independent.
            groundStationTimelineSelection = null;
            groundStationTimelineContextKey = "";
            groundStationTimelinePairResults.clear();
            groundStationTimelinePairFailures.clear();
            publishGroundStationTimelineEvents({
                status: "ready",
                message: "Cálculo de eventos de pases cancelado."
            });
        }
    });
    groundStationTimelineOperationId = operationId;
    publishGroundStationTimelineEvents({
        status: "loading",
        totalPairs,
        completedPairs,
        skippedPairs: skipped.length
    });

    let nextIndex = 0;
    const workerCount = Math.min(GROUND_STATION_TIMELINE_MAX_CONCURRENCY, pending.length);
    const runWorker = async () => {
        while (nextIndex < pending.length && !controller.signal.aborted) {
            const index = nextIndex;
            nextIndex += 1;
            const pair = pending[index];
            try {
                const result = await fetchGroundStationTimelinePair(pair, controller);
                if (!isCurrentGroundStationTimelineRequest({ requestId, selectionKey, range, controller })) return;
                groundStationTimelinePairCache.set(pair.cacheKey, result);
                groundStationTimelinePairResults.set(pair.key, result);
            } catch (error) {
                if (isRuntimeSceneRequestCancellation(error, controller)
                    || !isCurrentGroundStationTimelineRequest({ requestId, selectionKey, range, controller })) {
                    return;
                }
                groundStationTimelinePairFailures.set(pair.key, timelinePairFailure(
                    pair,
                    error instanceof Error ? error.message : String(error)
                ));
            }
            completedPairs += 1;
            if (!isCurrentGroundStationTimelineRequest({ requestId, selectionKey, range, controller })) return;
            advanceRuntimeSceneOperation(operationId, {
                stage: "Preparando eventos de la linea temporal",
                message: `${completedPairs} de ${totalPairs} pares procesados.`,
                progress: totalPairs ? Math.round((completedPairs / totalPairs) * 100) : 100
            });
            publishGroundStationTimelineEvents({
                status: "loading",
                totalPairs,
                completedPairs,
                skippedPairs: skipped.length
            });
        }
    };

    try {
        await Promise.all(Array.from({ length: workerCount }, runWorker));
        if (!isCurrentGroundStationTimelineRequest({ requestId, selectionKey, range, controller })) {
            cancelRuntimeSceneOperation(operationId, "C\u00e1lculo de eventos de pases sustituido.");
            terminal = true;
            return;
        }
        const noResults = groundStationTimelinePairResults.size === 0;
        const status = noResults && groundStationTimelinePairFailures.size ? "error" : "ready";
        publishGroundStationTimelineEvents({
            status,
            message: status === "error" ? "No se pudieron calcular eventos de pases para los pares visibles." : "Eventos de pases actualizados.",
            totalPairs,
            completedPairs,
            skippedPairs: skipped.length
        });
        completeRuntimeSceneOperation(operationId, "Eventos de pases actualizados.");
        terminal = true;
    } catch (error) {
        if (isRuntimeSceneRequestCancellation(error, controller)
            || !isCurrentGroundStationTimelineRequest({ requestId, selectionKey, range, controller })) {
            cancelRuntimeSceneOperation(operationId, "C\u00e1lculo de eventos de pases cancelado.");
            terminal = true;
            return;
        }
        failRuntimeSceneOperation(operationId, error);
        terminal = true;
        publishGroundStationTimelineEvents({
            status: "error",
            message: error instanceof Error ? error.message : "No se pudieron calcular los eventos de pases.",
            totalPairs,
            completedPairs,
            skippedPairs: skipped.length
        });
    } finally {
        if (!terminal && operationId) {
            cancelRuntimeSceneOperation(operationId, "C\u00e1lculo de eventos de pases cancelado.");
        }
        if (groundStationTimelineAbortController === controller) {
            groundStationTimelineAbortController = null;
        }
        if (groundStationTimelineOperationId === operationId) {
            groundStationTimelineOperationId = null;
        }
    }
}

function syncGroundStationTimelineSelection() {
    const next = resolveGroundStationTimelineSelection();
    const range = getGroundStationTimelineRange();
    const nextKey = groundStationTimelineSelectionKey(next, range);
    if (!nextKey) {
        if (groundStationTimelineContextKey || groundStationTimelinePairResults.size || groundStationTimelineAbortController) {
            clearGroundStationTimelinePasses();
        }
        return;
    }
    if (nextKey === groundStationTimelineContextKey) {
        // Layer-eye toggles republish from the in-memory result set. This is
        // deliberately free of network work; hiding/showing an existing pair
        // must be immediate and reappearance must use its validated cache.
        publishGroundStationTimelineEvents({ status: groundStationTimelineAbortController ? "loading" : "ready" });
        return;
    }
    void refreshGroundStationTimelinePasses();
}

/**
 * Rebuild the selected aggregate only when a new/removed workspace layer can
 * change its pair set. A plain visibility change deliberately goes through
 * ``syncGroundStationTimelineSelection`` instead: it filters already-known
 * events synchronously and must not start network work just because an eye
 * was clicked.
 */
function refreshGroundStationTimelineForLayerMembershipChange({
    layerId = "",
    kind = "",
    allSatelliteLayers = false
} = {}) {
    // The selected timeline may have no active selection at all, while the
    // planner still owns a scene-wide agenda. Refresh its pair membership
    // independently; cached pairs remain local and do not refetch.
    if (plannerPassForecastOpen) {
        void refreshPlannerPassForecast({ force: true });
    }
    const selected = resolveGroundStationTimelineSelection();
    const normalizedKind = String(kind || "").trim().toLowerCase();
    const normalizedLayerId = String(layerId || "").trim();
    if (!selected) {
        syncGroundStationTimelineSelection();
        return;
    }
    const affectsPairs = allSatelliteLayers === true
        || selected.id === normalizedLayerId
        || (selected.kind === "station" && normalizedKind === "satellite")
        || (selected.kind === "satellite" && normalizedKind === "station");
    if (affectsPairs) {
        // Existing pair results remain in the keyed cache. Refreshing here
        // therefore calculates only newly reachable pairs while also
        // removing stale rows for a layer that has just been deactivated.
        void refreshGroundStationTimelinePasses();
        return;
    }
    syncGroundStationTimelineSelection();
}

/**
 * The calendar deliberately owns a second pass aggregate.  The selected
 * simulation timeline remains a focused aid for one station or satellite;
 * the planner, by contrast, is the scene-wide agenda and therefore includes
 * every currently visible operational pair while it is open.
 */
function isPlannerLayerVisible(layerId) {
    const id = plannerText(layerId);
    return Boolean(id) && !plannerHiddenLayerIds.has(id);
}

function isPlannerGroundStationTimelinePairVisible(stationId, satelliteLayerId) {
    return isGroundStationTimelinePairVisible(stationId, satelliteLayerId)
        && isPlannerLayerVisible(stationId)
        && isPlannerLayerVisible(satelliteLayerId);
}

function plannerForecastRangeConstraint() {
    const requestedRange = plannerPassForecastViewRange || defaultPlannerViewRange(getDisplayedSimulationDate());
    return clampPlannerViewRangeToSimulationDomain({
        range: requestedRange,
        mode: simulationState.mode,
        simulationRange: simulationState.mode === SIMULATION_MODE_RANGE
            ? { startDate: simulationState.startDate, endDate: simulationState.endDate }
            : null,
        masterRange: getMasterTimeRange()
    });
}

function plannerForecastRangeCandidate() {
    return plannerForecastRangeConstraint().range;
}

function getPlannerForecastRangeAssessment() {
    const constraint = plannerForecastRangeConstraint();
    if (!constraint.range) {
        return {
            allowed: false,
            range: null,
            reason: constraint.reason || "El intervalo del planificador no se puede calcular.",
            requestedRange: constraint.requestedRange || null,
            domain: constraint.domain || null,
            needsRebase: Boolean(constraint.requestedRange && constraint.domain)
        };
    }
    return assessPlannerForecastRange({
        range: constraint.range,
        mode: simulationState.mode,
        simulationRange: simulationState.mode === SIMULATION_MODE_RANGE
            ? { startDate: simulationState.startDate, endDate: simulationState.endDate }
            : null,
        masterRange: getMasterTimeRange()
    });
}

function plannerPassForecastVisibleEvents() {
    const events = [...plannerPassForecastPairResults.values()]
        .flatMap((result) => Array.isArray(result?.events) ? result.events : []);
    return filterGroundStationPassTimelineEvents(events, isPlannerGroundStationTimelinePairVisible);
}

function plannerPassForecastKey(range = getPlannerForecastRangeAssessment().range) {
    if (!range) return "";
    return `planner:${simulationState.mode}:${plannerViewRangeKey(range)}`;
}

function plannerPassForecastContext(range = getPlannerForecastRangeAssessment().range, { allowed = true, reason = "" } = {}) {
    if (!range) return null;
    const earthOrientationPreflight = plannerEarthOrientationCoverageDetail(
        assessPlannerEarthOrientationPreflight({
            startTime: range.startTime,
            endTime: range.endTime
        })
    );
    return {
        kind: "planner",
        startTime: range.startTime,
        endTime: range.endTime,
        source: range.source,
        view: range.view,
        mode: simulationState.mode,
        allowed: allowed === true,
        ...(reason ? { reason: String(reason) } : {}),
        ...(earthOrientationPreflight ? { earthOrientationPreflight } : {}),
        totalPairs: plannerPassForecast.totalPairs,
        completedPairs: plannerPassForecast.completedPairs,
        skippedPairs: plannerPassForecast.skippedPairs
    };
}

function isCurrentPlannerPassForecastRequest({ requestId, contextKey, range, controller }) {
    return plannerPassForecastOpen === true
        && requestId === plannerPassForecastRequestSequence
        && controller === plannerPassForecastAbortController
        && contextKey === plannerPassForecastContextKey
        && contextKey === plannerPassForecastKey(range);
}

function publishPlannerPassForecast({ status = plannerPassForecast.status, message = plannerPassForecast.message } = {}) {
    plannerPassForecast.status = ["loading", "ready", "error"].includes(status) ? status : "ready";
    plannerPassForecast.message = String(message || "");
    plannerPassForecast.events = plannerPassForecastVisibleEvents();
    plannerPassForecast.failures = [...plannerPassForecastPairFailures.values()].map((failure) => ({ ...failure }));
    plannerPassForecast.context = plannerPassForecastContext();
    publishPlannerState();
}

function cancelPlannerPassForecast(message = "Cálculo de pases del planificador cancelado.") {
    const operationId = plannerPassForecastOperationId;
    const controller = plannerPassForecastAbortController;
    if (operationId) {
        cancelRuntimeSceneOperation(operationId, message);
        return;
    }
    plannerPassForecastOperationId = null;
    plannerPassForecastAbortController = null;
    plannerPassForecastRequestSequence += 1;
    controller?.abort();
}

function clearPlannerPassForecast({ clearCache = false, message = "" } = {}) {
    cancelPlannerPassForecast(message || "El contexto de pases del planificador ha cambiado.");
    plannerPassForecastContextKey = "";
    plannerPassForecastPairResults.clear();
    plannerPassForecastPairFailures.clear();
    plannerPassForecast.status = "ready";
    plannerPassForecast.events = [];
    plannerPassForecast.context = null;
    plannerPassForecast.failures = [];
    plannerPassForecast.message = String(message || "");
    plannerPassForecast.totalPairs = 0;
    plannerPassForecast.completedPairs = 0;
    plannerPassForecast.skippedPairs = 0;
    if (clearCache) groundStationTimelinePairCache.clear();
    publishPlannerState();
}

function presentPlannerForecastConstraint(assessment) {
    const message = plannerText(assessment?.reason) || "El intervalo del planificador no se puede calcular.";
    cancelPlannerPassForecast("El intervalo del planificador no es válido.");
    plannerPassForecastContextKey = "";
    plannerPassForecastPairResults.clear();
    plannerPassForecastPairFailures.clear();
    plannerPassForecast.status = "error";
    plannerPassForecast.events = [];
    plannerPassForecast.context = plannerPassForecastContext(assessment?.range, {
        allowed: false,
        reason: message
    });
    plannerPassForecast.failures = [];
    plannerPassForecast.message = message;
    plannerPassForecast.totalPairs = 0;
    plannerPassForecast.completedPairs = 0;
    plannerPassForecast.skippedPairs = 0;
    setPlannerRuntimeError("forecast", message);
    publishPlannerState();
}

/**
 * Start (or reuse) the planner-only all-pairs forecast.  It shares only the
 * validated pair-response cache with the selected timeline; it never emits
 * `orbit:ground-station-timeline-events` and cannot replace its selection.
 */
async function refreshPlannerPassForecast({ force = false } = {}) {
    if (!plannerPassForecastOpen) return;
    const assessment = getPlannerForecastRangeAssessment();
    const range = assessment.range;
    if (!assessment.allowed || !range) {
        presentPlannerForecastConstraint(assessment);
        return;
    }

    const contextKey = plannerPassForecastKey(range);
    const earthOrientationPreflight = assessPlannerEarthOrientationPreflight({
        startTime: range.startTime,
        endTime: range.endTime
    });
    const hasReusableSnapshot = plannerPassForecast.status === "ready"
        || plannerPassForecastAbortController !== null;
    if (!force && contextKey === plannerPassForecastContextKey && hasReusableSnapshot) {
        publishPlannerPassForecast();
        return;
    }

    setPlannerRuntimeError("forecast", "");
    cancelPlannerPassForecast("El rango o los elementos del planificador cambiaron.");
    plannerPassForecastContextKey = contextKey;
    plannerPassForecastPairResults.clear();
    plannerPassForecastPairFailures.clear();

    // Planner filters are presentation-only. Forecast all scene-visible pairs
    // so an operator can re-enable a layer and see its cached events at once.
    const { pairs, skipped } = collectGroundStationTimelinePairs({ kind: "planner" }, range);
    skipped.forEach((failure) => plannerPassForecastPairFailures.set(
        `${failure.stationId}:${failure.satelliteLayerId}`,
        failure
    ));
    const pending = [];
    for (const pair of pairs) {
        const cached = groundStationTimelinePairCache.get(pair.cacheKey);
        if (cached) {
            plannerPassForecastPairResults.set(pair.key, cached);
        } else {
            pending.push(pair);
        }
    }

    const totalPairs = pairs.length;
    let completedPairs = totalPairs - pending.length;
    plannerPassForecast.totalPairs = totalPairs;
    plannerPassForecast.completedPairs = completedPairs;
    plannerPassForecast.skippedPairs = skipped.length;
    plannerPassForecast.context = plannerPassForecastContext(range);

    if (!pending.length) {
        const allFailed = totalPairs === 0 && skipped.length > 0;
        publishPlannerPassForecast({
            status: allFailed ? "error" : "ready",
            message: totalPairs
                ? "Eventos de pases del planificador listos desde caché."
                : "No hay pares visibles con pases operativos disponibles."
        });
        return;
    }

    const requestId = ++plannerPassForecastRequestSequence;
    const controller = new AbortController();
    plannerPassForecastAbortController = controller;
    let operationId = null;
    let terminal = false;
    operationId = beginRuntimeSceneOperation("planner-pass-forecast", {
        title: "Calculando eventos del planificador",
        stage: "Analizando estaciones y satélites visibles",
        message: earthOrientationOperationMessage(
            earthOrientationPreflight,
            "El cálculo AOS/LOS del planificador",
            `Calculando AOS/LOS para ${pending.length} pares visibles.`
        ),
        progress: totalPairs ? Math.round((completedPairs / totalPairs) * 100) : null,
        cancelWork: () => {
            const ownsForecast = plannerPassForecastAbortController === controller
                || plannerPassForecastOperationId === operationId;
            if (!ownsForecast) return;
            plannerPassForecastAbortController = null;
            plannerPassForecastOperationId = null;
            plannerPassForecastRequestSequence += 1;
            controller.abort();
            // Closing the panel or cancelling from the activity drawer must
            // discard its partial agenda. The shared response cache remains
            // valid and gives a future deliberate opening a fast restart.
            plannerPassForecastContextKey = "";
            plannerPassForecastPairResults.clear();
            plannerPassForecastPairFailures.clear();
            plannerPassForecast.status = "ready";
            plannerPassForecast.events = [];
            plannerPassForecast.context = null;
            plannerPassForecast.failures = [];
            plannerPassForecast.message = "Cálculo de pases del planificador cancelado.";
            plannerPassForecast.totalPairs = 0;
            plannerPassForecast.completedPairs = 0;
            plannerPassForecast.skippedPairs = 0;
            publishPlannerState();
        }
    });
    plannerPassForecastOperationId = operationId;
    publishPlannerPassForecast({ status: "loading", message: "Calculando eventos de pases de la escena." });

    let nextIndex = 0;
    const workerCount = Math.min(PLANNER_PASS_FORECAST_MAX_CONCURRENCY, pending.length);
    const runWorker = async () => {
        while (nextIndex < pending.length && !controller.signal.aborted) {
            const index = nextIndex;
            nextIndex += 1;
            const pair = pending[index];
            try {
                const result = await fetchGroundStationTimelinePair(pair, controller);
                if (!isCurrentPlannerPassForecastRequest({ requestId, contextKey, range, controller })) return;
                groundStationTimelinePairCache.set(pair.cacheKey, result);
                plannerPassForecastPairResults.set(pair.key, result);
            } catch (error) {
                if (isRuntimeSceneRequestCancellation(error, controller)
                    || !isCurrentPlannerPassForecastRequest({ requestId, contextKey, range, controller })) {
                    return;
                }
                plannerPassForecastPairFailures.set(pair.key, timelinePairFailure(
                    pair,
                    error instanceof Error ? error.message : String(error)
                ));
            }
            completedPairs += 1;
            if (!isCurrentPlannerPassForecastRequest({ requestId, contextKey, range, controller })) return;
            plannerPassForecast.completedPairs = completedPairs;
            advanceRuntimeSceneOperation(operationId, {
                stage: "Preparando agenda de pases",
                message: `${completedPairs} de ${totalPairs} pares procesados.`,
                progress: totalPairs ? Math.round((completedPairs / totalPairs) * 100) : 100
            });
            publishPlannerPassForecast({ status: "loading" });
        }
    };

    try {
        await Promise.all(Array.from({ length: workerCount }, runWorker));
        if (!isCurrentPlannerPassForecastRequest({ requestId, contextKey, range, controller })) {
            cancelRuntimeSceneOperation(operationId, "Cálculo de pases del planificador sustituido.");
            terminal = true;
            return;
        }
        const noResults = plannerPassForecastPairResults.size === 0;
        const status = noResults && plannerPassForecastPairFailures.size ? "error" : "ready";
        publishPlannerPassForecast({
            status,
            message: status === "error"
                ? "No se pudieron calcular eventos de pases para los pares visibles."
                : "Eventos de pases del planificador actualizados."
        });
        completeRuntimeSceneOperation(operationId, "Eventos del planificador actualizados.");
        terminal = true;
    } catch (error) {
        if (isRuntimeSceneRequestCancellation(error, controller)
            || !isCurrentPlannerPassForecastRequest({ requestId, contextKey, range, controller })) {
            cancelRuntimeSceneOperation(operationId, "Cálculo de pases del planificador cancelado.");
            terminal = true;
            return;
        }
        failRuntimeSceneOperation(operationId, error);
        terminal = true;
        publishPlannerPassForecast({
            status: "error",
            message: error instanceof Error ? error.message : "No se pudieron calcular los eventos del planificador."
        });
    } finally {
        if (!terminal && operationId) {
            cancelRuntimeSceneOperation(operationId, "Cálculo de pases del planificador cancelado.");
        }
        if (plannerPassForecastAbortController === controller) {
            plannerPassForecastAbortController = null;
        }
        if (plannerPassForecastOperationId === operationId) {
            plannerPassForecastOperationId = null;
        }
    }
}

function requestPlannerPassForecast() {
    plannerPassForecastOpen = true;
    if (!plannerPassForecastViewRange) {
        plannerPassForecastViewRange = plannerForecastRangeCandidate();
    }
    const assessment = getPlannerForecastRangeAssessment();
    const range = assessment.range;
    if (!assessment.allowed || !range) {
        void refreshPlannerPassForecast();
        return;
    }
    const contextKey = plannerPassForecastKey(range);
    if (contextKey === plannerPassForecastContextKey
        && (plannerPassForecastAbortController || plannerPassForecast.status === "ready")) {
        publishPlannerPassForecast();
        return;
    }
    void refreshPlannerPassForecast();
}

function syncPlannerPassForecastVisibility() {
    if (!plannerPassForecastOpen) return;
    // Scene and planner visibility are view-level filters over already
    // validated pair results. Do not restart numerical pass work just because
    // an eye/filter was clicked.
    publishPlannerPassForecast();
}

function closePlannerPassForecast() {
    plannerPassForecastOpen = false;
    setPlannerRuntimeError("forecast", "");
    clearPlannerPassForecast({ message: "El planificador se cerró; los pases pendientes se descartaron." });
}

function emitPlannerViewRangeRebase(constraint, view) {
    const domain = constraint?.domain;
    if (!domain?.startTime || !domain?.endTime || typeof window === "undefined") return false;
    window.dispatchEvent(new CustomEvent("orbit:planner-view-range-rebase", {
        detail: {
            startTime: domain.startTime,
            endTime: domain.endTime,
            view: plannerText(view) || "week",
            reason: "simulation-domain"
        }
    }));
    return true;
}

function updatePlannerPassForecastViewRange(event) {
    const nextRange = normalizePlannerViewRange(plannerRecord(event?.detail));
    if (!nextRange) {
        setPlannerRuntimeError("forecast", "El planificador recibió un intervalo UTC inválido.");
        publishPlannerState();
        return false;
    }
    const constraint = clampPlannerViewRangeToSimulationDomain({
        range: nextRange,
        mode: simulationState.mode,
        simulationRange: simulationState.mode === SIMULATION_MODE_RANGE
            ? { startDate: simulationState.startDate, endDate: simulationState.endDate }
            : null,
        masterRange: getMasterTimeRange()
    });
    if (!constraint.range && constraint.domain) {
        // A calendar period fully outside a historical SP3/MTR is not a
        // failed pass forecast. Rebase the React cursor to the authoritative
        // domain and wait for its next exact view-range event; never issue a
        // request for the invalid period or silently query another month.
        plannerPassForecastViewRange = null;
        setPlannerRuntimeError("forecast", "");
        emitPlannerViewRangeRebase(constraint, nextRange.view);
        return false;
    }
    const previousKey = plannerViewRangeKey(plannerPassForecastViewRange);
    const nextKey = plannerViewRangeKey(nextRange);
    plannerPassForecastViewRange = nextRange;
    setPlannerRuntimeError("forecast", "");
    if (plannerPassForecastOpen && previousKey !== nextKey) {
        void refreshPlannerPassForecast({ force: true });
    } else {
        publishPlannerState();
    }
    return true;
}

function syncPlannerPassForecastForSimulationState() {
    // Realtime publishes a tick on every frame and Static can publish an
    // inspection-frame update. Neither changes an explicitly requested
    // planner interval, so only a mode or the Simulated domain can refresh.
    const masterRange = getMasterTimeRange();
    const masterKey = masterRange
        ? `${masterRange.startDate?.toISOString?.() || ""}:${masterRange.endDate?.toISOString?.() || ""}`
        : "no-mtr";
    const key = simulationState.mode === SIMULATION_MODE_RANGE
        ? `${SIMULATION_MODE_RANGE}:${simulationState.startDate?.toISOString?.() || ""}:${simulationState.endDate?.toISOString?.() || ""}`
        : String(simulationState.mode || "");
    const domainKey = `${key}:${masterKey}`;
    if (domainKey === plannerPassForecastObservedSimulationKey) return;
    plannerPassForecastObservedSimulationKey = domainKey;
    if (!plannerPassForecastOpen) return;
    void refreshPlannerPassForecast({ force: true });
}

// The simulation state is published on every animation tick. Compare only
// its temporal domain before refreshing: moving the playhead must not restart
// a full pass forecast, whereas changing mode/start/end must replace it.
let groundStationTimelineObservedSimulationKey = "";
function syncGroundStationTimelineForSimulationState() {
    const range = getGroundStationTimelineRange();
    const key = range
        ? `${SIMULATION_MODE_RANGE}:${range.startTime}:${range.endTime}`
        : `inactive:${simulationState.mode}`;
    if (key === groundStationTimelineObservedSimulationKey) return;
    groundStationTimelineObservedSimulationKey = key;
    syncGroundStationTimelineSelection();
}

window.addEventListener("orbit:simulation-state", syncGroundStationTimelineForSimulationState);
window.addEventListener("orbit:simulation-state", syncPlannerPassForecastForSimulationState);
window.addEventListener("orbit:scene-operations-cancel", () => {
    // A project boundary must not carry a previous calendar page into a new
    // scene. The mounted panel will request a new finite UTC view afterwards.
    plannerPassForecastViewRange = null;
    clearGroundStationTimelinePasses({
        clearCache: true,
        message: "Los eventos de pases se descartaron al cambiar de proyecto."
    });
    clearPlannerPassForecast({
        clearCache: true,
        message: "Los eventos del planificador se descartaron al cambiar de proyecto."
    });
});
// The cache stores a prediction for a concrete source definition. A manual
// replacement (including a new ERP), precise-product hydration, or imported
// OEM can change that definition under an existing layer id, so those
// mutations explicitly invalidate it. Ordinary activation/deactivation only
// changes membership; its exact hook below reuses valid pair cache entries.
// Visibility is intentionally excluded: it is handled synchronously by
// filtering the cached event rows above.
window.addEventListener("orbit:object-state-changed", (event) => {
    const detail = event?.detail && typeof event.detail === "object" ? event.detail : {};
    const reason = String(detail.reason || "").trim().toLowerCase();
    if (["manual-orbit", "precise-product-hydration", "hydration", "oem-import"].includes(reason)) {
        invalidateGroundStationTimelineCache();
        return;
    }
    if (reason === "activation") {
        const layerId = String(detail.layerId || detail.sourceId || "").trim();
        const layerType = String(detail.layerType || "").trim().toUpperCase();
        refreshGroundStationTimelineForLayerMembershipChange({
            layerId,
            kind: layerType === "GROUND_STATION" || isGroundStationLayerId(layerId) ? "station" : "satellite",
            allSatelliteLayers: detail.scope === "all-satellites"
        });
    }
});

function formatObjectTimeRangeHours(hours) {
    const rounded = Math.round(Math.max(0, Number(hours) || 0) * 100) / 100;
    return `${rounded} h`;
}

// The visible future orbit is anchored to the current clock in realtime, while
// range mode maps it onto the explicit simulation interval. Keep that exact
// domain with the selected-object payload so the details card never presents
// stale bootstrap dates as its start/end range.
function getObjectTimeRange(layerId, telemetry) {
    // A finite source's published/generated coverage is distinct from the
    // (possibly wider) Master Time Range. Prefer it in object details so an
    // SP3/OEM/manual layer never appears to have data throughout the scene
    // merely because another object expanded the MTR.
    const intrinsicValidation = validateObjectRange(
        telemetry?.intrinsic_time_range
        ?? telemetry?.intrinsicTimeRange
        ?? telemetry?.coverage
        ?? null
    );
    if (intrinsicValidation.valid) {
        const startDate = intrinsicValidation.range.startDate;
        const endDate = intrinsicValidation.range.endDate;
        const coverageHours = getRangeHours(startDate, endDate);
        return {
            mode: SIMULATION_MODE_RANGE,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            oemRangeHours: coverageHours,
            label: `${formatObjectTimeRangeHours(coverageHours)} (cobertura propia)`
        };
    }
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

function asPreciseProductCoverageTime(value) {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.getTime();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        // Product APIs use epoch milliseconds, but accepting a numeric epoch
        // in seconds keeps external SP3 registry metadata unambiguous.
        return Math.abs(value) < 10_000_000_000 ? value * 1000 : value;
    }
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : null;
}

function resolvePreciseProductCoverage(entries = [], payload = {}) {
    const coverageFrom = (item) => {
        if (!item || typeof item !== "object") return null;
        const start = asPreciseProductCoverageTime(
            item.start_time_ms ?? item.startTimeMs ?? item.start_time ?? item.startTime ?? item.coverage_start ?? item.coverageStart
        );
        const end = asPreciseProductCoverageTime(
            item.end_time_ms ?? item.endTimeMs ?? item.end_time ?? item.endTime ?? item.coverage_end ?? item.coverageEnd ?? item.stop_time
        );
        return Number.isFinite(start) && Number.isFinite(end) && end >= start ? { start, end } : null;
    };

    const selectedEntries = (Array.isArray(entries) ? entries : [])
        .filter((entry) => entry && typeof entry === "object");
    // Members, not a product-wide intersection, define the object set that
    // the operator selected.  An SP3 product may legitimately have members
    // with different first/last usable epochs: MTR must contain their outer
    // envelope, while each member remains inactive in its own gaps.
    const memberRanges = selectedEntries.map((entry) => (
        coverageFrom(entry.intrinsicTimeRange)
        || coverageFrom(entry.intrinsic_time_range)
        || coverageFrom(entry.coverage)
        || coverageFrom(entry.timeRange)
        || coverageFrom(entry.time_range)
        || coverageFrom(entry.sp3)
        || coverageFrom(entry.inputMetadata)
        || coverageFrom(entry.input_metadata)
        || coverageFrom(entry)
    ));
    if (selectedEntries.length && memberRanges.some((range) => !range)) {
        return null;
    }

    const product = payload?.product && typeof payload.product === "object" ? payload.product : null;
    const ranges = selectedEntries.length
        ? memberRanges.filter(Boolean)
        : [coverageFrom(product), coverageFrom(product?.sp3), coverageFrom(product?.metadata)].filter(Boolean);
    if (!ranges.length) return null;

    return {
        start: Math.min(...ranges.map((range) => range.start)),
        end: Math.max(...ranges.map((range) => range.end))
    };
}

function getActivePreciseProductEntries() {
    const entriesBySourceId = new Map();
    for (const layerId of getActiveSatelliteLayerIds()) {
        const sourceId = getSatelliteSourceIdFromLayerId(layerId);
        if (!sourceId || entriesBySourceId.has(sourceId)) {
            continue;
        }
        const entry = getCatalogEntryMeta(sourceId);
        const sourceFormat = String(entry?.sourceFormat ?? entry?.source_format ?? "").toUpperCase();
        if (sourceFormat === "SP3") {
            entriesBySourceId.set(sourceId, entry);
        }
    }
    return [...entriesBySourceId.values()];
}

function getFiniteEphemerisDomainState() {
    const preciseEntries = getActivePreciseProductEntries();
    const oemRanges = getLoadedOemEphemerisTimeRanges();
    const preciseRanges = getLoadedPreciseProductTimeRanges();
    const hasOemDomain = oemRanges.length > 0;
    const hasSp3Domain = preciseRanges.length > 0;
    const manualRanges = getLoadedManualOrbitTimeRanges();
    const hasManualDomain = manualRanges.length > 0;
    return {
        hasOemDomain,
        hasSp3Domain,
        hasManualDomain,
        finiteEphemerisDomainActive: hasOemDomain || hasSp3Domain || hasManualDomain,
        finiteSources: [
            ...(hasOemDomain ? ["OEM"] : []),
            ...(hasSp3Domain ? ["SP3"] : []),
            ...(hasManualDomain ? ["órbita manual"] : [])
        ],
        preciseCoverage: hasSp3Domain ? resolvePreciseProductCoverage(preciseEntries) : null,
        manualRanges,
        oemRanges,
        preciseRanges
    };
}

function finiteEphemerisDomainLabel(domain = getFiniteEphemerisDomainState()) {
    return domain.finiteSources.join(", ") || "efemérides finitas";
}

function masterTimeRangeDetail() {
    const range = getMasterTimeRange();
    if (!range) return null;
    return {
        startDate: range.startDate.toISOString(),
        endDate: range.endDate.toISOString()
    };
}

function diagnosticsCoverageFromRanges(ranges) {
    const valid = (Array.isArray(ranges) ? ranges : []).filter((range) => (
        Number.isFinite(Number(range?.startTimeMs))
        && Number.isFinite(Number(range?.endTimeMs))
    ));
    if (!valid.length) return null;
    const startTimeMs = Math.min(...valid.map((range) => Number(range.startTimeMs)));
    const endTimeMs = Math.max(...valid.map((range) => Number(range.endTimeMs)));
    return {
        start: new Date(startTimeMs).toISOString(),
        end: new Date(endTimeMs).toISOString()
    };
}

/**
 * Snapshot of facts known by the browser runtime.  This deliberately does
 * not claim an IERS dataset, parser validation, or propagator result: those
 * belong to the diagnostics service.  It only exposes the active scene's
 * finite coverage and the explicit frame metadata already held locally.
 */
function buildDiagnosticsLocalState() {
    const finiteDomain = getFiniteEphemerisDomainState();
    const preciseEntries = getActivePreciseProductEntries();
    const preciseRanges = finiteDomain.preciseRanges;
    const preciseFrames = preciseEntries.map((entry) => resolvePreciseProductFrameStatus({
        ...entry,
        sp3: entry?.inputMetadata ?? entry?.input_metadata ?? entry?.sp3 ?? null
    }));
    const preciseMissingCoverage = preciseEntries.length > preciseRanges.length;
    const masterRange = masterTimeRangeDetail();
    const currentDate = getDisplayedSimulationDate();
    const timelineClamped = masterRange ? isInsideMasterRange(currentDate) : null;
    const sp3Status = !preciseEntries.length
        ? "warning"
        : preciseMissingCoverage || preciseFrames.some((status) => status.available === false)
            ? "error"
            : "healthy";
    const oemStatus = finiteDomain.oemRanges.length ? "healthy" : "warning";
    const mtrStatus = !masterRange ? "warning" : timelineClamped ? "healthy" : "error";

    return {
        updatedAt: new Date().toISOString(),
        source: "frontend-scene",
        sp3: {
            status: sp3Status,
            activeCount: preciseRanges.length,
            registeredActiveCount: preciseEntries.length,
            coverage: diagnosticsCoverageFromRanges(preciseRanges),
            usingEop: preciseFrames.length ? preciseFrames.every((status) => status.erpApplied === true) : null,
            eciAvailable: preciseFrames.length ? preciseFrames.every((status) => status.eciAvailable === true) : null,
            message: !preciseEntries.length
                ? "No hay un producto SP3 activo en la escena."
                : preciseMissingCoverage
                    ? "Hay un SP3 activo sin cobertura temporal local verificable."
                    : "Cobertura y procedencia leídas de los metadatos de la escena."
        },
        oem: {
            status: oemStatus,
            activeCount: finiteDomain.oemRanges.length,
            coverage: diagnosticsCoverageFromRanges(finiteDomain.oemRanges),
            message: finiteDomain.oemRanges.length
                ? "Cobertura OEM leída de las efemérides activas."
                : "No hay una efeméride OEM activa en la escena."
        },
        mtr: {
            status: mtrStatus,
            active: Boolean(masterRange),
            range: masterRange
                ? { start: masterRange.startDate, end: masterRange.endDate }
                : null,
            timelineClamped,
            currentDate: currentDate instanceof Date && !Number.isNaN(currentDate.getTime())
                ? currentDate.toISOString()
                : "",
            finiteSources: finiteDomain.finiteSources
        }
    };
}

function publishDiagnosticsLocalState() {
    const detail = buildDiagnosticsLocalState();
    window.__orbitDiagnosticsLocalState = detail;
    window.dispatchEvent(new CustomEvent(DIAGNOSTICS_LOCAL_STATE_EVENT, { detail }));
    return detail;
}

function plannerRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function plannerText(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function setPlannerRuntimeError(scope, message) {
    const normalizedScope = plannerText(scope) || "runtime";
    const normalizedMessage = plannerText(message);
    if (normalizedMessage) {
        plannerRuntimeErrors.set(normalizedScope, normalizedMessage);
    } else {
        plannerRuntimeErrors.delete(normalizedScope);
    }
}

function plannerManualOnly(events) {
    return normalizePlannerEvents(events)
        .filter((event) => event.source === "manual" && event.kind === "manual");
}

function getPlannerManualEventsForProject() {
    return plannerManualOnly(plannerManualEvents);
}

function remapPlannerManualEventGroundStations(event, groundStationIdMap = {}) {
    const source = plannerRecord(event);
    const metadata = plannerRecord(source.metadata);
    const remap = plannerRecord(groundStationIdMap);
    const stationId = plannerText(metadata.stationId);
    const stationLayerId = plannerText(metadata.stationLayerId);
    const nextMetadata = {
        ...metadata,
        ...(stationId && remap[stationId] ? { stationId: remap[stationId] } : {}),
        ...(stationLayerId && remap[stationLayerId] ? { stationLayerId: remap[stationLayerId] } : {})
    };
    return normalizeManualPlannerEvent({ ...source, metadata: nextMetadata });
}

function restorePlannerManualEventsFromProject(events, { groundStationIdMap = {} } = {}) {
    plannerManualEvents = plannerManualOnly((Array.isArray(events) ? events : [])
        .map((event) => remapPlannerManualEventGroundStations(event, groundStationIdMap)));
    setPlannerRuntimeError("manual", "");
    publishPlannerState();
    return plannerManualEvents;
}

function clearPlannerManualEvents() {
    plannerManualEvents = [];
    setPlannerRuntimeError("manual", "");
    publishPlannerState();
}

function getPlannerHiddenLayerIdsForProject() {
    return normalizePlannerHiddenLayerIds([...plannerHiddenLayerIds]);
}

function restorePlannerHiddenLayerIdsFromProject(layerIds, { groundStationIdMap = {} } = {}) {
    const remap = plannerRecord(groundStationIdMap);
    plannerHiddenLayerIds = new Set(normalizePlannerHiddenLayerIds(layerIds)
        .map((layerId) => remap[layerId] || layerId));
    setPlannerRuntimeError("layer-filter", "");
    syncPlannerPassForecastVisibility();
    publishPlannerState();
    return getPlannerHiddenLayerIdsForProject();
}

function clearPlannerHiddenLayerIds() {
    plannerHiddenLayerIds.clear();
    setPlannerRuntimeError("layer-filter", "");
    syncPlannerPassForecastVisibility();
    publishPlannerState();
}

function updatePlannerLayerFilter(event) {
    const detail = plannerRecord(event?.detail);
    const layerId = plannerText(detail.layerId);
    if (!layerId || typeof detail.visible !== "boolean") {
        setPlannerRuntimeError("layer-filter", "El filtro del planificador requiere una capa y un valor de visibilidad.");
        publishPlannerState();
        return false;
    }
    if (detail.visible) {
        plannerHiddenLayerIds.delete(layerId);
    } else {
        plannerHiddenLayerIds.add(layerId);
    }
    setPlannerRuntimeError("layer-filter", "");
    // This is planner-only state: cached calculations immediately reappear
    // when enabled and no eye state in the scene is changed.
    syncPlannerPassForecastVisibility();
    publishPlannerState();
    return true;
}

function getPlannerManualErpReferences() {
    const candidates = [];
    const add = (value) => {
        const normalized = normalizeManualOrbitErpReference(value);
        if (normalized) candidates.push(normalized);
    };
    for (const entry of getManualOrbitProjectEntries()) {
        const reference = manualOrbitErpValueFromPayload(entry);
        if (reference.present) add(reference.value);
    }
    // The open design is useful in the planner as a transient, clearly
    // snapshot-backed source fact, but it remains excluded from project data
    // until the orbit itself is confirmed.
    if (manualOrbitDesignSettings?.manualErp) add(manualOrbitDesignSettings.manualErp);
    return candidates;
}

function getPlannerErpDiagnosticComponent() {
    const diagnostics = plannerRecord(plannerRemoteDiagnostics).diagnostics;
    return findDiagnosticComponent(diagnostics, "erp");
}

function plannerProductErpPreflight(range) {
    const sourceSnapshot = getPlannerSourceSnapshot();
    if (sourceSnapshot.automaticEopEnabled) return null;
    const startMs = toPlannerEpochMs(range?.startTime ?? range?.start);
    const endMs = toPlannerEpochMs(range?.endTime ?? range?.end);
    if (startMs === null || endMs === null || endMs <= startMs) return null;

    // Only claim product-bound ERP for the actual finite SP3 members that
    // can participate in this requested interval. A scene mixing TLE/manual
    // sources keeps the automatic IERS preflight rather than borrowing the
    // SP3 companion's provenance for another propagator.
    const activeSatelliteLayers = (Array.isArray(sourceSnapshot.layers) ? sourceSnapshot.layers : [])
        .filter((layer) => layer?.active === true && String(layer?.type || "").toUpperCase() === "SATELLITE");
    if (!activeSatelliteLayers.length
        || activeSatelliteLayers.some((layer) => String(layer?.sourceFormat || "").toUpperCase() !== "SP3")) {
        return null;
    }
    const participants = (Array.isArray(sourceSnapshot.preciseRanges) ? sourceSnapshot.preciseRanges : [])
        .filter((candidate) => Number(candidate?.startTimeMs) <= startMs && Number(candidate?.endTimeMs) >= endMs)
        .map((candidate) => plannerText(candidate?.id))
        .filter(Boolean);
    if (!participants.length) return null;
    const matchingCoverages = (Array.isArray(sourceSnapshot.productErpCoverages) ? sourceSnapshot.productErpCoverages : [])
        .filter((coverage) => Number(coverage?.coverageStartMs) <= startMs && Number(coverage?.coverageEndMs) >= endMs);
    if (!participants.every((sourceId) => matchingCoverages.some((coverage) => (
        Array.isArray(coverage?.sourceIds) && coverage.sourceIds.includes(sourceId)
    )))) {
        return null;
    }
    const used = matchingCoverages.filter((coverage) => coverage.sourceIds?.some((sourceId) => participants.includes(sourceId)));
    return {
        sourceKind: "product-erp",
        available: true,
        validRange: true,
        classification: "product-erp",
        requiresNotice: false,
        requiresWarning: false,
        hasC01: false,
        hasFinals: false,
        hasExtrapolation: false,
        hasNominal: false,
        hasUnknown: false,
        range: {
            start: new Date(startMs).toISOString(),
            end: new Date(endMs).toISOString()
        },
        segments: used.map((coverage) => ({
            kind: "product-erp",
            start: new Date(startMs).toISOString(),
            end: new Date(endMs).toISOString(),
            source: coverage.source || coverage.fileName || "ERP asociado a SP3",
            quality: coverage.quality || "validated-product-erp"
        })),
        productErpCoverages: used
    };
}

function assessPlannerEarthOrientationPreflight(range) {
    return plannerProductErpPreflight(range) || assessAutomaticEarthOrientationPreflight(range);
}

function plannerEarthOrientationCoverageDetail(assessment) {
    const detail = earthOrientationCoverageDetail(assessment);
    if (!detail || assessment?.sourceKind !== "product-erp") return detail;
    return {
        ...detail,
        sourceKind: "product-erp",
        productErpIds: (assessment.productErpCoverages || []).map((coverage) => coverage.id)
    };
}

/**
 * Read-only EOP preflight for operations which may transform or propagate in
 * an Earth-fixed frame. The backend remains authoritative over actual sample
 * provenance; this only tells the operator which published source intervals
 * the requested window crosses before browser work starts.
 */
function assessAutomaticEarthOrientationPreflight(range) {
    const snapshot = plannerRecord(plannerRemoteDiagnostics);
    if (snapshot.availability && snapshot.availability !== "available") return null;
    const component = getPlannerErpDiagnosticComponent();
    return component ? assessEarthOrientationCoverage(component, range) : null;
}

function earthOrientationOperationMessage(assessment, operation, fallback) {
    if (assessment?.sourceKind === "product-erp" && assessment.available === true) {
        const labels = [...new Set((assessment.productErpCoverages || [])
            .map((coverage) => plannerText(coverage.fileName || coverage.name || coverage.id))
            .filter(Boolean))];
        const source = labels.length ? ` (${labels.join(", ")})` : "";
        return `${operation}: toda la ventana usa el ERP validado asociado al SP3${source}.`;
    }
    return assessment?.requiresNotice
        ? describeEarthOrientationCoverage(assessment, { operation })
        : fallback;
}

/**
 * Backend responses use this explicit name for the route actually selected
 * during a completed propagation. Do not consume generic `earth_orientation`
 * here: some precise-product responses use it for frame metadata rather than
 * an EOP provenance window.
 */
function earthOrientationWindowFromResponse(payload) {
    const response = plannerRecord(payload);
    const metadata = plannerRecord(response.propagator_metadata ?? response.propagatorMetadata);
    const candidates = [
        response.earth_orientation_window,
        response.earthOrientationWindow,
        metadata.earth_orientation_window,
        metadata.earthOrientationWindow,
        Array.isArray(response.segments) ? response : null
    ];
    return candidates.find((candidate) => Array.isArray(plannerRecord(candidate).segments)) || null;
}

function actualEarthOrientationAssessment(payload) {
    return normalizeEarthOrientationWindow(earthOrientationWindowFromResponse(payload));
}

function getPlannerLayerFacts() {
    return getCompositeLayerIds().map((layerId) => {
        const id = plannerText(layerId);
        const type = getLayerType(id);
        const sourceId = type === "SATELLITE" ? getSatelliteSourceIdFromLayerId(id) : id;
        const metadata = getCompositeLayerMeta(id);
        const range = type === "SATELLITE" ? getObjectIntrinsicTimeRange(sourceId) : null;
        // The local TLE cache is already populated for a loaded scene layer.
        // Its epoch is a source fact, unlike a finite coverage/expiry claim.
        const tleEpoch = type === "SATELLITE"
            ? parseTleEpochDate(getSatelliteTle(sourceId)?.line1)
            : null;
        return {
            id,
            name: getLayerDisplayName(id),
            type,
            sourceId,
            active: isCompositeLayerActive(id),
            visible: getCompositeLayerVisibility(id) === true,
            sourceFormat: plannerText(metadata?.sourceFormat ?? metadata?.source_format),
            sourceOrigin: plannerText(metadata?.sourceOrigin ?? metadata?.source_origin),
            ...(tleEpoch ? { tleEpoch: tleEpoch.toISOString() } : {}),
            ...(plannerText(metadata?.importedAt ?? metadata?.imported_at)
                ? { importedAt: plannerText(metadata?.importedAt ?? metadata?.imported_at) }
                : {}),
            ...(plannerText(metadata?.importFileName ?? metadata?.import_file_name)
                ? { importFileName: plannerText(metadata?.importFileName ?? metadata?.import_file_name) }
                : {}),
            ...(plannerText(metadata?.tleSource ?? metadata?.sourceProvider ?? metadata?.source_provider)
                ? { sourceProvider: plannerText(metadata?.tleSource ?? metadata?.sourceProvider ?? metadata?.source_provider) }
                : {}),
            validation: range ? "scene-intrinsic-range" : "scene-state-only",
            ...(range?.startTime ? { validityStart: range.startTime } : {}),
            ...(range?.endTime ? { validityEnd: range.endTime } : {})
        };
    });
}

function getPlannerSourceSnapshot() {
    const preciseRanges = getLoadedPreciseProductTimeRanges();
    const preciseProducts = getActivePreciseProductEntries();
    const oemRanges = getLoadedOemEphemerisTimeRanges();
    const preciseNames = new Map(preciseRanges.map((range) => [
        range.id,
        getSatelliteDisplayName(range.id, range.id)
    ]));
    const oemNames = new Map(oemRanges.map((range) => [
        range.id,
        getSatelliteDisplayName(range.id, range.id)
    ]));
    return buildPlannerSourceSnapshot({
        manualErps: getPlannerManualErpReferences(),
        erpDiagnostic: getPlannerErpDiagnosticComponent(),
        preciseProducts,
        preciseRanges,
        preciseNames,
        oemRanges,
        oemNames,
        layers: getPlannerLayerFacts()
    });
}

function plannerLayersForState(layers) {
    return (Array.isArray(layers) ? layers : []).map((layer) => ({
        ...layer,
        // `visible` remains the scene eye. This additional field is a
        // project-local planner preference and never drives Cesium.
        plannerVisible: isPlannerLayerVisible(layer?.id)
    }));
}

function plannerEventIsVisible(event, layers) {
    // A manual block is authored project planning, not a derived layer fact.
    // Keep it visible even if optional metadata mentions a layer that the
    // operator temporarily hides from the automated agenda.
    if (event?.kind === PLANNER_EVENT_KINDS.MANUAL) return true;
    const metadata = plannerRecord(event?.metadata);
    const directLayerIds = [
        metadata.layerId,
        metadata.stationId,
        metadata.stationLayerId,
        metadata.satelliteLayerId,
        metadata.satelliteId
    ].map(plannerText).filter(Boolean);
    if (directLayerIds.some((layerId) => !isPlannerLayerVisible(layerId))) {
        return false;
    }

    // Product resources can be associated with a source id rather than one
    // rendered duplicate. Keep the notice while *any* corresponding planner
    // layer remains enabled; hide it only when all of them are filtered.
    const sourceIds = [metadata.sourceId, metadata.sourceSatelliteId]
        .map(plannerText)
        .filter(Boolean);
    for (const sourceId of sourceIds) {
        if (!isPlannerLayerVisible(sourceId)) return false;
        const related = (Array.isArray(layers) ? layers : []).filter((layer) => (
            plannerText(layer?.id) === sourceId || plannerText(layer?.sourceId) === sourceId
        ));
        if (related.length && !related.some((layer) => isPlannerLayerVisible(layer.id))) {
            return false;
        }
    }
    return true;
}

function plannerPassAggregate() {
    // A mounted planner is always authoritative over its own aggregate. The
    // selected-object timeline remains a useful fallback for legacy consumers
    // while the planner is closed, but it must never narrow the open agenda.
    return plannerPassForecastOpen ? plannerPassForecast : plannerPassSource;
}

function plannerSourceErrors() {
    const errors = [...plannerRuntimeErrors.values()];
    const passSource = plannerPassAggregate();
    if (passSource.status === "error") {
        if (passSource.message) errors.push(passSource.message);
    }
    for (const failure of passSource.failures || []) {
        // If an endpoint disappears while an aggregate is running, neither
        // its events nor its stale failure should remain in the open agenda.
        if (passSource === plannerPassForecast
            && !isPlannerGroundStationTimelinePairVisible(failure?.stationId, failure?.satelliteLayerId || failure?.satelliteId)) {
            continue;
        }
        const reason = plannerText(failure?.reason);
        if (reason) errors.push(reason);
    }
    const erp = getPlannerErpDiagnosticComponent();
    if (erp?.status === "error") {
        errors.push(plannerText(erp.message || erp.summary) || "La validación ERP publicada por el servicio falló.");
    }
    for (const key of ["sp3", "oem"]) {
        const local = plannerRecord(plannerLocalDiagnostics)[key];
        if (local?.status === "error") {
            errors.push(plannerText(local.message) || `La validación local de ${key.toUpperCase()} falló.`);
        }
    }
    return [...new Set(errors.filter(Boolean))];
}

function plannerContext() {
    const masterRange = masterTimeRangeDetail();
    const current = getDisplayedSimulationDate();
    const passSource = plannerPassAggregate();
    return {
        passes: passSource.context ? { ...passSource.context } : null,
        simulation: {
            mode: simulationState.mode,
            startTime: simulationState.startDate?.toISOString?.() || null,
            endTime: simulationState.endDate?.toISOString?.() || null,
            currentTime: current instanceof Date && !Number.isNaN(current.getTime()) ? current.toISOString() : null,
            masterTimeRange: masterRange
        }
    };
}

/**
 * Publish the planner's canonical state. State requests may deliberately
 * initiate this panel's isolated all-pairs forecast, but this publisher itself
 * remains observational and never changes the selected timeline aggregate.
 */
function publishPlannerState() {
    if (typeof window === "undefined") return null;
    const sourceSnapshot = getPlannerSourceSnapshot();
    const layers = plannerLayersForState(sourceSnapshot.layers);
    const errors = plannerSourceErrors();
    const passSource = plannerPassAggregate();
    const status = passSource.status === "loading"
        ? "loading"
        : errors.length
            ? "error"
            : "ready";
    const state = normalizePlannerState({
        status,
        events: [
            ...buildPlannerPassEvents(passSource.events),
            ...buildPlannerResourceEvents(sourceSnapshot.resources),
            // A verified ERP bundled with every active SP3 is the temporal
            // source for that precise scene. In that case the automatic IERS
            // map is intentionally not published alongside it: two sources
            // would look like competing coverage for the same operation.
            ...(sourceSnapshot.automaticEopEnabled
                ? buildPlannerEopCoverageEvents(getPlannerErpDiagnosticComponent())
                : []),
            ...buildPlannerProductErpCoverageEvents(sourceSnapshot.productErpCoverages),
            ...buildPlannerLayerEvents(sourceSnapshot.layers),
            ...plannerManualOnly(plannerManualEvents)
        ].filter((event) => plannerEventIsVisible(event, layers)),
        updatedAt: new Date().toISOString(),
        errors
    });
    const detail = {
        ...state,
        ...(plannerText(passSource.message) ? { message: plannerText(passSource.message) } : {}),
        // These source facts explain an event without treating coverage as a
        // publisher expiry. They are intentionally runtime-only.
        resources: sourceSnapshot.resources,
        layers,
        plannerHiddenLayerIds: getPlannerHiddenLayerIdsForProject(),
        context: plannerContext()
    };
    window.__orbitPlannerState = detail;
    window.dispatchEvent(new CustomEvent(PLANNER_STATE_EVENT, { detail }));
    return detail;
}

function syncPlannerPassSource(event) {
    const detail = plannerRecord(event?.detail);
    plannerPassSource.status = ["loading", "ready", "error"].includes(detail.status) ? detail.status : "ready";
    plannerPassSource.events = Array.isArray(detail.events) ? detail.events.slice() : [];
    plannerPassSource.context = detail.context && typeof detail.context === "object" ? { ...detail.context } : null;
    plannerPassSource.failures = Array.isArray(detail.failures) ? detail.failures.slice() : [];
    plannerPassSource.message = plannerText(detail.message);
    publishPlannerState();
}

function syncPlannerRemoteDiagnostics(event) {
    plannerRemoteDiagnostics = plannerRecord(event?.detail);
    publishPlannerState();
}

function syncPlannerLocalDiagnostics(event) {
    plannerLocalDiagnostics = plannerRecord(event?.detail);
    publishPlannerState();
}

function upsertPlannerManualEvent(event) {
    const detail = plannerRecord(event?.detail);
    const normalized = normalizeManualPlannerEvent(detail.event ?? detail);
    if (!normalized) {
        setPlannerRuntimeError("manual", "El evento manual requiere inicio, fin, color permitido y una fecha UTC válida.");
        publishPlannerState();
        return false;
    }
    const byId = new Map(plannerManualOnly(plannerManualEvents).map((item) => [item.id, item]));
    byId.set(normalized.id, normalized);
    plannerManualEvents = plannerManualOnly([...byId.values()]);
    setPlannerRuntimeError("manual", "");
    publishPlannerState();
    return true;
}

function removePlannerManualEvent(event) {
    const detail = event?.detail;
    const id = plannerText(plannerRecord(detail).id || plannerRecord(detail).eventId || detail);
    if (!id) {
        setPlannerRuntimeError("manual", "No se puede eliminar un evento manual sin identificador.");
        publishPlannerState();
        return false;
    }
    plannerManualEvents = plannerManualOnly(plannerManualEvents.filter((item) => item.id !== id));
    setPlannerRuntimeError("manual", "");
    publishPlannerState();
    return true;
}

function activatePlannerEvent(event) {
    const detail = plannerRecord(event?.detail);
    const plannerEvent = plannerRecord(detail.event ?? detail);
    const targetMs = toPlannerEpochMs(plannerEvent.time ?? plannerEvent.start ?? plannerEvent.startTime);
    const target = targetMs === null ? null : new Date(targetMs);
    if (simulationState.mode !== SIMULATION_MODE_RANGE) {
        setPlannerRuntimeError("activation", "La agenda no mueve la escena en modo Real time o Static. Cambia a Simulated para saltar a un evento.");
        publishPlannerState();
        return false;
    }
    const start = new Date(simulationState.startDate);
    const end = new Date(simulationState.endDate);
    const withinSimulation = target && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())
        && target >= start && target <= end;
    if (!target || !withinSimulation) {
        setPlannerRuntimeError("activation", "El evento no tiene una hora UTC válida dentro del rango de simulación activo.");
        publishPlannerState();
        return false;
    }
    if (getMasterTimeRange() && !isInsideMasterRange(target)) {
        setPlannerRuntimeError("activation", "El evento queda fuera del Rango Temporal Maestro y no se ha movido la simulación.");
        publishPlannerState();
        return false;
    }
    setPlannerRuntimeError("activation", "");
    // Reuse the exact-jump command used by pass markers; routing through the
    // finite slider would quantize the AOS/LOS/max or manual interval start.
    window.dispatchEvent(new CustomEvent("orbit:simulation-action", {
        detail: { type: "timeline-jump", value: { time: target.toISOString() } }
    }));
    publishPlannerState();
    return true;
}

window.addEventListener(GROUND_STATION_TIMELINE_EVENTS_EVENT, syncPlannerPassSource);
window.addEventListener(DIAGNOSTICS_STATE_EVENT, syncPlannerRemoteDiagnostics);
window.addEventListener(DIAGNOSTICS_LOCAL_STATE_EVENT, syncPlannerLocalDiagnostics);
window.addEventListener("orbit:manual-orbit-state", () => publishPlannerState());
window.addEventListener("orbit:object-state-changed", () => publishPlannerState());
window.addEventListener("orbit:project-opened", () => {
    publishPlannerState();
    if (plannerPassForecastOpen) {
        void refreshPlannerPassForecast({ force: true });
    }
});
window.addEventListener(PLANNER_MANUAL_EVENT_UPSERT_EVENT, upsertPlannerManualEvent);
window.addEventListener(PLANNER_MANUAL_EVENT_REMOVE_EVENT, removePlannerManualEvent);
window.addEventListener("orbit:planner-event-activate", activatePlannerEvent);
window.addEventListener("orbit:planner-view-range", updatePlannerPassForecastViewRange);
window.addEventListener("orbit:planner-layer-filter", updatePlannerLayerFilter);
window.addEventListener("orbit:planner-open", requestPlannerPassForecast);
window.addEventListener("orbit:planner-close", closePlannerPassForecast);
window.addEventListener("orbit:planner-state-request", () => {
    // A late-mounted panel can be created by a host integration without the
    // toolbar lifecycle. Treat its pull request as an idempotent open so the
    // scene-wide forecast is never silently omitted.
    requestPlannerPassForecast();
    if (window.__orbitPlannerState) {
        window.dispatchEvent(new CustomEvent(PLANNER_STATE_EVENT, { detail: window.__orbitPlannerState }));
    } else {
        publishPlannerState();
    }
});

/**
 * Apply the authoritative Master Time Range to the interactive timeline.
 * Direct callers never get to substitute an object-local interval here: that
 * is how a second SP3/OEM used to silently shrink the global scene.
 */
function applyMasterTimeRangeToSimulation({ resetCurrent = false } = {}) {
    const range = getMasterTimeRange();
    if (!range) return false;
    const startMs = range.startDate.getTime();
    const endMs = range.endDate.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
        return false;
    }

    const priorTime = resetCurrent
        ? startMs
        : getDisplayedSimulationDate().getTime();
    if (!setSimulationRange(simulationState, range.startDate, range.endDate)) {
        return false;
    }
    simulationState.currentDate = clampToMasterRange(priorTime) || new Date(startMs);
    simulationState.mode = SIMULATION_MODE_RANGE;
    simulationState.isPlaying = false;
    simulationState.playing = false;
    simulationState.rewind = false;
    simulationState.lastTickTimestamp = Date.now();
    applySimulationDateToViewer(simulationState.currentDate);
    syncViewerClockPlayback();
    refreshSatelliteOverlays(viewer);
    return true;
}

/**
 * Ask before an import/generation would grow the MTR.  This deliberately
 * does not mutate the store: an I/O or propagation failure must not leave a
 * phantom interval behind.
 */
async function approveObjectRangeForMasterTimeRange(range, { objectName = "Objeto" } = {}) {
    const fit = validateObjectFitsMTR(range);
    if (!fit.valid) {
        throw new Error("El objeto no declara un intervalo temporal UTC válido.");
    }
    if (fit.accepted) {
        return { accepted: true, action: fit.requiresInitialization ? "initialize" : "none", fit };
    }

    const decision = await requestMasterTimeRangeExpansion({
        objectName,
        range: fit.range,
        masterRange: fit.masterRange
    });
    return { accepted: decision.accepted === true, action: decision.accepted ? "expand" : "cancel", fit };
}

/** Commit an already approved finite object only after its import succeeds. */
function commitObjectRangeToMasterTimeRange(range) {
    const fit = validateObjectFitsMTR(range);
    if (!fit.valid) {
        throw new Error("El objeto no declara un intervalo temporal UTC válido.");
    }
    if (fit.requiresInitialization) {
        return setMasterTimeRange(fit.range.startDate, fit.range.endDate);
    }
    if (fit.requiresExpansion) {
        return expandMasterTimeRange(fit.range.startDate, fit.range.endDate);
    }
    return getMasterTimeRange();
}

function clearMasterTimeRangeForProject() {
    clearMasterTimeRange();
    const now = new Date();
    const start = new Date(now.getTime() - (60 * 60 * 1000));
    const end = new Date(now.getTime() + (60 * 60 * 1000));
    setSimulationRange(simulationState, start, end);
    simulationState.mode = SIMULATION_MODE_REALTIME;
    simulationState.currentDate = now;
    simulationState.isPlaying = true;
    simulationState.playing = true;
    simulationState.rewind = false;
    simulationState.lastTickTimestamp = Date.now();
}

function projectSatelliteSourceFormat(id) {
    const sourceId = getSatelliteSourceIdFromLayerId(String(id || "").trim());
    return String(
        getCatalogEntryMeta(sourceId)?.sourceFormat
        ?? getCatalogEntryMeta(sourceId)?.source_format
        ?? ""
    ).trim().toUpperCase();
}

/**
 * OEM samples are local runtime data. Persisting their layer id without their
 * bytes creates a fake, dangling object after a browser/project reload, so a
 * project keeps neither the id nor a substitute trajectory.
 */
function shouldPersistSatelliteInProject(id) {
    return projectSatelliteSourceFormat(id) !== "OEM";
}

/** Remove the in-memory OEM track before the generic layer reset retains it. */
function shouldClearSatelliteOnProjectReset(id) {
    return projectSatelliteSourceFormat(id) === "OEM";
}

/**
 * Precise-product ids are content-addressed and their metadata is loaded
 * asynchronously from the server registry. They must wait for that registry
 * rather than being activated as a generic catalogue/TLE id.
 */
function getSatelliteRestoreDisposition(id) {
    const sourceFormat = projectSatelliteSourceFormat(id);
    if (sourceFormat === "OEM") return "skip";
    const isPrecise = sourceFormat === "SP3" || /^precise:/i.test(String(id || "").trim());
    if (isPrecise) {
        if (!preciseProductRegistryHydrated) return "defer";

        // The project lifecycle restores its saved MTR before asking this
        // question.  Do not briefly activate a finite product and only then
        // reject it: missing coverage and an out-of-contract coverage are
        // both fail-closed before any subscription/render request exists.
        const fit = validateObjectFitsMTR(getObjectIntrinsicTimeRange(id));
        if (!fit.valid || fit.requiresExpansion) return "skip";
        // A persisted MTR already exists at this point.  Put the simulation
        // in that bounded Range mode before `setSatelliteLayerActive` can
        // subscribe/prime the restored SP3 entry.
        if (!fit.requiresInitialization) {
            applyMasterTimeRangeToSimulation();
        }
        return "restore";
    }
    return "restore";
}

/**
 * A delayed SP3 hydration changes an id into a finite ephemeris source only
 * after its metadata arrives. Recheck its declared coverage against the MTR
 * before it can draw or request exact samples. Restoration never expands a
 * saved MTR implicitly: an incompatible current registry product stays out
 * of the scene until the operator explicitly imports/approves it again.
 */
function revalidateRestoredProjectSatelliteLayers(ids, { deferred = false } = {}) {
    const accepted = [];
    const rejected = [];
    const seen = new Set();
    for (const candidate of Array.isArray(ids) ? ids : []) {
        const id = String(candidate || "").trim();
        if (!id || seen.has(id) || projectSatelliteSourceFormat(id) !== "SP3") continue;
        seen.add(id);

        const fit = validateObjectFitsMTR(getObjectIntrinsicTimeRange(id));
        if (!fit.valid || fit.requiresExpansion) {
            // Do not allow an old saved id to silently broaden the scene or
            // to create a finite layer with an unknown range. Removing only
            // the activation retains its registry metadata for inspection.
            setSatelliteLayerActive(id, false);
            rejected.push(id);
            continue;
        }
        if (fit.requiresInitialization) {
            commitObjectRangeToMasterTimeRange(fit.range);
        }
        accepted.push(id);
    }

    if (accepted.length) {
        // This both forces the valid finite mode and re-primes historical
        // SP3 layers from exact range ephemerides after metadata hydration.
        applyMasterTimeRangeToSimulation();
        refreshSatelliteOverlays(viewer);
        objectSidebar?.renderList?.();
        emitObjectStateChanged({
            scope: "precise-products",
            reason: deferred ? "project-hydration" : "project-restore"
        });
    }

    if (rejected.length) {
        showAppAlert(
            "No se restaur\u00f3 un producto SP3 porque su cobertura no coincide con el rango temporal maestro guardado. Importe el producto de nuevo o ajuste el rango de forma expl\u00edcita.",
            uiText("alertTitle")
        );
    }
    return { accepted, rejected };
}

function forceFiniteEphemerisRange(domain = getFiniteEphemerisDomainState()) {
    if (!domain.finiteEphemerisDomainActive) {
        return false;
    }

    if (applyMasterTimeRangeToSimulation()) {
        return true;
    }

    if (domain.hasOemDomain) {
        const bounds = getLoadedOemEphemerisTimeBounds();
        if (bounds) {
            applySimulationRange(new Date(bounds.startTimeMs), new Date(bounds.endTimeMs));
        }
    } else if (domain.preciseCoverage) {
        applySimulationRange(
            new Date(domain.preciseCoverage.start),
            new Date(domain.preciseCoverage.end),
            { preferRequestedRange: true }
        );
    }

    // ``range`` is the only request that modePolicy accepts while a finite
    // source is active, so this cannot recurse back into the restriction.
    setSimulationMode(SIMULATION_MODE_RANGE);
    return true;
}

function reconcileFiniteEphemerisDomainAfterLayerChange() {
    const domain = getFiniteEphemerisDomainState();
    if (domain.finiteEphemerisDomainActive && simulationState.mode !== SIMULATION_MODE_RANGE) {
        forceFiniteEphemerisRange(domain);
        return;
    }
    updateTopToolbarTime();
}

function alignSimulationToPreciseProductCoverage(entries, payload) {
    const coverage = resolvePreciseProductCoverage(entries, payload);
    if (!coverage) {
        return false;
    }
    // The import was pre-approved before bytes were persisted. Commit only
    // now, after the product is known to have been registered successfully.
    commitObjectRangeToMasterTimeRange({ startTime: coverage.start, endTime: coverage.end });
    return applyMasterTimeRangeToSimulation({ resetCurrent: true });
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
    const now = new Date();
    if (getMasterTimeRange() && !isInsideMasterRange(now)) {
        applyMasterTimeRangeToSimulation();
        void showAppAlert(
            "No se puede reanudar Real time: la época actual queda fuera del rango temporal maestro. Usa modo Simulated.",
            uiText("alertTitle")
        );
        return false;
    }
    // Realtime deliberately resumes at the current wall-clock instant rather
    // than integrating the duration for which it was paused.
    simulationState.currentDate = now;
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
        // A station's live links are presentation-only. Do not retain a
        // connector when either end has been hidden in Layers.
        syncGroundStationVisibilityLinks();
        syncGroundStationTimelineSelection();
        syncPlannerPassForecastVisibility();
    }
});

function getLayerDisplayName(layerId) {
    // Project files from an older/runtime-customized session may contain a
    // stale name override. Earth is the immutable reference body and keeps a
    // stable label across projects.
    if (isEarthLayerId(layerId)) {
        return celestialBodyLayers.getName(layerId);
    }
    const compositeName = compositeLayers.getName(layerId);
    // A precise GNSS product uses a content-addressed runtime key such as
    // `precise:<product-id>:C06`. That key must stay stable for requests and
    // project persistence, but it is not an operator-facing layer name. An
    // explicit rename (including duplicate-layer names) remains authoritative;
    // otherwise fall back to the source catalogue name registered from SP3.
    if (String(compositeName || "").trim() && String(compositeName).trim() !== String(layerId || "").trim()) {
        return compositeName;
    }
    const sourceId = getSatelliteSourceIdFromLayerId(layerId);
    return getSatelliteDisplayName(sourceId, compositeName || layerId);
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
        logger.warn("No se pudo restaurar la vista anterior al cerrar el disenador orbital:", error);
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
        const finiteRangeAssessment = assessFiniteEphemerisAnalysisRange(
            getObjectIntrinsicTimeRange(satelliteId),
            { startDate, endDate }
        );
        if (!finiteRangeAssessment.allowed) return [];
        // A locally imported OEM has no server-side state provider. Do not
        // submit its display id to the catalogue route and accidentally get
        // an unrelated TLE-based pass prediction.
        if (String(getCatalogEntryMeta(satelliteId)?.sourceFormat || "").toUpperCase() === "OEM") return [];
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
        syncPlannerPassForecastVisibility();
        return;
    }
    if (visible !== true) {
        // A duplicate controls the source entity's visibility too, so source
        // matching is intentional for this path.
        deactivateLocalCameraForLayer(layerId, { matchSatelliteSource: true });
    }
    compositeLayers.setVisibility(layerId, visible);
    // Remove/recreate station connectors at the same time as the layer eye
    // changes. The callback has the same guard for a frame-perfect fallback,
    // but removing the entity here avoids a stale line between renders.
    syncGroundStationVisibilityLinks();
    // The pass timeline has the same Layer-eye contract. Re-publish cached
    // events immediately rather than waiting for another pass calculation.
    syncGroundStationTimelineSelection();
    syncPlannerPassForecastVisibility();
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
    emitObjectStateChanged({ layerId, sourceId: layerId, layerType: "GROUND_STATION", reason: "activation" });
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
        const sourceId = getSatelliteSourceIdFromLayerId(layerId);
        if (!isActive && isPreciseProductLayer(sourceId)) {
            // Activation is intentionally handled by the asynchronous MTR
            // approval wrapper below.  Deactivation remains local and may
            // only reconcile the currently active finite-domain policy.
            reconcileFiniteEphemerisDomainAfterLayerChange();
        }
    }
    return changed;
}

function duplicateSatelliteLayer(sourceId) {
    const layerId = compositeLayers.duplicate(String(sourceId || "").trim());
    if (layerId) {
        refreshGroundStationTimelineForLayerMembershipChange({ layerId, kind: "satellite" });
    }
    return layerId;
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
    // If an already-selected satellite is being inspected in range mode,
    // this new visible station is a new required pair rather than merely a
    // visibility flip. Reuse existing pair cache but collect the newcomer.
    refreshGroundStationTimelineForLayerMembershipChange({ layerId: stationId, kind: "station" });

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
    // The aggregate timeline uses the identical station contract. Its cache
    // key includes this signature, but the currently displayed result must be
    // replaced immediately rather than surviving until a new selection.
    if (groundStationTimelineContextKey) {
        void refreshGroundStationTimelinePasses();
    }
    if (plannerPassForecastOpen) {
        void refreshPlannerPassForecast({ force: true });
    }
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
        const added = await setCompositeLayerActiveWithMasterTimeRange(satId, true);
        if (!added) {
            // A cancelled MTR expansion is intentional.  Do not replace its
            // explicit dialog with a misleading generic capacity warning.
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

function updateSimulationTimelineUi(finiteDomain = getFiniteEphemerisDomainState()) {
    const masterTimeRange = masterTimeRangeDetail();
    // React owns the visible controls and receives a complete state snapshot.
    window.dispatchEvent(new CustomEvent("orbit:simulation-state", {
        detail: {
            mode: simulationState.mode,
            isPlaying: simulationState.isPlaying,
            isPaused: simulationState.isPlaying === false,
            speed: simulationState.speed,
            oemDomainActive: finiteDomain.hasOemDomain,
            sp3DomainActive: finiteDomain.hasSp3Domain,
            manualDomainActive: finiteDomain.hasManualDomain,
            finiteEphemerisDomainActive: finiteDomain.finiteEphemerisDomainActive,
            finiteEphemerisSources: finiteDomain.finiteSources,
            masterTimeRange,
            masterTimeRangeActive: Boolean(masterTimeRange),
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
    const finiteDomain = getFiniteEphemerisDomainState();
    const masterRange = getMasterTimeRange();
    const request = resolveSimulationModeRequest(mode, finiteDomain);
    const normalized = request.mode;

    // A wall-clock stream is meaningful only while its present epoch belongs
    // to the global simulation contract.  Do not merely freeze it at an old
    // value: move the scene back to the MTR so all objects share one clock.
    if (request.requestedMode === SIMULATION_MODE_REALTIME
        && masterRange
        && !isInsideMasterRange(new Date())) {
        applyMasterTimeRangeToSimulation();
        void showAppAlert(
            "No se puede usar Real time: la época actual queda fuera del rango temporal maestro. Usa modo Simulated.",
            uiText("alertTitle")
        );
        return;
    }

    if (request.restricted) {
        forceFiniteEphemerisRange(finiteDomain);
        const requestedLabel = request.requestedMode === SIMULATION_MODE_STATIC ? "Static" : "Real time";
        void showAppAlert(
            `No se puede usar ${requestedLabel} mientras haya efemÃ©rides ${finiteEphemerisDomainLabel(finiteDomain)} activas. Usa modo Simulated.`,
            uiText("alertTitle")
        );
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

function applySimulationRange(startDate, endDate, { preferRequestedRange = false } = {}) {
    let startMs = startDate.getTime();
    let endMs = endDate.getTime();
    const masterRange = getMasterTimeRange();

    // Once established, the Master Time Range is the only global timeline
    // interval. Object-local OEM/SP3 ranges remain intrinsic availability
    // domains and must not silently shrink or replace it.
    if (masterRange) {
        startMs = masterRange.startDate.getTime();
        endMs = masterRange.endDate.getTime();
    } else if (!preferRequestedRange && hasLoadedOemEphemerisTracks()) {
        const bounds = getLoadedOemEphemerisTimeBounds();
        if (bounds) {
            startMs = Number(bounds.startTimeMs);
            endMs = Number(bounds.endTimeMs);
        }
    }

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
        return false;
    }

    const displayedTimeMs = getDisplayedSimulationDate().getTime();
    if (!setSimulationRange(simulationState, new Date(startMs), new Date(endMs))) {
        return false;
    }

    // Static and paused controls must never preserve a stale current epoch
    // outside the master range. The inclusive clamp is also applied on a
    // restored project whose old UI state predates MTR.
    if (masterRange) {
        const clampedDate = clampToMasterRange(simulationState.currentDate);
        if (clampedDate) {
            simulationState.currentDate = clampedDate;
        }
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

// Every active and visible orbital layer gets a lightweight callback polyline
// for every visible ground station. The callback returns no positions below
// the station mask or outside the RF envelope, so no station/satellite
// association is persisted merely to show the live operational geometry.
function syncGroundStationVisibilityLinks() {
    const desired = new Set();
    const satelliteLayerIds = getCompositeLayerIds()
        .filter((id) => !isGroundStationLayerId(id) && !isCelestialBodyLayerId(id))
        .filter((id) => isCompositeLayerActive(id))
        .filter((id) => getCompositeLayerVisibility(id) === true);
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
                    // A station-to-satellite link is a line of sight in
                    // Cartesian space, not a ground route. Cesium's default
                    // geodesic interpolation bends a two-point polyline over
                    // the ellipsoid and is physically misleading here.
                    arcType: Cesium.ArcType.NONE,
                    clampToGround: false,
                    positions: new Cesium.CallbackProperty((time) => {
                        const currentStation = groundStationLayers.get(station.id);
                        const satellitePosition = satellite.position?.getValue?.(time);
                        if (!currentStation?.visible
                            || !isCompositeLayerActive(satelliteLayerId)
                            || getCompositeLayerVisibility(satelliteLayerId) !== true
                            || !satellitePosition) return [];
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
    // Bulk show/hide paths call this reconciler directly, bypassing the
    // per-layer eye setter. Mirror that visibility transition into the
    // cached timeline event stream without triggering new network work.
    syncGroundStationTimelineSelection();
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
            // AOS/LOS uses the same instantaneous line-of-sight geometry as
            // the lightweight live links above: never interpolate along the
            // Earth surface.
            arcType: Cesium.ArcType.NONE,
            clampToGround: false,
            positions: new Cesium.CallbackProperty((time) => {
                const currentStation = groundStationLayers.get(station.id);
                const satellitePosition = satellite.position?.getValue?.(time);
                if (!currentStation?.visible
                    || !isCompositeLayerActive(satelliteLayerId)
                    || getCompositeLayerVisibility(satelliteLayerId) !== true
                    || !satellitePosition) return [];
                const target = evaluateGroundStationTarget(currentStation, stationPosition, satellitePosition, satelliteRfProfile);
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
        [GROUND_STATION_EXPORT_FORMATS.CSV]: ".csv",
        [GROUND_STATION_EXPORT_FORMATS.KML]: ".kml",
        [GROUND_STATION_EXPORT_FORMATS.KMZ]: ".kmz",
        [GROUND_STATION_EXPORT_FORMATS.GPKG]: ".gpkg",
        [GROUND_STATION_EXPORT_FORMATS.WKT]: ".wkt",
        [GROUND_STATION_EXPORT_FORMATS.WKB]: ".wkb"
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
    if (format === GROUND_STATION_EXPORT_FORMATS.KML) return "KML";
    if (format === GROUND_STATION_EXPORT_FORMATS.KMZ) return "KMZ";
    if (format === GROUND_STATION_EXPORT_FORMATS.GPKG) return "GeoPackage";
    if (format === GROUND_STATION_EXPORT_FORMATS.WKT) return "WKT";
    if (format === GROUND_STATION_EXPORT_FORMATS.WKB) return "WKB";
    if (format === GROUND_STATION_EXPORT_FORMATS.ORBIT_JSON) return "Orbit JSON";
    if (format === GROUND_STATION_EXPORT_FORMATS.CSV) return "CSV";
    return "GeoJSON";
}

function getGroundStationsForExport(stationId = null) {
    const requestedId = String(stationId || "").trim();
    const selected = requestedId ? groundStationLayers.get(requestedId) : null;
    return requestedId ? (selected ? [selected] : []) : [...groundStationLayers.values()];
}

async function downloadGroundStationsGeoPackage(stations, fileName, { signal } = {}) {
    const response = await fetch("/api/ground-stations/export", {
        method: "POST",
        headers: {
            Accept: "application/geopackage+sqlite3,application/octet-stream",
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ format: GROUND_STATION_EXPORT_FORMATS.GPKG, stations }),
        signal
    });
    if (signal?.aborted) {
        const error = new Error("Exportaci\u00f3n de estaciones cancelada.");
        error.name = "AbortError";
        throw error;
    }
    if (!response.ok) {
        let detail = "";
        try {
            const payload = await response.json();
            detail = payload?.detail || payload?.error || "";
        } catch {
            detail = await response.text().catch(() => "");
        }
        throw new Error(detail || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    if (signal?.aborted) {
        const error = new Error("Exportaci\u00f3n de estaciones cancelada.");
        error.name = "AbortError";
        throw error;
    }
    const url = URL.createObjectURL(blob);
    const anchor = Object.assign(document.createElement("a"), { href: url, download: fileName });
    anchor.click();
    URL.revokeObjectURL(url);
}

async function exportGroundStations(stationId = null, format = GROUND_STATION_EXPORT_FORMATS.GEOJSON) {
    const stations = getGroundStationsForExport(stationId);
    if (!stations.length) {
        void showAppAlert(stationId
            ? "La estación seleccionada ya no está disponible para exportar."
            : "No hay estaciones de tierra para exportar.");
        return null;
    }
    const authoredStations = normalizeGroundStationExportRecords(stations);
    if (!authoredStations.length) {
        void showAppAlert("No se pudo exportar ninguna estacion: revisa que las coordenadas WGS-84 sean validas.");
        return null;
    }

    const fileName = groundStationExportFileName(authoredStations, format);
    const usesExportService = requiresGroundStationExportService(format);
    const controller = usesExportService ? new AbortController() : null;
    const operationId = beginRuntimeSceneOperation("ground-station-export", {
        title: `Exportando estaciones (${groundStationExportLabel(format)})`,
        stage: usesExportService ? "Generando producto espacial" : "Preparando descarga local",
        message: `${authoredStations.length} ${authoredStations.length === 1 ? "estaci\u00f3n seleccionada" : "estaciones seleccionadas"}.`,
        progress: 0,
        cancelWork: controller ? () => controller.abort() : null
    });
    let operationTerminal = false;
    try {
        if (usesExportService) {
            advanceRuntimeSceneOperation(operationId, {
                stage: "Solicitando GeoPackage",
                message: "El servicio est\u00e1 generando el fichero de intercambio.",
                progress: 30
            });
        }
        const exported = usesExportService
            ? await downloadGroundStationsGeoPackage(authoredStations, fileName, { signal: controller.signal })
            : downloadGroundStationsExport(authoredStations, format, { fileName });
        const exportedCount = authoredStations.length;
        if (!exportedCount) {
            completeRuntimeSceneOperation(operationId, "No hab\u00eda estaciones v\u00e1lidas para exportar.");
            operationTerminal = true;
            void showAppAlert("No se pudo exportar ninguna estación: revisa que las coordenadas WGS-84 sean válidas.");
            return exported;
        }
        completeRuntimeSceneOperation(operationId, "Exportaci\u00f3n de estaciones completada.");
        operationTerminal = true;
        void showAppAlert(`${groundStationExportLabel(format)} exportado: ${exportedCount} ${exportedCount === 1 ? "estación" : "estaciones"}.`);
        return exported;
    } catch (error) {
        if (isRuntimeSceneRequestCancellation(error, controller)) {
            cancelRuntimeSceneOperation(operationId, "Exportaci\u00f3n de estaciones cancelada.");
            operationTerminal = true;
            return null;
        }
        failRuntimeSceneOperation(operationId, error);
        operationTerminal = true;
        const reason = error instanceof Error ? error.message : String(error);
        void showAppAlert(`No se pudo exportar las estaciones: ${reason}`);
        return null;
    } finally {
        if (!operationTerminal) {
            cancelRuntimeSceneOperation(operationId, "Exportaci\u00f3n de estaciones cancelada.");
        }
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

function cancelGroundStationPassAnalysis(message = "An\u00e1lisis AOS/LOS cancelado.") {
    const operationId = groundStationAnalysisOperationId;
    const controller = groundStationAnalysisAbortController;
    groundStationAnalysisOperationId = null;
    groundStationAnalysisAbortController = null;
    groundStationAnalysisRequestSequence += 1;
    if (operationId) {
        cancelRuntimeSceneOperation(operationId, message);
        return;
    }
    controller?.abort();
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

/**
 * Keep the human-facing frame label separate from the frame used internally
 * by Cesium and the AOS/LOS endpoint. In particular, a native IGS/ITRF SP3
 * realization is not an ITRF rendering result until the backend confirms its
 * EOP/ERP and realization operation. The same helper also qualifies a visual
 * Earth-fixed fallback as "Terrestre aproximado (sin EOP)".
 */
function resolveGroundPassFrameStatus(satelliteId, responsePayload = null) {
    const catalogMeta = getCatalogEntryMeta(satelliteId) || {};
    const runtimeFrame = responsePayload?.reference_frame
        ?? responsePayload?.referenceFrame
        ?? responsePayload?.frame
        ?? "";
    return resolvePreciseProductFrameStatus({
        ...catalogMeta,
        sp3: catalogMeta.inputMetadata ?? catalogMeta.input_metadata ?? null,
        rendering: responsePayload?.rendering ?? responsePayload?.renderer_reference ?? null,
        renderer_reference: responsePayload?.renderer_reference ?? responsePayload?.rendererReference ?? null,
        earth_orientation: responsePayload?.earth_orientation ?? responsePayload?.earthOrientation ?? null
    }, { runtimeFrame });
}

function isPreciseProductLayer(satelliteId) {
    return String(getCatalogEntryMeta(satelliteId)?.sourceFormat || "").toUpperCase() === "SP3";
}

function activationObjectName(layerIds = []) {
    const uniqueIds = [...new Set((Array.isArray(layerIds) ? layerIds : [layerIds])
        .map((layerId) => String(layerId || "").trim())
        .filter(Boolean))];
    if (uniqueIds.length === 1) {
        return String(getLayerDisplayName(uniqueIds[0]) || getSatelliteDisplayName(uniqueIds[0]) || uniqueIds[0]);
    }
    return `${uniqueIds.length} capas`;
}

/**
 * Establish the MTR decision before a local finite object becomes active.
 * The returned envelope is deliberately only an activation/MTR envelope;
 * each individual source keeps its own intrinsic range for interpolation and
 * analysis, so no gap is ever treated as ephemeris coverage.
 */
async function approveSatelliteActivationForMasterTimeRange(layerIds, { objectName = null } = {}) {
    const sourceIds = [...new Set((Array.isArray(layerIds) ? layerIds : [layerIds])
        .map((layerId) => getSatelliteSourceIdFromLayerId(String(layerId || "").trim()))
        .map((sourceId) => String(sourceId || "").trim())
        .filter(Boolean))];
    const union = getObjectIntrinsicTimeRangeUnion(sourceIds);
    if (!union.valid) {
        await showAppAlert(
            "No se puede activar una efeméride finita sin una cobertura temporal válida. Vuelve a importar su producto fuente.",
            uiText("alertTitle")
        );
        return { accepted: false, union, approval: null };
    }
    if (!union.hasFiniteCoverage) {
        return { accepted: true, union, approval: null };
    }

    const approval = await approveObjectRangeForMasterTimeRange(union.range, {
        objectName: objectName || activationObjectName(sourceIds)
    });
    return { accepted: approval.accepted === true, union, approval };
}

async function setCompositeLayerActiveWithMasterTimeRange(layerId, active) {
    const isActive = active === true;
    if (!isActive) {
        return setCompositeLayerActive(layerId, false);
    }
    if (isSatelliteDuplicateLayerId(layerId) || isCompositeLayerActive(layerId)) {
        return setCompositeLayerActive(layerId, true);
    }

    const activation = await approveSatelliteActivationForMasterTimeRange([layerId]);
    if (!activation.accepted) {
        return false;
    }

    const changed = setCompositeLayerActive(layerId, true);
    if (changed && activation.union.hasFiniteCoverage) {
        // The layer is now known to be active, so the previously approved
        // decision becomes durable.  Cancellation and invalid metadata leave
        // both the scene and the MTR untouched.
        commitObjectRangeToMasterTimeRange(activation.union.range);
        applyMasterTimeRangeToSimulation({ resetCurrent: activation.approval?.action === "initialize" });
    }
    return changed;
}

async function activateAllSatelliteLayersWithMasterTimeRange() {
    const candidates = getSatelliteIds().filter((id) => !isSatelliteLayerActive(id));
    const activation = await approveSatelliteActivationForMasterTimeRange(candidates, {
        objectName: "Las capas seleccionadas"
    });
    if (!activation.accepted) {
        return { added: 0, skipped: candidates.length, cancelled: true };
    }

    const result = setAllSatelliteLayersActive(true);
    if (activation.union.hasFiniteCoverage) {
        commitObjectRangeToMasterTimeRange(activation.union.range);
        applyMasterTimeRangeToSimulation({ resetCurrent: activation.approval?.action === "initialize" });
    } else {
        reconcileFiniteEphemerisDomainAfterLayerChange();
    }
    return result;
}

function unavailablePreciseGroundPassMessage(frameStatus) {
    const native = frameStatus?.nativeFrame || "el marco nativo del producto";
    const reason = String(frameStatus?.reason || "No hay una transformación terrestre disponible.").trim();
    return `No se pueden calcular AOS/LOS para ${native}: ${reason}`;
}

/** Emit one explicit, non-partial result when finite data do not cover AOS/LOS. */
function emitGroundStationOutOfRangeResult({
    station,
    stationId,
    satelliteLayerId,
    satelliteId,
    frameStatus,
    assessment
}) {
    clearGroundStationAnalysisVisuals();
    window.dispatchEvent(new CustomEvent("orbit:ground-stations-analysis-result", {
        detail: {
            error: finiteEphemerisAnalysisRangeMessage(assessment),
            passes: [],
            samples: [],
            temporal_status: "out_of_range",
            object_status: "out_of_range",
            out_of_range: true,
            out_of_range_reason: assessment.reason,
            intrinsicTimeRange: assessment.sourceRange || null,
            analysisWindow: assessment.analysisRange
                ? {
                    startTime: assessment.analysisRange.startTime,
                    endTime: assessment.analysisRange.endTime,
                    source: "requested"
                }
                : null,
            stationName: String(station.name || stationId),
            satelliteName: String(getLayerDisplayName(satelliteLayerId) || satelliteId),
            stationTimeZone: station.time_zone || "UTC",
            referenceFrame: frameStatus?.returnedFrame || frameStatus?.nativeFrame || "",
            referenceFrameLabel: frameStatus?.displayFrame || "",
            rendererReference: frameStatus || null,
            renderingAvailable: frameStatus?.available ?? null,
            timeScale: "UTC",
            analysisSelection: { stationId, satelliteLayerId },
            visibleNow: false
        }
    }));
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
    // A new request supersedes an earlier one, but its cancellation must not
    // make the panel leave the new calculation in a non-loading state.
    cancelGroundStationPassAnalysis("An\u00e1lisis AOS/LOS sustituido por una nueva solicitud.");
    const requestId = ++groundStationAnalysisRequestSequence;
    const abortController = new AbortController();
    groundStationAnalysisAbortController = abortController;
    const stationSignature = groundStationAnalysisSignature(station);
    let requestContext = null;
    let operationId = null;
    let operationTerminal = false;
    try {
        const declaredFrameStatus = resolveGroundPassFrameStatus(satelliteId);
        if (isPreciseProductLayer(satelliteId) && declaredFrameStatus.available === false) {
            if (requestId === groundStationAnalysisRequestSequence) {
                clearGroundStationAnalysisVisuals();
                window.dispatchEvent(new CustomEvent("orbit:ground-stations-analysis-result", {
                    detail: {
                        error: unavailablePreciseGroundPassMessage(declaredFrameStatus),
                        passes: [],
                        samples: [],
                        stationName: String(station.name || stationId),
                        satelliteName: String(getLayerDisplayName(satelliteLayerId) || satelliteId),
                        stationTimeZone: station.time_zone || "UTC",
                        referenceFrame: declaredFrameStatus.nativeFrame,
                        referenceFrameLabel: declaredFrameStatus.displayFrame,
                        rendererReference: declaredFrameStatus,
                        renderingAvailable: false,
                        timeScale: "UTC",
                        analysisSelection: { stationId, satelliteLayerId },
                        visibleNow: false
                    }
                }));
            }
            return;
        }
        const fallbackWindow = getGroundStationAnalysisWindow();
        const request = createGroundStationPassRequest(station, satelliteId, fallbackWindow.startDate, fallbackWindow.endDate, {
            stepSeconds: GROUND_STATION_ANALYSIS_STEP_SECONDS,
            includeSamples: true,
            chartPaddingSeconds: GROUND_STATION_CHART_PADDING_SECONDS
        });
        const analysisWindow = request.analysisWindow || fallbackWindow;
        const { startDate, endDate } = analysisWindow;
        const earthOrientationPreflight = assessAutomaticEarthOrientationPreflight({
            startTime: startDate.toISOString(),
            endTime: endDate.toISOString()
        });
        requestContext = {
            requestId,
            stationId,
            station,
            stationSignature,
            satelliteLayerId,
            satelliteId,
            satelliteRfSignature: satelliteRfProfileSignature(satelliteId),
            manualOrbitSignature: request.manualOrbitSignature,
            analysisWindow,
            earthOrientationPreflight: earthOrientationCoverageDetail(earthOrientationPreflight)
        };
        // A finite SP3/OEM/manual source either supports the full requested
        // AOS/LOS window or it supports none of it.  Never shorten the window
        // behind the operator's back: doing so would make the pass result
        // describe another analysis than the one selected in the scene.
        const finiteRangeAssessment = assessFiniteEphemerisAnalysisRange(
            getObjectIntrinsicTimeRange(satelliteId),
            { startDate, endDate }
        );
        if (!finiteRangeAssessment.allowed) {
            if (isCurrentGroundStationPassAnalysis(requestContext)) {
                emitGroundStationOutOfRangeResult({
                    station,
                    stationId,
                    satelliteLayerId,
                    satelliteId,
                    frameStatus: declaredFrameStatus,
                    assessment: finiteRangeAssessment
                });
            }
            return;
        }
        // OEM files are intentionally local-only at present. They have no
        // backend provider to answer the catalogue AOS/LOS endpoint, so fail
        // explicitly instead of accidentally substituting a TLE trajectory.
        if (String(getCatalogEntryMeta(satelliteId)?.sourceFormat || "").toUpperCase() === "OEM") {
            if (isCurrentGroundStationPassAnalysis(requestContext)) {
                clearGroundStationAnalysisVisuals();
                window.dispatchEvent(new CustomEvent("orbit:ground-stations-analysis-result", {
                    detail: {
                        error: "AOS/LOS no está disponible para una OEM local. Importe una fuente con proveedor de análisis o use la futura herramienta de comparación.",
                        passes: [],
                        samples: [],
                        runtime_state: "UNAVAILABLE",
                        stationName: String(station.name || stationId),
                        satelliteName: String(getLayerDisplayName(satelliteLayerId) || satelliteId),
                        stationTimeZone: station.time_zone || "UTC",
                        analysisSelection: { stationId, satelliteLayerId },
                        visibleNow: false
                    }
                }));
            }
            return;
        }
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
                        referenceFrame: declaredFrameStatus.returnedFrame || declaredFrameStatus.nativeFrame || "",
                        referenceFrameLabel: declaredFrameStatus.displayFrame,
                        rendererReference: declaredFrameStatus,
                        renderingAvailable: declaredFrameStatus.available,
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
        operationId = beginRuntimeSceneOperation("ground-station-analysis", {
            title: "Calculando pases AOS/LOS",
            stage: "Propagando ventana solicitada",
            message: earthOrientationOperationMessage(
                earthOrientationPreflight,
                "El análisis AOS/LOS",
                "Calculando visibilidad y enlace para la estación seleccionada."
            ),
            cancelWork: (message) => {
                if (groundStationAnalysisAbortController === abortController) {
                    groundStationAnalysisAbortController = null;
                }
                if (groundStationAnalysisOperationId === operationId) {
                    groundStationAnalysisOperationId = null;
                }
                groundStationAnalysisRequestSequence += 1;
                abortController.abort();
                const cancellationMessage = String(message || "");
                if (!/sustituido|cambiar de proyecto/i.test(cancellationMessage)) {
                    window.dispatchEvent(new CustomEvent("orbit:ground-stations-analysis-result", {
                        detail: {
                            cancelled: true,
                            error: "C\u00e1lculo de pases cancelado.",
                            passes: [],
                            samples: [],
                            analysisSelection: { stationId, satelliteLayerId },
                            visibleNow: false
                        }
                    }));
                }
            }
        });
        groundStationAnalysisOperationId = operationId;
        const response = await fetch(request.url, { ...request.requestOptions, signal: abortController.signal });
        if (!response.ok) throw await groundStationPassResponseError(response);
        const result = await response.json();
        if (!isCurrentGroundStationPassAnalysis(requestContext)) {
            cancelRuntimeSceneOperation(operationId, "An\u00e1lisis AOS/LOS sustituido por una nueva solicitud.");
            operationTerminal = true;
            return;
        }
        const actualEarthOrientation = actualEarthOrientationAssessment(result);
        advanceRuntimeSceneOperation(operationId, {
            stage: "Preparando resultado",
            message: actualEarthOrientation
                ? describeEarthOrientationCoverage(actualEarthOrientation, { operation: "El análisis AOS/LOS" })
                : "Procesando pases y geometría de enlace.",
            progress: 85
        });
        const resolvedFrameStatus = resolveGroundPassFrameStatus(satelliteId, result);
        if (isPreciseProductLayer(satelliteId) && resolvedFrameStatus.available === false) {
            clearGroundStationAnalysisVisuals();
            window.dispatchEvent(new CustomEvent("orbit:ground-stations-analysis-result", {
                detail: {
                    ...result,
                    error: unavailablePreciseGroundPassMessage(resolvedFrameStatus),
                    passes: [],
                    samples: [],
                    stationName: String(station.name || stationId),
                    satelliteName: String(getLayerDisplayName(satelliteLayerId) || satelliteId),
                    stationTimeZone: station.time_zone || "UTC",
                    referenceFrame: resolvedFrameStatus.nativeFrame,
                    referenceFrameLabel: resolvedFrameStatus.displayFrame,
                    rendererReference: resolvedFrameStatus,
                    renderingAvailable: false,
                    timeScale: String(result.time_scale || "UTC"),
                    earthOrientationPreflight: requestContext.earthOrientationPreflight || null,
                    earthOrientationProvenance: actualEarthOrientation ? earthOrientationCoverageDetail(actualEarthOrientation) : null,
                    analysisSelection: { stationId, satelliteLayerId },
                    visibleNow: false
                }
            }));
            failRuntimeSceneOperation(operationId, new Error(unavailablePreciseGroundPassMessage(resolvedFrameStatus)));
            operationTerminal = true;
            return;
        }
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
                referenceFrame: resolvedFrameStatus.returnedFrame || "",
                referenceFrameLabel: resolvedFrameStatus.displayFrame,
                rendererReference: resolvedFrameStatus,
                renderingAvailable: resolvedFrameStatus.available,
                timeScale: String(result.time_scale || "UTC"),
                earthOrientationPreflight: requestContext.earthOrientationPreflight || null,
                earthOrientationProvenance: actualEarthOrientation ? earthOrientationCoverageDetail(actualEarthOrientation) : null,
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
        completeRuntimeSceneOperation(
            operationId,
            actualEarthOrientation
                ? describeEarthOrientationCoverage(actualEarthOrientation, { operation: "Análisis AOS/LOS completado" })
                : "Análisis AOS/LOS completado."
        );
        operationTerminal = true;
    } catch (error) {
        if (isRuntimeSceneRequestCancellation(error, abortController)
            || (requestContext && !isCurrentGroundStationPassAnalysis(requestContext))) {
            cancelRuntimeSceneOperation(operationId, "An\u00e1lisis AOS/LOS cancelado.");
            operationTerminal = true;
            return;
        }
        failRuntimeSceneOperation(operationId, error);
        operationTerminal = true;
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
        if (!operationTerminal && operationId) {
            cancelRuntimeSceneOperation(operationId, "An\u00e1lisis AOS/LOS cancelado.");
        }
        if (requestId === groundStationAnalysisRequestSequence && groundStationAnalysisAbortController === abortController) {
            groundStationAnalysisAbortController = null;
        }
        if (groundStationAnalysisOperationId === operationId) {
            groundStationAnalysisOperationId = null;
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

    // New projects persist the MTR explicitly. For a v1 project written
    // before MTR existed, a saved simulated interval is the only durable
    // finite scene contract available, so adopt it conservatively as the
    // compatibility MTR rather than resurrecting an unbounded realtime view.
    const savedMasterRange = snapshot.masterTimeRange ?? snapshot.master_time_range;
    const explicitMasterValidation = savedMasterRange
        ? validateObjectRange(savedMasterRange)
        : null;
    if (explicitMasterValidation?.valid) {
        setMasterTimeRange(
            explicitMasterValidation.range.startDate,
            explicitMasterValidation.range.endDate
        );
    } else if (!savedMasterRange && snapshot.mode === SIMULATION_MODE_RANGE) {
        const legacyRangeValidation = validateObjectRange({
            startDate: snapshot.startDate,
            endDate: snapshot.endDate
        });
        if (legacyRangeValidation.valid) {
            setMasterTimeRange(
                legacyRangeValidation.range.startDate,
                legacyRangeValidation.range.endDate
            );
        }
    }

    const requestedMode = [SIMULATION_MODE_REALTIME, SIMULATION_MODE_RANGE, SIMULATION_MODE_STATIC].includes(snapshot.mode)
        ? snapshot.mode
        : SIMULATION_MODE_RANGE;
    const finiteDomain = getFiniteEphemerisDomainState();
    const modeRequest = resolveSimulationModeRequest(requestedMode, finiteDomain);
    if (modeRequest.restricted) {
        // A project can have been saved before this finite-domain policy was
        // introduced. Do not resurrect an SP3/OEM layer into wall-clock or
        // static time; restore its bounded ephemeris domain instead.
        forceFiniteEphemerisRange(finiteDomain);
        return true;
    }
    const savedStart = new Date(snapshot.startDate);
    const savedEnd = new Date(snapshot.endDate);
    const hasSavedRange = !Number.isNaN(savedStart.getTime())
        && !Number.isNaN(savedEnd.getTime())
        && savedEnd >= savedStart;

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

    if (requestedMode === SIMULATION_MODE_REALTIME) {
        if (getMasterTimeRange() && !isInsideMasterRange(new Date())) {
            applyMasterTimeRangeToSimulation();
            return true;
        }
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

    if (getMasterTimeRange()) {
        simulationState.currentDate = clampToMasterRange(simulationState.currentDate)
            || new Date(simulationState.startDate);
    }

    simulationState.lastTickTimestamp = Date.now();
    applySimulationDateToViewer(getDisplayedSimulationDate());
    syncViewerClockPlayback();
    // Restore can reactivate a finite SP3 layer before restoring the saved
    // range/static clock. Re-render after the clock is authoritative so the
    // satellite runtime seeds it from exact ephemeris rather than waiting for
    // a realtime WebSocket position outside the product coverage.
    refreshSatelliteOverlays(viewer);
    refreshSimulationControlsUi();
    updateTopToolbarTime();
    return true;
}

function tickSimulationClock() {
    if (simulationState.mode === SIMULATION_MODE_REALTIME
        && getMasterTimeRange()
        && !isInsideMasterRange(new Date())) {
        // Time can cross an MTR boundary while the application is open. Do
        // this in the tick path as well as the mode command path so a live
        // layer cannot run past the declared scene contract between clicks.
        applyMasterTimeRangeToSimulation();
        return simulationState.currentDate;
    }
    simulationController.tick();
    if (getMasterTimeRange() && simulationState.mode !== SIMULATION_MODE_REALTIME) {
        simulationState.currentDate = clampToMasterRange(simulationState.currentDate)
            || new Date(simulationState.startDate);
    }
    return simulationState.currentDate;
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
        if (getMasterTimeRange()) {
            applyMasterTimeRangeToSimulation({ resetCurrent: true });
            refreshSimulationControlsUi();
            updateTopToolbarTime();
            return;
        }
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
        simulationState.currentDate = clampToMasterRange(getDateFromTimelineRatio(ratio))
            || getDateFromTimelineRatio(ratio);
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
            || endDate < startDate
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
        if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && endDate >= startDate) {
            await requestMasterTimeRangeFromTimeline(startDate, endDate);
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
        const diagnosticsButton = existing.querySelector("#topBuiltInTestBtn");
        if (diagnosticsButton && diagnosticsButton.dataset.reactOwned !== "true" && diagnosticsButton.dataset.orbitBound !== "true") {
            diagnosticsButton.dataset.orbitBound = "true";
            diagnosticsButton.addEventListener("click", () => window.dispatchEvent(new Event("orbit:diagnostics-open")));
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
            <button id="topBuiltInTestBtn" class="toolbar-icon-btn" type="button" aria-label="Built-In Test" title="Built-In Test">✓</button>
            <button id="topSettingsBtn" class="toolbar-icon-btn" type="button" aria-label="Configuración" title="Configuración">⚙</button>
            <button id="topUserBtn" class="toolbar-avatar" type="button" aria-label="Perfil de GG" title="Perfil de GG">GG</button>
        </div>
    `;

    toolbar.querySelector("#topSettingsBtn")?.addEventListener("click", () => runtimeConfigPanelApi?.toggle?.());
    toolbar.querySelector("#topHelpBtn")?.addEventListener("click", () => window.dispatchEvent(new Event("orbit:help-open")));
    toolbar.querySelector("#topBuiltInTestBtn")?.addEventListener("click", () => window.dispatchEvent(new Event("orbit:diagnostics-open")));

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
    const finiteDomain = getFiniteEphemerisDomainState();
    const masterTimeRange = masterTimeRangeDetail();
    updateSimulationTimelineUi(finiteDomain);
    window.dispatchEvent(new CustomEvent("orbit:time-context", {
        detail: {
            date: getDisplayedSimulationDate().toISOString(),
            mode: simulationState.mode,
            isPlaying: simulationState.isPlaying,
            isPaused: simulationState.isPlaying === false,
            oemDomainActive: finiteDomain.hasOemDomain,
            sp3DomainActive: finiteDomain.hasSp3Domain,
            manualDomainActive: finiteDomain.hasManualDomain,
            finiteEphemerisDomainActive: finiteDomain.finiteEphemerisDomainActive,
            finiteEphemerisSources: finiteDomain.finiteSources,
            masterTimeRange,
            masterTimeRangeActive: Boolean(masterTimeRange)
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
    const syncWorkspaceShellWidth = () => {
        const shell = document.getElementById("leftWorkspaceShell");
        if (!shell) return;
        const width = panel.style.getPropertyValue("--orbit-layers-panel-width").trim();
        if (width) {
            shell.style.setProperty("--orbit-left-panel-width", width);
            return;
        }
        shell.style.removeProperty("--orbit-left-panel-width");
    };
    setupResizableSidePanel({
        panel,
        triggerButton,
        storageKey: "orbit.layersPanel.width",
        cssVariable: "--orbit-layers-panel-width",
        maximumWidth: () => Math.min(640, window.innerWidth * 0.72),
        onLayoutChange: syncWorkspaceShellWidth,
        onCollapse: () => window.dispatchEvent(new Event("orbit:layers-panel-collapse"))
    });
    syncWorkspaceShellWidth();
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
    // A selected, visible station shows all of its visible satellite passes;
    // a selected, visible satellite shows the converse station passes. The
    // helper is range-mode gated, so ordinary realtime selection stays free.
    syncGroundStationTimelineSelection();
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
    const designSettings = getManualOrbitDesignSettings();
    const detail = {
        ...manualOrbitEditorState,
        ...designSettings,
        timeData: {
            manualErp: designSettings.manualErp || null,
            sceneWindow: designSettings.sceneWindow || null,
            finiteEphemerisRanges: [...(designSettings.finiteEphemerisRanges || [])],
            sceneAlignment: designSettings.sceneAlignment || null
        },
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

function manualOrbitGeopotentialAdjustmentMessage(responsePayload) {
    const metadata = responsePayload?.propagator_metadata ?? responsePayload?.propagatorMetadata;
    const geopotential = metadata?.geopotential;
    const selection = geopotential?.selection && typeof geopotential.selection === "object"
        ? geopotential.selection
        : geopotential;
    if (!selection || typeof selection !== "object") return "";
    const requestedDegree = Number(selection.requestedDegree ?? selection.requested_degree);
    const requestedOrder = Number(selection.requestedOrder ?? selection.requested_order);
    const effectiveDegree = Number(selection.degree);
    const effectiveOrder = Number(selection.order);
    const hasFiniteSelection = [requestedDegree, requestedOrder, effectiveDegree, effectiveOrder]
        .every((value) => Number.isInteger(value) && value >= 0);
    const warnings = Array.isArray(selection.warnings)
        ? selection.warnings.map((warning) => String(warning || "").trim()).filter(Boolean)
        : [];
    const adjusted = selection.clamped === true
        || (hasFiniteSelection && (requestedDegree !== effectiveDegree || requestedOrder !== effectiveOrder));
    if (!adjusted && warnings.length === 0) return "";
    const adjustment = hasFiniteSelection
        ? `Geopotencial ajustado de ${requestedDegree}×${requestedOrder} a ${effectiveDegree}×${effectiveOrder}.`
        : "La selección de geopotencial fue ajustada por el backend validado.";
    return warnings.length ? `${adjustment} ${warnings.join(" ")}` : adjustment;
}

const MANUAL_ORBIT_DEFAULT_WINDOW_HOURS = 24;
const MANUAL_ORBIT_PREVIEW_DEBOUNCE_MS = 320;
const MAX_MANUAL_ERP_FILE_BYTES = 32 * 1024 * 1024;

function manualOrbitTimeRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstManualOrbitTimeValue(value, keys) {
    const source = manualOrbitTimeRecord(value);
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(source, key)
            && source[key] !== undefined
            && source[key] !== null) {
            return source[key];
        }
    }
    return undefined;
}

/**
 * Retain just server-validated ERP provenance.  In particular, never copy a
 * `contentBase64` member from an upload command into editor/project state.
 */
function normalizeManualOrbitErpReference(value) {
    if (value === null) return null;
    const source = manualOrbitTimeRecord(value);
    const rawSnapshotId = String(firstManualOrbitTimeValue(source, ["snapshotId", "snapshot_id", "id"]) || "").trim();
    const snapshotId = rawSnapshotId.length <= 96 ? rawSnapshotId : "";
    const filename = String(firstManualOrbitTimeValue(source, ["filename", "fileName", "file_name", "name"]) || "").trim();
    const coverageStart = asValidManualOrbitDate(firstManualOrbitTimeValue(source, [
        "coverageStart", "coverage_start", "startTime", "start_time", "startUtc", "start_utc"
    ]));
    const coverageEnd = asValidManualOrbitDate(firstManualOrbitTimeValue(source, [
        "coverageEnd", "coverage_end", "endTime", "end_time", "endUtc", "end_utc"
    ]));
    // A project may intentionally retain a snapshot ID even if an older
    // project did not save display coverage. Preserve that identity so the
    // server can reload (or fail closed on) the exact snapshot. TIME policy
    // still treats missing coverage as insufficient for Earth-fixed forces.
    if (!snapshotId) {
        return null;
    }
    const integerOrNull = (candidate) => {
        const numeric = Number(candidate);
        return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
    };
    return {
        snapshotId,
        filename: filename || null,
        sha256: String(firstManualOrbitTimeValue(source, ["sha256", "sha_256", "sourceSha256", "source_sha256"]) || "").trim() || null,
        sourceSha256: String(firstManualOrbitTimeValue(source, ["sourceSha256", "source_sha256"]) || "").trim() || null,
        byteSize: integerOrNull(firstManualOrbitTimeValue(source, ["byteSize", "byte_size", "size"])),
        recordCount: integerOrNull(firstManualOrbitTimeValue(source, ["recordCount", "record_count", "sampleCount", "sample_count"])),
        coverageStart: coverageStart && coverageEnd && coverageEnd.getTime() > coverageStart.getTime()
            ? coverageStart.toISOString()
            : null,
        coverageEnd: coverageStart && coverageEnd && coverageEnd.getTime() > coverageStart.getTime()
            ? coverageEnd.toISOString()
            : null,
        source: String(firstManualOrbitTimeValue(source, ["source", "provider"]) || "").trim() || null,
        version: String(firstManualOrbitTimeValue(source, ["version"]) || "").trim() || null,
        quality: String(firstManualOrbitTimeValue(source, ["quality", "productClass", "product_class"]) || "").trim() || null
    };
}

function manualOrbitTimeRange(value) {
    const source = manualOrbitTimeRecord(value);
    const start = asValidManualOrbitDate(firstManualOrbitTimeValue(source, ["startTime", "start_time", "startUtc", "start_utc"]));
    const end = asValidManualOrbitDate(firstManualOrbitTimeValue(source, ["endTime", "end_time", "endUtc", "end_utc"]));
    if (!start || !end || end.getTime() <= start.getTime()) return null;
    return { startTime: start.toISOString(), endTime: end.toISOString() };
}

function finiteManualOrbitSceneRanges(value) {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => {
        const range = manualOrbitTimeRange(entry?.range || entry);
        if (!range) return null;
        return {
            ...range,
            source: String(entry?.source || entry?.kind || entry?.format || "finite ephemeris").trim() || "finite ephemeris"
        };
    }).filter(Boolean);
}

function manualOrbitErpValueFromPayload(payload = {}) {
    const source = manualOrbitTimeRecord(payload);
    for (const key of ["manualErp", "manual_erp"]) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            return { present: true, value: source[key] };
        }
    }
    const timeData = manualOrbitTimeRecord(source.timeData ?? source.time_data);
    for (const key of ["manualErp", "manual_erp"]) {
        if (Object.prototype.hasOwnProperty.call(timeData, key)) {
            return { present: true, value: timeData[key] };
        }
    }
    return { present: false, value: undefined };
}

function getManualOrbitSceneTimeContext() {
    const domain = getFiniteEphemerisDomainState();
    // A rolling realtime horizon is not an authored finite data interval and
    // must not masquerade as one. TIME compares against an explicit Range
    // scene (or a finite SP3/OEM domain) only.
    const simulationRange = simulationState?.mode === SIMULATION_MODE_RANGE
        || domain.finiteEphemerisDomainActive
        ? manualOrbitTimeRange({
            startTime: simulationState?.startDate,
            endTime: simulationState?.endDate
        })
        : null;
    const finiteEphemerisRanges = [];
    if (domain.hasOemDomain) {
        // Do not collapse multiple OEM tracks to their min/max bounds here:
        // that aggregate is appropriate for a timeline, but would turn a
        // gap between products into a fictional common-analysis window.
        for (const range of getLoadedOemEphemerisTimeRanges()) {
            finiteEphemerisRanges.push({
                source: `OEM ${range.id}`,
                startTime: new Date(range.startTimeMs).toISOString(),
                endTime: new Date(range.endTimeMs).toISOString()
            });
        }
    }
    if (domain.preciseCoverage) {
        finiteEphemerisRanges.push({
            source: "SP3",
            startTime: new Date(domain.preciseCoverage.start).toISOString(),
            endTime: new Date(domain.preciseCoverage.end).toISOString()
        });
    }
    return {
        sceneWindow: simulationRange,
        finiteEphemerisRanges
    };
}

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
        previewReferenceFrame: "eme2000",
        // The reference is orbit-specific and may be persisted with a manual
        // orbit. The raw ERP upload is deliberately never retained here.
        manualErp: null,
        // These scene values are display/analysis guards only; they are
        // captured on entering design mode and never become part of a manual
        // orbit's physical definition.
        sceneWindow: null,
        finiteEphemerisRanges: [],
        sceneAlignment: null
    };
    return { ...manualOrbitDesignSettings };
}

function updateManualOrbitDesignSettings(payload = {}) {
    const current = getManualOrbitDesignSettings();
    const startInput = payload.epochStartUtc ?? payload.startTime ?? payload.start_time ?? payload.epochUtc;
    const endInput = payload.epochEndUtc ?? payload.endTime ?? payload.end_time;
    const start = startInput === undefined ? null : asValidManualOrbitDate(startInput);
    const end = endInput === undefined ? null : asValidManualOrbitDate(endInput);
    const manualErpInput = manualOrbitErpValueFromPayload(payload);
    const timeData = manualOrbitTimeRecord(payload.timeData ?? payload.time_data);
    const sceneWindowInput = Object.prototype.hasOwnProperty.call(payload, "sceneWindow")
        ? payload.sceneWindow
        : Object.prototype.hasOwnProperty.call(payload, "scene_window")
            ? payload.scene_window
            : Object.prototype.hasOwnProperty.call(timeData, "sceneWindow")
                ? timeData.sceneWindow
                : Object.prototype.hasOwnProperty.call(timeData, "scene_window")
                    ? timeData.scene_window
                    : undefined;
    const finiteRangesInput = Object.prototype.hasOwnProperty.call(payload, "finiteEphemerisRanges")
        ? payload.finiteEphemerisRanges
        : Object.prototype.hasOwnProperty.call(payload, "finite_ephemeris_ranges")
            ? payload.finite_ephemeris_ranges
            : Object.prototype.hasOwnProperty.call(timeData, "finiteEphemerisRanges")
                ? timeData.finiteEphemerisRanges
                : Object.prototype.hasOwnProperty.call(timeData, "finite_ephemeris_ranges")
                    ? timeData.finite_ephemeris_ranges
                    : undefined;
    const alignmentInput = payload.sceneAlignment ?? payload.scene_alignment
        ?? timeData.sceneAlignment ?? timeData.scene_alignment;

    manualOrbitDesignSettings = {
        epochStartUtc: start ? start.toISOString() : current.epochStartUtc,
        epochEndUtc: end ? end.toISOString() : current.epochEndUtc,
        groundTrackPreview: typeof payload.groundTrackPreview === "boolean"
            ? payload.groundTrackPreview
            : current.groundTrackPreview === true,
        previewReferenceFrame: normalizeManualOrbitPreviewReferenceFrame(
            payload.previewReferenceFrame,
            current.previewReferenceFrame
        ),
        manualErp: manualErpInput.present
            ? normalizeManualOrbitErpReference(manualErpInput.value)
            : current.manualErp || null,
        sceneWindow: sceneWindowInput === undefined
            ? current.sceneWindow || null
            : manualOrbitTimeRange(sceneWindowInput),
        finiteEphemerisRanges: finiteRangesInput === undefined
            ? [...(current.finiteEphemerisRanges || [])]
            : finiteManualOrbitSceneRanges(finiteRangesInput),
        sceneAlignment: alignmentInput === undefined ? current.sceneAlignment || null : alignmentInput || null
    };
    return { ...manualOrbitDesignSettings };
}

/**
 * A successful manual ERP preflight explicitly adopts its suggested UTC
 * design range. Keep the physical EME2000 state epoch aligned with that
 * start too: otherwise a stale draft epoch can be outside a valid replacement
 * ERP and incorrectly block preview/create.
 */
function anchorManualOrbitPhysicalEpochToDesignStart(designWindow) {
    const epochUtc = physicalEpochAtDesignWindowStart(designWindow);
    if (!epochUtc) {
        throw new Error("El ERP validado no define un inicio de cobertura UTC válido.");
    }
    manualOrbitEditorState = synchronizeManualOrbitState(
        manualOrbitEditorState,
        { epochUtc },
        undefined
    );
    return epochUtc;
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
        ),
        // This must be the server-validated snapshot reference from the
        // project entry.  Never put an uploaded File or base64 content in the
        // design state: an ERP upload is a one-shot preflight transaction.
        manualErp: normalizeManualOrbitErpReference(
            manualOrbitRecordValue(record, "manualErp", "manual_erp")
        ),
        sceneWindow: null,
        finiteEphemerisRanges: [],
        sceneAlignment: null
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

/**
 * Resolve the single UTC policy used by both the React TIME surface and the
 * legacy runtime before preview/create. Earth-fixed forces use the automatic
 * process IERS provider by default; a saved manual ERP remains an explicit
 * reproducible override when the operator elects to attach one.
 */
function getManualOrbitTimePolicy() {
    const settings = getManualOrbitDesignSettings();
    const designWindow = {
        startTime: settings.epochStartUtc,
        endTime: settings.epochEndUtc
    };
    const manualErp = normalizeManualOrbitErpReference(settings.manualErp);
    return resolveManualOrbitTimePolicy({
        designWindow,
        physicalEpoch: manualOrbitEditorState?.epochUtc,
        erpCoverage: manualErp
            ? {
                startTime: manualErp.coverageStart,
                endTime: manualErp.coverageEnd
            }
            : null,
        automaticEopDiagnostic: getPlannerErpDiagnosticComponent(),
        forceTerms: manualOrbitEditorState?.propagationOptions?.forceTerms || [],
        sceneWindow: settings.sceneWindow,
        finiteEphemerisRanges: settings.finiteEphemerisRanges || []
    });
}

function getManualOrbitMasterTimeRangeFit() {
    const design = getManualOrbitDesignWindow();
    return validateObjectFitsMTR({
        startTime: design.startTime,
        endTime: design.endTime
    });
}

function assertManualOrbitTimePolicy({ allowApprovedMasterExpansion = false } = {}) {
    const policy = getManualOrbitTimePolicy();
    if (policy.canCreate) {
        const fit = getManualOrbitMasterTimeRangeFit();
        if (!fit.valid) {
            throw new Error("El intervalo de diseño no define un rango temporal UTC válido.");
        }
        if (!fit.accepted && !allowApprovedMasterExpansion) {
            throw new Error("El intervalo de diseño queda fuera del rango temporal maestro. Ajusta TIME o pulsa Crear para decidir si deseas ampliarlo.");
        }
        return policy;
    }

    if (policy.blockingReasons.includes("manual-erp-does-not-cover-design-window")) {
        throw new Error("El ERP manual opcional seleccionado no cubre todo el intervalo de diseño.");
    }
    if (policy.blockingReasons.includes("manual-erp-does-not-cover-physical-epoch")) {
        throw new Error("El ERP manual opcional seleccionado no cubre el epoch físico del vector de estado.");
    }
    if (policy.blockingReasons.includes("invalid-physical-epoch")) {
        throw new Error("El epoch físico del vector de estado no es una fecha UTC válida.");
    }
    throw new Error("Define un intervalo temporal válido para la órbita manual.");
}

// The manual designer owns only its transient work. It reports into the
// shared activity ledger, but it must never clear a project import, a scene
// analysis, or a system startup operation when the panel is closed.
const MANUAL_ORBIT_OPERATION_SCOPE = OPERATION_SCOPES.MANUAL_ORBIT;

function manualOrbitOperationId(kind, sequence) {
    return `manual-orbit:${kind}:${sequence}`;
}

function startManualOrbitOperation(kind, sequence, {
    title,
    stage = "",
    message = "",
    cancellable = true
} = {}) {
    const id = manualOrbitOperationId(kind, sequence);
    startOperation({
        id,
        title: title || "Operaci\u00f3n orbital manual",
        scope: MANUAL_ORBIT_OPERATION_SCOPE,
        stage,
        message,
        cancellable
    });
    return id;
}

function updateManualOrbitOperation(id, detail = {}) {
    if (!id) return;
    updateOperation({ id, ...detail });
}

function completeManualOrbitOperation(id, message = "") {
    if (!id) return;
    completeOperation({ id, message });
}

function failManualOrbitOperation(id, error) {
    if (!id) return;
    failOperation({ id, error: extractManualOrbitError(error, "No se pudo completar la operaci\u00f3n orbital.") });
}

function cancelManualOrbitOperation(id, message = "") {
    if (!id) return;
    cancelOperation({ id, message });
}

function clearManualOrbitOperations() {
    clearOperationsForScope(MANUAL_ORBIT_OPERATION_SCOPE);
}

function captureManualOrbitPreviewCheckpoint({ previewRendered = false } = {}) {
    if (!manualOrbitDesignSession?.active) {
        return;
    }
    manualOrbitPreviewCheckpoint.capture({
        editorState: manualOrbitEditorState,
        definitionSource: manualOrbitDefinitionSource,
        designSettings: getManualOrbitDesignSettings(),
        previewRendered
    });
}

/**
 * Restore the last configuration that actually corresponds to the transient
 * preview. A user cancellation is an explicit discard of optimistic preview
 * edits, so keeping their checked force terms would be misleading.
 *
 * The checkpoint deliberately does not roll back name or object metadata:
 * neither changes the propagated geometry and they may have been edited
 * while a numerical request was running.
 */
function restoreManualOrbitPreviewCheckpoint() {
    const checkpoint = manualOrbitPreviewCheckpoint.read();
    if (!checkpoint?.editorState || !checkpoint?.designSettings || !manualOrbitDesignSession?.active) {
        return { restored: false, previewRendered: false };
    }

    const currentState = manualOrbitEditorState;
    const currentSettings = manualOrbitDesignSettings;
    const currentDefinitionSource = manualOrbitDefinitionSource;
    manualOrbitEditorState = {
        ...checkpoint.editorState,
        name: currentState?.name ?? checkpoint.editorState.name,
        objectMetadata: currentState?.objectMetadata ?? checkpoint.editorState.objectMetadata
    };
    manualOrbitDefinitionSource = checkpoint.definitionSource || "keplerian";
    manualOrbitDesignSettings = checkpoint.designSettings;
    try {
        applyManualOrbitDesignTimeWindow();
        // A successful prior preview remains rendered while a replacement
        // request is in flight. Restore its only immediate display toggle so
        // the visible trajectory and the restored controls agree at once.
        if (checkpoint.previewRendered) {
            setManualOrbitPreviewGroundTrack(
                manualOrbitDesignSettings.groundTrackPreview === true,
                { viewer }
            );
        }
    } catch (error) {
        manualOrbitEditorState = currentState;
        manualOrbitDesignSettings = currentSettings;
        manualOrbitDefinitionSource = currentDefinitionSource;
        logger.warn("No se pudo restaurar la previsualizaci\u00f3n orbital anterior:", error);
        return { restored: false, previewRendered: false, error };
    }

    publishManualOrbitState({
        previewRestored: true,
        previewRestoreMessage: checkpoint.previewRendered
            ? "Previsualizaci\u00f3n cancelada. Se restaur\u00f3 la \u00faltima configuraci\u00f3n aplicada."
            : "Previsualizaci\u00f3n cancelada. Se restaur\u00f3 la configuraci\u00f3n inicial de dise\u00f1o."
    });
    return { restored: true, previewRendered: checkpoint.previewRendered === true };
}

function stopManualOrbitPreviewRequest() {
    const operationId = manualOrbitPreviewOperationId;
    manualOrbitPreviewOperationId = null;
    if (manualOrbitPreviewTimer) {
        clearTimeout(manualOrbitPreviewTimer);
        manualOrbitPreviewTimer = null;
    }
    if (manualOrbitPreviewAbortController) {
        manualOrbitPreviewAbortController.abort();
        manualOrbitPreviewAbortController = null;
    }
    manualOrbitPreviewRequestId += 1;
    cancelManualOrbitOperation(operationId, "Previsualizaci\u00f3n cancelada.");
}

/** Cancel and invalidate a transient ERP upload/preflight. */
function stopManualOrbitErpUpload() {
    const operationId = manualOrbitErpUploadOperationId;
    manualOrbitErpUploadOperationId = null;
    manualOrbitErpUploadGate.cancel();
    cancelManualOrbitOperation(operationId, "Validaci\u00f3n ERP cancelada.");
}

function stopManualOrbitCreateRequest() {
    // A confirmation request mutates the workspace when it resolves. Give it
    // its own cancellation generation so closing design mode or replacing the
    // project can never import a late result into the new workspace.
    const operationId = manualOrbitCreateOperationId;
    manualOrbitCreateOperationId = null;
    manualOrbitCreateRequestId += 1;
    if (manualOrbitCreateAbortController) {
        manualOrbitCreateAbortController.abort();
        manualOrbitCreateAbortController = null;
    }
    manualOrbitCreateInFlight = false;
    cancelManualOrbitOperation(operationId, "Creaci\u00f3n de \u00f3rbita cancelada.");
}

function applyManualOrbitDesignTimeWindow() {
    if (!manualOrbitDesignSession?.active) {
        return;
    }
    const windowRange = getManualOrbitDesignWindow();
    const masterFit = validateObjectFitsMTR({
        startTime: windowRange.startTime,
        endTime: windowRange.endTime
    });
    if (masterFit.valid && !masterFit.accepted && masterFit.hasMasterTimeRange) {
        // Editing an invalid future/past range must not move the shared
        // scene outside MTR. The explicit expansion decision occurs when the
        // user confirms creation, never while typing into TIME.
        applyMasterTimeRangeToSimulation();
        throw new Error("El intervalo de diseño queda fuera del rango temporal maestro. Ajusta TIME o pulsa Crear para ampliarlo.");
    }
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
    // Capture the existing scene before the design window changes the global
    // simulation range.  TIME can then disclose a finite SP3/OEM overlap
    // instead of quietly treating incompatible coverage as comparable.
    const sceneTimeContext = getManualOrbitSceneTimeContext();
    updateManualOrbitDesignSettings(sceneTimeContext);

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
        },
        sceneTimeContext
    };

    // Start every isolated design session with an undo point. It is marked
    // non-rendered until the first propagation succeeds, which covers a user
    // cancelling during the initial calculation as well as later edits.
    manualOrbitPreviewCheckpoint.clear();
    captureManualOrbitPreviewCheckpoint({ previewRendered: false });

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
    stopManualOrbitErpUpload();
    if (!preserveManualOrbitCreate) {
        stopManualOrbitCreateRequest();
        clearManualOrbitOperations();
    }
    clearManualOrbitPreview();
    manualOrbitPreviewCheckpoint.clear();
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
        const masterRange = getMasterTimeRange();
        const now = new Date();
        const requestedMode = session.simulation.mode;
        const restoreRealtime = requestedMode === SIMULATION_MODE_REALTIME
            && (!masterRange || isInsideMasterRange(now));
        simulationState.mode = restoreRealtime
            ? SIMULATION_MODE_REALTIME
            : (masterRange ? SIMULATION_MODE_RANGE : requestedMode);
        simulationState.isPlaying = session.simulation.isPlaying;
        simulationState.playing = session.simulation.playing;
        simulationState.rewind = session.simulation.rewind;
        simulationState.speed = session.simulation.speed;
        simulationState.currentDate = new Date(session.simulation.currentDate);
        simulationState.startDate = new Date(session.simulation.startDate);
        simulationState.endDate = new Date(session.simulation.endDate);
        if (masterRange) {
            applyMasterTimeRangeToSimulation();
        } else if (simulationState.mode === SIMULATION_MODE_REALTIME) {
            simulationState.currentDate = now;
        }
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
    stopManualOrbitErpUpload();
    stopManualOrbitCreateRequest();
    clearManualOrbitOperations();
    clearManualOrbitPreview();
    manualOrbitPreviewCheckpoint.clear();
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
    // The API serializer reduces this provenance object to `{ snapshot_id }`.
    // The upload payload is never retained after the ERP preflight succeeds.
    options.manualErp = getManualOrbitDesignSettings().manualErp || null;
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
        manualErp: normalizeManualOrbitErpReference(
            manualOrbitRecordValue(record, "manualErp", "manual_erp")
        ),
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
                includeVelocity: true,
                manualErp: persisted.manualErp
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
                manualErp: persisted.manualErp,
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
            // A persisted MTR is a durable scene contract, not a hint.  A
            // regenerated manual trajectory may differ at its endpoints from
            // an older project definition, but restoration must never widen
            // the saved range silently.  Keep it only if it fits; the
            // operator can explicitly expand MTR after opening the project.
            const importedRange = getObjectIntrinsicTimeRange(imported.id);
            if (!importedRange) {
                throw new Error("La orbita manual restaurada no declaro una cobertura temporal valida.");
            }
            const masterFit = validateObjectFitsMTR(importedRange);
            if (!masterFit.valid || masterFit.requiresExpansion) {
                setSatelliteLayerActive(imported.id, false);
                throw new Error("La orbita manual restaurada queda fuera del rango temporal maestro guardado.");
            }
            if (masterFit.requiresInitialization) {
                commitObjectRangeToMasterTimeRange(masterFit.range);
            }
            restored.push(imported.id);
        } catch (error) {
            const recordName = String(record?.name || record?.id || "orbita manual").trim();
            failed.push({ id: record?.id || null, error: extractManualOrbitError(error) });
            logger.warn(`No se pudo restaurar la orbita manual '${recordName}':`, error);
        }
    }
    if (restored.length && getMasterTimeRange()) {
        applyMasterTimeRangeToSimulation();
    }
    return { restored, failed };
}

async function requestManualOrbitPreview() {
    if (!manualOrbitDesignSession?.active || manualOrbitCreateInFlight) {
        return;
    }

    let windowRange;
    let earthOrientationPreflight = null;
    try {
        // Preview must stay inside an already established MTR. It never
        // prompts or expands the scene; only the explicit Create action can
        // make that durable global decision.
        const timePolicy = assertManualOrbitTimePolicy();
        windowRange = getManualOrbitPropagationWindow();
        earthOrientationPreflight = timePolicy.automaticEopEffectiveAssessment
            || timePolicy.automaticEopAssessment;
    } catch (error) {
        // A previous path may have used an earlier valid ERP or epoch. Do not
        // leave it on screen once the active TIME contract is invalid.
        clearManualOrbitPreview();
        publishManualOrbitStatus("error", extractManualOrbitError(error, "Define un intervalo temporal válido para la órbita."));
        return;
    }

    if (manualOrbitPreviewAbortController) {
        stopManualOrbitPreviewRequest();
    }
    const requestId = ++manualOrbitPreviewRequestId;
    const controller = new AbortController();
    manualOrbitPreviewAbortController = controller;
    const operationId = startManualOrbitOperation("preview", requestId, {
        title: "Previsualizando \u00f3rbita manual",
        stage: "Propagando la ventana solicitada",
        message: earthOrientationOperationMessage(
            earthOrientationPreflight,
            "La previsualización",
            "La previsualización conserva la ventana y el muestreo solicitados."
        ),
        cancellable: true
    });
    manualOrbitPreviewOperationId = operationId;
    try {
        const response = await fetch("/api/manual-orbits", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            // Preview and confirmation use the exact same requested design
            // window and sampling contract. Responsiveness is reported as a
            // cancellable operation; it never silently coarsens the model.
            body: JSON.stringify(buildManualOrbitRequestPayload(windowRange)),
            signal: controller.signal
        });
        const responsePayload = await response.json().catch(() => null);
        if (!response.ok) {
            throw responsePayload || new Error(`HTTP ${response.status}`);
        }
        if (requestId !== manualOrbitPreviewRequestId || !manualOrbitDesignSession?.active) {
            if (manualOrbitPreviewOperationId === operationId) {
                manualOrbitPreviewOperationId = null;
            }
            cancelManualOrbitOperation(operationId, "Previsualizaci\u00f3n sustituida por una solicitud m\u00e1s reciente.");
            return;
        }
        const actualEarthOrientation = actualEarthOrientationAssessment(responsePayload);
        updateManualOrbitOperation(operationId, {
            stage: "Representando trayectoria",
            message: actualEarthOrientation
                ? describeEarthOrientationCoverage(actualEarthOrientation, { operation: "La previsualización" })
                : "Aplicando la trayectoria calculada a la escena de diseño."
        });
        renderManualOrbitPreview(responsePayload, {
            viewer,
            // This is a live design aid and is preserved for the confirmed
            // object as well. Its projection follows the selected EME2000/ITRF
            // preview frame, so the design view never mixes both geometries.
            showGroundTrack: getManualOrbitDesignSettings().groundTrackPreview === true,
            color: "#65b7ff",
            previewReferenceFrame: getManualOrbitDesignSettings().previewReferenceFrame
        });
        // Only a fully rendered response becomes the rollback point.  While
        // newer force selections are calculating, this preserves a coherent
        // state/trajectory pair for an explicit Activity-panel cancellation.
        captureManualOrbitPreviewCheckpoint({ previewRendered: true });
        if (manualOrbitPreviewOperationId === operationId) {
            manualOrbitPreviewOperationId = null;
        }
        completeManualOrbitOperation(
            operationId,
            actualEarthOrientation
                ? describeEarthOrientationCoverage(actualEarthOrientation, { operation: "Previsualización actualizada" })
                : "Previsualización actualizada."
        );
        publishManualOrbitStatus(null, "");
    } catch (error) {
        if (isExpectedManualOrbitRequestCancellation(error, controller)
            || requestId !== manualOrbitPreviewRequestId) {
            if (manualOrbitPreviewOperationId === operationId) {
                manualOrbitPreviewOperationId = null;
                cancelManualOrbitOperation(operationId, "Previsualizaci\u00f3n cancelada.");
            }
            return;
        }
        // Do not leave the last valid path on screen when the current edited
        // definition is rejected by the propagation service.
        clearManualOrbitPreview();
        if (manualOrbitPreviewOperationId === operationId) {
            manualOrbitPreviewOperationId = null;
        }
        failManualOrbitOperation(operationId, error);
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

function isExpectedManualOrbitRequestCancellation(error, controller) {
    // A normal edit, close, or newer preview aborts the browser-owned
    // controller. Fetch implementations vary between AbortError, ABORT_ERR,
    // and a TypeError, so the signal itself is the primary source of truth.
    // Do not classify an upstream 502/504 payload as a cancellation: that
    // must stay visible to the operator with its actionable server message.
    return controller?.signal?.aborted === true
        || error?.name === "AbortError"
        || error?.code === "ABORT_ERR";
}

function manualOrbitErrorMessage(message, fallback) {
    const text = String(message || "").trim();
    // Backward compatibility with gateways built before they returned the
    // structured PYTHON_BACKEND_TIMEOUT response. This is an upstream abort,
    // not a user cancellation, because the caller's controller remains live.
    if (/^(?:this )?operation was aborted\.?$/i.test(text)) {
        return "El c\u00e1lculo de la \u00f3rbita fue interrumpido por el servicio antes de terminar. Consulta el estado de operaciones y vuelve a intentarlo.";
    }
    return text || fallback;
}

function extractManualOrbitError(error, fallback = "No se pudo crear la orbita manual.") {
    if (error instanceof Error && error.message) {
        return manualOrbitErrorMessage(error.message, fallback);
    }
    if (typeof error === "string" && error.trim()) {
        return manualOrbitErrorMessage(error, fallback);
    }
    if (error && typeof error === "object") {
        const detail = error.detail || error.error || error.message;
        if (Array.isArray(detail)) {
            const messages = detail
                .map((item) => String(item?.msg || item?.message || "").trim())
                .filter(Boolean);
            if (messages.length) return manualOrbitErrorMessage(messages.join(". "), fallback);
        }
        if (typeof detail === "string" && detail.trim()) return manualOrbitErrorMessage(detail, fallback);
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

function synchronizeManualOrbitEditor(payload, source, {
    publish = true,
    applyTimeWindow = true
} = {}) {
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
        if (manualOrbitDesignSession?.active && shouldRefreshPreview && applyTimeWindow) {
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
    // Do not apply the draft interval to the scene before the explicit MTR
    // decision below.  Otherwise an out-of-range TIME edit is rejected by
    // the preview guard and the required Expand/Cancel dialog is unreachable.
    if (!synchronizeManualOrbitEditor(payload, manualOrbitDefinitionSource, {
        publish: false,
        applyTimeWindow: false
    })) {
        return;
    }

    let approvedMasterRange = null;
    let earthOrientationPreflight = null;
    try {
        const designWindow = getManualOrbitDesignWindow();
        const masterRangeAtRequest = {
            startTime: designWindow.startTime,
            endTime: designWindow.endTime
        };
        approvedMasterRange = await approveObjectRangeForMasterTimeRange(masterRangeAtRequest, {
            objectName: String(payload?.name || manualOrbitEditorState?.name || "Órbita manual").trim() || "Órbita manual"
        });
        if (!approvedMasterRange.accepted) {
            publishManualOrbitStatus("info", "No se creó la órbita: se mantuvo el rango temporal maestro actual.");
            return;
        }
        const timePolicy = assertManualOrbitTimePolicy({
            allowApprovedMasterExpansion: approvedMasterRange.action === "expand"
        });
        earthOrientationPreflight = timePolicy.automaticEopEffectiveAssessment
            || timePolicy.automaticEopAssessment;
    } catch (error) {
        publishManualOrbitStatus("error", extractManualOrbitError(error));
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
    const operationId = startManualOrbitOperation("create", createRequestId, {
        title: editingTargetAtRequest ? "Actualizando \u00f3rbita manual" : "Creando \u00f3rbita manual",
        stage: "Preparando propagaci\u00f3n",
        message: `${earthOrientationOperationMessage(
            earthOrientationPreflight,
            "La creación de la órbita",
            ""
        )} Modelo seleccionado: ${propagatorLabel}.`.trim(),
        cancellable: true
    });
    manualOrbitCreateOperationId = operationId;
    publishManualOrbitStatus("busy", `Generando efemerides ${propagatorLabel}...`);
    try {
        const windowRange = getManualOrbitPropagationWindow();
        const requestPayload = buildManualOrbitRequestPayload(windowRange);
        updateManualOrbitOperation(operationId, {
            stage: "Propagando ventana solicitada",
            message: earthOrientationOperationMessage(
                earthOrientationPreflight,
                "La creación de la órbita",
                "Calculando la efeméride con el intervalo y muestreo solicitados."
            )
        });
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
            if (manualOrbitCreateOperationId === operationId) {
                manualOrbitCreateOperationId = null;
            }
            cancelManualOrbitOperation(operationId, "Creaci\u00f3n sustituida por un cambio de sesi\u00f3n.");
            return;
        }

        const actualEarthOrientation = actualEarthOrientationAssessment(responsePayload);
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
            manualErp: getManualOrbitDesignSettings().manualErp || null,
            objectMetadata: manualOrbitEditorState.objectMetadata,
            propagationOptions: manualOrbitEditorState.propagationOptions,
            groundTrackEnabled
        };
        // The preview owns separate Cesium entities; remove those before the
        // confirmed local layer is created to avoid a doubled trajectory.
        updateManualOrbitOperation(operationId, {
            stage: "Registrando \u00f3rbita en la escena",
            message: "Guardando la trayectoria calculada en el proyecto actual."
        });
        clearManualOrbitPreview();
        const imported = editingTargetAtRequest
            ? replaceManualOrbitTrack(editingTargetAtRequest.id, committedPayload)
            : importManualOrbitTrack(committedPayload);
        // The generated samples, rather than the requested design window,
        // are authoritative. A propagation service may reject or truncate an
        // endpoint, and the MTR must never promise data beyond the finite
        // track that was actually registered.
        const importedRange = getObjectIntrinsicTimeRange(imported.id);
        if (!importedRange) {
            throw new Error("La orbita manual generada no declaro una cobertura temporal valida.");
        }
        // The propagation service and local registration both succeeded.
        // Commit at this exact point so an unsuccessful request cannot leave
        // a phantom MTR expansion behind.
        commitObjectRangeToMasterTimeRange(importedRange);
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
        const geopotentialAdjustment = manualOrbitGeopotentialAdjustmentMessage(responsePayload);
        publishManualOrbitState({ open: false });
        const earthOrientationStatus = actualEarthOrientation?.requiresNotice
            ? ` ${describeEarthOrientationCoverage(actualEarthOrientation, { operation: "Proveniencia temporal" })}`
            : "";
        publishManualOrbitStatus(
            geopotentialAdjustment || actualEarthOrientation?.requiresWarning ? "warning" : "success",
            `${editingTargetAtRequest
                ? `Orbita manual '${imported.name}' actualizada con ${getManualOrbitPropagatorLabel(manualOrbitEditorState?.propagator, manualOrbitEditorState?.propagationOptions)}.`
                : `Orbita manual '${imported.name}' creada con ${getManualOrbitPropagatorLabel(manualOrbitEditorState?.propagator, manualOrbitEditorState?.propagationOptions)}.`}${geopotentialAdjustment ? ` ${geopotentialAdjustment}` : ""}${earthOrientationStatus}`
        );
        if (manualOrbitCreateOperationId === operationId) {
            manualOrbitCreateOperationId = null;
        }
        completeManualOrbitOperation(
            operationId,
            actualEarthOrientation
                ? describeEarthOrientationCoverage(actualEarthOrientation, {
                    operation: editingTargetAtRequest ? "Órbita manual actualizada" : "Órbita manual creada"
                })
                : editingTargetAtRequest
                    ? "Órbita manual actualizada."
                    : "Órbita manual creada."
        );
    } catch (error) {
        if (isExpectedManualOrbitRequestCancellation(error, controller)
            || createRequestId !== manualOrbitCreateRequestId) {
            if (manualOrbitCreateOperationId === operationId) {
                manualOrbitCreateOperationId = null;
                cancelManualOrbitOperation(operationId, "Creaci\u00f3n de \u00f3rbita cancelada.");
            }
            return;
        }
        const message = extractManualOrbitError(error);
        if (manualOrbitCreateOperationId === operationId) {
            manualOrbitCreateOperationId = null;
        }
        failManualOrbitOperation(operationId, error);
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
    window.addEventListener("orbit:operation-cancel-request", (event) => {
        const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
        const requestedScope = String(detail.scope || "").trim();
        const requestedId = String(detail.id || "").trim();
        if (!requestedId || (requestedScope && requestedScope !== MANUAL_ORBIT_OPERATION_SCOPE)) {
            return;
        }
        if (requestedId === manualOrbitPreviewOperationId) {
            stopManualOrbitPreviewRequest();
            const rollback = restoreManualOrbitPreviewCheckpoint();
            if (!rollback.restored) {
                // There is no safe trajectory to retain if the session never
                // obtained a valid preview or its saved TIME range cannot be
                // restored. Do not leave controls claiming otherwise.
                clearManualOrbitPreview();
                publishManualOrbitStatus(
                    "error",
                    rollback.error
                        ? extractManualOrbitError(rollback.error, "No se pudo restaurar la previsualizaci\u00f3n anterior.")
                        : "Previsualizaci\u00f3n cancelada antes de que hubiera una trayectoria v\u00e1lida."
                );
                return;
            }
            if (!rollback.previewRendered) {
                // Cancelling the initial propagation restores the clean
                // session draft. Launch its baseline preview once so the
                // editor does not remain with controls but no trajectory.
                clearManualOrbitPreview();
                scheduleManualOrbitPreview({ immediate: true });
            }
            return;
        }
        if (requestedId === manualOrbitCreateOperationId) {
            stopManualOrbitCreateRequest();
            publishManualOrbitStatus("info", "Creaci\u00f3n de \u00f3rbita cancelada.");
            return;
        }
        if (requestedId === manualOrbitErpUploadOperationId) {
            stopManualOrbitErpUpload();
            publishManualOrbitErpUploadResult({
                ok: false,
                cancelled: true,
                message: "Validaci\u00f3n ERP cancelada."
            });
        }
    });
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
    window.addEventListener("orbit:manual-orbit-erp-upload-request", (event) => {
        void previewManualOrbitErpUpload(event.detail || {});
    });
    window.addEventListener("orbit:manual-orbit-erp-clear", (event) => {
        const detail = event.detail || {};
        // Clear wins over any in-flight replacement upload. Its response is
        // ignored even if File.arrayBuffer had already completed.
        stopManualOrbitErpUpload();
        updateManualOrbitDesignSettings({
            ...detail,
            manualErp: null
        });
        // A previous request may otherwise resolve after the ERP was removed
        // and paint a trajectory computed with now-invalid force inputs.
        if (manualOrbitDesignSession?.active) {
            stopManualOrbitPreviewRequest();
            clearManualOrbitPreview();
            try {
                applyManualOrbitDesignTimeWindow();
                scheduleManualOrbitPreview({ immediate: true });
            } catch (error) {
                publishManualOrbitStatus("error", extractManualOrbitError(error));
            }
        }
        publishManualOrbitState();
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

function stopPropagatedParametersRequest(message = "C\u00e1lculo de par\u00e1metros propagados cancelado.") {
    const operationId = propagatedParametersOperationId;
    const controller = propagatedParametersAbortController;
    propagatedParametersOperationId = null;
    propagatedParametersAbortController = null;
    propagatedParametersRequestId += 1;
    if (operationId) {
        cancelRuntimeSceneOperation(operationId, message);
        return;
    }
    controller?.abort();
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
        earthOrientationPreflight: null,
        earthOrientationProvenance: null,
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
        displayReferenceFrame: context?.displayReferenceFrame ?? context?.referenceFrame ?? null,
        referenceFrame: context?.referenceFrame || null,
        rendererReference: context?.preciseRendering || null
    };
}

function publishManualOrbitErpUploadResult(detail) {
    window.dispatchEvent(new CustomEvent("orbit:manual-orbit-erp-upload-result", { detail }));
}

function isManualErpUploadName(name) {
    return /\.erp(?:\.gz)?$/i.test(String(name || "").trim());
}

/**
 * Submit a File exactly once to the ERP preflight endpoint.  Nothing in this
 * function writes the File/base64 into editor state; on success only the
 * server-issued snapshot provenance is retained.
 */
async function previewManualOrbitErpUpload(detail = {}) {
    const file = detail?.file;
    const name = String(detail?.name || file?.name || "").trim();
    // A replacement/clear/close invalidates every older result. `arrayBuffer`
    // itself cannot be cancelled on every browser, so guard both sides of it
    // with a monotonic request id as well as aborting fetch.
    cancelManualOrbitOperation(manualOrbitErpUploadOperationId, "Validaci\u00f3n ERP sustituida por otro fichero.");
    manualOrbitErpUploadOperationId = null;
    const request = manualOrbitErpUploadGate.begin();
    const { controller } = request;
    const operationId = startManualOrbitOperation("erp", ++manualOrbitErpUploadOperationSequence, {
        title: "Validando ERP manual",
        stage: "Leyendo fichero local",
        message: name ? `Preparando ${name}.` : "Preparando fichero ERP.",
        cancellable: true
    });
    manualOrbitErpUploadOperationId = operationId;
    try {
        if (!file || typeof file.arrayBuffer !== "function") {
            throw new Error("Seleccione un fichero ERP local para validar.");
        }
        if (!isManualErpUploadName(name)) {
            throw new Error("El ERP manual solo admite ficheros .ERP o .ERP.gz.");
        }
        const size = Number(file.size);
        if (!Number.isFinite(size) || size < 1 || size > MAX_MANUAL_ERP_FILE_BYTES) {
            throw new Error("El fichero ERP debe tener entre 1 byte y 32 MiB.");
        }

        const settings = getManualOrbitDesignSettings();
        const sceneContext = {
            sceneWindow: manualOrbitTimeRange(detail.sceneWindow)
                || settings.sceneWindow
                || manualOrbitDesignSession?.sceneTimeContext?.sceneWindow
                || getManualOrbitSceneTimeContext().sceneWindow,
            finiteEphemerisRanges: finiteManualOrbitSceneRanges(detail.finiteEphemerisRanges)
        };
        const designWindow = manualOrbitTimeRange(detail.designWindow) || {
            startTime: settings.epochStartUtc,
            endTime: settings.epochEndUtc
        };
        const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
        if (!request.isCurrent()) return;
        updateManualOrbitOperation(operationId, {
            stage: "Comprobando cobertura y formato",
            message: "Validando el snapshot ERP antes de asociarlo a la \u00f3rbita."
        });
        const response = await fetch("/api/manual-orbits/time/erp-preview", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                manualErp: { name, contentBase64 },
                designWindow,
                sceneWindow: sceneContext.sceneWindow
            }),
            signal: controller.signal
        });
        const responsePayload = await response.json().catch(() => null);
        if (!request.isCurrent()) return;
        if (!response.ok || responsePayload?.ok !== true) {
            throw responsePayload || new Error(`HTTP ${response.status}`);
        }

        const manualErp = normalizeManualOrbitErpReference(
            responsePayload.manualErp ?? responsePayload.manual_erp
        );
        if (!manualErp?.snapshotId) {
            throw new Error("La validación ERP no devolvió una referencia de snapshot reutilizable.");
        }
        const suggestedWindow = manualOrbitTimeRange(
            responsePayload.suggestedDesignWindow ?? responsePayload.suggested_design_window
        ) || {
            startTime: manualErp.coverageStart,
            endTime: manualErp.coverageEnd
        };
        const anchoredPhysicalEpoch = anchorManualOrbitPhysicalEpochToDesignStart(suggestedWindow);
        // The full ERP range is the explicit design range; do not silently
        // trim it to an SP3/OEM scene interval.  The UI policy exposes the
        // intersection separately for future joint operations.
        updateManualOrbitDesignSettings({
            epochUtc: anchoredPhysicalEpoch,
            epochStartUtc: suggestedWindow.startTime,
            epochEndUtc: suggestedWindow.endTime,
            manualErp,
            sceneWindow: sceneContext.sceneWindow,
            finiteEphemerisRanges: sceneContext.finiteEphemerisRanges.length
                ? sceneContext.finiteEphemerisRanges
                : settings.finiteEphemerisRanges,
            sceneAlignment: responsePayload.sceneAlignment ?? responsePayload.scene_alignment ?? null
        });
        // A previous debounced preview can otherwise complete after the
        // replacement and draw samples calculated with the old epoch/ERP.
        // React also receives the authoritative state below, but the runtime
        // must be safe even if the panel remounts during this response.
        if (manualOrbitDesignSession?.active) {
            stopManualOrbitPreviewRequest();
            clearManualOrbitPreview();
            applyManualOrbitDesignTimeWindow();
            scheduleManualOrbitPreview({ immediate: true });
        }
        // Keep the bridge authoritative even if React remounts between the
        // request and its response. The state contains only provenance.
        publishManualOrbitState();
        publishManualOrbitErpUploadResult({
            ok: true,
            manualErp,
            suggestedDesignWindow: suggestedWindow,
            physicalEpochUtc: anchoredPhysicalEpoch,
            anchorPhysicalEpoch: true,
            sceneAlignment: responsePayload.sceneAlignment ?? responsePayload.scene_alignment ?? null,
            message: responsePayload.message
        });
        if (manualOrbitErpUploadOperationId === operationId) {
            manualOrbitErpUploadOperationId = null;
        }
        completeManualOrbitOperation(operationId, "ERP manual validado.");
    } catch (error) {
        if (isExpectedManualOrbitRequestCancellation(error, controller) || !request.isCurrent()) {
            if (manualOrbitErpUploadOperationId === operationId) {
                manualOrbitErpUploadOperationId = null;
                cancelManualOrbitOperation(operationId, "Validaci\u00f3n ERP cancelada.");
            }
            return;
        }
        if (manualOrbitErpUploadOperationId === operationId) {
            manualOrbitErpUploadOperationId = null;
        }
        failManualOrbitOperation(operationId, error);
        logger.warn("No se pudo validar el ERP manual:", error);
        publishManualOrbitErpUploadResult({
            ok: false,
            message: extractManualOrbitError(error, "No se pudo validar el fichero ERP.")
        });
    } finally {
        request.finish();
    }
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
        if (sourceFormat === "SP3" && context?.preciseRendering?.available === false) {
            const nativeFrame = context.preciseRendering.nativeFrame || "el marco nativo";
            const reason = context.preciseRendering.reason ? ` ${context.preciseRendering.reason}` : "";
            throw new Error(`No se pueden calcular parámetros osculantes para este SP3: la representación desde ${nativeFrame} no está disponible.${reason}`);
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
    stopPropagatedParametersRequest("C\u00e1lculo de par\u00e1metros sustituido por una nueva solicitud.");
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
            earthOrientationPreflight: null,
            earthOrientationProvenance: null,
            error: extractManualOrbitError(error, "No se pudieron preparar las efemérides.")
        });
        return;
    }

    propagatedParametersLastContext = context;
    const earthOrientationPreflight = assessAutomaticEarthOrientationPreflight({
        startTime: range.startTime,
        endTime: range.endTime
    });
    const earthOrientationPreflightDetail = earthOrientationCoverageDetail(earthOrientationPreflight);
    const controller = new AbortController();
    propagatedParametersAbortController = controller;
    publishPropagatedParametersInspectorState({
        open: true,
        status: "propagating",
        target,
        range,
        result: null,
        earthOrientationPreflight: earthOrientationPreflightDetail,
        earthOrientationProvenance: null,
        error: ""
    });

    let operationId = null;
    let operationTerminal = false;
    operationId = beginRuntimeSceneOperation("propagated-parameters", {
        title: "Calculando par\u00e1metros propagados",
        stage: "Preparando efem\u00e9rides",
        message: earthOrientationOperationMessage(
            earthOrientationPreflight,
            "El cálculo de parámetros propagados",
            "Calculando el estado orbital para la ventana solicitada."
        ),
        cancelWork: (message) => {
            if (propagatedParametersAbortController === controller) {
                propagatedParametersAbortController = null;
            }
            if (propagatedParametersOperationId === operationId) {
                propagatedParametersOperationId = null;
            }
            propagatedParametersRequestId += 1;
            controller.abort();
            if (!String(message || "").includes("sustituido")) {
                publishPropagatedParametersInspectorState({
                    status: "idle",
                    result: null,
                    earthOrientationPreflight: null,
                    earthOrientationProvenance: null,
                    error: ""
                });
            }
        }
    });
    propagatedParametersOperationId = operationId;

    try {
        const requestPayload = await buildPropagatedParametersRequest(context, range);
        if (requestId !== propagatedParametersRequestId || propagatedParametersInspectorState.open !== true) {
            cancelRuntimeSceneOperation(operationId, "C\u00e1lculo de par\u00e1metros sustituido o cerrado antes de propagarse.");
            operationTerminal = true;
            return;
        }
        advanceRuntimeSceneOperation(operationId, {
            stage: "Propagando ventana solicitada",
            message: earthOrientationOperationMessage(
                earthOrientationPreflight,
                "El cálculo de parámetros propagados",
                "El motor está calculando las efemérides solicitadas."
            ),
            progress: 35
        });
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
            cancelRuntimeSceneOperation(operationId, "C\u00e1lculo de par\u00e1metros sustituido o cerrado antes de completarse.");
            operationTerminal = true;
            return;
        }
        const actualEarthOrientation = actualEarthOrientationAssessment(responsePayload);
        advanceRuntimeSceneOperation(operationId, {
            stage: "Procesando elementos osculantes",
            message: actualEarthOrientation
                ? describeEarthOrientationCoverage(actualEarthOrientation, { operation: "El cálculo de parámetros propagados" })
                : "Preparando los parámetros derivados para la inspección.",
            progress: 85
        });
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
            earthOrientationPreflight: earthOrientationPreflightDetail,
            earthOrientationProvenance: actualEarthOrientation ? earthOrientationCoverageDetail(actualEarthOrientation) : null,
            error: ""
        });
        window.dispatchEvent(new CustomEvent("orbit:propagated-parameters-result", {
            detail: {
                status: "ready",
                target,
                range: resolvedRange,
                result: responsePayload,
                earthOrientationPreflight: earthOrientationPreflightDetail,
                earthOrientationProvenance: actualEarthOrientation ? earthOrientationCoverageDetail(actualEarthOrientation) : null
            }
        }));
        completeRuntimeSceneOperation(
            operationId,
            actualEarthOrientation
                ? describeEarthOrientationCoverage(actualEarthOrientation, { operation: "Parámetros propagados calculados" })
                : "Parámetros propagados calculados."
        );
        operationTerminal = true;
    } catch (error) {
        if (isRuntimeSceneRequestCancellation(error, controller)
            || requestId !== propagatedParametersRequestId
            || propagatedParametersInspectorState.open !== true) {
            cancelRuntimeSceneOperation(operationId, "C\u00e1lculo de par\u00e1metros propagados cancelado.");
            operationTerminal = true;
            return;
        }
        const errorMessage = extractManualOrbitError(error, "No se pudieron calcular las efem\u00e9rides.");
        failRuntimeSceneOperation(operationId, new Error(errorMessage));
        operationTerminal = true;
        publishPropagatedParametersInspectorState({
            status: "error",
            target,
            range,
            result: null,
            earthOrientationPreflight: earthOrientationPreflightDetail,
            earthOrientationProvenance: null,
            error: errorMessage
        });
    } finally {
        if (!operationTerminal && operationId) {
            cancelRuntimeSceneOperation(operationId, "C\u00e1lculo de par\u00e1metros propagados cancelado.");
        }
        if (propagatedParametersAbortController === controller) {
            propagatedParametersAbortController = null;
        }
        if (propagatedParametersOperationId === operationId) {
            propagatedParametersOperationId = null;
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
    window.addEventListener("orbit:propagated-parameters-apply-simulation", async (event) => {
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

        // The inspector is another timeline entry point, not a second scene
        // range.  It therefore uses the exact same expansion/cancel decision
        // as imports and the primary timeline.  Within MTR it preserves the
        // authoritative bounds; outside it never silently substitutes them.
        const applied = await requestMasterTimeRangeFromTimeline(
            new Date(requestedRange.startTime),
            new Date(requestedRange.endTime)
        );
        if (!applied) {
            propagatedParametersRangeError(new Error("No se pudo aplicar el intervalo de simulacion."));
            return;
        }

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
        onError: (error) => {
            logger.error("Could not load system_config.json:", error);
            publishStartupStatus({
                source: "frontend-runtime",
                status: "warning",
                step: {
                    id: "configuration",
                    label: "Comprobando configuración…",
                    status: "warning",
                    message: "No se pudo recuperar la configuración local durante el arranque."
                }
            });
        }
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
    window.addEventListener(DIAGNOSTICS_LOCAL_STATE_REQUEST_EVENT, publishDiagnosticsLocalState);
    window.addEventListener(STARTUP_STATUS_REQUEST_EVENT, () => {
        if (window.__orbitStartupStatus) {
            publishStartupStatus({ ...window.__orbitStartupStatus, replace: true });
        }
    });
    publishDiagnosticsLocalState();
    ensureLeftSidebar();
    publishStartupStatus({
        source: "frontend-runtime",
        step: {
            id: "mtr",
            label: "Inicializando gestor temporal (MTR)…",
            status: "pending"
        }
    });
    setSimulationTimelineProvider(() => ({
        date: getDisplayedSimulationDate(),
        mode: simulationState.mode,
        rangeStart: simulationState.startDate,
        rangeEnd: simulationState.endDate
    }));
    refreshSimulationControlsUi();
    publishStartupStatus({
        source: "frontend-runtime",
        step: {
            id: "mtr",
            label: "Inicializando gestor temporal (MTR)…",
            status: "healthy",
            message: "El gestor temporal local está listo."
        }
    });
    
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
        onToggleObjectLayer: async (id, active) => {
            if (isManualOrbitDesignActive()) return false;
            return setCompositeLayerActiveWithMasterTimeRange(id, active);
        },
        onAddAllLayers: async () => {
            if (isManualOrbitDesignActive()) return false;
            return activateAllSatelliteLayersWithMasterTimeRange();
        },
        onRemoveAllLayers: () => {
            if (isManualOrbitDesignActive()) return false;
            bodyCentricCamera.deactivate();
            setAllSatelliteLayersActive(false);
            reconcileFiniteEphemerisDomainAfterLayerChange();
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
            syncGroundStationVisibilityLinks();
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
            syncGroundStationVisibilityLinks();
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
        onHydrateCatalogEntries: (entries) => hydrateCatalogEntries(entries),
        onRefreshCatalog: async () => {
            const refreshed = await refreshSatelliteCatalog(catalogUrl);
            // A catalogue refresh can replace a TLE while retaining the same
            // layer id. Pass events are source-definition dependent, so do
            // not reuse a forecast from the previous element set.
            invalidateGroundStationTimelineCache();
            return refreshed;
        },
        onRegisterPreciseProductEntries: (entries) => registerPreciseProductSatelliteEntries(entries),
        onApprovePreciseProductTimeDomain: async (entries, payload) => {
            const coverage = resolvePreciseProductCoverage(entries, payload);
            if (!coverage) {
                throw new Error("El producto SP3 no declara una cobertura temporal UTC válida.");
            }
            return approveObjectRangeForMasterTimeRange({
                startTime: coverage.start,
                endTime: coverage.end
            }, {
                objectName: String(payload?.product?.name || payload?.product?.id || "Producto SP3")
            });
        },
        onAlignToPreciseProductTimeDomain: (entries, payload) => alignSimulationToPreciseProductCoverage(entries, payload),
        getLoadedOemTimeBounds: () => getLoadedOemEphemerisTimeBounds(),
        onAlignToOemTimeDomain: () => applyMasterTimeRangeToSimulation({ resetCurrent: true }),
        onImportOemEphemeris: async (content, fileName) => {
            // Parse once into an isolated preview to obtain the intrinsic
            // domain before mutating the scene. The import is cancelled if
            // the operator declines an MTR expansion.
            const preview = parseOemEphemerisContent(content, fileName);
            const first = preview?.points?.[0];
            const last = preview?.points?.at?.(-1);
            const objectRange = { startTime: first?.timeMs, endTime: last?.timeMs };
            const approval = await approveObjectRangeForMasterTimeRange(objectRange, {
                objectName: String(preview?.metadata?.objectName || fileName || "OEM")
            });
            if (!approval.accepted) return null;
            const imported = importOemEphemerisTrack(content, fileName);
            const importedRange = getObjectIntrinsicTimeRange(imported.id);
            if (!importedRange) {
                throw new Error("La ephemeride OEM importada no declaro una cobertura temporal valida.");
            }
            commitObjectRangeToMasterTimeRange(importedRange);
            applyMasterTimeRangeToSimulation({ resetCurrent: true });
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

    // Precise SP3 products live in the Python runtime, not in the paginated
    // TLE catalogue. Their persisted metadata can be comparatively large
    // (one entry per GNSS member), and is optional for opening an empty
    // workspace. Start this only after the project runtime is ready: a slow
    // registry must never keep Welcome visible or queue New project.
    startNonBlockingStartupTask(
        () => hydratePreciseProductSatelliteEntries(),
        {
            // Layers can absorb product metadata after the normal workspace
            // is usable. A late result refreshes the tree without changing
            // the New/Open command path. Saved `precise:` ids are replayed
            // only now, once their real finite coverage is known.
            onFulfilled: (ids) => {
                preciseProductRegistryHydrated = true;
                const hydratedIds = Array.isArray(ids) ? ids : [];
                const deferredRestore = projectLifecycle.restoreDeferredSatelliteLayers();
                const replayed = new Set(deferredRestore.restored);
                // Cover a project opened during this request whose historic
                // id did not need the prefix-based defer path. The same
                // revalidation prevents it from masquerading as a generic
                // live layer once the SP3 metadata appears.
                const activeHydratedIds = hydratedIds.filter((id) => (
                    !replayed.has(id) && isSatelliteLayerActive(id)
                ));
                revalidateRestoredProjectSatelliteLayers(activeHydratedIds, { deferred: true });
                if (deferredRestore.skipped.length) {
                    showAppAlert(
                        "No se restaur\u00f3 un producto SP3 guardado porque ya no est\u00e1 disponible en el registro de productos precisos. Importe su fichero fuente de nuevo.",
                        uiText("alertTitle")
                    );
                }
                objectSidebar?.renderList?.();
                emitObjectStateChanged({ scope: "precise-products", reason: "hydration" });
            },
            onRejected: (error) => {
                // The hydration function already handles endpoint failures;
                // retain this final boundary for future callback failures
                // without allowing optional metadata to affect startup.
                logger.warn("No se pudo aplicar la hidratación diferida de productos precisos:", error);
            }
        }
    );

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
