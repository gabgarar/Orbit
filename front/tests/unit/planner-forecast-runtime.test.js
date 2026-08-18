import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");

function sourceBetween(startMarker, endMarker) {
    const start = mainSource.indexOf(startMarker);
    const end = mainSource.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(start, -1, `missing ${startMarker}`);
    assert.notEqual(end, -1, `missing ${endMarker}`);
    return mainSource.slice(start, end);
}

test("planner forecast exposes all-pair progress without replacing the selected timeline", () => {
    const refresh = sourceBetween(
        "async function refreshPlannerPassForecast",
        "function requestPlannerPassForecast"
    );

    assert.match(refresh, /collectGroundStationTimelinePairs\(\{ kind: "planner" \}, range\)/);
    assert.match(refresh, /Math\.min\(PLANNER_PASS_FORECAST_MAX_CONCURRENCY, pending\.length\)/);
    assert.match(refresh, /beginRuntimeSceneOperation\("planner-pass-forecast"/);
    assert.match(refresh, /plannerPassForecastPairResults\.clear\(\)/);
    assert.doesNotMatch(refresh, /publishGroundStationTimelineEvents/);
});

test("planner forecast filters cached endpoints and keeps partial failures observable", () => {
    const visibleEvents = sourceBetween(
        "function plannerPassForecastVisibleEvents",
        "function plannerPassForecastKey"
    );
    const publication = sourceBetween(
        "function publishPlannerPassForecast",
        "function cancelPlannerPassForecast"
    );
    const errors = sourceBetween(
        "function plannerSourceErrors()",
        "function plannerContext()"
    );

    assert.match(visibleEvents, /filterGroundStationPassTimelineEvents\(events, isPlannerGroundStationTimelinePairVisible\)/);
    assert.match(publication, /plannerPassForecast\.failures = \[\.\.\.plannerPassForecastPairFailures\.values\(\)\]/);
    assert.match(errors, /for \(const failure of passSource\.failures \|\| \[\]\)/);
    assert.match(errors, /passSource === plannerPassForecast[\s\S]*?!isPlannerGroundStationTimelinePairVisible\(/);
    assert.match(errors, /const reason = plannerText\(failure\?\.reason\)/);
});

test("planner republishes cached forecast facts immediately when either endpoint visibility changes", () => {
    const stationVisibility = sourceBetween(
        "applyGroundStationVisibility: (station, visible) =>",
        "function getLayerDisplayName"
    );
    const layerVisibility = sourceBetween(
        "function setCompositeLayerVisibility(layerId, visible)",
        "function isCompositeLayerActive"
    );

    assert.match(stationVisibility, /syncPlannerPassForecastVisibility\(\)/);
    assert.match(layerVisibility, /syncPlannerPassForecastVisibility\(\)/);
});

test("planner-only layer filters do not narrow collection work and republish cached events", () => {
    const refresh = sourceBetween(
        "async function refreshPlannerPassForecast",
        "function requestPlannerPassForecast"
    );
    assert.match(refresh, /Planner filters are presentation-only/);
    assert.match(refresh, /collectGroundStationTimelinePairs\(\{ kind: "planner" \}, range\)/);
    assert.doesNotMatch(refresh, /respectPlannerLayerFilters/);
    assert.match(mainSource, /window\.addEventListener\("orbit:planner-layer-filter", updatePlannerLayerFilter\)/);
    assert.match(mainSource, /plannerHiddenLayerIds: getPlannerHiddenLayerIdsForProject\(\)/);
});

test("planner lifecycle starts from open or late state request and cancels on close/range/project boundaries", () => {
    assert.match(mainSource, /window\.addEventListener\("orbit:planner-open", requestPlannerPassForecast\)/);
    assert.match(mainSource, /window\.addEventListener\("orbit:planner-close", closePlannerPassForecast\)/);
    assert.match(mainSource, /window\.addEventListener\("orbit:planner-state-request", \(\) => \{[\s\S]*?requestPlannerPassForecast\(\)/);
    assert.match(mainSource, /window\.addEventListener\("orbit:simulation-state", syncPlannerPassForecastForSimulationState\)/);
    assert.match(mainSource, /window\.addEventListener\("orbit:scene-operations-cancel", \(\) => \{[\s\S]*?clearPlannerPassForecast/);
});

test("partial failures remain visible without ending a still-running planner forecast", () => {
    const publication = sourceBetween(
        "function publishPlannerState()",
        "function syncPlannerPassSource"
    );

    assert.match(publication, /const status = passSource\.status === "loading"\s*\? "loading"\s*:\s*errors\.length\s*\? "error"\s*:\s*"ready"/);
    assert.match(publication, /events:\s*\[[\s\S]*?buildPlannerPassEvents\(passSource\.events\)/);
});
