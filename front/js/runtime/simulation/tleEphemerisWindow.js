/**
 * Bounded TLE ephemeris windows
 * ==============================
 *
 * A TLE is an open-ended propagator, whereas SP3/OEM sources carry a finite
 * sample interval.  A scene can contain both, with a perfectly legitimate
 * gap between the finite product and the later TLE operating period.  The
 * scene envelope is useful for navigation, but it is never a request window
 * for a TLE: asking SGP4 to draw the whole envelope makes a dense Earth-fixed
 * rosette and falsely suggests continuous source coverage.
 */

const HOUR_MS = 60 * 60 * 1000;
const MIN_TLE_EPHEMERIS_WINDOW_MS = 60 * 1000;
const MAX_TLE_EPHEMERIS_WINDOW_MS = 24 * HOUR_MS;
// Keep cache keys steady while playback advances, without making the visible
// track stale for a normal operator interaction.
const TLE_EPHEMERIS_ANCHOR_GRANULARITY_MS = 5 * 60 * 1000;

function finiteMilliseconds(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Resolve one local, non-extrapolable TLE segment inside a scene range.
 *
 * `epochMs` is a lower availability bound when known.  Returning `null`
 * before that epoch is intentional: callers must keep the layer out of time
 * rather than request backwards SGP4 propagation.  The selected segment is
 * bounded even if a persisted preference is stale or implausibly large.
 */
export function resolveBoundedTleEphemerisWindow({
    rangeStartMs,
    rangeEndMs,
    currentTimeMs,
    epochMs = null,
    propagationHours = 12
} = {}) {
    const rangeStart = finiteMilliseconds(rangeStartMs);
    const rangeEnd = finiteMilliseconds(rangeEndMs);
    const current = finiteMilliseconds(currentTimeMs);
    const epoch = finiteMilliseconds(epochMs);
    if (!Number.isFinite(rangeStart)
        || !Number.isFinite(rangeEnd)
        || !Number.isFinite(current)
        || rangeEnd <= rangeStart) {
        return null;
    }

    const availableStart = Number.isFinite(epoch)
        ? Math.max(rangeStart, epoch)
        : rangeStart;
    if (current < availableStart || current > rangeEnd) {
        return null;
    }

    const requestedHours = Number(propagationHours);
    const requestedWindowMs = Number.isFinite(requestedHours) && requestedHours > 0
        ? requestedHours * HOUR_MS
        : MIN_TLE_EPHEMERIS_WINDOW_MS;
    const windowMs = Math.max(
        MIN_TLE_EPHEMERIS_WINDOW_MS,
        Math.min(MAX_TLE_EPHEMERIS_WINDOW_MS, requestedWindowMs)
    );
    const anchoredCurrent = Math.floor(current / TLE_EPHEMERIS_ANCHOR_GRANULARITY_MS)
        * TLE_EPHEMERIS_ANCHOR_GRANULARITY_MS;
    let startTimeMs = Math.max(availableStart, anchoredCurrent);
    let endTimeMs = Math.min(rangeEnd, startTimeMs + windowMs);
    // At the final timestamp, retain a short preceding segment so the marker
    // still has a physical sample instead of falling back to a stale stream.
    // Otherwise retain a short *trailing* segment near the playhead rather
    // than shifting it backwards merely to fill the requested horizon.
    if (endTimeMs <= startTimeMs) {
        startTimeMs = Math.max(availableStart, rangeEnd - windowMs);
        endTimeMs = rangeEnd;
    }

    if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs) || endTimeMs <= startTimeMs) {
        return null;
    }
    return {
        kind: "tle-range",
        startTimeMs,
        endTimeMs,
        availabilityStartTimeMs: availableStart,
        maxWindowMs: windowMs
    };
}

export const TLE_EPHEMERIS_WINDOW_LIMITS = Object.freeze({
    minWindowMs: MIN_TLE_EPHEMERIS_WINDOW_MS,
    maxWindowMs: MAX_TLE_EPHEMERIS_WINDOW_MS,
    anchorGranularityMs: TLE_EPHEMERIS_ANCHOR_GRANULARITY_MS
});
