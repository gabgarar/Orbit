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

test("ground-station live links are created only for active and visible satellite layers", () => {
    const sync = sourceBetween(
        "function syncGroundStationVisibilityLinks()",
        "function showGroundStationAnalysisVisuals"
    );
    const satelliteSelection = sync.slice(
        sync.indexOf("const satelliteLayerIds"),
        sync.indexOf("for (const station of groundStationLayers.values())")
    );

    assert.match(satelliteSelection, /isCompositeLayerActive\(id\)/);
    assert.match(satelliteSelection, /getCompositeLayerVisibility\(id\)/,
        "a hidden satellite must not remain in the desired station-link set");

    const callbackStart = sync.indexOf("positions: new Cesium.CallbackProperty");
    const callback = sync.slice(callbackStart, sync.indexOf("}, false)", callbackStart));
    assert.match(callback, /getCompositeLayerVisibility\(satelliteLayerId\)\s*(?:!==\s*true|===\s*false)|!getCompositeLayerVisibility\(satelliteLayerId\)/,
        "an already-created link must fail closed immediately while its satellite is hidden");
});

test("toggling a satellite eye reconciles its station links, so hide removes and show restores them", () => {
    const visibility = sourceBetween(
        "function setCompositeLayerVisibility(layerId, visible)",
        "function isCompositeLayerActive(layerId)"
    );
    const satelliteVisibilityWrite = visibility.lastIndexOf("compositeLayers.setVisibility(layerId, visible)");
    const reconcile = visibility.indexOf("syncGroundStationVisibilityLinks()", satelliteVisibilityWrite);

    assert.ok(satelliteVisibilityWrite >= 0, "satellite visibility must still be delegated to the composite layer");
    assert.ok(reconcile > satelliteVisibilityWrite,
        "both hiding and showing a satellite must rebuild the desired station-link set");
});

test("the selected AOS/LOS connector follows the same layer-visibility contract", () => {
    const analysis = sourceBetween(
        "function showGroundStationAnalysisVisuals",
        "function publishGroundStationsState"
    );

    assert.match(analysis, /const currentStation\s*=\s*groundStationLayers\.get\(station\.id\)/);
    assert.match(analysis, /!currentStation\?\.visible/);
    assert.match(analysis, /getCompositeLayerVisibility\(satelliteLayerId\)\s*!==\s*true/,
        "the one-off analysis line must also disappear when its satellite eye is closed");
});

test("ground-station connectors use a straight Cartesian line of sight, never an Earth arc", () => {
    const liveLinks = sourceBetween(
        "function syncGroundStationVisibilityLinks()",
        "function showGroundStationAnalysisVisuals"
    );
    const aosLos = sourceBetween(
        "function showGroundStationAnalysisVisuals",
        "function publishGroundStationsState"
    );

    for (const [label, source] of [
        ["live station-to-satellite links", liveLinks],
        ["the selected AOS/LOS connector", aosLos]
    ]) {
        const polylineStart = source.indexOf("polyline: {");
        const positionsStart = source.indexOf("positions: new Cesium.CallbackProperty", polylineStart);
        const polylineOptions = source.slice(polylineStart, positionsStart);

        assert.ok(polylineStart >= 0, `${label} must define a Cesium polyline`);
        assert.ok(positionsStart > polylineStart, `${label} must provide dynamic endpoints`);
        assert.match(polylineOptions, /arcType:\s*Cesium\.ArcType\.NONE/,
            `${label} must not be geodesically interpolated over the ellipsoid`);
        assert.match(polylineOptions, /clampToGround:\s*false/,
            `${label} must remain an elevated Cartesian line of sight`);
    }
});
