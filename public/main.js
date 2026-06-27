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
    setSelectedOrbitSatelliteId,
    getSatelliteVisualizationConfig,
    setSatelliteVisualizationConfig,
    clearSatelliteVisualizationConfig,
    clearAllSatelliteVisualizationConfigs
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
    button.title = "Cambiar modo de navegacion de camara";
    button.addEventListener("click", () => {
        const nextMode = cameraNavigationMode === "centered" ? "free" : "centered";
        applyCameraNavigationMode(nextMode);
    });

    document.body.appendChild(button);
    cameraModeToggleBtn = button;
    return button;
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
    button.title = "Iniciar grabacion de la sesion";
    button.addEventListener("click", () => {
        toggleSessionRecording();
    });

    document.body.appendChild(button);
    sessionRecordButton = button;
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

function ensureTimeHudWidget() {
    if (timeHudWidget) {
        return timeHudWidget;
    }

    const root = document.createElement("div");
    root.id = "timeHudWidget";
    root.innerHTML = `
        <div class="time-hud-row"><span class="time-hud-label">Fecha y hora</span><span id="timeHudNow">--/--/---- --:--:--</span></div>
    `;

    document.body.appendChild(root);
    timeHudWidget = root;
    return root;
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
        button.textContent = "Procesando...";
        button.disabled = true;
        button.classList.remove("idle", "recording");
        button.classList.add("processing");
        button.setAttribute("aria-label", "Procesando grabacion de sesion");
        button.title = "Procesando grabacion";
        return;
    }

    button.disabled = false;
    button.classList.remove("processing");

    if (isSessionRecording) {
        button.textContent = "Detener grabacion";
        button.classList.remove("idle");
        button.classList.add("recording");
        button.setAttribute("aria-label", "Grabacion en curso. Pulsar para detener");
        button.title = "Detener grabacion de la sesion";
        return;
    }

    button.textContent = "Grabar sesion";
    button.classList.remove("recording");
    button.classList.add("idle");
    button.setAttribute("aria-label", "Iniciar grabacion de sesion");
    button.title = "Iniciar grabacion de la sesion";
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

function showAppAlert(message, title = "Aviso") {
    return openAppDialog({ title, message, showCancel: false });
}

