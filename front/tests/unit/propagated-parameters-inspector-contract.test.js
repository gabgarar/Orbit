import assert from "node:assert/strict";
import test from "node:test";

import {
    assessPropagatedParametersAvailability,
    buildPropagatedParametersExport,
    buildPropagatedParametersInspector,
    normalizePropagatedParametersSource
} from "../../js/features/propagatedParameters/inspectorContract.js";

const simulationRange = {
    mode: "range",
    source: "simulation-range",
    startTime: "2026-09-01T00:00:00.000Z",
    endTime: "2026-09-01T02:00:00.000Z"
};

const tleContext = {
    sourceId: "25544",
    simulationRange,
    catalogMeta: {
        sourceFormat: "TLE",
        sourceOrigin: "Space-Track",
        inputMetadata: {
            provider: "Space-Track",
            epoch: "2026-08-31T23:59:00.000Z",
            data_quality: "operational",
            accuracy_m: 125
        }
    }
};

function stateSample(time, {
    x = 6800,
    y = 10,
    z = -20,
    vx = 0.1,
    vy = 7.6,
    vz = 1.2,
    elements = {
        radius_km: 6800.05,
        speed_km_s: 7.694,
        eccentricity: 0.0011
    }
} = {}) {
    return {
        time,
        reference_frame: "TEME",
        state: {
            position: { x, y, z },
            velocity: { x: vx, y: vy, z: vz },
            position_units: "km",
            velocity_units: "km/s"
        },
        ...(elements === null ? {} : { elements })
    };
}

function tleResult(samples = [stateSample("2026-09-01T00:00:00.000Z")]) {
    return {
        source: { source_format: "TLE", sat_id: "25544", reference_frame: "TEME" },
        satellite: "ISS (ZARYA)",
        model: { id: "sgp4", applied_engine: "sgp4" },
        reference_frame: "TEME",
        start_time: "2026-09-01T00:00:00.000Z",
        end_time: "2026-09-01T02:00:00.000Z",
        samples
    };
}

test("TLE inspector rows retain direct Cartesian samples and declared derived values", () => {
    const inspector = buildPropagatedParametersInspector(tleContext, tleResult());

    assert.deepEqual(inspector.source, {
        type: "tle",
        format: "TLE",
        kind: "catalog",
        origin: "Space-Track",
        id: "25544",
        name: "ISS (ZARYA)",
        definitionSource: null,
        metadata: {
            provider: "Space-Track",
            objectId: "25544",
            epoch: "2026-08-31T23:59:00.000Z",
            nativeReferenceFrame: "TEME"
        }
    });
    assert.deepEqual(inspector.availability, { available: true, code: "available", reason: null });
    assert.equal(inspector.method.family, "sgp4");
    assert.deepEqual(inspector.rows[0].cartesian, {
        x: 6800,
        y: 10,
        z: -20,
        vx: 0.1,
        vy: 7.6,
        vz: 1.2,
        positionUnit: "km",
        velocityUnit: "km/s"
    });
    assert.deepEqual(
        inspector.cartesianColumns.map(({ id, group, unit, direct, derived, provenance }) => ({ id, group, unit, direct, derived, provenance })),
        [
            { id: "x", group: "position", unit: "km", direct: true, derived: false, provenance: "state-direct" },
            { id: "y", group: "position", unit: "km", direct: true, derived: false, provenance: "state-direct" },
            { id: "z", group: "position", unit: "km", direct: true, derived: false, provenance: "state-direct" },
            { id: "vx", group: "velocity", unit: "km/s", direct: true, derived: false, provenance: "state-direct" },
            { id: "vy", group: "velocity", unit: "km/s", direct: true, derived: false, provenance: "state-direct" },
            { id: "vz", group: "velocity", unit: "km/s", direct: true, derived: false, provenance: "state-direct" }
        ]
    );
    assert.equal(inspector.rows[0].radiusKm, 6800.05);
    assert.equal(inspector.rows[0].speedKmS, 7.694);
    assert.equal(inspector.rows[0].eccentricity, 0.0011);
    assert.deepEqual(
        inspector.columns.filter(({ group }) => group === "derived").map(({ id }) => id),
        ["eccentricity", "radiusKm", "speedKmS"]
    );
});

