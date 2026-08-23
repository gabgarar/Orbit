import assert from "node:assert/strict";
import test from "node:test";

import {
    resolveNextTleEphemerisPrefetchWindow,
    shouldScheduleTleEphemerisPrefetch,
    TLE_EPHEMERIS_PREFETCH_LIMITS
} from "../../js/runtime/simulation/tleEphemerisPrefetch.js";
import { resolveBoundedTleEphemerisWindow } from "../../js/runtime/simulation/tleEphemerisWindow.js";

const ms = (value) => Date.parse(value);

test("the next TLE prefetch matches the foreground window selected at its boundary", () => {
    const options = {
        rangeStartMs: ms("2026-08-20T00:00:00.000Z"),
        rangeEndMs: ms("2026-08-25T00:00:00.000Z"),
        epochMs: ms("2026-08-20T00:00:00.000Z"),
        propagationHours: 12
    };
    const current = resolveBoundedTleEphemerisWindow({
        ...options,
        currentTimeMs: ms("2026-08-23T10:03:42.000Z")
    });
    const next = resolveNextTleEphemerisPrefetchWindow({
        ...options,
        currentWindow: current
    });
    const foregroundAtBoundary = resolveBoundedTleEphemerisWindow({
        ...options,
        currentTimeMs: current.endTimeMs
    });

    assert.ok(next);
    assert.deepEqual(next, foregroundAtBoundary);
    assert.ok(next.endTimeMs > current.endTimeMs);
    assert.ok(next.startTimeMs >= options.epochMs);
});

test("a mixed historical SP3/TLE envelope prefetches only the bounded post-epoch TLE segment", () => {
    const options = {
        rangeStartMs: ms("2025-05-10T00:00:00.000Z"),
        rangeEndMs: ms("2026-08-25T00:00:00.000Z"),
        epochMs: ms("2026-08-20T00:00:00.000Z"),
        propagationHours: 12
    };
    const current = resolveBoundedTleEphemerisWindow({
        ...options,
        currentTimeMs: ms("2026-08-23T10:03:42.000Z")
    });
    const next = resolveNextTleEphemerisPrefetchWindow({
        ...options,
        currentWindow: { startMs: current.startTimeMs, endMs: current.endTimeMs }
    });

    assert.ok(next);
    assert.ok(next.startTimeMs >= options.epochMs);
    assert.ok(next.startTimeMs > options.rangeStartMs);
    assert.ok(next.endTimeMs - next.startTimeMs <= 24 * 60 * 60 * 1000);
});

test("there is no speculative segment after the final selected timestamp", () => {
    assert.equal(resolveNextTleEphemerisPrefetchWindow({
        currentWindow: {
            startTimeMs: ms("2026-08-23T12:00:00.000Z"),
            endTimeMs: ms("2026-08-24T00:00:00.000Z")
        },
        rangeStartMs: ms("2026-08-20T00:00:00.000Z"),
        rangeEndMs: ms("2026-08-24T00:00:00.000Z"),
        epochMs: ms("2026-08-20T00:00:00.000Z"),
        propagationHours: 12
    }), null);
});

test("a malformed or pre-epoch current segment cannot schedule a prefetch", () => {
    assert.equal(resolveNextTleEphemerisPrefetchWindow({
        currentWindow: {
            startMs: ms("2026-08-19T10:00:00.000Z"),
            endMs: ms("2026-08-19T22:00:00.000Z")
        },
        rangeStartMs: ms("2026-08-10T00:00:00.000Z"),
        rangeEndMs: ms("2026-08-25T00:00:00.000Z"),
        epochMs: ms("2026-08-20T00:00:00.000Z"),
        propagationHours: 12
    }), null);
    assert.equal(resolveNextTleEphemerisPrefetchWindow({
        currentWindow: { startMs: 10, endMs: 10 },
        rangeStartMs: 0,
        rangeEndMs: 100,
        propagationHours: 12
    }), null);
});

test("prefetch scheduling is bounded and never duplicates cached or in-flight work", () => {
    const nextWindow = { startMs: 100, endMs: 200 };
    assert.equal(shouldScheduleTleEphemerisPrefetch({ nextWindow }), true);
    assert.equal(shouldScheduleTleEphemerisPrefetch({ nextWindow, cacheHasNext: true }), false);
    assert.equal(shouldScheduleTleEphemerisPrefetch({ nextWindow, requestPending: true }), false);
    assert.equal(shouldScheduleTleEphemerisPrefetch({
        nextWindow,
        activePrefetchCount: TLE_EPHEMERIS_PREFETCH_LIMITS.maxConcurrentPrefetches
    }), false);
    assert.equal(shouldScheduleTleEphemerisPrefetch({
        nextWindow: { startMs: 200, endMs: 200 }
    }), false);
});
