import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");

function sourceBetween(startMarker, endMarker) {
    const start = runtimeSource.indexOf(startMarker);
    const end = runtimeSource.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(start, -1, `missing ${startMarker}`);
    assert.notEqual(end, -1, `missing ${endMarker}`);
    return runtimeSource.slice(start, end);
}

test("a selected visible station schedules every active visible satellite, while a selected satellite schedules every visible station", () => {
    const collection = sourceBetween(
        "function collectGroundStationTimelinePairs(selection, range)",
        "function isCurrentGroundStationTimelineRequest"
    );

    assert.match(collection, /getCompositeLayerIds\(\)/);
    assert.match(collection, /isCompositeLayerActive\(id\)\s*&&\s*getCompositeLayerVisibility\(id\)\s*===\s*true/);
    assert.match(collection, /const stations\s*=\s*\[\.\.\.groundStationLayers\.values\(\)\]\.filter\(\(station\)\s*=>\s*station\?\.visible\s*===\s*true\)/);
    assert.match(collection, /selection\.kind\s*===\s*"station"[\s\S]*?satelliteLayerIds\.map/);
    assert.match(collection, /:\s*stations\.map\(\(station\)\s*=>\s*\(\{\s*station,\s*satelliteLayerId:\s*selection\.id\s*\}\)\)/);
});

