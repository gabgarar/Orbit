import assert from "node:assert/strict";
import test from "node:test";
import {
    buildPlannerCoverageSegments,
    plannerAdjacentVisibleEvent,
    plannerCursorForEvent,
    plannerEventIsInView
} from "../../../react-ui/src/features/planner/plannerCoverageLayout.js";

test("finite EOP coverage becomes one continuous segment per calendar week row, not one clone per day", () => {
    const event = {
        id: "iers-finals-ok",
        start: "2026-08-01T00:00:00.000Z",
        end: "2026-08-18T00:00:00.000Z"
    };
    const segments = buildPlannerCoverageSegments([event], {
        start: "2026-07-27T00:00:00.000Z",
        end: "2026-09-07T00:00:00.000Z",
        columns: 7
    });

    assert.deepEqual(segments.map(({ row, column, span, labelled }) => ({ row, column, span, labelled })), [
        { row: 0, column: 5, span: 2, labelled: true },
        { row: 1, column: 0, span: 7, labelled: false },
        { row: 2, column: 0, span: 7, labelled: false },
        { row: 3, column: 0, span: 1, labelled: false }
    ]);
    assert.equal(segments.filter((segment) => segment.labelled).length, 1);
    assert.ok(segments.length < 17, "the seventeen covered UTC days must not create seventeen buttons");
});

test("a clipped time-grid coverage interval gets one band across the visible day columns", () => {
    const event = {
        id: "iers-finals-prediction",
        start: "2026-08-18T12:00:00.000Z",
        end: "2026-08-23T12:00:00.000Z"
    };
    const segments = buildPlannerCoverageSegments([event], {
        start: "2026-08-17T00:00:00.000Z",
        end: "2026-08-24T00:00:00.000Z",
        columns: 7
    });
    assert.deepEqual(segments.map(({ row, column, span, labelled }) => ({ row, column, span, labelled })), [
        { row: 0, column: 1, span: 6, labelled: true }
    ]);
    assert.equal(segments[0].startFraction, 0.5);
    assert.equal(segments[0].endInsetFraction, 0.5);
});

test("a tiny first coverage fragment stays unlabelled until a readable continuation is available", () => {
    const event = {
        id: "iers-clipped-label",
        start: "2026-08-23T23:45:00.000Z",
        end: "2026-08-31T00:00:00.000Z"
    };
    const segments = buildPlannerCoverageSegments([event], {
        start: "2026-08-17T00:00:00.000Z",
        end: "2026-08-31T00:00:00.000Z",
        columns: 7
    });
    assert.deepEqual(segments.map(({ row, column, span, labelled }) => ({ row, column, span, labelled })), [
        { row: 0, column: 6, span: 1, labelled: false },
        { row: 1, column: 0, span: 7, labelled: true }
    ]);

    const tinyAtViewportStart = buildPlannerCoverageSegments([{
        ...event,
        end: "2026-08-24T00:15:00.000Z"
    }], {
        start: "2026-08-17T00:00:00.000Z",
        end: "2026-08-24T00:00:00.000Z",
        columns: 7
    });
    assert.equal(tinyAtViewportStart.some((segment) => segment.labelled), false);
});

test("detail pager walks the complete filtered stream and exposes a target cursor outside the current viewport", () => {
    const events = [
        { id: "past", start: "2026-08-01T04:00:00.000Z", end: "2026-08-01T04:00:00.000Z" },
        { id: "current", start: "2026-08-18T04:00:00.000Z", end: "2026-08-18T04:00:00.000Z" },
        { id: "future", start: "2026-09-01T04:00:00.000Z", end: "2026-09-01T04:00:00.000Z" }
    ];
    assert.equal(plannerAdjacentVisibleEvent(events, "current", -1)?.id, "past");
    assert.equal(plannerAdjacentVisibleEvent(events, "current", 1)?.id, "future");
    assert.equal(plannerAdjacentVisibleEvent(events, "past", -1), null);
    assert.equal(plannerAdjacentVisibleEvent(events, "future", 1), null);
    assert.equal(plannerEventIsInView(events[2], {
        start: "2026-08-18T00:00:00.000Z",
        end: "2026-08-25T00:00:00.000Z"
    }), false);
    assert.equal(plannerCursorForEvent(events[2])?.toISOString(), "2026-09-01T00:00:00.000Z");
});

test("range membership respects the planner's half-open UTC view bounds", () => {
    const range = { start: "2026-08-17T00:00:00.000Z", end: "2026-08-24T00:00:00.000Z" };
    assert.equal(plannerEventIsInView({ start: "2026-08-16T23:00:00.000Z", end: "2026-08-17T01:00:00.000Z" }, range), true);
    assert.equal(plannerEventIsInView({ start: "2026-08-24T00:00:00.000Z", end: "2026-08-24T00:00:00.000Z" }, range), false);
});
