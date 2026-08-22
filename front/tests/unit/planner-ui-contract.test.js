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
    isPlannerEopRangeEvent,
    layoutPlannerEventLanes,
    makeManualEventPayload,
    normalizePlannerUiState,
    parseUtcInput,
    plannerEventActivation,
    plannerEventDescription,
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
    assert.match(panelCss, /\.orbit-planner-detail-body \{[\s\S]*overflow-y: auto;/);
    assert.match(panelCss, /\.orbit-planner-time-scroll::\-webkit-scrollbar,[\s\S]*\.orbit-planner-detail-body::\-webkit-scrollbar/);
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
    assert.deepEqual(plannerViewRangePayload("week", "2026-08-23T23:59:59Z"), {
        view: "week",
        startTime: "2026-08-17T00:00:00.000Z",
        endTime: "2026-08-24T00:00:00.000Z"
    }, "UTC Sunday remains the final day of a Monday-first week");
    assert.deepEqual(plannerViewRangePayload("month", "2026-02-12T12:00:00Z"), {
        view: "month",
        startTime: "2026-02-01T00:00:00.000Z",
        endTime: "2026-03-01T00:00:00.000Z"
    });
    assert.match(panel, /const goToToday = \(\) => \{[\s\S]*setCursor\(utcDay\(\)\);[\s\S]*setView\("day"\);/);
    assert.match(panel, /className="orbit-planner-today" title="Ir al día actual en UTC" onClick=\{goToToday\}/);
    assert.match(panel, /className="orbit-planner-range-stepper"/);
    assert.match(panel, /className="orbit-planner-period-value"/);
    assert.match(panel, /<ChevronDownIcon\s*\/>/);
    assert.match(panel, /type="month"/);
    assert.match(panel, /Seleccionar mes y año en UTC/);
    assert.doesNotMatch(panel, /rangeTitle\(/);
    assert.match(panel, /ORBIT_PLANNER_VIEW_RANGE_EVENT/);
    assert.match(panel, /plannerViewRangePayload\(view, cursor\)/);
    assert.match(panel, /const WEEKDAY_LABELS = \["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"\]/);
    assert.match(panel, /const mondayOffset = \(value\.getUTCDay\(\) \+ 6\) % 7;/);
    assert.match(panel, /const gridStart = startOfUtcWeek\(first\);/);
    assert.match(panel, /const start = view === "week" \? startOfUtcWeek\(cursor\) : utcDay\(cursor\);/);
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

test("static and realtime remain useful planner contexts without redundant summary chrome", () => {
    assert.match(panel, /function plannerMode\(context\)/);
    assert.doesNotMatch(panel, /plannerModeDescription/);
    assert.doesNotMatch(panel, /plannerModeLabel/);
    assert.doesNotMatch(panel, /orbit-planner-mode/);
    assert.doesNotMatch(panelCss, /\.orbit-planner-mode/);
    assert.match(panel, /plannerEventActivation\(selected, plannerState\.context\)/);
    assert.doesNotMatch(panel, /canActivate=\{mode === "simulated"\}/);
    assert.doesNotMatch(panel, /orbit-planner-forecast/);
    assert.match(panel, /orbit-planner-status/);
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
        color: PLANNER_COLOR_TOKENS.PURPLE,
        description: "Coordinar antena y equipo RF."
    }, "manual-test");
    assert.equal(created.ok, true);
    assert.equal(created.event.kind, "manual");
    assert.equal(created.event.colorToken, "purple");
    assert.equal(created.event.start, "2026-08-18T14:30:00.000Z");
    assert.equal(created.event.metadata.description, "Coordinar antena y equipo RF.");
    assert.equal(plannerEventDescription(created.event), "Coordinar antena y equipo RF.");
    assert.equal(plannerEventDescription({ metadata: { details: "Detalle generado por una carga local." } }), "Detalle generado por una carga local.");
    const rejected = makeManualEventPayload({ title: "No", start: "2026-08-18T15:00", end: "2026-08-18T15:00" });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /fin debe ser posterior/i);
    assert.equal(ORBIT_PLANNER_MANUAL_EVENT_UPSERT_EVENT, "orbit:planner-manual-event-upsert");
    assert.equal(ORBIT_PLANNER_MANUAL_EVENT_REMOVE_EVENT, "orbit:planner-manual-event-remove");
    assert.match(panel, /ORBIT_PLANNER_MANUAL_EVENT_UPSERT_EVENT/);
    assert.match(panel, /ORBIT_PLANNER_MANUAL_EVENT_REMOVE_EVENT/);
    assert.match(panel, /Detalles \(opcional\)<textarea/);
    assert.match(panel, /plannerEventDescription\(event\)/);
});

