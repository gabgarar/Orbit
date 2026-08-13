import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
const lifecycleSource = readFileSync(new URL("../../js/runtime/projectLifecycle.js", import.meta.url), "utf8");
const sidebarSource = readFileSync(new URL("../../js/objectSidebar.js", import.meta.url), "utf8");

test("finite layer activation cannot bypass Master Time Range approval", () => {
    assert.match(mainSource, /async function approveSatelliteActivationForMasterTimeRange\(/);
    assert.match(mainSource, /getObjectIntrinsicTimeRangeUnion\(sourceIds\)/);
    assert.match(mainSource, /async function setCompositeLayerActiveWithMasterTimeRange\(/);
    assert.match(mainSource, /await approveSatelliteActivationForMasterTimeRange\(\[layerId\]\)/);
    assert.match(mainSource, /commitObjectRangeToMasterTimeRange\(activation\.union\.range\)/);
    assert.match(mainSource, /const added = await setCompositeLayerActiveWithMasterTimeRange\(satId, true\)/);
    assert.match(mainSource, /onToggleObjectLayer: async \(id, active\)[\s\S]*?setCompositeLayerActiveWithMasterTimeRange\(id, active\)/);
    assert.match(mainSource, /onAddAllLayers: async \(\)[\s\S]*?activateAllSatelliteLayersWithMasterTimeRange\(\)/);
});

test("MTR-sensitive commands preserve approval and bounded-clock guards", () => {
    assert.match(mainSource, /applyTimeWindow: false/);
    assert.match(mainSource, /await approveObjectRangeForMasterTimeRange\(masterRangeAtRequest/);
    assert.match(mainSource, /await requestMasterTimeRangeFromTimeline\(/);
    assert.match(mainSource, /function resumeRealtimeClock\(\)[\s\S]*?isInsideMasterRange\(now\)/);
    assert.match(mainSource, /savedEnd >= savedStart/);
});

test("project restore establishes MTR before finite activation and rejects it before subscription", () => {
    const restoreSimulation = lifecycleSource.indexOf("restoreSimulation(project.simulation)");
    const satelliteRestoration = lifecycleSource.indexOf("const satelliteRestoration = restoreSatelliteIds");
    assert.ok(restoreSimulation >= 0 && satelliteRestoration >= 0);
    assert.ok(restoreSimulation < satelliteRestoration);
    assert.match(mainSource, /const fit = validateObjectFitsMTR\(getObjectIntrinsicTimeRange\(id\)\)/);
    assert.match(mainSource, /if \(!fit\.valid \|\| fit\.requiresExpansion\) return "skip"/);
});

test("bulk sidebar calls await activation outcomes instead of treating a Promise as success", () => {
    assert.match(sidebarSource, /await Promise\.resolve\(onToggleObjectLayer\(id, true\)\)/);
    assert.match(sidebarSource, /await Promise\.resolve\(processItem\(queue\[index\]\)\)/);
});

test("an OEM file is routed to the native finite importer before catalogue/TLE parsing", () => {
    assert.match(sidebarSource, /export function isNativeOemEphemerisFileName\(fileName\)/);
    const nativeOemGuard = sidebarSource.indexOf("if (isNativeOemEphemerisFileName(file.name))");
    const nativeOemImport = sidebarSource.indexOf("await importNativeOemEphemeris(content, file.name, { beforeFormats, announce });");
    const catalogueImport = sidebarSource.indexOf('fetch("/api/catalog/import"');
    assert.ok(nativeOemGuard >= 0 && nativeOemImport >= 0 && catalogueImport >= 0);
    assert.ok(nativeOemGuard < nativeOemImport && nativeOemImport < catalogueImport);
    assert.doesNotMatch(sidebarSource, /isOemNoTleError/);
});
