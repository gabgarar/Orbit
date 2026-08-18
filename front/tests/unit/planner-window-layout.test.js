import assert from "node:assert/strict";
import test from "node:test";

import {
    PLANNER_WINDOW_MARGIN,
    initialPlannerWindowRect,
    isPlannerWindowCompactViewport,
    movePlannerWindowRect,
    normalizePlannerWindowRect,
    plannerWindowViewport,
    resizePlannerWindowRect
} from "../../../react-ui/src/features/planner/plannerWindowLayout.js";

function assertFitsViewport(rect, viewport) {
    assert.ok(rect.width <= viewport.width - (PLANNER_WINDOW_MARGIN * 2));
    assert.ok(rect.height <= viewport.height - (PLANNER_WINDOW_MARGIN * 2));
    assert.ok(rect.x >= PLANNER_WINDOW_MARGIN);
    assert.ok(rect.y >= PLANNER_WINDOW_MARGIN);
    assert.ok(rect.x + rect.width <= viewport.width - PLANNER_WINDOW_MARGIN);
    assert.ok(rect.y + rect.height <= viewport.height - PLANNER_WINDOW_MARGIN);
}

test("planner window geometry always fits a desktop, narrow, or corrupted viewport", () => {
    assert.deepEqual(plannerWindowViewport({ width: 0, height: 0 }), { width: 320, height: 320 });
    assert.deepEqual(plannerWindowViewport({ innerWidth: 715, innerHeight: 503 }), { width: 715, height: 503 });
    assert.equal(isPlannerWindowCompactViewport({ width: 680, height: 720 }), true);
    assert.equal(isPlannerWindowCompactViewport({ width: 681, height: 720 }), false);

    const desktop = { width: 1000, height: 600 };
    const clamped = normalizePlannerWindowRect({ x: -40, y: 9999, width: 9999, height: 9999 }, desktop);
    assert.deepEqual(clamped, { x: 12, y: 12, width: 976, height: 576 });
    assertFitsViewport(clamped, desktop);

    const narrow = { width: 420, height: 340 };
    const tiny = normalizePlannerWindowRect({ x: -400, y: -200, width: 10, height: 10 }, narrow);
    assertFitsViewport(tiny, narrow);
    assert.deepEqual(tiny, { x: 12, y: 12, width: 396, height: 316 });
});

test("planner opens with a fresh default rectangle on every mount", () => {
    const desktop = { width: 1600, height: 1000 };
    const firstOpening = initialPlannerWindowRect(desktop);
    const movedDuringSession = movePlannerWindowRect(firstOpening, 220, 140, desktop);
    const nextOpening = initialPlannerWindowRect(desktop);

    assert.notDeepEqual(movedDuringSession, firstOpening);
    assert.deepEqual(nextOpening, firstOpening);
    assertFitsViewport(nextOpening, desktop);
});

test("planner drag and eight-edge resize retain safe opposite edges without escape", () => {
    const viewport = { width: 1800, height: 1000 };
    const initial = { x: 100, y: 100, width: 800, height: 600 };

    const moved = movePlannerWindowRect(initial, -1000, 1000, viewport);
    assertFitsViewport(moved, viewport);
    assert.equal(moved.x, PLANNER_WINDOW_MARGIN);
    assert.equal(moved.y + moved.height, viewport.height - PLANNER_WINDOW_MARGIN);

    const west = resizePlannerWindowRect(initial, "w", 100, 0, viewport);
    assert.equal(west.x + west.width, initial.x + initial.width);
    assert.equal(west.y, initial.y);
    assertFitsViewport(west, viewport);

    const northWest = resizePlannerWindowRect(initial, "nw", 60, 40, viewport);
    assert.equal(northWest.x + northWest.width, initial.x + initial.width);
    assert.equal(northWest.y + northWest.height, initial.y + initial.height);
    assertFitsViewport(northWest, viewport);

    const southEast = resizePlannerWindowRect(initial, "se", 2000, 2000, viewport);
    assertFitsViewport(southEast, viewport);
    assert.equal(southEast.x, initial.x);
    assert.equal(southEast.y, initial.y);
});
