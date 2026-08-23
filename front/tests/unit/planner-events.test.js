import assert from "node:assert/strict";
import test from "node:test";

import {
    buildPlannerEopCoverageLayer,
    buildPlannerLayerEvents,
    buildPlannerEopCoverageEvents,
    buildPlannerPassEvents,
    buildPlannerResourceEvents,
    filterPlannerEventsByRange,
    getPlannerDayLayout,
    getPlannerMonthLayout,
    getPlannerWeekLayout,
    layoutPlannerEventLanes,
    normalizeManualPlannerEvent,
    normalizePlannerEvent,
    normalizePlannerEvents,
    normalizePlannerState,
    plannerEventIntersectsRange,
    plannerEventsOverlap,
    PLANNER_COLOR_TOKENS,
    PLANNER_EOP_LAYER_ID,
    PLANNER_EVENT_KINDS,
    PLANNER_MANUAL_COLOR_TOKENS,
    PLANNER_MANUAL_EVENT_REMOVE_EVENT,
    PLANNER_MANUAL_EVENT_UPSERT_EVENT,
    PLANNER_STATE_EVENT,
    resolvePlannerEopCoverageIntervals,
    toPlannerEpochMs
} from "../../js/features/planner/plannerEvents.js";

const T0 = "2026-08-17T10:00:00.000Z";
const T1 = "2026-08-17T11:00:00.000Z";
const T2 = "2026-08-17T12:00:00.000Z";

function manual(id, start = T0, end = T1, overrides = {}) {
    return {
        id,
        kind: PLANNER_EVENT_KINDS.MANUAL,
        title: `Manual ${id}`,
        start,
        end,
        colorToken: "blue",
        ...overrides
    };
}

test("planner exposes one canonical state event and manual command names", () => {
    assert.equal(PLANNER_STATE_EVENT, "orbit:planner-state");
    assert.equal(PLANNER_MANUAL_EVENT_UPSERT_EVENT, "orbit:planner-manual-event-upsert");
    assert.equal(PLANNER_MANUAL_EVENT_REMOVE_EVENT, "orbit:planner-manual-event-remove");
    assert.ok(PLANNER_MANUAL_COLOR_TOKENS.includes(PLANNER_COLOR_TOKENS.PURPLE));
});

test("timestamp parsing is UTC-only for strings and rejects malformed calendar dates", () => {
    assert.equal(toPlannerEpochMs("2026-08-17T12:00:00+02:00"), Date.parse("2026-08-17T10:00:00.000Z"));
    assert.equal(toPlannerEpochMs("2026-08-17T12:00:00"), null, "local-zone strings are ambiguous");
    assert.equal(toPlannerEpochMs("2026-02-29T12:00:00Z"), null, "2026 is not a leap year");
    assert.equal(toPlannerEpochMs("2026-13-01T12:00:00Z"), null);
    assert.equal(toPlannerEpochMs("2026-08-17T24:00:00Z"), null);
    assert.equal(toPlannerEpochMs(new Date(T0)), Date.parse(T0));
    assert.equal(toPlannerEpochMs(Number.NaN), null);
});

test("normalizer fails closed for unknown types, bad timestamps and invalid manual intervals", () => {
    assert.equal(normalizePlannerEvent({ kind: "made-up", time: T0 }), null);
    assert.equal(normalizePlannerEvent({ kind: "pass-aos", time: "not-time" }), null);
    assert.equal(normalizePlannerEvent(manual("inverted", T1, T0)), null);
    assert.equal(normalizeManualPlannerEvent({ title: "No end", start: T0 }), null);
    assert.equal(normalizeManualPlannerEvent({ title: "Bad colour", start: T0, end: T1, color: "#ff0000" }), null);

    const normalized = normalizeManualPlannerEvent({
        id: "review",
        title: "Revisar misión",
        start: T0,
        end: T1,
        color: "purple",
        metadata: { owner: "flight" }
    });
    assert.deepEqual(normalized, {
        id: "review",
        source: "manual",
        kind: "manual",
        title: "Revisar misión",
        start: T0,
        end: T1,
        startMs: Date.parse(T0),
        endMs: Date.parse(T1),
        durationMs: 60 * 60 * 1000,
        isPoint: false,
        allDay: false,
        colorToken: "purple",
        metadata: { owner: "flight" }
    });
});

