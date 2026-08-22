import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtime = readFileSync(new URL("../../main.js", import.meta.url), "utf8");
const manualPanel = readFileSync(
    new URL("../../../react-ui/src/components/ManualOrbitPanel.jsx", import.meta.url),
    "utf8"
);
const groundStationsPanel = readFileSync(
    new URL("../../../react-ui/src/components/GroundStationsPanel.jsx", import.meta.url),
    "utf8"
);
const propagatedPanel = readFileSync(
    new URL("../../../react-ui/src/components/PropagatedOrbitParametersPanel.jsx", import.meta.url),
    "utf8"
);
const plannerPanel = readFileSync(
    new URL("../../../react-ui/src/features/planner/PlannerPanel.jsx", import.meta.url),
    "utf8"
);

function section(start, end) {
    const from = runtime.indexOf(start);
    const to = runtime.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `missing runtime section ${start}`);
    return runtime.slice(from, to);
}

test("long-running propagation paths publish a non-blocking EOP preflight and retain actual provenance separately", () => {
    const ground = section("async function analyzeGroundStationPasses", "function restoreProjectSimulationState");
    const parameters = section("async function requestPropagatedParameters", "function setupPropagatedParametersEntryBridge");
    const preview = section("async function requestManualOrbitPreview", "function scheduleManualOrbitPreview");
    const create = section("async function createManualOrbitFromEditor", "function setupManualOrbitEditorBridge");
    const forecast = section("async function refreshPlannerPassForecast", "function requestPlannerPassForecast");

    assert.match(runtime, /function assessAutomaticEarthOrientationPreflight/);
    assert.match(runtime, /function actualEarthOrientationAssessment/);
    assert.match(ground, /earthOrientationPreflight: earthOrientationCoverageDetail\(earthOrientationPreflight\)/);
    assert.match(ground, /earthOrientationProvenance: actualEarthOrientation/);
    assert.match(ground, /earthOrientationOperationMessage\(/);
    assert.match(parameters, /earthOrientationPreflightDetail/);
    assert.match(parameters, /earthOrientationProvenance: actualEarthOrientation/);
    assert.match(parameters, /earthOrientationOperationMessage\(/);
    assert.match(preview, /automaticEopEffectiveAssessment/);
    assert.match(create, /automaticEopEffectiveAssessment/);
    assert.match(preview, /actualEarthOrientationAssessment\(responsePayload\)/);
    assert.match(create, /actualEarthOrientationAssessment\(responsePayload\)/);
    assert.match(forecast, /earthOrientationOperationMessage\(/);
    assert.doesNotMatch(ground, /throw new Error\([^\n]*orientación terrestre/i);
    assert.doesNotMatch(parameters, /throw new Error\([^\n]*orientación terrestre/i);
});

test("operator surfaces distinguish the forecast from backend execution provenance", () => {
    assert.match(manualPanel, /manual-orbit-eop-coverage-notice/);
    assert.match(manualPanel, /automaticEopEffectiveAssessment/);
    assert.match(manualPanel, /La operación continúa con la procedencia indicada/);
    assert.match(groundStationsPanel, /ground-station-eop-coverage-notice/);
    assert.match(groundStationsPanel, /earthOrientationProvenance/);
    assert.match(propagatedPanel, /propagated-parameters-eop-coverage-notice/);
    assert.match(propagatedPanel, /earthOrientationProvenance/);
    // The planner is the provenance map itself: it renders the actual EOP
    // source intervals as a hideable layer instead of duplicating the generic
    // yellow preflight warning that belongs on operation surfaces and BIT.
    assert.doesNotMatch(plannerPanel, /planner-eop-coverage-notice/);
    assert.doesNotMatch(plannerPanel, /Orientación terrestre de la agenda/);
    assert.match(plannerPanel, /isPlannerEopRangeEvent/);
    assert.match(plannerPanel, /orbit-planner-(?:month|time)-eop-ranges/);
});
