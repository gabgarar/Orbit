import { SatelliteWebSocket } from "./SatelliteWebSocket.js";
import { getLogger } from "./logger.js";
import { emitObjectStateChanged } from "./runtime/objectDetailsEvents.js";
import { buildUniformSampleTimes, sampleTrackKinematics } from "./runtime/trackKinematics.js";
import { layoutVectorLabelOffsets } from "./runtime/vectorLabelLayout.js";
import {
    isPreciseProductRenderingUnavailable,
    resolvePreciseProductFrameStatus
} from "./features/preciseProducts/frameStatus.js";
import {
    isInsideObjectRange,
    validateObjectRange
} from "./runtime/simulation/masterTimeRange.js";

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
const FOOTPRINT_REFRESH_INTERVAL_MS = 250;
// Altura sobre el elipsoide a la que se dibuja la huella. Suficiente para evitar
// el z-fighting con la textura de la Tierra sin que el círculo parezca flotar
// (la huella mide miles de km, unos pocos km de altura son imperceptibles).
const FOOTPRINT_SURFACE_HEIGHT = 30000;
// Altura a la que se eleva la traza de suelo (ground track) para evitar el
// z-fighting con la textura del mapa. Se mantiene por debajo del footprint.
const GROUND_TRACK_SURFACE_HEIGHT = 20000;
// An all-zero SP3 P record is the conventional placeholder for a missing
// state in a number of multi-GNSS products.  Cesium cannot project the Earth
// centre to Cartographic coordinates in 2D, so retain a small physical floor
// for every satellite trajectory before it can reach a geometry worker.
const MINIMUM_RENDERABLE_EARTH_CENTER_DISTANCE_M = 1_000;
const PROPAGATION_HOURS_MIN = 0;
const PROPAGATION_HOURS_MAX = Number.POSITIVE_INFINITY;
// This is the scientific/request ceiling of the EGM2008 complete field.  The
// backend separately rejects configurations that exceed the current fixed-RK4
// execution budget; do not silently rewrite a saved N×M selection here.
const MAX_MANUAL_COWELL_GEOPOTENTIAL_DEGREE = 2159;
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
// secular precession is represented by native EME2000 samples from the API. The samples are still
// rendered through one epoch transform, so the design view remains inertial
// rather than becoming an Earth-fixed rosette.
const MANUAL_ORBIT_PREVIEW_GEOMETRY_INERTIAL_EPHEMERIS = "inertial-eci-ephemeris";
const MANUAL_ORBIT_PREVIEW_GEOMETRY_EPHEMERIS = "earth-fixed-ephemeris";
const MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_EME2000 = "eme2000";
const MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ITRF = "itrf";
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
// Precise GNSS products are parsed and persisted by the Python runtime.  Keep
// their compact catalogue representation client-side as well: the legacy Node
// catalogue page only owns TLE/OMM records, while SP3 products need to remain
// selectable after a catalogue refresh or a browser reload.
const preciseProductEntryBySatelliteId = new Map();
// Every finite source keeps its own published/generated coverage separate
// from the scene-wide timeline. The Master Time Range may be wider than a
// particular OEM, SP3 or manual propagation; this registry boundary prevents
// that wider scene from becoming permission to interpolate or extrapolate a
// finite object. OEM/manual ranges come from accepted samples and SP3 ranges
// come from the server-validated per-satellite metadata. A rolling WebSocket
// orbit deliberately never creates an intrinsic range.
// Catalogue paths received through the WebSocket are rolling, real-time
// previews. A simulated range needs its own timestamped ITRF ephemeris; it
// must never reinterpret a rolling polyline as though it had been generated
// at a different date.
const rangeEphemerisCache = new Map();
const rangeEphemerisRequests = new Map();
const RANGE_EPHEMERIS_CACHE_LIMIT = 24;
const RANGE_EPHEMERIS_MAX_POINTS = 12_000;
// A multi-constellation SP3 commonly carries more than one hundred spacecraft.
// Activating those layers used to launch one /api/ephemeris request per member
// immediately, which could starve the browser and the Python service before a
// single track had a chance to render.  Keep the precise-range work bounded
// while preserving every layer and its eventual exact track.
const RANGE_EPHEMERIS_MAX_CONCURRENT_REQUESTS = 4;
const rangeEphemerisQueue = [];
let activeRangeEphemerisRequestCount = 0;
let rangeEphemerisRevision = 0;
const STATIC_EPHEMERIS_MIN_HORIZON_SECONDS = 24 * 60 * 60;
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
    footprintEntity: null,
    points: [],
    // `points` use the frame selected in the manual editor. `surfacePoints`
    // always retain the propagated ITRF samples so a 2D view is a physical
    // Earth projection rather than an EME2000 ellipse flattened by Cesium.
    surfacePoints: [],
    epochPoint: null,
    surfaceEpochPoint: null,
    epochTimeMs: null,
    startTimeMs: null,
    endTimeMs: null,
    name: "",
    visible: false,
    showGroundTrack: false,
    color: MANUAL_ORBIT_PREVIEW_COLOR,
    previewReferenceFrame: MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_EME2000,
    geometryMode: MANUAL_ORBIT_PREVIEW_GEOMETRY_EPHEMERIS,
    vectorEntities: [],
    vectorVisible: false,
    vectorForceTerms: ["central"],
    vectorVelocity: null
};

function finiteEpochMilliseconds(value) {
    if (value instanceof Date) {
        const milliseconds = value.getTime();
        return Number.isFinite(milliseconds) ? milliseconds : null;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    if (/^[+-]?\d+(?:\.\d+)?$/.test(raw)) {
        const milliseconds = Number(raw);
        return Number.isFinite(milliseconds) ? milliseconds : null;
    }
    const milliseconds = Date.parse(raw);
    return Number.isFinite(milliseconds) ? milliseconds : null;
}

function intrinsicTimeRangeFromValidation(validation) {
    if (!validation?.valid || !validation.range) return null;
    const startTimeMs = validation.range.startDate.getTime();
    const endTimeMs = validation.range.endDate.getTime();
    if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs) || endTimeMs < startTimeMs) {
        return null;
    }
    return Object.freeze({
        startTimeMs,
        endTimeMs,
        startTime: new Date(startTimeMs).toISOString(),
        endTime: new Date(endTimeMs).toISOString(),
        coverageStart: new Date(startTimeMs).toISOString(),
        coverageEnd: new Date(endTimeMs).toISOString()
    });
}

function intrinsicTimeRangeFromCandidates(candidates = []) {
    for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") continue;
        const normalized = intrinsicTimeRangeFromValidation(validateObjectRange(candidate));
        if (normalized) return normalized;
    }
    return null;
}

function cloneIntrinsicTimeRange(range) {
    if (!range) return null;
    return {
        startTimeMs: range.startTimeMs,
        endTimeMs: range.endTimeMs,
        startTime: range.startTime,
        endTime: range.endTime,
        coverageStart: range.coverageStart,
        coverageEnd: range.coverageEnd
    };
}

function trackIntrinsicTimeRange(track) {
    if (!track || typeof track !== "object") return null;
    return intrinsicTimeRangeFromCandidates([
        track.intrinsicTimeRange,
        track.timeRange,
        track.coverage,
        track
    ]);
}

function preciseProductIntrinsicTimeRange(id) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) return null;
    const entry = preciseProductEntryBySatelliteId.get(normalizedId)
        || catalogEntryMetaBySatelliteId.get(normalizedId)
        || null;
    if (!entry || typeof entry !== "object") return null;
    const inputMetadata = entry.inputMetadata && typeof entry.inputMetadata === "object"
        ? entry.inputMetadata
        : null;
    const sp3 = entry.sp3 && typeof entry.sp3 === "object"
        ? entry.sp3
        : (inputMetadata?.sp3 && typeof inputMetadata.sp3 === "object" ? inputMetadata.sp3 : null);
    // Prefer a satellite's own coverage to product-level coverage. A precise
    // product may contain a member with a shorter valid sample series.
    return intrinsicTimeRangeFromCandidates([
        entry.intrinsicTimeRange,
        entry.timeRange,
        entry.coverage,
        inputMetadata?.intrinsicTimeRange,
        inputMetadata?.timeRange,
        inputMetadata?.coverage,
        sp3?.intrinsicTimeRange,
        sp3?.timeRange,
        sp3?.coverage,
        sp3,
        inputMetadata,
        entry
    ]);
}

function intrinsicTimeRangeForSatellite(id) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) return null;
    return trackIntrinsicTimeRange(oemEphemerisTrackById.get(normalizedId))
        || trackIntrinsicTimeRange(manualOrbitTrackById.get(normalizedId))
        || preciseProductIntrinsicTimeRange(normalizedId);
}

function isFiniteEphemerisSource(id) {
    const normalizedId = String(id || "").trim();
    return Boolean(normalizedId) && (
        oemEphemerisTrackById.has(normalizedId)
        || manualOrbitTrackById.has(normalizedId)
        || isFinitePreciseProductTrack(normalizedId)
    );
}

/** Whether a source may be sampled at all, independent of the current date. */
function hasValidatedFiniteCoverage(id) {
    return !isFiniteEphemerisSource(id) || Boolean(intrinsicTimeRangeForSatellite(id));
}

function temporalDateForSimulationContext(simulationCtx, fallbackMs = Date.now()) {
    if (simulationCtx?.mode !== "realtime" && simulationCtx?.date instanceof Date
        && Number.isFinite(simulationCtx.date.getTime())) {
        return simulationCtx.date;
    }
    return new Date(fallbackMs);
}

function intrinsicTimeStatusForSatellite(id, atTime) {
    const range = intrinsicTimeRangeForSatellite(id);
    const checkedAtMs = finiteEpochMilliseconds(atTime);
    if (!range) {
        const finiteSource = isFiniteEphemerisSource(id);
        return {
            // A finite source has an explicit temporal contract.  Missing or
            // malformed coverage is not a legacy permission to query it at
            // wall-clock `now`: the renderer, telemetry and range endpoint
            // must all fail closed.  Non-finite catalogue sources (TLE/OMM)
            // intentionally remain usable without an intrinsic interval.
            status: finiteSource ? "out_of_range" : "active",
            active: !finiteSource,
            hasIntrinsicTimeRange: false,
            range: null,
            checkedAtMs: Number.isFinite(checkedAtMs) ? checkedAtMs : null,
            reason: finiteSource ? "intrinsic-time-range-unavailable" : null
        };
    }
    const inRange = Number.isFinite(checkedAtMs) && isInsideObjectRange(range, checkedAtMs);
    return {
        status: inRange ? "active" : "out_of_range",
        active: inRange,
        hasIntrinsicTimeRange: true,
        range,
        checkedAtMs: Number.isFinite(checkedAtMs) ? checkedAtMs : null,
        reason: inRange ? null : "outside-intrinsic-time-range"
    };
}

/**
 * Return one finite object's non-extrapolable temporal coverage.
 *
 * The result is deliberately detached from the internal registry so callers
 * cannot mutate a loaded OEM/manual/SP3 contract. `null` means that the
 * source has no finite declared coverage (for example a rolling TLE layer).
 */
export function getObjectIntrinsicTimeRange(id) {
    return cloneIntrinsicTimeRange(intrinsicTimeRangeForSatellite(id));
}

/** Backwards-friendly explicit alias for callers that operate on layers. */
export const getSatelliteIntrinsicTimeRange = getObjectIntrinsicTimeRange;

/**
 * Report whether an object has data at a specific UTC instant without
 * sampling it. Finite ephemerides fail closed: malformed/missing query time
 * yields `out_of_range`, never an extrapolated state.
 */
export function getObjectMtrStatus(id, atTime = new Date()) {
    const status = intrinsicTimeStatusForSatellite(id, atTime);
    return {
        ...status,
        range: cloneIntrinsicTimeRange(status.range)
    };
}

function normalizedObjectIds(ids) {
    const values = Array.isArray(ids) ? ids : [ids];
    return [...new Set(values
        .map((id) => String(id || "").trim())
        .filter(Boolean))];
}

/**
 * Summarise the outer UTC envelope of the finite objects selected for an
 * activation/import decision.
 *
 * This is deliberately an *envelope*, not a claim that every member has data
 * in gaps between its samples. `ranges` keeps the individual contracts for a
 * caller that needs a common-analysis intersection instead. TLE/OMM objects
 * are open-ended propagators and therefore do not contribute a finite range;
 * a finite OEM/SP3/manual object with no validated range makes the summary
 * invalid rather than silently widening the MTR.
 */
export function getObjectIntrinsicTimeRangeUnion(ids) {
    const objectIds = normalizedObjectIds(ids);
    const finiteIds = [];
    const missingIds = [];
    const ranges = [];

    for (const id of objectIds) {
        if (!isFiniteEphemerisSource(id)) continue;
        finiteIds.push(id);
        const range = intrinsicTimeRangeForSatellite(id);
        if (!range) {
            missingIds.push(id);
            continue;
        }
        ranges.push({ id, ...cloneIntrinsicTimeRange(range) });
    }

    const valid = missingIds.length === 0;
    const union = valid && ranges.length
        ? intrinsicTimeRangeFromCandidates([{
            startTimeMs: Math.min(...ranges.map((range) => range.startTimeMs)),
            endTimeMs: Math.max(...ranges.map((range) => range.endTimeMs))
        }])
        : null;

    return {
        valid,
        reason: valid ? null : "intrinsic-time-range-unavailable",
        objectIds: objectIds.slice(),
        finiteIds: finiteIds.slice(),
        missingIds: missingIds.slice(),
        hasFiniteCoverage: ranges.length > 0,
        range: cloneIntrinsicTimeRange(union),
        ranges: ranges.map((range) => ({ ...range }))
    };
}

