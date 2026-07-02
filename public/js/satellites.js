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
const GROUND_TRACK_WIDTH_FACTOR = 0.85;
const FOOTPRINT_FILL_ALPHA = 0.32;
const FOOTPRINT_OUTLINE_ALPHA = 0.95;
const FOOTPRINT_CIRCLE_SEGMENTS = 128;
// Altura sobre el elipsoide a la que se dibuja la huella. Suficiente para evitar
// el z-fighting con la textura de la Tierra sin que el círculo parezca flotar
// (la huella mide miles de km, unos pocos km de altura son imperceptibles).
const FOOTPRINT_SURFACE_HEIGHT = 30000;
const DEFAULT_MAX_ACTIVE_SATELLITES = 100;
const PROPAGATION_HOURS_MIN = 0;
const PROPAGATION_HOURS_MAX = 240;
const PAST_SECONDS_MIN = 0;
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
            orbitEntity: null,
            groundTrackEntity: null,
            footprintEntity: null
        });

        logger.debug(`Satélite adquirido: ${id} (activos: ${this.activeEntities.size})`);
        return entity;
    }

    release(id) {
        const state = this.activeEntities.get(id);
        if (!state) return;

        const { entity, trailEntity, orbitEntity, groundTrackEntity, footprintEntity } = state;

        // Limpiar polylines
        if (trailEntity) {
            this.viewer.entities.remove(trailEntity);
        }
        if (orbitEntity) {
            this.viewer.entities.remove(orbitEntity);
        }
        if (groundTrackEntity) {
            this.viewer.entities.remove(groundTrackEntity);
        }
        if (footprintEntity) {
            this.viewer.entities.remove(footprintEntity);
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
let maxActiveSatellites = DEFAULT_MAX_ACTIVE_SATELLITES;
let lastUpdateTime = Date.now();
let animationFrameId = null;
let sourceFutureOrbitHours = null;
let sourceFutureOrbitSamples = null;
let selectedOrbitSatelliteId = null;
const satelliteVisualOverridesById = new Map();
let orbitConfig = {
    orbit_future_show: true,
    orbit_ground_track_show: true,
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

function getSatelliteOverrides(id) {
    if (!id) {
        return null;
    }
    return satelliteVisualOverridesById.get(String(id)) || null;
}

function getSatelliteConfigValue(id, key, fallbackValue) {
    const overrides = getSatelliteOverrides(id);
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
        return overrides[key];
    }
    return fallbackValue;
}

function shouldShowFutureOrbit(id) {
    return getSatelliteConfigValue(id, "orbit_future_show", orbitConfig.orbit_future_show) !== false
        && getPropagationHoursForSatellite(id) > 0;
}

function shouldShowGroundTrack(id) {
    return getSatelliteConfigValue(id, "orbit_ground_track_show", orbitConfig.orbit_ground_track_show) !== false
        && getPropagationHoursForSatellite(id) > 0;
}

function shouldShowPastOrbit(id) {
    return getSatelliteConfigValue(id, "orbit_past_show", orbitConfig.orbit_past_show) !== false
        && getPastSecondsForSatellite(id) > 0;
}

function getPropagationHoursForSatellite(id) {
    const requested = Number(getSatelliteConfigValue(id, "propagation_hours", orbitConfig.propagation_hours));
    if (!Number.isFinite(requested) || requested < 0) {
        return 12;
    }
    return clamp(requested, PROPAGATION_HOURS_MIN, PROPAGATION_HOURS_MAX);
}

function getPastSecondsForSatellite(id) {
    const requested = Number(getSatelliteConfigValue(id, "orbit_past_seconds", orbitConfig.orbit_past_seconds));
    if (!Number.isFinite(requested) || requested < 0) {
        return 120;
    }
    return clamp(requested, PAST_SECONDS_MIN, PAST_SECONDS_MAX);
}

function getSatelliteLabelSize(id) {
    const requested = Number(getSatelliteConfigValue(id, "satellite_label_size_px", satelliteLabelSizePx));
    if (!Number.isFinite(requested) || requested < 0) {
        return satelliteLabelSizePx;
    }
    return requested;
}

function shouldUse3DModelForSatellite(id) {
    return getSatelliteConfigValue(id, "satellite_use_3d_model", satelliteUse3DModel) !== false;
}

function getModelScaleForSatellite(id) {
    const requested = Number(getSatelliteConfigValue(id, "satellite_model_scale", satelliteModelScale));
    if (!Number.isFinite(requested) || requested <= 0) {
        return 1.0;
    }
    return Math.max(0.000001, Math.min(SAT_MODEL_MAX_USER_SCALE, requested));
}

function getSatelliteSizeMode(id) {
    const requested = String(getSatelliteConfigValue(id, "satellite_size_mode", satelliteSizeMode) || "").toLowerCase();
    return requested === "physical" ? "physical" : "visual";
}

function applySatelliteVisibility(id, state) {
    if (!state || !state.entity) {
        return true;
    }

    const isActiveLayer = activeLayerSatelliteIds.has(id);
    const visible = isActiveLayer && !hiddenSatelliteIds.has(id);
    state.entity.show = visible;

    if (state.trailEntity) {
        state.trailEntity.show = visible && shouldShowPastOrbit(id);
    }
    if (state.orbitEntity) {
        state.orbitEntity.show = visible && shouldShowFutureOrbit(id) && !isViewerIn2D(currentViewer);
    }
    if (state.groundTrackEntity) {
        state.groundTrackEntity.show = visible && shouldShowGroundTrack(id);
    }
    if (state.footprintEntity) {
        state.footprintEntity.show = visible && shouldShowGroundTrack(id);
    }

    return visible;
}

function normalizeMaxActiveSatellites(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return DEFAULT_MAX_ACTIVE_SATELLITES;
    }
    return Math.max(1, Math.floor(parsed));
}

function getAvailableActiveSatelliteSlots() {
    return Math.max(0, maxActiveSatellites - activeLayerSatelliteIds.size);
}

function trimActiveSatelliteLayersToLimit() {
    if (activeLayerSatelliteIds.size <= maxActiveSatellites) {
        return [];
    }

    const activeIds = Array.from(activeLayerSatelliteIds);
    const idsToRemove = activeIds.slice(maxActiveSatellites);

    for (const id of idsToRemove) {
        activeLayerSatelliteIds.delete(id);
        wsClient?.unsubscribe([id]);

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
        if (currentViewer) {
            remove2DOverlays(currentViewer, state);
        }
        if (state.entity) {
            state.entity.show = false;
        }
    }

    if (idsToRemove.length) {
        activeLayerIdsDirty = true;
    }

    return idsToRemove;
}

export function setOrbitConfig(config) {
    const previousPropagationHours = Number(orbitConfig.propagation_hours);
    const previousOrbitFutureShow = orbitConfig.orbit_future_show !== false;

    const nextOrbitConfig = {
        ...orbitConfig,
        ...config
    };

    const requestedHours = Number(nextOrbitConfig.propagation_hours);
    if (Number.isFinite(requestedHours) && requestedHours >= 0) {
        nextOrbitConfig.propagation_hours = clamp(requestedHours, PROPAGATION_HOURS_MIN, PROPAGATION_HOURS_MAX);
    }

    const requestedPastSeconds = Number(nextOrbitConfig.orbit_past_seconds);
    if (Number.isFinite(requestedPastSeconds) && requestedPastSeconds >= 0) {
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
    maxActiveSatellites = normalizeMaxActiveSatellites(config?.max_satellites_visible);
    trimActiveSatelliteLayersToLimit();

    // Reaplicar estilo en entidades activas cuando cambia configuración
    if (entityPool) {
        const activeIds = entityPool.getActive();
        for (const id of activeIds) {
            const state = entityPool.getState(id);
            if (state && state.entity && state.entity.label) {
                applyLabelStyle(state.entity, id);
                applyVisualStyle(state.entity);
                if (shouldUse3DModelForSatellite(id) && state.lastOrientation) {
                    state.entity.orientation = state.lastOrientation;
                }
                applySatelliteVisibility(id, state);
            }

            // Si se desactiva estela pasada, limpiar entidades y buffers para ahorrar carga.
            if (state && !shouldShowPastOrbit(id)) {
                if (state.trailEntity) {
                    entityPool.viewer.entities.remove(state.trailEntity);
                    state.trailEntity = null;
                }
                state.trailPositions = [];
            }

            // Si se desactiva órbita futura, limpiar entidad inmediatamente.
            if (state && !shouldShowFutureOrbit(id)) {
                if (state.orbitEntity) {
                    entityPool.viewer.entities.remove(state.orbitEntity);
                    state.orbitEntity = null;
                }
            }

            if (state && !shouldShowGroundTrack(id)) {
                remove2DOverlays(entityPool.viewer, state);
            }

            // Refrescar de inmediato el color de la estela pasada al cambiar la configuración global.
            if (state && state.trailEntity && shouldShowPastOrbit(id)) {
                const configuredPastColor = String(getSatelliteConfigValue(id, "orbit_past_color", orbitConfig.orbit_past_color) || "#ff0000");
                const trailColor = getOpaqueColor(configuredPastColor, "#ff0000");
                state.trailEntity.polyline.material = createOrbitMaterial(trailColor);
                state.trailEntity.polyline.depthFailMaterial = createOrbitMaterial(trailColor);
                state.trailColorCss = configuredPastColor;
            }

            // Si hay órbita cacheada, re-renderizar con la nueva configuración local.
            if (
                state
                && (shouldShowFutureOrbit(id) || shouldShowGroundTrack(id))
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
    const localLabelSizePx = getSatelliteLabelSize(id);
    const labelVisible = localLabelSizePx > 0;
    const labelSize = Math.max(1, Math.floor(localLabelSizePx));

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

    const id = String(entity?.satelliteId || entity?.name || "");
    const localUse3DModel = shouldUse3DModelForSatellite(id);
    const localModelScale = getModelScaleForSatellite(id);
    const localSizeMode = getSatelliteSizeMode(id);

    if (entity.point) {
        entity.point.pixelSize = SAT_POINT_PIXEL_SIZE;
        entity.point.color = Cesium.Color.WHITE;
        entity.point.outlineColor = Cesium.Color.BLACK;
        entity.point.outlineWidth = SAT_POINT_OUTLINE_WIDTH;
        entity.point.show = !localUse3DModel;
    }

    if (!localUse3DModel) {
        if (entity.model) {
            entity.model.show = false;
            entity.model = undefined;
        }
        entity.orientation = undefined;
        return;
    }

    if (!entity.model) {
        entity.model = createSatelliteModelGraphics();
    }
    entity.model.show = true;

    const safeScale = localModelScale;
    entity.model.scale = safeScale;

    const minimumPixelSize = localSizeMode === "physical"
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

function getPastTrailMaxPoints(id) {
    const pastSecondsRaw = Number(getPastSecondsForSatellite(id));
    const pastSeconds = Number.isFinite(pastSecondsRaw) && pastSecondsRaw > 0
        ? pastSecondsRaw
        : 0;
    if (pastSeconds <= 0) {
        return 0;
    }
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

function isViewerIn2D(viewer) {
    return viewer?.scene?.mode === Cesium.SceneMode.SCENE2D;
}

function remove2DOverlays(viewer, state) {
    if (!viewer || !state) {
        return;
    }

    if (state.groundTrackEntity) {
        viewer.entities.remove(state.groundTrackEntity);
        state.groundTrackEntity = null;
    }

    if (state.footprintEntity) {
        viewer.entities.remove(state.footprintEntity);
        state.footprintEntity = null;
    }
}

function resolveCartesianPosition(positionLike) {
    if (!positionLike) {
        return null;
    }

    if (positionLike instanceof Cesium.Cartesian3) {
        return positionLike;
    }

    if (typeof positionLike.getValue === "function") {
        try {
            const value = positionLike.getValue(Cesium.JulianDate.now());
            return value instanceof Cesium.Cartesian3 ? value : null;
        } catch {
            return null;
        }
    }

    return null;
}

function toSurfaceGroundTrack(orbitPoints) {
    if (!Array.isArray(orbitPoints)) {
        return [];
    }

    const positions = [];
    for (const point of orbitPoints) {
        if (!point) {
            continue;
        }

        const cart = new Cesium.Cartesian3(point.x, point.y, point.z);
        const cartographic = Cesium.Cartographic.fromCartesian(cart);
        if (!cartographic) {
            continue;
        }

        const lon = Number(cartographic.longitude);
        const lat = Number(cartographic.latitude);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
            continue;
        }

        positions.push(Cesium.Cartesian3.fromRadians(lon, lat, 0));
    }

    return positions;
}

function computeFootprintAngularRadius(position) {
    if (!position) {
        return 0;
    }

    const cartographic = Cesium.Cartographic.fromCartesian(position);
    if (!cartographic) {
        return 0;
    }

    const altitude = Math.max(0, Number(cartographic.height) || 0);
    if (altitude <= 0) {
        return 0;
    }

    const radius = Cesium.Ellipsoid.WGS84.maximumRadius;
    // Ángulo central Tierra-satélite: define el radio angular de la huella (footprint).
    return Math.acos(radius / (radius + altitude));
}

function computeFootprintCirclePositions(centerCartographic, angularRadius, segments = FOOTPRINT_CIRCLE_SEGMENTS) {
    if (!centerCartographic || !(angularRadius > 0)) {
        return [];
    }

    const lat1 = centerCartographic.latitude;
    const lon1 = centerCartographic.longitude;
    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinR = Math.sin(angularRadius);
    const cosR = Math.cos(angularRadius);

    const positions = [];
    for (let i = 0; i <= segments; i += 1) {
        const bearing = (i / segments) * Cesium.Math.TWO_PI;
        const sinLat2 = sinLat1 * cosR + cosLat1 * sinR * Math.cos(bearing);
        const lat2 = Math.asin(Cesium.Math.clamp(sinLat2, -1, 1));
        const y = Math.sin(bearing) * sinR * cosLat1;
        const x = cosR - sinLat1 * sinLat2;
        const lon2 = lon1 + Math.atan2(y, x);
        positions.push(Cesium.Cartesian3.fromRadians(lon2, lat2, FOOTPRINT_SURFACE_HEIGHT));
    }

    return positions;
}

function updateGroundTrackAndFootprint(viewer, id, state, visibleOrbit) {
    if (!viewer || !state) {
        return;
    }

    if (!shouldShowGroundTrack(id) || hiddenSatelliteIds.has(id) || !activeLayerSatelliteIds.has(id)) {
        remove2DOverlays(viewer, state);
        return;
    }

    const trackPositions = toSurfaceGroundTrack(visibleOrbit);
    if (trackPositions.length < 2) {
        remove2DOverlays(viewer, state);
        return;
    }

    const baseColor = getFutureOrbitColor(id);
    const trackColor = baseColor.withAlpha(0.95);
    const trackWidth = Math.max(
        ORBIT_MIN_PIXEL_WIDTH,
        Number(state.orbitBaseWidth || ORBIT_MIN_PIXEL_WIDTH) * GROUND_TRACK_WIDTH_FACTOR
    );

    if (!state.groundTrackEntity) {
        state.groundTrackEntity = viewer.entities.add({
            id: `${id}-ground-track`,
            polyline: {
                positions: trackPositions,
                width: trackWidth,
                material: createOrbitMaterial(trackColor),
                arcType: Cesium.ArcType.NONE,
                clampToGround: false
            }
        });
    } else {
        state.groundTrackEntity.polyline.positions = trackPositions;
        state.groundTrackEntity.polyline.width = trackWidth;
        state.groundTrackEntity.polyline.material = createOrbitMaterial(trackColor);
        state.groundTrackEntity.show = true;
    }

    const center = state.renderPosition
        || state.targetPosition
        || resolveCartesianPosition(state.entity?.position);
    const footprintAngularRadius = computeFootprintAngularRadius(center);
    const footprintRadiusMeters = Cesium.Ellipsoid.WGS84.maximumRadius * footprintAngularRadius;
    if (!(footprintRadiusMeters > 10) || !center) {
        if (state.footprintEntity) {
            viewer.entities.remove(state.footprintEntity);
            state.footprintEntity = null;
        }
        return;
    }

    const cartographic = Cesium.Cartographic.fromCartesian(center);
    const footprintPositions = computeFootprintCirclePositions(cartographic, footprintAngularRadius);
    if (footprintPositions.length < 3) {
        if (state.footprintEntity) {
            viewer.entities.remove(state.footprintEntity);
            state.footprintEntity = null;
        }
        return;
    }

    const fillColor = baseColor.withAlpha(FOOTPRINT_FILL_ALPHA);
    const outlineColor = baseColor.withAlpha(FOOTPRINT_OUTLINE_ALPHA);
    const footprintHierarchy = new Cesium.PolygonHierarchy(footprintPositions);

    if (!state.footprintEntity) {
        state.footprintEntity = viewer.entities.add({
            id: `${id}-footprint`,
            polygon: {
                hierarchy: footprintHierarchy,
                material: fillColor,
                height: FOOTPRINT_SURFACE_HEIGHT,
                outline: true,
                outlineColor,
                outlineWidth: 2,
                arcType: Cesium.ArcType.GEODESIC
            }
        });
    } else {
        state.footprintEntity.polygon.hierarchy = footprintHierarchy;
        state.footprintEntity.polygon.material = fillColor;
        state.footprintEntity.polygon.outlineColor = outlineColor;
        state.footprintEntity.polygon.height = FOOTPRINT_SURFACE_HEIGHT;
        state.footprintEntity.show = true;
    }
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
    const configuredSelectedColor = getSatelliteConfigValue(id, "orbit_selected_color", orbitConfig.orbit_selected_color);
    const configuredFutureColor = getSatelliteConfigValue(id, "orbit_future_color", orbitConfig.orbit_future_color);

    if (selectedOrbitSatelliteId && id === selectedOrbitSatelliteId) {
        return getOpaqueColor(configuredSelectedColor, DEFAULT_SELECTED_ORBIT_COLOR);
    }
    return getOpaqueColor(configuredFutureColor, "#00ff88");
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

function clipFutureOrbitByRequestedHorizon(id, orbit) {
    if (!Array.isArray(orbit) || orbit.length < 2) {
        return orbit;
    }

    const sourceHours = Number.isFinite(sourceFutureOrbitHours) && sourceFutureOrbitHours > 0
        ? sourceFutureOrbitHours
        : 0;
    const requestedHoursRaw = Number(getPropagationHoursForSatellite(id));
    const requestedHours = Number.isFinite(requestedHoursRaw) && requestedHoursRaw >= 0
        ? requestedHoursRaw
        : sourceHours;

    if (requestedHours <= 0) {
        return [];
    }

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
            positions: Array.isArray(positions) ? positions.slice() : positions,
            width,
            material: createOrbitMaterial(color),
            arcType: Cesium.ArcType.NONE,
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
        
        if (shouldShowPastOrbit(id)) {
            state.trailPositions.push(cart);
            const maxTrailPoints = getPastTrailMaxPoints(id);
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
    const state = entityPool.getState(id) || {
        entity,
        trailPositions: [cart],
        trailEntity: null,
        orbitEntity: null,
        groundTrackEntity: null,
        footprintEntity: null
    };
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
    const orientation = shouldUse3DModelForSatellite(id) ? calculateOrientation(pos, vel) : undefined;

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
    if (shouldUse3DModelForSatellite(id)) {
        state.entity.orientation = orientation;
        state.lastOrientation = orientation;
    }

    if (!isVisible) {
        return;
    }

    if (!shouldShowPastOrbit(id)) {
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

        const configuredPastColor = String(getSatelliteConfigValue(id, "orbit_past_color", orbitConfig.orbit_past_color) || "#ff0000");
        const trailColor = getOpaqueColor(configuredPastColor, "#ff0000");
        const configuredPastWidth = Number(getSatelliteConfigValue(id, "orbit_past_line_width", orbitConfig.orbit_past_line_width));
        const trailReferencePosition = visibleTrail[visibleTrail.length - 1] || state.entity.position;
        const futureOrbitEnabled = shouldShowFutureOrbit(id);
        const targetTrailWidth = futureOrbitEnabled
            ? computeOrbitWidth(viewer, configuredPastWidth, trailReferencePosition)
            : Math.max(ORBIT_MIN_PIXEL_WIDTH, configuredPastWidth);
        const previousTrailWidth = Number(state.trailRenderWidth);
        const trailWidth = Number.isFinite(previousTrailWidth)
            ? lerp(previousTrailWidth, targetTrailWidth, orbitConfig.orbit_width_mode === ORBIT_WIDTH_MODE_PHYSICAL ? 0.18 : 1)
            : targetTrailWidth;
        if (!state.trailEntity) {
            state.trailEntity = createTrailEntity(
                viewer,
                id,
                visibleTrail,
                trailColor,
                trailWidth
            );
            state.trailColorCss = configuredPastColor;
            state.trailRenderWidth = trailWidth;
        } else {
            // Mantener geometría directa y estable reduce oscilación visual al actualizar en alta frecuencia.
            state.trailEntity.polyline.positions = visibleTrail.slice();
            if (state.trailColorCss !== configuredPastColor) {
                state.trailEntity.polyline.material = createOrbitMaterial(trailColor);
                state.trailEntity.polyline.depthFailMaterial = createOrbitMaterial(trailColor);
                state.trailColorCss = configuredPastColor;
            }
            if (!Number.isFinite(previousTrailWidth) || Math.abs(previousTrailWidth - trailWidth) > 0.01) {
                state.trailEntity.polyline.width = trailWidth;
                state.trailRenderWidth = trailWidth;
            }
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
    const propagationFutureHours = getPropagationHoursForSatellite(id);
    const propagationPastSeconds = getPastSecondsForSatellite(id);

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
        orbit_future_enabled: shouldShowFutureOrbit(id),
        orbit_past_enabled: shouldShowPastOrbit(id),
        propagation_future_hours: propagationFutureHours,
        propagation_past_seconds: propagationPastSeconds,
        propagation_past_hours: propagationPastSeconds / 3600,
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
        return false;
    }

    if (active) {
        if (activeLayerSatelliteIds.has(id)) {
            return true;
        }
        if (activeLayerSatelliteIds.size >= maxActiveSatellites) {
            return false;
        }
        activeLayerSatelliteIds.add(id);
        activeLayerIdsDirty = true;
        wsClient?.subscribe([id]);
        return true;
    } else {
        activeLayerSatelliteIds.delete(id);
        activeLayerIdsDirty = true;
        wsClient?.unsubscribe([id]);

        // Al quitar capa, ocultar y liberar recursos render de ese objeto.
        const state = satelliteState[id];
        if (state) {
            if (state.trailEntity && currentViewer) {
                currentViewer.entities.remove(state.trailEntity);
                state.trailEntity = null;
            }
            if (state.orbitEntity && currentViewer) {
                currentViewer.entities.remove(state.orbitEntity);
                state.orbitEntity = null;
            }
            if (currentViewer) {
                remove2DOverlays(currentViewer, state);
            }
            if (state.entity) {
                state.entity.show = false;
            }
        }
        return true;
    }
}

export function setAllSatelliteLayersActive(active) {
    const ids = getSatelliteIds();
    if (!ids.length) {
        return { added: 0, skipped: 0, limitReached: false, maxActiveSatellites };
    }

    if (active) {
        const nextIds = ids.slice(0, maxActiveSatellites);
        activeLayerSatelliteIds.clear();
        nextIds.forEach((id) => activeLayerSatelliteIds.add(id));
        activeLayerIdsDirty = true;
        wsClient?.setSubscriptions(nextIds);
        return {
            added: nextIds.length,
            skipped: Math.max(0, ids.length - nextIds.length),
            limitReached: ids.length > nextIds.length,
            maxActiveSatellites
        };
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
        if (currentViewer) {
            remove2DOverlays(currentViewer, state);
        }
        if (state.entity) {
            state.entity.show = false;
        }
    }

    return { added: 0, skipped: 0, limitReached: false, maxActiveSatellites };
}

export function getMaxActiveSatellites() {
    return maxActiveSatellites;
}

export function getAvailableActiveSatelliteLayerSlots() {
    return getAvailableActiveSatelliteSlots();
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

    const futureOrbitVisible = shouldShowFutureOrbit(id);
    const groundTrackVisible = shouldShowGroundTrack(id);

    if ((!futureOrbitVisible && !groundTrackVisible) || !activeLayerSatelliteIds.has(id) || hiddenSatelliteIds.has(id)) {
        if (state.orbitEntity) {
            viewer.entities.remove(state.orbitEntity);
            state.orbitEntity = null;
        }
        remove2DOverlays(viewer, state);
        return;
    }

    const orbit = orbitPayload?.orbit;
    if (!Array.isArray(orbit) || orbit.length < 2) {
        if (state.orbitEntity) {
            viewer.entities.remove(state.orbitEntity);
            state.orbitEntity = null;
        }
        remove2DOverlays(viewer, state);
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

    const horizonClippedOrbit = clipFutureOrbitByRequestedHorizon(id, orbit);
    const hiddenFutureSamples = getHiddenFutureSamples();
    const visibleOrbit = trimOrbitNearSatellite(horizonClippedOrbit, hiddenFutureSamples);

    if (visibleOrbit.length < 2) {
        if (state.orbitEntity) {
            viewer.entities.remove(state.orbitEntity);
            state.orbitEntity = null;
        }
        remove2DOverlays(viewer, state);
        return;
    }

    const orbitPositions = toCartesianArray(visibleOrbit);
    const smoothedOrbit = smoothTrail(orbitPositions, 1);
    const futureColor = getFutureOrbitColor(id);
    const referencePosition = state.entity?.position || orbitPositions[0];
    const configuredFutureWidth = Number(getSatelliteConfigValue(id, "orbit_future_line_width", orbitConfig.orbit_future_line_width));
    const futureWidthBase = computeOrbitWidth(viewer, configuredFutureWidth, referencePosition);
    state.orbitBaseWidth = futureWidthBase;
    const futureWidth = getFutureOrbitRenderWidth(id, futureWidthBase);

    if (futureOrbitVisible && !state.orbitEntity) {
        state.orbitEntity = createOrbitEntity(viewer, id, smoothedOrbit, futureColor, futureWidth);
    } else if (futureOrbitVisible && state.orbitEntity) {
        state.orbitEntity.polyline.positions = smoothedOrbit;
        state.orbitEntity.polyline.material = createOrbitMaterial(futureColor);
        state.orbitEntity.polyline.width = futureWidth;
    } else {
        if (state.orbitEntity) {
            viewer.entities.remove(state.orbitEntity);
            state.orbitEntity = null;
        }
    }

    if (state.orbitEntity) {
        state.orbitEntity.show = !isViewerIn2D(viewer);
    }

    updateGroundTrackAndFootprint(viewer, id, state, visibleOrbit);
}

export function refreshSatelliteOverlays(viewer = currentViewer) {
    if (!viewer) {
        return;
    }

    for (const [id, state] of Object.entries(satelliteState)) {
        if (!state) {
            continue;
        }

        if (state.lastOrbitPayload) {
            renderFutureOrbitForState(viewer, id, state, state.lastOrbitPayload);
        } else {
            remove2DOverlays(viewer, state);
        }
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

export function getSatelliteVisualizationConfig(id) {
    const satId = String(id || "").trim();
    if (!satId) {
        return null;
    }

    const overrides = getSatelliteOverrides(satId) || {};
    return {
        satelliteId: satId,
        effective: {
            orbit_future_show: shouldShowFutureOrbit(satId),
            orbit_ground_track_show: shouldShowGroundTrack(satId),
            orbit_past_show: shouldShowPastOrbit(satId),
            orbit_future_line_width: Number(getSatelliteConfigValue(satId, "orbit_future_line_width", orbitConfig.orbit_future_line_width)),
            orbit_past_line_width: Number(getSatelliteConfigValue(satId, "orbit_past_line_width", orbitConfig.orbit_past_line_width)),
            orbit_future_color: String(getSatelliteConfigValue(satId, "orbit_future_color", orbitConfig.orbit_future_color) || "#7fd7ff"),
            orbit_past_color: String(getSatelliteConfigValue(satId, "orbit_past_color", orbitConfig.orbit_past_color) || "#ff9a5a"),
            orbit_selected_color: String(getSatelliteConfigValue(satId, "orbit_selected_color", orbitConfig.orbit_selected_color) || DEFAULT_SELECTED_ORBIT_COLOR),
            propagation_hours: getPropagationHoursForSatellite(satId),
            orbit_past_seconds: getPastSecondsForSatellite(satId),
            satellite_label_size_px: getSatelliteLabelSize(satId),
            satellite_model_scale: getModelScaleForSatellite(satId),
            satellite_use_3d_model: shouldUse3DModelForSatellite(satId),
            satellite_size_mode: getSatelliteSizeMode(satId)
        },
        overrides: { ...overrides }
    };
}

export function setSatelliteVisualizationConfig(id, patch = {}) {
    const satId = String(id || "").trim();
    if (!satId) {
        return;
    }

    const current = getSatelliteOverrides(satId) || {};
    const next = { ...current };
    const allowedFields = [
        "orbit_future_show",
        "orbit_ground_track_show",
        "orbit_past_show",
        "orbit_future_line_width",
        "orbit_past_line_width",
        "orbit_future_color",
        "orbit_past_color",
        "orbit_selected_color",
        "propagation_hours",
        "orbit_past_seconds",
        "satellite_label_size_px",
        "satellite_model_scale",
        "satellite_use_3d_model",
        "satellite_size_mode"
    ];

    for (const field of allowedFields) {
        if (!Object.prototype.hasOwnProperty.call(patch, field)) {
            continue;
        }
        const value = patch[field];
        if (value === null || value === undefined || value === "") {
            delete next[field];
        } else {
            next[field] = value;
        }
    }

    if (Object.keys(next).length) {
        satelliteVisualOverridesById.set(satId, next);
    } else {
        satelliteVisualOverridesById.delete(satId);
    }

    const state = satelliteState[satId];
    if (!state || !currentViewer) {
        return;
    }

    if (state.entity) {
        applyLabelStyle(state.entity, satId);
        applyVisualStyle(state.entity);
        if (shouldUse3DModelForSatellite(satId) && state.lastOrientation) {
            state.entity.orientation = state.lastOrientation;
        }
    }

    applySatelliteVisibility(satId, state);

    if (!shouldShowPastOrbit(satId) && state.trailEntity) {
        currentViewer.entities.remove(state.trailEntity);
        state.trailEntity = null;
    }

    if (!shouldShowGroundTrack(satId)) {
        remove2DOverlays(currentViewer, state);
    }

    if (state.trailEntity && shouldShowPastOrbit(satId)) {
        const configuredPastColor = String(getSatelliteConfigValue(satId, "orbit_past_color", orbitConfig.orbit_past_color) || "#ff0000");
        const trailColor = getOpaqueColor(configuredPastColor, "#ff0000");
        state.trailEntity.polyline.material = createOrbitMaterial(trailColor);
        state.trailEntity.polyline.depthFailMaterial = createOrbitMaterial(trailColor);
        state.trailColorCss = configuredPastColor;
    }

    if (state.lastOrbitPayload) {
        renderFutureOrbitForState(currentViewer, satId, state, state.lastOrbitPayload);
    }
}

export function clearSatelliteVisualizationConfig(id) {
    setSatelliteVisualizationConfig(id, {
        orbit_future_show: null,
        orbit_ground_track_show: null,
        orbit_past_show: null,
        orbit_future_line_width: null,
        orbit_past_line_width: null,
        orbit_future_color: null,
        orbit_past_color: null,
        orbit_selected_color: null,
        propagation_hours: null,
        orbit_past_seconds: null,
        satellite_label_size_px: null,
        satellite_model_scale: null,
        satellite_use_3d_model: null,
        satellite_size_mode: null
    });
}

export function clearAllSatelliteVisualizationConfigs() {
    if (!satelliteVisualOverridesById.size) {
        return;
    }

    satelliteVisualOverridesById.clear();

    // Reaplicar estilo global en todos los satélites activos tras limpiar overrides.
    setOrbitConfig({});
}
