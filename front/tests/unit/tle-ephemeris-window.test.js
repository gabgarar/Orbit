import assert from "node:assert/strict";
import test from "node:test";

import {
    resolveBoundedTleEphemerisWindow,
    TLE_EPHEMERIS_WINDOW_LIMITS
} from "../../js/runtime/simulation/tleEphemerisWindow.js";

const ms = (value) => Date.parse(value);

test("a mixed SP3/TLE scene never turns its whole envelope into one TLE request", () => {
    const range = resolveBoundedTleEphemerisWindow({
        // Old precise coverage, a long gap, then the active TLE period.
        rangeStartMs: ms("2025-05-10T00:00:00.000Z"),
        rangeEndMs: ms("2026-08-23T22:00:00.000Z"),
        currentTimeMs: ms("2026-08-23T10:03:42.000Z"),
        epochMs: ms("2026-08-20T00:00:00.000Z"),
        propagationHours: 12
    });

    assert.ok(range);
    assert.equal(range.kind, "tle-range");
    assert.ok(range.startTimeMs >= ms("2026-08-23T10:00:00.000Z"));
    assert.ok(range.startTimeMs <= ms("2026-08-23T10:03:42.000Z"));
    assert.equal(range.endTimeMs - range.startTimeMs, 12 * 60 * 60 * 1000);
    assert.ok(
        range.startTimeMs > ms("2025-05-10T00:00:00.000Z"),
        "the old SP3 start must not be used to propagate the TLE"
    );
});

test("a TLE has no renderable segment before its epoch", () => {
    assert.equal(resolveBoundedTleEphemerisWindow({
        rangeStartMs: ms("2026-08-10T00:00:00.000Z"),
        rangeEndMs: ms("2026-08-25T00:00:00.000Z"),
        currentTimeMs: ms("2026-08-19T23:59:59.000Z"),
        epochMs: ms("2026-08-20T00:00:00.000Z"),
        propagationHours: 12
    }), null);
});

test("a stale huge propagation preference cannot create a TLE rosette", () => {
    const range = resolveBoundedTleEphemerisWindow({
        rangeStartMs: ms("2026-08-01T00:00:00.000Z"),
        rangeEndMs: ms("2026-10-01T00:00:00.000Z"),
        currentTimeMs: ms("2026-08-23T10:00:00.000Z"),
        epochMs: ms("2026-08-01T00:00:00.000Z"),
        propagationHours: 11111
    });

    assert.ok(range);
    assert.equal(
        range.endTimeMs - range.startTimeMs,
        TLE_EPHEMERIS_WINDOW_LIMITS.maxWindowMs
    );
});

test("the final range timestamp is covered by a local trailing TLE segment", () => {
    const range = resolveBoundedTleEphemerisWindow({
        rangeStartMs: ms("2026-08-20T00:00:00.000Z"),
        rangeEndMs: ms("2026-08-20T01:00:00.000Z"),
        currentTimeMs: ms("2026-08-20T01:00:00.000Z"),
        epochMs: ms("2026-08-20T00:00:00.000Z"),
        propagationHours: 12
    });

    assert.ok(range);
    assert.equal(range.startTimeMs, ms("2026-08-20T00:00:00.000Z"));
    assert.equal(range.endTimeMs, ms("2026-08-20T01:00:00.000Z"));
});