/** Compact alias for activation controllers that operate on source ids. */
export const getIntrinsicTimeRangeUnion = getObjectIntrinsicTimeRangeUnion;

/**
 * Run finite-range ephemeris requests with a small, shared concurrency cap.
 *
 * The queue deliberately owns only transport work. Cache identity,
 * cancellation-by-staleness and Cesium state application remain at the call
 * site, where the active layer and simulation-range contracts are known.
 */
function enqueueRangeEphemerisRequest(task) {
    return new Promise((resolve, reject) => {
        rangeEphemerisQueue.push({ task, resolve, reject });
        drainRangeEphemerisQueue();
    });
}

function drainRangeEphemerisQueue() {
    while (
        activeRangeEphemerisRequestCount < RANGE_EPHEMERIS_MAX_CONCURRENT_REQUESTS
        && rangeEphemerisQueue.length
    ) {
        const next = rangeEphemerisQueue.shift();
        activeRangeEphemerisRequestCount += 1;
        Promise.resolve()
            .then(next.task)
            .then(next.resolve, next.reject)
            .finally(() => {
                activeRangeEphemerisRequestCount = Math.max(0, activeRangeEphemerisRequestCount - 1);
                drainRangeEphemerisQueue();
            });
    }
}

function isLocalEphemerisTrack(id) {
    return oemEphemerisTrackById.has(id) || manualOrbitTrackById.has(id);
}

// A finite precise product has no promise of a valid state at wall-clock
// `now`. TLE catalogue objects still obtain their first marker from the
// normal realtime stream, so only SP3 products proactively request a full
// exact range when activated. This avoids a bulk "show all" action spawning
// thousands of unnecessary ephemeris requests for the live catalogue.
function isFinitePreciseProductTrack(id) {
    const normalizedId = String(id || "").trim();
    return preciseProductEntryBySatelliteId.has(normalizedId)
        || String(catalogEntryMetaBySatelliteId.get(normalizedId)?.sourceFormat || "").toUpperCase() === "SP3";
}

/**
 * A precise product owns a native terrestrial realization (for example
 * IGS20). Cesium only accepts an Earth-fixed rendering vector after the
 * backend explicitly says that its realization operation is available. Keep
 * this policy here, next to activation, so an unavailable product cannot be
 * accidentally re-requested by WebSocket, range bootstrap or a visibility
 * refresh.
 */
function preciseProductFrameStatusForId(id, runtimeFrame = "", runtimePayload = null) {
    const normalizedId = String(id || "").trim();
    const entry = preciseProductEntryBySatelliteId.get(normalizedId)
        || catalogEntryMetaBySatelliteId.get(normalizedId)
        || {};
    const response = runtimePayload && typeof runtimePayload === "object" ? runtimePayload : {};
    return resolvePreciseProductFrameStatus({
        ...entry,
        native_reference_frame: response.native_reference_frame ?? response.nativeReferenceFrame ?? entry.native_reference_frame,
        native_frame: response.native_frame ?? response.nativeFrame ?? entry.native_frame,
        renderer_reference: response.renderer_reference ?? response.rendererReference ?? entry.renderer_reference,
        rendering: response.rendering ?? entry.rendering,
        earth_orientation: response.earth_orientation ?? response.earthOrientation ?? entry.earth_orientation
    }, { runtimeFrame });
}

function canRenderPreciseProduct(id) {
    return !isFinitePreciseProductTrack(id)
        || !isPreciseProductRenderingUnavailable(
            preciseProductEntryBySatelliteId.get(String(id || "").trim())
            || catalogEntryMetaBySatelliteId.get(String(id || "").trim())
            || {}
        );
}

function clearUnavailablePreciseProductRendering(id) {
    if (!isFinitePreciseProductTrack(id) || canRenderPreciseProduct(id)) return;
    const state = satelliteState[id];
    if (!state) return;
    const frameStatus = preciseProductFrameStatusForId(id);
    state.preciseRenderingUnavailable = true;
    state.lastStateReferenceFrame = normalizeReferenceFrame(frameStatus.nativeFrame) || null;
    if (state.orbitEntity && currentViewer) {
        currentViewer.entities.remove(state.orbitEntity);
        state.orbitEntity = null;
    }
    if (currentViewer) remove2DOverlays(currentViewer, state);
    if (state.entity) state.entity.show = false;
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
        epoch: catalogMetadataText(entry, ["epoch", "epochUtc", "epoch_utc", "epochTime", "epoch_time"]),
        dataQuality: catalogMetadataText(entry, ["dataQuality", "data_quality", "quality", "precision", "accuracy"]),
        // Keep format-specific source metadata intact when the catalogue API
        // provides it. The details inspector can then expose OMM/OEM/SP3
        // fields without pretending that a generic TLE record contains them.
        inputMetadata: entry?.inputMetadata ?? entry?.input_metadata ?? entry?.sourceMetadata ?? entry?.source_metadata ?? null,
        // RF metadata is intentionally optional. Standard TLE/OMM/SP3/OEM
        // inputs usually do not carry it, but a catalogue/provider can expose
        // a complete remote terminal profile without changing the runtime
        // model. Ground-station telemetry only calculates a real SNR when
        // this object has EIRP, carrier, polarisation and bandwidth.
        rfProfile: entry?.rfProfile
            ?? entry?.rf_profile
            ?? entry?.inputMetadata?.rfProfile
            ?? entry?.inputMetadata?.rf_profile
            ?? entry?.input_metadata?.rfProfile
            ?? entry?.input_metadata?.rf_profile
            ?? null,
        perigee_km: Number.isFinite(Number(entry?.perigee_km)) ? Number(entry.perigee_km) : null,
        decayRisk: entry?.decayRisk === true
    };
}

function compactPreciseProductEntry(entry = {}) {
    const id = String(entry?.id ?? entry?.catalogId ?? entry?.catalog_id ?? "").trim();
    if (!id) return null;

    const sp3 = entry?.sp3 && typeof entry.sp3 === "object" ? entry.sp3 : {};
    const catalogMeta = entry?.catalogMeta && typeof entry.catalogMeta === "object"
        ? entry.catalogMeta
        : (entry?.catalog_meta && typeof entry.catalog_meta === "object" ? entry.catalog_meta : {});
    const inputMetadata = entry?.inputMetadata
        ?? entry?.input_metadata
        ?? entry?.sourceMetadata
        ?? entry?.source_metadata
        ?? sp3;
    const displayName = catalogMetadataText(entry, ["display_name", "displayName", "name", "satellite_name", "satelliteName"], id);
    const provider = catalogMetadataText(
        entry,
        ["provider", "provider_id", "sourceProvider", "source_provider"],
        catalogMetadataText(catalogMeta, ["provider", "provider_id", "source_provider"], catalogMetadataText(sp3, ["provider", "provider_id", "source_provider"], ""))
    );
    const productClass = catalogMetadataText(
        entry,
        ["product_class", "productClass", "quality"],
        catalogMetadataText(catalogMeta, ["product_class", "productClass", "quality"], catalogMetadataText(sp3, ["product_class", "productClass", "quality"], ""))
    );
    const intrinsicTimeRange = intrinsicTimeRangeFromCandidates([
        entry?.intrinsicTimeRange,
        entry?.timeRange,
        entry?.coverage,
        sp3?.intrinsicTimeRange,
        sp3?.timeRange,
        sp3?.coverage,
        sp3,
        inputMetadata,
        entry
    ]);

    return {
        ...entry,
        id,
        catalogId: id,
        name: displayName,
        sourceFormat: "SP3",
        sourceOrigin: catalogMetadataText(entry, ["sourceOrigin", "source_origin"], provider ? "PRECISE_PRODUCT" : "USER"),
        tleSource: provider || catalogMetadataText(sp3, ["agency", "originator"], "Producto preciso"),
        dataQuality: productClass || catalogMetadataText(sp3, ["data_quality", "quality", "precision"], "Alta precisión"),
        objectId: catalogMetadataText(entry, ["objectId", "object_id", "satellite_id", "satelliteId"], id),
        intrinsicTimeRange,
        inputMetadata: {
            ...((inputMetadata && typeof inputMetadata === "object") ? inputMetadata : {}),
            ...catalogMeta,
            ...sp3,
            provider: provider || sp3.provider || null,
            product_class: productClass || sp3.product_class || null,
            product_id: entry?.product_id ?? entry?.productId ?? sp3.product_id ?? sp3.productId ?? null,
            satellite_id: entry?.satellite_id ?? entry?.satelliteId ?? sp3.satellite_id ?? sp3.satelliteId ?? null,
            native_reference_frame: inputMetadata?.native_reference_frame ?? inputMetadata?.nativeReferenceFrame
                ?? entry?.native_reference_frame ?? entry?.nativeReferenceFrame
                ?? sp3.native_reference_frame ?? sp3.nativeReferenceFrame ?? null,
            native_frame: inputMetadata?.native_frame ?? inputMetadata?.nativeFrame
                ?? entry?.native_frame ?? entry?.nativeFrame ?? sp3.native_frame ?? sp3.nativeFrame ?? null,
            renderer_reference: inputMetadata?.renderer_reference ?? inputMetadata?.rendererReference
                ?? entry?.renderer_reference ?? entry?.rendererReference ?? sp3.renderer_reference ?? sp3.rendererReference ?? null,
            earth_orientation: inputMetadata?.earth_orientation ?? inputMetadata?.earthOrientation
                ?? entry?.earth_orientation ?? entry?.earthOrientation ?? sp3.earth_orientation ?? sp3.earthOrientation ?? null,
            // Persist the source member's finite domain through catalogue
            // refreshes. It never changes the global MTR by itself.
            intrinsicTimeRange
        }
    };
}

/**
 * The import service intentionally keeps a satellite entry small and puts
 * product-level provenance (files, provider, coverage) next to the complete
 * satellite collection. Fold those safe metadata fields into each entry
 * before it reaches Layers so a later catalogue refresh cannot erase the
 * identity of an SP3 layer.
 */
function enrichPreciseProductSatelliteEntry(entry, product = null) {
    if (!entry || typeof entry !== "object") return null;
    const sourceProduct = product && typeof product === "object" ? product : {};
    const sourceSp3 = entry?.sp3 && typeof entry.sp3 === "object" ? entry.sp3 : {};
    const provider = entry.provider
        ?? entry.provider_id
        ?? sourceSp3.provider
        ?? sourceSp3.provider_id
        ?? sourceProduct.provider
        ?? sourceProduct.provider_id
        ?? null;
    const productClass = entry.product_class
        ?? entry.productClass
        ?? sourceSp3.product_class
        ?? sourceSp3.productClass
        ?? sourceProduct.product_class
        ?? sourceProduct.productClass
        ?? null;
    const productId = entry.product_id
        ?? entry.productId
        ?? sourceSp3.product_id
        ?? sourceSp3.productId
        ?? sourceProduct.product_id
        ?? sourceProduct.productId
        ?? sourceProduct.id
        ?? null;
    const intrinsicTimeRange = intrinsicTimeRangeFromCandidates([
        entry?.intrinsicTimeRange,
        entry?.timeRange,
        entry?.coverage,
        sourceSp3?.intrinsicTimeRange,
        sourceSp3?.timeRange,
        sourceSp3?.coverage,
        sourceSp3,
        sourceProduct?.coverage,
        sourceProduct
    ]);

    return {
        ...entry,
        provider,
        product_class: productClass,
        product_id: productId,
        product_name: entry.product_name ?? entry.productName ?? sourceProduct.name ?? null,
        intrinsicTimeRange,
        sp3: {
            ...sourceSp3,
            provider: sourceSp3.provider ?? provider,
            product_class: sourceSp3.product_class ?? productClass,
            product_id: sourceSp3.product_id ?? productId,
            product_name: sourceSp3.product_name ?? sourceProduct.name ?? null,
            file_name: sourceSp3.file_name ?? sourceSp3.fileName ?? sourceProduct.orbit_file ?? sourceProduct.orbitFile ?? null,
            clock_file: sourceSp3.clock_file ?? sourceSp3.clockFile ?? sourceProduct.clock_file ?? sourceProduct.clockFile ?? null,
            erp_file: sourceSp3.erp_file ?? sourceSp3.erpFile ?? sourceProduct.erp_file ?? sourceProduct.erpFile
                ?? sourceProduct.erp?.file ?? sourceProduct.erp?.name ?? null,
            sum_file: sourceSp3.sum_file ?? sourceSp3.sumFile ?? sourceProduct.sum_file ?? sourceProduct.sumFile ?? null,
            attitude_file: sourceSp3.attitude_file ?? sourceSp3.attitudeFile ?? sourceProduct.attitude_file ?? sourceProduct.attitudeFile ?? null,
            osb_file: sourceSp3.osb_file ?? sourceSp3.osbFile ?? sourceProduct.osb_file ?? sourceProduct.osbFile ?? null,
            source_files: sourceSp3.source_files ?? sourceSp3.sourceFiles ?? sourceProduct.source_files ?? sourceProduct.sourceFiles ?? [],
            start_time: sourceSp3.start_time ?? sourceSp3.startTime ?? sourceProduct.start_time ?? sourceProduct.startTime ?? null,
            end_time: sourceSp3.end_time ?? sourceSp3.endTime ?? sourceProduct.end_time ?? sourceProduct.endTime ?? null,
            start_time_ms: sourceSp3.start_time_ms ?? sourceSp3.startTimeMs ?? sourceProduct.start_time_ms ?? sourceProduct.startTimeMs ?? null,
            end_time_ms: sourceSp3.end_time_ms ?? sourceSp3.endTimeMs ?? sourceProduct.end_time_ms ?? sourceProduct.endTimeMs ?? null,
            // Preserve the backend's native realization and rendering
            // provenance verbatim. The UI deliberately distinguishes these
            // fields from the compatibility `reference_frame` of a returned
            // Cartesian vector.
            native_reference_frame: sourceSp3.native_reference_frame ?? sourceSp3.nativeReferenceFrame
                ?? entry.native_reference_frame ?? entry.nativeReferenceFrame
                ?? sourceProduct.native_reference_frame ?? sourceProduct.nativeReferenceFrame ?? null,
            native_frame: sourceSp3.native_frame ?? sourceSp3.nativeFrame
                ?? entry.native_frame ?? entry.nativeFrame
                ?? sourceProduct.native_frame ?? sourceProduct.nativeFrame ?? null,
            reference_frame: sourceSp3.reference_frame ?? sourceSp3.referenceFrame
                ?? entry.reference_frame ?? entry.referenceFrame
                ?? sourceProduct.reference_frame ?? sourceProduct.referenceFrame ?? sourceProduct.frame ?? null,
            time_system: sourceSp3.time_system ?? sourceSp3.timeSystem
                ?? entry.time_system ?? entry.timeSystem
                ?? sourceProduct.time_system ?? sourceProduct.timeSystem ?? sourceProduct.time_scale ?? sourceProduct.timeScale ?? null,
            renderer_reference: sourceSp3.renderer_reference ?? sourceSp3.rendererReference
                ?? entry.renderer_reference ?? entry.rendererReference
                ?? sourceProduct.renderer_reference ?? sourceProduct.rendererReference ?? null,
            earth_orientation: sourceSp3.earth_orientation ?? sourceSp3.earthOrientation
                ?? entry.earth_orientation ?? entry.earthOrientation
                ?? sourceProduct.earth_orientation ?? sourceProduct.earthOrientation ?? null,
            eci_conversion: sourceSp3.eci_conversion ?? sourceSp3.eciConversion
                ?? entry.eci_conversion ?? entry.eciConversion
                ?? sourceProduct.eci_conversion ?? sourceProduct.eciConversion ?? null,
            rendering: sourceSp3.rendering ?? entry.rendering ?? sourceProduct.rendering ?? null,
            intrinsicTimeRange
        }
    };
}