function showAppConfirm(message, title = "Confirmacion") {
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
    menu.innerHTML = "<button id=\"satCtxVizBtn\" type=\"button\">Opciones de visualizacion</button>";
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
                <h4 id="satelliteVizTitle">Opciones de visualizacion</h4>
                <button id="satelliteVizCloseBtn" type="button" aria-label="Cerrar">✕</button>
            </div>
            <div id="satelliteVizTarget"></div>
            <div id="satelliteVizForm" class="config-grid">
                <div class="config-field"><label for="satVizFutureColor">Future Color</label><input id="satVizFutureColor" type="color"></div>
                <div class="config-field"><label for="satVizPastColor">Past Color</label><input id="satVizPastColor" type="color"></div>
                <div class="config-field"><label for="satVizFutureLineWidth">Future Line Width</label><input id="satVizFutureLineWidth" type="number" step="0.1" min="0.1"></div>
                <div class="config-field"><label for="satVizPastLineWidth">Past Line Width</label><input id="satVizPastLineWidth" type="number" step="0.1" min="0.1"></div>
                <div class="config-field"><label for="satVizPropagationHours">Propagation Hours</label><input id="satVizPropagationHours" type="number" step="0.1" min="0" max="240"></div>
                <div class="config-field"><label for="satVizPastSeconds">Past Duration (s)</label><input id="satVizPastSeconds" type="number" step="0.1" min="0" max="86400"></div>
                <div class="config-field"><label for="satVizLabelSize">Label Size (px)</label><input id="satVizLabelSize" type="number" step="1" min="0"></div>
                <div class="config-field"><label for="satVizModelScale">Model Scale</label><input id="satVizModelScale" type="number" step="1" min="0.000001"></div>
                <div class="config-field checkbox"><input id="satVizUse3D" type="checkbox"><label for="satVizUse3D">Use 3D Model</label></div>
                <div class="config-field"><label for="satVizSizeMode">Size Mode</label><select id="satVizSizeMode"><option value="visual">visual</option><option value="physical">physical</option></select></div>
                <div class="config-field checkbox"><input id="satVizFutureShow" type="checkbox"><label for="satVizFutureShow">Future Show</label></div>
                <div class="config-field checkbox"><input id="satVizPastShow" type="checkbox"><label for="satVizPastShow">Past Show</label></div>
            </div>
            <div id="satelliteVizActions">
                <button id="satelliteVizResetBtn" type="button">Resetear satelite</button>
                <button id="satelliteVizApplyBtn" type="button">Aplicar</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    satelliteVizModal = modal;

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

        const patch = {
            orbit_future_color: modal.querySelector("#satVizFutureColor").value,
            orbit_past_color: modal.querySelector("#satVizPastColor").value,
            orbit_future_line_width: Number(modal.querySelector("#satVizFutureLineWidth").value),
            orbit_past_line_width: Number(modal.querySelector("#satVizPastLineWidth").value),
            propagation_hours: Number(modal.querySelector("#satVizPropagationHours").value),
            orbit_past_seconds: Number(modal.querySelector("#satVizPastSeconds").value),
            satellite_label_size_px: Number(modal.querySelector("#satVizLabelSize").value),
            satellite_model_scale: Number(modal.querySelector("#satVizModelScale").value),
            satellite_use_3d_model: modal.querySelector("#satVizUse3D").checked,
            satellite_size_mode: modal.querySelector("#satVizSizeMode").value,
            orbit_future_show: modal.querySelector("#satVizFutureShow").checked,
            orbit_past_show: modal.querySelector("#satVizPastShow").checked
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
        await showAppAlert("Tu navegador no soporta grabacion de pantalla con MediaRecorder.", "Grabacion no disponible");
        return;
    }

    const canvas = viewer?.scene?.canvas;
    if (!canvas || typeof canvas.captureStream !== "function") {
        await showAppAlert("No se pudo iniciar la grabacion: captureStream no esta disponible.", "Error de grabacion");
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
                showAppAlert("La grabacion termino sin datos para guardar.", "Grabacion vacia");
                return;
            }

            const recordingBlob = new Blob(chunks, { type: mimeType });
            const shouldSave = await showAppConfirm("¿Quieres guardar la sesion?", "Guardar sesion");

            if (shouldSave) {
                downloadSessionRecording(recordingBlob, mimeType);
                logger.info("Grabacion de sesion descargada.");
            } else {
                logger.info("Grabacion de sesion descartada por el usuario.");
            }
        };

        sessionRecorder.onerror = (event) => {
            logger.error("Error en MediaRecorder:", event);
            showAppAlert("Ocurrio un error durante la grabacion de la sesion.", "Error de grabacion");
            resetSessionRecordingState();
        };

        sessionRecorder.start(1000);
        isSessionRecording = true;
        updateSessionRecordButtonLabel();
        logger.info("Grabacion de sesion iniciada.");
    } catch (error) {
        logger.error("No se pudo iniciar la grabacion de sesion:", error);
        const detail = error instanceof Error ? error.message : "No se pudo iniciar la grabacion de la sesion.";
        await showAppAlert(detail, "Error de grabacion");
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
    button.textContent = isFreeMode ? "Navegacion: Libre (WASD)" : "Navegacion: Centrada";
    button.classList.toggle("free", isFreeMode);
    button.classList.toggle("centered", !isFreeMode);
    button.title = isFreeMode
        ? "Modo libre: WASD mueve, Q/E sube-baja, flechas orientan, arrastre izq mira"
        : "Modo centrado: navegacion clasica alrededor del globo";
    button.setAttribute("aria-label", isFreeMode ? "Modo libre activo. Pulsar para volver a modo centrado" : "Modo centrado activo. Pulsar para activar modo libre");
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
    const systemConfig = normalizeSystemConfig(systemConfigRaw);
    runtimeSystemConfig = systemConfig;
    runtimeRecordingConfig = {
        quality: ["low", "medium", "high"].includes(systemConfig.recording_quality)
            ? systemConfig.recording_quality
            : "medium",
        output_format: systemConfig.recording_output_format === "mp4" ? "mp4" : "webm"
    };

    configureLogger(systemConfig);
    setOrbitConfig(systemConfig);
    applyTimeHudVisibilityConfig(systemConfig);

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
ensureCameraModeToggleButton();
applyCameraNavigationMode("centered", { keepTrackedEntity: true });
ensureSessionRecordButton();
updateSessionRecordButtonLabel();
ensureTimeHudWidget();
updateTimeHudWidget();
if (timeHudTimer) {
    clearInterval(timeHudTimer);
}
timeHudTimer = setInterval(updateTimeHudWidget, 1000);

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
        onOpenVisualizationOptions: (id) => {
            if (!id) {
                return;
            }
            openSatelliteVisualizationModal(id);
        },
        isCatalogReady: () => isCatalogLoaded(),
        getObjectTle: (id) => getSatelliteTle(id),
        getObjectTleAsync: (id) => getSatelliteTleAsync(id),
        onRefreshCatalog: () => refreshSatelliteCatalog(catalogUrl)
    });

    const resolvePickedSatelliteId = (picked) => {
        const pickedEntity = picked?.id;
        const directCandidate = pickedEntity?.satelliteId || pickedEntity?.name;

        if (directCandidate && isSatelliteLayerActive(directCandidate) && getSatelliteTelemetry(directCandidate)) {
            return directCandidate;
        }

        const rawId = typeof pickedEntity?.id === "string" ? pickedEntity.id : "";
        if (!rawId) {
            return null;
        }

        const suffixes = ["-orbit", "-trail"];
        for (const suffix of suffixes) {
            if (!rawId.endsWith(suffix)) {
                continue;
            }
            const candidate = rawId.slice(0, -suffix.length);
            if (candidate && isSatelliteLayerActive(candidate) && getSatelliteTelemetry(candidate)) {
                return candidate;
            }
        }

        return null;
    };

    viewer.screenSpaceEventHandler.setInputAction((movement) => {
        const picked = viewer.scene.pick(movement.position);
        const pickedId = resolvePickedSatelliteId(picked);

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
        const pickedId = resolvePickedSatelliteId(picked);

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

    viewer.screenSpaceEventHandler.setInputAction((movement) => {
        const picked = viewer.scene.pick(movement.position);
        const pickedId = resolvePickedSatelliteId(picked);

        if (!pickedId || !isSatelliteLayerActive(pickedId) || !getSatelliteTelemetry(pickedId)) {
            hideSatelliteContextMenu();
            return;
        }

        objectSidebar.selectObject(pickedId);
        setSelectedOrbitSatelliteId(pickedId);

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
            const pickedId = resolvePickedSatelliteId(picked);

            if (!pickedId) {
                hideSatelliteContextMenu();
                return;
            }

            objectSidebar.selectObject(pickedId);
            setSelectedOrbitSatelliteId(pickedId);
            showSatelliteContextMenuAt(pickedId, event.clientX, event.clientY);
        });
    }

    logger.info("Receptor de satélites inicializado.");
})();