test("collection normalizer drops invalid and duplicate identifiers deterministically", () => {
    const events = normalizePlannerEvents([
        manual("same", T1, T2),
        manual("same", T0, T1),
        { kind: "pass-max", time: T0 },
        manual("earlier", T0, T1)
    ]);
    assert.deepEqual(events.map((event) => event.id), ["earlier", "same"]);
    assert.equal(events[1].start, T1, "first valid duplicate wins without merging facts");
});

test("pass adapter turns only visible complete AOS/LOS/max facts into planner records", () => {
    const events = buildPlannerPassEvents([
        {
            id: "p0:aos",
            eventType: "aos",
            time: T0,
            stationId: "madrid",
            stationName: "Madrid",
            satelliteId: "iss",
            satelliteName: "ISS"
        },
        {
            id: "p0:max",
            eventType: "max",
            time: "2026-08-17T10:30:00.000Z",
            stationId: "madrid",
            satelliteId: "iss",
            elevationDeg: 61.5
        },
        {
            id: "p0:los",
            eventType: "los",
            time: T1,
            stationId: "madrid",
            satelliteLayerId: "iss",
            visible: false
        },
        { eventType: "aos", time: T0, stationId: "madrid" },
        { eventType: "made-up", time: T0, stationId: "madrid", satelliteId: "iss" }
    ]);
    assert.deepEqual(events.map((event) => [event.id, event.kind, event.colorToken, event.metadata.stationId, event.metadata.satelliteId]), [
        ["pass:p0:aos", "pass-aos", "purple", "madrid", "iss"],
        ["pass:p0:max", "pass-maximum", "emerald", "madrid", "iss"]
    ]);
    assert.equal(events[1].metadata.elevationDeg, 61.5);
});

test("resource adapter only emits explicit expiry or explicitly-mapped validity endpoints", () => {
    const events = buildPlannerResourceEvents([
        {
            id: "erp-primary",
            resourceType: "erp",
            name: "ERP validado",
            expiresAt: "2026-09-01T00:00:00Z",
            validityEnd: "2026-08-31T00:00:00Z",
            coverageEnd: "2026-08-30T00:00:00Z"
        },
        {
            id: "sp3-no-inference",
            resourceType: "sp3",
            coverageEnd: "2026-08-20T00:00:00Z"
        },
        {
            id: "oem-invalid",
            resourceType: "oem",
            expiresAt: "invalid"
        },
        {
            id: "layer-1",
            resourceType: "imported-layer",
            validityEnd: "2026-08-19T00:00:00Z"
        }
    ]);
    assert.deepEqual(events.map((event) => [event.id, event.kind, event.colorToken, event.metadata.resourceId]), [
        ["resource:layer:layer-1:validity-end", "layer-validity-end", "amber", "layer-1"],
        ["resource:erp:erp-primary:validity-end", "erp-validity-end", "amber", "erp-primary"],
        ["resource:erp:erp-primary:expiry", "erp-expiry", "rose", "erp-primary"]
    ]);
});