function applyPreciseProductEntry(entry) {
    const normalized = compactPreciseProductEntry(entry);
    if (!normalized) return null;
    preciseProductEntryBySatelliteId.set(normalized.id, normalized);
    catalogSatelliteIds.add(normalized.id);
    catalogEntryMetaBySatelliteId.set(normalized.id, createCatalogEntryMeta(normalized, normalized.name));
    // A rehydrated product may be changed from renderable to native-only by a
    // new realization/EOP policy. Hide an old cached Cesium entity rather
    // than continuing to present a stale ITRF-looking orbit.
    clearUnavailablePreciseProductRendering(normalized.id);
    // Project restoration may have activated a persisted SP3 id before the
    // optional registry hydration completed. Reconcile that deliberately
    // deferred activation now that its finite coverage and frame contract are
    // known: SP3 must seed from the MTR, never remain a dangling WebSocket
    // subscription at wall-clock now.
    if (activeLayerSatelliteIds.has(normalized.id)) {
        activeLayerIdsDirty = true;
        wsClient?.unsubscribe?.([normalized.id]);
        if (canRenderPreciseProduct(normalized.id) && hasValidatedFiniteCoverage(normalized.id)) {
            void primeSatelliteTimelineRange(normalized.id);
        } else {
            clearUnavailablePreciseProductRendering(normalized.id);
            const state = satelliteState[normalized.id];
            if (state) applyOutOfTimeVisualState(normalized.id, state, true);
        }
        emitObjectStateChanged({ sourceId: normalized.id, reason: "precise-product-hydration" });
    }
    return normalized.id;
}

/**
 * Registers metadata returned by the precise-products service.  Samples stay
 * in the Python runtime; the WebSocket remains the sole source of Cesium
 * states.  This gives SP3 layers the exact same activation/subscription path
 * as a catalogue satellite without pretending they are TLEs.
 */
export function registerPreciseProductSatelliteEntries(entries = []) {
    const ids = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
        const id = applyPreciseProductEntry(entry);
        if (id) ids.push(id);
    }
    if (ids.length) {
        satelliteIdsDirty = true;
        catalogLoaded = true;
    }
    return ids;
}

export function preciseProductSatelliteEntriesFromPayload(payload = {}) {
    const product = payload?.product && typeof payload.product === "object" ? payload.product : null;
    const direct = (Array.isArray(payload?.satellites) ? payload.satellites : [])
        .map((entry) => enrichPreciseProductSatelliteEntry(entry, product));
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const nested = items.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const itemProduct = item.product && typeof item.product === "object" ? item.product : item;
        const satellites = Array.isArray(item.satellites)
            ? item.satellites
            : (Array.isArray(itemProduct.satellites) ? itemProduct.satellites : []);
        return satellites.map((entry) => enrichPreciseProductSatelliteEntry(entry, itemProduct));
    });
    return [...direct, ...nested].filter((item) => item && typeof item === "object");
}

/** Hydrates persisted SP3 metadata after the normal Node catalogue loads. */
export async function hydratePreciseProductSatelliteEntries() {
    try {
        const response = await fetch("/api/precise-products", { cache: "no-cache" });
        if (!response.ok) {
            // Older backend images do not expose this optional endpoint.  Do
            // not make the entire workspace fail while they are upgraded.
            return [];
        }
        const payload = await response.json();
        return registerPreciseProductSatelliteEntries(preciseProductSatelliteEntriesFromPayload(payload));
    } catch (error) {
        logger.warn("No se pudieron restaurar productos precisos:", error);
        return [];
    }
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
    // The project-wide switch is authoritative. A per-object override may hide
    // its own track, but it must not resurrect a track when the global option
    // is disabled.
    return orbitConfig.orbit_ground_track_show !== false
        && getSatelliteConfigValue(id, "orbit_ground_track_show", true) !== false
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

/**
 * Return whether a Cartesian state is safe to hand to Cesium's Earth
 * projection.  In particular, an SP3 missing-state sentinel can arrive as
 * ``(0, 0, 0)`` from a persisted/older backend.  It is finite JavaScript
 * data, but it has no Cartographic longitude and makes Cesium's asynchronous
 * polyline projection worker stop rendering in 2D.
 */
function isRenderableEarthCenteredVector(value) {
    const vector = finiteVector(value);
    if (!vector) {
        return false;
    }
    return Math.hypot(vector.x, vector.y, vector.z) >= MINIMUM_RENDERABLE_EARTH_CENTER_DISTANCE_M;
}

/**
 * Keep position/timestamp pairs aligned while removing malformed state
 * samples.  Rendering the remaining samples is preferable to handing one
 * Earth-centre point to Cesium and losing the entire scene.  When timestamps
 * are unavailable or malformed, callers retain their existing uniform-time
 * fallback rather than pairing the wrong epoch with a valid point.
 */
function normalizeRenderableOrbitSamples(points, sampleTimes = null) {
    if (!Array.isArray(points)) {
        return { points: [], sampleTimesMs: null };
    }

    const hasAlignedTimes = Array.isArray(sampleTimes) && sampleTimes.length === points.length;
    const normalizedPoints = [];
    const normalizedTimes = [];
    let validTimes = hasAlignedTimes;
    let previousTimeMs = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < points.length; index += 1) {
        const vector = finiteVector(points[index]);
        if (!isRenderableEarthCenteredVector(vector)) {
            continue;
        }

        normalizedPoints.push(vector);
        if (!hasAlignedTimes) {
            continue;
        }

        const timeMs = Number(sampleTimes[index]);
        if (!Number.isFinite(timeMs) || timeMs <= previousTimeMs) {
            validTimes = false;
            continue;
        }
        normalizedTimes.push(timeMs);
        previousTimeMs = timeMs;
    }

    return {
        points: normalizedPoints,
        sampleTimesMs: validTimes && normalizedTimes.length === normalizedPoints.length
            ? normalizedTimes
            : null
    };
}

/**
 * Convert a runtime position into a valid Cartographic point, when possible.
 *
 * Range products are allowed to exist in Layers before an exact ephemeris has
 * been loaded, or when the backend has marked their terrestrial realization as
 * unavailable.  In both cases a Cesium entity/property can be present without
 * being a finite Cartesian state.  Cesium's conversion routines assume a
 * complete Cartesian input and can otherwise throw while reading its
 * longitude/latitude fields.  Geographic telemetry and overlays are optional,
 * so reject only that invalid conversion instead of allowing it to escape into
 * the React inspector.
 */
function cartographicFromFiniteCartesian(position) {
    const vector = finiteVector(position);
    if (!vector
        || typeof Cesium === "undefined"
        || !Cesium.Cartesian3
        || !Cesium.Cartographic
        || typeof Cesium.Cartographic.fromCartesian !== "function") {
        return null;
    }

    let cartographic;
    try {
        cartographic = Cesium.Cartographic.fromCartesian(
            new Cesium.Cartesian3(vector.x, vector.y, vector.z)
        );
    } catch {
        // A third-party Cesium build may reject a transient Cartesian state.
        // Geographic values are optional; constrain this recovery boundary to
        // the conversion itself so unrelated renderer errors still surface.
        return null;
    }
    const latitude = Number(cartographic?.latitude);
    const longitude = Number(cartographic?.longitude);
    const height = Number(cartographic?.height);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(height)) {
        return null;
    }
    return cartographic;
}

