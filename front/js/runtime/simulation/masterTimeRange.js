/**
 * Master Time Range (MTR)
 * =======================
 *
 * The MTR is the authoritative UTC interval for a scene.  This module is
 * intentionally independent from Cesium, the DOM and the simulation state so
 * importers, generators and the timeline can all apply the same temporal
 * contract without creating another competing clock/range.
 *
 * A range is inclusive at both endpoints.  A one-epoch range is therefore
 * valid; this matters for static observations and for objects created from a
 * single state vector.  Invalid or absent object domains fail closed in the
 * object predicates: an object may never be extrapolated merely because its
 * coverage metadata is incomplete.
 */

const START_KEYS = Object.freeze([
    "startDate",
    "start_date",
    "startTime",
    "start_time",
    "startTimeMs",
    "start_time_ms",
    "startMs",
    "start",
    "from",
    "t_min",
    "tMin",
    "min",
    "coverageStart",
    "coverage_start",
    "epochStart",
    "epoch_start"
]);

const END_KEYS = Object.freeze([
    "endDate",
    "end_date",
    "endTime",
    "end_time",
    "endTimeMs",
    "end_time_ms",
    "endMs",
    "end",
    "to",
    "t_max",
    "tMax",
    "max",
    "coverageEnd",
    "coverage_end",
    "epochEnd",
    "epoch_end",
    "stopTime",
    "stop_time"
]);

function firstDefinedValue(value, keys) {
    if (!value || typeof value !== "object") return undefined;
    for (const key of keys) {
        const candidate = value[key];
        if (candidate !== undefined && candidate !== null && candidate !== "") return candidate;
    }
    return undefined;
}

function toUtcMilliseconds(value) {
    if (value instanceof Date) {
        const milliseconds = value.getTime();
        return Number.isFinite(milliseconds) ? milliseconds : null;
    }
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || !value.trim()) return null;

    const trimmed = value.trim();
    // Product adapters commonly expose epoch milliseconds as a string.  Do
    // not guess seconds here: accepting a unit ambiguity could quietly shift
    // an MTR by decades and permit invalid propagation.
    if (/^[+-]?\d+(?:\.\d+)?$/.test(trimmed)) {
        const numeric = Number(trimmed);
        return Number.isFinite(numeric) ? numeric : null;
    }
    const milliseconds = Date.parse(trimmed);
    return Number.isFinite(milliseconds) ? milliseconds : null;
}

function cloneRange(range) {
    if (!range) return null;
    return Object.freeze({
        startDate: new Date(range.startDate.getTime()),
        endDate: new Date(range.endDate.getTime())
    });
}

function createRange(startValue, endValue) {
    const startMs = toUtcMilliseconds(startValue);
    const endMs = toUtcMilliseconds(endValue);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
    if (endMs < startMs) return null;
    return Object.freeze({
        startDate: new Date(startMs),
        endDate: new Date(endMs)
    });
}

function extractRangeValues(rangeOrStart, endValue, hasExplicitEnd) {
    if (hasExplicitEnd) return [rangeOrStart, endValue];
    if (Array.isArray(rangeOrStart)) return [rangeOrStart[0], rangeOrStart[1]];
    if (!rangeOrStart || typeof rangeOrStart !== "object") return [undefined, undefined];
    return [
        firstDefinedValue(rangeOrStart, START_KEYS),
        firstDefinedValue(rangeOrStart, END_KEYS)
    ];
}

function rangeValidation(rangeOrStart, endValue, hasExplicitEnd) {
    const [startValue, endValueFromRange] = extractRangeValues(rangeOrStart, endValue, hasExplicitEnd);
    const startMs = toUtcMilliseconds(startValue);
    const endMs = toUtcMilliseconds(endValueFromRange);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        return Object.freeze({
            valid: false,
            reason: "invalid-range-date",
            range: null
        });
    }
    if (endMs < startMs) {
        return Object.freeze({
            valid: false,
            reason: "range-end-before-start",
            range: null
        });
    }
    return Object.freeze({
        valid: true,
        reason: null,
        range: createRange(startMs, endMs)
    });
}

function contains(range, date) {
    const milliseconds = toUtcMilliseconds(date);
    return Boolean(range && Number.isFinite(milliseconds)
        && milliseconds >= range.startDate.getTime()
        && milliseconds <= range.endDate.getTime());
}

function objectRangeCandidate(object) {
    if (!object || typeof object !== "object" || Array.isArray(object)) return object;
    // Prefer explicit intrinsic-domain containers.  The final fallback allows
    // callers to pass a range itself directly to `isInsideObjectRange`.
    return object.intrinsicTimeRange
        ?? object.intrinsic_time_range
        ?? object.range
        ?? object.timeRange
        ?? object.time_range
        ?? object.coverage
        ?? object.ephemerisRange
        ?? object.ephemeris_range
        ?? object;
}

/**
 * Create an isolated MTR store.  The exported module-level functions below
 * use one singleton instance; this factory exists for deterministic unit
 * tests and for a future independent scene/document runtime.
 */
