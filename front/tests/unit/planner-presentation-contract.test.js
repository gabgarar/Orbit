import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../../../react-ui/src/features/planner/PlannerPanel.jsx", import.meta.url), "utf8");
const panelCss = readFileSync(new URL("../../../react-ui/src/features/planner/PlannerPanel.css", import.meta.url), "utf8");

test("planner keeps a ready forecast compact and exposes details only when state has detail", () => {
    assert.match(panel, /const loading = plannerState\.status === "loading";/);
    assert.match(panel, /const detailIsForced = loading \|\| modeMessages\.length > 0 \|\| plannerState\.status === "error";/);
    assert.match(panel, /const hasDetail = Boolean\(detail\);/);
    assert.match(panel, /const showDetail = hasDetail && \(detailIsForced \|\| expanded\);/);
    assert.match(panel, /orbit-planner-forecast\$\{showDetail \? " is-expanded" : " is-compact"\}/);
    assert.match(panel, /\{hasDetail \? <button type="button" className="orbit-planner-forecast-toggle" aria-expanded=\{showDetail\} aria-controls="orbitPlannerForecastDetails"/);
    assert.match(panel, /\{showDetail \? <p id="orbitPlannerForecastDetails" className="orbit-planner-forecast-detail">/);
    assert.match(panel, /\{progress !== null && plannerState\.status === "loading" \?/);
    assert.match(panelCss, /\.orbit-planner-forecast-detail \{[\s\S]*grid-column: 1 \/ -1;/);
});

test("planner acknowledgements expire and overlay the window instead of taking calendar height", () => {
    assert.match(panel, /export const PLANNER_REQUEST_MESSAGE_TIMEOUT_MS = 4_500;/);
    assert.match(panel, /if \(!requestMessage\) return undefined;[\s\S]*window\.setTimeout\(\(\) => setRequestMessage\(""\), PLANNER_REQUEST_MESSAGE_TIMEOUT_MS\);[\s\S]*window\.clearTimeout\(timeout\)/);
    assert.match(panel, /\{requestMessage \? <p className="orbit-planner-request-toast" role="status" aria-live="polite">/);
    assert.doesNotMatch(panel, /orbit-planner-request-message/);
    assert.match(panelCss, /\.orbit-planner-request-toast \{[\s\S]*position: absolute;[\s\S]*z-index: 18;[\s\S]*pointer-events: none;/);
});

test("planner supports a narrow floating window without relying only on viewport breakpoints", () => {
    assert.match(panel, /PLANNER_RESIZE_DIRECTIONS\.map\(\(direction\) => <span/);
    assert.match(panel, /style=\{panelStyle\}/);
    assert.match(panelCss, /\.orbit-planner-panel \{[\s\S]*position: absolute;[\s\S]*container-type: inline-size;/);
    assert.match(panelCss, /@container orbit-planner-panel \(max-width: 960px\)/);
});
