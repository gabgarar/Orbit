import assert from "node:assert/strict";
import test from "node:test";

import {
    EOP_COVERAGE_SOURCE_KINDS,
    assessEarthOrientationCoverage,
    describeEarthOrientationCoverage,
    describeEarthOrientationCoverageDetail,
    earthOrientationCoverageDetail,
    normalizeEarthOrientationWindow,
    normalizeEopCoverageTimeline
} from "../../js/features/timekeeping/eopCoveragePolicy.js";

const T0 = "2026-07-01T00:00:00.000Z";
const T1 = "2026-07-20T00:00:00.000Z";
const T2 = "2026-08-15T00:00:00.000Z";
const T3 = "2026-09-14T00:00:00.000Z";

function diagnostics(overrides = {}) {
    return {
        details: {
            coverageTimeline: [
                { kind: "iers-c01", start: T0, end: T1, source: "IERS C01", quality: "final" },
                { kind: "finals2000A", start: T1, end: T2, source: "IERS finals2000A", quality: "rapid/predicted" },
                { kind: "linear-extrapolation", start: T2, end: null, source: "Orbit local", quality: "extrapolated" }
            ],
            ...overrides
        }
    };
}

test("EOP coverage partitions a crossing request into C01, finals2000A, then explicitly labelled extrapolation", () => {
    const assessment = assessEarthOrientationCoverage(diagnostics(), {
        startTime: "2026-07-19T12:00:00Z",
        endTime: "2026-08-16T00:00:00Z"
    });

    assert.equal(assessment.classification, "mixed");
    assert.equal(assessment.requiresNotice, true);
    assert.equal(assessment.requiresWarning, true);
    assert.deepEqual(assessment.segments.map(({ kind, start, end, quality }) => [kind, start, end, quality]), [
        [EOP_COVERAGE_SOURCE_KINDS.C01, "2026-07-19T12:00:00.000Z", T1, "final"],
        [EOP_COVERAGE_SOURCE_KINDS.FINALS, T1, T2, "rapid/predicted"],
        [EOP_COVERAGE_SOURCE_KINDS.EXTRAPOLATION, T2, "2026-08-16T00:00:00.000Z", "extrapolated"]
    ]);
    assert.match(describeEarthOrientationCoverage(assessment, { operation: "La propagación" }), /IERS C01/);
    assert.match(describeEarthOrientationCoverage(assessment, { operation: "La propagación" }), /finals2000A \(rapid\/predicted\)/);
    assert.match(describeEarthOrientationCoverage(assessment, { operation: "La propagación" }), /extrapolación lineal \(no ERP\/IERS\)/);
});

test("C01 wins where diagnostics publish overlapping exact sources", () => {
    const assessment = assessEarthOrientationCoverage({
        coverageTimeline: [
            { kind: "finals2000A", start: T0, end: T2, quality: "rapid" },
            { kind: "c01", start: "2026-07-10T00:00:00Z", end: T1, quality: "final" }
        ]
    }, {
        startTime: "2026-07-12T00:00:00Z",
        endTime: "2026-07-15T00:00:00Z"
    });

    assert.equal(assessment.classification, "iers-c01");
    assert.equal(assessment.requiresNotice, false);
    assert.deepEqual(assessment.segments.map((segment) => segment.kind), [EOP_COVERAGE_SOURCE_KINDS.C01]);
});

test("named source/selection diagnostic aliases remain usable without a timeline", () => {
    const timeline = normalizeEopCoverageTimeline({
        details: {
            sources: {
                c01: { source: "IERS C01" },
                finals2000A: { source: "IERS finals2000A", qualityLabel: "predicted" }
            },
            selection: {
                c01Coverage: { start: T0, end: T1 },
                finalsCoverage: { start: T1, end: T2 },
                extrapolationStartsAt: T2
            }
        }
    });

    assert.deepEqual(timeline.map(({ kind, start, end, quality }) => [kind, start, end, quality]), [
        [EOP_COVERAGE_SOURCE_KINDS.C01, T0, T1, "final"],
        [EOP_COVERAGE_SOURCE_KINDS.FINALS, T1, T2, "predicted"],
        [EOP_COVERAGE_SOURCE_KINDS.EXTRAPOLATION, T2, null, "extrapolated"]
    ]);
});