export function createMasterTimeRangeStore() {
    let masterRange = null;

    /** Set the MTR exactly. Invalid input leaves the current MTR untouched. */
    function setMasterTimeRange(tMin, tMax) {
        const validation = rangeValidation(tMin, tMax, arguments.length >= 2);
        if (!validation.valid) return null;
        masterRange = validation.range;
        return cloneRange(masterRange);
    }

    /**
     * Grow the MTR to include a candidate interval. It never shrinks a scene.
     * With no established MTR this initializes it, which gives first-object
     * callers the same safe semantics as `setMasterTimeRange`.
     */
    function expandMasterTimeRange(newMin, newMax) {
        const validation = rangeValidation(newMin, newMax, arguments.length >= 2);
        if (!validation.valid) return null;
        if (!masterRange) {
            masterRange = validation.range;
        } else {
            masterRange = createRange(
                Math.min(masterRange.startDate.getTime(), validation.range.startDate.getTime()),
                Math.max(masterRange.endDate.getTime(), validation.range.endDate.getTime())
            );
        }
        return cloneRange(masterRange);
    }

    /** Return a defensive MTR copy, or null until the first finite object. */
    function getMasterTimeRange() {
        return cloneRange(masterRange);
    }

    /**
     * A date belongs to the inclusive MTR.  No MTR means no simulation domain
     * has been established yet, so this deliberately returns false.
     */
    function isInsideMasterRange(time) {
        return contains(masterRange, time);
    }

    /**
     * Clamp a valid time to the MTR.  Before the first MTR is established the
     * caller's valid instant is returned unchanged; invalid values return
     * null.  This lets the initial loading path seed the MTR without inventing
     * a boundary from wall-clock time.
     */
    function clampToMasterRange(time) {
        const milliseconds = toUtcMilliseconds(time);
        if (!Number.isFinite(milliseconds)) return null;
        if (!masterRange) return new Date(milliseconds);
        return new Date(Math.min(
            Math.max(milliseconds, masterRange.startDate.getTime()),
            masterRange.endDate.getTime()
        ));
    }

    /**
     * Validate and normalize any supported object coverage shape.  It returns
     * a structured result instead of throwing so importers can map the reason
     * to a user-facing dialog without partially adding an invalid object.
     */
    function validateObjectRange(range) {
        const validation = rangeValidation(range, undefined, false);
        return Object.freeze({
            ...validation,
            range: cloneRange(validation.range)
        });
    }

    /**
     * Assess an object's intrinsic range relative to the current MTR.
     *
     * `accepted` is true for a valid first object because it can initialize
     * the MTR. If an MTR already exists, `accepted` is true only when the
     * entire object range is contained. `requiresExpansion` is the precise
     * signal for the import/generation confirmation dialog.
     */
    function validateObjectFitsMTR(range) {
        const objectValidation = validateObjectRange(range);
        if (!objectValidation.valid) {
            return Object.freeze({
                valid: false,
                reason: objectValidation.reason,
                range: null,
                masterRange: getMasterTimeRange(),
                hasMasterTimeRange: Boolean(masterRange),
                fitsMTR: false,
                requiresInitialization: false,
                requiresExpansion: false,
                accepted: false
            });
        }

        const currentMasterRange = getMasterTimeRange();
        const hasMasterTimeRange = Boolean(currentMasterRange);
        const fitsMTR = !currentMasterRange || (
            objectValidation.range.startDate >= currentMasterRange.startDate
            && objectValidation.range.endDate <= currentMasterRange.endDate
        );
        const requiresInitialization = !hasMasterTimeRange;
        return Object.freeze({
            valid: true,
            reason: fitsMTR ? null : "outside-master-time-range",
            range: cloneRange(objectValidation.range),
            masterRange: currentMasterRange,
            hasMasterTimeRange,
            fitsMTR,
            requiresInitialization,
            requiresExpansion: hasMasterTimeRange && !fitsMTR,
            accepted: fitsMTR
        });
    }

    /**
     * Fail-closed intrinsic-domain predicate used before sampling, rendering,
     * interpolation or propagation. A missing/malformed range is never a
     * licence to extrapolate an OEM, SP3 or generated ephemeris.
     */
    function isInsideObjectRange(object, time) {
        const validation = validateObjectRange(objectRangeCandidate(object));
        return Boolean(validation.valid && contains(validation.range, time));
    }

    /** Clear the MTR for project teardown / deterministic tests. */
    function clearMasterTimeRange() {
        masterRange = null;
        return null;
    }

    return Object.freeze({
        setMasterTimeRange,
        expandMasterTimeRange,
        getMasterTimeRange,
        isInsideMasterRange,
        clampToMasterRange,
        validateObjectRange,
        validateObjectFitsMTR,
        isInsideObjectRange,
        clearMasterTimeRange
    });
}

const masterTimeRangeStore = createMasterTimeRangeStore();

export const setMasterTimeRange = masterTimeRangeStore.setMasterTimeRange;
export const expandMasterTimeRange = masterTimeRangeStore.expandMasterTimeRange;
export const getMasterTimeRange = masterTimeRangeStore.getMasterTimeRange;
export const isInsideMasterRange = masterTimeRangeStore.isInsideMasterRange;
export const clampToMasterRange = masterTimeRangeStore.clampToMasterRange;
export const validateObjectRange = masterTimeRangeStore.validateObjectRange;
export const validateObjectFitsMTR = masterTimeRangeStore.validateObjectFitsMTR;
export const isInsideObjectRange = masterTimeRangeStore.isInsideObjectRange;

/** Explicit lifecycle hook; not needed by normal scene interactions. */
export const clearMasterTimeRange = masterTimeRangeStore.clearMasterTimeRange;
