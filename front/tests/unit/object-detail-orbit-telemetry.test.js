import assert from "node:assert/strict";
import test from "node:test";

import { buildObjectDetails } from "../../../react-ui/src/features/objectDetails/detailRows.js";

const labels = (rows) => rows.map(([label]) => label);
const valueFor = (rows, label) => rows.find(([rowLabel]) => rowLabel === label)?.[1];

test("orbit labels a catalogue state with its declared ITRF frame and omits inert rows", () => {
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

    const orbitLabels = labels(details.rows.orbit);
    assert.ok(orbitLabels.includes("Position ITRF"));
    assert.ok(orbitLabels.includes("Velocity ITRF"));
    assert.ok(orbitLabels.includes("Earth center distance"));
    assert.ok(orbitLabels.includes("Ground track"));
    assert.equal(valueFor(details.rows.orbit, "Position ITRF"), "(6500.0, 1200.0, 1800.0) km");
    assert.equal(valueFor(details.rows.orbit, "Velocity ITRF"), "(-1400.0, 7200.0, 2100.0) m/s");
    assert.equal(valueFor(details.rows.orbit, "Reference frame"), "ITRF");
    assert.equal(valueFor(details.rows.orbit, "Orbital period"), "92.90 min");
    for (const unusedLabel of [
        "Position ECI", "Velocity ECI", "Position ECEF", "Velocity ECEF",
        "True anomaly", "Argument of latitude", "Station distance",
        "Elevation / azimuth", "AOS / LOS", "Footprint", "Footprint radius",
        "Velocity vector display"
    ]) {
        assert.equal(orbitLabels.includes(unusedLabel), false, `${unusedLabel} must not be rendered without a real value`);
    }
});

test("orbit preserves a non-terrestrial state frame instead of inventing ECI or ECEF aliases", () => {
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

    const orbitLabels = labels(details.rows.orbit);
    assert.equal(valueFor(details.rows.orbit, "Reference frame"), "TEME");
    assert.equal(valueFor(details.rows.orbit, "Position TEME"), "(7000.0, -1200.0, 400.0) km");
    assert.equal(valueFor(details.rows.orbit, "Velocity TEME"), "(1200.0, 7100.0, -800.0) m/s");
    for (const absentLabel of ["Position ECI", "Velocity ECI", "Position ECEF", "Velocity ECEF", "Latitude", "Longitude", "Altitude"]) {
        assert.equal(orbitLabels.includes(absentLabel), false, `${absentLabel} does not describe a TEME state`);
    }
});

test("telemetry contains frame-by-frame values without orbital/geographic rows", () => {
    const details = buildObjectDetails({
        id: "SAT-2",
        telemetry: {
            id: "SAT-2",
            speed_km_h: 27364.3,
            speed_m_s: 7601.2,
            velocity_ecef_m_s: { x: -1400, y: 7200, z: 2100 },
            acceleration_ecef_m_s2: { x: 0.2, y: -0.1, z: 0.05 },
            distance_to_camera_m: 1234,
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

    const telemetryLabels = labels(details.rows.telemetry);
    for (const dynamicLabel of ["Velocity vector", "Acceleration", "Acceleration vector", "Satellite state", "Simulation frame", "Simulation mode", "Time scale"]) {
        assert.ok(telemetryLabels.includes(dynamicLabel), `${dynamicLabel} must be visible in telemetry`);
    }
    assert.equal(valueFor(details.rows.telemetry, "Simulation mode"), "Simulated");
    assert.equal(valueFor(details.rows.telemetry, "Time scale"), "10×");
    for (const orbitalLabel of ["Latitude", "Longitude", "Altitude", "Propagation", "Recommended window", "Position ECEF"]) {
        assert.equal(telemetryLabels.includes(orbitalLabel), false, `${orbitalLabel} does not belong to telemetry`);
    }
});
