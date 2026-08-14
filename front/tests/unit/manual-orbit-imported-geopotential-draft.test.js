import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { preserveImportedIntegerDraft } from "../../js/features/manualOrbit/editorState.js";

const panelSource = readFileSync(
    new URL("../../../react-ui/src/components/ManualOrbitPanel.jsx", import.meta.url),
    "utf8"
);

test("an imported unsupported geopotential N/M remains authored until explicitly changed", () => {
    // A project can predate the current archive or execution profile. These
    // values must reach the UI preflight unchanged, where they are blocked and
    // explained; importing must not turn them into a different request.
    assert.equal(preserveImportedIntegerDraft(5000, 4), 5000);
    assert.equal(preserveImportedIntegerDraft(5001, 0), 5001);
    assert.equal(preserveImportedIntegerDraft(2190, 4), 2190);

    // Guard the actual React hydration boundary, not only the pure helper.
    assert.match(panelSource, /const geopotentialDegree = preserveImportedIntegerDraft\(/);
    assert.match(panelSource, /const geopotentialOrder = preserveImportedIntegerDraft\(/);
});
