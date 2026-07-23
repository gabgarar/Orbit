import assert from "node:assert/strict";
import test from "node:test";

import { layoutVectorLabelOffsets } from "../../js/runtime/vectorLabelLayout.js";

function rect(entry, offset) {
    const centerX = entry.x + offset.x;
    const width = Math.max(18, entry.label.length * 6.1 + 10);
    const baselineY = entry.y + offset.y;
    return { left: centerX - width / 2, right: centerX + width / 2, top: baselineY - 13, bottom: baselineY + 5 };
}

function overlaps(left, right) {
    const gap = 4;
    return left.left < right.right + gap
        && left.right + gap > right.left
        && left.top < right.bottom + gap
        && left.bottom + gap > right.top;
}

test("keeps the normal label position when vector tips are already separate", () => {
    const offsets = layoutVectorLabelOffsets([
        { x: 50, y: 80, label: "Sol" },
        { x: 260, y: 160, label: "Luna" }
    ], { width: 400, height: 300 });

    assert.deepEqual(offsets, [{ x: 0, y: -7 }, { x: 0, y: -7 }]);
});

test("fans out labels when illumination or force arrows share a screen area", () => {
    const entries = [
        { x: 180, y: 120, label: "Sol" },
        { x: 184, y: 121, label: "Luna" },
        { x: 181, y: 122, label: "F DRAG" }
    ];
    const offsets = layoutVectorLabelOffsets(entries, { width: 420, height: 260 });

    assert.equal(offsets.length, entries.length);
    assert.notDeepEqual(offsets[0], offsets[1]);
    assert.notDeepEqual(offsets[1], offsets[2]);
    const rectangles = entries.map((entry, index) => rect(entry, offsets[index]));
    assert.equal(overlaps(rectangles[0], rectangles[1]), false);
    assert.equal(overlaps(rectangles[0], rectangles[2]), false);
    assert.equal(overlaps(rectangles[1], rectangles[2]), false);
});

test("does not displace labels with no current canvas projection", () => {
    const offsets = layoutVectorLabelOffsets([
        { x: 100, y: 100, label: "X" },
        { x: Number.NaN, y: 100, label: "Luna" }
    ]);

    assert.deepEqual(offsets[1], { x: 0, y: -7 });
});
