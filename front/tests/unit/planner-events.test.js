import assert from "node:assert/strict";
import test from "node:test";

import {
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
    PLANNER_EVENT_KINDS,
    PLANNER_MANUAL_COLOR_TOKENS,
    PLANNER_MANUAL_EVENT_REMOVE_EVENT,
    PLANNER_MANUAL_EVENT_UPSERT_EVENT,
    PLANNER_STATE_EVENT,
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
