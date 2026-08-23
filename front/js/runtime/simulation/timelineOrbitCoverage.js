/**
 * Timeline orbital coverage
 * =========================
 *
 * Convert the independent temporal domains of the currently visible orbital
 * layers into compact, visual timeline segments.  This deliberately reports
 * the union of actual coverage only: an outer scene/MTR envelope may contain
 * a genuine gap between an SP3 and a later TLE, and that gap must remain
 * unpainted.
 *
 * The helper is DOM-free so the simulation runtime and React timeline can
 * share the same fail-closed contract.  A range may use the normal runtime
 * `startTimeMs` / `endTimeMs` fields or common UTC aliases.
 */

const START_KEYS = Object.freeze([
    "startTimeMs",
    "start_time_ms",
    "startDate",
    "start_date",
    "startTime",
    "start_time",
    "coverageStart",
    "coverage_start",
    "start"
]);

const END_KEYS = Object.freeze([
    "endTimeMs",
    "end_time_ms",
    "endDate",
    "end_date",
    "endTime",
    "end_time",
    "coverageEnd",
    "coverage_end",
    "end",
    "stopTime",
    "stop_time"
]);

function toEpochMilliseconds(value) {
    if (value instanceof Date) {
        const milliseconds = value.getTime();
        return Number.isFinite(milliseconds) ? milliseconds : null;
    }
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    if (/^[+-]?\d+(?:\.\d+)?$/.test(raw)) {
        const milliseconds = Number(raw);
        return Number.isFinite(milliseconds) ? milliseconds : null;
    }
    const milliseconds = Date.parse(raw);
    return Number.isFinite(milliseconds) ? milliseconds : null;
}

function firstDefinedValue(record, keys) {
    if (!record || typeof record !== "object") return undefined;
    for (const key of keys) {
        const value = record[key];
        if (value !== undefined && value !== null && value !== "") return value;
    }
    return undefined;
}

function normalizeCoverageRange(range) {
    // The caller normally sends active/visible ranges only, but retaining
    // this guard keeps a stale layer-visibility update from leaving a band
    // behind for a hidden satellite.
    if (range?.visible === false || range?.isVisible === false || range?.hidden === true) return null;
    const startTimeMs = toEpochMilliseconds(firstDefinedValue(range, START_KEYS));
    const endTimeMs = toEpochMilliseconds(firstDefinedValue(range, END_KEYS));
    // A point-in-time does not have enough visual width to paint a useful
    // orbital interval.  Omitting it also prevents a malformed product from
    // claiming coverage through a zero-width fallback marker.
    if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs) || endTimeMs <= startTimeMs) {
        return null;
    }
    return { startTimeMs, endTimeMs };
}

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Build visual orbital-coverage bands for a concrete simulation interval.
 *
 * @param {object} input
 * @param {Date|number|string} input.startDate inclusive timeline start
 * @param {Date|number|string} input.endDate inclusive timeline end
 * @param {Array<object>} input.ranges current orbital coverages. Entries with
 * `visible: false`, `isVisible: false`, or `hidden: true` are ignored.
 * @returns {Array<{startTimeMs:number,endTimeMs:number,startPercent:number,endPercent:number,widthPercent:number}>}
 */
export function buildTimelineOrbitCoverageSegments({ startDate, endDate, ranges = [] } = {}) {
    const timelineStartMs = toEpochMilliseconds(startDate);
    const timelineEndMs = toEpochMilliseconds(endDate);
    if (!Number.isFinite(timelineStartMs) || !Number.isFinite(timelineEndMs) || timelineEndMs <= timelineStartMs) {
        return [];
    }

    const clipped = (Array.isArray(ranges) ? ranges : [])
        .map(normalizeCoverageRange)
        .filter(Boolean)
        .map((range) => ({
            startTimeMs: Math.max(range.startTimeMs, timelineStartMs),
            endTimeMs: Math.min(range.endTimeMs, timelineEndMs)
        }))
        // A source that only touches a timeline edge has no visual interval.
        .filter((range) => range.endTimeMs > range.startTimeMs)
        .sort((left, right) => left.startTimeMs - right.startTimeMs || left.endTimeMs - right.endTimeMs);

    const merged = [];
    for (const range of clipped) {
        const previous = merged[merged.length - 1];
        // Equality is deliberately merged: two adjacent products paint one
        // uninterrupted domain.  Strictly separated products keep their gap.
        if (previous && range.startTimeMs <= previous.endTimeMs) {
            previous.endTimeMs = Math.max(previous.endTimeMs, range.endTimeMs);
        } else {
            merged.push({ ...range });
        }
    }

    const spanMs = timelineEndMs - timelineStartMs;
    return merged.map((range) => {
        const startPercent = clamp(((range.startTimeMs - timelineStartMs) / spanMs) * 100, 0, 100);
        const endPercent = clamp(((range.endTimeMs - timelineStartMs) / spanMs) * 100, 0, 100);
        return {
            startTimeMs: range.startTimeMs,
            endTimeMs: range.endTimeMs,
            startPercent,
            endPercent,
            widthPercent: Math.max(0, endPercent - startPercent)
        };
    });
}