function cesiumCartesianFromFiniteVector(position) {
    const vector = finiteVector(position);
    if (!vector || typeof Cesium === "undefined" || !Cesium.Cartesian3) {
        return null;
    }
    return new Cesium.Cartesian3(vector.x, vector.y, vector.z);
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

function getExactTimelineEphemerisWindow(id, simulationCtx) {
    const rangeStartMs = simulationCtx?.rangeStart?.getTime?.();
    const rangeEndMs = simulationCtx?.rangeEnd?.getTime?.();
    if (simulationCtx?.mode === "range" && Number.isFinite(rangeStartMs) && Number.isFinite(rangeEndMs) && rangeEndMs > rangeStartMs) {
        return { kind: "range", startMs: rangeStartMs, endMs: rangeEndMs };
    }

    if (simulationCtx?.mode === "static") {
        const startMs = simulationCtx.date?.getTime?.();
        if (!Number.isFinite(startMs)) return null;
        const configuredSeconds = Number(getPropagationHoursForSatellite(id)) * 3600;
        const horizonSeconds = Math.max(
            STATIC_EPHEMERIS_MIN_HORIZON_SECONDS,
            Number.isFinite(configuredSeconds) && configuredSeconds > 0 ? configuredSeconds : 0
        );
        return { kind: "static", startMs, endMs: startMs + (horizonSeconds * 1000) };
    }

    return null;
}

function intersectEphemerisWindowWithIntrinsicRange(id, ephemerisWindow) {
    if (!ephemerisWindow) return null;
    const range = intrinsicTimeRangeForSatellite(id);
    // A finite SP3 is never queryable without a validated member coverage.
    // Treating an old/hydrated record as unrestricted would turn a missing
    // metadata field into silent extrapolation. TLE/OMM records deliberately
    // keep the normal open-ended propagator path.
    if (!range) return isFinitePreciseProductTrack(id) ? null : ephemerisWindow;
    const startMs = Math.max(ephemerisWindow.startMs, range.startTimeMs);
    const endMs = Math.min(ephemerisWindow.endMs, range.endTimeMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
    return {
        ...ephemerisWindow,
        startMs,
        endMs,
        // One exact endpoint is a valid object state but cannot form a
        // polyline/interpolation request. Treat it as no renderable window.
        renderable: endMs > startMs,
        intrinsicRange: range
    };
}

function rangeEphemerisKey(id, simulationCtx) {
    const requestedWindow = getExactTimelineEphemerisWindow(id, simulationCtx);
    const window = intersectEphemerisWindowWithIntrinsicRange(id, requestedWindow);
    return window && window.renderable !== false
        ? `${rangeEphemerisRevision}|${id}|${window.kind}|${window.startMs}|${window.endMs}`
        : null;
}

function rangeEphemerisStepSeconds(ephemerisWindow) {
    const spanSeconds = (ephemerisWindow?.endMs - ephemerisWindow?.startMs) / 1000;
    if (!Number.isFinite(spanSeconds) || spanSeconds <= 0) return 30;
    // Keep the normal 30 s resolution for one-day operations (the same
    // resolution as AOS/LOS), while bounding long exploratory ranges.
    return Math.max(30, Math.min(3600, Math.ceil(spanSeconds / RANGE_EPHEMERIS_MAX_POINTS)));
}

function parseRangeEphemeris(payload, key, id = "") {
    const points = Array.isArray(payload?.points) ? payload.points : [];
    const parsed = points.map((point) => {
        const position = finiteVector(point?.position);
        const timeMs = Date.parse(point?.time || point?.epoch || "");
        return Number.isFinite(timeMs) && isRenderableEarthCenteredVector(position)
            ? { timeMs, x: position.x, y: position.y, z: position.z }
            : null;
    }).filter(Boolean);
    if (parsed.length < 2) return null;

    for (let index = 1; index < parsed.length; index += 1) {
        if (parsed[index].timeMs <= parsed[index - 1].timeMs) return null;
    }

    const intrinsicRange = intrinsicTimeRangeForSatellite(id);
    // A finite SP3 response must be traceable to one validated source range.
    // Cache/network races can still call this parser after a registry refresh,
    // so enforce the same fail-closed rule here as at request construction.
    if (isFinitePreciseProductTrack(id) && !intrinsicRange) {
        return null;
    }
    if (intrinsicRange && parsed.some((point) => !isInsideObjectRange(intrinsicRange, point.timeMs))) {
        // A server response which strays beyond the registered finite source
        // domain is discarded as a whole. Trimming it here would hide a
        // contract violation and could bridge a gap with interpolation.
        return null;
    }

    const runtimeFrame = normalizeReferenceFrame(
        payload?.reference_frame ?? payload?.referenceFrame ?? payload?.frame
    );
    const frameStatus = isFinitePreciseProductTrack(id)
        ? preciseProductFrameStatusForId(id, runtimeFrame, payload)
        : null;
    // Native SP3 coordinates must never be sent to Cesium as if they were a
    // compatible Earth-fixed realization. Modern backends reject this route;
    // this guard also covers old images or a delayed metadata refresh.
    if (frameStatus?.available === false) return null;

    return {
        key,
        startMs: parsed[0].timeMs,
        endMs: parsed.at(-1).timeMs,
        orbit: parsed.map(({ x, y, z }) => ({ x, y, z })),
        sampleTimesMs: parsed.map((point) => point.timeMs),
        // Do not invent an ITRF label. The endpoint must declare the frame
        // of the returned samples, or a prior explicit runtime state owns it.
        referenceFrame: runtimeFrame,
        frameStatus
    };
}

function cacheRangeEphemeris(key, ephemeris) {
    rangeEphemerisCache.delete(key);
    rangeEphemerisCache.set(key, ephemeris);
    while (rangeEphemerisCache.size > RANGE_EPHEMERIS_CACHE_LIMIT) {
        rangeEphemerisCache.delete(rangeEphemerisCache.keys().next().value);
    }
}

function invalidateRangeEphemerides() {
    // A catalogue refresh can replace a TLE under the same object name. Both
    // the browser cache and in-flight responses must then become ineligible;
    // otherwise the 3D path could belong to the previous element set while
    // AOS/LOS uses the newly loaded propagator.
    rangeEphemerisRevision += 1;
    rangeEphemerisCache.clear();
    for (const state of Object.values(satelliteState)) {
        if (!state) continue;
        state.rangeEphemeris = null;
        state.rangeEphemerisStartMs = null;
        state.rangeEphemerisEndMs = null;
        state.awaitingRangeEphemeris = false;
    }
}

function applyRangeEphemerisToState(viewer, id, state, ephemeris) {
    state.rangeEphemeris = ephemeris;
    state.rangeEphemerisStartMs = ephemeris.startMs;
    state.rangeEphemerisEndMs = ephemeris.endMs;
    state.awaitingRangeEphemeris = false;
    state.lastStateReferenceFrame = normalizeReferenceFrame(ephemeris.referenceFrame)
        || state.lastStateReferenceFrame
        || (isFinitePreciseProductTrack(id) ? normalizeReferenceFrame(preciseProductFrameStatusForId(id).nativeFrame) : null);
    state.frameStatus = ephemeris.frameStatus || state.frameStatus || null;
    renderFutureOrbitForState(viewer, id, state, state.lastOrbitPayload);
}

function requestRangeEphemeris(viewer, id, state, simulationCtx) {
    const ephemerisWindow = intersectEphemerisWindowWithIntrinsicRange(
        id,
        getExactTimelineEphemerisWindow(id, simulationCtx)
    );
    const key = rangeEphemerisKey(id, simulationCtx);
    if (!key || !ephemerisWindow || isLocalEphemerisTrack(id) || !canRenderPreciseProduct(id)) return Promise.resolve(null);
    if (state.rangeEphemeris?.key === key) return Promise.resolve(state.rangeEphemeris);

    const cached = rangeEphemerisCache.get(key);
    if (cached) {
        applyRangeEphemerisToState(viewer, id, state, cached);
        return Promise.resolve(cached);
    }

    const pending = rangeEphemerisRequests.get(key);
    if (pending) return pending;

    const startTime = new Date(ephemerisWindow.startMs).toISOString();
    const endTime = new Date(ephemerisWindow.endMs).toISOString();
    const request = enqueueRangeEphemerisRequest(async () => {
        // A large product can remain queued while the operator changes the
        // time range or removes the layer. Do not spend a request on that
        // obsolete work.
        if (!activeLayerSatelliteIds.has(id)
            || rangeEphemerisKey(id, resolveSimulationTimelineContext()) !== key) {
            return null;
        }
        const response = await fetch("/api/ephemeris", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                sat_id: id,
                start_time: startTime,
                end_time: endTime,
                step_seconds: rangeEphemerisStepSeconds(ephemerisWindow),
                include_velocity: false
            })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const ephemeris = parseRangeEphemeris(await response.json(), key, id);
        if (!ephemeris) throw new Error("La efeméride de simulación no contiene muestras en un marco terrestre disponible.");
        cacheRangeEphemeris(key, ephemeris);
        const currentContext = resolveSimulationTimelineContext();
        if (rangeEphemerisKey(id, currentContext) === key && satelliteState[id] === state) {
            applyRangeEphemerisToState(viewer, id, state, ephemeris);
        }
        return ephemeris;
    }).catch((error) => {
        // Do not fall back to a retimed WebSocket orbit: an absent line is
        // safer than showing a state from the wrong physical instant.
        if (satelliteState[id] === state && rangeEphemerisKey(id, resolveSimulationTimelineContext()) === key) {
            state.awaitingRangeEphemeris = true;
            state.rangeEphemerisErrorKey = key;
        }
        logger.warn(`No se pudo cargar la efeméride simulada de ${id}:`, error);
        return null;
    }).finally(() => rangeEphemerisRequests.delete(key));

    rangeEphemerisRequests.set(key, request);
    return request;
}

/**
 * Loads a range ephemeris without requiring an existing Cesium state.
 *
 * Historical SP3 products often have no valid position at wall-clock `now`.
 * Their first state must therefore come from the selected finite simulation
 * interval, not from the realtime WebSocket stream. This uses the same cache
 * and request key as the normal range renderer so both paths always consume
 * the same physical samples.
 */
function loadRangeEphemerisForBootstrap(id, simulationCtx) {
    const ephemerisWindow = intersectEphemerisWindowWithIntrinsicRange(
        id,
        getExactTimelineEphemerisWindow(id, simulationCtx)
    );
    const key = rangeEphemerisKey(id, simulationCtx);
    if (!key || !ephemerisWindow || isLocalEphemerisTrack(id) || !canRenderPreciseProduct(id)) return Promise.resolve(null);

    const cached = rangeEphemerisCache.get(key);
    if (cached) return Promise.resolve(cached);

    const pending = rangeEphemerisRequests.get(key);
    if (pending) return pending;

    const request = enqueueRangeEphemerisRequest(async () => {
        // Unlike realtime tracks, an SP3 only has a finite time domain. A
        // queued bootstrap may become invalid before it reaches the network.
        if (!activeLayerSatelliteIds.has(id)
            || rangeEphemerisKey(id, resolveSimulationTimelineContext()) !== key) {
            return null;
        }
        const response = await fetch("/api/ephemeris", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                sat_id: id,
                start_time: new Date(ephemerisWindow.startMs).toISOString(),
                end_time: new Date(ephemerisWindow.endMs).toISOString(),
                step_seconds: rangeEphemerisStepSeconds(ephemerisWindow),
                include_velocity: false
            })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const ephemeris = parseRangeEphemeris(await response.json(), key, id);
        if (!ephemeris) throw new Error("The selected ephemeris has no samples in an available terrestrial frame.");
        cacheRangeEphemeris(key, ephemeris);
        return ephemeris;
    }).catch((error) => {
        logger.warn(`No se pudo cargar la efeméride de simulación de ${id}:`, error);
        return null;
    }).finally(() => rangeEphemerisRequests.delete(key));

    rangeEphemerisRequests.set(key, request);
    return request;
}

function sampleRangeEphemerisAtTimelineTime(ephemeris, simulationCtx) {
    const atMs = simulationCtx?.date?.getTime?.();
    if (!ephemeris || !Number.isFinite(atMs)
        || atMs < ephemeris.startMs
        || atMs > ephemeris.endMs) {
        return null;
    }
    return sampleTrackKinematics(ephemeris.orbit, ephemeris.sampleTimesMs, atMs);
}

/**
 * Materialises an active remote layer from an exact ephemeris interval.
 * This is deliberately independent of a realtime state update: an SP3 can
 * be valid for the chosen historical range and unavailable at the current
 * wall-clock instant at the same time.
 */
function bootstrapSatelliteRangeState(viewer, id, simulationCtx) {
    const key = rangeEphemerisKey(id, simulationCtx);
    if (!viewer || !entityPool || !key || isLocalEphemerisTrack(id)
        || !activeLayerSatelliteIds.has(id) || hiddenSatelliteIds.has(id)
        || !canRenderPreciseProduct(id)) {
        return Promise.resolve(null);
    }

    const existing = satelliteState[id];
    if (existing) {
        return requestRangeEphemeris(viewer, id, existing, simulationCtx);
    }

    return loadRangeEphemerisForBootstrap(id, simulationCtx).then((ephemeris) => {
        // A range request can finish after the user moves the timeline or
        // removes the layer. Do not insert stale samples into the new view.
        if (!ephemeris
            || rangeEphemerisKey(id, resolveSimulationTimelineContext()) !== key
            || !activeLayerSatelliteIds.has(id)
            || hiddenSatelliteIds.has(id)) {
            return null;
        }

        const stateAlreadyCreated = satelliteState[id];
        if (stateAlreadyCreated) {
            applyRangeEphemerisToState(viewer, id, stateAlreadyCreated, ephemeris);
            return stateAlreadyCreated;
        }

        const currentContext = resolveSimulationTimelineContext();
        const sampled = sampleRangeEphemerisAtTimelineTime(ephemeris, currentContext);
        if (!sampled?.position) return null;

        const position = new Cesium.Cartesian3(
            sampled.position.x,
            sampled.position.y,
            sampled.position.z
        );
        const sampledVelocity = finiteVector(sampled.velocity);
        const orientation = shouldUse3DModelForSatellite(id) && vectorMagnitude(sampledVelocity) > 0
            ? calculateOrientation(sampled.position, sampledVelocity)
            : Cesium.Quaternion.IDENTITY;
        const state = ensureSatelliteState(viewer, id, position, orientation);
        state.renderPosition = position;
        state.previousPosition = position;
        state.targetPosition = position;
        state.lastVelocity = sampledVelocity;
        state.lastAcceleration = finiteVector(sampled.acceleration);
        state.lastVelocityTimestampMs = currentContext.date.getTime();
        state.lastStateReferenceFrame = normalizeReferenceFrame(ephemeris.referenceFrame)
            || state.lastStateReferenceFrame
            || normalizeReferenceFrame(preciseProductFrameStatusForId(id).nativeFrame);
        state.frameStatus = ephemeris.frameStatus || state.frameStatus || null;

        applyRangeEphemerisToState(viewer, id, state, ephemeris);
        applySatelliteVisibility(id, state);
        return state;
    });
}

function primeSatelliteTimelineRange(id) {
    if (!isFinitePreciseProductTrack(id)
        || !hasValidatedFiniteCoverage(id)
        || !canRenderPreciseProduct(id)) {
        return Promise.resolve(null);
    }
    const simulationCtx = resolveSimulationTimelineContext();
    if (!simulationCtx || !getExactTimelineEphemerisWindow(id, simulationCtx)) {
        return Promise.resolve(null);
    }
    return bootstrapSatelliteRangeState(currentViewer, id, simulationCtx);
}

function invalidateRetimedRangeOrbit(viewer, state) {
    state.awaitingRangeEphemeris = true;
    state.simOrbitPositions = [];
    state.simOrbitSampleTimesMs = null;
    if (state.orbitEntity) {
        viewer.entities.remove(state.orbitEntity);
        state.orbitEntity = null;
    }
    remove2DOverlays(viewer, state);
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
    const startMs = Number(state?.rangeEphemerisStartMs ?? state?.simTrackStartMs);
    const endMs = Number(state?.rangeEphemerisEndMs ?? state?.simTrackEndMs);
    return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
}

