import assert from "node:assert/strict";
import test from "node:test";

import { buildObjectDetails } from "../../../react-ui/src/features/objectDetails/detailRows.js";

test("overview absorbs info rows and exposes the live simulation interval", () => {
    const details = buildObjectDetails({
        id: "SAT-1",
        sourceFormat: "OEM",
        visible: true,
        telemetry: { id: "SAT-1", geo: {} },
        timeRange: {
            startDate: "2026-07-19T10:00:00.000Z",
            endDate: "2026-07-19T16:00:00.000Z",
            label: "6 h hacia futuro"
        }
    });

    assert.equal("info" in details.rows, false);
    assert.equal(details.rows.overview.find(([label]) => label === "Fecha inicio")?.[1], "2026-07-19 10:00 UTC");
    assert.equal(details.rows.overview.find(([label]) => label === "Fecha fin")?.[1], "2026-07-19 16:00 UTC");
    assert.equal(details.rows.overview.find(([label]) => label === "Rango OEM")?.[1], "6 h hacia futuro");
});

test("overview falls back to the simulation-range duration label", () => {
    const details = buildObjectDetails({
        id: "SAT-2",
        telemetry: { id: "SAT-2", geo: {} },
        timeRange: { mode: "range", oemRangeHours: 24 }
    });

    assert.equal(details.rows.overview.find(([label]) => label === "Rango OEM")?.[1], "24 h (inicio → fin)");
});

test("overview stays administrative and uses only available catalogue metadata", () => {
    const details = buildObjectDetails({
        id: "SENTINEL-TEST",
        sourceFormat: "TLE",
        active: true,
        visible: true,
        referenceTimeMs: Date.parse("2026-07-19T06:00:00.000Z"),
        telemetry: {
            id: "SENTINEL-TEST",
            geo: { altitude_m: 511000 },
            timestamp_ms: Date.parse("2026-07-19T06:00:00.000Z")
        },
        catalogMeta: {
            name: "Sentinel Test",
            missionType: "Earth observation",
            operatorLabel: "ESA",
            country: "Spain",
            sourceFormat: "TLE",
            tleSource: "Celestrak",
            objectId: "2026-001A",
            launchDate: "2026-01-10T00:00:00.000Z",
            launchVehicle: "Vega-C",
            launchSite: "CSG",
            updatedAt: "2026-07-18T12:00:00.000Z"
        },
        tleSummary: { epoch: "26197.25000000" },
        orbitInfo: { label: "LEO", altitudeKm: 512.345, recommendedMaxDays: 3 }
    });
    const overview = Object.fromEntries(details.rows.overview);

    assert.equal(details.title, "Sentinel Test");
    assert.equal(overview["Nombre"], "Sentinel Test");
    assert.equal(overview["Misión"], "Earth observation");
    assert.equal(overview["Operador / agencia"], "ESA");
    assert.equal(overview["Fuente TLE"], "Celestrak");
    assert.equal(overview["Estado TLE"], "Vigente");
    assert.equal(overview["Edad TLE"], "72.0 h");
    assert.equal(overview["Fecha de lanzamiento"], "2026-01-10 00:00 UTC");
    assert.equal(overview["Última actualización"], "2026-07-18 12:00 UTC");
    assert.equal(overview["Inclination"], undefined);
    assert.equal(overview["RAAN"], undefined);
    assert.equal(overview["Velocity"], undefined);
});

test("overview marks an outdated TLE without fabricating missing metadata", () => {
    const details = buildObjectDetails({
        id: "SAT-OLD",
        sourceFormat: "TLE",
        referenceTimeMs: Date.parse("2026-07-25T06:00:00.000Z"),
        telemetry: { id: "SAT-OLD", geo: {} },
        tleSummary: { epoch: "26197.25000000" },
        orbitInfo: { recommendedMaxDays: 3 }
    });
    const overview = Object.fromEntries(details.rows.overview);

    assert.equal(overview["Estado TLE"], "Caducado");
    assert.equal(overview["Operador / agencia"], "-");
    assert.equal(overview["Fecha de lanzamiento"], "-");
});

