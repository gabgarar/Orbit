import { SatelliteWebSocket } from "./SatelliteWebSocket.js";
import { getLogger } from "./logger.js";

const logger = getLogger("satellites");

// =============================
// Configuración y límites
// =============================
const MAX_WS_CATALOG_IDS_IN_MEMORY = 1000;
const ENTITY_POOL_SIZE = 50;         // Tamaño del object pool
const MIN_INTERPOLATION_MS = 250;
const MAX_INTERPOLATION_MS = 2000;
const INTERPOLATION_HEADROOM = 1.16;
const INTERVAL_SMOOTHING_FACTOR = 0.14;
const POSITION_SMOOTHING_ALPHA = 0.32;
const ORBIT_WIDTH_MODE_VISUAL = "visual";
const ORBIT_WIDTH_MODE_PHYSICAL = "physical";
const ORBIT_PHYSICAL_REF_DISTANCE_M = 1000000;
const ORBIT_PHYSICAL_MIN_FACTOR = 0.2;
const ORBIT_PHYSICAL_MAX_FACTOR = 3.0;
const ORBIT_MIN_PIXEL_WIDTH = 1.6;
const SAT_LABEL_FONT_WEIGHT = 600;
const SAT_LABEL_FONT_FAMILY = "sans-serif";
const SAT_LABEL_FILL_COLOR = "#dfe9f3";
const SAT_LABEL_OUTLINE_COLOR = "#0a0f18";
const SAT_LABEL_OUTLINE_WIDTH = 2;
const SAT_MODEL_URI = "/models/satelliteModel.glb";
const SAT_MODEL_BASE_MIN_PIXEL_SIZE = 12;
const SAT_MODEL_BASE_MAX_SCALE = 50000000;
const SAT_MODEL_MAX_USER_SCALE = 100000000;
const SAT_POINT_PIXEL_SIZE = 5;
const SAT_POINT_OUTLINE_WIDTH = 1;
const DEFAULT_SELECTED_ORBIT_COLOR = "#ff2d2d";
const SELECTED_ORBIT_WIDTH_BOOST_PX = 2;
const PROPAGATION_HOURS_MIN = 0.1;
const PROPAGATION_HOURS_MAX = 240;
const PAST_SECONDS_MIN = 0.1;
const PAST_SECONDS_MAX = 86400;

function createSatelliteModelGraphics() {
    return new Cesium.ModelGraphics({
        uri: SAT_MODEL_URI,
        minimumPixelSize: SAT_MODEL_BASE_MIN_PIXEL_SIZE,
        maximumScale: SAT_MODEL_BASE_MAX_SCALE,
        show: true
    });
}

function createSatelliteEntityOptions() {
    const options = {
        position: new Cesium.Cartesian3(0, 0, 0),
        point: {
            pixelSize: SAT_POINT_PIXEL_SIZE,
            color: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: SAT_POINT_OUTLINE_WIDTH,
            show: false
        },
        label: {
            text: "",
            font: "14px sans-serif",
            fillColor: Cesium.Color.WHITE,
            pixelOffset: new Cesium.Cartesian2(0, -30),
            show: true
        },
        show: false
    };

    if (satelliteUse3DModel) {
        options.orientation = Cesium.Quaternion.IDENTITY;
        options.scale = 1;
        options.model = createSatelliteModelGraphics();
    }

    return options;
}

// =============================
// Object Pool para reutilizar entidades Cesium
// =============================
class EntityPool {
    constructor(viewer, poolSize = ENTITY_POOL_SIZE) {
        this.viewer = viewer;
        this.poolSize = poolSize;
        this.availablePool = [];
        this.activeEntities = new Map();
        this._initializePool();
    }

    _initializePool() {
        // Pre-crear entidades reutilizables
        for (let i = 0; i < this.poolSize; i++) {
            const entity = this.viewer.entities.add(createSatelliteEntityOptions());
            this.availablePool.push(entity);
        }
        logger.info(`Object pool de ${this.poolSize} entidades creado`);
    }

    acquire(id, position, orientation) {
        if (this.activeEntities.has(id)) {
            return this.activeEntities.get(id).entity;
        }

        // Reutilizar de pool si disponible
        let entity;
        if (this.availablePool.length > 0) {
            entity = this.availablePool.pop();
        } else {
            // Si no hay en pool, crear nueva (menos eficiente pero fallback)
            entity = this.viewer.entities.add(createSatelliteEntityOptions());
        }

        // Actualizar estado
        entity.satelliteId = id;  // Usar propiedad personalizada en lugar de id (que es de solo lectura)
        entity.name = id;
        entity.position = position;
        if (satelliteUse3DModel) {
            entity.orientation = orientation;
        }
        applyLabelStyle(entity, id);
        applyVisualStyle(entity);
        entity.show = true;

        this.activeEntities.set(id, {
            entity,
            trailPositions: [position],
            trailEntity: null,
            orbitEntity: null
        });

        logger.debug(`Satélite adquirido: ${id} (activos: ${this.activeEntities.size})`);
        return entity;
    }

    release(id) {
        const state = this.activeEntities.get(id);
        if (!state) return;

        const { entity, trailEntity, orbitEntity } = state;

        // Limpiar polylines
        if (trailEntity) {
            this.viewer.entities.remove(trailEntity);
        }
        if (orbitEntity) {
            this.viewer.entities.remove(orbitEntity);
        }

        // Resetear entidad
        entity.show = false;
        entity.name = "";
        entity.label.text = "";
        entity.position = new Cesium.Cartesian3(0, 0, 0);
        if (entity.point) {
            entity.point.show = false;
        }
        if (entity.model) {
            entity.model.show = false;
        }
        entity.satelliteId = null;

        this.activeEntities.delete(id);
        this.availablePool.push(entity);

        logger.debug(`Satélite liberado: ${id} (activos: ${this.activeEntities.size})`);
    }

