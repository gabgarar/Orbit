import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelSource = readFileSync(
    new URL("../../../react-ui/src/components/ManualOrbitPanel.jsx", import.meta.url),
    "utf8"
);

test("a restored manual preview rehydrates the controlled form and clears the busy UI", () => {
    // `form` owns the checked force controls. The runtime's rollback must
    // therefore arrive through the normal state hydration path, rather than
    // merely redrawing Cesium behind an unchanged draft.
    assert.match(panelSource, /const next = mergeIncomingForm\(current, detail\);/);
    assert.match(panelSource, /if \(detail\.previewRestored === true\) formRef\.current = next;/);
    const rollbackStart = panelSource.indexOf('if (detail.previewRestored === true) {');
    const rollbackEnd = panelSource.indexOf('        };\n        const onStatus', rollbackStart);
    assert.ok(rollbackStart >= 0 && rollbackEnd > rollbackStart, "the panel must handle the restoration marker inside its state listener");
    const rollbackHandler = panelSource.slice(rollbackStart, rollbackEnd);
    assert.match(rollbackHandler, /kind: "info"/);
    assert.match(rollbackHandler, /previewRestoreMessage/);

    // A rollback is a completed cancellation, not an error or an active
    // creation request. The explicit information tone also makes the result
    // visible to the operator rather than silently dropping `info` statuses.
    assert.match(panelSource, /\["error", "busy", "success", "warning", "info"\]\.includes\(detail\.kind\)/);
    assert.match(panelSource, /status\?\.kind === "info"[\s\S]*border-\[#315a91\]/);
    assert.doesNotMatch(rollbackHandler, /kind:\s*"busy"/);
});
