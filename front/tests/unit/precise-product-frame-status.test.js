import assert from "node:assert/strict";
import test from "node:test";

import { resolvePreciseProductFrameStatus } from "../../js/features/preciseProducts/frameStatus.js";

test("a native-only precise product keeps its declared realization instead of claiming ITRF", () => {
    const status = resolvePreciseProductFrameStatus({
        sp3: {
            native_reference_frame: "IGS20",
            reference_frame: "ITRF",
            rendering: {
                available: false,
                source_frame: "IGS20",
                target_frame: "ITRF",
                reason: "No IGS20 realization operation is configured."
            }
        }
    }, { runtimeFrame: "ITRF" });

    assert.equal(status.nativeFrame, "IGS20");
    assert.equal(status.returnedFrame, "ITRF");
    assert.equal(status.displayFrame, "IGS20");
    assert.equal(status.available, false);
    assert.match(status.renderingLabel, /^No disponible:/);
});

test("an Earth-fixed visual fallback is explicitly qualified when EOP quality is approximate", () => {
    const status = resolvePreciseProductFrameStatus({
        sp3: {
            renderer_reference: {
                status: "approximate_earth_fixed",
                reference_frame: "ITRF",
                display_label: "ITRF visual fallback",
                earth_orientation: { quality: "approximate", source: "visual-fallback" }
            },
            native_frame: { name: "IGS", realization: "IGC20", center: "EARTH", time_scale: "UTC" }
        }
    }, { runtimeFrame: "ITRF" });

    assert.equal(status.nativeFrame, "IGC20");
    assert.equal(status.returnedFrame, "ITRF");
    assert.equal(status.approximate, true);
    assert.equal(status.displayFrame, "Terrestre aproximado (sin EOP)");
    assert.equal(status.renderingLabel, "Terrestre aproximado (sin EOP)");
});

test("legacy products without renderer provenance show their native frame rather than an unverified ITRF label", () => {
    const status = resolvePreciseProductFrameStatus({
        sp3: {
            native_reference_frame: "IGS14",
            reference_frame: "ITRF"
        }
    }, { runtimeFrame: "ITRF" });

    assert.equal(status.nativeFrame, "IGS14");
    assert.equal(status.displayFrame, "IGS14");
    assert.equal(status.unverifiedTerrestrialTransform, true);
    assert.match(status.renderingLabel, /^No verificado:/);
});

test("a legacy SP3 declaring only ITRF is qualified instead of presented as precise terrestrial output", () => {
    const status = resolvePreciseProductFrameStatus({
        sp3: { reference_frame: "ITRF" }
    }, { runtimeFrame: "ITRF" });

    assert.equal(status.nativeFrame, "ITRF");
    assert.equal(status.displayFrame, "ITRF nativo (sin EOP declarado)");
    assert.equal(status.unverifiedTerrestrialTransform, true);
    assert.match(status.renderingLabel, /^No verificado:/);
});
