import assert from "node:assert/strict";
import test from "node:test";

import { buildObjectDetails } from "../../../react-ui/src/features/objectDetails/detailRows.js";

const labels = (rows) => rows.map(([label]) => label);
const valueFor = (rows, label) => rows.find(([rowLabel]) => rowLabel === label)?.[1];

test("orbit reports Cartesian state only in the declared frame", () => {
    const details = buildObjectDetails({
        id: "SAT-1",
        sourceFormat: "TLE",
        visible: true,
        tleSummary: { meanMotionRevDay: "15.50036215" },
        orbitInfo: { label: "LEO", recommendedWindow: "7 days" },
        telemetry: {
            id: "SAT-1",
            geo: { latitude_deg: 40.2, longitude_deg: -3.7, altitude_m: 550000 },
            speed_m_s: 7601.2,
            position: { x: 6500000, y: 1200000, z: 1800000 },
            velocity: { x: -1400, y: 7200, z: 2100 },
            earth_center_distance_m: 6890000,
            position_frame: "ITRF",
            velocity_frame: "ITRF",
            ground_track_enabled: false,
            footprint_radius_m: 2500000
        }
    });

    const orbit = details.rows.orbit;
    assert.equal(valueFor(orbit, "Marco de referencia"), "ITRF");
    assert.equal(valueFor(orbit, "Posición ITRF"), "(6500.0, 1200.0, 1800.0) km");
    assert.equal(valueFor(orbit, "Velocidad ITRF"), "(-1400.0, 7200.0, 2100.0) m/s");
    assert.equal(valueFor(orbit, "Latitud"), "40.2000 deg");
    assert.equal(valueFor(orbit, "Longitud"), "-3.7000 deg");
    assert.equal(valueFor(orbit, "Altitud"), "550.0 km");
    assert.equal(valueFor(orbit, "Ground track"), "Desactivado");
    assert.equal(valueFor(orbit, "Radio de huella"), "No activo");
    for (const inventedLabel of ["Position ECI", "Velocity ECI", "Position ECEF", "Velocity ECEF"]) {
        assert.equal(labels(orbit).includes(inventedLabel), false, `${inventedLabel} must never be invented`);
    }
});

test("a non-terrestrial state never gets false geographic coordinates", () => {
    const details = buildObjectDetails({
        id: "OEM-TEME",
        sourceFormat: "OEM",
        visible: true,
        telemetry: {
            id: "OEM-TEME",
            position: { x: 7000000, y: -1200000, z: 400000 },
            velocity: { x: 1200, y: 7100, z: -800 },
            position_frame: "TEME",
            velocity_frame: "TEME",
            earth_center_distance_m: 7112000
        }
    });
    const orbit = details.rows.orbit;

    assert.equal(valueFor(orbit, "Marco de referencia"), "TEME");
    assert.equal(valueFor(orbit, "Posición TEME"), "(7000.0, -1200.0, 400.0) km");
    assert.equal(valueFor(orbit, "Velocidad TEME"), "(1200.0, 7100.0, -800.0) m/s");
    assert.equal(valueFor(orbit, "Latitud"), "No aplicable: TEME no es terrestre");
    assert.equal(valueFor(orbit, "Longitud"), "No aplicable: TEME no es terrestre");
    assert.equal(valueFor(orbit, "Altitud"), "No aplicable: TEME no es terrestre");
});

test("telemetry is restricted to values that can change frame by frame", () => {
    const details = buildObjectDetails({
        id: "SAT-2",
        telemetry: {
            id: "SAT-2",
            speed_km_h: 27364.3,
            speed_m_s: 7601.2,
            velocity_ecef_m_s: { x: -1400, y: 7200, z: 2100 },
            acceleration_ecef_m_s2: { x: 0.2, y: -0.1, z: 0.05 },
            doppler_shift_hz: -245,
            signal_delay_ms: 18.3,
            path_loss_db: 151.2,
            runtime_state: "ACTIVE",
            telemetry_age_ms: 241,
            simulation: {
                mode: "simulated",
                current_time: "2026-07-19T11:30:00.000Z",
                time_scale: 10,
                is_playing: true
            }
        }
    });
    const telemetry = details.rows.telemetry;

    for (const dynamicLabel of ["Velocidad", "Vector velocidad", "Aceleración", "Vector aceleración", "Doppler", "Retardo de señal", "Pérdida de trayecto", "Estado del satélite", "Modo temporal", "Escala temporal", "Edad de telemetría"]) {
        assert.ok(labels(telemetry).includes(dynamicLabel), `${dynamicLabel} must be visible in telemetry`);
    }
    assert.equal(valueFor(telemetry, "Modo temporal"), "Simulated");
    assert.equal(valueFor(telemetry, "Escala temporal"), "10×");
    assert.equal(valueFor(telemetry, "Doppler"), "-245.0 Hz");
    for (const staticLabel of ["Época", "Línea TLE 1", "Modelo de fuerzas", "Marco de integración"]) {
        assert.equal(labels(telemetry).includes(staticLabel), false, `${staticLabel} does not belong to telemetry`);
    }
});

test("orbit keeps visibility and station information separate from source input", () => {
    const details = buildObjectDetails({
        id: "SAT-3",
        sourceFormat: "TLE",
        telemetry: {
            id: "SAT-3",
            position_frame: "ITRF",
            station_distance_m: 1204000,
            aos: "2026-07-19T11:45:00.000Z",
            los: "2026-07-19T11:51:00.000Z",
            ground_track_enabled: true,
            ground_track_visible: true,
            footprint_radius_m: 2085200
        }
    });
    const orbit = details.rows.orbit;
    assert.equal(valueFor(orbit, "Distancia a estación"), "1204.0 km");
    assert.equal(valueFor(orbit, "AOS / LOS"), "2026-07-19 11:45 UTC · 2026-07-19 11:51 UTC");
    assert.equal(valueFor(orbit, "Ground track"), "Activo");
    assert.equal(valueFor(orbit, "Radio de huella"), "2085.2 km");
});
