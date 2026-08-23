import assert from "node:assert/strict";
import test from "node:test";

import { buildTimelineOrbitCoverageSegments } from "../../js/runtime/simulation/timelineOrbitCoverage.js";

const HOUR_MS = 60 * 60 * 1000;
const startDate = "2026-08-23T00:00:00.000Z";
const endDate = "2026-08-24T00:00:00.000Z";
const ms = (hours) => Date.parse(startDate) + (hours * HOUR_MS);
const approximately = (actual, expected, message = "percentage must be accurate") => {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} !== ${expected}`);
};

test("timeline orbital coverage merges overlapping and contiguous visible source intervals", () => {
    const segments = buildTimelineOrbitCoverageSegments({
        startDate,
        endDate,
        ranges: [
            { startTimeMs: ms(8), endTimeMs: ms(14) },
            { startTimeMs: ms(2), endTimeMs: ms(8) },
            { startTimeMs: ms(12), endTimeMs: ms(18) }
        ]
    });

    assert.equal(segments.length, 1);
    assert.equal(segments[0].startTimeMs, ms(2));
    assert.equal(segments[0].endTimeMs, ms(18));
    approximately(segments[0].startPercent, 100 / 12);
    approximately(segments[0].endPercent, 75);
    approximately(segments[0].widthPercent, 75 - (100 / 12));
});

test("timeline orbital coverage clips sources to the active simulation interval and accepts UTC aliases", () => {
    const segments = buildTimelineOrbitCoverageSegments({
        startDate,
        endDate,
        ranges: [
            { coverageStart: "2026-08-22T18:00:00.000Z", coverageEnd: "2026-08-23T06:00:00.000Z" },
            { startDate: "2026-08-23T18:00:00.000Z", endDate: "2026-08-24T06:00:00.000Z" }
        ]
    });

    assert.deepEqual(segments, [
        {
            startTimeMs: ms(0),
            endTimeMs: ms(6),
            startPercent: 0,
            endPercent: 25,
            widthPercent: 25
        },
        {
            startTimeMs: ms(18),
            endTimeMs: ms(24),
            startPercent: 75,
            endPercent: 100,
            widthPercent: 25
        }
    ]);
});

test("timeline orbital coverage retains real gaps between exact and TLE operating windows", () => {
    const segments = buildTimelineOrbitCoverageSegments({
        startDate,
        endDate,
        ranges: [
            { startTimeMs: ms(0), endTimeMs: ms(4) },
            // Deliberate hybrid SP3 -> TLE hole: it must stay unpainted.
            { startTimeMs: ms(12), endTimeMs: ms(20) }
        ]
    });

    assert.equal(segments.length, 2);
    approximately(segments[0].startPercent, 0);
    approximately(segments[0].endPercent, 100 / 6);
    approximately(segments[0].widthPercent, 100 / 6);
    approximately(segments[1].startPercent, 50);
    approximately(segments[1].endPercent, 100 / 1.2);
    approximately(segments[1].widthPercent, 100 / 3);
    assert.ok(segments[0].endPercent < segments[1].startPercent, "a true source gap must remain visible");
});

test("timeline orbital coverage fails closed for invalid, point, hidden-filtered, and out-of-range inputs", () => {
    const segments = buildTimelineOrbitCoverageSegments({
        startDate,
        endDate,
        ranges: [
            null,
            { startTimeMs: "not-a-time", endTimeMs: ms(4) },
            { startTimeMs: ms(8), endTimeMs: ms(8) },
            { startTimeMs: ms(14), endTimeMs: ms(12) },
            // A visibility update must immediately remove this otherwise
            // valid interval from the painted coverage.
            { startTimeMs: ms(4), endTimeMs: ms(8), hidden: true },
            { startTimeMs: ms(-10), endTimeMs: ms(-1) },
            { startTimeMs: ms(25), endTimeMs: ms(27) }
        ]
    });

    assert.deepEqual(segments, []);
    assert.deepEqual(buildTimelineOrbitCoverageSegments({
        startDate: endDate,
        endDate: startDate,
        ranges: [{ startTimeMs: ms(1), endTimeMs: ms(2) }]
    }), []);
});
