/**
 * Planner React boundary.
 *
 * The canonical event vocabulary, validation and UTC normalizer live in the
 * renderer-independent plannerEvents module.  This file intentionally only
 * adds React-specific concerns: colour swatches, datetime-local UTC input and
 * the late-mount state request.  It must not create a second event schema.
 *
 * The runtime publishes `orbit:planner-state` snapshots, keeps the latest one
 * at `window.__orbitPlannerState`, and answers `orbit:planner-state-request`.
 * `orbit:planner-events` is a read-only compatibility alias for an otherwise
 * canonical state payload.  Manual mutations are sent to the two canonical
 * events re-exported below; the runtime validates/persists them before it
 * publishes a replacement state snapshot.
 */

import {
    PLANNER_COLOR_TOKENS,
    PLANNER_EVENT_KINDS,
    PLANNER_MANUAL_EVENT_REMOVE_EVENT,
    PLANNER_MANUAL_EVENT_UPSERT_EVENT,
    PLANNER_STATE_EVENT,
    layoutPlannerEventLanes,
    normalizeManualPlannerEvent,
    normalizePlannerState,
    plannerIsoTimestamp
} from "../../../../front/js/features/planner/plannerEvents.js";
import {
    MANUAL_PLANNER_ICS_MIME_TYPE,
    createManualPlannerSyncAdapter,
    getManualPlannerSyncCapabilities,
    parseManualPlannerEventsIcs,
    serializeManualPlannerEventsToIcs
} from "../../../../front/js/features/planner/manualPlannerIcs.js";

export {
    PLANNER_COLOR_TOKENS,
    PLANNER_EVENT_KINDS,
    layoutPlannerEventLanes,
    normalizePlannerState,
    MANUAL_PLANNER_ICS_MIME_TYPE,
    createManualPlannerSyncAdapter,
    getManualPlannerSyncCapabilities,
    parseManualPlannerEventsIcs,
    serializeManualPlannerEventsToIcs
};

export const ORBIT_PLANNER_STATE_EVENT = PLANNER_STATE_EVENT;
export const ORBIT_PLANNER_EVENTS_COMPAT_EVENT = "orbit:planner-events";
export const ORBIT_PLANNER_OPEN_EVENT = "orbit:planner-open";
export const ORBIT_PLANNER_CLOSE_EVENT = "orbit:planner-close";
export const ORBIT_PLANNER_STATE_REQUEST_EVENT = "orbit:planner-state-request";
export const ORBIT_PLANNER_MANUAL_EVENT_UPSERT_EVENT = PLANNER_MANUAL_EVENT_UPSERT_EVENT;
export const ORBIT_PLANNER_MANUAL_EVENT_REMOVE_EVENT = PLANNER_MANUAL_EVENT_REMOVE_EVENT;
export const ORBIT_PLANNER_EVENT_ACTIVATE_EVENT = "orbit:planner-event-activate";
// The runtime may use this finite, UTC-only viewport to choose an appropriate
// forecast horizon.  It deliberately carries no browser-local Date values.
export const ORBIT_PLANNER_VIEW_RANGE_EVENT = "orbit:planner-view-range";
// This is a planner presentation preference only.  It must never be confused
// with the scene-layer eye, which is managed independently by the runtime.
export const ORBIT_PLANNER_LAYER_FILTER_EVENT = "orbit:planner-layer-filter";

/** CSS is the only layer that turns semantic colour tokens into pixels. */
export const PLANNER_EVENT_COLORS = Object.freeze({
    [PLANNER_COLOR_TOKENS.BLUE]: "#6e9cff",
    [PLANNER_COLOR_TOKENS.CYAN]: "#66d6ee",
    [PLANNER_COLOR_TOKENS.EMERALD]: "#67ed9d",
    [PLANNER_COLOR_TOKENS.PURPLE]: "#be8cff",
    [PLANNER_COLOR_TOKENS.AMBER]: "#f1ba58",
    [PLANNER_COLOR_TOKENS.ROSE]: "#ff7888",
    [PLANNER_COLOR_TOKENS.SLATE]: "#aab8cc"
});

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * Planner facts may originate in a local product import, an operational
 * resource, or an operator-authored entry. Keep the presentation tolerant of
 * the supported detail keys while keeping the canonical event schema
 * unchanged: descriptive text always lives in metadata.
 */
