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

export {
    PLANNER_COLOR_TOKENS,
    PLANNER_EVENT_KINDS,
    layoutPlannerEventLanes,
    normalizePlannerState
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
    if (!title) return { ok: false, error: "Indica un título para el evento." };
    if (!start || !end) return { ok: false, error: "Indica una fecha y hora UTC válida para el inicio y el fin." };
    if (Date.parse(end) <= Date.parse(start)) return { ok: false, error: "El fin debe ser posterior al inicio." };
    const event = normalizeManualPlannerEvent({
        id: text(id) || `manual-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
        title,
        start,
        end,
        colorToken: text(fields.color) || PLANNER_COLOR_TOKENS.BLUE
    });
    return event ? { ok: true, event } : { ok: false, error: "El evento manual no cumple el formato permitido." };
}
