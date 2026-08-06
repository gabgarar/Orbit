import assert from "node:assert/strict";
import test from "node:test";

import { buildObjectDetails } from "../../../react-ui/src/features/objectDetails/detailRows.js";

const asObject = (rows) => Object.fromEntries(rows);
const tabNames = ["overview", "orbit", "telemetry", "input", "propagation"];

test("the object inspector exposes the same five tabs for every orbital source", () => {
    for (const sourceFormat of ["TLE", "OMM", "OEM", "SP3", "MANUAL", "STATE_VECTOR"]) {
        const details = buildObjectDetails({
            id: `source:${sourceFormat}`,
            sourceFormat,
            telemetry: { id: `source:${sourceFormat}`, geo: {} },
            catalogMeta: sourceFormat === "MANUAL" ? { manualOrbit: {} } : {}
        });
        assert.deepEqual(Object.keys(details.rows), tabNames, sourceFormat);
    }
});

test("overview remains administrative and records identity, input epoch, freshness and quality", () => {
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
            updatedAt: "2026-07-18T12:00:00.000Z"
        },
        tleSummary: { epoch: "26197.25000000", noradId: "99999", internationalDesignator: "26001A" },
        orbitInfo: { label: "LEO", altitudeKm: 512.345, recommendedMaxDays: 3 }
    });
    const overview = asObject(details.rows.overview);

    assert.equal(details.title, "Sentinel Test");
    assert.equal(overview.Nombre, "Sentinel Test");
    assert.equal(overview.NORAD, "99999");
    assert.equal(overview.COSPAR, "2026-001A");
    assert.equal(overview["Tipo de entrada"], "TLE");
    assert.equal(overview["Época de entrada"], "2026-07-16 06:00 UTC");
    assert.equal(overview.Fuente, "Celestrak");
    assert.equal(overview["Estado del objeto"], "Operational");
    assert.equal(overview["Fecha de lanzamiento"], "2026-01-10 00:00 UTC");
    assert.equal(overview["Edad del dato"], "72.0 h");
    assert.equal(overview["Calidad del dato"], "Buena");
    assert.equal(overview["Misión"], "Earth observation");
    assert.equal(overview["Operador / agencia"], "ESA");
    assert.equal(overview["Última actualización"], "2026-07-18 12:00 UTC");
    assert.equal(overview["Modelo de fuerzas"], undefined);
    assert.equal(overview["Posición ITRF"], undefined);
});

test("TLE input contains the original element set and derived orbital quantities", () => {
    const details = buildObjectDetails({
        id: "SAT-1",
        sourceFormat: "TLE",
        telemetry: { id: "SAT-1", geo: {} },
        tleSummary: {
            line1: "1 25544U 98067A   26197.25000000  .00000000  00000-0  00000-0 0  9991",
            line2: "2 25544  51.6400  10.0000 0005000  20.0000 340.0000 15.50000000123456",
            epoch: "26197.25000000",
            meanMotionRevDay: "15.50000000",
            bstar: "00000-0",
            inclinationDeg: "51.6400",
            raanDeg: "10.0000",
            eccentricity: "0.0005000",
            argPerigeeDeg: "20.0000",
            meanAnomalyDeg: "340.0000"
        }
    });
    const input = asObject(details.rows.input);

    assert.equal(input["Tipo de entrada"], "TLE");
    assert.match(input["Línea TLE 1"], /^1 25544U/);
    assert.match(input["Línea TLE 2"], /^2 25544/);
    assert.equal(input.BSTAR, "00000-0");
    assert.equal(input["Movimiento medio"], "15.50000000 rev/día");
    assert.equal(input.Inclinación, "51.6400 deg");
    assert.equal(input.RAAN, "10.0000 deg");
    assert.equal(input["Anomalía media"], "340.0000 deg");
    assert.notEqual(input["Período"], "-");
    assert.notEqual(input["Semieje mayor"], "-");
    assert.notEqual(input.Perigeo, "-");
    assert.notEqual(input.Apogeo, "-");
    assert.equal(asObject(details.rows.propagation).Motor, "SGP4");
    assert.equal(asObject(details.rows.propagation)["Marco de integración"], "TEME");
});

