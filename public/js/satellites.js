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
const SAT_LABEL_FONT_WEIGHT = 600;
const SAT_LABEL_FONT_FAMILY = "sans-serif";
const SAT_LABEL_FILL_COLOR = "#dfe9f3";
const SAT_LABEL_OUTLINE_COLOR = "#0a0f18";
const SAT_LABEL_OUTLINE_WIDTH = 2;
const SAT_MODEL_BASE_MIN_PIXEL_SIZE = 1000;
const SAT_MODEL_BASE_MAX_SCALE = 5000;

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
            const entity = this.viewer.entities.add({
                position: new Cesium.Cartesian3(0, 0, 0),
                orientation: Cesium.Quaternion.IDENTITY,
                scale: 1500,
                model: {
                    uri: "/models/satelliteModel.glb",
                    minimumPixelSize: 1000,
                    maximumScale: 5000
                },
                label: {
                    text: "",
                    font: "14px sans-serif",
                    fillColor: Cesium.Color.WHITE,
                    pixelOffset: new Cesium.Cartesian2(0, -30),
                    show: true
                },
                show: false
            });
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
            entity = this.viewer.entities.add({
                position: new Cesium.Cartesian3(0, 0, 0),
                orientation: Cesium.Quaternion.IDENTITY,
                scale: 1500,
                model: {
                    uri: "/models/satelliteModel.glb",
                    minimumPixelSize: 1000,
                    maximumScale: 5000
                },
                label: {
                    text: "",
                    font: "14px sans-serif",
                    fillColor: Cesium.Color.WHITE,
                    pixelOffset: new Cesium.Cartesian2(0, -30),
                    show: true
                }
            });
        }

        // Actualizar estado
        entity.satelliteId = id;  // Usar propiedad personalizada en lugar de id (que es de solo lectura)
        entity.name = id;
        entity.position = position;
        entity.orientation = orientation;
        applyLabelStyle(entity, id);
        applyModelStyle(entity);
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
let maxSatellitesVisible = MAX_SATELLITES_VISIBLE;
let satelliteLabelSizePx = 14;
let satelliteModelScale = 1.0;
let lastUpdateTime = Date.now();
let animationFrameId = null;
let orbitConfig = {
    orbit_future_show: true,
    orbit_past_show: true,
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

    // Reaplicar estilo en entidades activas cuando cambia configuración
    if (entityPool) {
        const activeIds = entityPool.getActive();
        for (const id of activeIds) {
            const state = entityPool.getState(id);
            if (state && state.entity && state.entity.label) {
                applyLabelStyle(state.entity, id);
                applyModelStyle(state.entity);
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

function applyModelStyle(entity) {
    if (!entity || !entity.model) {
        return;
    }

    const safeScale = Math.max(0.1, Math.min(10, satelliteModelScale));
    entity.model.scale = safeScale;
    entity.model.minimumPixelSize = Math.max(1, Math.floor(SAT_MODEL_BASE_MIN_PIXEL_SIZE * safeScale));
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

function createOrbitEntity(viewer, id, positions, color, width) {
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
    const pos = satData.position;
    const vel = satData.velocity || { x: 0, y: 0, z: 0 };

    if (!pos) {
        return;
    }

    const cart = new Cesium.Cartesian3(pos.x, pos.y, pos.z);
    const orientation = calculateOrientation(pos, vel);

    const state = ensureSatelliteState(viewer, id, cart, orientation);

    // No actualizar posición directamente; dejar que la interpolación la actualice
    // state.entity.position se actualiza en smoothUpdate()
    state.entity.orientation = orientation;

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
        if (!state.trailEntity) {
            state.trailEntity = createTrailEntity(
                viewer,
                id,
                visibleTrail,
                trailColor,
                orbitConfig.orbit_past_line_width
            );
        } else {
            // Suavizar trail antes de actualizar
            const smoothedTrail = smoothTrail(visibleTrail, 1);
            state.trailEntity.polyline.positions = smoothedTrail;
            state.trailEntity.polyline.material = new Cesium.ColorMaterialProperty(trailColor);
            state.trailEntity.polyline.width = orbitConfig.orbit_past_line_width;
        }
    }
}

function updateSatelliteOrbit(viewer, satData) {
    if (!orbitConfig.orbit_future_show) {
        return;
    }

    const id = satData.satellite || "UNKNOWN";
    const orbit = satData.orbit;
    if (!Array.isArray(orbit) || orbit.length < 2) {
        return;
    }

    const state = satelliteState[id];
    if (!state) {
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

    if (!state.orbitEntity) {
        state.orbitEntity = createOrbitEntity(
            viewer,
            id,
            smoothedOrbit,
            futureColor,
            orbitConfig.orbit_future_line_width
        );
    } else {
        state.orbitEntity.polyline.positions = smoothedOrbit;
        state.orbitEntity.polyline.material = new Cesium.ColorMaterialProperty(futureColor);
        state.orbitEntity.polyline.width = orbitConfig.orbit_future_line_width;
    }
}
