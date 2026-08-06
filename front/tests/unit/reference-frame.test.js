import assert from "node:assert/strict";
import test from "node:test";

import {
    formatReferenceFrame,
    normalizeManualOrbitPreviewReferenceFrame
} from "../../js/features/frames/referenceFrame.js";

test("reference-frame presentation preserves declared frames and canonicalizes known names", () => {
    assert.equal(formatReferenceFrame(" teme "), "TEME");
    assert.equal(formatReferenceFrame({ name: "itrf" }), "ITRF");
    assert.equal(formatReferenceFrame("IGS20"), "IGS20");
    assert.equal(formatReferenceFrame("ITRF / ECEF"), "ITRF / ECEF");
});

test("manual preview accepts legacy aliases without exposing them as canonical frames", () => {
    assert.equal(normalizeManualOrbitPreviewReferenceFrame("ECI"), "eme2000");
    assert.equal(normalizeManualOrbitPreviewReferenceFrame("ECEF"), "itrf");
    assert.equal(normalizeManualOrbitPreviewReferenceFrame("unknown", "itrf"), "itrf");
});