export function plannerEventDescription(event) {
    const source = record(event);
    const metadata = record(source.metadata);
    for (const candidate of [metadata.description, metadata.details, metadata.detail]) {
        const description = text(candidate);
        if (description) return description;
    }
    return "";
}

/**
 * EOP source coverage is an interval rather than a series of independent
 * deadlines.  The runtime explicitly marks these facts so the presentation
 * can draw one continuous coverage rail instead of repeating a full event
 * chip for every UTC day that the interval intersects.  Old planner snapshots
 * without the marker deliberately remain ordinary point events.
 */
export function isPlannerEopRangeEvent(event) {
    const source = record(event);
    const metadata = record(source.metadata);
    if (metadata.eopRange !== true || text(metadata.resourceType).toLowerCase() !== "erp") return false;
    const start = plannerIsoTimestamp(source.start);
    const end = plannerIsoTimestamp(source.end);
    return Boolean(start && end && Date.parse(end) > Date.parse(start));
}

function utcDay(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(day, amount) {
    const result = utcDay(day);
    if (!result || !Number.isFinite(amount)) return null;
    result.setUTCDate(result.getUTCDate() + amount);
    return result;
}

function startOfUtcWeek(day) {
    const value = utcDay(day);
    if (!value) return null;
    return addUtcDays(value, -((value.getUTCDay() + 6) % 7));
}

function startOfUtcMonth(day) {
    const value = utcDay(day);
    return value ? new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)) : null;
}

function isoRange(start, end) {
    if (!(start instanceof Date) || !(end instanceof Date)
        || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        return null;
    }
    return { startTime: start.toISOString(), endTime: end.toISOString() };
}

/**
 * Return the exact half-open UTC range currently represented by a planner
 * view.  The event sent to the runtime is intentionally a plain serialisable
 * payload: `[startTime, endTime)` avoids local timezone/DST ambiguity.
 */
export function plannerViewRangePayload(view, cursor) {
    const normalizedView = text(view).toLowerCase();
    const day = utcDay(cursor);
    if (!day || !["day", "week", "month"].includes(normalizedView)) return null;
    if (normalizedView === "day") {
        const range = isoRange(day, addUtcDays(day, 1));
        return range ? { view: normalizedView, ...range } : null;
    }
    if (normalizedView === "week") {
        const start = startOfUtcWeek(day);
        const range = isoRange(start, addUtcDays(start, 7));
        return range ? { view: normalizedView, ...range } : null;
    }
    const start = startOfUtcMonth(day);
    const end = start ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)) : null;
    const range = isoRange(start, end);
    return range ? { view: normalizedView, ...range } : null;
}

/** Native month inputs use `YYYY-MM`; keep that representation explicitly UTC. */
export function formatUtcMonth(value) {
    const date = utcDay(value);
    if (!date) return "";
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Parse a month picker value without letting `new Date("YYYY-MM")` select a
 * browser-dependent timezone.  The current UTC day is kept where possible.
 */
export function cursorForUtcMonth(value, previousCursor = new Date()) {
    const match = /^(\d{4})-(\d{2})$/.exec(text(value));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    if (month < 0 || month > 11) return null;
    const previous = utcDay(previousCursor) || new Date(Date.UTC(year, month, 1));
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(previous.getUTCDate(), lastDay)));
}

