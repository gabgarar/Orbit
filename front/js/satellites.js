import { SatelliteWebSocket } from "./SatelliteWebSocket.js";
import { getLogger } from "./logger.js";
import { emitObjectStateChanged } from "./runtime/objectDetailsEvents.js";
import { buildUniformSampleTimes, sampleTrackKinematics } from "./runtime/trackKinematics.js";
import { layoutVectorLabelOffsets } from "./runtime/vectorLabelLayout.js";

const logger = getLogger("satellites");

// =============================
// Configuración de renderizado
// =============================
const ENTITY_POOL_SIZE = 50;         // Tamaño del object pool
const MIN_INTERPOLATION_MS = 250;
const MAX_INTERPOLATION_MS = 2000;
const INTERPOLATION_HEADROOM = 1.16;
const INTERVAL_SMOOTHING_FACTOR = 0.14;
const POSITION_SMOOTHING_ALPHA = 0.32;
// Orbit lines use one stable screen-space width.  Scaling their width by
// camera distance made a close view blow out the permanent glow and obscured
// the globe when several satellites overlapped.
const ORBIT_DEFAULT_LINE_WIDTH_PX = 2.5;
const ORBIT_MIN_PIXEL_WIDTH = 2;
const ORBIT_MAX_PIXEL_WIDTH = 5;
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
const SAT_OUT_OF_TIME_POINT_COLOR = "#d7dde3";
const SAT_OUT_OF_TIME_POINT_OUTLINE_COLOR = "#8a93a0";
const SAT_OUT_OF_TIME_LABEL_COLOR = "#cfd5dc";
const SAT_OUT_OF_TIME_LABEL_OUTLINE_COLOR = "#4f5864";
const DEFAULT_SELECTED_ORBIT_COLOR = "#ff2d2d";
const SELECTED_ORBIT_WIDTH_BOOST_PX = 1;
const GROUND_TRACK_WIDTH_FACTOR = 0.85;
const FOOTPRINT_FILL_ALPHA = 0.32;
const FOOTPRINT_OUTLINE_ALPHA = 0.95;
const FOOTPRINT_CIRCLE_SEGMENTS = 128;
// Altura sobre el elipsoide a la que se dibuja la huella. Suficiente para evitar
// el z-fighting con la textura de la Tierra sin que el círculo parezca flotar
// (la huella mide miles de km, unos pocos km de altura son imperceptibles).
const FOOTPRINT_SURFACE_HEIGHT = 30000;
// Altura a la que se eleva la traza de suelo (ground track) para evitar el
// z-fighting con la textura del mapa. Se mantiene por debajo del footprint.
const GROUND_TRACK_SURFACE_HEIGHT = 20000;
const PROPAGATION_HOURS_MIN = 0;
const PROPAGATION_HOURS_MAX = Number.POSITIVE_INFINITY;
// The manual-orbit editor renders outside the normal layer runtime while a
// user is designing an orbit.  These entities intentionally have their own
// visual identity and never participate in layer selection or telemetry.
const MANUAL_ORBIT_PREVIEW_ID = "__manual-orbit-preview__";
const MANUAL_ORBIT_PREVIEW_COLOR = "#58d7ff";
const MANUAL_ORBIT_PREVIEW_LINE_WIDTH_PX = 4;
const MANUAL_ORBIT_PREVIEW_MARKER_SIZE_PX = 10;
// A design preview is a geometric aid, rather than an ephemeris history. A
// full revolution at half-degree spacing is smooth at every supported orbit
// altitude without turning a long design range into an Earth-fixed rosette.
const MANUAL_ORBIT_PREVIEW_ELLIPSE_SAMPLES = 721;
const MANUAL_ORBIT_PREVIEW_GEOMETRY_INERTIAL = "inertial-osculating-ellipse";
// Higher-order gravity models are not fixed osculating ellipses: their
// secular precession is represented by native ECI samples from the API. The samples are still
// rendered through one epoch transform, so the design view remains inertial
// rather than becoming an Earth-fixed rosette.
const MANUAL_ORBIT_PREVIEW_GEOMETRY_INERTIAL_EPHEMERIS = "inertial-eci-ephemeris";
const MANUAL_ORBIT_PREVIEW_GEOMETRY_EPHEMERIS = "earth-fixed-ephemeris";
const MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ECI = "eci";
const MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ECEF = "ecef";
const satelliteVectorEntities = new Map();
const SECONDS_PER_DAY = 86400;
const MILLISECONDS_PER_DAY = SECONDS_PER_DAY * 1000;
const JULIAN_DATE_AT_UNIX_EPOCH = 2440587.5;
const JULIAN_DATE_J2000 = 2451545.0;

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

        const { entity, orbitEntity, groundTrackEntity, footprintEntity } = state;

        // Limpiar polylines
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
const catalogEntryMetaBySatelliteId = new Map();
const oemEphemerisTrackById = new Map();
// Manual tracks are generated locally from a user-authored definition. They
// deliberately do not enter the remote catalogue or its WebSocket stream;
// their sampled SGP4 ephemeris is updated by the render loop instead.
const manualOrbitTrackById = new Map();
// A design preview is deliberately kept separate from `satelliteState` and
// the layer maps.  It can therefore be created, hidden, or discarded without
// changing the project tree, WebSocket subscriptions, or live telemetry.
let manualOrbitPreviewState = {
    viewer: null,
    pathEntity: null,
    epochMarkerEntity: null,
    groundTrackEntity: null,
    points: [],
    // `points` always use the selected preview frame. The optional ground
    // track intentionally projects those same points, so ECI and ECEF remain
    // directly comparable while designing an orbit.
    epochPoint: null,
    epochTimeMs: null,
    startTimeMs: null,
    endTimeMs: null,
    name: "",
    visible: false,
    showGroundTrack: false,
    color: MANUAL_ORBIT_PREVIEW_COLOR,
    previewReferenceFrame: MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ECI,
    geometryMode: MANUAL_ORBIT_PREVIEW_GEOMETRY_EPHEMERIS,
    vectorEntities: [],
    vectorVisible: false,
    vectorForceTerms: ["central"],
    vectorVelocity: null
};

function isLocalEphemerisTrack(id) {
    return oemEphemerisTrackById.has(id) || manualOrbitTrackById.has(id);
}

function catalogMetadataText(entry, keys, fallback = "") {
    for (const key of keys) {
        const value = entry?.[key];
        if (value === undefined || value === null) {
            continue;
        }
        const normalized = String(value).trim();
        if (normalized) {
            return normalized;
        }
    }
    return fallback;
}

