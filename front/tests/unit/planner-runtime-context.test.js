import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    assessPlannerForecastRange,
    clampPlannerViewRangeToSimulationDomain,
    defaultPlannerViewRange,
    normalizePlannerHiddenLayerIds,
    normalizePlannerViewRange
} from "../../js/features/planner/plannerRuntimeContext.js";

const START = "2026-08-17T00:00:00.000Z";
const END = "2026-08-24T00:00:00.000Z";

test("planner range is finite UTC and Range mode fails closed outside simulation or MTR", () => {
    const range = normalizePlannerViewRange({ startTime: START, endTime: END, view: "week" });
    assert.deepEqual(range, {
        startDate: new Date(START),
        endDate: new Date(END),
        startTime: START,
        endTime: END,
        view: "week",
        source: "planner-view-range"
    });
    assert.equal(normalizePlannerViewRange({ startTime: END, endTime: START, view: "week" }), null);

    const allowed = assessPlannerForecastRange({
        range,
        mode: "range",
        simulationRange: { startDate: new Date(START), endDate: new Date(END) },
        masterRange: { startDate: new Date(START), endDate: new Date(END) }
    });
    assert.equal(allowed.allowed, true);

    const outsideSimulation = assessPlannerForecastRange({
        range: { startTime: "2026-08-16T23:59:59.000Z", endTime: END, view: "week" },
        mode: "range",
        simulationRange: { startDate: new Date(START), endDate: new Date(END) }
    });
    assert.equal(outsideSimulation.allowed, false);
    assert.match(outsideSimulation.reason, /simulación/i);

    const outsideMtr = assessPlannerForecastRange({
        range,
        mode: "range",
        simulationRange: { startDate: new Date("2026-08-01T00:00:00.000Z"), endDate: new Date("2026-09-01T00:00:00.000Z") },
        masterRange: { startDate: new Date("2026-08-18T00:00:00.000Z"), endDate: new Date("2026-08-23T00:00:00.000Z") }
    });
    assert.equal(outsideMtr.allowed, false);
    assert.match(outsideMtr.reason, /MTR/);
});

test("static and realtime accept a visible finite UTC interval without a moving horizon", () => {
    const range = { startTime: START, endTime: END, view: "week" };
    for (const mode of ["static", "realtime"]) {
        const assessment = assessPlannerForecastRange({ range, mode });
        assert.equal(assessment.allowed, true, mode);
        assert.equal(assessment.range.startTime, START);
        assert.equal(assessment.range.endTime, END);
    }
    assert.deepEqual(defaultPlannerViewRange(new Date("2026-08-19T14:00:00.000Z")), {
        startDate: new Date(START),
        endDate: new Date(END),
        startTime: START,
        endTime: END,
        view: "week",
        source: "planner-view-range"
    });
});

test("a whole calendar period clips safely to a short simulated/MTR domain without inventing dates", () => {
    const requested = {
        view: "month",
        startTime: "1974-01-01T00:00:00.000Z",
        endTime: "1974-02-01T00:00:00.000Z"
    };
    const domain = {
        startDate: new Date("1974-01-01T06:00:00.000Z"),
        endDate: new Date("1974-01-02T18:00:00.000Z")
    };
    const clipped = clampPlannerViewRangeToSimulationDomain({
        range: requested,
        mode: "range",
        simulationRange: domain,
        masterRange: domain
    });
    assert.equal(clipped.clamped, true);
    assert.equal(clipped.range.startTime, "1974-01-01T06:00:00.000Z");
    assert.equal(clipped.range.endTime, "1974-01-02T18:00:00.000Z");
    assert.equal(clipped.range.view, "month");
    assert.equal(clipped.range.source, "planner-view-range-clamped");
    assert.equal(assessPlannerForecastRange({
        range: clipped.range,
        mode: "range",
        simulationRange: domain,
        masterRange: domain
    }).allowed, true);

    const outside = clampPlannerViewRangeToSimulationDomain({
        range: { view: "week", startTime: "1974-02-05T00:00:00.000Z", endTime: "1974-02-12T00:00:00.000Z" },
        mode: "range",
        simulationRange: domain,
        masterRange: domain
    });
    assert.equal(outside.range, null);
    assert.equal(outside.domain.startTime, "1974-01-01T06:00:00.000Z");
    assert.match(outside.reason, /no intersecta/i);
});

test("planner hidden layer ids are compact project state, not a scene mutation", () => {
    assert.deepEqual(normalizePlannerHiddenLayerIds([
        "station:legacy", "sat:one", "station:legacy", "", 42, "x".repeat(1025)
    ]), ["station:legacy", "sat:one"]);
});

test("main runtime wires explicit view/filter events and keeps static/realtime activation fail-closed", () => {
    const mainSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
    assert.match(mainSource, /window\.addEventListener\("orbit:planner-view-range", updatePlannerPassForecastViewRange\)/);
    assert.match(mainSource, /window\.addEventListener\("orbit:planner-layer-filter", updatePlannerLayerFilter\)/);
    assert.match(mainSource, /Planner filters are presentation-only[\s\S]*collectGroundStationTimelinePairs\(\{ kind: "planner" \}, range\)/);
    assert.match(mainSource, /plannerHiddenLayerIds: getPlannerHiddenLayerIdsForProject\(\)/);
    assert.match(mainSource, /event\?\.kind === PLANNER_EVENT_KINDS\.MANUAL\) return true/);
    assert.match(mainSource, /if \(simulationState\.mode !== SIMULATION_MODE_RANGE\)[\s\S]*La agenda no mueve la escena/);
    assert.match(mainSource, /simulationState\.mode === SIMULATION_MODE_RANGE[\s\S]*String\(simulationState\.mode \|\| ""\)/);
    assert.match(mainSource, /clampPlannerViewRangeToSimulationDomain\(/);
    assert.match(mainSource, /orbit:planner-view-range-rebase/);
});
