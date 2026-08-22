import assert from "node:assert/strict";
import test from "node:test";

import {
    buildPlannerEopCoverageEvents,
    buildPlannerLayerEvents,
    buildPlannerProductErpCoverageEvents,
    buildPlannerResourceEvents,
    PLANNER_EOP_LAYER_ID,
    PLANNER_PRODUCT_ERP_LAYER_ID
} from "../../js/features/planner/plannerEvents.js";
import {
    buildPlannerErpDiagnosticResource,
    buildPlannerSourceSnapshot,
    normalizePlannerLayerFacts,
    normalizePlannerProductErpCoverages,
    plannerProductErpSuppressesAutomaticEop
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

test("automatic EOP diagnostics use one hideable layer and do not duplicate a generic ERP endpoint", () => {
    const erpDiagnostic = {
        status: "warning",
        details: {
            coverage: { start: T0, end: T2 },
            coverageTimeline: [
                {
                    kind: "iers-c01",
                    start: T0,
                    end: T1,
                    source: "IERS C01",
                    quality: "final"
                },
                {
                    kind: "iers-finals2000a",
                    start: T1,
                    end: T2,
                    source: "IERS finals2000A",
                    quality: "rapid"
                }
            ]
        }
    };
    const snapshot = buildPlannerSourceSnapshot({ erpDiagnostic });

    assert.deepEqual(snapshot.resources, []);
    assert.deepEqual(snapshot.layers, [{
        id: PLANNER_EOP_LAYER_ID,
        name: "IERS ERP Time",
        type: "SYSTEM",
        sourceId: PLANNER_EOP_LAYER_ID,
        active: true,
        visible: true,
        sourceFormat: "EOP",
        sourceOrigin: "IERS",
        validation: "diagnostics-coverage-timeline"
    }]);
    assert.deepEqual(buildPlannerEopCoverageEvents(erpDiagnostic).map((event) => event.metadata.layerId), [
        PLANNER_EOP_LAYER_ID,
        PLANNER_EOP_LAYER_ID
    ]);
});

test("a validated ERP bound to every active SP3 replaces the automatic IERS planner layer", () => {
    const preciseProducts = [{
        id: "precise:demo:G01",
        product_id: "precise-demo",
        product_name: "Demo precise product",
        sp3: {
            erp: {
                present: true,
                file: "demo.ERP",
                coverage_start: T0,
                coverage_end: T2,
                source: "IGS",
                snapshot_id: "erp-demo",
                quality: "final"
            },
            eci_conversion: {
                coverage: { erp_start: T0, erp_end: T2 }
            }
        }
    }];
    const preciseRanges = [{ id: "precise:demo:G01", startTime: T0, endTime: T1 }];
    const coverages = normalizePlannerProductErpCoverages(preciseProducts);

    assert.deepEqual(coverages.map((coverage) => ({
        id: coverage.id,
        sourceIds: coverage.sourceIds,
        coverageStart: coverage.coverageStart,
        coverageEnd: coverage.coverageEnd,
        fileName: coverage.fileName
    })), [{
        id: "precise-demo",
        sourceIds: ["precise:demo:G01"],
        coverageStart: T0,
        coverageEnd: T2,
        fileName: "demo.ERP"
    }]);
    assert.equal(plannerProductErpSuppressesAutomaticEop({ preciseRanges, productErpCoverages: coverages }), true);

    const snapshot = buildPlannerSourceSnapshot({
        preciseProducts,
        preciseRanges,
        erpDiagnostic: {
            details: {
                coverageTimeline: [{ kind: "iers-c01", start: T0, end: T2 }]
            }
        }
    });
    assert.equal(snapshot.automaticEopEnabled, false);
    assert.equal(snapshot.automaticEopSuppressed, true);
    assert.equal(snapshot.layers.some((layer) => layer.id === PLANNER_EOP_LAYER_ID), false);
    assert.deepEqual(snapshot.layers.find((layer) => layer.id === PLANNER_PRODUCT_ERP_LAYER_ID), {
        id: PLANNER_PRODUCT_ERP_LAYER_ID,
        name: "ERP asociado a SP3",
        type: "SYSTEM",
        sourceId: PLANNER_PRODUCT_ERP_LAYER_ID,
        active: true,
        visible: true,
        sourceFormat: "ERP",
        sourceOrigin: "SP3",
        validation: "product-bound-erp-coverage"
    });
    assert.deepEqual(buildPlannerProductErpCoverageEvents(snapshot.productErpCoverages).map((event) => [
        event.kind,
        event.start,
        event.end,
        event.colorToken,
        event.metadata.layerId,
        event.metadata.eopRange
    ]), [[
        "product-erp-coverage", T0, T2, "cyan", PLANNER_PRODUCT_ERP_LAYER_ID, true
    ]]);
});

test("a missing or partial second SP3 ERP never hides automatic IERS coverage", () => {
    const preciseRanges = [
        { id: "precise:demo:G01", startTime: T0, endTime: T2 },
        { id: "precise:demo:G02", startTime: T0, endTime: T2 }
    ];
    const partial = normalizePlannerProductErpCoverages([{
        id: "precise:demo:G01",
        product_id: "precise-one",
        sp3: { erp: { present: true, coverage_start: T0, coverage_end: T1 } }
    }]);
    assert.equal(plannerProductErpSuppressesAutomaticEop({ preciseRanges, productErpCoverages: partial }), false);

    const snapshot = buildPlannerSourceSnapshot({
        preciseRanges,
        preciseProducts: [{
            id: "precise:demo:G01",
            product_id: "precise-one",
            sp3: { erp: { present: true, coverage_start: T0, coverage_end: T2 } }
        }, {
            id: "precise:demo:G02",
            product_id: "precise-two",
            sp3: { erp: { present: true, file: "unbounded.ERP" } }
        }],
        erpDiagnostic: { details: { coverageTimeline: [{ kind: "iers-c01", start: T0, end: T2 }] } }
    });
    assert.equal(snapshot.automaticEopEnabled, true);
    assert.equal(snapshot.layers.some((layer) => layer.id === PLANNER_EOP_LAYER_ID), true);
    assert.equal(snapshot.productErpCoverages.length, 1, "the unbounded file is not promoted to a temporal fact");
});

test("a mixed satellite scene retains IERS while exposing the exact SP3-bound ERP", () => {
    const preciseProducts = [{
        id: "precise:demo:G01",
        product_id: "precise-one",
        sp3: { erp: { present: true, coverage_start: T0, coverage_end: T2 } }
    }];
    const snapshot = buildPlannerSourceSnapshot({
        preciseRanges: [{ id: "precise:demo:G01", startTime: T0, endTime: T1 }],
        preciseProducts,
        layers: [
            {
                id: "precise:demo:G01",
                sourceId: "precise:demo:G01",
                type: "SATELLITE",
                active: true,
                visible: true,
                sourceFormat: "SP3"
            },
            {
                id: "catalog:tle:25544",
                sourceId: "25544",
                type: "SATELLITE",
                active: true,
                visible: true,
                sourceFormat: "TLE"
            }
        ],
        erpDiagnostic: { details: { coverageTimeline: [{ kind: "iers-c01", start: T0, end: T2 }] } }
    });

    assert.equal(snapshot.automaticEopEnabled, true);
    assert.equal(snapshot.layers.some((layer) => layer.id === PLANNER_EOP_LAYER_ID), true);
    assert.equal(snapshot.layers.some((layer) => layer.id === PLANNER_PRODUCT_ERP_LAYER_ID), true);
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

test("custom TLE layer provenance produces import and epoch notices while retaining a separate validity boundary", () => {
    const snapshot = buildPlannerSourceSnapshot({
        layers: [{
            id: "custom-tle",
            sourceId: "custom-tle",
            name: "Operator TLE",
            type: "SATELLITE",
            active: true,
            visible: true,
            sourceFormat: "TLE",
            sourceOrigin: "CUSTOM",
            importFileName: "operator-upload.tle",
            importedAt: T1,
            tleEpoch: T0,
            sourceProvider: "Local operator",
            validityStart: T0,
            validityEnd: T2,
            validation: "source-declared-range"
        }]
    });

    assert.deepEqual(snapshot.layers, [{
        id: "custom-tle",
        name: "Operator TLE",
        type: "SATELLITE",
        sourceId: "custom-tle",
        active: true,
        visible: true,
        sourceFormat: "TLE",
        sourceOrigin: "CUSTOM",
        importedAt: T1,
        importFileName: "operator-upload.tle",
        tleEpoch: T0,
        sourceProvider: "Local operator",
        validation: "source-declared-range",
        validityStart: T0,
        validityEnd: T2
    }]);
    assert.deepEqual(buildPlannerLayerEvents(snapshot.layers).map((event) => [event.kind, event.start, event.metadata.importFileName]), [
        ["tle-epoch", T0, "operator-upload.tle"],
        ["layer-imported", T1, "operator-upload.tle"]
    ]);
    assert.deepEqual(buildPlannerResourceEvents(snapshot.resources).map((event) => event.kind), ["layer-validity-end"]);
});