// Keep the compact fields used by the rendering runtime while retaining common
// catalogue metadata for the object card.  The server passes unknown future
// fields through its page endpoint, so this makes those fields available to
// the UI without pretending they exist in today's catalogue.
function createCatalogEntryMeta(entry = {}, fallbackName = "") {
    const name = catalogMetadataText(entry, ["name", "catalogName", "catalog_name"], fallbackName);
    const operatorLabel = catalogMetadataText(entry, ["operator", "operatorName", "operator_name"]);
    const ownerLabel = catalogMetadataText(entry, ["owner", "ownerName", "owner_name"]);
    const mission = catalogMetadataText(entry, ["mission", "missionType", "mission_type"]);
    const missionType = catalogMetadataText(entry, ["missionType", "mission_type", "mission"]);

    return {
        name,
        catalogName: name,
        catalogId: catalogMetadataText(entry, ["catalogId", "catalog_id"]),
        sourceFormat: catalogMetadataText(entry, ["sourceFormat", "format"], "TLE").toUpperCase(),
        sourceOrigin: catalogMetadataText(entry, ["sourceOrigin", "source_origin"], "CATALOG").toUpperCase(),
        operator: operatorLabel.toLowerCase(),
        operatorLabel,
        owner: ownerLabel.toLowerCase(),
        ownerLabel,
        country: catalogMetadataText(entry, ["country", "countryCode", "country_code", "operatorCountry", "operator_country"]),
        agency: catalogMetadataText(entry, ["agency", "operatorAgency", "operator_agency"]),
        mission,
        missionType,
        objectId: catalogMetadataText(entry, ["objectId", "object_id", "internationalDesignator", "international_designator"]),
        launchDate: catalogMetadataText(entry, ["launchDate", "launch_date", "launchTimestamp", "launch_timestamp"]),
        launchVehicle: catalogMetadataText(entry, ["launchVehicle", "launch_vehicle", "vehicle"]),
        launchSite: catalogMetadataText(entry, ["launchSite", "launch_site", "site"]),
        tleSource: catalogMetadataText(entry, ["tleSource", "tle_source", "sourceProvider", "source_provider", "sourceName", "source_name", "provider", "providerName"]),
        updatedAt: catalogMetadataText(entry, ["updatedAt", "updated_at", "lastUpdated", "last_updated", "tleUpdatedAt", "tle_updated_at"]),
        perigee_km: Number.isFinite(Number(entry?.perigee_km)) ? Number(entry.perigee_km) : null,
        decayRisk: entry?.decayRisk === true
    };
}
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
let simulationTimelineProvider = null;
let sourceFutureOrbitHours = null;
let selectedOrbitSatelliteId = null;
const satelliteVisualOverridesById = new Map();
let orbitConfig = {
    orbit_future_show: true,
    orbit_ground_track_show: true,
    orbit_future_line_width: ORBIT_DEFAULT_LINE_WIDTH_PX,
    orbit_future_color: "#00ff88",
    orbit_selected_color: DEFAULT_SELECTED_ORBIT_COLOR,
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

function getPropagationHoursForSatellite(id) {
    const requested = Number(getSatelliteConfigValue(id, "propagation_hours", orbitConfig.propagation_hours));
    if (!Number.isFinite(requested) || requested < 0) {
        return 12;
    }
    return clamp(requested, PROPAGATION_HOURS_MIN, PROPAGATION_HOURS_MAX);
}

function finiteVector(value) {
    if (!value || typeof value !== "object") {
        return null;
    }

    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (![x, y, z].every(Number.isFinite)) {
        return null;
    }

    return { x, y, z };
}

function vectorMagnitude(value) {
    const vector = finiteVector(value);
    if (!vector) {
        return null;
    }
    return Math.hypot(vector.x, vector.y, vector.z);
}

function isEarthFixedFrame(frame) {
    const normalized = String(frame || "").trim().toUpperCase();
    return normalized === "ECEF"
        || normalized === "PEF"
        || normalized === "WGS84"
        || normalized.startsWith("ITRF");
}

function normalizeReferenceFrame(value) {
    const frame = String(value || "").trim().toUpperCase();
    return frame || null;
}

function deriveAcceleration(previousVelocity, nextVelocity, elapsedSeconds) {
    const previous = finiteVector(previousVelocity);
    const next = finiteVector(nextVelocity);
    const duration = Number(elapsedSeconds);
    // Backend state messages normally arrive once per second. Ignore an
    // implausibly short/long gap instead of exposing a noisy pseudo-value.
    if (!previous || !next || !Number.isFinite(duration) || duration < 0.05 || duration > 10) {
        return null;
    }

    return {
        x: (next.x - previous.x) / duration,
        y: (next.y - previous.y) / duration,
        z: (next.z - previous.z) / duration
    };
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

function resolveSimulationTimelineContext() {
    if (typeof simulationTimelineProvider !== "function") {
        return null;
    }

    try {
        const ctx = simulationTimelineProvider();
        if (!ctx || typeof ctx !== "object") {
            return null;
        }
        const date = ctx.date instanceof Date ? ctx.date : new Date(ctx.date || Date.now());
        if (Number.isNaN(date.getTime())) {
            return null;
        }
        const mode = String(ctx.mode || "realtime").toLowerCase();
        const rangeStart = ctx.rangeStart instanceof Date ? ctx.rangeStart : new Date(ctx.rangeStart || NaN);
        const rangeEnd = ctx.rangeEnd instanceof Date ? ctx.rangeEnd : new Date(ctx.rangeEnd || NaN);
        return {
            date,
            mode,
            rangeStart: Number.isNaN(rangeStart.getTime()) ? null : rangeStart,
            rangeEnd: Number.isNaN(rangeEnd.getTime()) ? null : rangeEnd
        };
    } catch (error) {
        logger.warn("No se pudo resolver contexto temporal de simulacion:", error);
        return null;
    }
}

function isRangeSimulationModeActive() {
    const simulationCtx = resolveSimulationTimelineContext();
    return Boolean(simulationCtx && simulationCtx.mode === "range");
}

function clipOrbitBySimulationRange(state, orbitPoints) {
    const simulationCtx = resolveSimulationTimelineContext();
    if (!simulationCtx || simulationCtx.mode !== "range") {
        return orbitPoints;
    }
    if (!simulationCtx.rangeStart || !simulationCtx.rangeEnd) {
        return orbitPoints;
    }

    const referenceMs = Number(state?.simOrbitReferenceMs);
    const horizonSeconds = Number(state?.simOrbitHorizonSeconds);
    if (!Number.isFinite(referenceMs) || !Number.isFinite(horizonSeconds) || horizonSeconds <= 0) {
        return orbitPoints;
    }
    if (!Array.isArray(orbitPoints) || orbitPoints.length < 2) {
        return orbitPoints;
    }

    const rangeStartMs = simulationCtx.rangeStart.getTime();
    const rangeEndMs = simulationCtx.rangeEnd.getTime();
    const startRatio = clamp((rangeStartMs - referenceMs) / (horizonSeconds * 1000), 0, 1);
    const endRatio = clamp((rangeEndMs - referenceMs) / (horizonSeconds * 1000), 0, 1);
    const fromRatio = Math.min(startRatio, endRatio);
    const toRatio = Math.max(startRatio, endRatio);

    const maxIndex = orbitPoints.length - 1;
    const fromIndex = Math.max(0, Math.floor(fromRatio * maxIndex));
    const toIndex = Math.min(maxIndex, Math.ceil(toRatio * maxIndex));

    if (toIndex - fromIndex < 1) {
        return orbitPoints.slice(Math.max(0, fromIndex - 1), Math.min(maxIndex + 1, toIndex + 2));
    }

    return orbitPoints.slice(fromIndex, toIndex + 1);
}

function getSimulationSampleTimes(state, positions) {
    if (!state || !Array.isArray(positions) || positions.length < 2) {
        return null;
    }

    const explicitTimes = state.simOrbitSampleTimesMs;
    if (Array.isArray(explicitTimes) && explicitTimes.length === positions.length) {
        let previous = Number.NEGATIVE_INFINITY;
        const valid = explicitTimes.every((time) => {
            const numeric = Number(time);
            if (!Number.isFinite(numeric) || numeric <= previous) return false;
            previous = numeric;
            return true;
        });
        if (valid) return explicitTimes.map(Number);
    }

    const referenceMs = Number(state.simOrbitReferenceMs);
    const horizonSeconds = Number(state.simOrbitHorizonSeconds);
    if (!Number.isFinite(referenceMs) || !Number.isFinite(horizonSeconds) || horizonSeconds <= 0) {
        return null;
    }
    return buildUniformSampleTimes(positions.length, referenceMs, referenceMs + (horizonSeconds * 1000));
}

function sampleSimulationTrackKinematics(state, simulationDate) {
    if (!state || !(simulationDate instanceof Date) || Number.isNaN(simulationDate.getTime())) {
        return null;
    }
    const positions = state.simOrbitPositions;
    const sampleTimes = getSimulationSampleTimes(state, positions);
    return sampleTimes ? sampleTrackKinematics(positions, sampleTimes, simulationDate.getTime()) : null;
}

function sampleOrbitPositionForDate(state, simulationDate) {
    const sampled = sampleSimulationTrackKinematics(state, simulationDate);
    return sampled?.position
        ? new Cesium.Cartesian3(sampled.position.x, sampled.position.y, sampled.position.z)
        : null;
}

function hasValidSimulationTrackWindow(state) {
    const startMs = Number(state?.simTrackStartMs);
    const endMs = Number(state?.simTrackEndMs);
    return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
}

function isOutsideSimulationTrackWindow(state, simulationDate) {
    if (!hasValidSimulationTrackWindow(state) || !(simulationDate instanceof Date)) {
        return false;
    }
    const simMs = simulationDate.getTime();
    if (!Number.isFinite(simMs)) {
        return false;
    }
    const startMs = Number(state.simTrackStartMs);
    const endMs = Number(state.simTrackEndMs);
    return simMs < startMs || simMs > endMs;
}

function applyOutOfTimeVisualState(id, state, outOfTime) {
    if (!state?.entity) {
        return;
    }
    if (state.isOutOfTimeVisualState === outOfTime) {
        return;
    }

    state.isOutOfTimeVisualState = outOfTime;
    const entity = state.entity;

    if (outOfTime) {
        if (entity.model) {
            entity.model.show = false;
        }
        if (entity.point) {
            entity.point.show = true;
            entity.point.color = Cesium.Color.fromCssColorString(SAT_OUT_OF_TIME_POINT_COLOR);
            entity.point.outlineColor = Cesium.Color.fromCssColorString(SAT_OUT_OF_TIME_POINT_OUTLINE_COLOR);
        }
        if (entity.label) {
            entity.label.fillColor = Cesium.Color.fromCssColorString(SAT_OUT_OF_TIME_LABEL_COLOR);
            entity.label.outlineColor = Cesium.Color.fromCssColorString(SAT_OUT_OF_TIME_LABEL_OUTLINE_COLOR);
        }
        if (state.orbitEntity) {
            state.orbitEntity.show = false;
        }
        if (state.groundTrackEntity) {
            state.groundTrackEntity.show = false;
        }
        if (state.footprintEntity) {
            state.footprintEntity.show = false;
        }
        // Se oculta completamente para que la ausencia de datos temporales sea inequívoca.
        entity.show = false;
        return;
    }

    applyLabelStyle(entity, id);
    applyVisualStyle(entity);
    applySatelliteVisibility(id, state);
}

function applySatelliteVisibility(id, state) {
    if (!state || !state.entity) {
        return true;
    }

    const isActiveLayer = activeLayerSatelliteIds.has(id);
    const outOfTime = state.isOutOfTimeVisualState === true;
    const visible = isActiveLayer && !hiddenSatelliteIds.has(id) && !outOfTime;
    state.entity.show = visible;

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

    // The former animated trail is now the fixed glow of the future orbit.
    // Ignore any value still present in an old persisted Docker volume.
    delete nextOrbitConfig.orbit_trail_show;
    delete nextOrbitConfig.orbit_trail_color;
    delete nextOrbitConfig.orbit_trail_speed_seconds;
    delete nextOrbitConfig.orbit_trail_length_percent;
    delete nextOrbitConfig.orbit_trail_line_width;
    // `orbit_width_mode` used to select a distance-scaled width. It is
    // intentionally retired: all orbit paths now use the stable visual mode.
    delete nextOrbitConfig.orbit_width_mode;
    nextOrbitConfig.orbit_future_line_width = normalizeOrbitLineWidth(nextOrbitConfig.orbit_future_line_width);

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
                if (shouldUse3DModelForSatellite(id) && state.lastOrientation) {
                    state.entity.orientation = state.lastOrientation;
                }
                applySatelliteVisibility(id, state);
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

    emitObjectStateChanged({ scope: "all-satellites", reason: "global-visualization" });
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
    const displayName = catalogEntryMetaBySatelliteId.get(String(id || ""))?.name || id || "";

    entity.label.text = displayName;
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
    if (!Array.isArray(orbitPoints)
        || typeof Cesium === "undefined"
        || !Cesium.Cartesian3
        || typeof Cesium.Cartesian3.fromRadians !== "function"
        || !Cesium.Cartographic
        || typeof Cesium.Cartographic.fromCartesian !== "function") {
        return [];
    }

    const positions = [];
    let previousLongitude = null;
    let previousLatitude = null;
    for (const point of orbitPoints) {
        const x = Number(point?.x);
        const y = Number(point?.y);
        const z = Number(point?.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            continue;
        }

        try {
            const cart = new Cesium.Cartesian3(x, y, z);
            const cartographic = Cesium.Cartographic.fromCartesian(cart);
            if (!cartographic) {
                continue;
            }

            const lon = Number(cartographic.longitude);
            const lat = Number(cartographic.latitude);
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
                continue;
            }

            const surfacePosition = Cesium.Cartesian3.fromRadians(
                lon,
                lat,
                GROUND_TRACK_SURFACE_HEIGHT
            );
            if (!surfacePosition
                || !Number.isFinite(surfacePosition.x)
                || !Number.isFinite(surfacePosition.y)
                || !Number.isFinite(surfacePosition.z)) {
                continue;
            }

            // A numerical pole/longitude wrap can emit the same surface
            // position twice. Suppressing only identical angular samples
            // prevents zero-length segments without dropping valid close
            // samples from a high-resolution LEO track.
            if (previousLongitude !== null && previousLatitude !== null) {
                const rawLongitudeDelta = Math.abs(lon - previousLongitude);
                const longitudeDelta = Math.min(rawLongitudeDelta, Math.abs((2 * Math.PI) - rawLongitudeDelta));
                if (longitudeDelta < 1e-12 && Math.abs(lat - previousLatitude) < 1e-12) {
                    continue;
                }
            }
            positions.push(surfacePosition);
            previousLongitude = lon;
            previousLatitude = lat;
        } catch {
            // A malformed or non-projectable sample must not prevent the
            // design preview from rendering its valid orbit geometry.
        }
    }

    return positions;
}

function getSurfaceGroundTrackArcType() {
    // A ground track is a path on the ellipsoid. ArcType.NONE draws the
    // chord between two projected positions, which is especially noticeable
    // at polar crossings and can look like the globe/camera is distorted.
    // GEODESIC keeps every segment on the Earth's surface. The fallback keeps
    // the renderer compatible with small Cesium test doubles and older builds.
    const arcTypes = typeof Cesium !== "undefined" ? Cesium.ArcType : null;
    return arcTypes?.GEODESIC ?? arcTypes?.NONE;
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

    // A valid design preview can arrive before Cesium finishes booting. Attach
    // it now without registering it as a satellite, layer, or telemetry source.
    if (manualOrbitPreviewState.visible && manualOrbitPreviewState.points.length >= 2) {
        renderManualOrbitPreviewEntities(viewer);
    }

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
            // Mantener el pool de entidades de renderizado.
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
        const simulationCtx = resolveSimulationTimelineContext();
        const useSimulationOrbit = Boolean(simulationCtx && simulationCtx.mode !== "realtime");
        
        for (const id in satelliteState) {
            const state = satelliteState[id];
            if (!state.entity) continue;
            if (!state.entity.show && !state.isOutOfTimeVisualState) continue;

            const outsideTrackWindow = useSimulationOrbit && isOutsideSimulationTrackWindow(state, simulationCtx?.date);
            applyOutOfTimeVisualState(id, state, outsideTrackWindow);

            // A manual orbit is a local, sampled propagated track rather than a
            // catalogue WebSocket subscription. Keep its marker moving in
            // real time from that ephemeris, while range simulation continues
            // to use the exact same samples below.
            const manualTrack = manualOrbitTrackById.get(id);
            if (manualTrack) {
                const trackDate = useSimulationOrbit ? simulationCtx?.date : new Date(now);
                const kinematics = sampleSimulationTrackKinematics(state, trackDate);
                if (kinematics?.position) {
                    const position = new Cesium.Cartesian3(
                        kinematics.position.x,
                        kinematics.position.y,
                        kinematics.position.z
                    );
                    state.previousPosition = state.renderPosition || position;
                    state.targetPosition = position;
                    state.renderPosition = position;
                    state.lastVelocity = finiteVector(kinematics.velocity);
                    state.lastAcceleration = finiteVector(kinematics.acceleration);
                    state.lastVelocityTimestampMs = trackDate.getTime();
                    state.lastMessageTime = now;
                    state.lastStateReferenceFrame = "ITRF";
                    if (shouldUse3DModelForSatellite(id) && state.lastVelocity) {
                        state.lastOrientation = calculateOrientation(kinematics.position, state.lastVelocity);
                        state.entity.orientation = state.lastOrientation;
                    }
                    state.entity.position = position;
                    continue;
                }
            }

            if (useSimulationOrbit) {
                const sampled = sampleOrbitPositionForDate(state, simulationCtx.date);
                if (sampled) {
                    state.renderPosition = sampled;
                    state.entity.position = sampled;
                    continue;
                }
                if (outsideTrackWindow) {
                    continue;
                }
            }
            
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

function normalizeOrbitLineWidth(value) {
    const requested = Number(value);
    const safeWidth = Number.isFinite(requested) && requested > 0
        ? requested
        : ORBIT_DEFAULT_LINE_WIDTH_PX;
    return Math.max(ORBIT_MIN_PIXEL_WIDTH, Math.min(ORBIT_MAX_PIXEL_WIDTH, safeWidth));
}

function createOrbitMaterial(color) {
    // One geometry provides both the line and its permanent soft halo.  Keeping
    // them in the same material avoids a duplicate animated overlay and means
    // the halo always follows the exact future-orbit width.
    return new Cesium.PolylineGlowMaterialProperty({
        color: color.withAlpha(0.92),
        glowPower: 0.28,
        taperPower: 1
    });
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
    const safeBaseWidth = normalizeOrbitLineWidth(baseWidth);
    if (selectedOrbitSatelliteId && id === selectedOrbitSatelliteId) {
        return Math.min(ORBIT_MAX_PIXEL_WIDTH, safeBaseWidth + SELECTED_ORBIT_WIDTH_BOOST_PX);
    }
    return safeBaseWidth;
}

export function setSelectedOrbitSatelliteId(id) {
    selectedOrbitSatelliteId = id ? String(id) : null;

    for (const [satId, state] of Object.entries(satelliteState)) {
        if (state?.orbitEntity?.polyline) {
            const orbitColor = getFutureOrbitColor(satId);
            state.orbitEntity.polyline.material = createOrbitMaterial(orbitColor);
            const baseWidth = Number.isFinite(state.orbitBaseWidth)
                ? state.orbitBaseWidth
                : Number(state.orbitEntity.polyline.width) || ORBIT_MIN_PIXEL_WIDTH;
            state.orbitEntity.polyline.width = getFutureOrbitRenderWidth(satId, baseWidth);
        }

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
            // The samples are already propagated in ECEF coordinates.  Joining
            // them as a geodesic would bend the orbit toward the ellipsoid.
            arcType: Cesium.ArcType.NONE,
            clampToGround: false
        }
    });
}

function clipFutureOrbitByRequestedHorizon(id, orbit) {
    if (!Array.isArray(orbit) || orbit.length < 2) {
        return orbit;
    }

    // En modo range la ventana temporal la define [start, end] de simulacion,
    // no el horizon local de propagacion de la capa.
    if (isRangeSimulationModeActive()) {
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

function ensureSatelliteState(viewer, id, cart, orientation) {
    // Usar object pool para reutilizar entidades
    const poolState = entityPool.getState(id);
    const now = Date.now();
    
    if (poolState) {
        // Unificar la referencia de estado con la entidad reutilizada del pool.
        const state = satelliteState[id] || poolState;
        satelliteState[id] = state;
        state.entity = poolState.entity;
        state.orbitEntity = poolState.orbitEntity;
        
        // Guardar posición anterior para interpolación
        state.previousPosition = state.targetPosition || state.entity.position;
        state.targetPosition = cart;
        state.lastOrientation = orientation;
        state.interpolationDuration = computeInterpolationDuration(state, now);
        state.lastUpdateTime = now;
        state.lastMessageTime = now;
        
        return state;
    }

    // Crear nuevo en pool
    const entity = entityPool.acquire(id, cart, orientation);
    const state = entityPool.getState(id) || {
        entity,
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
    const receivedAtMs = Date.now();

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
    const vel = finiteVector(satData.velocity);

    if (!pos) {
        return;
    }

    const cart = new Cesium.Cartesian3(pos.x, pos.y, pos.z);
    const orientation = shouldUse3DModelForSatellite(id) ? calculateOrientation(pos, vel || { x: 0, y: 0, z: 0 }) : undefined;

    const state = ensureSatelliteState(viewer, id, cart, orientation);
    if (isNewSatellite) {
        satelliteIdsDirty = true;
    }
    const previousVelocity = state.lastVelocity;
    const previousVelocityTimestampMs = Number(state.lastVelocityTimestampMs);
    const elapsedSeconds = (receivedAtMs - previousVelocityTimestampMs) / 1000;
    state.lastAcceleration = deriveAcceleration(previousVelocity, vel, elapsedSeconds);
    state.lastVelocity = vel;
    state.lastVelocityTimestampMs = receivedAtMs;
    // The current backend publishes earth-fixed state vectors. Retain an
    // explicit frame when the stream supplies one so the details panel does
    // not silently relabel a future non-Earth-fixed source as ECEF.
    state.lastStateReferenceFrame = normalizeReferenceFrame(
        satData.reference_frame || satData.referenceFrame || satData.ref_frame || satData.frame
    ) || state.lastStateReferenceFrame || "ITRF";

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
    mission = "",
    sourceFormat = "",
    sourceOrigin = "",
    operator = "",
    owner = "",
    decayOnly = false
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
    const normalizedSourceFormat = String(sourceFormat || "").trim().toUpperCase();
    const normalizedSourceOrigin = String(sourceOrigin || "").trim().toUpperCase();
    const normalizedOperator = String(operator || "").trim().toLowerCase();
    const normalizedOwner = String(owner || "").trim().toLowerCase();

    if (normalizedSearch) params.set("search", normalizedSearch);
    if (normalizedOrbit) params.set("orbitKind", normalizedOrbit);
    if (normalizedMission) params.set("mission", normalizedMission);
    if (normalizedSourceFormat) params.set("sourceFormat", normalizedSourceFormat);
    if (normalizedSourceOrigin) params.set("sourceOrigin", normalizedSourceOrigin);
    if (normalizedOperator) params.set("operator", normalizedOperator);
    if (normalizedOwner) params.set("owner", normalizedOwner);
    if (decayOnly === true) params.set("decayOnly", "true");

    const response = await fetch(`/api/catalog/page?${params.toString()}`, { cache: "no-cache" });
    if (!response.ok) {
        throw new Error(`No se pudo cargar página de catálogo (HTTP ${response.status})`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const ids = [];

    for (const item of items) {
        const name = String(item?.name || "").trim();
        const catalogId = String(item?.catalogId || name).trim();
        const line1 = String(item?.line1 || "").trim();
        const line2 = String(item?.line2 || "").trim();
        if (!name || !catalogId) {
            continue;
        }

        ids.push(catalogId);
        catalogSatelliteIds.add(catalogId);
        if (line1 && line2) {
            tleBySatelliteId.set(catalogId, { line1, line2 });
        }
        catalogEntryMetaBySatelliteId.set(catalogId, createCatalogEntryMeta(item, name));
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
        hasMore: Boolean(payload?.hasMore),
        operators: Array.isArray(payload?.operators) ? payload.operators : [],
        owners: Array.isArray(payload?.owners) ? payload.owners : [],
        decayPerigeeKm: Number(payload?.decayPerigeeKm) || null
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
    catalogEntryMetaBySatelliteId.clear();
    satelliteIdsDirty = true;
    catalogLoaded = false;
    const ok = await preloadSatelliteCatalog(lastCatalogUrl);

    // Refreshing the remote catalogue must never erase a local manual orbit
    // that happens to be open in the workspace.
    for (const [id, track] of manualOrbitTrackById.entries()) {
        catalogSatelliteIds.add(id);
        catalogEntryMetaBySatelliteId.set(id, createManualOrbitCatalogMeta(id, track));
        if (track.tle?.line1 && track.tle?.line2) {
            tleBySatelliteId.set(id, { ...track.tle });
        }
    }
    if (manualOrbitTrackById.size) {
        satelliteIdsDirty = true;
        catalogLoaded = true;
    }

    try {
        if (wsClient && typeof wsClient.setSubscriptions === "function") {
            const ids = Array.from(activeLayerSatelliteIds).filter((id) => !isLocalEphemerisTrack(id));
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
        catalogEntryMetaBySatelliteId.set(name, createCatalogEntryMeta(item, name));
        satelliteIdsDirty = true;
        catalogLoaded = true;
        return tle;
    } catch (error) {
        logger.warn(`No se pudo obtener TLE para ${id}:`, error);
        return null;
    }
}

export function getCatalogEntryMeta(id) {
    if (!id) {
        return null;
    }
    return catalogEntryMetaBySatelliteId.get(String(id)) || null;
}

export function getSatelliteTelemetry(id) {
    const state = satelliteState[id];
    if (!state || !state.entity) {
        return null;
    }

    const simulationCtx = resolveSimulationTimelineContext();
    const isSimulated = Boolean(simulationCtx && simulationCtx.mode === "range");
    const simulatedKinematics = isSimulated
        ? sampleSimulationTrackKinematics(state, simulationCtx.date)
        : null;
    const simulatedPosition = simulatedKinematics?.position
        ? new Cesium.Cartesian3(
            simulatedKinematics.position.x,
            simulatedKinematics.position.y,
            simulatedKinematics.position.z
        )
        : null;
    const position = simulatedPosition || state.renderPosition || state.targetPosition || state.entity.position;
    if (!position) {
        return null;
    }

    const entryMeta = getCatalogEntryMeta(id) || {};
    const sourceFormat = String(entryMeta.sourceFormat || "TLE").toUpperCase();
    const sourceOrigin = String(entryMeta.sourceOrigin || "CATALOG").toUpperCase();
    const oemTrack = oemEphemerisTrackById.get(id);
    const manualTrack = manualOrbitTrackById.get(id);
    // TLE/SGP4 state is converted from TEME to Cesium-compatible ECEF by the
    // backend. An OEM can declare another source frame, so only call it ECEF
    // when that declaration is explicitly earth-fixed.
    const sourceFrame = sourceFormat === "OEM"
        ? String(oemTrack?.refFrame || "").trim().toUpperCase() || null
        : normalizeReferenceFrame(state.lastStateReferenceFrame) || "ITRF";
    const coordinatesAreEarthFixed = isEarthFixedFrame(sourceFrame);
    const positionVector = finiteVector(position);
    // In range simulation the rendered position comes from the sampled orbit,
    // not the latest realtime WebSocket message. Never mix that realtime
    // velocity/acceleration into the simulated frame; derive both from the
    // neighbouring track samples, or leave them unavailable.
    const velocityVector = isSimulated
        ? finiteVector(simulatedKinematics?.velocity)
        : finiteVector(state.lastVelocity);
    const accelerationVector = isSimulated
        ? finiteVector(simulatedKinematics?.acceleration)
        : finiteVector(state.lastAcceleration);
    const positionEcef = coordinatesAreEarthFixed ? positionVector : null;
    const velocityEcef = coordinatesAreEarthFixed ? velocityVector : null;
    const accelerationEcef = coordinatesAreEarthFixed ? accelerationVector : null;
    const speed = vectorMagnitude(velocityVector);

    const cartographic = coordinatesAreEarthFixed ? Cesium.Cartographic.fromCartesian(position) : null;
    const latitudeDeg = cartographic ? Cesium.Math.toDegrees(cartographic.latitude) : null;
    const longitudeDeg = cartographic ? Cesium.Math.toDegrees(cartographic.longitude) : null;
    const altitudeM = cartographic ? cartographic.height : null;

    let distanceToCameraM = null;
    if (coordinatesAreEarthFixed && currentViewer?.camera?.positionWC) {
        distanceToCameraM = Cesium.Cartesian3.distance(currentViewer.camera.positionWC, position);
    }

    const speedKmS = Number.isFinite(speed) ? speed / 1000 : null;
    const speedKmH = Number.isFinite(speed) ? speed * 3.6 : null;
    const nowMs = Date.now();
    const frameTimeMs = isSimulated ? simulationCtx.date.getTime() : nowMs;
    const telemetryAgeMs = isSimulated ? null : nowMs - (state.lastMessageTime || nowMs);
    const propagationFutureHours = getPropagationHoursForSatellite(id);

    let oem = null;
    if (sourceFormat === "OEM" && oemTrack) {
        const startMs = Number(oemTrack.startTimeMs);
        const endMs = Number(oemTrack.endTimeMs);
        const hasWindow = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
        oem = {
            start_time_ms: hasWindow ? startMs : null,
            end_time_ms: hasWindow ? endMs : null,
            samples: Number.isFinite(Number(oemTrack.samples)) ? Number(oemTrack.samples) : null,
            file_name: oemTrack.fileName || null,
            object_name: oemTrack.objectName || null,
            object_id: oemTrack.objectId || null,
            center_name: oemTrack.centerName || null,
            ref_frame: oemTrack.refFrame || null,
            time_system: oemTrack.timeSystem || null,
            start_time_raw: oemTrack.startTimeRaw || null,
            stop_time_raw: oemTrack.stopTimeRaw || null,
            is_in_time_window: hasWindow ? (frameTimeMs >= startMs && frameTimeMs <= endMs) : null
        };
    }

    const earthCenterDistanceM = vectorMagnitude(positionVector);
    const footprintAngularRadius = positionEcef ? computeFootprintAngularRadius(positionEcef) : 0;
    const footprintRadiusM = footprintAngularRadius > 0
        ? Cesium.Ellipsoid.WGS84.maximumRadius * footprintAngularRadius
        : null;
    const isActive = activeLayerSatelliteIds.has(id);
    const isInView = Boolean(state.entity.show) && !hiddenSatelliteIds.has(id);

    return {
        id,
        source_format: sourceFormat,
        source_origin: sourceOrigin,
        // `position` is kept as the raw vector for legacy consumers. Its
        // explicit reference frame below determines whether it is ECEF.
        position: positionVector,
        position_ecef_m: positionEcef,
        position_frame: sourceFrame,
        geo: coordinatesAreEarthFixed ? {
            latitude_deg: latitudeDeg,
            longitude_deg: longitudeDeg,
            altitude_m: altitudeM
        } : null,
        velocity: velocityVector || { x: null, y: null, z: null },
        velocity_frame: sourceFrame,
        velocity_ecef_m_s: velocityEcef,
        acceleration_ecef_m_s2: accelerationEcef,
        earth_center_distance_m: earthCenterDistanceM,
        speed_m_s: speed,
        speed_km_s: speedKmS,
        speed_km_h: speedKmH,
        distance_to_camera_m: distanceToCameraM,
        has_future_orbit: Boolean(state.orbitEntity),
        orbit_future_enabled: shouldShowFutureOrbit(id),
        ground_track_enabled: shouldShowGroundTrack(id),
        ground_track_visible: Boolean(state.groundTrackEntity?.show) && isInView,
        footprint_enabled: shouldShowGroundTrack(id),
        footprint_radius_m: footprintRadiusM,
        propagation_future_hours: propagationFutureHours,
        oem,
        // Kept alongside the camel-case catalog metadata for consumers that
        // build their object details directly from telemetry.
        manual_orbit: manualTrack?.manualOrbit ? cloneManualOrbitValue(manualTrack.manualOrbit) : null,
        is_visible: !hiddenSatelliteIds.has(id),
        runtime_state: !isActive ? "IDLE" : isInView ? "ACTIVE" : "OUT OF VIEW",
        telemetry_age_ms: telemetryAgeMs,
        timestamp_ms: frameTimeMs
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
        activeLayerSatelliteIds.add(id);
        activeLayerIdsDirty = true;
        if (!isLocalEphemerisTrack(id)) {
            wsClient?.subscribe([id]);
        }
        emitObjectStateChanged({ sourceId: id, reason: "activation" });
        return true;
    } else {
        if (oemEphemerisTrackById.has(id)) {
            removeOemEphemerisTrack(id);
            emitObjectStateChanged({ sourceId: id, reason: "activation" });
            return true;
        }
        if (manualOrbitTrackById.has(id)) {
            removeManualOrbitTrack(id);
            emitObjectStateChanged({ sourceId: id, reason: "activation" });
            return true;
        }

        activeLayerSatelliteIds.delete(id);
        activeLayerIdsDirty = true;
        if (!isLocalEphemerisTrack(id)) {
            wsClient?.unsubscribe([id]);
        }

        // Al quitar capa, ocultar y liberar recursos render de ese objeto.
        const state = satelliteState[id];
        if (state) {
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
        emitObjectStateChanged({ sourceId: id, reason: "activation" });
        return true;
    }
}

export function setAllSatelliteLayersActive(active) {
    const ids = getSatelliteIds();
    if (!ids.length) {
        return { added: 0, skipped: 0 };
    }

    if (active) {
        const nextIds = ids;
        activeLayerSatelliteIds.clear();
        nextIds.forEach((id) => activeLayerSatelliteIds.add(id));
        activeLayerIdsDirty = true;
        wsClient?.setSubscriptions(nextIds.filter((id) => !isLocalEphemerisTrack(id)));
        emitObjectStateChanged({ scope: "all-satellites", reason: "activation" });
        return {
            added: nextIds.length,
            skipped: 0
        };
    }

    activeLayerSatelliteIds.clear();
    activeLayerIdsDirty = true;
    wsClient?.setSubscriptions([]);

    // A manual orbit is a workspace-local authored object, so removing all
    // layers must discard it as well rather than leaving it hidden in the next
    // project session.
    for (const manualId of [...manualOrbitTrackById.keys()]) {
        removeManualOrbitTrack(manualId);
    }

    for (const id of ids) {
        const state = satelliteState[id];
        if (!state) {
            continue;
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

    emitObjectStateChanged({ scope: "all-satellites", reason: "activation" });

    return { added: 0, skipped: 0 };
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

    emitObjectStateChanged({ scope: "all-satellites", reason: "visibility" });
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

    emitObjectStateChanged({ sourceId: id, reason: "visibility" });
}

function renderFutureOrbitForState(viewer, id, state, orbitPayload) {
    if (!viewer || !state) {
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

    const horizonClippedOrbit = clipFutureOrbitByRequestedHorizon(id, orbit);
    const effectiveHorizonHoursRaw = Number(getPropagationHoursForSatellite(id));
    const effectiveHorizonHours = Number.isFinite(effectiveHorizonHoursRaw) && effectiveHorizonHoursRaw > 0
        ? effectiveHorizonHoursRaw
        : (Number.isFinite(sourceFutureOrbitHours) && sourceFutureOrbitHours > 0 ? sourceFutureOrbitHours : 12);

    const simulationCtx = resolveSimulationTimelineContext();
    const isOutOfTimeInRange = Boolean(
        simulationCtx
        && simulationCtx.mode === "range"
        && isOutsideSimulationTrackWindow(state, simulationCtx.date)
    );

    applyOutOfTimeVisualState(id, state, isOutOfTimeInRange);
    if (isOutOfTimeInRange) {
        if (state.orbitEntity) {
            viewer.entities.remove(state.orbitEntity);
            state.orbitEntity = null;
        }
        remove2DOverlays(viewer, state);
        return;
    }

    const hasRangeWindow = Boolean(
        simulationCtx
        && simulationCtx.mode === "range"
        && simulationCtx.rangeStart
        && simulationCtx.rangeEnd
        && simulationCtx.rangeEnd.getTime() > simulationCtx.rangeStart.getTime()
    );

    state.simOrbitPositions = toCartesianArray(horizonClippedOrbit);
    const sourceSampleTimes = Array.isArray(state.simTrackSampleTimesMs)
        ? state.simTrackSampleTimesMs
        : null;
    // OEM samples can be irregularly spaced. Preserve their real timestamps
    // so both rendering and simulated telemetry interpolate the same track.
    state.simOrbitSampleTimesMs = sourceSampleTimes && sourceSampleTimes.length === orbit.length
        ? sourceSampleTimes.slice(0, horizonClippedOrbit.length)
        : null;
    if (hasRangeWindow) {
        const rangeStartMs = simulationCtx.rangeStart.getTime();
        const rangeEndMs = simulationCtx.rangeEnd.getTime();
        const spanSeconds = Math.max(1, (rangeEndMs - rangeStartMs) / 1000);
        // En simulacion por rango, la orbita se mapea al tramo [inicio, fin].
        state.simOrbitReferenceMs = rangeStartMs;
        state.simOrbitHorizonSeconds = spanSeconds;
    } else {
        state.simOrbitReferenceMs = Date.now();
        state.simOrbitHorizonSeconds = Math.max(1, effectiveHorizonHours * 3600);
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

    const visibleOrbit = clipOrbitBySimulationRange(state, horizonClippedOrbit);

    if (visibleOrbit.length < 2) {
        if (state.orbitEntity) {
            viewer.entities.remove(state.orbitEntity);
            state.orbitEntity = null;
        }
        remove2DOverlays(viewer, state);
        return;
    }

    // The path of every confirmed object, including a manually authored one,
    // uses the propagated earth-fixed samples. Those are the physical states
    // used for its moving marker, range simulation and ground track, so the
    // confirmed scene cannot silently diverge from the operational orbit.
    const orbitPositions = toCartesianArray(visibleOrbit);
    const futureColor = getFutureOrbitColor(id);
    const configuredFutureWidth = Number(getSatelliteConfigValue(id, "orbit_future_line_width", orbitConfig.orbit_future_line_width));
    const futureWidthBase = normalizeOrbitLineWidth(configuredFutureWidth);
    state.orbitBaseWidth = futureWidthBase;
    const futureWidth = getFutureOrbitRenderWidth(id, futureWidthBase);

    if (futureOrbitVisible && !state.orbitEntity) {
        state.orbitEntity = createOrbitEntity(viewer, id, orbitPositions, futureColor, futureWidth);
    } else if (futureOrbitVisible && state.orbitEntity) {
        state.orbitEntity.polyline.positions = orbitPositions;
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
        orbit_horizon_hours: satData?.orbit_horizon_hours
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
            orbit_future_line_width: normalizeOrbitLineWidth(getSatelliteConfigValue(satId, "orbit_future_line_width", orbitConfig.orbit_future_line_width)),
            orbit_future_color: String(getSatelliteConfigValue(satId, "orbit_future_color", orbitConfig.orbit_future_color) || "#7fd7ff"),
            orbit_selected_color: String(getSatelliteConfigValue(satId, "orbit_selected_color", orbitConfig.orbit_selected_color) || DEFAULT_SELECTED_ORBIT_COLOR),
            propagation_hours: getPropagationHoursForSatellite(satId),
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
    delete next.orbit_trail_show;
    delete next.orbit_trail_color;
    delete next.orbit_trail_speed_seconds;
    delete next.orbit_trail_length_percent;
    delete next.orbit_trail_line_width;
    const allowedFields = [
        "orbit_future_show",
        "orbit_ground_track_show",
        "orbit_future_line_width",
        "orbit_future_color",
        "orbit_selected_color",
        "propagation_hours",
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
        emitObjectStateChanged({ sourceId: satId, reason: "visualization" });
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

    if (!shouldShowGroundTrack(satId)) {
        remove2DOverlays(currentViewer, state);
    }

    if (state.lastOrbitPayload) {
        renderFutureOrbitForState(currentViewer, satId, state, state.lastOrbitPayload);
    }

    emitObjectStateChanged({ sourceId: satId, reason: "visualization" });
}

export function clearSatelliteVisualizationConfig(id) {
    setSatelliteVisualizationConfig(id, {
        orbit_future_show: null,
        orbit_ground_track_show: null,
        orbit_future_line_width: null,
        orbit_future_color: null,
        orbit_selected_color: null,
        propagation_hours: null,
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

function vectorPosition(state) {
    const position = state?.renderPosition || state?.targetPosition;
    return position && Number.isFinite(position.x) ? position : null;
}

function normalizedDirection(vector, fallback) {
    const candidate = vector && Number.isFinite(vector.x) ? new Cesium.Cartesian3(vector.x, vector.y, vector.z) : fallback;
    const magnitude = Cesium.Cartesian3.magnitude(candidate);
    return magnitude > 0 ? Cesium.Cartesian3.divideByScalar(candidate, magnitude, new Cesium.Cartesian3()) : new Cesium.Cartesian3(1, 0, 0);
}

function vectorArrowMaterial(color) {
    return Cesium.PolylineArrowMaterialProperty
        ? new Cesium.PolylineArrowMaterialProperty(color)
        : color;
}

function vectorEndpoint(origin, direction) {
    const length = Math.max(30000, Cesium.Cartesian3.magnitude(origin) * .075);
    return Cesium.Cartesian3.add(
        origin,
        Cesium.Cartesian3.multiplyByScalar(normalizedDirection(direction, new Cesium.Cartesian3(1, 0, 0)), length, new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
    );
}

function vectorLabelCanvasPosition(viewer, position) {
    const scene = viewer?.scene;
    if (!scene || !position) return null;
    try {
        const projected = typeof Cesium.SceneTransforms?.wgs84ToWindowCoordinates === "function"
            ? Cesium.SceneTransforms.wgs84ToWindowCoordinates(scene, position)
            : typeof scene.cartesianToCanvasCoordinates === "function"
                ? scene.cartesianToCanvasCoordinates(position)
                : null;
        const x = Number(projected?.x);
        const y = Number(projected?.y);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    } catch {
        // An endpoint can temporarily be outside the current frustum while a
        // camera transition is running.  Cesium will hide it; retain the
        // ordinary label offset until it has a canvas position again.
        return null;
    }
}

function vectorLabelViewport(viewer) {
    const canvas = viewer?.scene?.canvas || viewer?.canvas;
    const width = Number(canvas?.clientWidth || canvas?.width);
    const height = Number(canvas?.clientHeight || canvas?.height);
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}

function createVectorLabelOffsetResolver(viewer, specs, getSource, getPosition) {
    let signature = "";
    let offsets = specs.map(() => ({ x: 0, y: -7 }));

    return (index, result) => {
        const source = getSource();
        const origin = getPosition(source);
        const viewport = vectorLabelViewport(viewer);
        const entries = origin
            ? specs.map(([label, _color, getDirection]) => {
                const position = vectorEndpoint(origin, getDirection(source));
                const projected = vectorLabelCanvasPosition(viewer, position);
                return { label, x: projected?.x, y: projected?.y };
            })
            : specs.map(([label]) => ({ label, x: Number.NaN, y: Number.NaN }));
        // Round sub-pixel motion so all label callbacks in a Cesium frame share
        // one layout, while camera movement still reflows nearby arrow labels.
        const nextSignature = `${viewport?.width || 0}x${viewport?.height || 0}:${entries.map((entry) => (
            Number.isFinite(entry.x) && Number.isFinite(entry.y)
                ? `${Math.round(entry.x * 2) / 2},${Math.round(entry.y * 2) / 2}`
                : "-"
        )).join(";")}`;
        if (nextSignature !== signature) {
            offsets = layoutVectorLabelOffsets(entries, viewport);
            signature = nextSignature;
        }
        const offset = offsets[index] || { x: 0, y: -7 };
        if (result && typeof result === "object") {
            result.x = offset.x;
            result.y = offset.y;
            return result;
        }
        return new Cesium.Cartesian2(offset.x, offset.y);
    };
}

function attitudeAxis(directionSource, axis) {
    return (source) => Cesium.Matrix3.getColumn(
        Cesium.Matrix3.fromQuaternion(directionSource(source) || Cesium.Quaternion.IDENTITY),
        axis,
        new Cesium.Cartesian3()
    );
}

function earthFixedCelestialPosition(inertialPosition, time) {
    if (!inertialPosition || !time || typeof Cesium.Matrix3?.multiplyByVector !== "function") {
        return null;
    }

    const transforms = Cesium.Transforms;
    if (!transforms) {
        return null;
    }

    // Simon1994 returns Earth-centred inertial coordinates, whereas Cesium
    // entities in this application are rendered in the Earth-fixed frame.
    // Prefer the exact ICRF transform for the viewer's clock instant. Cesium
    // can briefly return `undefined` while its XYS data is loading, so retain
    // its synchronous TEME/pseudo-fixed transform as a visually stable bridge
    // instead of mixing an inertial vector into an Earth-fixed scene.
    const transform = typeof transforms.computeIcrfToFixedMatrix === "function"
        ? transforms.computeIcrfToFixedMatrix(time)
        : null;
    const fallbackTransform = !transform && typeof transforms.computeTemeToPseudoFixedMatrix === "function"
        ? transforms.computeTemeToPseudoFixedMatrix(time)
        : null;
    const matrix = transform || fallbackTransform;
    if (!matrix) {
        return null;
    }

    return Cesium.Matrix3.multiplyByVector(matrix, inertialPosition, new Cesium.Cartesian3());
}

function illuminationDirection(kind, viewer, getPosition) {
    return (source) => {
        const method = kind === "sun"
            ? Cesium.Simon1994PlanetaryPositions?.computeSunPositionInEarthInertialFrame
            : Cesium.Simon1994PlanetaryPositions?.computeMoonPositionInEarthInertialFrame;
        // Do not use JulianDate.now()/Date.now() here. In range simulation the
        // lighting vectors must stay at the exact same instant as Cesium's
        // globe, satellite and clock. CallbackProperty reevaluates this on
        // every render, so changing the timeline updates the directions too.
        const time = viewer?.clock?.currentTime;
        if (typeof method === "function" && time) {
            const inertialPosition = method(time, new Cesium.Cartesian3());
            const position = earthFixedCelestialPosition(inertialPosition, time);
            if (position && Cesium.Cartesian3.magnitude(position) > 0) {
                const origin = getPosition(source);
                // Point from the satellite, not from the Earth's centre. The
                // distinction is especially visible for the Moon.
                return origin
                    ? { x: position.x - origin.x, y: position.y - origin.y, z: position.z - origin.z }
                    : position;
            }
        }
        return kind === "sun" ? { x: 1, y: .15, z: .08 } : { x: -.35, y: .8, z: .25 };
    };
}

function forceDirection(term, getPosition, getVelocity) {
    return (source) => {
        const position = getPosition(source);
        if (!position) return null;
        if (String(term).toLowerCase() === "drag") {
            const velocity = getVelocity(source);
            return velocity ? Cesium.Cartesian3.negate(new Cesium.Cartesian3(velocity.x, velocity.y, velocity.z), new Cesium.Cartesian3()) : null;
        }
        // The radial direction is the dominant component of the selected
        // gravity terms at this scale. It keeps the displayed force vector
        // meaningful without pretending that the overlay encodes magnitude.
        return Cesium.Cartesian3.negate(position, new Cesium.Cartesian3());
    };
}

function createVectorEntities(viewer, idPrefix, getSource, getPosition, getOrientation, getVelocity, forceTerms = []) {
    const specs = [
        ["X", "#ff5d62", attitudeAxis(getOrientation, 0)],
        ["Y", "#61df81", attitudeAxis(getOrientation, 1)],
        ["Z", "#58a6ff", attitudeAxis(getOrientation, 2)],
        ["v", "#ffd166", getVelocity],
        ["Sol", "#ffae42", illuminationDirection("sun", viewer, getPosition)],
        ["Luna", "#d9ddff", illuminationDirection("moon", viewer, getPosition)],
        ...forceTerms.map((term) => [`F ${String(term).toUpperCase()}`, "#f177c0", forceDirection(term, getPosition, getVelocity)])
    ];
    const labelOffset = createVectorLabelOffsetResolver(viewer, specs, getSource, getPosition);
    return specs.map(([label, color, getDirection], index) => {
        const colorValue = Cesium.Color.fromCssColorString(color);
        const endpoint = () => {
            const source = getSource();
            const origin = getPosition(source);
            return origin ? vectorEndpoint(origin, getDirection(source)) : undefined;
        };
        return viewer.entities.add({
            id: `${idPrefix}-${index}`,
            name: label,
            polyline: {
                positions: new Cesium.CallbackProperty(() => {
                    const source = getSource();
                    const origin = getPosition(source);
                    const end = origin ? vectorEndpoint(origin, getDirection(source)) : null;
                    return end ? [origin, end] : [];
                }, false),
                width: 2.5,
                material: vectorArrowMaterial(colorValue),
                arcType: Cesium.ArcType.NONE,
                clampToGround: false
            },
            position: new Cesium.CallbackProperty(endpoint, false),
            label: {
                text: label,
                font: "10px sans-serif",
                fillColor: colorValue,
                pixelOffset: new Cesium.CallbackProperty((_time, result) => labelOffset(index, result), false),
                showBackground: true,
                backgroundColor: Cesium.Color.BLACK.withAlpha(.6),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
    });
}

/** Draws arrowed attitude axes, kinematics, illumination and active force directions. */
export function setSatelliteVectorVisualization(id, visible, forceTerms = ["central"]) {
    const satId = String(id || "").trim();
    const existing = satelliteVectorEntities.get(satId);
    if (!visible || !satId || !currentViewer) {
        existing?.forEach((entity) => currentViewer?.entities.remove(entity));
        satelliteVectorEntities.delete(satId);
        return;
    }
    if (existing || !satelliteState[satId]) return;
    satelliteVectorEntities.set(satId, createVectorEntities(
        currentViewer,
        `${satId}-vectors`,
        () => satelliteState[satId],
        vectorPosition,
        (state) => state?.lastOrientation,
        (state) => state?.lastVelocity,
        forceTerms
    ));
}

function normalizeOemUnit(value, kind) {
    const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
    if (kind === "position") {
        if (["m", "meter", "meters", "metre", "metres"].includes(normalized)) return "m";
        if (["km", "kilometer", "kilometers", "kilometre", "kilometres"].includes(normalized)) return "km";
    }
    if (kind === "velocity") {
        if (["m/s", "mps", "meter/s", "meters/s", "metre/s", "metres/s"].includes(normalized)) return "m/s";
        if (["km/s", "kmps", "kilometer/s", "kilometers/s", "kilometre/s", "kilometres/s"].includes(normalized)) return "km/s";
    }
    return null;
}

function parseOemUnitComment(comment, metadata) {
    const text = String(comment || "").trim();
    const positionMatch = /(?:ORBIT_)?(?:POSITION_)?UNIT\s*=\s*([^,;\s]+)/i.exec(text);
    const velocityMatch = /(?:ORBIT_)?VELOCITY_UNIT\s*=\s*([^,;\s]+)/i.exec(text);
    const positionUnit = normalizeOemUnit(positionMatch?.[1], "position");
    const velocityUnit = normalizeOemUnit(velocityMatch?.[1], "velocity");
    if (positionUnit) metadata.positionUnit = positionUnit;
    if (velocityUnit) metadata.velocityUnit = velocityUnit;
}

function inferOemPositionUnit(points, metadata) {
    if (metadata.positionUnit) return metadata.positionUnit;
    const largestRadius = points.reduce((largest, point) => Math.max(largest, Math.hypot(point.x, point.y, point.z)), 0);
    // CCSDS OEM coordinates are kilometres. Older Orbit builds incorrectly
    // wrote the backend's metre vectors while declaring TEME. Keep those files
    // usable without re-scaling current standard OEM products.
    return largestRadius >= 1000000 ? "m" : "km";
}

function normalizeOemPointsToRuntimeUnits(points, metadata) {
    const positionUnit = inferOemPositionUnit(points, metadata);
    const velocityUnit = metadata.velocityUnit || (positionUnit === "km" ? "km/s" : "m/s");
    const positionScale = positionUnit === "km" ? 1000 : 1;
    const velocityScale = velocityUnit === "km/s" ? 1000 : 1;
    const declaredFrame = normalizeReferenceFrame(metadata.declaredRefFrame || metadata.refFrame);
    const isLegacyOrbitExport = positionUnit === "m"
        && declaredFrame === "TEME"
        && String(metadata.originator || "").trim().toLowerCase() === "orbit";

    metadata.positionUnit = positionUnit;
    metadata.velocityUnit = velocityUnit;
    metadata.legacyOrbitEcef = isLegacyOrbitExport;
    // The historical exporter emitted backend Earth-fixed vectors but marked
    // them TEME. Only recognise this narrowly identified Orbit legacy form;
    // third-party TEME OEMs remain TEME and are never labelled ECEF.
    metadata.refFrame = isLegacyOrbitExport ? "ITRF" : declaredFrame;

    return points.map((point) => ({
        timeMs: point.timeMs,
        x: point.x * positionScale,
        y: point.y * positionScale,
        z: point.z * positionScale,
        velocity: point.velocity
            ? {
                x: point.velocity.x * velocityScale,
                y: point.velocity.y * velocityScale,
                z: point.velocity.z * velocityScale
            }
            : null
    }));
}

export function parseOemEphemerisContent(content, fileName = "") {
    const text = String(content || "");
    const objectName = /OBJECT_NAME\s*=\s*(.+)/i.exec(text)?.[1]?.trim()
        || /OBJECT_ID\s*=\s*(.+)/i.exec(text)?.[1]?.trim()
        || String(fileName || "OEM Imported").replace(/\.[^.]+$/, "").trim()
        || "OEM Imported";

    const metadata = {
        objectName,
        objectId: null,
        centerName: null,
        refFrame: null,
        declaredRefFrame: null,
        timeSystem: null,
        startTimeRaw: null,
        stopTimeRaw: null,
        originator: null,
        positionUnit: null,
        velocityUnit: null,
        fileName: String(fileName || "").trim() || null
    };

    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const points = [];
    for (const line of lines) {
        const kvMatch = /^([A-Z_]+)\s*=\s*(.+)$/i.exec(line);
        if (kvMatch) {
            const key = String(kvMatch[1] || "").toUpperCase();
            const value = String(kvMatch[2] || "").trim();
            if (key === "OBJECT_NAME" && value) metadata.objectName = value;
            if (key === "OBJECT_ID" && value) metadata.objectId = value;
            if (key === "CENTER_NAME" && value) metadata.centerName = value;
            if (key === "REF_FRAME" && value) {
                metadata.refFrame = value;
                metadata.declaredRefFrame = value;
            }
            if (key === "TIME_SYSTEM" && value) metadata.timeSystem = value;
            if (key === "START_TIME" && value) metadata.startTimeRaw = value;
            if (key === "STOP_TIME" && value) metadata.stopTimeRaw = value;
            if (key === "ORIGINATOR" && value) metadata.originator = value;
            if (key === "COMMENT") parseOemUnitComment(value, metadata);
        }

        if (/^(CCSDS_|CREATION_DATE|ORIGINATOR|META_|OBJECT_|CENTER_|REF_FRAME|TIME_SYSTEM|START_TIME|STOP_TIME|COMMENT)/i.test(line)) {
            continue;
        }

        const parts = line.split(/\s+/);
        if (parts.length < 4) {
            continue;
        }

        const time = new Date(parts[0]);
        if (Number.isNaN(time.getTime())) {
            continue;
        }

        const x = Number(parts[1]);
        const y = Number(parts[2]);
        const z = Number(parts[3]);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            continue;
        }

        const vx = Number(parts[4]);
        const vy = Number(parts[5]);
        const vz = Number(parts[6]);
        points.push({
            timeMs: time.getTime(),
            x,
            y,
            z,
            velocity: [vx, vy, vz].every(Number.isFinite) ? { x: vx, y: vy, z: vz } : null
        });
    }

    points.sort((a, b) => a.timeMs - b.timeMs);
    return { objectName, points: normalizeOemPointsToRuntimeUnits(points, metadata), metadata };
}

function buildUniqueCustomTrackId(baseName) {
    const base = String(baseName || "OEM Imported").trim() || "OEM Imported";
    if (!satelliteState[base]) {
        return base;
    }
    let n = 2;
    while (satelliteState[`${base} (${n})`]) {
        n += 1;
    }
    return `${base} (${n})`;
}

export function importOemEphemerisTrack(content, fileName = "") {
    if (!currentViewer) {
        throw new Error("Viewer no inicializado.");
    }

    const parsed = parseOemEphemerisContent(content, fileName);
    if (!Array.isArray(parsed.points) || parsed.points.length < 2) {
        throw new Error("OEM invalido: no se encontraron suficientes muestras de ephemeris.");
    }

    const id = buildUniqueCustomTrackId(parsed.objectName);
    const first = parsed.points[0];
    const firstPosition = new Cesium.Cartesian3(first.x, first.y, first.z);
    const state = ensureSatelliteState(currentViewer, id, firstPosition, Cesium.Quaternion.IDENTITY);
    state.simTrackStartMs = parsed.points[0].timeMs;
    state.simTrackEndMs = parsed.points[parsed.points.length - 1].timeMs;
    state.simTrackSampleTimesMs = parsed.points.map((point) => point.timeMs);
    state.lastStateReferenceFrame = normalizeReferenceFrame(parsed.metadata?.refFrame);

    const orbit = parsed.points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    const spanHours = Math.max(1 / 3600, (parsed.points[parsed.points.length - 1].timeMs - parsed.points[0].timeMs) / 3600000);

    state.lastOrbitPayload = {
        orbit,
        orbit_horizon_hours: spanHours
    };

    catalogSatelliteIds.add(id);
    catalogEntryMetaBySatelliteId.set(id, createCatalogEntryMeta({
        name: parsed.metadata?.objectName || id,
        objectId: parsed.metadata?.objectId || "",
        sourceFormat: "OEM",
        sourceOrigin: "CUSTOM"
    }, id));

    activeLayerSatelliteIds.add(id);
    oemEphemerisTrackById.set(id, {
        startTimeMs: parsed.points[0].timeMs,
        endTimeMs: parsed.points[parsed.points.length - 1].timeMs,
        samples: orbit.length,
        fileName: parsed.metadata?.fileName || String(fileName || "").trim() || null,
        objectName: parsed.metadata?.objectName || id,
        objectId: parsed.metadata?.objectId || null,
        centerName: parsed.metadata?.centerName || null,
        refFrame: parsed.metadata?.refFrame || null,
        declaredRefFrame: parsed.metadata?.declaredRefFrame || null,
        positionUnit: parsed.metadata?.positionUnit || null,
        velocityUnit: parsed.metadata?.velocityUnit || null,
        legacyOrbitEcef: parsed.metadata?.legacyOrbitEcef === true,
        timeSystem: parsed.metadata?.timeSystem || null,
        startTimeRaw: parsed.metadata?.startTimeRaw || null,
        stopTimeRaw: parsed.metadata?.stopTimeRaw || null
    });
    activeLayerIdsDirty = true;
    hiddenSatelliteIds.delete(id);
    satelliteIdsDirty = true;
    catalogLoaded = true;

    renderFutureOrbitForState(currentViewer, id, state, state.lastOrbitPayload);
    applySatelliteVisibility(id, state);

    emitObjectStateChanged({ sourceId: id, reason: "oem-import" });

    return {
        id,
        points: orbit.length,
        startTimeMs: parsed.points[0].timeMs,
        endTimeMs: parsed.points[parsed.points.length - 1].timeMs
    };
}

function isAvailableManualOrbitId(id) {
    return !satelliteState[id] && !catalogSatelliteIds.has(id) && !manualOrbitTrackById.has(id);
}

function normalizeRequestedManualOrbitId(value) {
    const id = String(value || "").trim();
    // Persisted ids remain local implementation details. Restrict restored
    // values to the same namespace generated by this module so a project file
    // cannot impersonate an arbitrary catalogue object.
    return /^manual:[a-z0-9][a-z0-9_-]{0,95}$/i.test(id) ? id : null;
}

function buildUniqueManualOrbitId(name, preferredId = null) {
    const requestedId = normalizeRequestedManualOrbitId(preferredId);
    if (requestedId && isAvailableManualOrbitId(requestedId)) {
        return requestedId;
    }
    const compactName = String(name || "Manual Orbit")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 56) || "orbit";
    const base = `manual:${compactName}`;
    if (isAvailableManualOrbitId(base)) {
        return base;
    }
    let index = 2;
    while (!isAvailableManualOrbitId(`${base}-${index}`)) {
        index += 1;
    }
    return `${base}-${index}`;
}

function parseManualEphemerisPoint(point) {
    const timeValue = point?.time || point?.timestamp || point?.timeUtc || point?.time_utc;
    const timeMs = new Date(timeValue || "").getTime();
    const position = finiteVector(point?.position || point?.positionEcefM || point?.position_ecef_m || point);
    const velocity = finiteVector(point?.velocity || point?.velocityEcefMS || point?.velocity_ecef_m_s);
    if (!Number.isFinite(timeMs) || !position) {
        return null;
    }
    return { timeMs, x: position.x, y: position.y, z: position.z, velocity };
}

function parseManualEciEphemerisPoint(point) {
    const eci = point?.eci && typeof point.eci === "object" ? point.eci : point;
    const timeValue = point?.time
        || point?.timestamp
        || point?.timeUtc
        || point?.time_utc
        || eci?.time
        || eci?.timestamp
        || eci?.timeUtc
        || eci?.time_utc;
    const timeMs = new Date(timeValue || "").getTime();
    // Native manual propagators return ECI metres under `position_eci_m` when
    // a wrapper is needed.  Accept the compact `{ time, x, y, z }` transport
    // form too, which keeps this renderer forward-compatible with a streamed
    // ECI ephemeris.
    const position = finiteVector(
        eci?.position_eci_m
        || eci?.positionEciM
        || eci?.position_eci
        || eci?.positionEci
        || eci?.position
        || eci
    );
    if (!Number.isFinite(timeMs) || !position) {
        return null;
    }
    return { timeMs, x: position.x, y: position.y, z: position.z };
}

function getManualOrbitEphemeris(payload = {}) {
    return payload?.ephemeris && typeof payload.ephemeris === "object"
        ? payload.ephemeris
        : payload;
}

function getManualOrbitEphemerisPoints(payload = {}) {
    const ephemeris = getManualOrbitEphemeris(payload);
    return (Array.isArray(ephemeris?.points) ? ephemeris.points : [])
        .map(parseManualEphemerisPoint)
        .filter(Boolean)
        .sort((left, right) => left.timeMs - right.timeMs);
}

function getManualOrbitEciEphemerisPoints(payload = {}) {
    const ephemeris = getManualOrbitEphemeris(payload);
    const payloadPropagation = payload?.propagation && typeof payload.propagation === "object"
        ? payload.propagation
        : null;
    const ephemerisPropagation = ephemeris?.propagation && typeof ephemeris.propagation === "object"
        ? ephemeris.propagation
        : null;
    // The nested point contract is native to Orbit's runtime. The adjacent
    // `eci_points` aliases keep the preview tolerant of older integrations
    // which expose a separate ECI series beside propagation metadata.
    const embeddedEciPoints = Array.isArray(ephemeris?.points)
        ? ephemeris.points.filter((point) => point?.eci && typeof point.eci === "object")
        : [];
    const candidates = [
        // This is the native runtime contract: every ITRF point carries its
        // matching source ECI sample. Keeping time on the parent point avoids
        // a second list that can drift out of alignment with the ephemeris.
        embeddedEciPoints,
        payload?.eci_points,
        payload?.eciPoints,
        ephemeris?.eci_points,
        ephemeris?.eciPoints,
        payloadPropagation?.eci_points,
        payloadPropagation?.eciPoints,
        ephemerisPropagation?.eci_points,
        ephemerisPropagation?.eciPoints
    ];

    for (const candidate of candidates) {
        if (!Array.isArray(candidate)) {
            continue;
        }
        const points = candidate
            .map(parseManualEciEphemerisPoint)
            .filter(Boolean)
            .sort((left, right) => left.timeMs - right.timeMs);
        if (points.length >= 2) {
            return points;
        }
    }
    return [];
}

const MANUAL_ORBIT_PROPAGATOR_ALIASES = Object.freeze({
    sgp4: "sgp4",
    "two-body": "two-body",
    two_body: "two-body",
    twobody: "two-body",
    kepler: "two-body",
    keplerian: "two-body",
    j2: "j2",
    "j2-analytic": "j2",
    j2_analytic: "j2",
    "j2-secular": "j2",
    j2_secular: "j2",
    "j2-j3-j4": "j2-j3-j4",
    j2_j3_j4: "j2-j3-j4",
    j2j3j4: "j2-j3-j4",
    "j2-j3-j4-secular": "j2-j3-j4",
    "cowell-rk4": "cowell-rk4",
    cowell_rk4: "cowell-rk4",
    cowell: "cowell-rk4",
    rk4: "cowell-rk4",
    "sgp-4": "sgp4"
});

const MANUAL_ORBIT_NUMERICAL_INTEGRATOR_ALIASES = Object.freeze({
    rk4: "rk4",
    "rk-4": "rk4",
    "runge-kutta-4": "rk4",
    rungekutta4: "rk4"
});

const MANUAL_ORBIT_FORCE_TERM_ORDER = Object.freeze(["central", "j2", "j3", "j4", "drag"]);

const MANUAL_ORBIT_FORCE_TERM_ALIASES = Object.freeze({
    central: "central",
    "central-gravity": "central",
    "two-body": "central",
    twobody: "central",
    kepler: "central",
    keplerian: "central",
    j2: "j2",
    j3: "j3",
    j4: "j4",
    drag: "drag",
    "atmospheric-drag": "drag",
    atmospheric: "drag"
});

function normalizeManualOrbitPropagator(value, fallback = "sgp4") {
    const fallbackValue = String(fallback || "sgp4").trim().toLowerCase().replace(/[\s_+/]+/g, "-") || "sgp4";
    const normalized = String(value || "").trim().toLowerCase().replace(/[\s_+/]+/g, "-");
    if (!normalized) {
        return MANUAL_ORBIT_PROPAGATOR_ALIASES[fallbackValue] || fallbackValue;
    }
    // Preserve an unknown value instead of silently changing a future
    // propagator saved in a project. Known historical/editor aliases are
    // always saved again as their canonical API identifier.
    return MANUAL_ORBIT_PROPAGATOR_ALIASES[normalized] || normalized;
}

function normalizeManualOrbitNumericalIntegrator(value, fallback = "rk4") {
    const fallbackValue = String(fallback || "rk4").trim().toLowerCase().replace(/[\s_+/]+/g, "-") || "rk4";
    const normalized = String(value || "").trim().toLowerCase().replace(/[\s_+/]+/g, "-");
    if (!normalized) {
        return MANUAL_ORBIT_NUMERICAL_INTEGRATOR_ALIASES[fallbackValue] || fallbackValue;
    }
    // Keep unknown future methods intact when loading a project generated by
    // a newer client. The execution service decides whether it is installed.
    return MANUAL_ORBIT_NUMERICAL_INTEGRATOR_ALIASES[normalized] || normalized;
}

function manualOrbitForceTermValues(value) {
    if (Array.isArray(value)) return value.flatMap((entry) => manualOrbitForceTermValues(entry));
    if (value === undefined || value === null) return [];
    if (typeof value !== "string") return [value];
    const compact = value.trim().toLowerCase().replace(/[\s_+/]+/g, "-");
    if (["j2-j3-j4", "j2j3j4"].includes(compact)) return ["j2", "j3", "j4"];
    return value.split(/[,;+|]/g);
}

function normalizeManualOrbitForceTerms(value, fallback = ["central", "j2", "j3", "j4"]) {
    const raw = value === undefined || value === null ? fallback : value;
    const seen = new Set(["central"]);
    for (const entry of manualOrbitForceTermValues(raw)) {
        const normalized = String(entry ?? "").trim().toLowerCase().replace(/[\s_+/]+/g, "-");
        if (!normalized) continue;
        // Runtime metadata should retain an unknown future term rather than
        // rewriting a project merely because this browser predates it.
        seen.add(MANUAL_ORBIT_FORCE_TERM_ALIASES[normalized] || normalized);
    }
    const known = MANUAL_ORBIT_FORCE_TERM_ORDER.filter((term) => seen.has(term));
    const future = [...seen].filter((term) => !MANUAL_ORBIT_FORCE_TERM_ORDER.includes(term));
    return [...known, ...future];
}

function manualOrbitLegacyModelFromForceTerms(forceTerms) {
    const terms = normalizeManualOrbitForceTerms(forceTerms).filter((term) => term !== "drag");
    if (terms.some((term) => !MANUAL_ORBIT_FORCE_TERM_ORDER.includes(term))) {
        return null;
    }
    if (terms.includes("j3") || terms.includes("j4")) {
        return terms.includes("j2") && terms.includes("j3") && terms.includes("j4")
            ? "j2-j3-j4"
            : null;
    }
    if (terms.includes("j2")) return "j2";
    return "two-body";
}

function manualOrbitForceTermsFromLegacyModel(value, fallback = "two-body") {
    switch (normalizeManualOrbitPropagator(value, fallback)) {
        case "two-body":
            return ["central"];
        case "j2":
            return ["central", "j2"];
        default:
            return ["central", "j2", "j3", "j4"];
    }
}

function readManualOrbitPropagator(payload = {}, ephemeris = getManualOrbitEphemeris(payload)) {
    const payloadPropagation = payload?.propagation && typeof payload.propagation === "object"
        ? payload.propagation
        : null;
    const ephemerisPropagation = ephemeris?.propagation && typeof ephemeris.propagation === "object"
        ? ephemeris.propagation
        : null;
    const payloadMetadata = payload?.propagator_metadata || payload?.propagatorMetadata || null;
    const ephemerisMetadata = ephemeris?.propagator_metadata || ephemeris?.propagatorMetadata || null;
    const values = [
        payload?.propagator,
        payload?.propagator_id,
        payload?.propagatorId,
        payloadMetadata?.id,
        payloadMetadata?.model_id,
        payloadMetadata?.modelId,
        payloadPropagation?.propagator,
        ephemeris?.propagator,
        ephemeris?.propagator_id,
        ephemeris?.propagatorId,
        ephemerisMetadata?.id,
        ephemerisMetadata?.model_id,
        ephemerisMetadata?.modelId,
        ephemerisPropagation?.propagator
    ];
    for (const value of values) {
        if (String(value || "").trim()) {
            return normalizeManualOrbitPropagator(value);
        }
    }
    return normalizeManualOrbitPropagator(null);
}

function normalizeManualOrbitPreviewReferenceFrame(value, fallback = MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ECI) {
    const fallbackFrame = String(fallback || "").trim().toLowerCase() === MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ECEF
        ? MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ECEF
        : MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ECI;
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) {
        return fallbackFrame;
    }
    if (["ecef", "itrf", "earth-fixed", "earth_fixed"].includes(normalized)) {
        return MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ECEF;
    }
    if (["eci", "inertial"].includes(normalized)) {
        return MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ECI;
    }
    return fallbackFrame;
}

function firstFiniteManualOrbitValue(source, keys) {
    if (!source || typeof source !== "object") {
        return null;
    }
    for (const key of keys) {
        const value = source[key];
        if (value === undefined || value === null || value === "") {
            continue;
        }
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric;
        }
    }
    return null;
}

function readManualOrbitPreviewElements(payload = {}) {
    const ephemeris = getManualOrbitEphemeris(payload);
    const source = payload?.keplerian && typeof payload.keplerian === "object"
        ? payload.keplerian
        : ephemeris?.keplerian && typeof ephemeris.keplerian === "object"
            ? ephemeris.keplerian
            : null;
    if (!source) {
        return null;
    }

    const semiMajorAxisKm = firstFiniteManualOrbitValue(source, ["semi_major_axis_km", "semiMajorAxisKm"]);
    const eccentricity = firstFiniteManualOrbitValue(source, ["eccentricity"]);
    const inclinationDeg = firstFiniteManualOrbitValue(source, ["inclination_deg", "inclinationDeg"]);
    const raanDeg = firstFiniteManualOrbitValue(source, ["raan_deg", "raanDeg"]);
    const argumentOfPerigeeDeg = firstFiniteManualOrbitValue(source, [
        "argument_of_perigee_deg",
        "argumentOfPerigeeDeg",
        "argument_of_periapsis_deg",
        "argumentOfPeriapsisDeg"
    ]);
    const trueAnomalyDeg = firstFiniteManualOrbitValue(source, ["true_anomaly_deg", "trueAnomalyDeg"]);
    if (!(
        Number.isFinite(semiMajorAxisKm) && semiMajorAxisKm > 0
        && Number.isFinite(eccentricity) && eccentricity >= 0 && eccentricity < 1
        && Number.isFinite(inclinationDeg)
        && Number.isFinite(raanDeg)
        && Number.isFinite(argumentOfPerigeeDeg)
        && Number.isFinite(trueAnomalyDeg)
    )) {
        return null;
    }

    const semiLatusRectumKm = semiMajorAxisKm * (1 - (eccentricity * eccentricity));
    if (!(semiLatusRectumKm > 0)) {
        return null;
    }
    return {
        semiMajorAxisKm,
        eccentricity,
        inclinationRad: inclinationDeg * Math.PI / 180,
        raanRad: raanDeg * Math.PI / 180,
        argumentOfPerigeeRad: argumentOfPerigeeDeg * Math.PI / 180,
        trueAnomalyRad: trueAnomalyDeg * Math.PI / 180,
        semiLatusRectumKm
    };
}

function gmstRadiansAtManualOrbitEpoch(epochTimeMs) {
    if (!Number.isFinite(epochTimeMs)) {
        return null;
    }
    const julianDate = (epochTimeMs / MILLISECONDS_PER_DAY) + JULIAN_DATE_AT_UNIX_EPOCH;
    const centuries = (julianDate - JULIAN_DATE_J2000) / 36525;
    // This is deliberately the same GMST approximation used by the backend's
    // SGP4 TEME -> ITRF adapter. It is an epoch alignment for presentation,
    // not a second propagator hidden in the browser.
    const seconds = 67310.54841
        + ((876600 * 3600 + 8640184.812866) * centuries)
        + (0.093104 * centuries * centuries)
        - (0.0000062 * centuries * centuries * centuries);
    const radians = (seconds / 240) * Math.PI / 180;
    const wrapped = radians % (2 * Math.PI);
    return wrapped < 0 ? wrapped + (2 * Math.PI) : wrapped;
}

function inertialPositionToEpochFixed(positionEciM, epochGmstRad) {
    const cosGmst = Math.cos(epochGmstRad);
    const sinGmst = Math.sin(epochGmstRad);
    return {
        x: (positionEciM.x * cosGmst) + (positionEciM.y * sinGmst),
        y: (-positionEciM.x * sinGmst) + (positionEciM.y * cosGmst),
        z: positionEciM.z
    };
}

function inertialPositionForTrueAnomaly(elements, trueAnomalyRad) {
    const radiusKm = elements.semiLatusRectumKm / (1 + (elements.eccentricity * Math.cos(trueAnomalyRad)));
    const perifocalXKm = radiusKm * Math.cos(trueAnomalyRad);
    const perifocalYKm = radiusKm * Math.sin(trueAnomalyRad);
    const cosRaan = Math.cos(elements.raanRad);
    const sinRaan = Math.sin(elements.raanRad);
    const cosInclination = Math.cos(elements.inclinationRad);
    const sinInclination = Math.sin(elements.inclinationRad);
    const cosArgument = Math.cos(elements.argumentOfPerigeeRad);
    const sinArgument = Math.sin(elements.argumentOfPerigeeRad);

    // R3(RAAN) * R1(inclination) * R3(argument of perigee), the same
    // classical-element convention used by the manual editor/backend.
    return {
        x: (
            ((cosRaan * cosArgument) - (sinRaan * sinArgument * cosInclination)) * perifocalXKm
            + ((-cosRaan * sinArgument) - (sinRaan * cosArgument * cosInclination)) * perifocalYKm
        ) * 1000,
        y: (
            ((sinRaan * cosArgument) + (cosRaan * sinArgument * cosInclination)) * perifocalXKm
            + ((-sinRaan * sinArgument) + (cosRaan * cosArgument * cosInclination)) * perifocalYKm
        ) * 1000,
        z: ((sinArgument * sinInclination * perifocalXKm) + (cosArgument * sinInclination * perifocalYKm)) * 1000
    };
}

/**
 * Build one osculating ellipse in the input ECI frame and align it to Cesium's
 * Earth-fixed rendering frame once, at the selected epoch.  Transforming every
 * point with its own timestamp would instead encode Earth rotation into a
 * multi-day ITRF path and produce the rosette seen in the design editor.
 */
function buildEpochAnchoredInertialPreview(payload, epochTimeMs) {
    const elements = readManualOrbitPreviewElements(payload);
    const epochGmstRad = gmstRadiansAtManualOrbitEpoch(epochTimeMs);
    if (!elements || !Number.isFinite(epochGmstRad)) {
        return null;
    }

    const epochPosition = inertialPositionToEpochFixed(
        inertialPositionForTrueAnomaly(elements, elements.trueAnomalyRad),
        epochGmstRad
    );
    if (!finiteVector(epochPosition)) {
        return null;
    }

    const points = [];
    for (let index = 0; index < MANUAL_ORBIT_PREVIEW_ELLIPSE_SAMPLES; index += 1) {
        const fraction = index / (MANUAL_ORBIT_PREVIEW_ELLIPSE_SAMPLES - 1);
        const trueAnomalyRad = elements.trueAnomalyRad + (fraction * 2 * Math.PI);
        const position = inertialPositionToEpochFixed(
            inertialPositionForTrueAnomaly(elements, trueAnomalyRad),
            epochGmstRad
        );
        if (!finiteVector(position)) {
            return null;
        }
        points.push({
            timeMs: epochTimeMs,
            x: position.x,
            y: position.y,
            z: position.z
        });
    }
    return {
        points,
        epochPoint: { timeMs: epochTimeMs, ...epochPosition },
        geometryMode: MANUAL_ORBIT_PREVIEW_GEOMETRY_INERTIAL
    };
}

function firstManualOrbitTimestampMs(...values) {
    for (const value of values) {
        if (value === undefined || value === null || value === "") {
            continue;
        }
        const timeMs = value instanceof Date ? value.getTime() : new Date(value).getTime();
        if (Number.isFinite(timeMs)) {
            return timeMs;
        }
    }
    return null;
}

function toManualOrbitUtcString(timeMs) {
    if (!Number.isFinite(timeMs)) {
        return null;
    }
    const date = new Date(timeMs);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function resolveManualOrbitEpochTimeMs(payload, ephemeris, points) {
    return firstManualOrbitTimestampMs(
        payload?.epoch,
        payload?.epochUtc,
        payload?.epoch_utc,
        ephemeris?.epoch,
        ephemeris?.epochUtc,
        ephemeris?.epoch_utc
    ) ?? points?.[0]?.timeMs ?? null;
}

function resolveManualOrbitRange(payload, ephemeris, points) {
    const propagation = payload?.propagation && typeof payload.propagation === "object"
        ? payload.propagation
        : {};
    const startTimeMs = firstManualOrbitTimestampMs(
        propagation.start_time,
        propagation.startTime,
        payload?.start_time,
        payload?.startTime,
        ephemeris?.start_time,
        ephemeris?.startTime,
        points?.[0]?.timeMs
    );
    const endTimeMs = firstManualOrbitTimestampMs(
        propagation.end_time,
        propagation.endTime,
        payload?.end_time,
        payload?.endTime,
        ephemeris?.end_time,
        ephemeris?.endTime,
        points?.[points.length - 1]?.timeMs
    );
    return { startTimeMs, endTimeMs };
}

function findNearestManualOrbitPoint(points, targetTimeMs) {
    if (!Array.isArray(points) || !points.length) {
        return null;
    }
    if (!Number.isFinite(targetTimeMs)) {
        return points[0];
    }
    return points.reduce((closest, point) => (
        Math.abs(point.timeMs - targetTimeMs) < Math.abs(closest.timeMs - targetTimeMs) ? point : closest
    ));
}

function buildEpochAnchoredEciEphemerisPreview(eciPoints, epochTimeMs) {
    const epochGmstRad = gmstRadiansAtManualOrbitEpoch(epochTimeMs);
    if (!Array.isArray(eciPoints) || eciPoints.length < 2 || !Number.isFinite(epochGmstRad)) {
        return null;
    }

    // Cesium's globe uses an Earth-fixed scene. Rotate every native ECI sample
    // with the *same* epoch angle so the trajectory stays in the requested
    // inertial frame while preserving the model's genuine precession from the API.
    const points = [];
    for (const point of eciPoints) {
        const position = inertialPositionToEpochFixed(point, epochGmstRad);
        if (!finiteVector(position)) {
            continue;
        }
        points.push({
            timeMs: point.timeMs,
            x: position.x,
            y: position.y,
            z: position.z
        });
    }
    if (points.length < 2) {
        return null;
    }

    const epochEciPoint = findNearestManualOrbitPoint(eciPoints, epochTimeMs) || eciPoints[0];
    const epochPosition = inertialPositionToEpochFixed(epochEciPoint, epochGmstRad);
    if (!finiteVector(epochPosition)) {
        return null;
    }
    return {
        points,
        epochPoint: { timeMs: epochEciPoint.timeMs, ...epochPosition },
        geometryMode: MANUAL_ORBIT_PREVIEW_GEOMETRY_INERTIAL_EPHEMERIS
    };
}

function cloneManualOrbitValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => cloneManualOrbitValue(item));
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneManualOrbitValue(item)]));
    }
    return value;
}

function normalizeManualOrbitDefinitionSource(value) {
    const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
    return ["state-vector", "state_vector", "statevector", "state"].includes(normalized)
        ? "state-vector"
        : "keplerian";
}

function readManualOrbitGroundTrackEnabled(payload, fallback = true) {
    const preview = payload?.preview && typeof payload.preview === "object" ? payload.preview : {};
    const values = [
        payload?.groundTrackEnabled,
        payload?.ground_track_enabled,
        preview.showGroundTrack,
        preview.groundTrackEnabled,
        preview.ground_track_enabled
    ];
    for (const value of values) {
        if (typeof value === "boolean") {
            return value;
        }
    }
    return fallback;
}

const DEFAULT_MANUAL_ORBIT_OBJECT_METADATA = Object.freeze({
    objectType: "satellite",
    missionType: "",
    operator: "",
    country: "",
    launchDate: ""
});

const DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS = Object.freeze({
    atmosphericDrag: false,
    dragCoefficient: 2.2,
    areaM2: 1,
    massKg: 100,
    forceTerms: Object.freeze(["central"]),
    cowellGravityModel: "two-body",
    numericalIntegrator: "rk4"
});

function manualOrbitRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function manualOrbitNestedRecord(payload, camelKey, snakeKey) {
    const source = manualOrbitRecord(payload);
    if (source[camelKey] && typeof source[camelKey] === "object" && !Array.isArray(source[camelKey])) {
        return source[camelKey];
    }
    if (source[snakeKey] && typeof source[snakeKey] === "object" && !Array.isArray(source[snakeKey])) {
        return source[snakeKey];
    }
    return {};
}

function manualOrbitText(source, keys, fallback = "") {
    const record = manualOrbitRecord(source);
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
            return record[key] === undefined || record[key] === null ? "" : String(record[key]).trim();
        }
    }
    return fallback;
}

function manualOrbitNumber(source, keys, fallback, { minimum = 0, strictlyPositive = false } = {}) {
    const record = manualOrbitRecord(source);
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) {
            continue;
        }
        const numeric = Number(record[key]);
        if (Number.isFinite(numeric) && (strictlyPositive ? numeric > minimum : numeric >= minimum)) {
            return numeric;
        }
        return fallback;
    }
    return fallback;
}

function manualOrbitBoolean(source, keys, fallback = false) {
    const record = manualOrbitRecord(source);
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) {
            continue;
        }
        const value = record[key];
        if (typeof value === "boolean") return value;
        if (typeof value === "number") return value !== 0;
        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            if (["true", "1", "yes", "on"].includes(normalized)) return true;
            if (["false", "0", "no", "off", ""].includes(normalized)) return false;
        }
    }
    return fallback;
}

function manualOrbitValue(source, keys) {
    const record = manualOrbitRecord(source);
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(record, key)
            && record[key] !== undefined
            && record[key] !== null) {
            return { found: true, value: record[key] };
        }
    }
    return { found: false, value: undefined };
}

function manualOrbitHasLegacyPropagationOptionSignal(source) {
    const record = manualOrbitRecord(source);
    // Old Cowell records did not have forceTerms or a gravity-model field;
    // seeing any drag setting or numerical-integrator choice is therefore the
    // compatibility marker for the historical central + J2 + J3 + J4 default.
    // An empty modern object is intentionally not treated as legacy.
    return [
        "atmosphericDrag", "atmospheric_drag",
        "dragCoefficient", "drag_coefficient",
        "areaM2", "area_m2",
        "massKg", "mass_kg",
        "numericalIntegrator", "numerical_integrator"
    ].some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function manualOrbitForceTermsFromOptions(source, fallback = DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS) {
    const suppliedTerms = manualOrbitValue(source, ["forceTerms", "force_terms", "gravityTerms", "gravity_terms"]);
    if (suppliedTerms.found) {
        // The new array contract is authoritative, including whether drag is
        // active. Do not combine a stale atmospheric_drag alias with it.
        return normalizeManualOrbitForceTerms(suppliedTerms.value);
    }

    const legacyModel = manualOrbitValue(source, ["cowellGravityModel", "cowell_gravity_model", "forceModel", "force_model"]);
    const baseTerms = manualOrbitForceTermsFromLegacyModel(
        legacyModel.found
            ? legacyModel.value
            : manualOrbitHasLegacyPropagationOptionSignal(source)
                ? "j2-j3-j4"
                : fallback.cowellGravityModel,
        fallback.cowellGravityModel
    );
    const dragEnabled = manualOrbitBoolean(
        source,
        ["atmosphericDrag", "atmospheric_drag"],
        fallback.atmosphericDrag
    );
    return normalizeManualOrbitForceTerms([...baseTerms, ...(dragEnabled ? ["drag"] : [])]);
}

function manualOrbitFixedEngineTerms(propagator) {
    if (propagator === "two-body" || propagator === "sgp4") return ["central"];
    if (propagator === "j2") return ["central", "j2"];
    if (propagator === "j2-j3-j4") return ["central", "j2", "j3", "j4"];
    return null;
}

function readManualOrbitObjectMetadata(payload, ephemeris) {
    const source = {
        ...manualOrbitNestedRecord(ephemeris, "objectMetadata", "object_metadata"),
        ...manualOrbitNestedRecord(payload, "objectMetadata", "object_metadata")
    };
    return {
        objectType: manualOrbitText(source, ["objectType", "object_type", "type"], DEFAULT_MANUAL_ORBIT_OBJECT_METADATA.objectType) || "satellite",
        missionType: manualOrbitText(source, ["missionType", "mission_type", "mission"], DEFAULT_MANUAL_ORBIT_OBJECT_METADATA.missionType),
        operator: manualOrbitText(source, ["operator", "operatorName", "operator_name"], DEFAULT_MANUAL_ORBIT_OBJECT_METADATA.operator),
        country: manualOrbitText(source, ["country", "countryCode", "country_code", "operatorCountry", "operator_country"], DEFAULT_MANUAL_ORBIT_OBJECT_METADATA.country),
        launchDate: manualOrbitText(source, ["launchDate", "launch_date"], DEFAULT_MANUAL_ORBIT_OBJECT_METADATA.launchDate)
    };
}

function readManualOrbitPropagationOptions(payload, ephemeris, propagator) {
    const source = {
        ...manualOrbitNestedRecord(ephemeris, "propagationOptions", "propagation_options"),
        ...manualOrbitNestedRecord(payload, "propagationOptions", "propagation_options")
    };
    let forceTerms = manualOrbitForceTermsFromOptions(source);
    const fixedEngineTerms = manualOrbitFixedEngineTerms(propagator);
    // A response can carry a remembered Cowell draft alongside another
    // engine. Metadata must report only the forces that engine actually uses.
    if (fixedEngineTerms) {
        forceTerms = fixedEngineTerms;
    }
    forceTerms = normalizeManualOrbitForceTerms(forceTerms);
    return {
        atmosphericDrag: forceTerms.includes("drag"),
        dragCoefficient: manualOrbitNumber(source, ["dragCoefficient", "drag_coefficient"], DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.dragCoefficient),
        areaM2: manualOrbitNumber(source, ["areaM2", "area_m2"], DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.areaM2, { strictlyPositive: true }),
        massKg: manualOrbitNumber(source, ["massKg", "mass_kg"], DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.massKg, { strictlyPositive: true }),
        forceTerms,
        cowellGravityModel: manualOrbitLegacyModelFromForceTerms(forceTerms),
        numericalIntegrator: normalizeManualOrbitNumericalIntegrator(
            manualOrbitText(source, ["numericalIntegrator", "numerical_integrator"], DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.numericalIntegrator),
            DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.numericalIntegrator
        )
    };
}

function buildManualOrbitMetadata(payload, ephemeris, points) {
    const epochTimeMs = resolveManualOrbitEpochTimeMs(payload, ephemeris, points);
    const { startTimeMs, endTimeMs } = resolveManualOrbitRange(payload, ephemeris, points);
    const propagation = payload?.propagation && typeof payload.propagation === "object"
        ? payload.propagation
        : {};
    const stepSeconds = Number(propagation.step_seconds ?? propagation.stepSeconds ?? payload?.step_seconds ?? payload?.stepSeconds);
    const propagator = readManualOrbitPropagator(payload, ephemeris);
    return {
        definitionSource: normalizeManualOrbitDefinitionSource(payload?.definition_source || payload?.definitionSource),
        propagator,
        epochUtc: toManualOrbitUtcString(epochTimeMs),
        startTime: toManualOrbitUtcString(startTimeMs),
        endTime: toManualOrbitUtcString(endTimeMs),
        stepSeconds: Number.isFinite(stepSeconds) && stepSeconds > 0 ? stepSeconds : null,
        groundTrackEnabled: readManualOrbitGroundTrackEnabled(
            payload,
            orbitConfig.orbit_ground_track_show !== false
        ),
        keplerian: cloneManualOrbitValue(payload?.keplerian || null),
        stateVector: cloneManualOrbitValue(payload?.state_vector || payload?.stateVector || null),
        summary: cloneManualOrbitValue(payload?.orbit_summary || payload?.orbitSummary || null),
        objectMetadata: readManualOrbitObjectMetadata(payload, ephemeris),
        propagationOptions: readManualOrbitPropagationOptions(payload, ephemeris, propagator)
    };
}

function createManualOrbitCatalogMeta(id, track) {
    const objectMetadata = manualOrbitRecord(track?.manualOrbit?.objectMetadata || track?.manualOrbit?.object_metadata);
    const metadata = createCatalogEntryMeta({
        name: track?.name || id,
        objectId: "MANUAL",
        sourceFormat: "MANUAL",
        sourceOrigin: "USER",
        operator: objectMetadata.operator,
        country: objectMetadata.country,
        missionType: objectMetadata.missionType,
        launchDate: objectMetadata.launchDate
    }, id);
    metadata.objectType = manualOrbitText(objectMetadata, ["objectType", "object_type", "type"], "satellite") || "satellite";
    metadata.manualOrbit = cloneManualOrbitValue(track?.manualOrbit || null);
    return metadata;
}

function manualOrbitPreviewSnapshot() {
    const preview = manualOrbitPreviewState;
    return {
        id: MANUAL_ORBIT_PREVIEW_ID,
        name: preview.name || "Manual Orbit preview",
        pointCount: preview.points.length,
        previewReferenceFrame: preview.previewReferenceFrame,
        geometryMode: preview.geometryMode,
        epochTimeMs: preview.epochTimeMs,
        startTimeMs: preview.startTimeMs,
        endTimeMs: preview.endTimeMs,
        visible: preview.visible,
        rendered: Boolean(preview.pathEntity && preview.epochMarkerEntity),
        showGroundTrack: preview.showGroundTrack
    };
}

function canRenderManualOrbitPreview(viewer) {
    return Boolean(
        viewer?.entities
        && typeof viewer.entities.add === "function"
        && typeof viewer.entities.remove === "function"
        && typeof Cesium !== "undefined"
        && Cesium.Cartesian3
        && Cesium.ArcType
        && Cesium.Color
        && Cesium.PolylineGlowMaterialProperty
    );
}

function removeManualOrbitPreviewEntities() {
    const preview = manualOrbitPreviewState;
    const viewer = preview.viewer;
    if (viewer?.entities && typeof viewer.entities.remove === "function") {
        for (const entity of [preview.pathEntity, preview.epochMarkerEntity, preview.groundTrackEntity, ...(preview.vectorEntities || [])]) {
            if (!entity) {
                continue;
            }
            try {
                viewer.entities.remove(entity);
            } catch {
                // The viewer may already be destroyed/recreated. Dropping our
                // references still guarantees that a future preview is clean.
            }
        }
    }
    preview.pathEntity = null;
    preview.epochMarkerEntity = null;
    preview.groundTrackEntity = null;
    preview.vectorEntities = [];
    preview.viewer = null;
}

function manualPreviewPosition(preview) {
    const point = preview?.epochPoint
        || findNearestManualOrbitPoint(preview?.points || [], preview?.epochTimeMs)
        || preview?.points?.[0];
    return point && Number.isFinite(point.x) ? new Cesium.Cartesian3(point.x, point.y, point.z) : null;
}

function renderManualOrbitPreviewVectors(preview, viewer) {
    if (!preview.vectorVisible || !viewer?.entities) return;
    if (preview.vectorEntities?.length) return;
    const origin = manualPreviewPosition(preview);
    if (!origin) return;
    const previewVelocity = preview.vectorVelocity || { x: 0, y: 1, z: 0 };
    const orientation = calculateOrientation(origin, previewVelocity);
    preview.vectorEntities = createVectorEntities(
        viewer,
        `${MANUAL_ORBIT_PREVIEW_ID}-vectors`,
        () => manualOrbitPreviewState,
        manualPreviewPosition,
        () => orientation,
        (state) => state?.vectorVelocity || previewVelocity,
        preview.vectorForceTerms || ["central"]
    );
}

/** Toggle arrowed axes and vectors for the current manual-orbit design preview. */
export function setManualOrbitPreviewVectorVisualization(visible, manualOrbit = {}) {
    const preview = manualOrbitPreviewState;
    const forceTerms = manualOrbit?.propagationOptions?.forceTerms || manualOrbit?.forceTerms || preview.vectorForceTerms || ["central"];
    const stateVector = manualOrbit?.stateVector || manualOrbit?.state_vector || {};
    const velocity = stateVector.velocityEciKmS || stateVector.velocity_eci_km_s || stateVector.velocity || stateVector;
    const x = Number(velocity?.x ?? velocity?.velocityXKmS);
    const y = Number(velocity?.y ?? velocity?.velocityYKmS);
    const z = Number(velocity?.z ?? velocity?.velocityZKmS);
    preview.vectorVisible = visible === true;
    preview.vectorForceTerms = Array.isArray(forceTerms) && forceTerms.length ? forceTerms : ["central"];
    preview.vectorVelocity = [x, y, z].every(Number.isFinite) ? { x: x * 1000, y: y * 1000, z: z * 1000 } : null;
    if (!preview.vectorVisible) {
        preview.vectorEntities?.forEach((entity) => preview.viewer?.entities?.remove(entity));
        preview.vectorEntities = [];
        return manualOrbitPreviewSnapshot();
    }
    // Inputs can change while design mode is open. Rebuild this small overlay
    // so arrows always reflect the current epoch state vector and force set.
    preview.vectorEntities?.forEach((entity) => preview.viewer?.entities?.remove(entity));
    preview.vectorEntities = [];
    renderManualOrbitPreviewVectors(preview, preview.viewer || currentViewer);
    return manualOrbitPreviewSnapshot();
}

function hideManualOrbitPreviewEntities() {
    for (const entity of [
        manualOrbitPreviewState.pathEntity,
        manualOrbitPreviewState.epochMarkerEntity,
        manualOrbitPreviewState.groundTrackEntity,
        ...(manualOrbitPreviewState.vectorEntities || [])
    ]) {
        if (entity) {
            entity.show = false;
        }
    }
}

function renderManualOrbitPreviewEntities(viewer = currentViewer) {
    const preview = manualOrbitPreviewState;
    if (!preview.visible || preview.points.length < 2) {
        return manualOrbitPreviewSnapshot();
    }

    if (!canRenderManualOrbitPreview(viewer)) {
        // Avoid retaining entities in a stale viewer when the application is
        // being torn down or recreated; the sampled preview itself remains
        // queued for the next valid viewer.
        if (preview.viewer && preview.viewer !== viewer) {
            removeManualOrbitPreviewEntities();
        }
        return manualOrbitPreviewSnapshot();
    }

    if (preview.viewer && preview.viewer !== viewer) {
        removeManualOrbitPreviewEntities();
    }
    preview.viewer = viewer;

    const positions = preview.points.map((point) => new Cesium.Cartesian3(point.x, point.y, point.z));
    const previewColor = getOpaqueColor(preview.color, MANUAL_ORBIT_PREVIEW_COLOR);
    const lineWidth = Math.max(ORBIT_MIN_PIXEL_WIDTH, Math.min(ORBIT_MAX_PIXEL_WIDTH, MANUAL_ORBIT_PREVIEW_LINE_WIDTH_PX));
    if (!preview.pathEntity) {
        preview.pathEntity = viewer.entities.add({
            id: `${MANUAL_ORBIT_PREVIEW_ID}-path`,
            polyline: {
                positions,
                width: lineWidth,
                material: createOrbitMaterial(previewColor),
                arcType: Cesium.ArcType.NONE,
                clampToGround: false
            }
        });
    } else {
        preview.pathEntity.polyline.positions = positions;
        preview.pathEntity.polyline.width = lineWidth;
        preview.pathEntity.polyline.material = createOrbitMaterial(previewColor);
        preview.pathEntity.show = true;
    }

    const epochPoint = preview.epochPoint
        || findNearestManualOrbitPoint(preview.points, preview.epochTimeMs)
        || preview.points[0];
    const epochPosition = new Cesium.Cartesian3(epochPoint.x, epochPoint.y, epochPoint.z);
    if (!preview.epochMarkerEntity) {
        preview.epochMarkerEntity = viewer.entities.add({
            id: `${MANUAL_ORBIT_PREVIEW_ID}-epoch`,
            position: epochPosition,
            point: {
                pixelSize: MANUAL_ORBIT_PREVIEW_MARKER_SIZE_PX,
                color: Cesium.Color.WHITE,
                outlineColor: previewColor,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
    } else {
        preview.epochMarkerEntity.position = epochPosition;
        preview.epochMarkerEntity.point.color = Cesium.Color.WHITE;
        preview.epochMarkerEntity.point.outlineColor = previewColor;
        preview.epochMarkerEntity.show = true;
    }

    if (preview.showGroundTrack) {
        // Keep the projected line in the same frame as the orbit currently
        // being inspected: the epoch-anchored ECI ellipse in ECI mode, or the
        // raw propagated ITRF/ECEF ephemeris in ECEF mode.
        const groundTrackPositions = toSurfaceGroundTrack(preview.points);
        if (groundTrackPositions.length >= 2) {
            const groundTrackColor = previewColor.withAlpha(0.72);
            if (!preview.groundTrackEntity) {
                preview.groundTrackEntity = viewer.entities.add({
                    id: `${MANUAL_ORBIT_PREVIEW_ID}-ground-track`,
                    polyline: {
                        positions: groundTrackPositions,
                        width: ORBIT_MIN_PIXEL_WIDTH,
                        material: createOrbitMaterial(groundTrackColor),
                        arcType: getSurfaceGroundTrackArcType(),
                        clampToGround: false
                    }
                });
            } else {
                preview.groundTrackEntity.polyline.positions = groundTrackPositions;
                preview.groundTrackEntity.polyline.material = createOrbitMaterial(groundTrackColor);
                preview.groundTrackEntity.polyline.arcType = getSurfaceGroundTrackArcType();
                preview.groundTrackEntity.polyline.clampToGround = false;
                preview.groundTrackEntity.show = true;
            }
        } else if (preview.groundTrackEntity) {
            try {
                viewer.entities.remove(preview.groundTrackEntity);
            } catch {
                // Nothing else owns this dedicated preview entity.
            }
            preview.groundTrackEntity = null;
        }
    } else if (preview.groundTrackEntity) {
        try {
            viewer.entities.remove(preview.groundTrackEntity);
        } catch {
            // Nothing else owns this dedicated preview entity.
        }
        preview.groundTrackEntity = null;
    }

    renderManualOrbitPreviewVectors(preview, viewer);

    return manualOrbitPreviewSnapshot();
}

/**
 * Render (or replace) the transient design preview returned by
 * `POST /api/manual-orbits`. In `eci` mode it prefers native ECI samples for
 * manual Two-body and gravity-model engines, otherwise it renders one epoch-anchored inertial
 * ellipse; in `ecef` mode it renders the returned ITRF ephemeris.
 * It never creates a layer, a satellite state, or a telemetry source. Its
 * optional ground track is a dedicated transient entity projected from that
 * same selected geometry. If Cesium is not
 * ready yet, the valid preview is queued and will be rendered by
 * `initSatelliteReceiver` later.
 *
 * @param {object} payload manual-orbit response or its `ephemeris` payload
 * @param {object} options `{ color?: string, viewer?: Viewer, showGroundTrack?: boolean, previewReferenceFrame?: "eci" | "ecef" }`
 * @returns {{ id: string, pointCount: number, rendered: boolean, visible: boolean }}
 */
export function renderManualOrbitPreview(payload = {}, options = {}) {
    const ephemeris = getManualOrbitEphemeris(payload);
    const ephemerisPoints = getManualOrbitEphemerisPoints(payload);
    const preliminaryEpochTimeMs = resolveManualOrbitEpochTimeMs(payload, ephemeris, ephemerisPoints);
    const previewReferenceFrame = normalizeManualOrbitPreviewReferenceFrame(options?.previewReferenceFrame);
    const propagator = readManualOrbitPropagator(payload, ephemeris);
    const nativeEciSamplesAvailable = ephemeris?.eci_samples_available === true
        || ephemeris?.eciSamplesAvailable === true
        || payload?.eci_samples_available === true
        || payload?.eciSamplesAvailable === true;
    const inertialNativePreview = previewReferenceFrame === MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ECI
        && (["two-body", "j2", "j2-j3-j4", "cowell-rk4"].includes(propagator) || nativeEciSamplesAvailable)
        ? buildEpochAnchoredEciEphemerisPreview(
            getManualOrbitEciEphemerisPoints(payload),
            preliminaryEpochTimeMs
        )
        : null;
    const inertialPreview = previewReferenceFrame === MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ECI
        ? inertialNativePreview || buildEpochAnchoredInertialPreview(payload, preliminaryEpochTimeMs)
        : null;
    // ECEF is deliberately the literal propagated ITRF ephemeris. ECI uses a
    // canonical ellipse for SGP4, but native Two-body/J2/J3/J4/Cowell samples are preferred
    // whenever the API supplies them. This keeps a vector-authored Two-body
    // state exact and makes higher-order secular precession visible. The geometric
    // ellipse remains the backwards-compatible fallback for older responses.
    const points = previewReferenceFrame === MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ECEF
        ? ephemerisPoints
        : inertialPreview?.points || ephemerisPoints;
    if (points.length < 2) {
        throw new Error("La previsualizacion de orbita manual requiere al menos dos muestras de efemerides.");
    }

    const epochTimeMs = preliminaryEpochTimeMs ?? resolveManualOrbitEpochTimeMs(payload, ephemeris, points);
    const { startTimeMs, endTimeMs } = resolveManualOrbitRange(payload, ephemeris, ephemerisPoints.length ? ephemerisPoints : points);
    const requestedColor = String(options?.color || MANUAL_ORBIT_PREVIEW_COLOR).trim();
    manualOrbitPreviewState.points = points;
    manualOrbitPreviewState.epochPoint = inertialPreview?.epochPoint || null;
    manualOrbitPreviewState.epochTimeMs = epochTimeMs;
    manualOrbitPreviewState.startTimeMs = startTimeMs;
    manualOrbitPreviewState.endTimeMs = endTimeMs;
    manualOrbitPreviewState.name = String(payload?.name || ephemeris?.satellite || "Manual Orbit preview").trim() || "Manual Orbit preview";
    manualOrbitPreviewState.visible = options?.visible !== false;
    manualOrbitPreviewState.previewReferenceFrame = previewReferenceFrame;
    // The ground track is an opt-in design aid and follows the preview frame
    // selected above instead of mixing ECI and ECEF geometry in one view.
    manualOrbitPreviewState.showGroundTrack = options?.showGroundTrack === true;
    manualOrbitPreviewState.color = requestedColor || MANUAL_ORBIT_PREVIEW_COLOR;
    manualOrbitPreviewState.geometryMode = inertialPreview?.geometryMode || MANUAL_ORBIT_PREVIEW_GEOMETRY_EPHEMERIS;

    if (!manualOrbitPreviewState.visible) {
        hideManualOrbitPreviewEntities();
        return manualOrbitPreviewSnapshot();
    }
    return renderManualOrbitPreviewEntities(options?.viewer || currentViewer);
}

/** Alias that makes live editor updates explicit at the call site. */
export function updateManualOrbitPreview(payload = {}, options = {}) {
    return renderManualOrbitPreview(payload, options);
}

/**
 * Toggle the transient manual-design ground track without re-propagating the
 * orbit. It follows the orbit line's currently selected ECI/ECEF preview
 * geometry and is also preserved by the editor for confirmation.
 */
export function setManualOrbitPreviewGroundTrack(showGroundTrack, options = {}) {
    manualOrbitPreviewState.showGroundTrack = showGroundTrack === true;
    if (!manualOrbitPreviewState.visible || manualOrbitPreviewState.points.length < 2) {
        return manualOrbitPreviewSnapshot();
    }
    return renderManualOrbitPreviewEntities(
        options?.viewer || manualOrbitPreviewState.viewer || currentViewer
    );
}

/** Hide the preview while retaining its sampled ephemeris for a later re-show. */
export function hideManualOrbitPreview() {
    manualOrbitPreviewState.visible = false;
    hideManualOrbitPreviewEntities();
    return manualOrbitPreviewSnapshot();
}

/** Remove every Cesium entity owned by the preview and discard its data. */
export function clearManualOrbitPreview() {
    removeManualOrbitPreviewEntities();
    manualOrbitPreviewState = {
        viewer: null,
        pathEntity: null,
        epochMarkerEntity: null,
        groundTrackEntity: null,
        points: [],
        epochPoint: null,
        epochTimeMs: null,
        startTimeMs: null,
        endTimeMs: null,
        name: "",
        visible: false,
        showGroundTrack: false,
        color: MANUAL_ORBIT_PREVIEW_COLOR,
        previewReferenceFrame: MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ECI,
        geometryMode: MANUAL_ORBIT_PREVIEW_GEOMETRY_EPHEMERIS,
        vectorEntities: [],
        vectorVisible: false,
        vectorForceTerms: ["central"],
        vectorVelocity: null
    };
    return manualOrbitPreviewSnapshot();
}

/** A serializable status snapshot for the design-mode controller. */
export function getManualOrbitPreviewSnapshot() {
    return manualOrbitPreviewSnapshot();
}

/**
 * Register a temporary, user-authored manual ephemeris without adding it to
 * the catalogue or subscribing it to the catalogue WebSocket. The endpoint's
 * confirmed positions are already ITRF metres, which is the rendering contract
 * used by the normal runtime regardless of its source propagator.
 */
export function importManualOrbitTrack(payload = {}) {
    if (!currentViewer) {
        throw new Error("Viewer no inicializado.");
    }

    const ephemeris = getManualOrbitEphemeris(payload);
    const points = getManualOrbitEphemerisPoints(payload);

    if (points.length < 2) {
        throw new Error("La orbita manual no contiene suficientes muestras de efemerides.");
    }

    const displayName = String(
        payload?.name
        || ephemeris?.satellite
        || "Manual Orbit"
    ).trim() || "Manual Orbit";
    const id = buildUniqueManualOrbitId(
        displayName,
        payload?.projectId ?? payload?.project_id ?? payload?.id
    );
    const nowMs = Date.now();
    // A confirmed manual orbit is defined at its epoch.  Starting its entity
    // from that sample (or the propagation start when no epoch is supplied)
    // avoids the previous surprising jump to whichever sample was nearest now.
    const epochTimeMs = resolveManualOrbitEpochTimeMs(payload, ephemeris, points);
    const initialPoint = findNearestManualOrbitPoint(points, epochTimeMs) || points[0];
    const manualOrbitMetadata = buildManualOrbitMetadata(payload, ephemeris, points);
    const initialPosition = new Cesium.Cartesian3(initialPoint.x, initialPoint.y, initialPoint.z);
    const initialVelocity = finiteVector(initialPoint.velocity);
    const initialOrientation = shouldUse3DModelForSatellite(id) && initialVelocity
        ? calculateOrientation(initialPoint, initialVelocity)
        : Cesium.Quaternion.IDENTITY;
    const state = ensureSatelliteState(currentViewer, id, initialPosition, initialOrientation);
    const orbit = points.map(({ x, y, z }) => ({ x, y, z }));
    const spanHours = Math.max(1 / 3600, (points[points.length - 1].timeMs - points[0].timeMs) / 3600000);

    state.previousPosition = initialPosition;
    state.targetPosition = initialPosition;
    state.renderPosition = initialPosition;
    state.lastVelocity = initialVelocity;
    state.lastAcceleration = null;
    state.lastVelocityTimestampMs = initialPoint.timeMs;
    state.lastMessageTime = nowMs;
    state.lastStateReferenceFrame = "ITRF";
    state.simTrackStartMs = points[0].timeMs;
    state.simTrackEndMs = points[points.length - 1].timeMs;
    state.simTrackSampleTimesMs = points.map((point) => point.timeMs);
    state.lastOrbitPayload = { orbit, orbit_horizon_hours: spanHours };

    const tle = payload?.tle && typeof payload.tle === "object"
        ? {
            line1: String(payload.tle.line1 || "").trim(),
            line2: String(payload.tle.line2 || "").trim()
        }
        : null;
    const manualTrack = {
        startTimeMs: points[0].timeMs,
        endTimeMs: points[points.length - 1].timeMs,
        samples: points.length,
        name: displayName,
        tle,
        // Keep the canonical response metadata with the local track so a
        // catalogue refresh does not erase the Manual Params object card.
        manualOrbit: manualOrbitMetadata
    };
    catalogSatelliteIds.add(id);
    if (tle?.line1 && tle?.line2) {
        tleBySatelliteId.set(id, tle);
    }
    manualOrbitTrackById.set(id, manualTrack);
    catalogEntryMetaBySatelliteId.set(id, createManualOrbitCatalogMeta(id, manualTrack));
    activeLayerSatelliteIds.add(id);
    activeLayerIdsDirty = true;
    satelliteIdsDirty = true;
    catalogLoaded = true;
    hiddenSatelliteIds.delete(id);
    state.entity.name = displayName;
    applyLabelStyle(state.entity, id);

    renderFutureOrbitForState(currentViewer, id, state, state.lastOrbitPayload);
    applySatelliteVisibility(id, state);
    emitObjectStateChanged({ sourceId: id, reason: "manual-orbit" });

    return {
        id,
        name: displayName,
        points: points.length,
        startTimeMs: points[0].timeMs,
        endTimeMs: points[points.length - 1].timeMs
    };
}

/**
 * Return the authored data needed to recreate local manual orbits after a
 * project is reopened. Ephemeris samples are deliberately omitted: they are
 * reproducible through the manual-orbits endpoint and can otherwise make a
 * project file unnecessarily large and stale.
 */
export function getManualOrbitProjectEntries() {
    return [...manualOrbitTrackById.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, track]) => buildManualOrbitProjectEntry(id, track));
}

function buildManualOrbitProjectEntry(id, track) {
    const metadata = track?.manualOrbit || {};
    return {
        id,
        name: String(track?.name || id),
        definitionSource: normalizeManualOrbitDefinitionSource(metadata.definitionSource || metadata.definition_source),
        propagator: normalizeManualOrbitPropagator(metadata.propagator),
        epochUtc: metadata.epochUtc || metadata.epoch_utc || null,
        startTime: metadata.startTime || metadata.start_time || null,
        endTime: metadata.endTime || metadata.end_time || null,
        stepSeconds: Number.isFinite(Number(metadata.stepSeconds ?? metadata.step_seconds))
            ? Number(metadata.stepSeconds ?? metadata.step_seconds)
            : null,
        groundTrackEnabled: metadata.groundTrackEnabled !== false,
        keplerian: cloneManualOrbitValue(metadata.keplerian || null),
        stateVector: cloneManualOrbitValue(metadata.stateVector || metadata.state_vector || null),
        objectMetadata: cloneManualOrbitValue(metadata.objectMetadata || metadata.object_metadata || DEFAULT_MANUAL_ORBIT_OBJECT_METADATA),
        propagationOptions: cloneManualOrbitValue(metadata.propagationOptions || metadata.propagation_options || DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS),
        visual: {
            visible: !hiddenSatelliteIds.has(id),
            overrides: cloneManualOrbitValue(getSatelliteOverrides(id) || {})
        }
    };
}

/**
 * Return the authored definition for a workspace-local manual orbit.
 *
 * This intentionally reads only `manualOrbitTrackById`: a catalogue object
 * may have TLE-derived elements, but it is not user-authored and must never
 * enter the manual editor through this API.
 */
export function getManualOrbitProjectEntry(id) {
    const manualId = normalizeRequestedManualOrbitId(id);
    if (!manualId) {
        return null;
    }
    const track = manualOrbitTrackById.get(manualId);
    return track ? buildManualOrbitProjectEntry(manualId, track) : null;
}

/**
 * Replace an existing workspace-local manual orbit while retaining its stable
 * project/layer identifier. The caller is responsible for reapplying visual
 * overrides because a new orbital definition may deliberately change its
 * ground-track preference and propagation interval.
 */
export function replaceManualOrbitTrack(id, payload = {}) {
    const manualId = normalizeRequestedManualOrbitId(id);
    if (!manualId || !manualOrbitTrackById.has(manualId)) {
        throw new Error("Solo se pueden actualizar orbitas manuales existentes.");
    }

    // Validate the received propagation before touching the current object.
    // A server response with too few samples must leave the authored orbit
    // available for the user to keep editing or cancel safely.
    if (getManualOrbitEphemerisPoints(payload).length < 2) {
        throw new Error("La orbita manual no contiene suficientes muestras de efemerides.");
    }

    removeManualOrbitTrack(manualId);
    return importManualOrbitTrack({
        ...payload,
        projectId: manualId
    });
}

function removeManualOrbitTrack(id) {
    manualOrbitTrackById.delete(id);
    activeLayerSatelliteIds.delete(id);
    hiddenSatelliteIds.delete(id);
    catalogSatelliteIds.delete(id);
    catalogEntryMetaBySatelliteId.delete(id);
    tleBySatelliteId.delete(id);
    satelliteVisualOverridesById.delete(id);
    satelliteIdsDirty = true;
    activeLayerIdsDirty = true;

    const state = satelliteState[id];
    if (state && currentViewer) {
        if (entityPool?.getState(id)) {
            entityPool.release(id);
        } else {
            if (state.orbitEntity) currentViewer.entities.remove(state.orbitEntity);
            remove2DOverlays(currentViewer, state);
            if (state.entity) currentViewer.entities.remove(state.entity);
        }
    }
    delete satelliteState[id];
    delete satelliteEntities[id];
}

function removeOemEphemerisTrack(id) {
    oemEphemerisTrackById.delete(id);
    activeLayerSatelliteIds.delete(id);
    hiddenSatelliteIds.delete(id);
    catalogSatelliteIds.delete(id);
    satelliteIdsDirty = true;
    activeLayerIdsDirty = true;
    catalogEntryMetaBySatelliteId.delete(id);
    tleBySatelliteId.delete(id);

    const state = satelliteState[id];
    if (state && currentViewer) {
        if (state.orbitEntity) {
            currentViewer.entities.remove(state.orbitEntity);
            state.orbitEntity = null;
        }
        remove2DOverlays(currentViewer, state);
        if (state.entity) {
            currentViewer.entities.remove(state.entity);
        }
    }

    delete satelliteState[id];
    delete satelliteEntities[id];
}

export function hasLoadedOemEphemerisTracks() {
    return oemEphemerisTrackById.size > 0;
}

export function getLoadedOemEphemerisTimeBounds() {
    if (!oemEphemerisTrackById.size) {
        return null;
    }

    let minStart = Number.POSITIVE_INFINITY;
    let maxEnd = Number.NEGATIVE_INFINITY;

    for (const item of oemEphemerisTrackById.values()) {
        const start = Number(item?.startTimeMs);
        const end = Number(item?.endTimeMs);
        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            continue;
        }
        minStart = Math.min(minStart, start);
        maxEnd = Math.max(maxEnd, end);
    }

    if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || maxEnd <= minStart) {
        return null;
    }

    return {
        startTimeMs: minStart,
        endTimeMs: maxEnd
    };
}

export function setSimulationTimelineProvider(provider) {
    simulationTimelineProvider = typeof provider === "function" ? provider : null;
}