test("planner exposes factual EOP source intervals under one hideable IERS layer", () => {
    const events = buildPlannerEopCoverageEvents({
        details: {
            coverageTimeline: [
                {
                    kind: "iers-c01",
                    start: "2026-07-01T00:00:00Z",
                    end: "2026-07-20T00:00:00Z",
                    source: "IERS C01",
                    quality: "final"
                },
                {
                    kind: "finals2000A",
                    start: "2026-07-20T00:00:00Z",
                    end: "2026-08-15T00:00:00Z",
                    source: "IERS finals2000A",
                    quality: "predicted"
                },
                {
                    kind: "linear-extrapolation",
                    start: "2026-08-15T00:00:00Z",
                    end: "2026-09-14T00:00:00Z",
                    quality: "extrapolated"
                },
                {
                    kind: "nominal-fallback",
                    start: "2026-09-14T00:00:00Z",
                    end: null,
                    quality: "approximate"
                }
            ]
        }
    });

    assert.deepEqual(events.map((event) => [
        event.kind,
        event.start,
        event.end,
        event.metadata.quality,
        event.colorToken,
        event.metadata.eopVisualState,
        event.metadata.eopColorToken,
        event.metadata.requiresAttention,
        event.metadata.eopRange
    ]), [
        ["iers-c01-coverage", "2026-07-01T00:00:00.000Z", "2026-07-20T00:00:00.000Z", "final", "emerald", "normal", "emerald", false, true],
        ["finals2000a-coverage", "2026-07-20T00:00:00.000Z", "2026-08-15T00:00:00.000Z", "predicted", "rose", "predicted", "rose", true, true],
        ["erp-linear-extrapolation", "2026-08-15T00:00:00.000Z", "2026-09-14T00:00:00.000Z", "extrapolated", "rose", "degraded", "rose", true, true],
        ["erp-nominal-fallback", "2026-09-14T00:00:00.000Z", "2026-09-14T00:00:00.000Z", "approximate", "rose", "degraded", "rose", true, false]
    ]);
    assert.ok(events.every((event) => event.metadata.layerId === PLANNER_EOP_LAYER_ID));
    assert.equal(events.at(-1).metadata.openEnded, true);
    assert.match(events.at(-1).metadata.description, /No es una muestra ERP ni un dato IERS/);
    assert.equal(events.some((event) => /expiry/.test(event.kind)), false);
    assert.deepEqual(buildPlannerEopCoverageLayer({
        details: {
            coverageTimeline: [{
                kind: "iers-c01",
                start: "2026-07-01T00:00:00Z",
                end: "2026-07-20T00:00:00Z"
            }]
        }
    }), {
        id: PLANNER_EOP_LAYER_ID,
        name: "IERS ERP Time",
        type: "SYSTEM",
        sourceId: PLANNER_EOP_LAYER_ID,
        active: true,
        visible: true,
        sourceFormat: "EOP",
        sourceOrigin: "IERS",
        validation: "diagnostics-coverage-timeline"
    });
});

test("planner resolves overlapping C01/finals availability into one preferred route", () => {
    const intervals = resolvePlannerEopCoverageIntervals({
        coverageTimeline: [
            {
                kind: "iers-c01",
                start: "2026-06-01T00:00:00Z",
                end: "2026-07-20T00:00:00Z",
                source: "IERS C01",
                quality: "final"
            },
            {
                kind: "iers-finals2000a",
                start: "2026-07-01T00:00:00Z",
                end: "2026-07-15T00:00:00Z",
                source: "IERS finals2000A",
                quality: "final"
            },
            {
                kind: "iers-finals2000a",
                start: "2026-07-15T00:00:00Z",
                end: "2026-08-01T00:00:00Z",
                source: "IERS finals2000A",
                sourceUrl: "https://datacenter.iers.org/products/eop/rapid/standard/finals2000A.all",
                quality: "rapid",
                qualityLabel: "Bulletin A rapid"
            }
        ]
    });

    assert.deepEqual(intervals.map(({ kind, start, end, quality }) => [kind, start, end, quality]), [
        ["iers-c01", "2026-06-01T00:00:00.000Z", "2026-07-20T00:00:00.000Z", "final"],
        ["finals2000a", "2026-07-20T00:00:00.000Z", "2026-08-01T00:00:00.000Z", "rapid"]
    ]);
    const events = buildPlannerEopCoverageEvents({ coverageTimeline: intervals });
    assert.equal(events.length, 2);
    assert.equal(events[1].metadata.sourceUrl, "https://datacenter.iers.org/products/eop/rapid/standard/finals2000A.all");
    assert.equal(events[1].metadata.qualityLabel, "Bulletin A rapid");
    assert.equal(events[1].colorToken, "amber");
    assert.equal(events[1].metadata.eopVisualState, "ok");
    assert.equal(events[1].metadata.eopColorToken, "amber");
    assert.equal(events[1].metadata.requiresAttention, false);
    assert.equal(events.some((event) => /coverage-end|extrapolation-start/.test(event.kind)), false);
});

