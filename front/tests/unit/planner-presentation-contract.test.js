import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../../../react-ui/src/features/planner/PlannerPanel.jsx", import.meta.url), "utf8");
const panelCss = readFileSync(new URL("../../../react-ui/src/features/planner/PlannerPanel.css", import.meta.url), "utf8");

test("planner keeps operational state compact and removes the redundant range/status strip", () => {
    assert.doesNotMatch(panel, /PlannerForecastSummary/);
    assert.doesNotMatch(panel, /orbit-planner-forecast/);
    assert.doesNotMatch(panel, /PlannerEarthOrientationNotice/);
    assert.doesNotMatch(panel, /orbit-planner-eop-notice/);
    assert.match(panel, /className=\{`orbit-planner-status is-\$\{presentationStatus\}`\} aria-live="polite" title=/);
    assert.match(panel, /\{visibleErrors\.length \? <div className="orbit-planner-state-error" role="alert">/);
    assert.doesNotMatch(panelCss, /\.orbit-planner-forecast/);
    assert.doesNotMatch(panelCss, /\.orbit-planner-eop-notice/);
});

test("planner acknowledgements expire and overlay the window instead of taking calendar height", () => {
    assert.match(panel, /const PLANNER_REQUEST_MESSAGE_TIMEOUT_MS = 4_500;/);
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

test("EOP source intervals use continuous week/viewport bands rather than repeated daily event chips", () => {
    assert.match(panel, /const eopRangeEvents = events\.filter\(isPlannerEopRangeEvent\);/);
    assert.match(panel, /const ordinaryEvents = events\.filter\(\(event\) => !isPlannerEopRangeEvent\(event\)\);/);
    assert.match(panel, /buildPlannerCoverageSegments\(eopRangeEvents, \{/);
    assert.match(panel, /<EopCoverageBand event=\{segment\.event\}/);
    assert.match(panel, /data-planner-eop-range="true"/);
    assert.match(panelCss, /\.orbit-planner-month-eop-ranges \{[\s\S]*position: absolute;[\s\S]*pointer-events: none;/);
    assert.match(panelCss, /\.orbit-planner-time-eop-ranges \{[\s\S]*position: sticky;/);
    assert.match(panelCss, /\.orbit-planner-time-eop-ranges > \.orbit-planner-eop-range \{/);
    assert.doesNotMatch(panel, /orbit-planner-time-eop-day/);
    assert.match(panel, /"--orbit-planner-eop-start-inset": `\$\{startInset\}%`/);
    assert.match(panel, /"--orbit-planner-eop-end-inset": `\$\{endInset\}%`/);
    assert.doesNotMatch(panel, /clipPath:/);
    assert.match(panelCss, /\.orbit-planner-eop-range-line \{[\s\S]*position: absolute;[\s\S]*right: var\(--orbit-planner-eop-end-inset\);[\s\S]*left: var\(--orbit-planner-eop-start-inset\);/);
    assert.match(panelCss, /\.orbit-planner-eop-range-label \{[\s\S]*right: var\(--orbit-planner-eop-end-inset\);[\s\S]*left: var\(--orbit-planner-eop-start-inset\);/);
});

test("EOP coverage bands share the compact event box and typography in every planner view", () => {
    assert.match(panelCss, /\.orbit-planner-panel \{[\s\S]*--orbit-planner-compact-event-height: 19px;[\s\S]*--orbit-planner-compact-event-padding: 2px 4px;/);
    assert.match(panelCss, /\.orbit-planner-eop-range \{[\s\S]*height: var\(--orbit-planner-compact-event-height\);[\s\S]*min-height: var\(--orbit-planner-compact-event-height\);[\s\S]*box-sizing: border-box;[\s\S]*padding: var\(--orbit-planner-compact-event-padding\);/);
    assert.match(panelCss, /\.orbit-planner-event\.is-compact \{[\s\S]*height: var\(--orbit-planner-compact-event-height\);[\s\S]*min-height: var\(--orbit-planner-compact-event-height\);[\s\S]*box-sizing: border-box;[\s\S]*padding: var\(--orbit-planner-compact-event-padding\);/);
    assert.match(panelCss, /\.orbit-planner-eop-range-label \{[\s\S]*font-size: var\(--orbit-planner-compact-event-font-size\);[\s\S]*font-weight: var\(--orbit-planner-compact-event-font-weight\);[\s\S]*line-height: var\(--orbit-planner-compact-event-line-height\);/);
    assert.doesNotMatch(panelCss, /\.orbit-planner-time-eop-ranges > \.orbit-planner-eop-range\.has-label \{[\s\S]*min-height:/);
});

test("month cells retain every event in an internal scroll viewport and date badges fit two digits", () => {
    assert.match(panel, /className="orbit-planner-month-events"/);
    assert.match(panel, /aria-label=\{`Eventos del \$\{dayFormatter\.format\(day\)\}/);
    assert.match(panel, /tabIndex=\{dayEvents\.length \? 0 : -1\}/);
    assert.match(panel, /\{dayEvents\.map\(\(event\) => <EventButton event=\{event\}/);
    assert.doesNotMatch(panel, /dayEvents\.slice\(0, 3\)/);
    assert.doesNotMatch(panel, /orbit-planner-more-events/);
    assert.match(panelCss, /\.orbit-planner-month-day \{[\s\S]*display: flex;[\s\S]*min-height: 0;[\s\S]*flex-direction: column;/);
    assert.match(panelCss, /\.orbit-planner-month-events \{[\s\S]*min-height: 0;[\s\S]*flex: 1 1 auto;[\s\S]*overflow-y: auto;[\s\S]*overscroll-behavior: contain;/);
    assert.match(panelCss, /\.orbit-planner-month-events::\-webkit-scrollbar \{[\s\S]*width: 5px;/);
    assert.match(panelCss, /\.orbit-planner-day-number \{[\s\S]*width: 26px;[\s\S]*height: 26px;[\s\S]*min-width: 26px;[\s\S]*min-height: 26px;[\s\S]*box-sizing: border-box;[\s\S]*padding: 0;[\s\S]*line-height: 1;/);
});

test("EOP coverage rails use the published quality colour tokens and keep their meaning without colour alone", () => {
    assert.match(panel, /const EOP_VISUAL_STATE_COLOR_TOKENS = Object\.freeze\(\{[\s\S]*normal: PLANNER_COLOR_TOKENS\.EMERALD,[\s\S]*ok: PLANNER_COLOR_TOKENS\.AMBER,[\s\S]*predicted: PLANNER_COLOR_TOKENS\.ROSE,[\s\S]*degraded: PLANNER_COLOR_TOKENS\.ROSE/);
    assert.match(panel, /function eopCoverageColorToken\(event\) \{[\s\S]*metadata\.eopColorToken[\s\S]*event\?\.colorToken[\s\S]*metadata\.eopVisualState/);
    assert.match(panel, /data-eop-tone=\{eopCoverageColorToken\(event\)\}/);
    assert.match(panel, /data-eop-state=\{String\(plannerRecord\(event\?\.metadata\)\.eopVisualState/);
    assert.match(panel, /function eopCoverageStateLabel\(event\)/);
    assert.match(panel, /IERS ERP Time/);
    for (const token of ["emerald", "amber", "rose"]) {
        assert.match(panelCss, new RegExp(`\\.orbit-planner-eop-range\\[data-eop-tone="${token}"\\]`));
    }
    assert.match(panelCss, /\.orbit-planner-eop-range \{[\s\S]*background: transparent;[\s\S]*\.orbit-planner-eop-range-line \{[\s\S]*background: linear-gradient\(102deg/);
    assert.match(panelCss, /@media \(forced-colors: active\) \{[\s\S]*\.orbit-planner-eop-range \{/);
});