function normalizePlannerLayer(layer) {
    const source = record(layer);
    const id = text(source.id);
    if (!id) return null;
    return {
        id,
        name: text(source.name) || id,
        type: text(source.type) || "UNKNOWN",
        sourceId: text(source.sourceId),
        active: source.active === true,
        visible: source.visible === true,
        sourceFormat: text(source.sourceFormat),
        sourceOrigin: text(source.sourceOrigin)
    };
}

/**
 * Preserve only the read-only scene facts that the React presentation needs;
 * canonical event validation remains owned by `normalizePlannerState`.
 */
export function normalizePlannerUiState(detail = {}) {
    const source = record(detail);
    const base = normalizePlannerState(source);
    const layers = (Array.isArray(source.layers) ? source.layers : [])
        .map(normalizePlannerLayer)
        .filter(Boolean);
    const knownLayerIds = new Set(layers.map((layer) => layer.id));
    const plannerHiddenLayerIds = [...new Set((Array.isArray(source.plannerHiddenLayerIds)
        ? source.plannerHiddenLayerIds
        : []).map(text).filter((id) => knownLayerIds.has(id)))];
    const context = record(source.context);
    const passes = record(context.passes);
    return {
        ...base,
        layers,
        plannerHiddenLayerIds,
        context,
        message: text(source.message || source.statusMessage || context.message || passes.message || passes.reason)
    };
}

function plannerEpoch(value) {
    const iso = plannerIsoTimestamp(value);
    return iso ? Date.parse(iso) : null;
}

/**
 * Determine whether the read-only planner may ask the runtime to move the
 * scene to an event.  The runtime remains authoritative; this mirror only
 * prevents a button that appears to work but is guaranteed to be rejected by
 * the active Simulated/MTR domain.
 *
 * Finite range facts (notably IERS ERP coverage) use their first usable
 * instant inside the active domain.  A range that overlaps the simulation is
 * therefore actionable even if its published start precedes the SP3 window.
 */
export function plannerEventActivation(event, context = {}) {
    const source = record(event);
    const simulation = record(record(context).simulation);
    const targetMs = plannerEpoch(source.time ?? source.start ?? source.startTime);
    if (targetMs === null) {
        return {
            enabled: false,
            targetTime: "",
            reason: "El evento no tiene una hora UTC válida para mover la escena."
        };
    }

    const mode = text(simulation.mode).toLowerCase();
    if (mode !== "range" && mode !== "simulated") {
        return {
            enabled: false,
            targetTime: "",
            reason: "Cambia a Simulated para mover la escena a un evento."
        };
    }

    const simulationStart = plannerEpoch(simulation.startTime ?? simulation.startDate);
    const simulationEnd = plannerEpoch(simulation.endTime ?? simulation.endDate);
    if (simulationStart === null || simulationEnd === null || simulationEnd < simulationStart) {
        return {
            enabled: false,
            targetTime: "",
            reason: "El intervalo UTC de simulación activo no es válido."
        };
    }

    let domainStart = simulationStart;
    let domainEnd = simulationEnd;
    const masterRange = record(simulation.masterTimeRange);
    const masterStart = plannerEpoch(masterRange.startTime ?? masterRange.startDate);
    const masterEnd = plannerEpoch(masterRange.endTime ?? masterRange.endDate);
    if (masterStart !== null && masterEnd !== null && masterEnd >= masterStart) {
        domainStart = Math.max(domainStart, masterStart);
        domainEnd = Math.min(domainEnd, masterEnd);
    }
    if (domainEnd < domainStart) {
        return {
            enabled: false,
            targetTime: "",
            reason: "El intervalo Simulated no se solapa con el Rango Temporal Maestro."
        };
    }

    const eventEnd = plannerEpoch(source.end ?? source.endTime);
    const isFiniteInterval = eventEnd !== null && eventEnd > targetMs;
    const candidate = isFiniteInterval ? Math.max(targetMs, domainStart) : targetMs;
    const intervalEnd = isFiniteInterval ? eventEnd : targetMs;
    if (candidate > domainEnd || intervalEnd < domainStart) {
        return {
            enabled: false,
            targetTime: "",
            reason: "Este evento queda fuera del intervalo de simulación activo y no puede mover la escena."
        };
    }

    return {
        enabled: true,
        targetTime: new Date(candidate).toISOString(),
        reason: ""
    };
}

