import assert from "node:assert/strict";
import test from "node:test";

import {
    buildTleOperationalTimeRange,
    resolveActiveSatelliteTimeDomain
} from "../../js/runtime/simulation/activeSatelliteTimeDomain.js";

const HOUR_MS = 60 * 60 * 1000;
const ms = (value) => Date.parse(value);

test("a TLE-only simulation starts fresh at now when its epoch is already past", () => {
    const now = "2026-08-23T10:00:00.000Z";
    const range = buildTleOperationalTimeRange({
        epoch: "2026-08-10T00:00:00.000Z",
        now,
        propagationHours: 12
    });

    assert.deepEqual(range, {
        startTimeMs: ms(now),
        endTimeMs: ms(now) + (12 * HOUR_MS)
    });
    assert.equal(
        range.endTimeMs - range.startTimeMs,
        12 * HOUR_MS,
        "a previous SP3/MTR duration must never leak into a newly built TLE horizon"
    );
});

test("a future TLE epoch remains the lower bound of its operating simulation", () => {
    const range = buildTleOperationalTimeRange({
        epoch: "2026-08-24T06:00:00.000Z",
        now: "2026-08-23T10:00:00.000Z",
        propagationHours: 3
    });

    assert.deepEqual(range, {
        startTimeMs: ms("2026-08-24T06:00:00.000Z"),
        endTimeMs: ms("2026-08-24T09:00:00.000Z")
    });
});

test("finite and TLE active sources keep their separate domains but form one scene envelope", () => {
    const domain = resolveActiveSatelliteTimeDomain({
        finiteRanges: [{
            startTimeMs: ms("2026-08-20T00:00:00.000Z"),
            endTimeMs: ms("2026-08-21T00:00:00.000Z")
        }],
        tleRanges: [{
            startTimeMs: ms("2026-08-23T10:00:00.000Z"),
            endTimeMs: ms("2026-08-23T22:00:00.000Z")
        }]
    });

    assert.deepEqual(domain, {
        mode: "range",
        source: "mixed",
        range: {
            startTimeMs: ms("2026-08-20T00:00:00.000Z"),
            endTimeMs: ms("2026-08-23T22:00:00.000Z")
        }
    });
});

test("removing the last SP3 recomputes the range from active TLE layers only", () => {
    const tleOnly = resolveActiveSatelliteTimeDomain({
        finiteRanges: [],
        tleRanges: [{
            startTimeMs: ms("2026-08-23T10:00:00.000Z"),
            endTimeMs: ms("2026-08-23T22:00:00.000Z")
        }]
    });

    assert.deepEqual(tleOnly, {
        mode: "range",
        source: "tle",
        range: {
            startTimeMs: ms("2026-08-23T10:00:00.000Z"),
            endTimeMs: ms("2026-08-23T22:00:00.000Z")
        }
    });
});

test("removing every satellite source clears the former simulation range and returns to realtime", () => {
    assert.deepEqual(resolveActiveSatelliteTimeDomain({
        finiteRanges: [{ startTimeMs: 1, endTimeMs: 2 }],
        tleRanges: []
    }), {
        mode: "range",
        source: "finite",
        range: { startTimeMs: 1, endTimeMs: 2 }
    });

    assert.deepEqual(resolveActiveSatelliteTimeDomain({
        finiteRanges: [],
        tleRanges: []
    }), {
        mode: "realtime",
        source: "none",
        range: null
    });
});

test("invalid source windows fail closed instead of retaining a previous scene range", () => {
    assert.deepEqual(resolveActiveSatelliteTimeDomain({
        finiteRanges: [{ startTimeMs: "bad", endTimeMs: 2 }],
        tleRanges: [{ startTimeMs: 4, endTimeMs: 3 }]
    }), {
        mode: "realtime",
        source: "none",
        range: null
    });
});
