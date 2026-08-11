import assert from "node:assert/strict";
import test from "node:test";

import {
    assertPreciseProductEciAvailable,
    resolvePreciseProductFrameStatus
} from "../../js/features/preciseProducts/frameStatus.js";
import { PRECISE_PRODUCT_IMPORT_ERRORS } from "../../js/features/preciseProducts/import.js";

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
    assert.equal(status.displayFrame, "Marco terrestre aproximado (sin ERP)");
    assert.equal(status.available, false);
    assert.equal(status.eciAvailable, false);
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
    assert.equal(status.displayFrame, "Marco terrestre aproximado (sin ERP)");
    assert.equal(status.renderingLabel, "Marco terrestre aproximado (sin ERP)");
});

test("legacy products without renderer provenance show their native frame rather than an unverified ITRF label", () => {
    const status = resolvePreciseProductFrameStatus({
        sp3: {
            native_reference_frame: "IGS14",
            reference_frame: "ITRF"
        }
    }, { runtimeFrame: "ITRF" });

    assert.equal(status.nativeFrame, "IGS14");
    assert.equal(status.displayFrame, "Marco terrestre aproximado (sin ERP)");
    assert.equal(status.unverifiedTerrestrialTransform, true);
    assert.match(status.renderingLabel, /^Marco terrestre aproximado/);
});

test("a legacy SP3 declaring only ITRF is qualified instead of presented as precise terrestrial output", () => {
    const status = resolvePreciseProductFrameStatus({
        sp3: { reference_frame: "ITRF" }
    }, { runtimeFrame: "ITRF" });

    assert.equal(status.nativeFrame, "ITRF");
    assert.equal(status.displayFrame, "Marco terrestre aproximado (sin ERP)");
    assert.equal(status.unverifiedTerrestrialTransform, true);
    assert.match(status.renderingLabel, /^Marco terrestre aproximado/);
});

test("an applied ERP is the only capability that unlocks the ITRF-to-ECI label", () => {
    const source = {
        sp3: {
            native_reference_frame: "IGS20",
            renderer_reference: {
                available: true,
                display_label: "ITRF (con ERP aplicado)",
                earth_orientation: { erp_applied: true, applied: true, source: "IGS ERP" },
                eci_conversion: { available: true }
            },
            source_files: [{ kind: "erp", name: "IGS_ERP.ERP" }]
        }
    };
    const status = resolvePreciseProductFrameStatus(source, { runtimeFrame: "ITRF" });

    assert.equal(status.displayFrame, "ITRF (con ERP aplicado)");
    assert.equal(status.erpApplied, true);
    assert.equal(status.eciAvailable, true);
    assert.equal(assertPreciseProductEciAvailable(source).displayFrame, "ITRF (con ERP aplicado)");
});

test("an attached ERP without a registered ECI route stays approximate and keeps the ECI guard blocked", () => {
    const source = {
        sp3: {
            native_reference_frame: "IGS20",
            erp_file: "IGS_ERP.ERP",
            source_files: [{ kind: "erp", name: "IGS_ERP.ERP" }],
            renderer_reference: {
                available: true,
                // This can occur when the ERP is valid but the SP3
                // realization has no registered datum route to ECI.
                display_label: "IGS20",
                earth_orientation: { applied: false, source: "IGS ERP" },
                eci_conversion: { available: false, erp_applied: false }
            }
        }
    };
    const status = resolvePreciseProductFrameStatus(source, { runtimeFrame: "ITRF" });

    assert.equal(status.erpProvided, true);
    assert.equal(status.erpApplied, false);
    assert.equal(status.eciAvailable, false);
    assert.equal(status.displayFrame, "Marco terrestre aproximado (ERP sin ruta ECI)");
    assert.throws(
        () => assertPreciseProductEciAvailable(source),
        (error) => error?.message !== PRECISE_PRODUCT_IMPORT_ERRORS.missingErpForEci
    );
});

test("the reusable ECI guard explains the missing ERP prerequisite", () => {
    assert.throws(
        () => assertPreciseProductEciAvailable({ sp3: { reference_frame: "ITRF" } }),
        (error) => error?.message === PRECISE_PRODUCT_IMPORT_ERRORS.missingErpForEci
    );
});