test("omitted Cartesian and derived values stay absent instead of being manufactured", () => {
    const inspector = buildPropagatedParametersInspector(tleContext, tleResult([
        stateSample("2026-09-01T00:00:00.000Z", {
            x: 7000,
            y: Number.NaN,
            z: Number.NaN,
            vx: Number.NaN,
            vy: Number.NaN,
            vz: Number.NaN,
            elements: null
        })
    ]));

    assert.deepEqual(inspector.rows[0].cartesian, {
        x: 7000,
        positionUnit: "km",
        velocityUnit: "km/s"
    });
    assert.deepEqual(inspector.cartesianColumns.map(({ id }) => id), ["x"]);
    assert.deepEqual(inspector.columns.filter(({ group }) => group === "derived"), []);
    for (const key of ["y", "z", "vx", "vy", "vz", "radiusKm", "speedKmS"]) {
        assert.equal(inspector.rows[0][key], undefined);
    }
});

test("source profiles preserve the declared source rather than substituting TLE data", () => {
    const cases = [
        ["TLE", { catalogMeta: { sourceFormat: "TLE" } }, {}, "tle", "TLE"],
        ["SP3", { catalogMeta: { sourceFormat: "SP3" } }, {}, "sp3", "SP3"],
        ["OEM", { catalogMeta: { sourceFormat: "OEM" } }, {}, "oem", "OEM"],
        ["OMM", { catalogMeta: { sourceFormat: "OMM" } }, {}, "omm", "OMM"],
        ["state vector", { manualOrbit: { definitionSource: "state-vector" } }, {}, "state-vector", "MANUAL"],
        ["numeric manual", { manualOrbit: { definitionSource: "keplerian", propagator: "cowell" } }, {}, "numeric", "MANUAL"],
        ["manual Keplerian", { manualOrbit: { definitionSource: "keplerian" } }, {}, "manual", "MANUAL"]
    ];

    for (const [name, context, result, type, format] of cases) {
        const source = normalizePropagatedParametersSource(context, result);
        assert.equal(source.type, type, name);
        assert.equal(source.format, format, name);
        if (type !== "tle") assert.notEqual(source.type, "tle", `${name} must not become a TLE`);
    }

    const undeclared = normalizePropagatedParametersSource({ sourceId: "catalogue-id-only" }, {});
    assert.equal(undeclared.type, "unknown");
    assert.equal(undeclared.format, "UNKNOWN");
    assert.deepEqual(assessPropagatedParametersAvailability({ sourceId: "catalogue-id-only" }, {}), {
        available: false,
        code: "source-type-unavailable",
        reason: "El tipo de fuente no declara una ruta de inspección orbital compatible."
    });
});

test("OMM preserves supplied mean-element provenance without relabelling it as osculating", () => {
    const inspector = buildPropagatedParametersInspector({
        sourceId: "omm:25544",
        catalogMeta: {
            sourceFormat: "OMM",
            inputMetadata: {
                SEMIMAJOR_AXIS: 6798.3,
                ECCENTRICITY: 0.00045,
                INCLINATION: 51.64,
                RA_OF_ASC_NODE: 132.2,
                ARG_OF_PERICENTER: 82.7,
                MEAN_ANOMALY: 277.3,
                MEAN_MOTION: 15.49,
                BSTAR: 0.0000123,
                CR_AREA_OVER_MASS: 0.018
            }
        }
    }, {
        source: { source_format: "OMM", sat_id: "omm:25544", reference_frame: "TEME" },
        model: { id: "sgp4", applied_engine: "sgp4", input_source_format: "OMM" },
        samples: [stateSample("2026-09-01T00:00:00.000Z")]
    });

    assert.equal(inspector.source.type, "omm");
    assert.equal(inspector.method.id, "sgp4");
    assert.deepEqual(inspector.source.metadata, {
        objectId: "omm:25544",
        nativeReferenceFrame: "TEME",
        mean_semi_major_axis_km: 6798.3,
        mean_eccentricity: 0.00045,
        mean_inclination_deg: 51.64,
        mean_raan_deg: 132.2,
        mean_argument_of_periapsis_deg: 82.7,
        mean_anomaly_deg_input: 277.3,
        mean_motion_rev_day: 15.49,
        bstar: 0.0000123,
        solar_radiation_pressure: 0.018
    });
    assert.deepEqual(
        Object.fromEntries([
            "meanSemiMajorAxisKm", "meanEccentricity", "meanInclinationDeg", "meanRaanDeg",
            "meanArgumentOfPeriapsisDeg", "meanAnomalyDegInput", "meanMotionRevDay", "bstar", "solarRadiationPressure"
        ].map((key) => [key, inspector.rows[0][key]])),
        {
            meanSemiMajorAxisKm: 6798.3,
            meanEccentricity: 0.00045,
            meanInclinationDeg: 51.64,
            meanRaanDeg: 132.2,
            meanArgumentOfPeriapsisDeg: 82.7,
            meanAnomalyDegInput: 277.3,
            meanMotionRevDay: 15.49,
            bstar: 0.0000123,
            solarRadiationPressure: 0.018
        }
    );
    assert.ok(inspector.columns
        .filter(({ group }) => group === "mean-input")
        .every(({ provenance, direct, derived, origins }) => (
            provenance === "direct" && direct === true && derived === false && origins.includes("source-input")
        )));
});

