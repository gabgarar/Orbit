import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    createPreciseProductValidationFailure,
    preciseProductValidationReport,
    summarizePreciseProductValidation
} from "../../js/features/preciseProducts/validationUi.js";

test("GNSS validation summary exposes only facts returned by a passed SP3 validation", () => {
    const payload = {
        preview: {
            product: {
                sp3_validation: {
                    status: "passed",
                    header: { satellite_count: 121, epoch_count: 288 },
                    epochs: { count: 288, cadence_seconds: 300 },
                    positions: { usable_records: 34_848 },
                    interpolation: {
                        method: "LAGRANGE",
                        max_degree: 9,
                        max_knot_error_m: 1e-10
                    }
                }
            }
        }
    };

    assert.equal(preciseProductValidationReport(payload)?.status, "passed");
    const summary = summarizePreciseProductValidation(payload);
    assert.equal(summary?.title, "Validación estructural SP3 superada");
    assert.match(summary?.message || "", /121 satélites/);
    assert.match(summary?.message || "", /288 épocas/);
    assert.match(summary?.message || "", /cadencia constante de 300 s/);
    assert.match(summary?.message || "", /LAGRANGE/);
    assert.match(summary?.message || "", /grado ≤ 9/);
});

test("GNSS validation summary stays absent unless the service explicitly passed it", () => {
    assert.equal(summarizePreciseProductValidation({ product: { sp3_validation: { status: "failed" } } }), null);
    assert.equal(summarizePreciseProductValidation({ product: {} }), null);
});

test("GNSS validation failure dialog states that persistence and layer creation stopped", () => {
    const request = createPreciseProductValidationFailure(
        new Error("Las épocas SP3 no mantienen una cadencia constante."),
        { phase: "import", focusId: "preciseProductPreviewConfirmBtn" }
    );

    assert.match(request.id, /^precise-product-validation-/);
    assert.equal(request.title, "Importación bloqueada por validación");
    assert.equal(request.message, "Las épocas SP3 no mantienen una cadencia constante.");
    assert.equal(request.focusId, "preciseProductPreviewConfirmBtn");
    assert.match(request.details.join(" "), /No se ha importado ningún satélite/);
});

test("GNSS validation errors use an accessible blocking dialog and return focus to the import flow", () => {
    const source = readFileSync(
        new URL("../../../react-ui/src/components/PreciseProductValidationDialog.jsx", import.meta.url),
        "utf8"
    );
    const overlays = readFileSync(
        new URL("../../../react-ui/src/components/overlays/OrbitOverlays.jsx", import.meta.url),
        "utf8"
    );
    const sidebar = readFileSync(new URL("../../js/objectSidebar.js", import.meta.url), "utf8");

    assert.match(source, /role="alertdialog"/);
    assert.match(source, /aria-modal="true"/);
    assert.match(source, /aria-labelledby="preciseProductValidationDialogTitle"/);
    assert.match(source, /acknowledgeRef\.current.*focus/);
    assert.match(source, /PRECISE_PRODUCT_VALIDATION_DIALOG_EVENT/);
    assert.match(overlays, /<PreciseProductValidationDialog\s*\/>/);
    assert.match(sidebar, /PRECISE_PRODUCT_VALIDATION_DIALOG_EVENT/);
    assert.match(sidebar, /showPreciseProductValidationFailure\(message, \{\s*phase: "preview"/);
    assert.match(sidebar, /if \(!responseAccepted\) \{\s*showPreciseProductValidationFailure/);
    assert.match(
        sidebar,
        /if \(document\.getElementById\("preciseProductValidationDialog"\)\) return;[\s\S]*closePreciseProductPreviewModal\(\);/
    );
});