function isOutsideSimulationTrackWindow(id, state, simulationDate) {
    if (!(simulationDate instanceof Date)) {
        return isFiniteEphemerisSource(id);
    }
    const simMs = simulationDate.getTime();
    if (!Number.isFinite(simMs)) {
        return isFiniteEphemerisSource(id);
    }

    // The source range is authoritative even when the current local state is
    // a smaller cached/requested sub-window. This catches a finite SP3 that
    // has not been materialised yet and prevents manual/OEM realtime paths
    // from retaining their last marker after their final sample.
    const intrinsicStatus = intrinsicTimeStatusForSatellite(id, simMs);
    if (isFiniteEphemerisSource(id)) {
        return intrinsicStatus.active !== true;
    }

    if (!hasValidSimulationTrackWindow(state)) {
        return false;
    }
    const startMs = Number(state.rangeEphemerisStartMs ?? state.simTrackStartMs);
    const endMs = Number(state.rangeEphemerisEndMs ?? state.simTrackEndMs);
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
    state.temporalStatus = outOfTime ? "out_of_range" : "active";
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
    const simulationCtx = resolveSimulationTimelineContext();
    const temporalStatus = intrinsicTimeStatusForSatellite(
        id,
        temporalDateForSimulationContext(simulationCtx)
    );
    const outOfTime = state.isOutOfTimeVisualState === true || temporalStatus.active !== true;
    state.temporalStatus = outOfTime ? "out_of_range" : "active";
    const visible = isActiveLayer
        && !hiddenSatelliteIds.has(id)
        && !outOfTime
        && canRenderPreciseProduct(id);
    const overlayMode = resolveOrbitOverlayMode(currentViewer, id);
    state.entity.show = visible;

    if (state.orbitEntity) {
        state.orbitEntity.show = visible && overlayMode.showSpatialOrbit;
    }
    if (state.groundTrackEntity) {
        state.groundTrackEntity.show = visible && overlayMode.showProjectedOrbit;
    }
    if (state.footprintEntity) {
        state.footprintEntity.show = visible && overlayMode.showFootprint;
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

            if (state && !hasVisibleSatelliteSurfaceOverlay(entityPool.viewer, id)) {
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
        wsClient.setSubscriptions(Array.from(activeLayerSatelliteIds).filter((id) => canRenderPreciseProduct(id)));
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
    return Boolean(
        viewer?.scene
        && typeof Cesium !== "undefined"
        && Cesium.SceneMode
        && viewer.scene.mode === Cesium.SceneMode.SCENE2D
    );
}

/**
 * Keep the meaning of the two orbit controls stable across projections.
 *
 * In a globe view, the future-orbit control owns the spatial trajectory and
 * Ground Track owns the optional surface trace plus its geometric visibility
 * footprint. In a map view there is no useful elevated trajectory: the
 * future-orbit line becomes its projection on the Earth, while Ground Track
 * becomes the independent visibility-footprint control.
 */
function resolveOrbitOverlayMode(viewer, id) {
    const futureOrbitVisible = shouldShowFutureOrbit(id);
    const groundTrackVisible = shouldShowGroundTrack(id);

    if (isViewerIn2D(viewer)) {
        return {
            showSpatialOrbit: false,
            showProjectedOrbit: futureOrbitVisible,
            showFootprint: groundTrackVisible
        };
    }

    return {
        showSpatialOrbit: futureOrbitVisible,
        showProjectedOrbit: groundTrackVisible,
        showFootprint: groundTrackVisible
    };
}

function hasVisibleSatelliteSurfaceOverlay(viewer, id) {
    const mode = resolveOrbitOverlayMode(viewer, id);
    return mode.showProjectedOrbit || mode.showFootprint;
}

function remove2DOverlays(viewer, state) {
    if (!viewer || !state) {
        return;
    }

    if (state.groundTrackEntity && typeof viewer.entities?.remove === "function") {
        viewer.entities.remove(state.groundTrackEntity);
        state.groundTrackEntity = null;
    }

    if (state.footprintEntity && typeof viewer.entities?.remove === "function") {
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
        const vector = finiteVector(point);
        if (!isRenderableEarthCenteredVector(vector)) {
            continue;
        }

        try {
            const cart = new Cesium.Cartesian3(vector.x, vector.y, vector.z);
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
    if (typeof Cesium === "undefined"
        || !Cesium.Ellipsoid?.WGS84
        || !Number.isFinite(Cesium.Ellipsoid.WGS84.maximumRadius)) {
        return 0;
    }

    const cartographic = cartographicFromFiniteCartesian(position);
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
    if (!centerCartographic
        || !Number.isFinite(Number(angularRadius))
        || !(angularRadius > 0)
        || typeof Cesium === "undefined"
        || !Cesium.Cartesian3
        || typeof Cesium.Cartesian3.fromRadians !== "function") {
        return [];
    }

    const lat1 = Number(centerCartographic.latitude);
    const lon1 = Number(centerCartographic.longitude);
    if (!Number.isFinite(lat1) || !Number.isFinite(lon1)) {
        return [];
    }
    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinR = Math.sin(angularRadius);
    const cosR = Math.cos(angularRadius);
    const twoPi = Number(Cesium.Math?.TWO_PI) || (2 * Math.PI);

    const positions = [];
    for (let i = 0; i <= segments; i += 1) {
        const bearing = (i / segments) * twoPi;
        const sinLat2 = sinLat1 * cosR + cosLat1 * sinR * Math.cos(bearing);
        const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat2)));
        const y = Math.sin(bearing) * sinR * cosLat1;
        const x = cosR - sinLat1 * sinLat2;
        const lon2 = lon1 + Math.atan2(y, x);
        const position = Cesium.Cartesian3.fromRadians(lon2, lat2, FOOTPRINT_SURFACE_HEIGHT);
        if (finiteVector(position)) {
            positions.push(position);
        }
    }

    return positions;
}

function removeFootprintEntity(viewer, state) {
    if (!state?.footprintEntity) {
        return;
    }
    if (typeof viewer?.entities?.remove === "function") {
        viewer.entities.remove(state.footprintEntity);
    }
    state.footprintEntity = null;
}

/**
 * Draw the geometric horizon of an Earth-fixed satellite position.
 *
 * This is intentionally a visibility footprint, not a station mask or a
 * radio-link calculation: the edge is the zero-elevation geometric horizon.
 */
function updateVisibilityFootprint(viewer, state, {
    ownerId,
    center,
    color,
    visible
} = {}) {
    if (!visible
        || !viewer?.entities
        || typeof viewer.entities.add !== "function"
        || !center
        || typeof Cesium === "undefined"
        || !Cesium.PolygonHierarchy
        || !Cesium.Ellipsoid?.WGS84
        || !Cesium.Cartographic
        || typeof Cesium.Cartographic.fromCartesian !== "function") {
        removeFootprintEntity(viewer, state);
        return false;
    }

    const cartographic = cartographicFromFiniteCartesian(center);
    if (!cartographic) {
        removeFootprintEntity(viewer, state);
        return false;
    }

    const footprintAngularRadius = computeFootprintAngularRadius(center);
    const footprintRadiusMeters = Cesium.Ellipsoid.WGS84.maximumRadius * footprintAngularRadius;
    if (!(footprintRadiusMeters > 10)) {
        removeFootprintEntity(viewer, state);
        return false;
    }

    const footprintPositions = computeFootprintCirclePositions(cartographic, footprintAngularRadius);
    if (footprintPositions.length < 3) {
        removeFootprintEntity(viewer, state);
        return false;
    }

    const baseColor = color && typeof color.withAlpha === "function"
        ? color
        : getOpaqueColor(MANUAL_ORBIT_PREVIEW_COLOR, MANUAL_ORBIT_PREVIEW_COLOR);
    const fillColor = baseColor.withAlpha(FOOTPRINT_FILL_ALPHA);
    const outlineColor = baseColor.withAlpha(FOOTPRINT_OUTLINE_ALPHA);
    const footprintHierarchy = new Cesium.PolygonHierarchy(footprintPositions);

    if (!state.footprintEntity) {
        state.footprintEntity = viewer.entities.add({
            id: `${ownerId}-footprint`,
            polygon: {
                hierarchy: footprintHierarchy,
                material: fillColor,
                height: FOOTPRINT_SURFACE_HEIGHT,
                outline: true,
                outlineColor,
                outlineWidth: 2,
                arcType: Cesium.ArcType?.GEODESIC
            }
        });
    } else {
        state.footprintEntity.polygon.hierarchy = footprintHierarchy;
        state.footprintEntity.polygon.material = fillColor;
        state.footprintEntity.polygon.outlineColor = outlineColor;
        state.footprintEntity.polygon.height = FOOTPRINT_SURFACE_HEIGHT;
        state.footprintEntity.show = true;
    }

    return true;
}

function updateGroundTrackAndFootprint(viewer, id, state, visibleOrbit) {
    if (!viewer || !state) {
        return;
    }

    const overlayMode = resolveOrbitOverlayMode(viewer, id);
    const isVisible = !hiddenSatelliteIds.has(id)
        && activeLayerSatelliteIds.has(id)
        && state.isOutOfTimeVisualState !== true;
    if (!isVisible || (!overlayMode.showProjectedOrbit && !overlayMode.showFootprint)) {
        remove2DOverlays(viewer, state);
        return;
    }

    const baseColor = getFutureOrbitColor(id);
    if (overlayMode.showProjectedOrbit) {
        const trackPositions = toSurfaceGroundTrack(visibleOrbit);
        if (trackPositions.length >= 2) {
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
                        arcType: getSurfaceGroundTrackArcType(),
                        clampToGround: false
                    }
                });
            } else {
                state.groundTrackEntity.polyline.positions = trackPositions;
                state.groundTrackEntity.polyline.width = trackWidth;
                state.groundTrackEntity.polyline.material = createOrbitMaterial(trackColor);
                state.groundTrackEntity.polyline.arcType = getSurfaceGroundTrackArcType();
                state.groundTrackEntity.show = true;
            }
        } else if (state.groundTrackEntity) {
            viewer.entities.remove(state.groundTrackEntity);
            state.groundTrackEntity = null;
        }
    } else if (state.groundTrackEntity) {
        viewer.entities.remove(state.groundTrackEntity);
        state.groundTrackEntity = null;
    }

    const center = state.renderPosition
        || state.targetPosition
        || resolveCartesianPosition(state.entity?.position);
    updateVisibilityFootprint(viewer, state, {
        ownerId: id,
        center,
        color: baseColor,
        visible: overlayMode.showFootprint
    });
    state.lastFootprintRefreshAtMs = Date.now();
}

function refreshSatelliteFootprint(viewer, id, state, nowMs = Date.now(), force = false) {
    if (!viewer || !state) {
        return;
    }

    const overlayMode = resolveOrbitOverlayMode(viewer, id);
    const visible = !hiddenSatelliteIds.has(id)
        && activeLayerSatelliteIds.has(id)
        && state.isOutOfTimeVisualState !== true;
    if (!visible || !overlayMode.showFootprint) {
        removeFootprintEntity(viewer, state);
        return;
    }

    const lastRefreshMs = Number(state.lastFootprintRefreshAtMs) || 0;
    if (!force && (nowMs - lastRefreshMs) < FOOTPRINT_REFRESH_INTERVAL_MS) {
        return;
    }

    const center = state.renderPosition
        || state.targetPosition
        || resolveCartesianPosition(state.entity?.position);
    updateVisibilityFootprint(viewer, state, {
        ownerId: id,
        center,
        color: getFutureOrbitColor(id),
        visible: true
    });
    state.lastFootprintRefreshAtMs = nowMs;
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
        // The WebSocket catalogue currently sends identifiers, not the rich
        // provenance carried by an imported SP3 product. Reapply those local
        // records after every catalogue broadcast so they do not disappear
        // from Layers when a remote catalogue refresh completes.
        for (const entry of preciseProductEntryBySatelliteId.values()) {
            catalogSatelliteIds.add(entry.id);
            catalogEntryMetaBySatelliteId.set(entry.id, createCatalogEntryMeta(entry, entry.name));
        }
        catalogLoaded = true;
        satelliteIdsDirty = true;
    });

    wsClient = ws;

    // A project can restore an already-active historical SP3 layer before
    // Cesium finishes initialising. Seed it from the selected simulation
    // interval now rather than waiting for a realtime position that is
    // necessarily outside its finite product coverage.
    for (const id of activeLayerSatelliteIds) {
        if (isFinitePreciseProductTrack(id)) {
            void primeSatelliteTimelineRange(id);
        }
    }

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

            if (useSimulationOrbit && state.awaitingRangeEphemeris) {
                applyOutOfTimeVisualState(id, state, true);
                continue;
            }

            const temporalDate = temporalDateForSimulationContext(simulationCtx, now);
            const outsideTrackWindow = isOutsideSimulationTrackWindow(id, state, temporalDate);
            applyOutOfTimeVisualState(id, state, outsideTrackWindow);
            if (outsideTrackWindow) {
                // Do not interpolate a stale last state while the object is
                // out of its own finite source range. The retained runtime
                // record only lets it reactivate when the timeline returns.
                continue;
            }

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
                    refreshSatelliteFootprint(viewer, id, state, now);
                    continue;
                }
            }

            if (useSimulationOrbit) {
                const sampled = sampleOrbitPositionForDate(state, simulationCtx.date);
                if (sampled) {
                    state.renderPosition = sampled;
                    state.entity.position = sampled;
                    refreshSatelliteFootprint(viewer, id, state, now);
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

            refreshSatelliteFootprint(viewer, id, state, now);
        }
        
        requestAnimationFrame(smoothUpdateFrame);
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
    return (Array.isArray(points) ? points : [])
        .filter(isRenderableEarthCenteredVector)
        .map((position) => new Cesium.Cartesian3(position.x, position.y, position.z));
}

