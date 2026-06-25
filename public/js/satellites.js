import { SatelliteWebSocket } from "./SatelliteWebSocket.js";
import { getLogger } from "./logger.js";

const logger = getLogger("satellites");

// =============================
// Configuración y límites
// =============================
const MAX_SATELLITES_VISIBLE = 100;  // Límite de satélites en pantalla
const ENTITY_POOL_SIZE = 50;         // Tamaño del object pool
const MIN_INTERPOLATION_MS = 250;
const MAX_INTERPOLATION_MS = 2000;
const INTERPOLATION_HEADROOM = 1.16;
const INTERVAL_SMOOTHING_FACTOR = 0.14;
const POSITION_SMOOTHING_ALPHA = 0.32;
const HIDE_NEAR_SATELLITE_SECONDS = 8;
const ORBIT_WIDTH_MODE_VISUAL = "visual";
const ORBIT_WIDTH_MODE_PHYSICAL = "physical";
const ORBIT_PHYSICAL_REF_DISTANCE_M = 1000000;
const ORBIT_PHYSICAL_MIN_FACTOR = 0.2;
const ORBIT_PHYSICAL_MAX_FACTOR = 3.0;
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
        if (!Number.isFinite(maxSatellitesVisible)) {
            return;
        }

        // Si excedemos el límite, liberar los menos recientemente usados
        if (this.activeEntities.size > maxSatellitesVisible) {
            const toRemove = this.activeEntities.size - maxSatellitesVisible;
            const keys = Array.from(this.activeEntities.keys());
            for (let i = 0; i < toRemove; i++) {
                this.release(keys[i]);
            }
            logger.warn(`Límite de satélites alcanzado. Liberados ${toRemove}`);
        }
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
let lastCatalogUrl = "/config/catalog.txt";
let cachedSatelliteIds = [];
let satelliteIdsDirty = true;
let cachedActiveLayerIds = [];
let activeLayerIdsDirty = true;
let wsClient = null;
let maxSatellitesVisible = MAX_SATELLITES_VISIBLE;
let satelliteLabelSizePx = 14;
let satelliteModelScale = 1.0;
let satelliteUse3DModel = true;
let satelliteSizeMode = "visual";
let lastUpdateTime = Date.now();
let animationFrameId = null;
let orbitConfig = {
    orbit_future_show: true,
    orbit_past_show: true,
    orbit_width_mode: ORBIT_WIDTH_MODE_VISUAL,
    orbit_future_line_width: 3,
    orbit_future_color: "#00ff88",
    orbit_hide_near_satellite: false,
    orbit_past_color: "#ff0000",
    orbit_past_samples: 120,
    orbit_past_line_width: 5,
    propagation_hours: 12,
    orbit_future_samples: 120,
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
    orbitConfig = {
        ...orbitConfig,
        ...config
    };

    const configuredMax = Number(config?.max_satellites_visible);
    if (Number.isFinite(configuredMax) && configuredMax > 0) {
        maxSatellitesVisible = Math.floor(configuredMax);
    } else if (configuredMax === 0 || configuredMax === -1) {
        // 0 o -1 => sin límite
        maxSatellitesVisible = Number.POSITIVE_INFINITY;
    } else {
        maxSatellitesVisible = MAX_SATELLITES_VISIBLE;
    }

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
        }
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
    const horizonHours = Number(orbitConfig.propagation_hours);
    const samples = Number(orbitConfig.orbit_future_samples);
    const safeHours = Number.isFinite(horizonHours) && horizonHours > 0 ? horizonHours : 12;
    const safeSamples = Number.isFinite(samples) && samples > 1 ? Math.floor(samples) : 120;
    return (safeHours * 3600) / (safeSamples - 1);
}

function getPastSampleStepSeconds() {
    const stateInterval = Number(orbitConfig.websocket_state_interval_seconds);
    return Number.isFinite(stateInterval) && stateInterval > 0 ? stateInterval : 1.0;
}

function getHiddenPastSamples() {
    if (orbitConfig.orbit_hide_near_satellite === true) {
        return Math.max(0, HIDE_NEAR_SATELLITE_SECONDS / getPastSampleStepSeconds());
    }
    return 0;
}

