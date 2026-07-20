import assert from "node:assert/strict";
import test from "node:test";

import { buildObjectDetails } from "../../../react-ui/src/features/objectDetails/detailRows.js";

const labels = (rows) => rows.map(([label]) => label);
const valueFor = (rows, label) => rows.find(([rowLabel]) => rowLabel === label)?.[1];

test("orbit keeps live geographic/ECEF state out of TLE and telemetry rows", () => {
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
            position_ecef_m: { x: 6500000, y: 1200000, z: 1800000 },
            velocity_ecef_m_s: { x: -1400, y: 7200, z: 2100 },
            earth_center_distance_m: 6890000,
            position_frame: "ECEF",
            ground_track_enabled: true,
            footprint_radius_m: 2500000
        }
    });

    const orbitLabels = labels(details.rows.orbit);
    assert.ok(orbitLabels.includes("Position ECEF"));
    assert.ok(orbitLabels.includes("Velocity ECEF"));
    assert.ok(orbitLabels.includes("Earth center distance"));
    assert.ok(orbitLabels.includes("Ground track"));
    assert.equal(valueFor(details.rows.orbit, "Position ECI"), "-");
    assert.equal(valueFor(details.rows.orbit, "Reference frame"), "ECEF");
    assert.equal(valueFor(details.rows.orbit, "Orbital period"), "92.90 min");
    for (const staticTleLabel of ["Inclination", "RAAN", "Eccentricity", "Epoch", "BSTAR", "Mean motion"]) {
        assert.equal(orbitLabels.includes(staticTleLabel), false, `${staticTleLabel} belongs to TLE parameters`);
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
