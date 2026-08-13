import assert from "node:assert/strict";
import test from "node:test";

import {
    assessFiniteEphemerisAnalysisRange,
    finiteEphemerisAnalysisRangeMessage,
    normalizeFiniteTimeRange
} from "../../js/features/groundStations/timeRangeContract.js";

const SOURCE_RANGE = Object.freeze({
    startTime: "2026-08-10T00:00:00Z",
    endTime: "2026-08-10T06:00:00Z"
});

test("finite AOS/LOS analysis requires the entire requested interval to be covered", () => {
    const inside = assessFiniteEphemerisAnalysisRange(SOURCE_RANGE, {
        startDate: new Date("2026-08-10T01:00:00Z"),
        endDate: new Date("2026-08-10T05:00:00Z")
    });
    assert.equal(inside.allowed, true);
    assert.equal(inside.temporalStatus, "active");

    const outside = assessFiniteEphemerisAnalysisRange(SOURCE_RANGE, {
        startTime: "2026-08-09T23:59:59Z",
        endTime: "2026-08-10T02:00:00Z"
    });
    assert.equal(outside.allowed, false);
    assert.equal(outside.temporalStatus, "out_of_range");
    assert.equal(outside.reason, "analysis-window-outside-intrinsic-range");
    assert.match(finiteEphemerisAnalysisRangeMessage(outside), /No se han generado AOS\/LOS/);
});

test("finite analysis rejects malformed windows rather than clipping or extrapolating", () => {
    const result = assessFiniteEphemerisAnalysisRange(SOURCE_RANGE, {
        startTime: "not-a-time",
        endTime: "2026-08-10T01:00:00Z"
    });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, "invalid-analysis-window");
    assert.equal(normalizeFiniteTimeRange({ start: "2026-08-10T02:00:00Z", end: "2026-08-10T01:00:00Z" }), null);
});

test("open-ended sources keep their normal analysis path", () => {
    const result = assessFiniteEphemerisAnalysisRange(null, {
        startTime: "2026-08-10T00:00:00Z",
        endTime: "2026-08-10T01:00:00Z"
    });
    assert.equal(result.allowed, true);
    assert.equal(result.finiteSource, false);
});
