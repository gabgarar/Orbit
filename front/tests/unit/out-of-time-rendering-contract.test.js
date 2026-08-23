import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
const satellitesSource = readFileSync(new URL("../../js/satellites.js", import.meta.url), "utf8");
const compositeLayerSource = readFileSync(new URL("../../js/features/layers/compositeLayerManager.js", import.meta.url), "utf8");

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(start, -1, `missing ${startMarker}`);
    assert.notEqual(end, -1, `missing ${endMarker}`);
    return source.slice(start, end);
}

test("ordinary ground-station coverage keeps its 3D RF cone presentation", () => {
    const presentation = sourceBetween(
        mainSource,
        "function applyGroundStationVisuals(station)",
        "function clearGroundStationPreview()"
    );
    assert.match(
        presentation,
        /const showVolume\s*=\s*coverageVisible\s*&&\s*isGroundStationCoverageVolumeVisible\(\)/,
        "the 3D field-of-regard mesh follows the normal coverage layer"
    );
    assert.match(
        presentation,
        /applyGroundStationFootprint\(station, rfModel, visualRangeKm, coverageVisible, showVolume\)/,
        "the normal coverage footprint must remain available independently of the optional volume"
    );
});

test("standalone layer toggles preserve the station cone with the coverage layer", () => {
    const visibilityFallback = sourceBetween(
        compositeLayerSource,
        "const setVisibility = (id, visible) => {",
        "const duplicate = (sourceId) => {"
    );

    assert.match(
        visibilityFallback,
        /station\.coverageVolumeEntity\.show\s*=\s*station\.visible\s*&&\s*station\.coverage_visible\s*!==\s*false/,
        "a generic layer-eye toggle preserves the 3D cone"
    );
    assert.match(
        visibilityFallback,
        /station\.patternPrimitive\.show\s*=\s*station\.visible\s*&&\s*station\.coverage_visible\s*!==\s*false/
    );
});

test("out-of-time satellite vectors fail closed instead of using a retained Cartesian state", () => {
    const vectorPosition = sourceBetween(
        satellitesSource,
        "function vectorPosition(state)",
        "function normalizedDirection"
    );

    assert.match(
        vectorPosition,
        /state\?\.isOutOfTimeVisualState/,
        "a vector origin must reject a state marked outside its temporal coverage"
    );
    assert.match(
        vectorPosition,
        /state\?\.entity\?\.show/,
        "a vector origin must also honour the owning marker's visibility"
    );
    assert.match(vectorPosition, /return\s+null/);
});

test("station link callbacks fail closed when their satellite is temporally hidden", () => {
    const liveLinks = sourceBetween(
        mainSource,
        "function syncGroundStationVisibilityLinks()",
        "function showGroundStationAnalysisVisuals"
    );
    const analysis = sourceBetween(
        mainSource,
        "function showGroundStationAnalysisVisuals",
        "function publishGroundStationsState"
    );

    for (const [label, source] of [
        ["live station links", liveLinks],
        ["the selected AOS/LOS connector", analysis]
    ]) {
        const callbackStart = source.indexOf("positions: new Cesium.CallbackProperty");
        const callback = source.slice(callbackStart, source.indexOf("}, false)", callbackStart));
        assert.ok(callbackStart >= 0, `${label} must remain dynamic`);
        assert.match(
            callback,
            /satellite\.show/,
            `${label} must return no geometry once an out-of-time satellite marker is hidden`
        );
        assert.match(callback, /return\s+\[\]/);
    }
});
