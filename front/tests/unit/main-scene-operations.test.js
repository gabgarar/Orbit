import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
const groundStationsPanelSource = readFileSync(
    new URL("../../../react-ui/src/components/GroundStationsPanel.jsx", import.meta.url),
    "utf8"
);

function sourceBetween(startMarker, endMarker) {
    const start = runtimeSource.indexOf(startMarker);
    const end = runtimeSource.indexOf(endMarker, start);
    assert.notEqual(start, -1, `missing ${startMarker}`);
    assert.notEqual(end, -1, `missing ${endMarker}`);
    return runtimeSource.slice(start, end);
}

test("main scene activity uses the scene scope and owns only its own cancellation", () => {
    const operations = sourceBetween("function beginRuntimeSceneOperation", "function requestProjectActionDialog");

    assert.match(operations, /scope: OPERATION_SCOPES\.SCENE/);
    assert.match(operations, /cancelWork\?\.\(message\)/);
    assert.match(operations, /window\.addEventListener\("orbit:operation-cancel-request"/);
    assert.match(operations, /window\.addEventListener\("orbit:scene-operations-cancel"/);
    assert.doesNotMatch(operations, /MANUAL_ORBIT_OPERATION_SCOPE|clearOperationsForScope/);
    assert.doesNotMatch(operations, /[\u00c3\u00c2\u00e2]/);
});

test("ground-station export, AOS/LOS, and propagated parameters complete every activity lifecycle", () => {
    const exportWork = sourceBetween("async function downloadGroundStationsGeoPackage", "async function importGroundStationsFile");
    const analysisWork = sourceBetween("async function analyzeGroundStationPasses", "function restoreProjectSimulationState");
    const parametersWork = sourceBetween("async function requestPropagatedParameters", "function setupPropagatedParametersEntryBridge");

    assert.match(exportWork, /beginRuntimeSceneOperation\("ground-station-export"/);
    assert.match(exportWork, /signal: controller\.signal/);
    assert.match(exportWork, /completeRuntimeSceneOperation\(operationId/);
    assert.match(exportWork, /failRuntimeSceneOperation\(operationId, error\)/);
    assert.match(exportWork, /cancelRuntimeSceneOperation\(operationId/);
    assert.match(exportWork, /finally \{/);

    assert.match(analysisWork, /beginRuntimeSceneOperation\("ground-station-analysis"/);
    assert.match(analysisWork, /fetch\(request\.url, \{ \.\.\.request\.requestOptions, signal: abortController\.signal \}\)/);
    assert.match(analysisWork, /completeRuntimeSceneOperation\(\s*operationId/);
    assert.match(analysisWork, /failRuntimeSceneOperation\(operationId/);
    assert.match(analysisWork, /cancelRuntimeSceneOperation\(operationId/);
    assert.match(analysisWork, /finally \{/);

    assert.match(parametersWork, /beginRuntimeSceneOperation\("propagated-parameters"/);
    assert.match(parametersWork, /fetch\("\/api\/orbit-parameters", \{/);
    assert.match(parametersWork, /signal: controller\.signal/);
    assert.match(parametersWork, /completeRuntimeSceneOperation\(\s*operationId/);
    assert.match(parametersWork, /failRuntimeSceneOperation\(operationId/);
    assert.match(parametersWork, /cancelRuntimeSceneOperation\(operationId/);
    assert.match(parametersWork, /finally \{/);
});

test("cancelling an AOS/LOS operation clears the button state without replacing the previous result", () => {
    assert.match(groundStationsPanelSource, /if \(detail\?\.cancelled === true\) return;/);
});