test("planner merges contiguous EOP intervals with one visual state and preserves their individual provenance", () => {
    const events = buildPlannerEopCoverageEvents({
        coverageTimeline: [
            {
                kind: "iers-c01",
                start: "2026-06-25T00:00:00Z",
                end: "2026-07-01T00:00:00Z",
                quality: "final",
                qualityLabel: "IERS C01 final"
            },
            {
                kind: "iers-finals2000a",
                start: "2026-07-01T00:00:00Z",
                end: "2026-07-10T00:00:00Z",
                quality: "final",
                qualityLabel: "Bulletin B final"
            },
            {
                kind: "iers-finals2000a",
                start: "2026-07-10T00:00:00Z",
                end: "2026-07-20T00:00:00Z",
                quality: "rapid",
                qualityLabel: "Bulletin A rapid"
            },
            {
                kind: "iers-finals2000a",
                start: "2026-07-20T00:00:00Z",
                end: "2026-08-01T00:00:00Z",
                quality: "P",
                qualityLabel: "Bulletin A prediction"
            },
            {
                kind: "linear-extrapolation",
                start: "2026-08-01T00:00:00Z",
                end: "2026-08-15T00:00:00Z",
                quality: "extrapolated"
            }
        ]
    });

    assert.deepEqual(events.map((event) => [
        event.start,
        event.end,
        event.metadata.quality,
        event.metadata.qualityLabel,
        event.colorToken,
        event.metadata.eopVisualState,
        event.metadata.eopColorToken,
        event.metadata.requiresAttention
    ]), [
        ["2026-06-25T00:00:00.000Z", "2026-07-01T00:00:00.000Z", "final", "IERS C01 final", "emerald", "normal", "emerald", false],
        ["2026-07-01T00:00:00.000Z", "2026-07-20T00:00:00.000Z", "final / rapid", "Bulletin B final · Bulletin A rapid", "amber", "ok", "amber", false],
        ["2026-07-20T00:00:00.000Z", "2026-08-01T00:00:00.000Z", "P", "Bulletin A prediction", "rose", "predicted", "rose", true],
        ["2026-08-01T00:00:00.000Z", "2026-08-15T00:00:00.000Z", "extrapolated", undefined, "rose", "degraded", "rose", true]
    ]);
    assert.equal(events.length, 4, "the green C01, red prediction and degraded red boundaries remain separate");
    assert.equal(events[1].title, "IERS finals2000A · Calidad publicada");
    assert.equal(events[1].metadata.eopSegmentCount, 2);
    assert.deepEqual(events[1].metadata.eopSegments.map((segment) => [
        segment.quality,
        segment.qualityLabel,
        segment.range.start,
        segment.range.end
    ]), [
        ["final", "Bulletin B final", "2026-07-01T00:00:00.000Z", "2026-07-10T00:00:00.000Z"],
        ["rapid", "Bulletin A rapid", "2026-07-10T00:00:00.000Z", "2026-07-20T00:00:00.000Z"]
    ]);
    assert.match(events[1].metadata.description, /2 tramos contiguos/);
    assert.equal(events[2].end, events[3].start, "prediction and extrapolation are adjacent");
    assert.notEqual(events[2].metadata.eopVisualState, events[3].metadata.eopVisualState, "same red colour is not enough to merge a changed state");
});