test("tabular SP3 is unavailable or native-Cartesian exactly as the backend declares", () => {
    const context = { catalogMeta: { sourceFormat: "SP3" } };
    const unavailable = buildPropagatedParametersInspector(context, {
        source: { source_format: "SP3" },
        capabilities: { inspector: { available: false, reason: "Fuera de cobertura" } },
        samples: []
    });

    assert.equal(unavailable.source.type, "sp3");
    assert.deepEqual(unavailable.availability, {
        available: false,
        code: "backend-unavailable",
        reason: "Fuera de cobertura"
    });

    const undeclared = buildPropagatedParametersInspector(context, {
        source: { source_format: "SP3", reference_frame: "ITRF" },
        model: { id: "tabular-sp3" },
        samples: [stateSample("2026-09-01T00:00:00.000Z", { elements: null })]
    });
    assert.equal(undeclared.source.type, "sp3");
    assert.equal(undeclared.availability.available, false);
    assert.equal(undeclared.availability.code, "backend-capability-missing");

    const nativeCartesian = buildPropagatedParametersInspector(context, {
        source: { source_format: "SP3", reference_frame: "ITRF" },
        capabilities: {
            inspector: {
                available: true,
                mode: "native-cartesian",
                osculating_elements: { available: false, reason: "No inertial conversion" }
            }
        },
        samples: [{
            ...stateSample("2026-09-01T00:00:00.000Z", {
                elements: null
            }),
            reference_frame: "ITRF",
            element_type: "native-cartesian"
        }]
    });

    assert.equal(nativeCartesian.source.type, "sp3");
    assert.equal(nativeCartesian.availability.available, true);
    assert.deepEqual(nativeCartesian.cartesianColumns.map(({ id }) => id), ["x", "y", "z", "vx", "vy", "vz"]);
    assert.deepEqual(
        nativeCartesian.columns.filter(({ group }) => group === "derived").map(({ id, derived, provenance }) => ({ id, derived, provenance })),
        [
            { id: "radiusKm", derived: true, provenance: "cartesian-position-magnitude" },
            { id: "speedKmS", derived: true, provenance: "cartesian-velocity-magnitude" }
        ]
    );
    assert.equal(nativeCartesian.rows[0].radiusKm, Math.hypot(6800, 10, -20));
    assert.equal(nativeCartesian.rows[0].speedKmS, Math.hypot(0.1, 7.6, 1.2));
});

