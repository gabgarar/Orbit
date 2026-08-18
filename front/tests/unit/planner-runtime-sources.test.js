import assert from "node:assert/strict";
import test from "node:test";

import { buildPlannerResourceEvents } from "../../js/features/planner/plannerEvents.js";
import {
    buildPlannerErpDiagnosticResource,
    buildPlannerSourceSnapshot,
    normalizePlannerLayerFacts
} from "../../js/features/planner/plannerRuntimeSources.js";

const T0 = "2026-08-18T00:00:00.000Z";
const T1 = "2026-08-19T00:00:00.000Z";
const T2 = "2026-08-20T00:00:00.000Z";

test("manual ERP snapshots map explicit coverage to validity, never expiry", () => {
    const snapshot = buildPlannerSourceSnapshot({
        manualErps: [{
            snapshotId: "erp-validated-1",
            filename: "finals.erp",
            sha256: "a".repeat(64),
            coverageStart: T0,
            coverageEnd: T1,
            recordCount: 12
        }]
    });

    assert.deepEqual(snapshot.resources, [{
        id: "erp:erp-validated-1",
        resourceType: "erp",
        name: "finals.erp",
        validityStart: T0,
        validityEnd: T1,
        validation: "validated-snapshot",
        metadata: {
            snapshotId: "erp-validated-1",
            sha256: "a".repeat(64),
            sourceSha256: "",
            source: "",
            version: "",
            quality: "",
            recordCount: 12
        }
    }]);
    const events = buildPlannerResourceEvents(snapshot.resources);
    assert.deepEqual(events.map((event) => event.kind), ["erp-validity-end"]);
    assert.equal(events.some((event) => event.kind === "erp-expiry"), false);
});

test("ERP diagnostic uses only named coverage and explicitly declared expiry fields", () => {
    const coverageOnly = buildPlannerErpDiagnosticResource({
        status: "healthy",
        lastValidatedAt: T0,
        details: {
            snapshot_id: "service-erp",
            coverage: { start: T0, end: T1 },
            updated_at: T2
        }
    });
    assert.equal(coverageOnly.validityEnd, T1);
    assert.equal("expiresAt" in coverageOnly, false, "an update timestamp cannot become expiry");

    const declaredExpiry = buildPlannerErpDiagnosticResource({
        status: "warning",
        details: {
            coverage_end: T1,
            expires_at: T2
        }
    });
    assert.equal(declaredExpiry.validityEnd, T1);
    assert.equal(declaredExpiry.expiresAt, T2);
    const validationOnly = buildPlannerErpDiagnosticResource({ status: "healthy", details: { updated_at: T2 } });
    assert.equal(validationOnly.validation, "healthy");
    assert.equal("validityEnd" in validationOnly, false);
    assert.equal("expiresAt" in validationOnly, false);
    assert.deepEqual(buildPlannerResourceEvents([validationOnly]), []);
});

test("a legacy validated ERP snapshot stays inspectable without inventing a coverage date", () => {
    const snapshot = buildPlannerSourceSnapshot({
        manualErps: [{ snapshotId: "legacy-erp", filename: "legacy.erp" }]
    });
    assert.deepEqual(snapshot.resources.map((resource) => [resource.id, resource.validation, resource.validityEnd]), [
        ["erp:legacy-erp", "validated-snapshot", undefined]
    ]);
    assert.deepEqual(buildPlannerResourceEvents(snapshot.resources), []);
});

test("scene SP3, OEM, and finite imported layers expose verified boundaries without duplicates", () => {
    const snapshot = buildPlannerSourceSnapshot({
        preciseRanges: [{ id: "precise:igs:G01", startTime: T0, endTime: T1 }],
        preciseNames: new Map([["precise:igs:G01", "IGS G01"]]),
        oemRanges: [{ id: "oem:local-1", startTime: T0, endTime: T2 }],
        oemNames: new Map([["oem:local-1", "OEM local"]]),
        layers: [
            {
                id: "precise:igs:G01",
                sourceId: "precise:igs:G01",
                name: "IGS G01",
                type: "SATELLITE",
                active: true,
                visible: true,
                sourceFormat: "SP3",
                validityStart: T0,
                validityEnd: T1
            },
            {
                id: "manual:demo",
                sourceId: "manual:demo",
                name: "Demo design",
                type: "SATELLITE",
                active: true,
                visible: true,
                sourceFormat: "MANUAL",
                validityStart: T0,
                validityEnd: T2,
                validation: "scene-intrinsic-range"
            },
            {
                id: "tle:open-ended",
                name: "TLE",
                type: "SATELLITE",
                active: true,
                visible: true,
                sourceFormat: "TLE"
            }
        ]
    });

    assert.deepEqual(snapshot.resources.map((resource) => [resource.id, resource.resourceType, resource.validityEnd]), [
        ["sp3:precise:igs:G01", "sp3", T1],
        ["oem:oem:local-1", "oem", T2],
        ["layer:manual:demo", "layer", T2]
    ]);
    assert.equal(snapshot.layers.find((layer) => layer.id === "tle:open-ended").validation, "scene-state-only");
    const events = buildPlannerResourceEvents(snapshot.resources);
    assert.deepEqual(events.map((event) => event.kind), ["sp3-validity-end", "layer-validity-end", "oem-validity-end"]);
});

test("layer facts retain visibility and provenance but do not fabricate temporal boundaries", () => {
    const layers = normalizePlannerLayerFacts([{
        id: "station:madrid",
        name: "Madrid",
        type: "GROUND_STATION",
        sourceId: "station:madrid",
        active: true,
        visible: false,
        sourceFormat: "GROUND_STATION",
        sourceOrigin: "USER"
    }]);
    assert.deepEqual(layers, [{
        id: "station:madrid",
        name: "Madrid",
        type: "GROUND_STATION",
        sourceId: "station:madrid",
        active: true,
        visible: false,
        sourceFormat: "GROUND_STATION",
        sourceOrigin: "USER",
        validation: "scene-state-only"
    }]);
});