    getActive() {
        return Array.from(this.activeEntities.keys());
    }

    getState(id) {
        return this.activeEntities.get(id);
    }

    enforceLimit() {
        // Sin límite artificial: solo se muestran los satélites seleccionados por capa.
    }
}

// =============================
// Variables globales
// =============================
let satelliteEntities = {};
let satelliteState = {};
let entityPool = null;
let currentViewer = null;
const hiddenSatelliteIds = new Set();
const catalogSatelliteIds = new Set();
const activeLayerSatelliteIds = new Set();
const tleBySatelliteId = new Map();
let catalogLoaded = false;
let lastCatalogUrl = "/config/catalog.json";
let cachedSatelliteIds = [];
let satelliteIdsDirty = true;
let cachedActiveLayerIds = [];
let activeLayerIdsDirty = true;
let wsClient = null;
let satelliteLabelSizePx = 14;
let satelliteModelScale = 1.0;
let satelliteUse3DModel = true;
let satelliteSizeMode = "visual";
let lastUpdateTime = Date.now();
let animationFrameId = null;
let sourceFutureOrbitHours = null;
let sourceFutureOrbitSamples = null;
let selectedOrbitSatelliteId = null;
let orbitConfig = {
    orbit_future_show: true,
    orbit_past_show: true,
    orbit_width_mode: ORBIT_WIDTH_MODE_VISUAL,
    orbit_future_line_width: 3,
    orbit_future_color: "#00ff88",
    orbit_selected_color: DEFAULT_SELECTED_ORBIT_COLOR,
    orbit_past_color: "#ff0000",
    orbit_past_seconds: 120,
    orbit_past_line_width: 5,
    propagation_hours: 12,
    websocket_state_interval_seconds: 1.0
};

function applySatelliteVisibility(id, state) {
    if (!state || !state.entity) {
        return true;
    }

    const visible = !hiddenSatelliteIds.has(id);
    state.entity.show = visible;

    if (state.trailEntity) {
        state.trailEntity.show = visible && orbitConfig.orbit_past_show !== false;
    }
    if (state.orbitEntity) {
        state.orbitEntity.show = visible && orbitConfig.orbit_future_show !== false;
    }

    return visible;
}

export function setOrbitConfig(config) {
    const previousPropagationHours = Number(orbitConfig.propagation_hours);
    const previousOrbitFutureShow = orbitConfig.orbit_future_show !== false;

    const nextOrbitConfig = {
        ...orbitConfig,
        ...config
    };

    const requestedHours = Number(nextOrbitConfig.propagation_hours);
    if (Number.isFinite(requestedHours) && requestedHours > 0) {
        nextOrbitConfig.propagation_hours = clamp(requestedHours, PROPAGATION_HOURS_MIN, PROPAGATION_HOURS_MAX);
    }

    const requestedPastSeconds = Number(nextOrbitConfig.orbit_past_seconds);
    if (Number.isFinite(requestedPastSeconds) && requestedPastSeconds > 0) {
        nextOrbitConfig.orbit_past_seconds = clamp(requestedPastSeconds, PAST_SECONDS_MIN, PAST_SECONDS_MAX);
    }

    orbitConfig = nextOrbitConfig;

    const configuredLabelSize = Number(config?.satellite_label_size_px);
    if (Number.isFinite(configuredLabelSize) && configuredLabelSize >= 0) {
        satelliteLabelSizePx = configuredLabelSize;
    } else {
        satelliteLabelSizePx = 14;
    }

    const configuredModelScale = Number(config?.satellite_model_scale);
    if (Number.isFinite(configuredModelScale) && configuredModelScale > 0) {
        satelliteModelScale = configuredModelScale;
    } else {
        satelliteModelScale = 1.0;
    }

    satelliteUse3DModel = config?.satellite_use_3d_model !== false;

    satelliteSizeMode = config?.satellite_size_mode === "physical" ? "physical" : "visual";

    // Reaplicar estilo en entidades activas cuando cambia configuración
    if (entityPool) {
        const activeIds = entityPool.getActive();
        for (const id of activeIds) {
            const state = entityPool.getState(id);
            if (state && state.entity && state.entity.label) {
                applyLabelStyle(state.entity, id);
                applyVisualStyle(state.entity);
                if (satelliteUse3DModel && state.lastOrientation) {
                    state.entity.orientation = state.lastOrientation;
                }
                applySatelliteVisibility(id, state);
            }

            // Si se desactiva estela pasada, limpiar entidades y buffers para ahorrar carga.
            if (state && orbitConfig.orbit_past_show === false) {
                if (state.trailEntity) {
                    entityPool.viewer.entities.remove(state.trailEntity);
                    state.trailEntity = null;
                }
                state.trailPositions = [];
            }

            // Si se desactiva órbita futura, limpiar entidad inmediatamente.
            if (state && orbitConfig.orbit_future_show === false) {
                if (state.orbitEntity) {
                    entityPool.viewer.entities.remove(state.orbitEntity);
                    state.orbitEntity = null;
                }
            }

            // Si hay órbita cacheada, re-renderizar con la nueva configuración local.
            if (
                state
                && orbitConfig.orbit_future_show !== false
                && state.lastOrbitPayload
                && currentViewer
            ) {
                renderFutureOrbitForState(currentViewer, id, state, state.lastOrbitPayload);
            }
        }
    }

    const nextPropagationHours = Number(orbitConfig.propagation_hours);
    const nextOrbitFutureShow = orbitConfig.orbit_future_show !== false;
    const propagationChanged = Number.isFinite(previousPropagationHours)
        && Number.isFinite(nextPropagationHours)
        && Math.abs(previousPropagationHours - nextPropagationHours) > 1e-6;
    const orbitFutureChanged = previousOrbitFutureShow !== nextOrbitFutureShow;

    // Forzar refresh de payloads de órbita en WS para reflejar cambios sin esperar al ciclo natural.
    if ((propagationChanged || orbitFutureChanged) && wsClient) {
        wsClient.setSubscriptions(Array.from(activeLayerSatelliteIds));
    }
}

