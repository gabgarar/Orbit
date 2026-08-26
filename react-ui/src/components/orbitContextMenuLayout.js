const ORBIT_CONTEXT_MENU_WIDTH = 286;
const ORBIT_CONTEXT_MENU_GAP = 8;

function clampContextMenuCoordinate(value, lower, upper) {
    return Math.min(Math.max(value, lower), Math.max(lower, upper));
}

/**
 * Place a child menu alongside its parent without allowing it to escape the
 * viewport. It deliberately opens to the left near the right edge, which
 * keeps a right-click menu usable over the timeline and side inspectors.
 */
export function getOrbitContextSubmenuPosition(menu, {
    level = 1,
    height = 240,
    viewportWidth = typeof window === "undefined" ? ORBIT_CONTEXT_MENU_WIDTH * 2 : window.innerWidth,
    viewportHeight = typeof window === "undefined" ? height + (ORBIT_CONTEXT_MENU_GAP * 2) : window.innerHeight
} = {}) {
    const parentLeft = Number(menu?.left) || ORBIT_CONTEXT_MENU_GAP;
    const parentTop = Number(menu?.top) || ORBIT_CONTEXT_MENU_GAP;
    const rightCandidate = parentLeft + ORBIT_CONTEXT_MENU_WIDTH - 14;
    const left = rightCandidate + ORBIT_CONTEXT_MENU_WIDTH + ORBIT_CONTEXT_MENU_GAP <= viewportWidth
        ? rightCandidate
        : clampContextMenuCoordinate(
            parentLeft - ORBIT_CONTEXT_MENU_WIDTH + 14,
            ORBIT_CONTEXT_MENU_GAP,
            viewportWidth - ORBIT_CONTEXT_MENU_WIDTH - ORBIT_CONTEXT_MENU_GAP
        );
    const top = clampContextMenuCoordinate(
        parentTop + 36 + (level * 4),
        ORBIT_CONTEXT_MENU_GAP,
        viewportHeight - height - ORBIT_CONTEXT_MENU_GAP
    );

    return { left, top };
}