function eventLayerReferences(event, layers) {
    if (event?.kind === PLANNER_EVENT_KINDS.MANUAL) return { direct: [], sourceGroups: [] };
    const metadata = record(event?.metadata);
    const direct = [
        metadata.layerId,
        metadata.stationId,
        metadata.satelliteLayerId,
        metadata.satelliteId
    ].map(text).filter(Boolean);
    const sourceReferences = new Set([
        metadata.sourceId,
        metadata.sourceSatelliteId,
        metadata.resourceId
    ].map(text).filter(Boolean));
    const sourceGroups = [...sourceReferences].map((sourceId) => layers
        .filter((layer) => layer.id === sourceId || layer.sourceId === sourceId)
        .map((layer) => layer.id));
    return { direct: [...new Set(direct)], sourceGroups };
}

/**
 * Apply the planner-only layer preference immediately in React too, so a
 * checkbox never leaves a stale pass/detail visible while the runtime is
 * publishing its next authoritative snapshot. Manual events remain project
 * planning records and intentionally do not belong to a scene layer.
 */
export function filterPlannerEventsByLayerVisibility(events, layers, plannerHiddenLayerIds) {
    const hidden = new Set((Array.isArray(plannerHiddenLayerIds) ? plannerHiddenLayerIds : []).map(text).filter(Boolean));
    if (!hidden.size) return Array.isArray(events) ? events : [];
    return (Array.isArray(events) ? events : []).filter((event) => {
        const references = eventLayerReferences(event, Array.isArray(layers) ? layers : []);
        if (references.direct.some((layerId) => hidden.has(layerId))) return false;
        // A product can have several visual duplicates. Keep its resource
        // notice while at least one corresponding layer is enabled, matching
        // the runtime's authoritative planner-only filter.
        return !references.sourceGroups.some((group) => group.length && group.every((layerId) => hidden.has(layerId)));
    });
}

export function formatUtcInput(value) {
    const iso = plannerIsoTimestamp(value);
    if (!iso) return "";
    const date = new Date(iso);
    const pad = (part) => String(part).padStart(2, "0");
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** datetime-local has no timezone.  Orbit labels this field UTC, so append Z. */
export function parseUtcInput(value) {
    const candidate = text(value);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(candidate)) return null;
    return plannerIsoTimestamp(`${candidate}:00.000Z`);
}

/**
 * Manual events are intervals by contract.  Fail closed before dispatching a
 * mutation, then let the canonical normalizer validate the complete payload.
 */
export function makeManualEventPayload(fields = {}, id) {
    const title = text(fields.title);
    const start = parseUtcInput(fields.start);
    const end = parseUtcInput(fields.end);
    // Keep an optional operator note in the same metadata field used by
    // generated file/resource notices. The UI also caps its textarea at this
    // size; the payload cap protects programmatic callers too.
    const description = text(fields.description).slice(0, 2_000);
    if (!title) return { ok: false, error: "Indica un título para el evento." };
    if (!start || !end) return { ok: false, error: "Indica una fecha y hora UTC válida para el inicio y el fin." };
    if (Date.parse(end) <= Date.parse(start)) return { ok: false, error: "El fin debe ser posterior al inicio." };
    const event = normalizeManualPlannerEvent({
        id: text(id) || `manual-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
        title,
        start,
        end,
        colorToken: text(fields.color) || PLANNER_COLOR_TOKENS.BLUE,
        metadata: description ? { description } : {}
    });
    return event ? { ok: true, event } : { ok: false, error: "El evento manual no cumple el formato permitido." };
}