test("SP3 telemetry contributes the declared product, coverage, and CLK provenance", () => {
    const inspector = buildPropagatedParametersInspector({
        sourceId: "precise:fixture:G01",
        catalogMeta: {
            sourceFormat: "SP3",
            provider_id: "CODE",
            product_class: "final",
            product_family: "mgex"
        },
        telemetry: {
            product_id: "precise-fixture",
            sp3: {
                agency: "CODE",
                reference_frame: "IGS20",
                start_time: "2026-09-01T00:00:00.000Z",
                end_time: "2026-09-01T12:00:00.000Z",
                clock: {
                    rinex_clk: {
                        file_present: true,
                        sample_count: 42,
                        time_scale: "GPS"
                    }
                }
            }
        }
    }, {
        source: { source_format: "SP3", sat_id: "precise:fixture:G01", reference_frame: "IGS20" },
        capabilities: { inspector: { available: true, mode: "native-cartesian" } },
        samples: [{
            ...stateSample("2026-09-01T00:00:00.000Z", { elements: null }),
            reference_frame: "IGS20",
            state: {
                ...stateSample("2026-09-01T00:00:00.000Z", { elements: null }).state,
                time_scale: "GPS"
            }
        }]
    });

    assert.deepEqual(inspector.source.metadata, {
        provider: "CODE",
        objectId: "precise:fixture:G01",
        productId: "precise-fixture",
        productClass: "final",
        productFamily: "mgex",
        coverageStart: "2026-09-01T00:00:00.000Z",
        coverageEnd: "2026-09-01T12:00:00.000Z",
        nativeReferenceFrame: "IGS20",
        clock: {
            rinex_clk: {
                file_present: true,
                sample_count: 42,
                time_scale: "GPS"
            }
        }
    });
    assert.equal(inspector.rows[0].timeScale, "GPS");
    assert.ok(inspector.columns.some(({ id, group, type }) => id === "timeScale" && group === "identity" && type === "text"));
});

test("output-frame contract preserves native, table, calculation, and per-row transform provenance", () => {
    const result = tleResult([{
        ...stateSample("2026-09-01T00:00:00.000Z", { elements: null }),
        reference_frame: "ITRF",
        native_reference_frame: "TEME",
        frame_transform: {
            requested_frame: "ITRF",
            native_frame: "TEME",
            output_frame: "ITRF",
            applied: true,
            mode: "transformed",
            path: ["TEME", "ITRF"],
            provenance: { operation: "teme-to-itrf", eop: "fixture" }
        },
        state: {
            ...stateSample("2026-09-01T00:00:00.000Z", { elements: null }).state,
            reference_frame: "ITRF"
        }
    }]);
    result.reference_frame = "ITRF";
    result.native_reference_frame = "TEME";
    result.output_reference_frame = "ITRF";
    result.requested_output_frame = "ITRF";
    result.frame = {
        native: { reference_frame: "TEME" },
        current: { reference_frame: "ITRF" },
        output: {
            requested_frame: "ITRF",
            reference_frame: "ITRF",
            transformed: true,
            provenance: { operation: "teme-to-itrf", eop: "fixture" }
        },
        calculation: {
            reference_frame: "TEME",
            elements_follow_calculation_frame: true
        },
        available_output_frames: ["TEME", "ITRF", "EME2000", "GCRF", "ICRF"],
        supported_output_frames: ["TEME", "ITRF", "EME2000", "GCRF", "ICRF"],
        selectable: true,
        frame_transform_service_configured: true,
        selection_requires_runtime_validation: true
    };

    const inspector = buildPropagatedParametersInspector(tleContext, result);

    assert.deepEqual(inspector.frame, {
        current: "ITRF",
        native: "TEME",
        display: "ITRF",
        requested: "ITRF",
        transformed: true,
        transformProvenance: { operation: "teme-to-itrf", eop: "fixture" },
        dynamics: "TEME",
        calculation: "TEME",
        elementsFollowCalculationFrame: true,
        state: "ITRF",
        availableFrames: ["TEME", "ITRF", "EME2000", "GCRF", "ICRF"],
        supportedFrames: ["TEME", "ITRF", "EME2000", "GCRF", "ICRF"],
        conversions: [{ operation: "teme-to-itrf", eop: "fixture" }],
        selectable: true,
        frameTransformServiceConfigured: true,
        selectionRequiresRuntimeValidation: true,
        reason: null
    });
    assert.equal(inspector.rows[0].referenceFrame, "ITRF");
    assert.equal(inspector.rows[0].nativeReferenceFrame, "TEME");
    assert.deepEqual(inspector.rows[0].frameTransform.path, ["TEME", "ITRF"]);

    const exported = buildPropagatedParametersExport({
        context: tleContext,
        result,
        inspector,
        format: "json",
        columns: ["time", "referenceFrame", "x"]
    });
    assert.deepEqual(exported.metadata.frame, inspector.frame);
    assert.deepEqual(exported.document.rowMetadata[0].frameTransform, result.samples[0].frame_transform);
    assert.equal(exported.document.rowMetadata[0].nativeReferenceFrame, "TEME");
});

