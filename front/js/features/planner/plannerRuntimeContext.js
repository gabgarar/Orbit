import { toPlannerEpochMs } from "./plannerEvents.js";

const PLANNER_VIEWS = new Set(["day", "week", "month"]);

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function rangeValue(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const startMs = toPlannerEpochMs(value.startTime ?? value.start ?? value.startDate);
    const endMs = toPlannerEpochMs(value.endTime ?? value.end ?? value.endDate);
    if (startMs === null || endMs === null || endMs <= startMs) return null;
    return {
        startDate: new Date(startMs),
        endDate: new Date(endMs),
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString()
    };
}

/**
 * Normalize the finite UTC interval owned by the planner view.  It is
 * intentionally separate from the simulation playhead: opening or paging a
 * calendar must never move the scene clock.
 */
export function normalizePlannerViewRange(value) {
    const range = rangeValue(value);
    if (!range) return null;
    const view = text(value?.view).toLowerCase();
    return {
        ...range,
        view: PLANNER_VIEWS.has(view) ? view : "week",
        source: "planner-view-range"
    };
}

/** Stable identity for cache/in-flight work; Dates never leak into it. */
export function plannerViewRangeKey(value) {
    const range = normalizePlannerViewRange(value);
    return range ? `${range.view}:${range.startTime}:${range.endTime}` : "";
}

/**
 * The fallback is one UTC week anchored to the displayed frame. React sends
 * its exact Day/Week/Month interval immediately afterwards, but this makes a
 * late-mounted/non-React planner useful without guessing a rolling horizon.
 */
export function defaultPlannerViewRange(anchor = new Date()) {
    const date = anchor instanceof Date ? anchor : new Date(anchor);
    if (Number.isNaN(date.getTime())) return null;
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const end = new Date(start.getTime() + (7 * 24 * 60 * 60 * 1000));
    return normalizePlannerViewRange({ startTime: start.toISOString(), endTime: end.toISOString(), view: "week" });
}

/**
 * Project-owned filtering is deliberately a compact list of layer ids. It
 * never changes a scene-layer eye and unknown ids survive restoration so a
 * deferred SP3/OEM/manual layer can reappear with its chosen planner filter.
 */
export function normalizePlannerHiddenLayerIds(value) {
    const values = Array.isArray(value) ? value : [];
    const seen = new Set();
    return values.reduce((items, candidate) => {
        if (typeof candidate !== "string") return items;
        const id = text(candidate);
        if (!id || id.length > 1024 || seen.has(id)) return items;
        seen.add(id);
        items.push(id);
        return items;
    }, []);
}

function containsRange(container, candidate) {
    const boundary = rangeValue(container);
    if (!boundary || !candidate) return false;
    return candidate.startDate >= boundary.startDate && candidate.endDate <= boundary.endDate;
}

function intersectRanges(left, right) {
    const first = rangeValue(left);
    const second = rangeValue(right);
    if (!first || !second) return null;
    const startMs = Math.max(first.startDate.getTime(), second.startDate.getTime());
    const endMs = Math.min(first.endDate.getTime(), second.endDate.getTime());
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    return {
        startDate: new Date(startMs),
        endDate: new Date(endMs),
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString()
    };
}

function plannerRangeDomain({ mode, simulationRange, masterRange } = {}) {
    if (text(mode).toLowerCase() !== "range") return null;
    const simulation = rangeValue(simulationRange);
    if (!simulation) return null;
    if (!masterRange) return simulation;
    return intersectRanges(simulation, masterRange);
}

/**
 * Return the portion of a finite planner viewport that is safe to forecast in
 * Simulated mode.  The visible calendar may be a whole month while an SP3's
 * MTR is only a day; pass work must use the exact intersection instead of
 * rejecting the entire agenda.  When there is no overlap, no range is
 * returned: callers can rebase the calendar rather than silently calculate
 * an unrelated period.
 *
 * This helper only clips an already requested interval. It never extends a
 * source range or manufactures a start/end timestamp.
 */
export function clampPlannerViewRangeToSimulationDomain({ range, mode, simulationRange = null, masterRange = null } = {}) {
    const requested = normalizePlannerViewRange(range);
    if (!requested) {
        return { range: null, requestedRange: null, clamped: false, reason: "El planificador necesita un intervalo UTC finito y válido." };
    }
    if (text(mode).toLowerCase() !== "range") {
        return { range: requested, requestedRange: requested, clamped: false, reason: "" };
    }
    const domain = plannerRangeDomain({ mode, simulationRange, masterRange });
    if (!domain) {
        return {
            range: null,
            requestedRange: requested,
            clamped: false,
            reason: "No hay un rango simulado/MTR UTC válido para calcular pases."
        };
    }
    const clipped = intersectRanges(requested, domain);
    if (!clipped) {
        return {
            range: null,
            requestedRange: requested,
            domain,
            clamped: false,
            reason: "El período mostrado no intersecta el rango de simulación/MTR activo."
        };
    }
    const clamped = clipped.startTime !== requested.startTime || clipped.endTime !== requested.endTime;
    return {
        range: {
            ...requested,
            ...clipped,
            source: clamped ? "planner-view-range-clamped" : requested.source
        },
        requestedRange: requested,
        domain,
        clamped,
        reason: ""
    };
}

/**
 * Range mode is tied to a finite simulated/MTR domain. Static and realtime
 * have no moving planner horizon: the caller-provided visible UTC interval is
 * sufficient and is intentionally not coupled to animation ticks.
 */
export function assessPlannerForecastRange({ range, mode, simulationRange = null, masterRange = null } = {}) {
    const normalized = normalizePlannerViewRange(range);
    if (!normalized) {
        return { allowed: false, range: null, reason: "El planificador necesita un intervalo UTC finito y válido." };
    }
    if (text(mode).toLowerCase() !== "range") {
        return { allowed: true, range: normalized, reason: "" };
    }
    if (!containsRange(simulationRange, normalized)) {
        return {
            allowed: false,
            range: normalized,
            reason: "El intervalo mostrado debe quedar completamente dentro del rango de simulación activo."
        };
    }
    // A scene without a declared MTR still has the explicit simulated range.
    // Once it exists, however, it remains an additional hard boundary.
    if (masterRange && !containsRange(masterRange, normalized)) {
        return {
            allowed: false,
            range: normalized,
            reason: "El intervalo mostrado queda fuera del Rango Temporal Maestro (MTR)."
        };
    }
    return { allowed: true, range: normalized, reason: "" };
}
