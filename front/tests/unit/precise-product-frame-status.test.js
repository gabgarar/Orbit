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
                eci_conversion: {
                    available: false,
                    erp_applied: false,
                    route_available: false,
                    reason: "El ERP está disponible, pero falta una ruta de realización terrestre válida para convertir a ECI."
                }
            }
        }
    };
    const status = resolvePreciseProductFrameStatus(source, { runtimeFrame: "ITRF" });

    assert.equal(status.erpProvided, true);
    assert.equal(status.erpApplied, false);
    assert.equal(status.eciAvailable, false);
    assert.equal(status.eciBlockReason, "missing-route");
    assert.equal(status.displayFrame, "Marco terrestre aproximado (ERP sin ruta ECI)");
    assert.throws(
        () => assertPreciseProductEciAvailable(source),
        (error) => error?.message !== PRECISE_PRODUCT_IMPORT_ERRORS.missingErpForEci
    );
});

test("an ERP with a valid terrestrial route reports temporal-data blocking instead of inventing a missing route", () => {
    const source = {
        sp3: {
            native_reference_frame: "ITRF2020",
            erp_file: "IGS_ERP.ERP",
            renderer_reference: {
                available: true,
                earth_orientation: { applied: false, source: "IGS ERP" },
                eci_conversion: {
                    available: false,
                    route_available: true,
                    // Runtime state payloads from older backend versions do
                    // not include the raw leap-second boolean. They do keep
                    // the exact diagnostic and a false coverage capability.
                    available_within_erp_coverage: false,
                    reason: "ECI preciso requiere una tabla de segundos intercalares local, versionada y con cobertura verificable."
                }
            }
        }
    };
    const status = resolvePreciseProductFrameStatus(source, { runtimeFrame: "ITRF" });

    assert.equal(status.erpProvided, true);
    assert.equal(status.eciAvailable, false);
    assert.equal(status.eciBlockReason, "temporal-data");
    assert.equal(status.displayFrame, "ERP presente · ECI bloqueado por datos temporales");
    assert.match(status.eciReason, /segundos intercalares/i);
    assert.doesNotMatch(status.displayFrame, /sin ruta/i);
    assert.throws(
        () => assertPreciseProductEciAvailable(source),
        (error) => /segundos intercalares/i.test(error?.message || "")
    );
});

test("ECI frame status keeps IAU-engine and ERP-coverage blocks distinct", () => {
    const base = {
        native_reference_frame: "ITRF2020",
        erp_file: "IGS_ERP.ERP",
        renderer_reference: {
            available: true,
            earth_orientation: { applied: false, source: "IGS ERP" }
        }
    };
    const iau = resolvePreciseProductFrameStatus({
        sp3: {
            ...base,
            renderer_reference: {
                ...base.renderer_reference,
                eci_conversion: {
                    available: false,
                    route_available: true,
                    iau2006_2000a_available: false,
                    reason: "La conversión ITRF→ECI requiere pyerfa/SOFA con IAU 2006/2000A."
                }
            }
        }
    }, { runtimeFrame: "ITRF" });
    const coverage = resolvePreciseProductFrameStatus({
        sp3: {
            ...base,
            renderer_reference: {
                ...base.renderer_reference,
                eci_conversion: {
                    available: false,
                    route_available: true,
                    iau2006_2000a_available: true,
                    leap_seconds_available: true,
                    available_within_erp_coverage: false,
                    coverage: { overlaps_product: false, covers_product: false },
                    reason: "El ERP importado no cubre ninguna época del SP3."
                }
            }
        }
    }, { runtimeFrame: "ITRF" });

    assert.equal(iau.eciBlockReason, "iau-model");
    assert.equal(iau.displayFrame, "ERP presente · ECI bloqueado por motor IAU");
    assert.match(iau.eciReason, /IAU 2006\/2000A/);

    assert.equal(coverage.eciBlockReason, "erp-coverage");
    assert.equal(coverage.displayFrame, "ERP fuera de cobertura · ECI bloqueado");
    assert.match(coverage.eciReason, /no cubre ninguna época/i);
});

test("the reusable ECI guard explains the missing ERP prerequisite", () => {
    assert.throws(
        () => assertPreciseProductEciAvailable({ sp3: { reference_frame: "ITRF" } }),
        (error) => error?.message === PRECISE_PRODUCT_IMPORT_ERRORS.missingErpForEci
    );
});