function getColor(colorString, defaultColor) {
    try {
        return Cesium.Color.fromCssColorString(colorString || defaultColor);
    } catch {
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
    } catch {
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
    } catch {
        // ignore
    }

    // Si la capa no está activa, ignorar updates de estado para evitar recrear entidades.
    if (!activeLayerSatelliteIds.has(id)) {
        return;
    }
    if (!canRenderPreciseProduct(id)) {
        clearUnavailablePreciseProductRendering(id);
        return;
    }
    const temporalStatus = intrinsicTimeStatusForSatellite(
        id,
        temporalDateForSimulationContext(resolveSimulationTimelineContext(), receivedAtMs)
    );
    if (temporalStatus.active !== true) {
        const existing = satelliteState[id];
        if (existing) {
            applyOutOfTimeVisualState(id, existing, true);
        }
        // A rolling WebSocket packet is never a substitute for an OEM/SP3/
        // manual sample outside that object's intrinsic finite domain.
        return;
    }
    const isNewSatellite = !satelliteState[id];

    // Si el satélite está oculto, ignorar por completo updates para ahorrar CPU.
    if (hiddenSatelliteIds.has(id)) {
        return;
    }

    const pos = finiteVector(satData.position);
    const vel = finiteVector(satData.velocity);

    if (!isRenderableEarthCenteredVector(pos)) {
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
    // The regular catalogue stream is Earth-fixed today, but a precise SP3
    // layer must never inherit that ITRF fallback. Its explicit runtime frame
    // (or native provenance when there is no renderable stream frame) owns the
    // label shown to the operator.
    const streamedFrame = normalizeReferenceFrame(
        satData.reference_frame || satData.referenceFrame || satData.ref_frame || satData.frame
    );
    state.lastStateReferenceFrame = streamedFrame
        || state.lastStateReferenceFrame
        || (isFinitePreciseProductTrack(id)
            ? normalizeReferenceFrame(preciseProductFrameStatusForId(id).returnedFrame)
                || normalizeReferenceFrame(preciseProductFrameStatusForId(id).nativeFrame)
                || null
            : "ITRF");

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

    // Update immediately when a new telemetry state arrives, then let the
    // render loop keep the circle aligned with interpolated/range positions.
    refreshSatelliteFootprint(viewer, id, state, receivedAtMs, true);
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
    invalidateRangeEphemerides();
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

    // SP3 products are owned by the Python precise-product registry rather
    // than the paginated Node catalogue. Keep their metadata and stable
    // runtime ids available after a regular catalogue refresh.
    for (const entry of preciseProductEntryBySatelliteId.values()) {
        catalogSatelliteIds.add(entry.id);
        catalogEntryMetaBySatelliteId.set(entry.id, createCatalogEntryMeta(entry, entry.name));
    }
    if (preciseProductEntryBySatelliteId.size) {
        satelliteIdsDirty = true;
        catalogLoaded = true;
    }

    try {
        if (wsClient && typeof wsClient.setSubscriptions === "function") {
            const ids = Array.from(activeLayerSatelliteIds).filter((id) => !isLocalEphemerisTrack(id) && canRenderPreciseProduct(id));
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

/**
 * Resolve the presentation name for a source satellite identity.
 *
 * Precise-product runtime IDs deliberately include their product hash, for
 * example ``precise:precise-…:C06``. They are stable machine identities, not
 * names intended for operators. Keeping this resolver with the catalogue
 * registry makes every Layers consumer able to show the SP3 member code
 * (``C06``, ``G01``, …) while retaining the full ID for requests and saved
 * projects.
 */
export function getSatelliteDisplayName(id, fallback = "") {
    const normalizedId = String(id || "").trim();
    const metadata = normalizedId ? catalogEntryMetaBySatelliteId.get(normalizedId) : null;
    const name = catalogMetadataText(metadata, ["name", "catalogName", "catalog_name"]);
    return name || String(fallback || normalizedId).trim();
}

function oemTelemetryDescriptor(track, frameTimeMs) {
    if (!track || typeof track !== "object") return null;
    const range = trackIntrinsicTimeRange(track);
    return {
        start_time_ms: range?.startTimeMs ?? null,
        end_time_ms: range?.endTimeMs ?? null,
        samples: Number.isFinite(Number(track.samples)) ? Number(track.samples) : null,
        file_name: track.fileName || null,
        object_name: track.objectName || null,
        object_id: track.objectId || null,
        center_name: track.centerName || null,
        ref_frame: track.refFrame || null,
        time_system: track.timeSystem || null,
        start_time_raw: track.startTimeRaw || null,
        stop_time_raw: track.stopTimeRaw || null,
        is_in_time_window: range && Number.isFinite(frameTimeMs)
            ? isInsideObjectRange(range, frameTimeMs)
            : false
    };
}

function outOfRangeTelemetry({
    id,
    sourceFormat,
    sourceOrigin,
    sp3,
    frameStatus,
    oemTrack,
    frameTimeMs,
    temporalStatus
}) {
    const range = temporalStatus?.range || null;
    const sourceFrame = sourceFormat === "OEM"
        ? String(oemTrack?.refFrame || "").trim().toUpperCase() || null
        : sourceFormat === "SP3"
            // A native-only product can retain a compatibility-looking
            // `returnedFrame` diagnostic even though no terrestrial vector
            // was actually returned. Its intrinsic source realization is
            // the only truthful frame to show while it is out of range.
            ? frameStatus?.nativeFrame || frameStatus?.returnedFrame || null
            : "ITRF";
    return {
        id,
        source_format: sourceFormat,
        source_origin: sourceOrigin,
        position: null,
        position_ecef_m: null,
        position_frame: sourceFrame,
        position_frame_display: frameStatus?.displayFrame || sourceFrame,
        geo: null,
        velocity: { x: null, y: null, z: null },
        velocity_frame: sourceFrame,
        velocity_ecef_m_s: null,
        acceleration_ecef_m_s2: null,
        oem: oemTelemetryDescriptor(oemTrack, frameTimeMs),
        sp3,
        renderer_reference: frameStatus || null,
        earth_orientation: frameStatus?.earthOrientation || null,
        rendering_available: frameStatus?.available ?? null,
        intrinsic_time_range: cloneIntrinsicTimeRange(range),
        has_intrinsic_time_range: temporalStatus?.hasIntrinsicTimeRange === true,
        temporal_status: "out_of_range",
        object_status: "out_of_range",
        out_of_range: true,
        out_of_range_reason: temporalStatus?.reason || "outside-intrinsic-time-range",
        out_of_range_message: "Este objeto no tiene datos para la época actual.",
        is_visible: false,
        is_active: false,
        runtime_state: "OUT_OF_RANGE",
        timestamp_ms: frameTimeMs
    };
}

export function getSatelliteTelemetry(id) {
    const entryMeta = getCatalogEntryMeta(id) || {};
    const sourceFormat = String(entryMeta.sourceFormat || "TLE").toUpperCase();
    const sourceOrigin = String(entryMeta.sourceOrigin || "CATALOG").toUpperCase();
    const sp3 = sourceFormat === "SP3"
        ? ((entryMeta.inputMetadata && typeof entryMeta.inputMetadata === "object")
            ? { ...entryMeta.inputMetadata }
            : null)
        : null;
    const metadataPreciseFrameStatus = sourceFormat === "SP3"
        ? resolvePreciseProductFrameStatus({ ...entryMeta, sp3 })
        : null;
    const simulationCtx = resolveSimulationTimelineContext();
    const usesTimelineFrame = Boolean(simulationCtx && simulationCtx.mode !== "realtime");
    const nowMs = Date.now();
    const frameTimeMs = temporalDateForSimulationContext(simulationCtx, nowMs).getTime();
    const oemTrack = oemEphemerisTrackById.get(id);
    const temporalStatus = intrinsicTimeStatusForSatellite(id, frameTimeMs);
    // Native-only products remain visible as Layers/Input provenance, but no
    // Cartesian state can be shown or used for station geometry until the
    // backend has explicitly provided a terrestrial realization operation.
    if (metadataPreciseFrameStatus?.available === false) {
        if (temporalStatus.active !== true) {
            return outOfRangeTelemetry({
                id,
                sourceFormat,
                sourceOrigin,
                sp3,
                frameStatus: metadataPreciseFrameStatus,
                oemTrack,
                frameTimeMs,
                temporalStatus
            });
        }
        return {
            id,
            source_format: sourceFormat,
            source_origin: sourceOrigin,
            position: null,
            position_ecef_m: null,
            position_frame: metadataPreciseFrameStatus.nativeFrame,
            position_frame_display: metadataPreciseFrameStatus.displayFrame,
            velocity: { x: null, y: null, z: null },
            velocity_frame: metadataPreciseFrameStatus.nativeFrame,
            geo: null,
            sp3,
            renderer_reference: metadataPreciseFrameStatus,
            earth_orientation: metadataPreciseFrameStatus.earthOrientation || null,
            rendering_available: false,
            runtime_state: "UNAVAILABLE",
            is_visible: !hiddenSatelliteIds.has(id),
            is_active: activeLayerSatelliteIds.has(id),
            intrinsic_time_range: cloneIntrinsicTimeRange(temporalStatus.range),
            has_intrinsic_time_range: temporalStatus.hasIntrinsicTimeRange === true,
            temporal_status: temporalStatus.status,
            timestamp_ms: frameTimeMs
        };
    }

    const state = satelliteState[id];
    if (!state || !state.entity) {
        if (temporalStatus.active !== true) {
            return outOfRangeTelemetry({
                id,
                sourceFormat,
                sourceOrigin,
                sp3,
                frameStatus: metadataPreciseFrameStatus,
                oemTrack,
                frameTimeMs,
                temporalStatus
            });
        }
        return null;
    }
    // A range/ephemeris response can carry a newer realization/EOP diagnostic
    // than the persisted product record. Prefer that status for presentation,
    // while retaining product metadata as the startup fallback.
    const preciseFrameStatus = sourceFormat === "SP3"
        ? (state.frameStatus || metadataPreciseFrameStatus)
        : null;

    if (temporalStatus.active !== true) {
        return outOfRangeTelemetry({
            id,
            sourceFormat,
            sourceOrigin,
            sp3,
            frameStatus: preciseFrameStatus || metadataPreciseFrameStatus,
            oemTrack,
            frameTimeMs,
            temporalStatus
        });
    }
    const simulatedKinematics = usesTimelineFrame
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

    const manualTrack = manualOrbitTrackById.get(id);
    // TLE/SGP4 state is converted from TEME to Cesium-compatible ECEF by the
    // backend. An OEM can declare another source frame, so only call it ECEF
    // when that declaration is explicitly earth-fixed.
    const sourceFrame = sourceFormat === "OEM"
        ? String(oemTrack?.refFrame || "").trim().toUpperCase() || null
        : normalizeReferenceFrame(state.lastStateReferenceFrame)
            || (sourceFormat === "SP3" ? preciseFrameStatus?.returnedFrame || preciseFrameStatus?.nativeFrame || null : "ITRF");
    const coordinatesAreEarthFixed = isEarthFixedFrame(sourceFrame);
    const positionVector = finiteVector(position);
    // In range simulation the rendered position comes from the sampled orbit,
    // not the latest realtime WebSocket message. Never mix that realtime
    // velocity/acceleration into the simulated frame; derive both from the
    // neighbouring track samples, or leave them unavailable.
    const velocityVector = usesTimelineFrame
        ? finiteVector(simulatedKinematics?.velocity)
        : finiteVector(state.lastVelocity);
    const accelerationVector = usesTimelineFrame
        ? finiteVector(simulatedKinematics?.acceleration)
        : finiteVector(state.lastAcceleration);
    const positionEcef = coordinatesAreEarthFixed ? positionVector : null;
    const velocityEcef = coordinatesAreEarthFixed ? velocityVector : null;
    const accelerationEcef = coordinatesAreEarthFixed ? accelerationVector : null;
    const speed = vectorMagnitude(velocityVector);

    const cartographic = coordinatesAreEarthFixed
        ? cartographicFromFiniteCartesian(positionVector)
        : null;
    const latitudeDeg = cartographic ? Cesium.Math.toDegrees(cartographic.latitude) : null;
    const longitudeDeg = cartographic ? Cesium.Math.toDegrees(cartographic.longitude) : null;
    const altitudeM = cartographic ? cartographic.height : null;

    let distanceToCameraM = null;
    const positionCartesian = cesiumCartesianFromFiniteVector(positionVector);
    if (coordinatesAreEarthFixed
        && positionCartesian
        && finiteVector(currentViewer?.camera?.positionWC)
        && typeof Cesium !== "undefined"
        && Cesium.Cartesian3
        && typeof Cesium.Cartesian3.distance === "function") {
        distanceToCameraM = Cesium.Cartesian3.distance(currentViewer.camera.positionWC, positionCartesian);
    }

    const speedKmS = Number.isFinite(speed) ? speed / 1000 : null;
    const speedKmH = Number.isFinite(speed) ? speed * 3.6 : null;
    const telemetryAgeMs = usesTimelineFrame ? null : nowMs - (state.lastMessageTime || nowMs);
    const propagationFutureHours = getPropagationHoursForSatellite(id);

    const oem = sourceFormat === "OEM" ? oemTelemetryDescriptor(oemTrack, frameTimeMs) : null;
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
        position_frame_display: preciseFrameStatus?.displayFrame || sourceFrame,
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
        sp3,
        renderer_reference: preciseFrameStatus || state.frameStatus || null,
        earth_orientation: preciseFrameStatus?.earthOrientation || state.frameStatus?.earthOrientation || null,
        rendering_available: preciseFrameStatus?.available ?? null,
        // Kept alongside the camel-case catalog metadata for consumers that
        // build their object details directly from telemetry.
        manual_orbit: manualTrack?.manualOrbit ? cloneManualOrbitValue(manualTrack.manualOrbit) : null,
        intrinsic_time_range: cloneIntrinsicTimeRange(temporalStatus.range),
        has_intrinsic_time_range: temporalStatus.hasIntrinsicTimeRange === true,
        temporal_status: "active",
        object_status: "active",
        out_of_range: false,
        is_visible: !hiddenSatelliteIds.has(id) && isInView,
        is_active: isActive,
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
        const finitePrecise = isFinitePreciseProductTrack(id);
        const canSampleFiniteSource = hasValidatedFiniteCoverage(id);
        if (!isLocalEphemerisTrack(id) && canRenderPreciseProduct(id) && canSampleFiniteSource) {
            wsClient?.subscribe([id]);
        }
        // An SP3 range can be historical, so its WebSocket update at `now`
        // may contain no position. Prime the layer directly from its exact
        // simulation interval when one is active.
        if (finitePrecise && canRenderPreciseProduct(id) && canSampleFiniteSource) {
            void primeSatelliteTimelineRange(id);
        } else if (finitePrecise) {
            // Keep the layer and its provenance selectable, but do not make a
            // native realization or coverage-less finite product appear as a
            // Cesium/ITRF orbit.
            clearUnavailablePreciseProductRendering(id);
            const state = satelliteState[id];
            if (state) applyOutOfTimeVisualState(id, state, true);
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
        wsClient?.setSubscriptions(nextIds.filter((id) => (
            !isLocalEphemerisTrack(id)
            && canRenderPreciseProduct(id)
            && hasValidatedFiniteCoverage(id)
        )));
        nextIds.forEach((id) => {
            if (isFinitePreciseProductTrack(id)
                && canRenderPreciseProduct(id)
                && hasValidatedFiniteCoverage(id)) {
                void primeSatelliteTimelineRange(id);
            } else if (isFinitePreciseProductTrack(id)) {
                clearUnavailablePreciseProductRendering(id);
                const state = satelliteState[id];
                if (state) applyOutOfTimeVisualState(id, state, true);
            }
        });
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
    } else if (visible && activeLayerSatelliteIds.has(id) && isFinitePreciseProductTrack(id)) {
        // A hidden historical layer intentionally has no entity. Recreate it
        // from the current exact interval when it becomes visible again.
        void primeSatelliteTimelineRange(id);
    }

    emitObjectStateChanged({ sourceId: id, reason: "visibility" });
}

function renderFutureOrbitForState(viewer, id, state, orbitPayload) {
    if (!viewer || !state) {
        return;
    }

    const simulationCtx = resolveSimulationTimelineContext();
    const temporalDate = temporalDateForSimulationContext(simulationCtx);
    const isOutOfIntrinsicRange = isOutsideSimulationTrackWindow(id, state, temporalDate);
    applyOutOfTimeVisualState(id, state, isOutOfIntrinsicRange);
    if (isOutOfIntrinsicRange) {
        // Keep the layer selected but remove every render/interpolation path.
        // It can reappear only if the shared timeline returns to its own
        // intrinsic coverage; no old marker or extrapolated polyline survives.
        state.awaitingRangeEphemeris = false;
        if (state.orbitEntity) {
            viewer.entities.remove(state.orbitEntity);
            state.orbitEntity = null;
        }
        remove2DOverlays(viewer, state);
        return;
    }
    const rangeKey = rangeEphemerisKey(id, simulationCtx);
    const exactTimelineWindow = getExactTimelineEphemerisWindow(id, simulationCtx);
    const activeRangeEphemeris = rangeKey && state.rangeEphemeris?.key === rangeKey
        ? state.rangeEphemeris
        : null;
    if (exactTimelineWindow && !isLocalEphemerisTrack(id)) {
        if (!activeRangeEphemeris) {
            invalidateRetimedRangeOrbit(viewer, state);
            void requestRangeEphemeris(viewer, id, state, simulationCtx);
            return;
        }
        // This payload has an explicit UTC timestamp for every ITRF vertex.
        // It takes precedence over the rolling WebSocket preview in range or
        // static simulation, so a path and an AOS/LOS computation describe
        // the same physical state history.
        orbitPayload = {
            ...(orbitPayload || {}),
            orbit: activeRangeEphemeris.orbit,
            sampleTimesMs: activeRangeEphemeris.sampleTimesMs,
            orbit_start_time: new Date(activeRangeEphemeris.startMs).toISOString(),
            orbit_end_time: new Date(activeRangeEphemeris.endMs).toISOString()
        };
    } else {
        state.awaitingRangeEphemeris = false;
    }

    const rawOrbit = orbitPayload?.orbit;
    const candidateSampleTimes = Array.isArray(orbitPayload?.sampleTimesMs)
        ? orbitPayload.sampleTimesMs
        : (isLocalEphemerisTrack(id) && Array.isArray(state.simTrackSampleTimesMs)
            ? state.simTrackSampleTimesMs
            : null);
    // A persisted product created by an older backend can still contain an
    // all-zero SP3 missing-state record.  Strip it here as the final client
    // boundary before an orbit is passed to Cesium, keeping its timestamps in
    // lockstep with the surviving Cartesian samples.
    const normalizedOrbit = normalizeRenderableOrbitSamples(rawOrbit, candidateSampleTimes);
    const orbit = normalizedOrbit.points;
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

    // The selected simulation range is the operational horizon. Do not crop
    // it again with the real-time preview preference or the last pass in the
    // visible range could disappear from the scene.
    const horizonClippedOrbit = simulationCtx?.mode === "range"
        ? orbit
        : clipFutureOrbitByRequestedHorizon(id, orbit);
    const effectiveHorizonHoursRaw = Number(getPropagationHoursForSatellite(id));
    const effectiveHorizonHours = Number.isFinite(effectiveHorizonHoursRaw) && effectiveHorizonHoursRaw > 0
        ? effectiveHorizonHoursRaw
        : (Number.isFinite(sourceFutureOrbitHours) && sourceFutureOrbitHours > 0 ? sourceFutureOrbitHours : 12);

    state.simOrbitPositions = toCartesianArray(horizonClippedOrbit);
    const sourceSampleTimes = normalizedOrbit.sampleTimesMs;
    // Preserve physical timestamps from exact range/static ephemerides and
    // imported OEM/manual tracks. A plain WebSocket preview has no per-point
    // epoch and therefore remains a realtime-only visual aid.
    state.simOrbitSampleTimesMs = sourceSampleTimes && sourceSampleTimes.length === orbit.length
        ? sourceSampleTimes.slice(0, horizonClippedOrbit.length).map(Number)
        : null;
    if (state.simOrbitSampleTimesMs?.length === horizonClippedOrbit.length) {
        state.simOrbitReferenceMs = state.simOrbitSampleTimesMs[0];
        state.simOrbitHorizonSeconds = Math.max(1, (state.simOrbitSampleTimesMs.at(-1) - state.simOrbitReferenceMs) / 1000);
    } else {
        const orbitStartMs = Date.parse(orbitPayload?.orbit_start_time || "");
        const orbitEndMs = Date.parse(orbitPayload?.orbit_end_time || "");
        if (Number.isFinite(orbitStartMs) && Number.isFinite(orbitEndMs) && orbitEndMs > orbitStartMs) {
            state.simOrbitReferenceMs = orbitStartMs;
            state.simOrbitHorizonSeconds = Math.max(1, (orbitEndMs - orbitStartMs) / 1000);
        } else {
            state.simOrbitReferenceMs = Date.now();
            state.simOrbitHorizonSeconds = Math.max(1, effectiveHorizonHours * 3600);
        }
    }

    const futureOrbitVisible = shouldShowFutureOrbit(id);
    const groundTrackVisible = shouldShowGroundTrack(id);
    const overlayMode = resolveOrbitOverlayMode(viewer, id);
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
        state.orbitEntity.show = overlayMode.showSpatialOrbit;
    }

    updateGroundTrackAndFootprint(viewer, id, state, visibleOrbit);
}

export function refreshSatelliteOverlays(viewer = currentViewer) {
    if (!viewer) {
        return;
    }

    // A project restore can reactivate historical SP3 layers before its saved
    // range/static timeline is restored. Once the timeline changes, there is
    // still no WebSocket state at wall-clock `now` to enter this loop. Prime
    // those active-but-unmaterialised layers from their exact interval here.
    for (const id of activeLayerSatelliteIds) {
        if (!satelliteState[id] && !hiddenSatelliteIds.has(id) && isFinitePreciseProductTrack(id)) {
            void primeSatelliteTimelineRange(id);
        }
    }

    for (const [id, state] of Object.entries(satelliteState)) {
        if (!state) {
            continue;
        }

        if (state.lastOrbitPayload || state.rangeEphemeris) {
            renderFutureOrbitForState(viewer, id, state, state.lastOrbitPayload);
        } else {
            remove2DOverlays(viewer, state);
        }
    }

    // The manual designer is intentionally outside `satelliteState`, so it
    // needs its own refresh when Cesium finishes morphing between 3D and 2D.
    if (manualOrbitPreviewState.visible && manualOrbitPreviewState.points.length >= 2) {
        renderManualOrbitPreviewEntities(viewer);
    }
}

function updateSatelliteOrbit(viewer, satData) {
    const id = satData.satellite || "UNKNOWN";

    // Nunca dibujar órbitas de satélites sin capa activa.
    if (!activeLayerSatelliteIds.has(id)) {
        return;
    }
    if (!canRenderPreciseProduct(id)) {
        clearUnavailablePreciseProductRendering(id);
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

    const temporalStatus = intrinsicTimeStatusForSatellite(
        id,
        temporalDateForSimulationContext(resolveSimulationTimelineContext())
    );
    if (temporalStatus.active !== true) {
        applyOutOfTimeVisualState(id, state, true);
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

    if (!hasVisibleSatelliteSurfaceOverlay(currentViewer, satId)) {
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
    const intrinsicTimeRange = intrinsicTimeRangeFromCandidates([{
        startTimeMs: first.timeMs,
        endTimeMs: parsed.points[parsed.points.length - 1].timeMs
    }]);
    if (!intrinsicTimeRange) {
        throw new Error("OEM inválido: el intervalo temporal de las muestras no es válido.");
    }
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
        sourceOrigin: "CUSTOM",
        inputMetadata: {
            start_time: intrinsicTimeRange.startTime,
            end_time: intrinsicTimeRange.endTime,
            intrinsicTimeRange
        }
    }, id));

    activeLayerSatelliteIds.add(id);
    oemEphemerisTrackById.set(id, {
        intrinsicTimeRange,
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

const MANUAL_ORBIT_FORCE_TERM_ORDER = Object.freeze([
    "central",
    "j2",
    "j3",
    "j4",
    "drag",
    "geopotential",
    "third-body-sun",
    "third-body-moon",
    "solar-radiation-pressure",
    "relativity"
]);

const LEGACY_MANUAL_ORBIT_FORCE_TERMS = new Set(["central", "j2", "j3", "j4", "drag"]);

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
    atmospheric: "drag",
    geopotential: "geopotential",
    "gravity-field": "geopotential",
    "full-geopotential": "geopotential",
    fullgeopotential: "geopotential",
    "third-body-sun": "third-body-sun",
    sun: "third-body-sun",
    "solar-gravity": "third-body-sun",
    "third-body-moon": "third-body-moon",
    moon: "third-body-moon",
    "lunar-gravity": "third-body-moon",
    "solar-radiation-pressure": "solar-radiation-pressure",
    srp: "solar-radiation-pressure",
    "solar-pressure": "solar-radiation-pressure",
    solarradiationpressure: "solar-radiation-pressure",
    relativity: "relativity",
    schwarzschild: "relativity"
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
    const mutuallyExclusiveKnown = known.includes("geopotential")
        ? known.filter((term) => !["j2", "j3", "j4"].includes(term))
        : known;
    const future = [...seen].filter((term) => !MANUAL_ORBIT_FORCE_TERM_ORDER.includes(term));
    return [...mutuallyExclusiveKnown, ...future];
}

function manualOrbitLegacyModelFromForceTerms(forceTerms) {
    const terms = normalizeManualOrbitForceTerms(forceTerms).filter((term) => term !== "drag");
    if (terms.some((term) => !LEGACY_MANUAL_ORBIT_FORCE_TERMS.has(term))) {
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

function normalizeManualOrbitPreviewReferenceFrame(value, fallback = MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_EME2000) {
    const normalize = (candidate) => {
        const normalized = String(candidate || "").trim().toLowerCase();
        if (["itrf", "ecef", "earth-fixed", "earth_fixed"].includes(normalized)) {
            return MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ITRF;
        }
        if (["eme2000", "eci", "inertial"].includes(normalized)) {
            return MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_EME2000;
        }
        return null;
    };
    return normalize(value) || normalize(fallback) || MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_EME2000;
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
 * Build one osculating ellipse in the input EME2000 frame and align it to Cesium's
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

    // Cesium's globe uses an Earth-fixed scene. Rotate every native EME2000 sample
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
    geopotentialDegree: 4,
    geopotentialOrder: 0,
    solarRadiationCoefficient: 1.2,
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

/**
 * Copy only the content-addressed ERP provenance returned by the server.
 * This object is deliberately project-safe: `contentBase64`/raw upload bytes
 * never pass through a manual track, catalogue metadata or project export.
 */
function readManualOrbitErpReference(payload, ephemeris) {
    const source = {
        ...manualOrbitNestedRecord(ephemeris, "manualErp", "manual_erp"),
        ...manualOrbitNestedRecord(payload, "manualErp", "manual_erp")
    };
    const snapshot = manualOrbitValue(source, ["snapshotId", "snapshot_id", "id"]);
    const snapshotId = snapshot.found ? String(snapshot.value || "").trim() : "";
    if (!snapshotId) return null;
    const text = (keys) => {
        const value = manualOrbitValue(source, keys);
        return value.found ? String(value.value || "").trim() || null : null;
    };
    const nonNegativeInteger = (keys) => {
        const value = manualOrbitValue(source, keys);
        const numeric = Number(value.value);
        return value.found && Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
    };
    return {
        snapshotId,
        filename: text(["filename", "fileName", "file_name", "name"]),
        sha256: text(["sha256", "sourceSha256", "source_sha256"]),
        sourceSha256: text(["sourceSha256", "source_sha256"]),
        byteSize: nonNegativeInteger(["byteSize", "byte_size", "size"]),
        recordCount: nonNegativeInteger(["recordCount", "record_count", "sampleCount", "sample_count"]),
        coverageStart: text(["coverageStart", "coverage_start"]),
        coverageEnd: text(["coverageEnd", "coverage_end"]),
        source: text(["source", "provider"]),
        version: text(["version"]),
        quality: text(["quality", "productClass", "product_class"])
    };
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
    const geopotentialDegree = Math.min(MAX_MANUAL_COWELL_GEOPOTENTIAL_DEGREE, Math.floor(manualOrbitNumber(
        source,
        ["geopotentialDegree", "geopotential_degree"],
        DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.geopotentialDegree
    )));
    const geopotentialOrder = Math.min(geopotentialDegree, Math.floor(manualOrbitNumber(
        source,
        ["geopotentialOrder", "geopotential_order"],
        DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.geopotentialOrder
    )));
    if (forceTerms.includes("geopotential") && geopotentialDegree < 2) {
        throw new Error(
            "Geopotential degree must be at least 2. J1 is not a selectable centre-of-mass gravity term."
        );
    }
    return {
        atmosphericDrag: forceTerms.includes("drag"),
        dragCoefficient: manualOrbitNumber(source, ["dragCoefficient", "drag_coefficient"], DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.dragCoefficient),
        areaM2: manualOrbitNumber(source, ["areaM2", "area_m2"], DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.areaM2, { strictlyPositive: true }),
        massKg: manualOrbitNumber(source, ["massKg", "mass_kg"], DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.massKg, { strictlyPositive: true }),
        geopotentialDegree,
        geopotentialOrder,
        solarRadiationCoefficient: Math.min(5, manualOrbitNumber(
            source,
            ["solarRadiationCoefficient", "solar_radiation_coefficient", "reflectivityCoefficient", "reflectivity_coefficient", "cr"],
            DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.solarRadiationCoefficient,
            { strictlyPositive: true }
        )),
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
        // Persist the selected scene representation with the manual orbit.
        // It is presentation provenance only; the physical definition remains
        // EME2000 and is stored separately below.
        previewReferenceFrame: normalizeManualOrbitPreviewReferenceFrame(
            payload?.previewReferenceFrame ?? payload?.preview_reference_frame
        ),
        manualErp: readManualOrbitErpReference(payload, ephemeris),
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
        showGroundTrack: preview.showGroundTrack,
        hasSurfaceEphemeris: preview.surfacePoints.length >= 2
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
        for (const entity of [
            preview.pathEntity,
            preview.epochMarkerEntity,
            preview.groundTrackEntity,
            preview.footprintEntity,
            ...(preview.vectorEntities || [])
        ]) {
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
    preview.footprintEntity = null;
    preview.vectorEntities = [];
    preview.viewer = null;
}

function manualPreviewPosition(preview) {
    const point = preview?.epochPoint
        || findNearestManualOrbitPoint(preview?.points || [], preview?.epochTimeMs)
        || preview?.points?.[0];
    return point && Number.isFinite(point.x) ? new Cesium.Cartesian3(point.x, point.y, point.z) : null;
}

function manualPreviewSurfacePosition(preview) {
    const point = preview?.surfaceEpochPoint
        || findNearestManualOrbitPoint(preview?.surfacePoints || [], preview?.epochTimeMs)
        || preview?.surfacePoints?.[0]
        || preview?.epochPoint
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
        manualOrbitPreviewState.footprintEntity,
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

    const in2D = isViewerIn2D(viewer);
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
            },
            show: !in2D
        });
    } else {
        preview.pathEntity.polyline.positions = positions;
        preview.pathEntity.polyline.width = lineWidth;
        preview.pathEntity.polyline.material = createOrbitMaterial(previewColor);
        preview.pathEntity.show = !in2D;
    }

    const epochPosition = in2D
        ? manualPreviewSurfacePosition(preview)
        : manualPreviewPosition(preview);
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

    // A 2D viewer always replaces the spatial line with the real ground
    // projection. In 3D the same trace remains an optional design overlay.
    const showProjectedOrbit = in2D || preview.showGroundTrack;
    if (showProjectedOrbit) {
        const surfacePoints = preview.surfacePoints.length >= 2
            ? preview.surfacePoints
            : preview.points;
        const groundTrackPositions = toSurfaceGroundTrack(surfacePoints);
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

    // Ground Track controls the geometric horizon circle in map view. The
    // circle is deliberately based on ITRF samples even when the editor is
    // inspecting the orbit itself in an inertial frame.
    updateVisibilityFootprint(viewer, preview, {
        ownerId: MANUAL_ORBIT_PREVIEW_ID,
        center: manualPreviewSurfacePosition(preview),
        color: previewColor,
        visible: in2D && preview.showGroundTrack
    });

    renderManualOrbitPreviewVectors(preview, viewer);
    for (const entity of preview.vectorEntities || []) {
        entity.show = !in2D;
    }

    return manualOrbitPreviewSnapshot();
}

/**
 * Render (or replace) the transient design preview returned by
 * `POST /api/manual-orbits`. In `eme2000` mode it prefers native EME2000 samples for
 * manual Two-body and gravity-model engines, otherwise it renders one epoch-anchored inertial
 * ellipse; in `itrf` mode it renders the returned ITRF ephemeris.
 * It never creates a layer, a satellite state, or a telemetry source. Its
 * optional ground track is a dedicated transient entity projected from that
 * same selected geometry. If Cesium is not
 * ready yet, the valid preview is queued and will be rendered by
 * `initSatelliteReceiver` later.
 *
 * @param {object} payload manual-orbit response or its `ephemeris` payload
 * @param {object} options `{ color?: string, viewer?: Viewer, showGroundTrack?: boolean, previewReferenceFrame?: "eme2000" | "itrf" }`
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
    const inertialNativePreview = previewReferenceFrame === MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_EME2000
        && (["two-body", "j2", "j2-j3-j4", "cowell-rk4"].includes(propagator) || nativeEciSamplesAvailable)
        ? buildEpochAnchoredEciEphemerisPreview(
            getManualOrbitEciEphemerisPoints(payload),
            preliminaryEpochTimeMs
        )
        : null;
    const inertialPreview = previewReferenceFrame === MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_EME2000
        ? inertialNativePreview || buildEpochAnchoredInertialPreview(payload, preliminaryEpochTimeMs)
        : null;
    // ITRF is deliberately the literal propagated Earth-fixed ephemeris. EME2000 uses a
    // canonical ellipse for legacy synthetic-TLE data, but native Two-body/J2/J3/J4/Cowell samples are preferred
    // whenever the API supplies them. This keeps a vector-authored Two-body
    // state exact and makes higher-order secular precession visible. The geometric
    // ellipse remains the backwards-compatible fallback for older responses.
    const points = previewReferenceFrame === MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_ITRF
        ? ephemerisPoints
        : inertialPreview?.points || ephemerisPoints;
    if (points.length < 2) {
        throw new Error("La previsualizacion de orbita manual requiere al menos dos muestras de efemerides.");
    }

    const epochTimeMs = preliminaryEpochTimeMs ?? resolveManualOrbitEpochTimeMs(payload, ephemeris, points);
    const { startTimeMs, endTimeMs } = resolveManualOrbitRange(payload, ephemeris, ephemerisPoints.length ? ephemerisPoints : points);
    const requestedColor = String(options?.color || MANUAL_ORBIT_PREVIEW_COLOR).trim();
    manualOrbitPreviewState.points = points;
    // Keep the physical Earth-fixed samples even when the visual preview is
    // an epoch-anchored EME2000 ellipse. They are the authoritative source for
    // the 2D reprojection and for its horizon footprint.
    manualOrbitPreviewState.surfacePoints = ephemerisPoints.length >= 2
        ? ephemerisPoints
        : points;
    manualOrbitPreviewState.epochPoint = inertialPreview?.epochPoint || null;
    manualOrbitPreviewState.surfaceEpochPoint = findNearestManualOrbitPoint(
        manualOrbitPreviewState.surfacePoints,
        epochTimeMs
    ) || null;
    manualOrbitPreviewState.epochTimeMs = epochTimeMs;
    manualOrbitPreviewState.startTimeMs = startTimeMs;
    manualOrbitPreviewState.endTimeMs = endTimeMs;
    manualOrbitPreviewState.name = String(payload?.name || ephemeris?.satellite || "Manual Orbit preview").trim() || "Manual Orbit preview";
    manualOrbitPreviewState.visible = options?.visible !== false;
    manualOrbitPreviewState.previewReferenceFrame = previewReferenceFrame;
    // In 3D this remains an opt-in design aid. In 2D the orbit itself is
    // always shown as the ITRF ground projection; this toggle then controls
    // the geometric visibility footprint.
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
 * orbit. It follows the orbit line's currently selected EME2000/ITRF preview
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
        footprintEntity: null,
        points: [],
        surfacePoints: [],
        epochPoint: null,
        surfaceEpochPoint: null,
        epochTimeMs: null,
        startTimeMs: null,
        endTimeMs: null,
        name: "",
        visible: false,
        showGroundTrack: false,
        color: MANUAL_ORBIT_PREVIEW_COLOR,
        previewReferenceFrame: MANUAL_ORBIT_PREVIEW_REFERENCE_FRAME_EME2000,
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
    const orbit = points.map(({ x, y, z }) => ({ x, y, z }));
    const spanHours = Math.max(1 / 3600, (points[points.length - 1].timeMs - points[0].timeMs) / 3600000);
    const intrinsicTimeRange = intrinsicTimeRangeFromCandidates([{
        startTimeMs: points[0].timeMs,
        endTimeMs: points[points.length - 1].timeMs
    }]);
    if (!intrinsicTimeRange) {
        throw new Error("La órbita manual no tiene un intervalo temporal válido.");
    }
    const state = ensureSatelliteState(currentViewer, id, initialPosition, initialOrientation);

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
        intrinsicTimeRange,
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
        previewReferenceFrame: normalizeManualOrbitPreviewReferenceFrame(
            metadata.previewReferenceFrame ?? metadata.preview_reference_frame
        ),
        manualErp: cloneManualOrbitValue(metadata.manualErp || metadata.manual_erp || null),
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

/** True when the workspace contains at least one generated finite manual track. */
export function hasLoadedManualOrbitTracks() {
    return manualOrbitTrackById.size > 0;
}

function loadedTrackTimeRanges(tracks, source) {
    return [...tracks.entries()]
        .map(([id, track]) => {
            const range = trackIntrinsicTimeRange(track);
            if (!range) return null;
            return {
                id,
                source,
                startTimeMs: range.startTimeMs,
                endTimeMs: range.endTimeMs,
                startTime: range.startTime,
                endTime: range.endTime
            };
        })
        .filter(Boolean);
}

/**
 * Return each generated manual-orbit domain independently. Do not reduce
 * these to aggregate bounds for a conjunction/comparison calculation: gaps
 * between independent propagated arcs are not valid data.
 */
export function getLoadedManualOrbitTimeRanges() {
    return loadedTrackTimeRanges(manualOrbitTrackById, "MANUAL")
        .sort((left, right) => (
            left.startTimeMs - right.startTimeMs
            || left.endTimeMs - right.endTimeMs
            || String(left.id).localeCompare(String(right.id))
        ));
}

export function getLoadedManualOrbitTimeBounds() {
    const ranges = getLoadedManualOrbitTimeRanges();
    if (!ranges.length) return null;
    return {
        startTimeMs: Math.min(...ranges.map((range) => range.startTimeMs)),
        endTimeMs: Math.max(...ranges.map((range) => range.endTimeMs))
    };
}

/**
 * Return every active SP3 layer's individual validated coverage. Registered
 * but inactive products do not constrain the MTR until the operator adds
 * them to the scene.
 */
export function getLoadedPreciseProductTimeRanges({ activeOnly = true } = {}) {
    return [...preciseProductEntryBySatelliteId.keys()]
        .filter((id) => !activeOnly || activeLayerSatelliteIds.has(id))
        .map((id) => {
            const range = preciseProductIntrinsicTimeRange(id);
            if (!range) return null;
            return {
                id,
                source: "SP3",
                startTimeMs: range.startTimeMs,
                endTimeMs: range.endTimeMs,
                startTime: range.startTime,
                endTime: range.endTime
            };
        })
        .filter(Boolean)
        .sort((left, right) => (
            left.startTimeMs - right.startTimeMs
            || left.endTimeMs - right.endTimeMs
            || String(left.id).localeCompare(String(right.id))
        ));
}

/** Whether at least one active SP3 layer contributes a finite domain. */
export function hasLoadedPreciseProductTracks() {
    return getLoadedPreciseProductTimeRanges().length > 0;
}

/**
 * Aggregate all finite source ranges as individual records. This is the API
 * MTR consumers should use; callers that need one scene bound may take the
 * minimum/maximum deliberately, while joint analyses must retain the list.
 */
export function getLoadedFiniteEphemerisTimeRanges() {
    return [
        ...getLoadedOemEphemerisTimeRanges().map((range) => ({ ...range, source: "OEM" })),
        ...getLoadedManualOrbitTimeRanges(),
        ...getLoadedPreciseProductTimeRanges()
    ].sort((left, right) => (
        left.startTimeMs - right.startTimeMs
        || left.endTimeMs - right.endTimeMs
        || String(left.source).localeCompare(String(right.source))
        || String(left.id).localeCompare(String(right.id))
    ));
}

export function hasLoadedFiniteEphemerisTracks() {
    return getLoadedFiniteEphemerisTimeRanges().length > 0;
}

/**
 * Return each valid OEM coverage independently.
 *
 * The aggregate bounds remain useful for the global timeline, but are unsafe
 * for a joint-operation decision: two disjoint OEMs would otherwise make the
 * gap between them look like published ephemeris coverage.  TIME consumes
 * this per-track form so it can require an actual common UTC interval.
 */
export function getLoadedOemEphemerisTimeRanges() {
    return [...oemEphemerisTrackById.entries()]
        .map(([id, item]) => {
            const range = trackIntrinsicTimeRange(item);
            if (!range) return null;
            return {
                id,
                startTimeMs: range.startTimeMs,
                endTimeMs: range.endTimeMs,
                startTime: range.startTime,
                endTime: range.endTime
            };
        })
        .filter(Boolean)
        .sort((left, right) => (
            left.startTimeMs - right.startTimeMs
            || left.endTimeMs - right.endTimeMs
            || String(left.id).localeCompare(String(right.id))
        ));
}

export function getLoadedOemEphemerisTimeBounds() {
    const ranges = getLoadedOemEphemerisTimeRanges();
    if (!ranges.length) {
        return null;
    }

    return {
        startTimeMs: Math.min(...ranges.map((range) => range.startTimeMs)),
        endTimeMs: Math.max(...ranges.map((range) => range.endTimeMs))
    };
}

export function setSimulationTimelineProvider(provider) {
    simulationTimelineProvider = typeof provider === "function" ? provider : null;
}