test("overview uses the TLE international designator when the catalogue omits Object ID", () => {
    const details = buildObjectDetails({
        id: "SAT-LAYER-ID",
        sourceFormat: "TLE",
        telemetry: { id: "SAT-LAYER-ID", geo: {} },
        catalogMeta: { name: "Satellite" },
        tleSummary: { internationalDesignator: "26001A" }
    });

    assert.equal(Object.fromEntries(details.rows.overview)["Object ID"], "26001A");
});

test("overview rejects an impossible non-leap TLE day instead of rolling it into the next year", () => {
    const details = buildObjectDetails({
        id: "SAT-INVALID-EPOCH",
        sourceFormat: "TLE",
        referenceTimeMs: Date.parse("2026-01-01T00:00:00.000Z"),
        telemetry: { id: "SAT-INVALID-EPOCH", geo: {} },
        tleSummary: { epoch: "25366.50000000" },
        orbitInfo: { recommendedMaxDays: 3 }
    });
    const overview = Object.fromEntries(details.rows.overview);

    assert.equal(overview["Edad TLE"], "-");
    assert.equal(overview["Estado TLE"], "-");
});

test("a confirmed manual orbit exposes only its authored definition in Manual Params", () => {
    const details = buildObjectDetails({
        id: "manual:demo",
        sourceFormat: "MANUAL",
        telemetry: { id: "Manual demo", geo: {} },
        catalogMeta: {
            name: "Manual demo",
            sourceFormat: "MANUAL",
            manualOrbit: {
                definitionSource: "keplerian",
                propagator: "sgp4",
                objectMetadata: {
                    objectType: "satellite",
                    missionType: "Earth observation",
                    operator: "Orbit Agency",
                    country: "ES",
                    launchDate: "2026-07-01T00:00:00.000Z"
                },
                propagationOptions: {
                    atmosphericDrag: true,
                    dragCoefficient: 2.2,
                    areaM2: 1.5,
                    massKg: 120
                },
                epochUtc: "2026-07-20T10:00:00.000Z",
                startTime: "2026-07-20T10:00:00.000Z",
                endTime: "2026-07-20T16:00:00.000Z",
                groundTrackEnabled: true,
                keplerian: {
                    semi_major_axis_km: 6878,
                    eccentricity: 0.01,
                    inclination_deg: 51.6,
                    raan_deg: 25,
                    argument_of_perigee_deg: 70,
                    true_anomaly_deg: 12
                },
                stateVector: {
                    position_eci_km: { x: 6800, y: 20, z: 15 },
                    velocity_eci_km_s: { x: 0.1, y: 7.6, z: 0.2 }
                },
                summary: {
                    perigee_altitude_km: 431.1,
                    apogee_altitude_km: 568.7,
                    orbital_period_seconds: 5676
                }
            }
        }
    });
    const manual = Object.fromEntries(details.rows.manual);
    const overview = Object.fromEntries(details.rows.overview);

    assert.equal(manual.Definition, "keplerian");
    assert.equal(manual["Propagation engine"], "SGP4 / TLE propagation");
    // SGP4 has its own TLE/BSTAR model; stale manual drag fields must not be
    // presented as active Cowell physics.
    assert.equal("Atmospheric drag" in manual, false);
    assert.equal("Drag coefficient" in manual, false);
    assert.equal("Reference area" in manual, false);
    assert.equal("Mass" in manual, false);
    assert.equal(manual["Ground track"], "On");
    assert.equal(manual.Perigee, "431.100 km");
    assert.equal(manual.Apogee, "568.700 km");
    assert.equal(manual.Period, "94.600 min");
    assert.equal(manual["Arg. periapsis"], "70.0000 deg");
    assert.equal(manual["Position EME2000"], "(6800.000, 20.000, 15.000) km");
    assert.equal(manual["Velocity EME2000"], "(0.10000, 7.60000, 0.20000) km/s");
    assert.equal("Position ECI" in manual, false);
    assert.equal("Velocity ECI" in manual, false);
    assert.equal(overview["Object type"], "satellite");
    assert.equal(overview["Misión"], "Earth observation");
    assert.equal(overview["Operador / agencia"], "Orbit Agency");
    assert.equal(overview["País"], "ES");
});

