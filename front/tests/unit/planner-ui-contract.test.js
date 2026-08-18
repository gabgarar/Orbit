import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    ORBIT_PLANNER_LAYER_FILTER_EVENT,
    ORBIT_PLANNER_MANUAL_EVENT_REMOVE_EVENT,
    ORBIT_PLANNER_MANUAL_EVENT_UPSERT_EVENT,
    ORBIT_PLANNER_CLOSE_EVENT,
    ORBIT_PLANNER_OPEN_EVENT,
    ORBIT_PLANNER_STATE_EVENT,
    ORBIT_PLANNER_STATE_REQUEST_EVENT,
    ORBIT_PLANNER_VIEW_RANGE_EVENT,
    PLANNER_COLOR_TOKENS,
    cursorForUtcMonth,
    filterPlannerEventsByLayerVisibility,
    formatUtcInput,
    formatUtcMonth,
    layoutPlannerEventLanes,
    makeManualEventPayload,
    normalizePlannerUiState,
    parseUtcInput,
    plannerViewRangePayload
} from "../../../react-ui/src/features/planner/plannerUiModel.js";

const panel = readFileSync(new URL("../../../react-ui/src/features/planner/PlannerPanel.jsx", import.meta.url), "utf8");
const panelCss = readFileSync(new URL("../../../react-ui/src/features/planner/PlannerPanel.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../../../react-ui/src/App.jsx", import.meta.url), "utf8");
const toolbar = readFileSync(new URL("../../../react-ui/src/components/layout/TopToolbar.jsx", import.meta.url), "utf8");
const toolbarCss = readFileSync(new URL("../../../react-ui/src/components/layout/TopToolbar.css", import.meta.url), "utf8");

