import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
    ORBIT_PLANNER_MANUAL_EVENT_REMOVE_EVENT,
    ORBIT_PLANNER_MANUAL_EVENT_UPSERT_EVENT,
    ORBIT_PLANNER_CLOSE_EVENT,
    ORBIT_PLANNER_OPEN_EVENT,
    ORBIT_PLANNER_STATE_EVENT,
    ORBIT_PLANNER_STATE_REQUEST_EVENT,
    PLANNER_COLOR_TOKENS,
    formatUtcInput,
    layoutPlannerEventLanes,
    makeManualEventPayload,
    parseUtcInput
} from "../../../react-ui/src/features/planner/plannerUiModel.js";

const panel = readFileSync(new URL("../../../react-ui/src/features/planner/PlannerPanel.jsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../../react-ui/src/App.jsx", import.meta.url), "utf8");
const toolbar = readFileSync(new URL("../../../react-ui/src/components/layout/TopToolbar.jsx", import.meta.url), "utf8");
const toolbarCss = readFileSync(new URL("../../../react-ui/src/components/layout/TopToolbar.css", import.meta.url), "utf8");

test("planner trigger is an accessible icon immediately after Analytics navigation", () => {
    assert.match(toolbar, /id="topPlannerBtn"/);
    assert.match(toolbar, /aria-label="Planificador"/);
    assert.match(toolbar, /<CalendarIcon\s*\/>/);
    assert.match(toolbar, /aria-controls="orbitPlannerPanel"/);
    assert.match(panel, /id="orbitPlannerPanel"/);
    assert.match(toolbar, /\{navigation\.map[\s\S]*topPlannerBtn[\s\S]*<\/nav>/);
    assert.match(toolbarCss, /toolbar-planner-btn/);
    assert.match(app, /<PlannerPanel/);
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
