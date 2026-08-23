/**
 * TLE ephemeris prefetch planning
 * ===============================
 *
 * These functions deliberately only *plan* a speculative request.  They do
 * not know about Cesium, the network, or the ephemeris cache.  Keeping that
 * decision pure lets the renderer use the exact same bounded-window contract
 * for its foreground request and for a quiet, low-priority next-window warmup.
 */

import {
    resolveBoundedTleEphemerisWindow,
    TLE_EPHEMERIS_WINDOW_LIMITS
} from "./tleEphemerisWindow.js";

function finiteMilliseconds(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function windowBoundary(window, boundary) {
    if (!window || typeof window !== "object") return null;
    return finiteMilliseconds(
        window[`${boundary}Ms`]
        ?? window[`${boundary}TimeMs`]
    );
}

/**
 * A prefetch is intentionally conservative: one bounded segment ahead of
 * the segment that is currently rendered.  The playhead will choose this
 * same segment as soon as it crosses the visible segment's end, so its cache
 * key can be reused verbatim by the foreground renderer.
 *
 * `currentWindow` accepts both the renderer's `{ startMs, endMs }` shape and
 * the raw bounded-window `{ startTimeMs, endTimeMs }` shape.  Returning null
 * means there is no future coverage to warm (the end of the selected scene,
 * an invalid window, or an epoch that has not been reached).
 */
export function resolveNextTleEphemerisPrefetchWindow({
    currentWindow,
    rangeStartMs,
    rangeEndMs,
    epochMs = null,
    propagationHours = 12
} = {}) {
    const currentStartMs = windowBoundary(currentWindow, "start");
    const currentEndMs = windowBoundary(currentWindow, "end");
    const selectedRangeEndMs = finiteMilliseconds(rangeEndMs);
    if (!Number.isFinite(currentStartMs)
        || !Number.isFinite(currentEndMs)
        || !Number.isFinite(selectedRangeEndMs)
        || currentEndMs <= currentStartMs
        || currentEndMs >= selectedRangeEndMs) {
        return null;
    }

    // Ask the canonical resolver for the window selected at the transition
    // point.  Do not construct dates manually: it owns the epoch guard,
    // maximum horizon and cache-key anchoring rules.
    const candidate = resolveBoundedTleEphemerisWindow({
        rangeStartMs,
        rangeEndMs: selectedRangeEndMs,
        currentTimeMs: currentEndMs,
        epochMs,
        propagationHours
    });

    // At the final scene timestamp the resolver intentionally returns a
    // trailing window.  It is useful for rendering but not a *next* window.
    // The same applies to a tiny invalid window that resolves to itself.
    if (!candidate || candidate.endTimeMs <= currentEndMs) {
        return null;
    }

    return candidate;
}

/**
 * Return whether a planned TLE warmup may enter the low-priority queue.
 *
 * The caller remains responsible for recording the returned key as pending
 * before scheduling it.  The small global limit protects foreground SP3/TLE
 * work and prevents many active layers from filling the LRU cache with
 * speculative data.
 */
export function shouldScheduleTleEphemerisPrefetch({
    nextWindow,
    cacheHasNext = false,
    requestPending = false,
    activePrefetchCount = 0,
    maxConcurrentPrefetches = TLE_EPHEMERIS_PREFETCH_LIMITS.maxConcurrentPrefetches
} = {}) {
    const startMs = windowBoundary(nextWindow, "start");
    const endMs = windowBoundary(nextWindow, "end");
    const activeCount = Number(activePrefetchCount);
    const maximum = Number(maxConcurrentPrefetches);
    return Boolean(
        Number.isFinite(startMs)
        && Number.isFinite(endMs)
        && endMs > startMs
        && !cacheHasNext
        && !requestPending
        && Number.isFinite(activeCount)
        && activeCount >= 0
        && Number.isFinite(maximum)
        && maximum > 0
        && activeCount < maximum
    );
}

export const TLE_EPHEMERIS_PREFETCH_LIMITS = Object.freeze({
    // One speculative fetch globally is enough to remove the next-boundary
    // latency without competing with four foreground range requests.
    maxConcurrentPrefetches: 1,
    maxAheadWindows: 1,
    // Re-exporting the resolver's cadence makes scheduler behaviour explicit
    // without duplicating a magic value in the renderer.
    anchorGranularityMs: TLE_EPHEMERIS_WINDOW_LIMITS.anchorGranularityMs
});