test("manual Cowell details expose an independent, composable set of force terms", () => {
    const details = buildObjectDetails({
        id: "manual:cowell",
        sourceFormat: "MANUAL",
        telemetry: { id: "Cowell demo", geo: {} },
        catalogMeta: {
            manualOrbit: {
                propagator: "cowell-rk4",
                propagationOptions: {
                    numericalIntegrator: "rk4",
                    // The modern set is authoritative: J4 can be enabled
                    // independently of J3 and drag is a force term too.
                    forceTerms: ["central", "j2", "j4", "drag"],
                    atmosphericDrag: false
                }
            }
        }
    });

    const manual = Object.fromEntries(details.rows.manual);
    assert.equal(manual["Propagation engine"], "Cowell numerical propagation");
    assert.equal(manual["Numerical integrator"], "RK4");
    assert.equal(manual["Force terms"], "Central gravity + J2 + J4 + Atmospheric drag");
    assert.equal(manual["Atmospheric drag"], "On");
});

test("legacy Cowell drag-only records retain their historical zonal force interpretation", () => {
    const details = buildObjectDetails({
        id: "manual:legacy-cowell",
        sourceFormat: "MANUAL",
        telemetry: { id: "Legacy Cowell", geo: {} },
        catalogMeta: {
            manualOrbit: {
                propagator: "cowell-rk4",
                propagationOptions: { atmosphericDrag: true }
            }
        }
    });

    const manual = Object.fromEntries(details.rows.manual);
    assert.equal(
        manual["Force terms"],
        "Central gravity + J2 + J3 + J4 + Atmospheric drag"
    );
    assert.equal(manual["Atmospheric drag"], "On");
});

test("celestial layers expose only native ephemeris fields, never TLE or propagation controls", () => {
    const details = buildObjectDetails({
        id: "body:moon",
        layerType: "CELESTIAL_BODY",
        sourceFormat: "CELESTIAL",
        visible: true,
        telemetry: {
            id: "Moon",
            source_format: "CELESTIAL",
            celestial_body: "moon",
            body_radius_m: 1_737_400,
            earth_center_distance_m: 384_400_000,
            position_ecef_m: { x: 1000, y: 2000, z: 3000 },
            position_frame: "ITRF / ECEF",
            runtime_state: "ACTIVE",
            simulation: { current_time: "2026-07-22T10:00:00.000Z", mode: "simulated", time_scale: 10 }
        }
    });

    const overview = Object.fromEntries(details.rows.overview);
    const orbit = Object.fromEntries(details.rows.orbit);
    assert.equal(overview["Object type"], "Cuerpo de referencia");
    assert.equal(overview.Source, "Modelo de referencia");
    assert.equal(overview["Physical radius"], "1737400 m");
    assert.equal(orbit["Reference frame"], "ITRF / ECEF");
    assert.equal("Estado TLE" in overview, false);
    assert.deepEqual(details.rows.manual, []);
});

test("the permanent Earth layer is also treated as a physical body, never a TLE object", () => {
    const details = buildObjectDetails({
        id: "body:earth",
        layerType: "EARTH",
        visible: true,
        telemetry: {
            id: "Earth",
            celestial_body: "earth",
            body_radius_m: 6_378_137,
            earth_center_distance_m: 0,
            position_ecef_m: { x: 0, y: 0, z: 0 },
            position_frame: "ITRF / ECEF"
        }
    });

    const overview = Object.fromEntries(details.rows.overview);
    assert.equal(details.noradId, "-");
    assert.equal(overview.Body, "Earth");
    assert.equal("Estado TLE" in overview, false);
    assert.deepEqual(details.rows.manual, []);
});