test("layer adapter emits only recorded import facts and actual TLE epochs", () => {
    const events = buildPlannerLayerEvents([
        {
            id: "sat:custom",
            sourceId: "custom",
            name: "Custom TLE",
            active: true,
            sourceFormat: "TLE",
            sourceOrigin: "CUSTOM",
            importFileName: "operator-upload.tle",
            importedAt: T1,
            tleEpoch: T0,
            validityEnd: T2
        },
        // `updatedAt` alone is deliberately not an import fact, and neither
        // an arbitrary epoch nor a hidden inactive layer must leak through.
        {
            id: "sat:catalog",
            name: "Catalog TLE",
            active: true,
            sourceFormat: "TLE",
            updatedAt: T1
        },
        {
            id: "sat:sp3",
            name: "SP3",
            active: true,
            sourceFormat: "SP3",
            tleEpoch: T0
        },
        {
            id: "sat:inactive",
            name: "Inactive",
            active: false,
            sourceFormat: "TLE",
            importedAt: T0,
            tleEpoch: T1
        }
    ]);

    assert.deepEqual(events.map((event) => [event.id, event.kind, event.colorToken, event.metadata.layerId]), [
        ["layer:sat:custom:tle-epoch", "tle-epoch", "blue", "sat:custom"],
        ["layer:sat:custom:imported", "layer-imported", "cyan", "sat:custom"]
    ]);
    assert.match(events[0].metadata.description, /No expresa una fecha de caducidad/i);
    assert.match(events[1].metadata.description, /operator-upload\.tle/);
    assert.equal(events[1].metadata.importedAt, T1);
});

test("range filtering uses a half-open UTC interval and retains events spanning it", () => {
    const events = [
        manual("crosses", "2026-08-17T09:00:00Z", "2026-08-17T11:00:00Z"),
        normalizePlannerEvent({ id: "at-start", kind: "pass-aos", time: T0 }),
        normalizePlannerEvent({ id: "at-end", kind: "pass-los", time: T1 }),
        manual("outside", T1, T2)
    ];
    const inRange = filterPlannerEventsByRange(events, T0, T1);
    assert.deepEqual(inRange.map((event) => event.id), ["crosses", "at-start"]);
    assert.equal(plannerEventIntersectsRange(events[2], T0, T1), false);
});

test("overlap helpers distinguish adjacent events while packing real conflicts into stable lanes", () => {
    const first = manual("first", T0, T1);
    const second = manual("second", "2026-08-17T10:30:00Z", T2);
    const adjacent = manual("adjacent", T1, T2);
    const pointAtEnd = normalizePlannerEvent({ id: "point", kind: "pass-aos", time: T1 });
    assert.equal(plannerEventsOverlap(first, second), true);
    assert.equal(plannerEventsOverlap(first, adjacent), false);
    assert.equal(plannerEventsOverlap(first, pointAtEnd), true);

    const layout = layoutPlannerEventLanes([first, second, adjacent]);
    assert.deepEqual(layout.map(({ event, lane, laneCount, overlapGroup }) => [event.id, lane, laneCount, overlapGroup]), [
        ["first", 0, 2, 0],
        ["second", 1, 2, 0],
        ["adjacent", 0, 2, 0]
    ]);
});

test("nearby pass instants reserve the visual lanes used by day and week cards", () => {
    // Timed cards intentionally render point facts with a 30-minute minimum
    // height so they remain readable. The lane assignment must use that same
    // visual interval: AOS, maximum elevation and LOS can be minutes apart
    // while their cards still overlap on the time grid.
    const aos = normalizePlannerEvent({ id: "pass-aos", kind: "pass-aos", time: "2026-08-23T14:20:00Z" });
    const maximum = normalizePlannerEvent({ id: "pass-maximum", kind: "pass-maximum", time: "2026-08-23T14:25:00Z" });
    const los = normalizePlannerEvent({ id: "pass-los", kind: "pass-los", time: "2026-08-23T14:30:00Z" });
    const following = normalizePlannerEvent({ id: "following-pass", kind: "pass-aos", time: "2026-08-23T15:00:00Z" });

    const layout = layoutPlannerEventLanes([following, los, maximum, aos], {
        minimumDurationMs: 30 * 60 * 1000
    });
    assert.deepEqual(layout.map(({ event, lane, laneCount, overlapGroup }) => [event.id, lane, laneCount, overlapGroup]), [
        ["pass-aos", 0, 3, 0],
        ["pass-maximum", 1, 3, 0],
        ["pass-los", 2, 3, 0],
        ["following-pass", 0, 1, 1]
    ]);

    // The next point begins precisely when the LOS card's minimum visual
    // interval ends, so columns may be reused without making them touch.
    assert.deepEqual(layoutPlannerEventLanes([aos, maximum]).map(({ event, lane, laneCount }) => [event.id, lane, laneCount]), [
        ["pass-aos", 0, 1],
        ["pass-maximum", 0, 1]
    ], "the semantic/default layout remains available to non-visual consumers");
});