function getHiddenFutureSamples() {
    if (orbitConfig.orbit_hide_near_satellite === true) {
        return Math.max(0, HIDE_NEAR_SATELLITE_SECONDS / getFutureSampleStepSeconds());
    }
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
        for (const id of catalog) {
            if (typeof id === "string") {
                catalogSatelliteIds.add(id);
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

function computeOrbitWidth(viewer, baseWidth, referencePosition) {
    const safeBase = Number.isFinite(baseWidth) && baseWidth > 0 ? baseWidth : 1;
    if (orbitConfig.orbit_width_mode !== ORBIT_WIDTH_MODE_PHYSICAL) {
        return safeBase;
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
    return safeBase * factor;
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
            material: new Cesium.ColorMaterialProperty(color),
            clampToGround: false
        }
    });
}

function createTrailEntity(viewer, id, positions, color, width) {
    return viewer.entities.add({
        id: `${id}-trail`,
        polyline: {
            positions,
            width,
            material: new Cesium.ColorMaterialProperty(color),
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
            if (state.trailPositions.length > orbitConfig.orbit_past_samples) {
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

        const trailColor = getColor(orbitConfig.orbit_past_color, "#ff0000");
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
            state.trailEntity.polyline.material = new Cesium.ColorMaterialProperty(trailColor);
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

export async function preloadSatelliteCatalog(catalogUrl = "/config/catalog.txt") {
    try {
        lastCatalogUrl = catalogUrl || lastCatalogUrl;
        const response = await fetch(catalogUrl, { cache: "no-cache" });
        if (!response.ok) {
            logger.warn(`No se pudo precargar catalogo (${response.status}): ${catalogUrl}`);
            return false;
        }

        const text = await response.text();
        // Ignorar lineas vacias para mantener el bloque nombre + L1 + L2 alineado.
        const lines = text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        let added = 0;
        for (let i = 0; i + 2 < lines.length; i += 3) {
            const name = lines[i] || "";
            const line1 = lines[i + 1] || "";
            const line2 = lines[i + 2] || "";
            if (!name) {
                continue;
            }
            if (!catalogSatelliteIds.has(name)) {
                catalogSatelliteIds.add(name);
                added += 1;
            }
            if (line1 && line2) {
                tleBySatelliteId.set(name, { line1, line2 });
            }
        }

        if (added > 0) {
            satelliteIdsDirty = true;
        }
        if (catalogSatelliteIds.size > 0) {
            catalogLoaded = true;
        }

        logger.info(`Catalogo precargado: ${catalogSatelliteIds.size} objetos`);
        return catalogLoaded;
    } catch (error) {
        logger.warn("Error precargando catalogo:", error);
        return false;
    }
}

export async function refreshSatelliteCatalog(catalogUrl = "/config/catalog.txt") {
    // Actualiza la URL del catálogo y lo recarga. También reaplica subscripciones WS actuales.
    lastCatalogUrl = catalogUrl || lastCatalogUrl;
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

    await preloadSatelliteCatalog(lastCatalogUrl);
    return tleBySatelliteId.get(id) || null;
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
    const ids = Array.from(activeLayerSatelliteIds);
    if (!ids.length) {
        return;
    }

    if (visible) {
        hiddenSatelliteIds.clear();
    } else {
        ids.forEach((id) => hiddenSatelliteIds.add(id));
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

function updateSatelliteOrbit(viewer, satData) {
    if (!orbitConfig.orbit_future_show) {
        return;
    }

    const id = satData.satellite || "UNKNOWN";

    // Nunca dibujar órbitas de satélites sin capa activa.
    if (!activeLayerSatelliteIds.has(id)) {
        return;
    }

    // Si el satélite está oculto, ignorar también su órbita futura.
    if (hiddenSatelliteIds.has(id)) {
        return;
    }

    const orbit = satData.orbit;
    if (!Array.isArray(orbit) || orbit.length < 2) {
        return;
    }

    const state = satelliteState[id];
    if (!state) {
        return;
    }

    if (!applySatelliteVisibility(id, state)) {
        return;
    }

    const hiddenFutureSamples = getHiddenFutureSamples();
    const visibleOrbit = trimOrbitNearSatellite(orbit, hiddenFutureSamples);

    if (visibleOrbit.length < 2) {
        if (state.orbitEntity) {
            viewer.entities.remove(state.orbitEntity);
            state.orbitEntity = null;
        }
        return;
    }

    // Convertir a Cartesian3
    const orbitPositions = toCartesianArray(visibleOrbit);
    
    // Suavizar la curva de órbita para que se vea más fluida
    const smoothedOrbit = smoothTrail(orbitPositions, 2);
    
    const futureColor = getColor(orbitConfig.orbit_future_color, "#00ff88");
    const referencePosition = state.entity?.position || orbitPositions[0];
    const futureWidth = computeOrbitWidth(viewer, orbitConfig.orbit_future_line_width, referencePosition);

    if (!state.orbitEntity) {
        state.orbitEntity = createOrbitEntity(
            viewer,
            id,
            smoothedOrbit,
            futureColor,
            futureWidth
        );
    } else {
        state.orbitEntity.polyline.positions = smoothedOrbit;
        state.orbitEntity.polyline.material = new Cesium.ColorMaterialProperty(futureColor);
        state.orbitEntity.polyline.width = futureWidth;
    }
}