test("manual input and propagation are intentionally split", () => {
    const details = buildObjectDetails({
        id: "manual:cowell",
        sourceFormat: "MANUAL",
        telemetry: { id: "Manual demo", geo: {}, position_frame: "ITRF" },
        catalogMeta: {
            name: "Manual demo",
            manualOrbit: {
                definitionSource: "state_vector",
                propagator: "cowell-rk4",
                epochUtc: "2026-07-20T10:00:00.000Z",
                stateVector: {
                    referenceFrame: "EME2000",
                    position_eci_km: { x: 6800, y: 20, z: 15 },
                    velocity_eci_km_s: { x: 0.1, y: 7.6, z: 0.2 }
                },
                keplerian: {
                    semi_major_axis_km: 6878,
                    eccentricity: 0.01,
                    inclination_deg: 51.6,
                    raan_deg: 25,
                    argument_of_perigee_deg: 70,
                    true_anomaly_deg: 12
                },
                summary: {
                    perigeeKm: 420,
                    apogeeKm: 980
                },
                propagationOptions: {
                    numericalIntegrator: "rk4",
                    forceTerms: ["central", "j2", "drag"]
                }
            }
        }
    });
    const input = asObject(details.rows.input);
    const propagation = asObject(details.rows.propagation);

    assert.equal(input.Definición, "state_vector");
    assert.equal(input["Marco del vector de estado"], "EME2000");
    assert.equal(input["r / Posición EME2000"], "(6800.000, 20.000, 15.000) km");
    assert.equal(input["v / Velocidad EME2000"], "(0.10000, 7.60000, 0.20000) km/s");
    assert.equal(input["Semieje mayor"], "6878.000 km");
    assert.equal(input.Perigeo, "420.000 km");
    assert.equal(input.Apogeo, "980.000 km");
    assert.equal(propagation.Motor, "Cowell numerical propagation");
    assert.equal(propagation.Integrador, "RK4");
    assert.equal(propagation["Modelo de fuerzas"], "Central gravity + J2 + Atmospheric drag");
    assert.equal(propagation["Marco de integración"], "EME2000");
    assert.equal(propagation["Marco de salida"], "ITRF");
    assert.equal(input.Motor, undefined);
});

test("OMM, OEM and SP3 retain their own input vocabulary without masquerading as TLE", () => {
    const omm = asObject(buildObjectDetails({
        id: "OMM-1",
        sourceFormat: "OMM",
        telemetry: { id: "OMM-1", geo: {} },
        tleSummary: { epoch: "26197.25000000", line1: "1 test", line2: "2 test" }
    }).rows.input);
    assert.equal(omm["Tipo de entrada"], "OMM");
    assert.equal(omm["Representación activa"], "SGP4 con TLE derivado");
    assert.equal(omm.Covarianza, "No disponible en la fuente");
    assert.equal(omm["Línea TLE 1"], undefined);

    const oem = asObject(buildObjectDetails({
        id: "OEM-1",
        sourceFormat: "OEM",
        telemetry: {
            id: "OEM-1",
            geo: {},
            oem: { file_name: "orbit.oem", object_name: "Test", object_id: "2026-001A", center_name: "EARTH", ref_frame: "ITRF", time_system: "UTC", start_time_ms: Date.parse("2026-07-19T10:00:00Z"), end_time_ms: Date.parse("2026-07-19T12:00:00Z"), samples: 12 }
        }
    }).rows.input);
    assert.equal(oem.Archivo, "orbit.oem");
    assert.equal(oem["Marco declarado"], "ITRF");
    assert.equal(oem.Muestras, "12");
    assert.equal(oem.Maniobras, "No disponible en la fuente");

    const sp3 = asObject(buildObjectDetails({ id: "SP3-1", sourceFormat: "SP3", telemetry: { id: "SP3-1", geo: {} } }).rows.input);
    assert.equal(sp3["Tipo de entrada"], "SP3");
    assert.equal(sp3.Estado, "Formato preparado; aún no conectado al runtime");
});

test("celestial bodies retain the common tabs without a fictional TLE engine", () => {
    const details = buildObjectDetails({
        id: "body:earth",
        layerType: "EARTH",
        sourceFormat: "CELESTIAL",
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
    const overview = asObject(details.rows.overview);
    const propagation = asObject(details.rows.propagation);
    assert.equal(details.noradId, "-");
    assert.equal(overview["Tipo de objeto"], "Cuerpo de referencia");
    assert.equal(propagation.Motor, "No aplica");
});