// =============================
// Interpolación de posiciones (para movimiento suave)
// =============================
function lerp(a, b, t) {
    /**Interpolación lineal entre dos valores*/
    return a + (b - a) * Math.max(0, Math.min(1, t));
}

function lerpCartesian(from, to, t) {
    /**Interpola entre dos Cartesian3*/
    const tt = Math.max(0, Math.min(1, t));
    return new Cesium.Cartesian3(
        lerp(from.x, to.x, tt),
        lerp(from.y, to.y, tt),
        lerp(from.z, to.z, tt)
    );
}

function smoothTrail(positions, smoothness = 2) {
    /**Suaviza un trail usando Catmull-Rom spline*/
    if (positions.length < 2) return positions;
    
    const smoothed = [];
    smoothed.push(positions[0]);
    
    for (let i = 1; i < positions.length; i++) {
        smoothed.push(positions[i]);
        if (i < positions.length - 1) {
            // Agregar puntos intermedios interpolados
            for (let j = 0; j < smoothness - 1; j++) {
                const t = (j + 1) / smoothness;
                smoothed.push(lerpCartesian(positions[i - 1], positions[i], t));
            }
        }
    }
    
    return smoothed;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function computeInterpolationDuration(state, now) {
    const fallbackInterval = state.interpolationDuration || 900;
    const rawInterval = state.lastMessageTime ? now - state.lastMessageTime : fallbackInterval;
    const validInterval = Number.isFinite(rawInterval) && rawInterval > 0 ? rawInterval : fallbackInterval;

    const previousSmoothed = state.smoothedMessageInterval || validInterval;
    const smoothedInterval = lerp(previousSmoothed, validInterval, INTERVAL_SMOOTHING_FACTOR);

    state.smoothedMessageInterval = smoothedInterval;

    return clamp(
        smoothedInterval * INTERPOLATION_HEADROOM,
        MIN_INTERPOLATION_MS,
        MAX_INTERPOLATION_MS
    );
}

function applyLabelStyle(entity, id) {
    const labelVisible = satelliteLabelSizePx > 0;
    const labelSize = Math.max(1, Math.floor(satelliteLabelSizePx));

    entity.label.text = id || "";
    entity.label.font = `${SAT_LABEL_FONT_WEIGHT} ${labelSize}px ${SAT_LABEL_FONT_FAMILY}`;
    entity.label.fillColor = Cesium.Color.fromCssColorString(SAT_LABEL_FILL_COLOR);
    entity.label.outlineColor = Cesium.Color.fromCssColorString(SAT_LABEL_OUTLINE_COLOR);
    entity.label.outlineWidth = SAT_LABEL_OUTLINE_WIDTH;
    entity.label.style = Cesium.LabelStyle.FILL_AND_OUTLINE;
    entity.label.show = labelVisible;
}

function applyVisualStyle(entity) {
    if (!entity) {
        return;
    }

    if (entity.point) {
        entity.point.pixelSize = SAT_POINT_PIXEL_SIZE;
        entity.point.color = Cesium.Color.WHITE;
        entity.point.outlineColor = Cesium.Color.BLACK;
        entity.point.outlineWidth = SAT_POINT_OUTLINE_WIDTH;
        entity.point.show = !satelliteUse3DModel;
    }

    if (!satelliteUse3DModel) {
        if (entity.model) {
            delete entity.model;
        }
        entity.orientation = undefined;
        return;
    }

    entity.model = createSatelliteModelGraphics();
    entity.model.show = true;

    const safeScale = Math.max(0.000001, Math.min(SAT_MODEL_MAX_USER_SCALE, satelliteModelScale));
    entity.model.scale = safeScale;

    const minimumPixelSize = satelliteSizeMode === "physical"
        ? 1
        : Math.max(1, Math.floor(SAT_MODEL_BASE_MIN_PIXEL_SIZE * safeScale));

    entity.model.minimumPixelSize = minimumPixelSize;
    entity.model.maximumScale = SAT_MODEL_BASE_MAX_SCALE * safeScale;
}

function getFutureSampleStepSeconds() {
    const safeHours = Number.isFinite(sourceFutureOrbitHours) && sourceFutureOrbitHours > 0
        ? sourceFutureOrbitHours
        : (Number.isFinite(Number(orbitConfig.propagation_hours)) && Number(orbitConfig.propagation_hours) > 0
            ? Number(orbitConfig.propagation_hours)
            : 12);
    const safeSamples = Number.isFinite(sourceFutureOrbitSamples) && sourceFutureOrbitSamples > 1
        ? Math.floor(sourceFutureOrbitSamples)
        : 120;
    return (safeHours * 3600) / (safeSamples - 1);
}

function getPastSampleStepSeconds() {
    const stateInterval = Number(orbitConfig.websocket_state_interval_seconds);
    return Number.isFinite(stateInterval) && stateInterval > 0 ? stateInterval : 1.0;
}

function getPastTrailMaxPoints() {
    const pastSecondsRaw = Number(orbitConfig.orbit_past_seconds);
    const pastSeconds = Number.isFinite(pastSecondsRaw) && pastSecondsRaw > 0
        ? pastSecondsRaw
        : 120;
    const stepSeconds = getPastSampleStepSeconds();
    return Math.max(2, Math.floor(pastSeconds / stepSeconds) + 1);
}

function getHiddenPastSamples() {
    return 0;
}

function getHiddenFutureSamples() {
    return 0;
}

function trimTrailNearSatellite(positions, hideSamples) {
    if (!Array.isArray(positions) || positions.length < 2 || hideSamples <= 0) {
        return positions;
    }

    const maxSpan = positions.length - 1;
    if (hideSamples >= maxSpan) {
        return [];
    }

    const whole = Math.floor(hideSamples);
    const frac = hideSamples - whole;
    const boundaryIndex = positions.length - 1 - whole;

    if (frac <= 0 || boundaryIndex <= 0) {
        return positions.slice(0, boundaryIndex + 1);
    }

    const olderIndex = boundaryIndex - 1;
    const olderPoint = positions[olderIndex];
    const newerPoint = positions[boundaryIndex];
    const cutPoint = lerpCartesian(newerPoint, olderPoint, frac);

    const trimmed = positions.slice(0, olderIndex + 1);
    trimmed.push(cutPoint);
    return trimmed;
}

function trimOrbitNearSatellite(orbitPoints, hideSamples) {
    if (!Array.isArray(orbitPoints) || orbitPoints.length < 2 || hideSamples <= 0) {
        return orbitPoints;
    }

    const maxSpan = orbitPoints.length - 1;
    if (hideSamples >= maxSpan) {
        return [];
    }

    const whole = Math.floor(hideSamples);
    const frac = hideSamples - whole;

    if (frac <= 0) {
        return orbitPoints.slice(whole);
    }

    const from = orbitPoints[whole];
    const to = orbitPoints[whole + 1];
    const startPoint = {
        x: lerp(from.x, to.x, frac),
        y: lerp(from.y, to.y, frac),
        z: lerp(from.z, to.z, frac)
    };

    const trimmed = [startPoint];
    trimmed.push(...orbitPoints.slice(whole + 1));
    return trimmed;
}

export function initSatelliteReceiver(viewer) {
    currentViewer = viewer;
    // Inicializar object pool
    entityPool = new EntityPool(viewer, ENTITY_POOL_SIZE);

    // Iniciar loop de interpolación suave
    startSmoothUpdate(viewer);

    const ws = new SatelliteWebSocket((message) => {
        if (Array.isArray(message)) {
            message.forEach((s) => updateSatelliteState(viewer, s));
            return;
        }

        if (message && message.type === "state") {
            const payload = Array.isArray(message.data) ? message.data : [];
            payload.forEach((s) => updateSatelliteState(viewer, s));
            // Aplicar límite de memoria
            entityPool.enforceLimit();
            return;
        }

        if (message && message.type === "orbits") {
            const payload = Array.isArray(message.data) ? message.data : [];
            payload.forEach((s) => updateSatelliteOrbit(viewer, s));
            return;
        }

        if (message && message.satellite) {
            updateSatelliteState(viewer, message);
            updateSatelliteOrbit(viewer, message);
        }
    });

    ws.onCatalog((catalog) => {
        catalogSatelliteIds.clear();
        let loaded = 0;
        for (const id of catalog) {
            if (typeof id === "string") {
                catalogSatelliteIds.add(id);
                loaded += 1;
                if (loaded >= MAX_WS_CATALOG_IDS_IN_MEMORY) {
                    break;
                }
            }
        }
        catalogLoaded = true;
        satelliteIdsDirty = true;
    });

    wsClient = ws;

    ws.connect();
}

// =============================
// Loop de actualización suave (interpolación)
// =============================
function startSmoothUpdate(viewer) {
    /**Anima las posiciones de satélites entre updates del servidor*/
    function smoothUpdateFrame() {
        const now = Date.now();
        
        for (const id in satelliteState) {
            const state = satelliteState[id];
            if (!state.entity || !state.entity.show) continue;
            
            // Calcular progreso de interpolación (0 a 1)
            const elapsed = now - state.lastUpdateTime;
            const progress = Math.min(elapsed / state.interpolationDuration, 1.0);
            
            // Interpolar posición
            if (progress < 1.0 && state.previousPosition && state.targetPosition) {
                const interpolated = lerpCartesian(
                    state.previousPosition,
                    state.targetPosition,
                    progress
                );

                if (!state.renderPosition) {
                    state.renderPosition = interpolated;
                } else {
                    state.renderPosition = lerpCartesian(
                        state.renderPosition,
                        interpolated,
                        POSITION_SMOOTHING_ALPHA
                    );
                }

                state.entity.position = state.renderPosition;
            } else if (progress >= 1.0 && state.targetPosition) {
                // Completar la interpolación sin introducir salto visual
                if (!state.renderPosition) {
                    state.renderPosition = state.targetPosition;
                } else {
                    state.renderPosition = lerpCartesian(
                        state.renderPosition,
                        state.targetPosition,
                        POSITION_SMOOTHING_ALPHA
                    );
                }

                state.entity.position = state.renderPosition;
            }
        }
        
        animationFrameId = requestAnimationFrame(smoothUpdateFrame);
    }
    
    smoothUpdateFrame();
}

function calculateOrientation(position, velocity) {
    /**
     * Calcula la orientación (quaternión) del satélite basado en posición y velocidad
     * Usa un sistema de referencia orbital (SRF):
     * - Z apunta hacia el centro de la Tierra (posición negativa)
     * - X apunta en la dirección del movimiento (velocidad)
     * - Y es el producto cruzado
     */
    
    const posVec = new Cesium.Cartesian3(position.x, position.y, position.z);
    const velVec = new Cesium.Cartesian3(velocity.x, velocity.y, velocity.z);
    
    const zAxis = Cesium.Cartesian3.normalize(Cesium.Cartesian3.negate(posVec, new Cesium.Cartesian3()), new Cesium.Cartesian3());
    const xAxis = Cesium.Cartesian3.normalize(velVec, new Cesium.Cartesian3());
    
    const yAxis = Cesium.Cartesian3.cross(zAxis, xAxis, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(yAxis, yAxis);
    
    const xAxisFinal = Cesium.Cartesian3.cross(yAxis, zAxis, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(xAxisFinal, xAxisFinal);
    
    const matrix = new Cesium.Matrix3(
        xAxisFinal.x, yAxis.x, zAxis.x,
        xAxisFinal.y, yAxis.y, zAxis.y,
        xAxisFinal.z, yAxis.z, zAxis.z
    );
    
    return Cesium.Quaternion.fromRotationMatrix(matrix);
}

function toCartesianArray(points) {
    return points.map((position) => new Cesium.Cartesian3(position.x, position.y, position.z));
}

function getColor(colorString, defaultColor) {
    try {
        return Cesium.Color.fromCssColorString(colorString || defaultColor);
    } catch (e) {
        return Cesium.Color.fromCssColorString(defaultColor);
    }
}

function getOpaqueColor(colorString, defaultColor) {
    return getColor(colorString, defaultColor).withAlpha(1.0);
}

function computeOrbitWidth(viewer, baseWidth, referencePosition) {
    const safeBase = Number.isFinite(baseWidth) && baseWidth > 0 ? baseWidth : 1;
    if (orbitConfig.orbit_width_mode !== ORBIT_WIDTH_MODE_PHYSICAL) {
        return Math.max(ORBIT_MIN_PIXEL_WIDTH, safeBase);
    }

    if (!viewer?.camera?.positionWC || !referencePosition) {
        return safeBase;
    }

    const distance = Cesium.Cartesian3.distance(viewer.camera.positionWC, referencePosition);
    if (!Number.isFinite(distance) || distance <= 0) {
        return safeBase;
    }

    const factor = Math.max(
        ORBIT_PHYSICAL_MIN_FACTOR,
        Math.min(ORBIT_PHYSICAL_MAX_FACTOR, ORBIT_PHYSICAL_REF_DISTANCE_M / distance)
    );
    return Math.max(ORBIT_MIN_PIXEL_WIDTH, safeBase * factor);
}

function createOrbitMaterial(color) {
    return new Cesium.ColorMaterialProperty(color);
}

function getFutureOrbitColor(id) {
    if (selectedOrbitSatelliteId && id === selectedOrbitSatelliteId) {
        return getOpaqueColor(orbitConfig.orbit_selected_color, DEFAULT_SELECTED_ORBIT_COLOR);
    }
    return getOpaqueColor(orbitConfig.orbit_future_color, "#00ff88");
}

function getFutureOrbitRenderWidth(id, baseWidth) {
    const safeBaseWidth = Number.isFinite(baseWidth) ? baseWidth : ORBIT_MIN_PIXEL_WIDTH;
    if (selectedOrbitSatelliteId && id === selectedOrbitSatelliteId) {
        return safeBaseWidth + SELECTED_ORBIT_WIDTH_BOOST_PX;
    }
    return safeBaseWidth;
}

export function setSelectedOrbitSatelliteId(id) {
    selectedOrbitSatelliteId = id ? String(id) : null;

    for (const [satId, state] of Object.entries(satelliteState)) {
        if (!state?.orbitEntity?.polyline) {
            continue;
        }

        const orbitColor = getFutureOrbitColor(satId);
        state.orbitEntity.polyline.material = createOrbitMaterial(orbitColor);
        const baseWidth = Number.isFinite(state.orbitBaseWidth)
            ? state.orbitBaseWidth
            : Number(state.orbitEntity.polyline.width) || ORBIT_MIN_PIXEL_WIDTH;
        state.orbitEntity.polyline.width = getFutureOrbitRenderWidth(satId, baseWidth);
    }
}

function createOrbitEntity(viewer, id, positions, color, width) {
    try {
        logger.debug(`createOrbitEntity: id=${id} points=${Array.isArray(positions)?positions.length:0} width=${width}`);
    } catch (e) {
        // ignore logging errors
    }
    return viewer.entities.add({
        id: `${id}-orbit`,
        polyline: {
            positions,
            width,
            material: createOrbitMaterial(color),
            clampToGround: false
        }
    });
}

function clipFutureOrbitByRequestedHorizon(orbit) {
    if (!Array.isArray(orbit) || orbit.length < 2) {
        return orbit;
    }

    const sourceHours = Number.isFinite(sourceFutureOrbitHours) && sourceFutureOrbitHours > 0
        ? sourceFutureOrbitHours
        : 0;
    const requestedHoursRaw = Number(orbitConfig.propagation_hours);
    const requestedHours = Number.isFinite(requestedHoursRaw) && requestedHoursRaw > 0
        ? requestedHoursRaw
        : sourceHours;

    if (!(sourceHours > 0) || !(requestedHours > 0) || requestedHours >= sourceHours) {
        return orbit;
    }

    const ratio = clamp(requestedHours / sourceHours, 0.01, 1);
    const clippedCount = Math.max(2, Math.floor((orbit.length - 1) * ratio) + 1);
    return orbit.slice(0, clippedCount);
}

function createTrailEntity(viewer, id, positions, color, width) {
    return viewer.entities.add({
        id: `${id}-trail`,
        polyline: {
            positions,
            width,
            material: createOrbitMaterial(color),
            depthFailMaterial: createOrbitMaterial(color),
            clampToGround: false
        }
    });
}

function ensureSatelliteState(viewer, id, cart, orientation) {
    // Usar object pool para reutilizar entidades
    const poolState = entityPool.getState(id);
    const now = Date.now();
    
    if (poolState) {
        // Unificar referencia de estado para que interpolación y trail usen el mismo objeto
        const state = satelliteState[id] || poolState;
        satelliteState[id] = state;
        state.entity = poolState.entity;
        state.trailPositions = poolState.trailPositions;
        state.trailEntity = poolState.trailEntity;
        state.orbitEntity = poolState.orbitEntity;
        
        // Guardar posición anterior para interpolación
        state.previousPosition = state.targetPosition || state.entity.position;
        state.targetPosition = cart;
        state.lastOrientation = orientation;
        state.interpolationDuration = computeInterpolationDuration(state, now);
        state.lastUpdateTime = now;
        state.lastMessageTime = now;
        
        if (orbitConfig.orbit_past_show !== false) {
            state.trailPositions.push(cart);
            const maxTrailPoints = getPastTrailMaxPoints();
            if (state.trailPositions.length > maxTrailPoints) {
                state.trailPositions.shift();
            }
        } else {
            state.trailPositions = [];
        }
        return state;
    }

    // Crear nuevo en pool
    const entity = entityPool.acquire(id, cart, orientation);
    const state = entityPool.getState(id) || { entity, trailPositions: [cart], trailEntity: null, orbitEntity: null };
    state.entity = entity;
    state.previousPosition = cart;
    state.targetPosition = cart;
    state.lastOrientation = orientation;
    state.lastUpdateTime = now;
    state.lastMessageTime = now;
    state.interpolationDuration = 900;
    state.smoothedMessageInterval = 900;
    state.renderPosition = cart;
    
    satelliteState[id] = state;
    satelliteEntities[id] = entity;
    return state;
}

function updateSatelliteState(viewer, satData) {
    const id = satData.satellite || "UNKNOWN";

    try {
        logger.debug(`updateSatelliteState: id=${id} active=${activeLayerSatelliteIds.has(id)} hidden=${hiddenSatelliteIds.has(id)} hasPos=${Boolean(satData.position)}`);
    } catch (e) {
        // ignore
    }

    // Si la capa no está activa, ignorar updates de estado para evitar recrear entidades.
    if (!activeLayerSatelliteIds.has(id)) {
        return;
    }
    const isNewSatellite = !satelliteState[id];

    // Si el satélite está oculto, ignorar por completo updates para ahorrar CPU.
    if (hiddenSatelliteIds.has(id)) {
        return;
    }

    const pos = satData.position;
    const vel = satData.velocity || { x: 0, y: 0, z: 0 };

    if (!pos) {
        return;
    }

    const cart = new Cesium.Cartesian3(pos.x, pos.y, pos.z);
    const orientation = satelliteUse3DModel ? calculateOrientation(pos, vel) : undefined;

    const state = ensureSatelliteState(viewer, id, cart, orientation);
    if (isNewSatellite) {
        satelliteIdsDirty = true;
    }
    state.lastVelocity = {
        x: Number(vel.x) || 0,
        y: Number(vel.y) || 0,
        z: Number(vel.z) || 0
    };

    const isVisible = applySatelliteVisibility(id, state);

    // No actualizar posición directamente; dejar que la interpolación la actualice
    // state.entity.position se actualiza en smoothUpdate()
    if (satelliteUse3DModel) {
        state.entity.orientation = orientation;
        state.lastOrientation = orientation;
    }

    if (!isVisible) {
        return;
    }

    if (orbitConfig.orbit_past_show === false) {
        if (state.trailEntity) {
            viewer.entities.remove(state.trailEntity);
            state.trailEntity = null;
        }
        state.trailPositions = [];
        return;
    }

    if (state.trailPositions.length > 1) {
        const hiddenPastSamples = getHiddenPastSamples();
        const visibleTrail = trimTrailNearSatellite(state.trailPositions, hiddenPastSamples);

        if (visibleTrail.length < 2) {
            if (state.trailEntity) {
                viewer.entities.remove(state.trailEntity);
                state.trailEntity = null;
            }
            return;
        }

        const trailColor = getOpaqueColor(orbitConfig.orbit_past_color, "#ff0000");
        const trailWidth = computeOrbitWidth(viewer, orbitConfig.orbit_past_line_width, state.entity.position);
        if (!state.trailEntity) {
            state.trailEntity = createTrailEntity(
                viewer,
                id,
                visibleTrail,
                trailColor,
                trailWidth
            );
        } else {
            // Suavizar trail antes de actualizar
            const smoothedTrail = smoothTrail(visibleTrail, 1);
            state.trailEntity.polyline.positions = smoothedTrail;
            state.trailEntity.polyline.material = createOrbitMaterial(trailColor);
            state.trailEntity.polyline.width = trailWidth;
        }
    }
}

export function getSatelliteIds() {
    if (satelliteIdsDirty) {
        const merged = new Set([...catalogSatelliteIds, ...Object.keys(satelliteState)]);
        cachedSatelliteIds = Array.from(merged).sort();
        satelliteIdsDirty = false;
    }

    return cachedSatelliteIds;
}

export function getActiveSatelliteLayerIds() {
    if (activeLayerIdsDirty) {
        cachedActiveLayerIds = Array.from(activeLayerSatelliteIds).sort();
        activeLayerIdsDirty = false;
    }

    return cachedActiveLayerIds;
}

export function isCatalogLoaded() {
    return catalogLoaded;
}

export async function fetchCatalogPage({
    offset = 0,
    limit = 200,
    search = "",
    orbitKind = "",
    mission = ""
} = {}) {
    const safeOffset = Math.max(0, Number.parseInt(String(offset), 10) || 0);
    const safeLimit = Math.max(1, Math.min(1000, Number.parseInt(String(limit), 10) || 200));

    const params = new URLSearchParams({
        offset: String(safeOffset),
        limit: String(safeLimit)
    });

    const normalizedSearch = String(search || "").trim();
    const normalizedOrbit = String(orbitKind || "").trim().toLowerCase();
    const normalizedMission = String(mission || "").trim().toLowerCase();

    if (normalizedSearch) params.set("search", normalizedSearch);
    if (normalizedOrbit) params.set("orbitKind", normalizedOrbit);
    if (normalizedMission) params.set("mission", normalizedMission);

    const response = await fetch(`/api/catalog/page?${params.toString()}`, { cache: "no-cache" });
    if (!response.ok) {
        throw new Error(`No se pudo cargar página de catálogo (HTTP ${response.status})`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const ids = [];

    for (const item of items) {
        const name = String(item?.name || "").trim();
        const line1 = String(item?.line1 || "").trim();
        const line2 = String(item?.line2 || "").trim();
        if (!name) {
            continue;
        }

        ids.push(name);
        catalogSatelliteIds.add(name);
        if (line1 && line2) {
            tleBySatelliteId.set(name, { line1, line2 });
        }
    }

    if (ids.length) {
        satelliteIdsDirty = true;
    }

    const total = Number(payload?.total) || 0;
    if (total > 0) {
        catalogLoaded = true;
    }

    return {
        ids,
        total,
        offset: Number(payload?.offset) || safeOffset,
        limit: Number(payload?.limit) || safeLimit,
        hasMore: Boolean(payload?.hasMore)
    };
}

export async function preloadSatelliteCatalog(catalogUrl = "/config/catalog.json") {
    try {
        lastCatalogUrl = catalogUrl || lastCatalogUrl;
        const page = await fetchCatalogPage({ offset: 0, limit: 200 });
        logger.info(`Catalogo precargado (modo paginado): ${page.ids.length}/${page.total} objetos`);
        return catalogLoaded;
    } catch (error) {
        logger.warn("Error precargando catalogo:", error);
        return false;
    }
}

export async function refreshSatelliteCatalog(catalogUrl = "/config/catalog.json") {
    // Actualiza la URL del catálogo y lo recarga. También reaplica subscripciones WS actuales.
    lastCatalogUrl = catalogUrl || lastCatalogUrl;
    catalogSatelliteIds.clear();
    tleBySatelliteId.clear();
    satelliteIdsDirty = true;
    catalogLoaded = false;
    const ok = await preloadSatelliteCatalog(lastCatalogUrl);

    try {
        if (wsClient && typeof wsClient.setSubscriptions === "function") {
            const ids = Array.from(activeLayerSatelliteIds);
            if (ids.length) {
                wsClient.setSubscriptions(ids);
            }
        }
    } catch (e) {
        logger.warn("No se pudo reaplicar subscripciones WS tras refrescar el catálogo:", e);
    }

    return ok;
}

export function getSatelliteEntity(id) {
    const state = satelliteState[id];
    return state?.entity || null;
}

export function getSatelliteTle(id) {
    if (!id) {
        return null;
    }
    return tleBySatelliteId.get(id) || null;
}

export async function getSatelliteTleAsync(id) {
    if (!id) {
        return null;
    }

    const cached = tleBySatelliteId.get(id);
    if (cached) {
        return cached;
    }

    try {
        const response = await fetch(`/api/catalog/tle?name=${encodeURIComponent(id)}`, { cache: "no-cache" });
        if (!response.ok) {
            return null;
        }

        const payload = await response.json();
        const item = payload?.item;
        const name = String(item?.name || "").trim();
        const line1 = String(item?.line1 || "").trim();
        const line2 = String(item?.line2 || "").trim();

        if (!name || !line1 || !line2) {
            return null;
        }

        const tle = { line1, line2 };
        tleBySatelliteId.set(name, tle);
        catalogSatelliteIds.add(name);
        satelliteIdsDirty = true;
        catalogLoaded = true;
        return tle;
    } catch (error) {
        logger.warn(`No se pudo obtener TLE para ${id}:`, error);
        return null;
    }
}

export function getSatelliteTelemetry(id) {
    const state = satelliteState[id];
    if (!state || !state.entity) {
        return null;
    }

    const position = state.renderPosition || state.targetPosition || state.entity.position;
    if (!position) {
        return null;
    }

    const velocity = state.lastVelocity || { x: 0, y: 0, z: 0 };
    const speed = Math.sqrt(
        velocity.x * velocity.x +
        velocity.y * velocity.y +
        velocity.z * velocity.z
    );

    const cartographic = Cesium.Cartographic.fromCartesian(position);
    const latitudeDeg = cartographic ? Cesium.Math.toDegrees(cartographic.latitude) : null;
    const longitudeDeg = cartographic ? Cesium.Math.toDegrees(cartographic.longitude) : null;
    const altitudeM = cartographic ? cartographic.height : null;

    let distanceToCameraM = null;
    if (currentViewer?.camera?.positionWC) {
        distanceToCameraM = Cesium.Cartesian3.distance(currentViewer.camera.positionWC, position);
    }

    const speedKmS = speed / 1000;
    const speedKmH = speed * 3.6;
    const telemetryAgeMs = Date.now() - (state.lastMessageTime || Date.now());

    return {
        id,
        position: {
            x: Number(position.x) || 0,
            y: Number(position.y) || 0,
            z: Number(position.z) || 0
        },
        geo: {
            latitude_deg: latitudeDeg,
            longitude_deg: longitudeDeg,
            altitude_m: altitudeM
        },
        velocity,
        speed_m_s: speed,
        speed_km_s: speedKmS,
        speed_km_h: speedKmH,
        distance_to_camera_m: distanceToCameraM,
        trail_points: state.trailPositions?.length || 0,
        has_future_orbit: Boolean(state.orbitEntity),
        is_visible: !hiddenSatelliteIds.has(id),
        telemetry_age_ms: telemetryAgeMs,
        timestamp_ms: Date.now()
    };
}

export function isSatelliteVisible(id) {
    return !hiddenSatelliteIds.has(id);
}

export function isSatelliteLayerActive(id) {
    return activeLayerSatelliteIds.has(id);
}

export function setSatelliteLayerActive(id, active) {
    if (!id) {
        return;
    }

    if (active) {
        activeLayerSatelliteIds.add(id);
        activeLayerIdsDirty = true;
        wsClient?.subscribe([id]);
    } else {
        activeLayerSatelliteIds.delete(id);
        activeLayerIdsDirty = true;
        wsClient?.unsubscribe([id]);

        // Al quitar capa, ocultar y liberar recursos render de ese objeto.
        const state = satelliteState[id];
        if (state) {
            if (state.trailEntity && currentViewer) {
                currentViewer.entities.remove(state.trailEntity);
            }
            if (state.orbitEntity && currentViewer) {
                currentViewer.entities.remove(state.orbitEntity);
            }
            if (state.entity) {
                state.entity.show = false;
            }
        }
    }
}

export function setAllSatelliteLayersActive(active) {
    const ids = getSatelliteIds();
    if (!ids.length) {
        return;
    }

    if (active) {
        activeLayerSatelliteIds.clear();
        ids.forEach((id) => activeLayerSatelliteIds.add(id));
        activeLayerIdsDirty = true;
        wsClient?.setSubscriptions(ids);
        return;
    }

    activeLayerSatelliteIds.clear();
    activeLayerIdsDirty = true;
    wsClient?.setSubscriptions([]);

    for (const id of ids) {
        const state = satelliteState[id];
        if (!state) {
            continue;
        }

        if (state.trailEntity && currentViewer) {
            currentViewer.entities.remove(state.trailEntity);
            state.trailEntity = null;
        }
        if (state.orbitEntity && currentViewer) {
            currentViewer.entities.remove(state.orbitEntity);
            state.orbitEntity = null;
        }
        if (state.entity) {
            state.entity.show = false;
        }
    }
}

export function setAllSatellitesVisible(visible) {
    const ids = new Set([...activeLayerSatelliteIds, ...Object.keys(satelliteState)]);
    if (!ids.size) {
        return;
    }

    if (visible) {
        hiddenSatelliteIds.clear();
    } else {
        for (const id of ids) {
            hiddenSatelliteIds.add(id);
        }
    }

    for (const id of ids) {
        const state = satelliteState[id] || entityPool?.getState(id);
        if (state) {
            applySatelliteVisibility(id, state);
        }
    }
}

export function setSatelliteVisible(id, visible) {
    if (!id) {
        return;
    }

    if (visible) {
        hiddenSatelliteIds.delete(id);
    } else {
        hiddenSatelliteIds.add(id);
    }

    const state = satelliteState[id] || entityPool?.getState(id);
    if (state) {
        applySatelliteVisibility(id, state);
    }
}

function renderFutureOrbitForState(viewer, id, state, orbitPayload) {
    if (!viewer || !state) {
        return;
    }

    if (!orbitConfig.orbit_future_show || !activeLayerSatelliteIds.has(id) || hiddenSatelliteIds.has(id)) {
        if (state.orbitEntity) {
            viewer.entities.remove(state.orbitEntity);
            state.orbitEntity = null;
        }
        return;
    }

    const orbit = orbitPayload?.orbit;
    if (!Array.isArray(orbit) || orbit.length < 2) {
        if (state.orbitEntity) {
            viewer.entities.remove(state.orbitEntity);
            state.orbitEntity = null;
        }
        return;
    }

    const announcedHours = Number(orbitPayload?.orbit_horizon_hours);
    if (Number.isFinite(announcedHours) && announcedHours > 0) {
        sourceFutureOrbitHours = announcedHours;
    } else {
        const fallbackHours = Number(orbitConfig.propagation_hours);
        sourceFutureOrbitHours = Number.isFinite(fallbackHours) && fallbackHours > 0 ? fallbackHours : 12;
    }

    const announcedSamples = Number(orbitPayload?.orbit_samples);
    sourceFutureOrbitSamples = Number.isFinite(announcedSamples) && announcedSamples > 1
        ? Math.floor(announcedSamples)
        : orbit.length;

    const horizonClippedOrbit = clipFutureOrbitByRequestedHorizon(orbit);
    const hiddenFutureSamples = getHiddenFutureSamples();
    const visibleOrbit = trimOrbitNearSatellite(horizonClippedOrbit, hiddenFutureSamples);

    if (visibleOrbit.length < 2) {
        if (state.orbitEntity) {
            viewer.entities.remove(state.orbitEntity);
            state.orbitEntity = null;
        }
        return;
    }

    const orbitPositions = toCartesianArray(visibleOrbit);
    const smoothedOrbit = smoothTrail(orbitPositions, 1);
    const futureColor = getFutureOrbitColor(id);
    const referencePosition = state.entity?.position || orbitPositions[0];
    const futureWidthBase = computeOrbitWidth(viewer, orbitConfig.orbit_future_line_width, referencePosition);
    state.orbitBaseWidth = futureWidthBase;
    const futureWidth = getFutureOrbitRenderWidth(id, futureWidthBase);

    if (!state.orbitEntity) {
        state.orbitEntity = createOrbitEntity(viewer, id, smoothedOrbit, futureColor, futureWidth);
    } else {
        state.orbitEntity.polyline.positions = smoothedOrbit;
        state.orbitEntity.polyline.material = createOrbitMaterial(futureColor);
        state.orbitEntity.polyline.width = futureWidth;
        state.orbitEntity.show = true;
    }
}

function updateSatelliteOrbit(viewer, satData) {
    const id = satData.satellite || "UNKNOWN";

    // Nunca dibujar órbitas de satélites sin capa activa.
    if (!activeLayerSatelliteIds.has(id)) {
        return;
    }

    // Si el satélite está oculto, ignorar también su órbita futura.
    if (hiddenSatelliteIds.has(id)) {
        return;
    }

    const state = satelliteState[id];
    if (!state) {
        return;
    }

    const orbit = satData.orbit;
    state.lastOrbitPayload = {
        orbit,
        orbit_horizon_hours: satData?.orbit_horizon_hours,
        orbit_samples: satData?.orbit_samples
    };

    if (!Array.isArray(orbit) || orbit.length < 2) {
        return;
    }

    if (!applySatelliteVisibility(id, state)) {
        return;
    }

    renderFutureOrbitForState(viewer, id, state, state.lastOrbitPayload);
}