test("an unavailable OEM keeps OEM provenance and never creates a surrogate propagation", () => {
    const inspector = buildPropagatedParametersInspector({ catalogMeta: { sourceFormat: "OEM" } }, {
        source: { source_format: "OEM", runtime_id: "oem:demo" },
        capabilities: { inspector: { available: false, reason: "Adaptador OEM no disponible" } },
        samples: []
    });

    assert.equal(inspector.source.type, "oem");
    assert.equal(inspector.source.format, "OEM");
    assert.equal(inspector.source.id, "oem:demo");
    assert.equal(inspector.availability.available, false);
    assert.equal(inspector.availability.reason, "Adaptador OEM no disponible");
    assert.equal(inspector.method.id, null);
    assert.deepEqual(inspector.rows, []);

    const undeclared = buildPropagatedParametersInspector({ catalogMeta: { sourceFormat: "OEM" } }, {
        source: { source_format: "OEM" },
        model: { id: "tabular-oem" },
        samples: [stateSample("2026-09-01T00:00:00.000Z", { elements: null })]
    });
    assert.equal(undeclared.source.type, "oem");
    assert.equal(undeclared.availability.available, false);
    assert.equal(undeclared.availability.code, "backend-capability-missing");

    const localOem = buildPropagatedParametersInspector({
        catalogMeta: { sourceFormat: "OEM" },
        telemetry: { oem: { local: true } }
    }, {
        source: { source_format: "OEM" },
        samples: []
    });
    assert.equal(localOem.source.type, "oem");
    assert.deepEqual(localOem.availability, {
        available: false,
        code: "local-oem-no-backend-provider",
        reason: "La OEM cargada localmente no tiene un proveedor de analisis registrado en el backend.",
        mode: null,
        nativeCartesian: null,
        osculatingElements: null
    });
});

