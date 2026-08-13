/**
 * Temporal contract shared by finite-ephemeris consumers such as AOS/LOS.
 *
 * An analysis request is either wholly supported by the source coverage or
 * it is rejected.  Clipping it would make the returned pass set describe a
 * different interval from the one the operator asked to analyse.
 */

const START_KEYS = Object.freeze([
    "startDate", "startTime", "start_time", "startTimeMs", "start_time_ms",
    "startMs", "start", "coverageStart", "coverage_start", "t_min", "tMin"
]);
const END_KEYS = Object.freeze([
    "endDate", "endTime", "end_time", "endTimeMs", "end_time_ms",
    "endMs", "end", "coverageEnd", "coverage_end", "t_max", "tMax", "stopTime"
]);

function epochMilliseconds(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || !value.trim()) return null;
    if (/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function firstValue(record, keys) {
    if (!record || typeof record !== "object") return undefined;
    for (const key of keys) {
        if (record[key] !== undefined && record[key] !== null && record[key] !== "") return record[key];
    }
    return undefined;
}

export function normalizeFiniteTimeRange(value) {
    if (!value || typeof value !== "object") return null;
    const startMs = epochMilliseconds(firstValue(value, START_KEYS));
    const endMs = epochMilliseconds(firstValue(value, END_KEYS));
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
    return Object.freeze({
        startMs,
        endMs,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString()
    });
}

/**
 * Decide whether a requested analysis interval is fully covered by a finite
 * source. A missing intrinsic range means the caller owns an open-ended
 * source (for example a TLE) and can use its ordinary request path.
 */
export function assessFiniteEphemerisAnalysisRange(intrinsicRange, analysisRange) {
    const source = normalizeFiniteTimeRange(intrinsicRange);
    if (!source) {
        return Object.freeze({
            allowed: true,
            finiteSource: false,
            sourceRange: null,
            analysisRange: normalizeFiniteTimeRange(analysisRange),
            reason: null,
            temporalStatus: "active"
        });
    }

    const requested = normalizeFiniteTimeRange(analysisRange);
    if (!requested) {
        return Object.freeze({
            allowed: false,
            finiteSource: true,
            sourceRange: source,
            analysisRange: null,
            reason: "invalid-analysis-window",
            temporalStatus: "out_of_range"
        });
    }

    const allowed = requested.startMs >= source.startMs && requested.endMs <= source.endMs;
    return Object.freeze({
        allowed,
        finiteSource: true,
        sourceRange: source,
        analysisRange: requested,
        reason: allowed ? null : "analysis-window-outside-intrinsic-range",
        temporalStatus: allowed ? "active" : "out_of_range"
    });
}

export function finiteEphemerisAnalysisRangeMessage(assessment) {
    if (assessment?.reason === "invalid-analysis-window") {
        return "El intervalo de análisis no es temporalmente válido.";
    }
    if (assessment?.reason === "analysis-window-outside-intrinsic-range") {
        return "El intervalo de análisis solicitado queda fuera de la cobertura temporal de este objeto. No se han generado AOS/LOS.";
    }
    return "No se puede analizar la cobertura temporal de este objeto.";
}
