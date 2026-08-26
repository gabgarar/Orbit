import assert from "node:assert/strict";
import test from "node:test";

import { createPropagatedParametersContextBuilder } from "../../js/features/propagatedParameters/context.js";

function createBuilder(overrides = {}) {
    return createPropagatedParametersContextBuilder({
        isCompositeLayerActive: () => true,
        isGroundStationLayerId: () => false,
        isCelestialBodyLayerId: () => false,
        getSatelliteSourceIdFromLayerId: (id) => id.replace("layer:", ""),
        getCompositeLayerTelemetry: () => ({ propagator: "SGP4" }),
        getCompositeLayerMeta: () => ({ sourceFormat: "TLE" }),
        getObjectTimeRange: () => ({ startDate: "2026-01-01T00:00:00Z", endDate: "2026-01-01T01:00:00Z" }),
        getManualOrbitProjectEntry: () => null,
        getLayerDisplayName: () => "Test satellite",
        getSimulationTelemetryContext: () => ({ mode: "static" }),
        getManualOrbitDefinitionSource: () => "keplerian",
        ...overrides
    });
}

test("catalogue propagation contexts retain their native TEME frame", () => {
    const context = createBuilder()({ id: "layer:123" });
    assert.equal(context.referenceFrame, "TEME");
    assert.equal(context.sourceId, "123");
});

test("manual contexts retain the canonical preview frame and active definition", () => {
    const context = createBuilder()({
        source: "manual-design",
        manualOrbit: {
            name: "Design",
            epochStartUtc: "2026-01-01T00:00:00Z",
            epochEndUtc: "2026-01-01T01:00:00Z",
            previewReferenceFrame: "ECEF"
        }
    });
    assert.equal(context.referenceFrame, "ITRF");
    assert.equal(context.manualOrbit.definitionSource, "keplerian");
});

test("contexts expose the active simulation range separately from an object's own coverage", () => {
    const simulationRange = {
        mode: "range",
        source: "simulation-range",
        startTime: "2026-09-01T00:00:00.000Z",
        endTime: "2026-09-01T06:00:00.000Z"
    };
    const context = createBuilder({
        getObjectTimeRange: () => ({
            startDate: "2026-01-01T00:00:00.000Z",
            endDate: "2026-01-02T00:00:00.000Z"
        }),
        getActiveSimulationRange: () => simulationRange
    })({ id: "layer:123" });

    assert.deepEqual(context.timeRange, {
        startDate: "2026-01-01T00:00:00.000Z",
        endDate: "2026-01-02T00:00:00.000Z"
    });
    assert.strictEqual(context.simulationRange, simulationRange);
});

test("precise-product contexts retain the actual vector frame but expose a qualified display frame", () => {
    const context = createBuilder({
        getCompositeLayerTelemetry: () => ({
            position_frame: "ITRF",
            position_frame_display: "Marco terrestre aproximado (sin ERP)"
        }),
        getCompositeLayerMeta: () => ({
            sourceFormat: "SP3",
            inputMetadata: {
                native_reference_frame: "IGC20",
                renderer_reference: {
                    status: "approximate_earth_fixed",
                    reference_frame: "ITRF",
                    display_label: "Marco terrestre aproximado (sin ERP)",
                    earth_orientation: { quality: "approximate" }
                }
            }
        })
    })({ id: "layer:precise:demo:G01" });

    assert.equal(context.referenceFrame, "ITRF");
    assert.equal(context.displayReferenceFrame, "Marco terrestre aproximado (sin ERP)");
    assert.equal(context.preciseRendering.nativeFrame, "IGC20");
    assert.equal(context.preciseRendering.approximate, true);
});
