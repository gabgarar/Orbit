// Keeps the small labels attached to the attitude/illumination vectors legible
// when two or more arrow tips project to the same part of the canvas.  This is
// deliberately screen-space work: vectors that are well separated in ECEF can
// still overlap from the current camera angle.

const DEFAULT_OFFSET = Object.freeze({ x: 0, y: -7 });
const LABEL_HEIGHT = 18;
const LABEL_CHAR_WIDTH = 6.1;
const LABEL_HORIZONTAL_PADDING = 10;
const LABEL_GAP = 4;

// The first candidate retains the original visual position.  Subsequent
// candidates fan labels out in small, symmetric steps before using wider
// rows, so a cluster remains associated with its arrow tips instead of
// becoming an arbitrary vertical list.
const OFFSET_CANDIDATES = Object.freeze([
    [0, -7], [14, -18], [-14, -18], [0, -30],
    [24, -32], [-24, -32], [0, 12], [22, 11], [-22, 11],
    [0, -49], [34, -46], [-34, -46], [0, 31], [34, 29], [-34, 29],
    [0, -68], [46, -62], [-46, -62], [0, 50]
]);

function number(value) {
    return Number.isFinite(value) ? value : null;
}

function labelWidth(label) {
    return Math.max(18, String(label || "").length * LABEL_CHAR_WIDTH + LABEL_HORIZONTAL_PADDING);
}

function boundsFor({ x, y, label }, offset) {
    const centerX = x + offset.x;
    // Cesium's default label origin is baseline-oriented.  These values leave
    // enough room for its background rectangle and its 10 px glyph height.
    const baselineY = y + offset.y;
    const halfWidth = labelWidth(label) / 2;
    return {
        left: centerX - halfWidth,
        right: centerX + halfWidth,
        top: baselineY - 13,
        bottom: baselineY + 5
    };
}

function overlaps(left, right) {
    return left.left < right.right + LABEL_GAP
        && left.right + LABEL_GAP > right.left
        && left.top < right.bottom + LABEL_GAP
        && left.bottom + LABEL_GAP > right.top;
}

function candidateOffset(candidate) {
    return { x: candidate[0], y: candidate[1] };
}

function overflowPenalty(bounds, viewport) {
    if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) return 0;
    return Math.max(0, -bounds.left)
        + Math.max(0, bounds.right - viewport.width)
        + Math.max(0, -bounds.top)
        + Math.max(0, bounds.bottom - viewport.height);
}

/**
 * Assigns compact, non-overlapping offsets to labels whose screen anchors are
 * close together.  Entries without a valid projection preserve the ordinary
 * offset because they are not visible on the canvas at that instant.
 *
 * The routine is pure so the rendering bridge can recalculate it safely from
 * Cesium CallbackProperty values, and so collision behaviour remains tested
 * without a WebGL scene.
 */
export function layoutVectorLabelOffsets(entries, viewport = null) {
    const offsets = Array.from(entries || [], () => ({ ...DEFAULT_OFFSET }));
    const placed = [];

    (entries || []).forEach((entry, index) => {
        const x = number(entry?.x);
        const y = number(entry?.y);
        if (x === null || y === null) return;

        const anchor = { x, y, label: entry?.label };
        let best = null;

        for (const candidate of OFFSET_CANDIDATES) {
            const offset = candidateOffset(candidate);
            const bounds = boundsFor(anchor, offset);
            if (placed.some((other) => overlaps(bounds, other))) continue;
            const next = { offset, bounds, penalty: overflowPenalty(bounds, viewport) };
            if (!best || next.penalty < best.penalty) best = next;
            // Retain the established placement whenever it is in view.  This
            // avoids reordering a stable group merely because a later option
            // would be a few pixels nearer to an edge.
            if (next.penalty === 0) break;
        }

        // A very dense cluster can exhaust the compact positions.  Stack any
        // remaining labels with a deterministic extra row; it is preferable
        // to a collision and remains visually tied to its original arrow.
        if (!best) {
            const overflowIndex = Math.max(0, index - OFFSET_CANDIDATES.length + 1);
            const offset = { x: overflowIndex % 2 ? 42 : -42, y: -82 - (overflowIndex * 20) };
            best = { offset, bounds: boundsFor(anchor, offset), penalty: 0 };
        }

        offsets[index] = best.offset;
        placed.push(best.bounds);
    });

    return offsets;
}