test("quality-resolved timeline entries override a broad named finals source", () => {
    const assessment = assessEarthOrientationCoverage({
        details: {
            coverageTimeline: [
                { kind: "iers-finals2000a", start: T0, end: T1, quality: "rapid" },
                { kind: "iers-finals2000a", start: T1, end: T2, quality: "predicted" }
            ],
            sources: {
                finals2000A: {
                    source: "IERS finals2000A",
                    coverage: { start: T0, end: T2 }
                }
            }
        }
    }, { startTime: "2026-07-21T00:00:00Z", endTime: "2026-07-22T00:00:00Z" });

    assert.equal(assessment.classification, "finals2000a");
    assert.equal(assessment.segments[0].quality, "predicted");
    assert.equal(assessment.requiresNotice, true);
});

test("unknown coverage stays a warning instead of claiming a fallback source", () => {
    const assessment = assessEarthOrientationCoverage({ details: { coverage: { start: T0, end: T1 } } }, {
        startTime: T0,
        endTime: T1
    });

    assert.equal(assessment.available, false);
    assert.equal(assessment.classification, "unknown");
    assert.equal(assessment.requiresWarning, true);
    assert.match(describeEarthOrientationCoverage(assessment), /no hay cobertura EOP publicada/i);
});

test("serialisable result detail never presents extrapolation as IERS", () => {
    const assessment = assessEarthOrientationCoverage(diagnostics(), {
        startTime: T2,
        endTime: "2026-08-16T00:00:00Z"
    });
    const detail = earthOrientationCoverageDetail(assessment);

    assert.equal(detail.classification, "extrapolated");
    assert.equal(detail.requiresWarning, true);
    assert.deepEqual(detail.segments, [{
        kind: "linear-extrapolation",
        startTime: T2,
        endTime: "2026-08-16T00:00:00.000Z",
        source: "Orbit local",
        quality: "extrapolated"
    }]);
});

test("the explicit 30-day linear horizon ends at nominal fallback instead of extending indefinitely", () => {
    const assessment = assessEarthOrientationCoverage({
        details: {
            coverageTimeline: [
                { kind: "iers-c01", start: T0, end: T1, quality: "final" },
                { kind: "iers-finals2000a", start: T1, end: T2, quality: "predicted" },
                { kind: "linear-extrapolation", start: T2, end: T3, quality: "extrapolated", maxHorizonDays: 30 },
                { kind: "nominal-fallback", start: T3, end: null, quality: "approximate" }
            ]
        }
    }, {
        startTime: "2026-09-13T12:00:00Z",
        endTime: "2026-09-16T00:00:00Z"
    });

    assert.deepEqual(assessment.segments.map((segment) => segment.kind), [
        EOP_COVERAGE_SOURCE_KINDS.EXTRAPOLATION,
        EOP_COVERAGE_SOURCE_KINDS.NOMINAL
    ]);
    assert.equal(assessment.hasExtrapolation, true);
    assert.equal(assessment.hasNominal, true);
    assert.equal(assessment.requiresWarning, true);

    const postHorizon = assessEarthOrientationCoverage({
        coverageTimeline: [
            { kind: "linear-extrapolation", start: T2, end: null, quality: "extrapolated" }
        ],
        selection: {
            extrapolationStartsAt: T2,
            nominalFallbackStartsAt: T3,
            linearExtrapolationMaxDays: 30
        }
    }, { startTime: T3, endTime: "2026-09-16T00:00:00Z" });
    assert.equal(postHorizon.classification, "nominal");
    assert.equal(postHorizon.hasExtrapolation, false);
    assert.equal(postHorizon.hasNominal, true);
});

test("backend actual-window provenance stays separate from preflight and labels nominal fallback honestly", () => {
    const actual = normalizeEarthOrientationWindow({
        start: "2026-08-14T12:00:00Z",
        end: "2026-09-15T00:00:00Z",
        segments: [
            { kind: "iers-finals2000a", start: "2026-08-14T12:00:00Z", end: T2, source: "IERS finals2000A", quality: "predicted" },
            { kind: "linear-extrapolation", start: T2, end: T3, source: "Orbit linear tail", quality: "extrapolated" },
            { kind: "nominal-fallback", start: T3, end: "2026-09-15T00:00:00Z", source: "UTC≈UT1", quality: "approximate" }
        ],
        requiresAttention: true
    });

    assert.ok(actual);
    assert.equal(actual.hasFinals, true);
    assert.equal(actual.hasExtrapolation, true);
    assert.equal(actual.hasNominal, true);
    assert.equal(actual.requiresWarning, true);
    const copy = describeEarthOrientationCoverageDetail(earthOrientationCoverageDetail(actual), {
        operation: "La operación completada"
    });
    assert.match(copy, /finals2000A/);
    assert.match(copy, /extrapolación lineal \(no ERP\/IERS\)/);
    assert.match(copy, /rotación terrestre nominal \(sin ERP\)/);
});
