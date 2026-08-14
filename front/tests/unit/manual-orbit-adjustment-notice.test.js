import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panelSource = readFileSync(
    new URL("../../../react-ui/src/components/ManualOrbitPanel.jsx", import.meta.url),
    "utf8"
);
const runtimeSource = readFileSync(new URL("../../main.js", import.meta.url), "utf8");

test("a server-side geopotential clamp remains visible after the manual editor closes", () => {
    const closeIndex = runtimeSource.indexOf('publishManualOrbitState({ open: false });');
    const warningIndex = runtimeSource.indexOf('geopotentialAdjustment ? "warning" : "success"');
    assert.ok(closeIndex >= 0, "creation must close the editor after committing the orbit");
    assert.ok(warningIndex > closeIndex, "the clamp warning is emitted after the closing state");

    // The component remains mounted while closed, so this branch is the actual
    // event-to-visible-surface path rather than a source-only success message.
    assert.match(panelSource, /if \(!open\) \{[\s\S]*status\?\.kind !== "warning"[\s\S]*manual-orbit-adjustment-notice/);
    assert.match(panelSource, /window\.setTimeout\(\(\) => setStatus\(null\), 12_000\)/);
    assert.match(panelSource, /role="status"[\s\S]*aria-live="polite"/);
});
