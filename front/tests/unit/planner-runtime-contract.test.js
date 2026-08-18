import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
const lifecycleSource = readFileSync(new URL("../../js/runtime/projectLifecycle.js", import.meta.url), "utf8");

test("planner runtime consumes cached diagnostics and republishes canonical state for late panels", () => {
    assert.match(mainSource, /plannerRemoteDiagnostics = window\.__orbitDiagnosticsState \?\? null/);
    assert.match(mainSource, /plannerLocalDiagnostics = window\.__orbitDiagnosticsLocalState \?\? null/);
    assert.match(mainSource, /window\.__orbitPlannerState = detail/);
    assert.match(mainSource, /window\.addEventListener\("orbit:planner-state-request"/);
    assert.match(mainSource, /new CustomEvent\(PLANNER_STATE_EVENT, \{ detail: window\.__orbitPlannerState \}\)/);
    assert.match(mainSource, /window\.addEventListener\(GROUND_STATION_TIMELINE_EVENTS_EVENT, syncPlannerPassSource\)/);
    assert.match(mainSource, /window\.addEventListener\(DIAGNOSTICS_STATE_EVENT, syncPlannerRemoteDiagnostics\)/);
});

test("planner runtime keeps authored mutations separate and activation fails closed at the temporal boundary", () => {
    assert.match(mainSource, /PLANNER_MANUAL_EVENT_UPSERT_EVENT, upsertPlannerManualEvent/);
    assert.match(mainSource, /PLANNER_MANUAL_EVENT_REMOVE_EVENT, removePlannerManualEvent/);
    assert.match(mainSource, /window\.addEventListener\("orbit:planner-event-activate", activatePlannerEvent\)/);
    assert.match(mainSource, /getMasterTimeRange\(\) && !isInsideMasterRange\(target\)/);
    assert.match(mainSource, /type: "timeline-jump", value: \{ time: target\.toISOString\(\) \}/);
    assert.match(lifecycleSource, /getPlannerManualEvents = \(\) => \[\], restorePlannerManualEvents/);
    assert.match(lifecycleSource, /plannerEvents: getPlannerManualEvents\(\)/);
    assert.match(lifecycleSource, /clearPlannerManualEvents\(\)/);
    assert.match(lifecycleSource, /normalizeProjectPlannerEvents\(project\.plannerEvents\)/);
});

test("planner forecast is scene-wide, bounded, visibility-aware and isolated from the selected timeline", () => {
    assert.match(mainSource, /const PLANNER_PASS_FORECAST_MAX_CONCURRENCY = 2/);
    assert.match(mainSource, /collectGroundStationTimelinePairs\(\{ kind: "planner" \}, range\)/);
    assert.match(mainSource, /groundStationTimelinePairCache\.get\(pair\.cacheKey\)/);
    assert.match(mainSource, /groundStationTimelinePairCache\.set\(pair\.cacheKey, result\)/);
    assert.match(mainSource, /Math\.min\(PLANNER_PASS_FORECAST_MAX_CONCURRENCY, pending\.length\)/);
    assert.match(mainSource, /filterGroundStationPassTimelineEvents\(events, isGroundStationTimelinePairVisible\)/);
    assert.match(mainSource, /plannerPassForecast\.failures = \[\.\.\.plannerPassForecastPairFailures\.values\(\)\]/);
    assert.match(mainSource, /for \(const failure of passSource\.failures \|\| \[\]\)/);
    assert.match(mainSource, /window\.addEventListener\("orbit:planner-open", requestPlannerPassForecast\)/);
    assert.match(mainSource, /window\.addEventListener\("orbit:planner-close", closePlannerPassForecast\)/);
    assert.match(mainSource, /window\.addEventListener\("orbit:planner-state-request", \(\) => \{[\s\S]*requestPlannerPassForecast\(\)/);
    assert.match(mainSource, /function plannerPassAggregate\(\)[\s\S]*plannerPassForecastOpen \? plannerPassForecast : plannerPassSource/);

    const forecastStart = mainSource.indexOf("async function refreshPlannerPassForecast");
    const forecastEnd = mainSource.indexOf("function requestPlannerPassForecast", forecastStart);
    assert.ok(forecastStart >= 0 && forecastEnd > forecastStart, "planner forecast implementation must exist");
    const forecastSource = mainSource.slice(forecastStart, forecastEnd);
    assert.doesNotMatch(forecastSource, /publishGroundStationTimelineEvents/, "planner work must not replace selected timeline markers");
    assert.match(forecastSource, /beginRuntimeSceneOperation\("planner-pass-forecast"/);
    assert.match(forecastSource, /plannerPassForecastPairResults\.clear\(\)/, "cancellation discards partial planner results");
});