test("aggregate access forecast is range-only, bounded, cancellable, and never asks for chart samples", () => {
    const refresh = sourceBetween(
        "async function refreshGroundStationTimelinePasses()",
        "function syncGroundStationTimelineSelection()"
    );
    const collection = sourceBetween(
        "function collectGroundStationTimelinePairs(selection, range)",
        "function isCurrentGroundStationTimelineRequest"
    );

    assert.match(runtimeSource, /function getGroundStationTimelineRange\(\)\s*\{[\s\S]*?simulationState\.mode\s*!==\s*SIMULATION_MODE_RANGE/);
    assert.match(collection, /includeSamples:\s*false/);
    assert.match(refresh, /GROUND_STATION_TIMELINE_MAX_CONCURRENCY/);
    assert.match(refresh, /new AbortController\(\)/);
    assert.match(refresh, /beginRuntimeSceneOperation\("ground-station-timeline"/);
    assert.match(refresh, /cancelWork:[\s\S]*?controller\.abort\(\)/);
    assert.match(refresh, /cancelWork:[\s\S]*?groundStationTimelinePairResults\.clear\(\)/,
        "cancelling the aggregate operation must not leave partial forecast markers behind");
    assert.match(refresh, /cancelWork:[\s\S]*?publishGroundStationTimelineEvents\(/,
        "cancelling the aggregate operation must clear the public timeline state");
    assert.match(refresh, /completeRuntimeSceneOperation\(operationId/);
    assert.match(refresh, /failRuntimeSceneOperation\(operationId/);
    assert.match(refresh, /cancelRuntimeSceneOperation\(operationId/);
});

test("hidden endpoints are filtered and re-published immediately from cached pair events", () => {
    const events = sourceBetween(
        "function isGroundStationTimelinePairVisible",
        "function cancelGroundStationTimelinePasses"
    );
    const selection = sourceBetween(
        "function syncGroundStationTimelineSelection()",
        "// The simulation state is published"
    );
    const visibility = sourceBetween(
        "function setCompositeLayerVisibility(layerId, visible)",
        "function isCompositeLayerActive(layerId)"
    );
    const groundStationApply = sourceBetween(
        "applyGroundStationVisibility: (station, visible) =>",
        "function getLayerDisplayName"
    );

    assert.match(events, /filterGroundStationPassTimelineEvents\(events, isGroundStationTimelinePairVisible\)/);
    assert.match(events, /station\?\.visible\s*===\s*true/);
    assert.match(events, /getCompositeLayerVisibility\(satelliteLayerId\)\s*===\s*true/);
    assert.match(selection, /nextKey\s*===\s*groundStationTimelineContextKey[\s\S]*?publishGroundStationTimelineEvents/);
    assert.doesNotMatch(selection, /nextKey\s*===\s*groundStationTimelineContextKey[\s\S]*?fetch\(/);
    assert.match(visibility, /syncGroundStationTimelineSelection\(\)/);
    assert.match(groundStationApply, /syncGroundStationTimelineSelection\(\)/);
});

test("obsolete range/selection work is invalidated, while OEM and out-of-range finite sources are skipped safely", () => {
    const collection = sourceBetween(
        "function collectGroundStationTimelinePairs(selection, range)",
        "function isCurrentGroundStationTimelineRequest"
    );
    const refresh = sourceBetween(
        "async function refreshGroundStationTimelinePasses()",
        "function syncGroundStationTimelineSelection()"
    );
    const stateSync = sourceBetween(
        "function syncGroundStationTimelineForSimulationState()",
        "window.addEventListener(\"orbit:simulation-state\""
    );

    assert.match(collection, /sourceFormat\s*===\s*"OEM"/);
    assert.match(collection, /assessFiniteEphemerisAnalysisRange\(/);
    assert.match(collection, /finiteEphemerisAnalysisRangeMessage\(/);
    assert.match(refresh, /cancelGroundStationTimelinePasses\("La selecci/);
    assert.match(refresh, /groundStationTimelineRequestSequence/);
    assert.match(stateSync, /groundStationTimelineObservedSimulationKey/);
    assert.match(stateSync, /syncGroundStationTimelineSelection\(\)/);
});

test("cache restores an already calculated pair after re-showing it and is invalidated at source/project boundaries", () => {
    const refresh = sourceBetween(
        "async function refreshGroundStationTimelinePasses()",
        "function syncGroundStationTimelineSelection()"
    );
    const lifecycle = sourceBetween(
        "function clearGroundStationTimelinePasses",
        "function timelinePairFailure"
    );

    assert.match(refresh, /groundStationTimelinePairCache\.get\(pair\.cacheKey\)/);
    assert.match(refresh, /groundStationTimelinePairCache\.set\(pair\.cacheKey, result\)/);
    assert.match(lifecycle, /groundStationTimelinePairCache\.clear\(\)/);
    assert.match(runtimeSource, /window\.addEventListener\("orbit:scene-operations-cancel"[\s\S]*?clearCache:\s*true/);
    assert.match(runtimeSource, /window\.addEventListener\("orbit:object-state-changed"[\s\S]*?invalidateGroundStationTimelineCache/);
});

test("new station/satellite membership rebuilds the affected selected pair set while eyes remain cache-only", () => {
    const membership = sourceBetween(
        "function refreshGroundStationTimelineForLayerMembershipChange",
        "// The simulation state is published"
    );
    const creation = sourceBetween(
        "function createGroundStationLayer(params = {})",
        "function getGroundStationParams"
    );
    const duplicate = sourceBetween(
        "function duplicateSatelliteLayer(sourceId)",
        "function renameLayer"
    );
    const removal = sourceBetween(
        "function removeGroundStationLayer(layerId)",
        "function setCompositeLayerActive"
    );
    const objectStateListener = sourceBetween(
        "window.addEventListener(\"orbit:object-state-changed\"",
        "function formatObjectTimeRangeHours"
    );

    assert.match(membership, /selected\.kind\s*===\s*"station"\s*&&\s*normalizedKind\s*===\s*"satellite"/);
    assert.match(membership, /selected\.kind\s*===\s*"satellite"\s*&&\s*normalizedKind\s*===\s*"station"/);
    assert.match(membership, /allSatelliteLayers\s*===\s*true/);
    assert.match(membership, /void refreshGroundStationTimelinePasses\(\)/);
    assert.match(creation, /refreshGroundStationTimelineForLayerMembershipChange\(\{ layerId: stationId, kind: "station" \}\)/);
    assert.match(duplicate, /refreshGroundStationTimelineForLayerMembershipChange\(\{ layerId, kind: "satellite" \}\)/);
    assert.match(removal, /layerType: "GROUND_STATION"/);
    assert.match(objectStateListener, /reason\s*===\s*"activation"/);
    assert.match(objectStateListener, /allSatelliteLayers:\s*detail\.scope\s*===\s*"all-satellites"/);
    assert.match(objectStateListener, /refreshGroundStationTimelineForLayerMembershipChange\(/);
});