test("visible exports preserve selected rows, columns, simulation provenance, and filter metadata", () => {
    const result = tleResult([
        stateSample("2026-09-01T00:00:00.000Z"),
        stateSample("2026-09-01T01:00:00.000Z", { x: 6801, elements: { radius_km: 6801.1, speed_km_s: 7.693 } })
    ]);
    const inspector = buildPropagatedParametersInspector(tleContext, result);
    const exported = buildPropagatedParametersExport({
        context: tleContext,
        result,
        inspector,
        format: "csv",
        scope: "visible",
        rows: [1],
        columns: ["time", "x", "speedKmS"],
        metadata: {
            sourceProfile: "tle",
            timeFilter: { mode: "custom", start: "2026-09-01T00:30:00.000Z", end: "2026-09-01T01:30:00.000Z" },
            sort: { column: "x", direction: "desc" },
            ignoredCallback: () => {}
        }
    });

    assert.equal(exported.format, "csv");
    assert.equal(exported.scope, "visible");
    assert.deepEqual(exported.rows, [{
        time: "2026-09-01T01:00:00.000Z",
        x: 6801,
        speedKmS: 7.693
    }]);
    assert.deepEqual(exported.metadata.columns.map(({ id }) => id), ["time", "x", "speedKmS"]);
    assert.equal(exported.metadata.rowCount, 1);
    assert.equal(exported.metadata.source.type, "tle");
    assert.deepEqual(exported.metadata.simulationRange, simulationRange);
    assert.deepEqual(exported.metadata.presentation.timeFilter, {
        mode: "custom",
        start: "2026-09-01T00:30:00.000Z",
        end: "2026-09-01T01:30:00.000Z"
    });
    assert.deepEqual(exported.metadata.presentation.sort, { column: "x", direction: "desc" });
    assert.equal(exported.metadata.presentation.ignoredCallback, null);
    assert.match(exported.content, /^# Orbit propagated parameters\n# metadata: /);
    assert.match(exported.content, /"2026-09-01T01:00:00\.000Z","6801","7\.693"/);
});

test("normalised rows retain direct acceleration, clock, quality, event, and covariance metadata", () => {
    const result = tleResult([{
        time: "2026-09-01T00:00:00.000Z",
        reference_frame: "ITRF",
        state: {
            position: { x: 6800, y: 10, z: -20 },
            velocity: { x: 0.1, y: 7.6, z: 1.2 },
            position_units: "km",
            velocity_units: "km/s",
            acceleration: { x: 0.001, y: -0.002, z: 0.003 },
            acceleration_units: "km/s^2",
            covariance: [[1, 0], [0, 4]],
            covariance_units: "SI-state-vector",
            provenance: {
                sp3_clock_bias_seconds: 0.0000125,
                sp3_clock_rate_seconds_per_second: -2.5e-12,
                clock_sigma_seconds: 2.5e-7,
                sp3_header_orbit_sigma_mm: 8192,
                sp3_header_orbit_sigma_units: "mm",
                quality_flag: "final",
                event_flag: "ECLIPSE_EXIT",
                maneuver_flag: false,
                oem_covariance: {
                    attached: true,
                    epoch: "2026-09-01T00:00:00.000Z",
                    declared_reference_frame: "RSW",
                    resolved_reference_frame: "ITRF",
                    transformed_to_state_frame: true
                }
            }
        },
        sigma: 0.25,
        sigma_units: "m",
        rms: 0.4,
        rms_units: "m"
    }]);
    const inspector = buildPropagatedParametersInspector(tleContext, result);
    const row = inspector.rows[0];

    assert.deepEqual(
        {
            ax: row.ax,
            ay: row.ay,
            az: row.az,
            clock: row.clock,
            clockRate: row.clockRate,
            clockSigma: row.clockSigma,
            sp3HeaderOrbitSigma: row.sp3HeaderOrbitSigma,
            sigma: row.sigma,
            rms: row.rms,
            quality: row.quality,
            event: row.event,
            maneuver: row.maneuver
        },
        {
            ax: 0.001,
            ay: -0.002,
            az: 0.003,
            clock: 12500,
            clockRate: -2.5e-12,
            clockSigma: 250,
            sp3HeaderOrbitSigma: 8192,
            sigma: 250,
            rms: 400,
            quality: "final",
            event: "ECLIPSE_EXIT",
            maneuver: false
        }
    );
    assert.deepEqual(row.fieldUnits, {
        ax: "km/s^2",
        ay: "km/s^2",
        az: "km/s^2",
        clock: "ns",
        clockRate: "s/s",
        clockSigma: "ns",
        sp3HeaderOrbitSigma: "mm",
        sigma: "mm",
        rms: "mm",
        covariance: "SI-state-vector"
    });
    assert.deepEqual(row.fieldProvenance, {
        ax: "state-direct",
        ay: "state-direct",
        az: "state-direct",
        clock: "state-provenance",
        clockRate: "state-provenance",
        clockSigma: "state-provenance",
        sp3HeaderOrbitSigma: "state-provenance",
        sigma: "sample-direct",
        rms: "sample-direct",
        quality: "state-provenance",
        event: "state-provenance",
        maneuver: "state-provenance",
        covariance: "state-direct"
    });
    assert.match(row.covariance, /^Matriz 2×2 · ITRF · transformada al marco de estado$/);
    assert.deepEqual(row.covarianceDetails, {
        available: true,
        attached: true,
        dimensions: "2×2",
        unit: "SI-state-vector",
        referenceFrame: "ITRF",
        epoch: "2026-09-01T00:00:00.000Z",
        transformedToStateFrame: true,
        reason: null,
        matrix: [[1, 0], [0, 4]],
        provenance: {
            attached: true,
            epoch: "2026-09-01T00:00:00.000Z",
            declared_reference_frame: "RSW",
            resolved_reference_frame: "ITRF",
            transformed_to_state_frame: true
        }
    });
    assert.deepEqual(
        inspector.columns
            .filter(({ id }) => ["ax", "ay", "az", "clock", "clockRate", "clockSigma", "sp3HeaderOrbitSigma", "sigma", "rms", "quality", "event", "maneuver", "covariance"].includes(id))
            .map(({ id, unit, group, type, provenance, origins }) => ({ id, unit, group, type, provenance, origins })),
        [
            { id: "ax", unit: "km/s^2", group: "acceleration", type: "acceleration", provenance: "direct", origins: ["state-direct"] },
            { id: "ay", unit: "km/s^2", group: "acceleration", type: "acceleration", provenance: "direct", origins: ["state-direct"] },
            { id: "az", unit: "km/s^2", group: "acceleration", type: "acceleration", provenance: "direct", origins: ["state-direct"] },
            { id: "clock", unit: "ns", group: "clock", type: "number", provenance: "direct", origins: ["state-provenance"] },
            { id: "clockRate", unit: "s/s", group: "clock", type: "number", provenance: "direct", origins: ["state-provenance"] },
            { id: "clockSigma", unit: "ns", group: "clock", type: "number", provenance: "direct", origins: ["state-provenance"] },
            { id: "sigma", unit: "mm", group: "quality", type: "number", provenance: "direct", origins: ["sample-direct"] },
            { id: "sp3HeaderOrbitSigma", unit: "mm", group: "quality", type: "number", provenance: "direct", origins: ["state-provenance"] },
            { id: "rms", unit: "mm", group: "quality", type: "number", provenance: "direct", origins: ["sample-direct"] },
            { id: "quality", unit: null, group: "quality", type: "quality", provenance: "direct", origins: ["state-provenance"] },
            { id: "event", unit: null, group: "event", type: "flag", provenance: "direct", origins: ["state-provenance"] },
            { id: "maneuver", unit: null, group: "event", type: "flag", provenance: "direct", origins: ["state-provenance"] },
            { id: "covariance", unit: "SI-state-vector", group: "covariance", type: "text", provenance: "direct", origins: ["state-direct"] }
        ]
    );

    const exported = buildPropagatedParametersExport({
        context: tleContext,
        result,
        inspector,
        format: "json",
        columns: ["time", "referenceFrame", "ax", "covariance"]
    });
    assert.deepEqual(exported.rows, [{
        time: "2026-09-01T00:00:00.000Z",
        referenceFrame: "ITRF",
        ax: 0.001,
        covariance: row.covariance
    }]);
    assert.equal(exported.rowMetadata.length, 1);
    assert.deepEqual(exported.document.rowMetadata[0], {
        exportRow: 1,
        epoch: "2026-09-01T00:00:00.000Z",
        referenceFrame: "ITRF",
        cartesianUnits: { position: "km", velocity: "km/s" },
        fieldUnits: row.fieldUnits,
        fieldProvenance: row.fieldProvenance,
        derived: { radiusKm: "cartesian-position-magnitude", speedKmS: "cartesian-velocity-magnitude" },
        covariance: row.covarianceDetails,
        nativeProvenance: result.samples[0].state.provenance
    });
});

test("visible exports preserve distinct samples that share an epoch and record their generation time", () => {
    const epoch = "2026-09-01T00:00:00.000Z";
    const result = tleResult([
        stateSample(epoch, { x: 6800 }),
        stateSample(epoch, { x: 6801 })
    ]);
    const inspector = buildPropagatedParametersInspector(tleContext, result);
    const exported = buildPropagatedParametersExport({
        context: tleContext,
        result,
        inspector,
        scope: "visible",
        // A view may hand the exporter row copies, not the original objects.
        rows: inspector.rows.map(({ time }) => ({ time })),
        columns: ["time", "x"],
        generatedAtUtc: "2026-09-01T03:00:00.000Z"
    });

    assert.deepEqual(exported.rows, [
        { time: epoch, x: 6800 },
        { time: epoch, x: 6801 }
    ]);
    assert.equal(exported.metadata.rowCount, 2);
    assert.equal(exported.metadata.generatedAtUtc, "2026-09-01T03:00:00.000Z");
});
