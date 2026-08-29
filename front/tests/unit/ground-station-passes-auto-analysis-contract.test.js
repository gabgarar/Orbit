import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
    new URL("../../../react-ui/src/components/GroundStationsPanel.jsx", import.meta.url),
    "utf8"
);
const mainSource = readFileSync(
    new URL("../../main.js", import.meta.url),
    "utf8"
);

function sourceNear(pattern, label) {
    const match = source.match(pattern);
    assert.ok(match, `missing ${label}`);
    const start = Math.max(0, (match.index ?? 0) - 220);
    return source.slice(start, (match.index ?? 0) + 900);
}

test("a valid station and satellite selection automatically requests an AOS/LOS analysis", () => {
    // The automatic request must be a selection-driven effect, not a synthetic
    // click on the old manual Analyse button. This also makes an initial pair
    // of Layers immediately useful when the workspace opens.
    assert.match(source, /const automaticAnalysisKey = stationId && satelliteId && stationAnalysisFingerprint\(station\)/);
    assert.match(source, /const requestPassAnalysis = useCallback\([\s\S]{0,600}new CustomEvent\("orbit:ground-stations-analyze",\s*\{\s*detail:\s*\{\s*stationId:\s*nextStationId,\s*satelliteId:\s*nextSatelliteId\s*\}\s*\}\)/);
    assert.match(source, /useEffect\(\(\)\s*=>\s*\{(?=[\s\S]{0,500}!open\s*\|\|\s*!automaticAnalysisKey)(?=[\s\S]{0,1000}requestPassAnalysis\(stationId,\s*satelliteId\))[\s\S]{0,1700}\},\s*\[(?=[^\]]*automaticAnalysisKey)(?=[^\]]*open)(?=[^\]]*stationId)(?=[^\]]*satelliteId)[^\]]*\]\);/);
});

test("changing station or satellite cancels stale work and clears the old pass selection before the automatic refresh", () => {
    const stationChange = sourceNear(/setStationId\((?:nextStationId|event\.target\.value)\)/, "station selection handler");
    const satelliteChange = sourceNear(/setSatelliteId\((?:nextSatelliteId|event\.target\.value)\)/, "satellite selection handler");

    for (const [label, handler] of [["station", stationChange], ["satellite", satelliteChange]]) {
        assert.match(handler, /cancelPendingAnalysis\(\)/, `${label} changes must cancel the obsolete request`);
        assert.match(handler, /setResult\(null\)/, `${label} changes must not retain a result from the previous pair`);
        assert.match(handler, /setSelectedPassIndex\(null\)/, `${label} changes must clear the previous pass focus`);
    }
});

test("a successful result selects the first chronological pass while an empty result selects none", () => {
    const receiveResultStart = source.indexOf("const receiveResult");
    assert.ok(receiveResultStart >= 0, "the analysis-result event handler must exist");
    const receiveResult = source.slice(receiveResultStart, receiveResultStart + 1_800);

    assert.match(receiveResult, /setResult\(detail\);[\s\S]{0,320}setSelectedPassIndex\(\s*(?:detail\?\.passes\?\.length|passes\.length)\s*\?\s*0\s*:\s*null\s*\)/,
        "the elevation profile should open on pass 1 as soon as passes are published");
});

test("technical pass data is expanded, follows the selected pass, and omits irrelevant instantaneous distance", () => {
    assert.match(source, /<details\s+open\b[^>]*data-testid="ground-station-pass-technical-details"[^>]*>/,
        "technical data must be immediately visible when a pass is selected");

    const technicalStart = source.indexOf('data-testid="ground-station-pass-technical-details"');
    assert.ok(technicalStart >= 0, "the technical-pass section must be addressable for UI tests");
    const technical = source.slice(technicalStart, technicalStart + 3_500);
    assert.match(technical, /selectedPass/,
        "technical data must describe the selected pass, not the scene's current instant");
    assert.match(technical, /(?:AOS|LOS)/,
        "technical data must expose the pass boundaries");
    assert.match(technical, /(?:maxElevation|max_elevation_deg)/,
        "technical data must expose useful pass geometry");
    assert.match(technical, /formatPassDuration/,
        "technical data must expose the duration of the selected pass");
    assert.doesNotMatch(source, /Distancia actual/,
        "an instantaneous range is misleading in a pass-focused analysis and must not be shown");
});

test("a scene layer selection is published as the active AOS/LOS target", () => {
    const stateStart = mainSource.indexOf("function publishGroundStationsState");
    const stateEnd = mainSource.indexOf("const GROUND_STATION_IMPORT_ACCEPT", stateStart);
    const statePublisher = mainSource.slice(stateStart, stateEnd);
    assert.match(statePublisher, /const activeStationId = stations\.some/);
    assert.match(statePublisher, /const activeSatelliteId = satellites\.some/);
    assert.match(statePublisher, /detail:\s*\{[\s\S]*activeStationId,[\s\S]*activeSatelliteId,/);

    const selectionStart = mainSource.indexOf("function setCurrentSelectedSatellite");
    const selectionEnd = mainSource.indexOf("// React can mount", selectionStart);
    const selectionPublisher = mainSource.slice(selectionStart, selectionEnd);
    assert.match(selectionPublisher, /publishSelectedLayerState\(\);[\s\S]*publishGroundStationsState\(\);/);
});

test("opening the workspace adopts an already-selected scene layer on its first state refresh", () => {
    const showStart = source.indexOf("const show = () =>");
    assert.ok(showStart >= 0, "the Ground Stations open handler must exist");
    const show = source.slice(showStart, showStart + 950);
    assert.match(show, /openRef\.current = true;[\s\S]*setOpen\(true\);[\s\S]*refresh\(\);/,
        "the synchronous state response must see the panel as open");
});

test("membership and station-contract updates keep an open workspace current without accepting unscoped stale results", () => {
    const stateStart = mainSource.indexOf("function publishGroundStationsState");
    const stateEnd = mainSource.indexOf("const GROUND_STATION_IMPORT_ACCEPT", stateStart);
    const statePublisher = mainSource.slice(stateStart, stateEnd);
    assert.match(statePublisher, /analysis_signature:\s*groundStationAnalysisSignature\(station\)/,
        "the UI auto trigger must receive the runtime's complete station contract signature");
    assert.match(source, /station\.analysis_signature/,
        "the panel must use that runtime signature when deciding to refresh");

    const removeStart = mainSource.indexOf("function removeGroundStationLayer");
    const remove = mainSource.slice(removeStart, mainSource.indexOf("function setCompositeLayerActive", removeStart));
    assert.match(remove, /emitObjectStateChanged[\s\S]*publishGroundStationsState\(\)/,
        "removing a station must republish AOS/LOS selector state");
    const duplicateStart = mainSource.indexOf("function duplicateSatelliteLayer");
    const duplicate = mainSource.slice(duplicateStart, mainSource.indexOf("function renameLayer", duplicateStart));
    assert.match(duplicate, /publishGroundStationsState\(\)/,
        "duplicating a satellite must republish AOS/LOS selector state");

    const receiveResultStart = source.indexOf("const receiveResult");
    const receiveResult = source.slice(receiveResultStart, receiveResultStart + 1_600);
    assert.match(receiveResult, /if \(!selection \|\|[\s\S]*return;/,
        "a result without its station/satellite pair must never overwrite the active analysis");
    assert.match(receiveResult, /if \(detail\?\.cancelled === true\) return;[\s\S]*setLoading\(false\)/,
        "a cancellation must not turn off the loading indicator of its replacement request");
});
