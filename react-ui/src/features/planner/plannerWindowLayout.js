/**
 * Geometry for the floating Planner surface.
 *
 * This module deliberately has no React dependency so the interaction stays
 * testable. Geometry is intentionally session-only: reopening the agenda
 * starts from the default rect instead of retaining a previous workspace.
 */

export const PLANNER_WINDOW_MARGIN = 12;
export const PLANNER_WINDOW_COMPACT_BREAKPOINT = 680;
export const PLANNER_WINDOW_DEFAULT = Object.freeze({ width: 1220, height: 840 });
export const PLANNER_WINDOW_MINIMUM = Object.freeze({ width: 760, height: 500 });

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

function sourceViewport(value) {
    if (value && typeof value === "object"
        && Number.isFinite(Number(value.innerWidth ?? value.width))
        && Number.isFinite(Number(value.innerHeight ?? value.height))) {
        return value;
    }
    if (typeof window !== "undefined") return window;
    return null;
}

/**
 * Normalize a viewport-like object without depending on `window` in tests or
 * server-side rendering. The lower bound is intentional: a tiny embedded
 * viewport still gets a usable, clamped planner instead of NaN geometry.
 */
export function plannerWindowViewport(value) {
    const source = sourceViewport(value);
    const width = finiteNumber(source?.innerWidth ?? source?.width) ?? 1440;
    const height = finiteNumber(source?.innerHeight ?? source?.height) ?? 900;
    return { width: Math.max(320, width), height: Math.max(320, height) };
}

export function isPlannerWindowCompactViewport(viewport = plannerWindowViewport()) {
    return plannerWindowViewport(viewport).width <= PLANNER_WINDOW_COMPACT_BREAKPOINT;
}

function boundsFor(viewport) {
    const normalizedViewport = plannerWindowViewport(viewport);
    const availableWidth = Math.max(1, normalizedViewport.width - (PLANNER_WINDOW_MARGIN * 2));
    const availableHeight = Math.max(1, normalizedViewport.height - (PLANNER_WINDOW_MARGIN * 2));
    return {
        viewport: normalizedViewport,
        availableWidth,
        availableHeight,
        minimumWidth: Math.min(PLANNER_WINDOW_MINIMUM.width, availableWidth),
        minimumHeight: Math.min(PLANNER_WINDOW_MINIMUM.height, availableHeight)
    };
}

function preferredValue(value, fallback, minimum, maximum) {
    const number = finiteNumber(value);
    return clamp(number === null ? fallback : number, minimum, maximum);
}

/**
 * Keep every saved or pointer-produced rectangle entirely inside the current
 * viewport. Missing dimensions use a centered, operator-friendly default.
 */
export function normalizePlannerWindowRect(rect, viewport = plannerWindowViewport()) {
    const source = rect && typeof rect === "object" ? rect : {};
    const bounds = boundsFor(viewport);
    const width = preferredValue(source.width, PLANNER_WINDOW_DEFAULT.width, bounds.minimumWidth, bounds.availableWidth);
    const height = preferredValue(source.height, PLANNER_WINDOW_DEFAULT.height, bounds.minimumHeight, bounds.availableHeight);
    const defaultX = Math.round((bounds.viewport.width - width) / 2);
    const defaultY = Math.round((bounds.viewport.height - height) / 2);
    return {
        x: Math.round(preferredValue(source.x, defaultX, PLANNER_WINDOW_MARGIN, Math.max(PLANNER_WINDOW_MARGIN, bounds.viewport.width - width - PLANNER_WINDOW_MARGIN))),
        y: Math.round(preferredValue(source.y, defaultY, PLANNER_WINDOW_MARGIN, Math.max(PLANNER_WINDOW_MARGIN, bounds.viewport.height - height - PLANNER_WINDOW_MARGIN))),
        width: Math.round(width),
        height: Math.round(height)
    };
}

/** A fresh agenda always opens in the default centered working rectangle. */
export function initialPlannerWindowRect(viewport = plannerWindowViewport()) {
    return normalizePlannerWindowRect(null, viewport);
}

/** Move while retaining the entire rectangle within the viewport margin. */
export function movePlannerWindowRect(rect, deltaX, deltaY, viewport = plannerWindowViewport()) {
    const initial = normalizePlannerWindowRect(rect, viewport);
    const bounds = boundsFor(viewport);
    const x = initial.x + (finiteNumber(deltaX) ?? 0);
    const y = initial.y + (finiteNumber(deltaY) ?? 0);
    return normalizePlannerWindowRect({ ...initial, x, y }, bounds.viewport);
}

/**
 * Resize from any edge/corner. West/north retain their opposite edge, which
 * makes pointer resizing feel stable rather than re-centring the modal.
 */
export function resizePlannerWindowRect(rect, direction, deltaX, deltaY, viewport = plannerWindowViewport()) {
    const initial = normalizePlannerWindowRect(rect, viewport);
    const bounds = boundsFor(viewport);
    const horizontal = String(direction || "").toLowerCase();
    const dx = finiteNumber(deltaX) ?? 0;
    const dy = finiteNumber(deltaY) ?? 0;
    const right = initial.x + initial.width;
    const bottom = initial.y + initial.height;
    let { x, y, width, height } = initial;

    if (horizontal.includes("e")) {
        width = clamp(initial.width + dx, bounds.minimumWidth, Math.max(bounds.minimumWidth, bounds.viewport.width - initial.x - PLANNER_WINDOW_MARGIN));
    }
    if (horizontal.includes("w")) {
        width = clamp(initial.width - dx, bounds.minimumWidth, Math.max(bounds.minimumWidth, right - PLANNER_WINDOW_MARGIN));
        x = right - width;
    }
    if (horizontal.includes("s")) {
        height = clamp(initial.height + dy, bounds.minimumHeight, Math.max(bounds.minimumHeight, bounds.viewport.height - initial.y - PLANNER_WINDOW_MARGIN));
    }
    if (horizontal.includes("n")) {
        height = clamp(initial.height - dy, bounds.minimumHeight, Math.max(bounds.minimumHeight, bottom - PLANNER_WINDOW_MARGIN));
        y = bottom - height;
    }
    return normalizePlannerWindowRect({ x, y, width, height }, bounds.viewport);
}