test("visual lanes clip a crossing event before applying the minimum card footprint", () => {
    const crossingMidnight = manual("crossing-midnight", "2026-08-22T23:50:00Z", "2026-08-23T00:05:00Z");
    const nextPoint = normalizePlannerEvent({ id: "next-point", kind: "pass-maximum", time: "2026-08-23T00:20:00Z" });
    const range = { start: "2026-08-23T00:00:00Z", end: "2026-08-24T00:00:00Z" };
    const layout = layoutPlannerEventLanes([crossingMidnight, nextPoint], {
        minimumDurationMs: 30 * 60 * 1000,
        range
    });

    assert.deepEqual(layout.map(({ event, lane, laneCount }) => [event.id, lane, laneCount]), [
        ["crossing-midnight", 0, 2],
        ["next-point", 1, 2]
    ]);
    assert.equal(new Date(layout[0].layoutStartMs).toISOString(), "2026-08-23T00:00:00.000Z");
    assert.equal(new Date(layout[0].layoutEndMs).toISOString(), "2026-08-23T00:30:00.000Z");
});

test("day, week and month helpers use UTC boundaries across a local DST transition", () => {
    const event = normalizePlannerEvent({
        id: "dst-pass",
        kind: "pass-maximum",
        time: "2026-03-29T23:30:00.000Z"
    });
    const day = getPlannerDayLayout([event], "2026-03-29T23:30:00.000Z");
    assert.equal(day.range.start, "2026-03-29T00:00:00.000Z");
    assert.equal(day.range.end, "2026-03-30T00:00:00.000Z");
    assert.equal(day.events[0].topPercent, (23.5 / 24) * 100);

    const week = getPlannerWeekLayout([event], "2026-03-29T23:30:00.000Z");
    assert.equal(week.range.start, "2026-03-23T00:00:00.000Z");
    assert.equal(week.days.length, 7);
    assert.equal(week.days[6].events[0].event.id, "dst-pass");

    const month = getPlannerMonthLayout([event], "2026-02-10T00:00:00.000Z");
    assert.equal(month.month.year, 2026);
    assert.equal(month.month.month, 2);
    assert.equal(month.weeks.length, 5, "February still yields a complete planner grid");
    assert.equal(month.weeks.flatMap((weekEntry) => weekEntry.days).length, 35);
});

test("planner state is strict about status but keeps independently valid event facts with source errors", () => {
    const ready = normalizePlannerState({
        status: "ready",
        updatedAt: T0,
        events: [manual("ok")],
        errors: ["ERP pendiente"]
    });
    assert.equal(ready.status, "ready");
    assert.equal(ready.events.length, 1);
    assert.equal(ready.updatedAt, T0);
    assert.deepEqual(ready.errors, ["ERP pendiente"]);

    const invalid = normalizePlannerState({
        status: "unexpected",
        updatedAt: "not-a-time",
        events: [manual("must-not-leak")]
    });
    assert.equal(invalid.status, "error");
    assert.deepEqual(invalid.events, []);
    assert.equal(invalid.updatedAt, null);
    assert.match(invalid.errors[0], /Estado del planificador no válido/);
});
