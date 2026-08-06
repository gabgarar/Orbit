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