test("planner trigger is an accessible navigation item immediately after Analytics", () => {
    assert.match(toolbar, /id="topPlannerBtn"/);
    assert.match(toolbar, /aria-label="Planner"/);
    assert.match(toolbar, /<CalendarIcon\s*\/>/);
    assert.match(toolbar, /toolbar-nav-link toolbar-planner-btn is-available/);
    assert.match(toolbar, /<span className="toolbar-nav-icon"><CalendarIcon\s*\/><\/span>Planner/);
    assert.match(toolbar, /aria-controls="orbitPlannerPanel"/);
    assert.match(panel, /id="orbitPlannerPanel"/);
    assert.match(toolbar, /\{navigation\.map[\s\S]*topPlannerBtn[\s\S]*<\/nav>/);
    assert.match(toolbarCss, /toolbar-planner-btn/);
    assert.match(app, /<PlannerPanel/);
});

test("time grids stay fluid and keep their only required 24-hour scroll visually unobtrusive", () => {
    assert.match(panel, /repeat\(\$\{days\.length\}, minmax\(0, 1fr\)\)/);
    assert.doesNotMatch(panel, /minmax\(130px, 1fr\)/);
    assert.match(panelCss, /\.orbit-planner-time-scroll \{[\s\S]*overflow-x: hidden;[\s\S]*overflow-y: auto;[\s\S]*scrollbar-width: none;/);
    assert.match(panelCss, /\.orbit-planner-time-header,[\s\S]*\.orbit-planner-hours \{[\s\S]*width: 100%;[\s\S]*min-width: 0;/);
    assert.match(panelCss, /\.orbit-planner-detail \{[\s\S]*overflow-x: hidden;[\s\S]*box-sizing: border-box;/);
    assert.match(panelCss, /\.orbit-planner-time-scroll::\-webkit-scrollbar,[\s\S]*\.orbit-planner-detail::\-webkit-scrollbar/);
});

test("planner reads canonical state late and requests a fresh snapshot", () => {
    assert.equal(ORBIT_PLANNER_STATE_EVENT, "orbit:planner-state");
    assert.equal(ORBIT_PLANNER_STATE_REQUEST_EVENT, "orbit:planner-state-request");
    assert.match(panel, /window\.__orbitPlannerState/);
    assert.match(panel, /window\.dispatchEvent\(new Event\(ORBIT_PLANNER_STATE_REQUEST_EVENT\)\)/);
    assert.match(panel, /window\.addEventListener\(ORBIT_PLANNER_STATE_EVENT, sync\)/);
});

test("planner close is emitted once by the App-owned lifecycle, including teardown", () => {
    assert.equal(ORBIT_PLANNER_CLOSE_EVENT, "orbit:planner-close");
    assert.match(app, /const plannerOpenRef = useRef\(false\)/);
    assert.match(app, /const closePlanner = useCallback/);
    assert.match(app, /if \(!plannerOpenRef\.current\) return;/);
    assert.match(app, /plannerOpenRef\.current = false;\s*window\.dispatchEvent\(new Event\(ORBIT_PLANNER_CLOSE_EVENT\)\)/);
    assert.match(app, /<PlannerPanel onClose=\{closePlanner\}/);
    assert.match(app, /onTogglePlanner=\{togglePlanner\}/);
});

test("the toolbar open lifecycle notifies the runtime exactly once", () => {
    assert.equal(ORBIT_PLANNER_OPEN_EVENT, "orbit:planner-open");
    assert.match(app, /const openPlanner = useCallback\(\(\{ announce = true \} = \{\}\) =>/);
    assert.match(app, /if \(announce\) window\.dispatchEvent\(new Event\(ORBIT_PLANNER_OPEN_EVENT\)\)/);
    assert.match(app, /window\.addEventListener\(ORBIT_PLANNER_OPEN_EVENT, openPlannerFromEvent\)/);
    assert.match(app, /const openPlannerFromEvent = \(\) => openPlanner\(\{ announce: false \}\)/);
});

test("planner exposes UTC day, week and month views with visible loading, error and empty states", () => {
    assert.match(panel, /setView\("day"\)/);
    assert.match(panel, /setView\("week"\)/);
    assert.match(panel, /setView\("month"\)/);
    assert.match(panel, /Todos los horarios se muestran en UTC/);
    assert.match(panel, /role="alert"/);
    assert.match(panel, /Cargando los eventos de Orbit/);
    assert.match(panel, /No hay eventos en este periodo/);
    assert.match(panel, /getUTCFullYear|Date\.UTC/);
});

test("month/year picker and published viewport stay UTC-only across day, week and month", () => {
    assert.equal(ORBIT_PLANNER_VIEW_RANGE_EVENT, "orbit:planner-view-range");
    assert.equal(formatUtcMonth("2026-08-18T14:30:00-04:00"), "2026-08");
    assert.equal(cursorForUtcMonth("2027-02", "2026-01-31T23:30:00Z")?.toISOString(), "2027-02-28T00:00:00.000Z");
    assert.equal(cursorForUtcMonth("not-a-month", "2026-01-31T23:30:00Z"), null);
    assert.deepEqual(plannerViewRangePayload("day", "2026-08-18T23:30:00-04:00"), {
        view: "day",
        startTime: "2026-08-19T00:00:00.000Z",
        endTime: "2026-08-20T00:00:00.000Z"
    });
    assert.deepEqual(plannerViewRangePayload("week", "2026-08-19T12:00:00Z"), {
        view: "week",
        startTime: "2026-08-17T00:00:00.000Z",
        endTime: "2026-08-24T00:00:00.000Z"
    });
    assert.deepEqual(plannerViewRangePayload("month", "2026-02-12T12:00:00Z"), {
        view: "month",
        startTime: "2026-02-01T00:00:00.000Z",
        endTime: "2026-03-01T00:00:00.000Z"
    });
    assert.match(panel, /type="month"/);
    assert.match(panel, /Ir a mes y año en UTC/);
    assert.match(panel, /ORBIT_PLANNER_VIEW_RANGE_EVENT/);
    assert.match(panel, /plannerViewRangePayload\(view, cursor\)/);
});

test("planner-only layer filters keep manual project events and clear hidden scene references", () => {
    assert.equal(ORBIT_PLANNER_LAYER_FILTER_EVENT, "orbit:planner-layer-filter");
    const manual = makeManualEventPayload({
        title: "Planificación del operador",
        start: "2026-08-18T14:30",
        end: "2026-08-18T15:30",
        color: PLANNER_COLOR_TOKENS.CYAN
    }, "manual-layer-filter").event;
    const state = normalizePlannerUiState({
        status: "ready",
        events: [
            manual,
            {
                id: "pass-layer-filter",
                kind: "pass-aos",
                time: "2026-08-18T14:40:00Z",
                metadata: { stationId: "station-1", satelliteLayerId: "sat-1" }
            },
            {
                id: "resource-layer-filter",
                kind: "layer-validity-end",
                time: "2026-08-18T16:00:00Z",
                metadata: { sourceId: "source-1" }
            }
        ],
        layers: [
            { id: "station-1", name: "Madrid", type: "GROUND_STATION", active: true, visible: true },
            { id: "sat-1", name: "SAT-1", type: "SATELLITE", sourceId: "source-1", active: true, visible: true },
            { id: "sat-1-copy", name: "SAT-1 copia", type: "SATELLITE", sourceId: "source-1", active: true, visible: true }
        ],
        plannerHiddenLayerIds: ["station-1", "sat-1", "unknown"]
    });
    assert.deepEqual(state.plannerHiddenLayerIds, ["station-1", "sat-1"]);
    assert.equal(state.layers.length, 3);
    const visible = filterPlannerEventsByLayerVisibility(state.events, state.layers, state.plannerHiddenLayerIds);
    assert.deepEqual(visible.map((event) => event.id), ["manual-layer-filter", "resource-layer-filter"]);
    assert.match(panel, /<PlannerLayerSidebar/);
    assert.match(panel, /ORBIT_PLANNER_LAYER_FILTER_EVENT/);
    assert.match(panel, /<h3>Capas de la agenda<\/h3>/);
    assert.doesNotMatch(panel, /FUENTES DE ESCENA/);
    assert.doesNotMatch(panel, /Este filtro solo afecta a la agenda/);
    assert.doesNotMatch(panel, /Los eventos manuales pertenecen al proyecto/);
    assert.match(panel, /!visibleEvents\.some\(\(event\) => event\.id === selectedEvent\.id\)/);
});

test("static and realtime remain useful planner contexts without consuming summary space", () => {
    assert.match(panel, /function plannerMode\(context\)/);
    assert.doesNotMatch(panel, /plannerModeDescription/);
    assert.doesNotMatch(panel, /plannerModeLabel/);
    assert.doesNotMatch(panel, /orbit-planner-mode/);
    assert.doesNotMatch(panelCss, /\.orbit-planner-mode/);
    assert.match(panel, /canActivate=\{mode === "simulated"\}/);
    assert.match(panel, /orbit-planner-forecast/);
    assert.match(panelCss, /\.orbit-planner-layers \{/);
    assert.match(panelCss, /@media \(max-width: 860px\)[\s\S]*grid-template-columns: minmax\(162px, 196px\)/);
    assert.match(panelCss, /@media \(max-width: 680px\)[\s\S]*\.orbit-planner-layers \{/);
});

test("planner anchors an initial historical cursor to the published scene before emitting a viewport", () => {
    assert.match(panel, /function plannerCursorFromState\(state\)/);
    assert.match(panel, /const initialPlannerCursor = plannerCursorFromState\(plannerState\)/);
    assert.match(panel, /const cursorSeededFromScene = useRef\(Boolean\(initialPlannerCursor\)\)/);
    assert.match(panel, /if \(!viewportCursorReady\) return;/);
    assert.match(panel, /const sceneCursor = plannerCursorFromState\(plannerState\)/);
    assert.match(panel, /cursorWasNavigatedByUser\.current = true;/);
});

test("manual planner events are strict UTC intervals and use the canonical mutation events", () => {
    assert.equal(parseUtcInput("2026-08-18T14:30"), "2026-08-18T14:30:00.000Z");
    assert.equal(formatUtcInput("2026-08-18T14:30:45Z"), "2026-08-18T14:30");
    const created = makeManualEventPayload({
        title: "Contacto de prueba",
        start: "2026-08-18T14:30",
        end: "2026-08-18T15:15",
        color: PLANNER_COLOR_TOKENS.PURPLE
    }, "manual-test");
    assert.equal(created.ok, true);
    assert.equal(created.event.kind, "manual");
    assert.equal(created.event.colorToken, "purple");
    assert.equal(created.event.start, "2026-08-18T14:30:00.000Z");
    const rejected = makeManualEventPayload({ title: "No", start: "2026-08-18T15:00", end: "2026-08-18T15:00" });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /fin debe ser posterior/i);
    assert.equal(ORBIT_PLANNER_MANUAL_EVENT_UPSERT_EVENT, "orbit:planner-manual-event-upsert");
    assert.equal(ORBIT_PLANNER_MANUAL_EVENT_REMOVE_EVENT, "orbit:planner-manual-event-remove");
    assert.match(panel, /ORBIT_PLANNER_MANUAL_EVENT_UPSERT_EVENT/);
    assert.match(panel, /ORBIT_PLANNER_MANUAL_EVENT_REMOVE_EVENT/);
});

test("UI consumes semantic planner kinds and colour tokens instead of a parallel event schema", () => {
    assert.match(panel, /PLANNER_EVENT_KINDS\.MANUAL/);
    assert.match(panel, /event\.colorToken/);
    assert.doesNotMatch(panel, /event\.eventType/);
});

test("overlapping AOS/LOS/maximum-style instants receive separate timed-event lanes", () => {
    const first = makeManualEventPayload({
        title: "AOS",
        start: "2026-08-18T14:30",
        end: "2026-08-18T15:15",
        color: PLANNER_COLOR_TOKENS.PURPLE
    }, "lane-a").event;
    const second = makeManualEventPayload({
        title: "Máximo",
        start: "2026-08-18T14:45",
        end: "2026-08-18T15:30",
        color: PLANNER_COLOR_TOKENS.EMERALD
    }, "lane-b").event;
    const lanes = layoutPlannerEventLanes([first, second]);
    assert.equal(lanes.length, 2);
    assert.deepEqual(lanes.map((entry) => entry.lane), [0, 1]);
    assert.deepEqual(lanes.map((entry) => entry.laneCount), [2, 2]);
    assert.match(panel, /const timedLayouts = layoutPlannerEventLanes/);
    assert.match(panel, /left: `calc\(\$\{lane \* laneWidth\}% \+ 4px\)`/);
    assert.match(panel, /width: `calc\(\$\{laneWidth\}% - 8px\)`/);
});

test("planner is a fresh, bounded floating workspace with compact operational chrome", () => {
    assert.match(panel, /from "\.\/plannerWindowLayout\.js"/);
    assert.match(panel, /const PLANNER_RESIZE_DIRECTIONS = \["n", "s", "e", "w", "ne", "nw", "se", "sw"\]/);
    assert.match(panel, /initialPlannerWindowRect\(\)/);
    assert.doesNotMatch(panel, /writePlannerWindowRect/);
    assert.doesNotMatch(panel, /orbit-planner-window-reset/);
    assert.match(panel, /movePlannerWindowRect\(windowInteraction\.rect, deltaX, deltaY\)/);
    assert.match(panel, /resizePlannerWindowRect\(windowInteraction\.rect, windowInteraction\.direction, deltaX, deltaY\)/);
    assert.match(panel, /window\.addEventListener\("pointermove", move\)/);
    assert.match(panel, /window\.addEventListener\("pointerup", stop\)/);
    assert.match(panel, /window\.addEventListener\("pointercancel", stop\)/);
    assert.match(panel, /window\.removeEventListener\("pointermove", move\)/);
    assert.match(panel, /window\.removeEventListener\("pointerup", stop\)/);
    assert.match(panel, /window\.removeEventListener\("pointercancel", stop\)/);
    assert.match(panel, /className="orbit-planner-header orbit-planner-drag-handle"/);
    assert.match(panel, /PLANNER_RESIZE_DIRECTIONS\.map\(\(direction\) => <span[\s\S]*className="orbit-planner-resize-handle"[\s\S]*data-direction=\{direction\}/);
    assert.match(panel, /isPlannerWindowCompactViewport\(\) \? undefined : \{/);

    assert.match(panel, /orbit-planner-forecast\$\{showDetail \? " is-expanded" : " is-compact"\}/);
    assert.match(panel, /aria-expanded=\{showDetail\}/);
    assert.match(panel, /orbit-planner-request-toast/);
    assert.match(panel, /PLANNER_REQUEST_MESSAGE_TIMEOUT_MS = 4_500/);

    assert.match(panelCss, /\.orbit-planner-panel \{[\s\S]*position: absolute;[\s\S]*overflow: hidden;[\s\S]*container-name: orbit-planner-panel;/);
    for (const direction of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
        assert.match(panelCss, new RegExp(`\\.orbit-planner-resize-handle\\[data-direction="${direction}"\\]`));
    }
    assert.match(panelCss, /@container orbit-planner-panel \(max-width: 960px\)/);
    assert.match(panelCss, /@container orbit-planner-panel \(max-width: 780px\)/);
    assert.match(panelCss, /@media \(max-width: 680px\)[\s\S]*\.orbit-planner-panel \{[\s\S]*inset: 0 !important;[\s\S]*width: 100% !important;[\s\S]*height: 100vh !important;/);
    assert.match(panelCss, /@media \(max-width: 680px\)[\s\S]*\.orbit-planner-resize-handle \{[\s\S]*display: none;/);
});
