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