test("event details have bottom icon pagination across every visible filtered event", () => {
    assert.match(panel, /const selectedEventIndex = useMemo\(\(\) => visibleEvents\.findIndex/);
    assert.match(panel, /const selectAdjacentEvent = \(direction\) => \{/);
    assert.match(panel, /plannerAdjacentVisibleEvent\(visibleEvents, selectedEvent\?\.id, direction\)/);
    assert.match(panel, /plannerCursorForEvent\(next\)/);
    assert.match(panel, /plannerEventIsInView\(next, \{ start: viewRange\.startTime, end: viewRange\.endTime \}\)/);
    assert.match(panel, /eventCount=\{visibleEvents\.length\}/);
    assert.match(panel, /<nav className="orbit-planner-detail-pager" aria-label="Navegación entre todos los eventos visibles">/);
    assert.match(panel, /aria-label="Evento anterior"/);
    assert.match(panel, /aria-label="Evento siguiente"/);
    assert.match(panel, /\{safeIndex \+ 1\}\/\{safeCount\}/);
    assert.match(panelCss, /\.orbit-planner-detail-pager \{[\s\S]*border-top: 1px solid #294562;/);
    assert.match(panelCss, /\.orbit-planner-detail-pager-button \{[\s\S]*width: 28px;[\s\S]*height: 28px;/);
});

test("event activation only dispatches a usable UTC instant and keeps overlapping ERP ranges actionable", () => {
    const context = {
        simulation: {
            mode: "range",
            startTime: "2026-08-10T00:00:00.000Z",
            endTime: "2026-08-20T00:00:00.000Z",
            masterTimeRange: {
                startDate: "2026-08-11T00:00:00.000Z",
                endDate: "2026-08-19T00:00:00.000Z"
            }
        }
    };
    const overlap = plannerEventActivation({
        start: "2026-08-01T00:00:00.000Z",
        end: "2026-08-25T00:00:00.000Z",
        metadata: { eopRange: true }
    }, context);
    assert.deepEqual(overlap, {
        enabled: true,
        targetTime: "2026-08-11T00:00:00.000Z",
        reason: ""
    });
    const outside = plannerEventActivation({ start: "2026-08-30T00:00:00.000Z" }, context);
    assert.equal(outside.enabled, false);
    assert.match(outside.reason, /fuera del intervalo de simulación activo/i);
    const staticMode = plannerEventActivation({ start: "2026-08-12T00:00:00.000Z" }, {
        simulation: { ...context.simulation, mode: "static" }
    });
    assert.equal(staticMode.enabled, false);
    assert.match(staticMode.reason, /cambia a simulated/i);
    assert.match(panel, /const selectedActivation = useMemo\(\(\) => plannerEventActivation\(selected, plannerState\.context\)/);
    assert.match(panel, /detail: \{ \.\.\.event, time: activation\.targetTime \}/);
    assert.match(panel, /orbit-planner-detail-activation-note/);
    assert.match(panel, /ORBIT_PLANNER_VIEW_RANGE_REBASE_EVENT/);
    assert.match(panel, /window\.addEventListener\(ORBIT_PLANNER_VIEW_RANGE_REBASE_EVENT, rebaseViewRange\)/);
});

test("UI consumes semantic planner kinds and colour tokens instead of a parallel event schema", () => {
    assert.match(panel, /PLANNER_EVENT_KINDS\.MANUAL/);
    assert.match(panel, /event\.colorToken/);
    assert.doesNotMatch(panel, /event\.eventType/);
});

test("finite EOP source coverage is rendered as a range only when the runtime marks it", () => {
    assert.equal(isPlannerEopRangeEvent({
        start: "2026-07-20T00:00:00Z",
        end: "2026-08-20T00:00:00Z",
        isPoint: false,
        metadata: { resourceType: "erp", eopRange: true }
    }), true);
    assert.equal(isPlannerEopRangeEvent({
        start: "2026-07-20T00:00:00Z",
        end: "2026-08-20T00:00:00Z",
        isPoint: false,
        metadata: { resourceType: "erp" }
    }), false, "legacy boundary facts remain discrete events");
    assert.equal(isPlannerEopRangeEvent({
        start: "2026-09-20T00:00:00Z",
        isPoint: true,
        metadata: { resourceType: "erp", eopRange: true, openEnded: true }
    }), false, "an open-ended nominal fallback must not be drawn as a finite rail");
    assert.match(panel, /isPlannerEopRangeEvent/);
    assert.match(panel, /orbit-planner-month-eop-ranges/);
    assert.match(panel, /orbit-planner-time-eop-ranges/);
    assert.match(panel, /buildPlannerCoverageSegments/);
    assert.match(panel, /const eopRangeSegments = buildPlannerCoverageSegments/);
    assert.match(panel, /gridColumnOffset=\{2\}/);
});

test("top period arrows centre their SVG glyphs inside their buttons", () => {
    assert.match(panel, /className="orbit-planner-icon-button"/);
    assert.match(panelCss, /\.orbit-planner-icon-button \{[\s\S]*display: inline-grid;[\s\S]*width: 28px;[\s\S]*height: 28px;[\s\S]*box-sizing: border-box;[\s\S]*place-items: center;/);
    assert.match(panelCss, /\.orbit-planner-navigation button\.orbit-planner-icon-button \{[\s\S]*padding: 0;[\s\S]*line-height: 0;/);
    assert.match(panelCss, /\.orbit-planner-icon-button > svg \{[\s\S]*display: block;[\s\S]*margin: auto;/);
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

    assert.doesNotMatch(panel, /orbit-planner-forecast/);
    assert.doesNotMatch(panel, /orbit-planner-eop-notice/);
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
