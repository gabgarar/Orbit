import assert from "node:assert/strict";
import test from "node:test";

import {
    calculateDishGainDbi,
    calculateDishHpbwDeg,
    calculateDirectionalPatternOffsetsDeg,
    calculatePointingLossDb,
    calculatePolarizationMismatchLossDb,
    calculateSatelliteDownlink,
    calculateSatelliteDownlinkEnvelope,
    calculateStationPlanningLink,
    calculateStationRfModel,
    calculateThermalNoiseFloorDbm,
    dbmToWatts,
    evaluateStationFieldOfRegard,
    isMechanicallyReachable,
    sampleStationGroundFootprint,
    sampleAntennaPattern,
    sampleSatelliteDownlinkPattern,
    wattsToDbm
} from "../../js/features/groundStations/rfModel.js";
import { buildStationFieldOfRegardMesh, buildStationPatternMesh, localHorizonDirection } from "../../js/features/groundStations/rfPatternMesh.js";

const BASE_STATION = {
    antenna_diameter_m: 1.2,
    antenna_efficiency: 0.6,
    frequency_mhz: 2200,
    tx_power_dbm: 38,
    min_link_power_dbm: -80,
    min_elevation_deg: 10,
    system_temperature_k: 500,
    receiver_bandwidth_hz: 25_000,
    atmospheric_loss_db: 0.5,
    rain_loss_db: 0,
    cable_loss_db: 1,
    connector_loss_db: 0.5,
    pointing_rms_mdeg: 50
};

test("RF model converts dBm and watts without losing the engineering unit", () => {
    assert.ok(Math.abs(dbmToWatts(30) - 1) < 1e-12);
    assert.ok(Math.abs(wattsToDbm(1) - 30) < 1e-12);
    assert.equal(wattsToDbm(0), null);
    const wattsConfigured = calculateStationRfModel({ ...BASE_STATION, tx_power_unit: "w", tx_power_w: 10, tx_power_dbm: null });
    assert.equal(wattsConfigured.tx_power_unit, "w");
    assert.ok(Math.abs(wattsConfigured.tx_power_dbm - 40) < 1e-12);
});

test("dish gain rises and HPBW narrows when frequency increases", () => {
    const lowGain = calculateDishGainDbi(1.2, 0.6, 1000);
    const highGain = calculateDishGainDbi(1.2, 0.6, 2200);
    assert.ok(highGain > lowGain);
    assert.ok(calculateDishHpbwDeg(1.2, 2200) < calculateDishHpbwDeg(1.2, 1000));
    const hertzConfigured = calculateStationRfModel({ ...BASE_STATION, frequency_unit: "hz", frequency_mhz: null, frequency_hz: 2_200_000_000 });
    assert.equal(hertzConfigured.frequency_unit, "hz");
    assert.equal(hertzConfigured.frequency_mhz, 2200);
});

test("legacy gain-only stations retain their explicit gain instead of deriving a dish", () => {
    const legacy = calculateStationRfModel({
        antenna_diameter_m: null,
        antenna_efficiency: null,
        frequency_mhz: 2200,
        tx_gain_dbi: 14,
        rx_gain_dbi: 12
    });
    assert.equal(legacy.tx_gain_mode, "override");
    assert.equal(legacy.rx_gain_mode, "override");
    assert.equal(legacy.tx_gain_dbi, 14);
    assert.equal(legacy.rx_gain_dbi, 12);
});

test("RF model reports physically traceable derived station values", () => {
    const model = calculateStationRfModel(BASE_STATION);
    assert.ok(model.gain_max_dbi > 20);
    assert.ok(model.hpbw_azimuth_deg > 0 && model.hpbw_azimuth_deg < 20);
    assert.ok(model.pointing_loss_db >= 0);
    assert.ok(model.total_system_loss_db > model.propagation_loss_db);
    assert.ok(Number.isFinite(model.system_gt_db_per_k));
    assert.ok(model.max_range_km > 0);
    assert.ok(model.operational_range_km > 0);
    assert.ok(model.visual_range_km <= model.operational_range_km);
    assert.ok(model.ground_footprint_radius_km > 0);
    assert.equal(model.range_contract, "reciprocal-planning");
});

test("pointing loss and thermal noise respond monotonically to their inputs", () => {
    const narrowLoss = calculatePointingLossDb(100, 1, 1);
    const wideLoss = calculatePointingLossDb(100, 5, 5);
    assert.ok(narrowLoss > wideLoss);
    assert.ok(calculateThermalNoiseFloorDbm(500, 100_000) > calculateThermalNoiseFloorDbm(500, 10_000));
});

test("opposite circular polarisation is rejected as a severe mismatch", () => {
    assert.equal(calculatePolarizationMismatchLossDb("RHCP", "RHCP"), 0);
    assert.equal(calculatePolarizationMismatchLossDb("RHCP", "LHCP"), 60);
    assert.equal(calculatePolarizationMismatchLossDb("LINEAR", "RHCP"), 3);
});

test("planning envelope degrades with range and exposes its reference nature", () => {
    const near = calculateStationPlanningLink(BASE_STATION, 500);
    const far = calculateStationPlanningLink(BASE_STATION, 5_000);
    assert.ok(near.received_power_dbm > far.received_power_dbm);
    assert.ok(near.link_margin_db > far.link_margin_db);
    assert.equal(near.range_contract, "reciprocal-planning");
});

test("planning range keeps the physical lower result and shares the operational ceiling", () => {
    const veryWeak = calculateStationRfModel({
        ...BASE_STATION,
        tx_power_dbm: -180,
        min_link_power_dbm: 40
    });
    assert.ok(veryWeak.max_range_km > 0 && veryWeak.max_range_km < 1);
    assert.equal(veryWeak.operational_range_km, veryWeak.max_range_km);

    const extreme = {
        ...BASE_STATION,
        tx_power_dbm: 180,
        tx_gain_mode: "override",
        rx_gain_mode: "override",
        tx_gain_override_dbi: 100,
        rx_gain_override_dbi: 100,
        min_link_power_dbm: -200
    };
    const capped = calculateStationRfModel(extreme);
    assert.ok(capped.max_range_km > capped.operational_range_km);
    const beyondCap = calculateStationPlanningLink(extreme, capped.operational_range_km + 1);
    assert.equal(beyondCap.within_operational_range, false);
    assert.equal(beyondCap.usable, false);
});

test("satellite SNR is unavailable without a complete compatible RF profile and available with one", () => {
    const missing = calculateSatelliteDownlink(BASE_STATION, null, 1_000);
    assert.equal(missing.available, false);
    assert.equal(missing.reason, "satellite-rf-profile-required");
    const incomplete = calculateSatelliteDownlink(BASE_STATION, { eirp_dbm: 42 }, 1_000);
    assert.equal(incomplete.available, false);
    assert.deepEqual(incomplete.missing_fields.sort(), ["bandwidth_hz", "frequency_mhz", "polarization"]);
    const available = calculateSatelliteDownlink(BASE_STATION, {
        eirp_dbm: 42,
        frequency_mhz: 2200,
        polarization: "RHCP",
        bandwidth_hz: 25_000
    }, 1_000);
    assert.equal(available.available, true);
    assert.ok(Number.isFinite(available.snr_db));
    assert.ok(Number.isFinite(available.received_power_dbm));
    const offChannel = calculateSatelliteDownlink(BASE_STATION, {
        eirp_dbm: 42,
        frequency_mhz: 2200.1,
        polarization: "RHCP",
        bandwidth_hz: 25_000
    }, 1_000);
    assert.equal(offChannel.available, false);
    assert.equal(offChannel.reason, "signal-outside-receiver-bandwidth");
});

test("remote RF profile requires the full occupied channel to fit the receiver", () => {
    const profile = {
        eirp_dbm: 42,
        frequency_mhz: 2200.006,
        polarization: "RHCP",
        bandwidth_hz: 25_000
    };
    const clipped = calculateSatelliteDownlinkEnvelope(BASE_STATION, profile);
    // The carrier is inside ±12.5 kHz, but the positive side of a 25 kHz
    // signal reaches +18.5 kHz and must not be accepted as a full channel.
    assert.equal(clipped.available, false);
    assert.equal(clipped.reason, "signal-outside-receiver-bandwidth");
    const fitted = calculateSatelliteDownlinkEnvelope(BASE_STATION, {
        ...profile,
        frequency_mhz: 2200,
        bandwidth_hz: 20_000
    });
    assert.equal(fitted.available, true);
    assert.ok(fitted.boresight_max_range_km > 0);
    assert.ok(fitted.operational_max_range_km > 0);
});

test("tangent-frame pattern offsets keep zenith free of a fake azimuth error", () => {
    const atZenith = calculateDirectionalPatternOffsetsDeg(180, 90, 0, 90);
    assert.ok(Math.abs(atZenith.azimuth_offset_deg) < 1e-9);
    assert.ok(Math.abs(atZenith.elevation_offset_deg) < 1e-9);
    assert.ok(Math.abs(atZenith.separation_deg) < 1e-9);
    assert.equal(isMechanicallyReachable({
        ...BASE_STATION,
        mechanical_azimuth_min_deg: -10,
        mechanical_azimuth_max_deg: 10
    }, 180, 90), true);
});

test("scan exposes a potential field but never invents an operational dwell", () => {
    const scan = {
        ...BASE_STATION,
        operation_mode: "scan",
        mechanical_azimuth_min_deg: -20,
        mechanical_azimuth_max_deg: 20,
        mechanical_elevation_min_deg: 10,
        mechanical_elevation_max_deg: 80
    };
    const field = evaluateStationFieldOfRegard(scan, 0, 45);
    const plan = calculateStationPlanningLink(scan, 100, { azimuthDeg: 0, elevationDeg: 45 });
    assert.equal(field.potentially_reachable, true);
    assert.equal(field.mode_requires_schedule, true);
    assert.equal(field.usable, false);
    assert.equal(plan.potentially_usable, true);
    assert.equal(plan.usable, false);
});

test("2D footprint samples preserve restricted azimuth and elevation as an annular sector", () => {
    const footprint = sampleStationGroundFootprint({
        ...BASE_STATION,
        operation_mode: "tracking",
        mechanical_azimuth_min_deg: -20,
        mechanical_azimuth_max_deg: 30,
        mechanical_elevation_min_deg: 5,
        mechanical_elevation_max_deg: 55,
        min_elevation_deg: 15
    }, { azimuthSamples: 48, maxRangeKm: 1_000 });
    assert.equal(footprint.valid, true);
    assert.equal(footprint.kind, "annular-sector");
    assert.equal(footprint.azimuth_span_deg, 50);
    assert.equal(footprint.min_elevation_deg, 15);
    assert.equal(footprint.max_elevation_deg, 55);
    assert.ok(footprint.samples.length >= 2);
    assert.ok(footprint.samples.every((sample) => sample.outer_radius_km >= sample.inner_radius_km));
});

test("actual satellite downlink uses stationary pattern gain without bypassing mount limits", () => {
    const stationary = {
        ...BASE_STATION,
        operation_mode: "stationary",
        boresight_azimuth_deg: 0,
        boresight_elevation_deg: 45,
        hpbw_azimuth_deg: 12,
        hpbw_elevation_deg: 12,
        mechanical_azimuth_min_deg: -20,
        mechanical_azimuth_max_deg: 20,
        mechanical_elevation_min_deg: 10,
        mechanical_elevation_max_deg: 80
    };
    const profile = {
        eirp_dbm: 42,
        frequency_mhz: 2200,
        polarization: "RHCP",
        bandwidth_hz: 25_000
    };
    // Use a short but nonzero range so the test isolates direction and mount
    // logic rather than failing the separate received-power threshold first.
    const inside = calculateSatelliteDownlink(stationary, profile, 50, { azimuthDeg: 0, elevationDeg: 45 });
    const sideOfMainLobe = calculateSatelliteDownlink(stationary, profile, 50, { azimuthDeg: 10, elevationDeg: 45 });
    const outsideMount = calculateSatelliteDownlink(stationary, profile, 50, { azimuthDeg: 40, elevationDeg: 45 });
    assert.equal(inside.available, true);
    assert.equal(inside.field_of_regard.usable, true);
    assert.equal(inside.usable, true);
    // HPBW marks the -3 dB contour. A side-lobe/modelled gain can still close
    // a short link; the power budget, not an arbitrary binary cone, decides.
    assert.equal(sideOfMainLobe.available, true);
    assert.equal(sideOfMainLobe.field_of_regard.usable, true);
    assert.equal(sideOfMainLobe.field_of_regard.in_fixed_beam, false);
    assert.equal(sideOfMainLobe.usable, true);
    assert.ok(sideOfMainLobe.received_power_dbm < inside.received_power_dbm);
    assert.equal(outsideMount.available, true);
    assert.equal(outsideMount.field_of_regard.usable, false);
    assert.equal(outsideMount.usable, false);
});

test("pattern sampling is bounded and ready for a renderer without Cesium", () => {
    const sampled = sampleAntennaPattern(BASE_STATION, { azimuthSamples: 12, elevationSamples: 6 });
    assert.equal(sampled.samples.length, 91);
    assert.ok(sampled.samples.every((sample) => Number.isFinite(sample.normalized_radius) && sample.normalized_radius > 0));
    assert.ok(sampled.samples.every((sample) => sample.link_range_ratio === sample.normalized_radius));
});

test("downlink pattern map carries P_RX and SNR only for a complete remote profile", () => {
    const unavailable = sampleSatelliteDownlinkPattern(BASE_STATION, null, 1_000);
    assert.equal(unavailable.available, false);
    assert.equal(unavailable.samples.length, 0);
    const sampled = sampleSatelliteDownlinkPattern(BASE_STATION, {
        eirp_dbm: 42,
        frequency_mhz: 2200,
        polarization: "RHCP",
        bandwidth_hz: 20_000
    }, 1_000, { azimuthSamples: 8, elevationSamples: 4 });
    assert.equal(sampled.available, true);
    assert.equal(sampled.samples.length, 45);
    assert.ok(sampled.samples.every((sample) => Number.isFinite(sample.received_power_dbm) && Number.isFinite(sample.snr_db)));
});

test("stationary pattern volume uses ENU coordinates and a physical range ratio", () => {
    const mesh = buildStationPatternMesh({
        ...BASE_STATION,
        operation_mode: "stationary",
        boresight_azimuth_deg: 0,
        boresight_elevation_deg: 45
    }, { maxRangeKm: 1_000, azimuthSamples: 16, radialSamples: 4 });
    assert.equal(mesh.valid, true);
    assert.equal(mesh.kind, "directional-pattern");
    assert.equal(mesh.coordinate_system, "ENU");
    assert.equal(mesh.positions_enu_m.length % 3, 0);
    assert.ok(mesh.indices.length > 0);
    assert.equal(mesh.indices.every((index) => index >= 0 && index < mesh.positions_enu_m.length / 3), true);
    const direction = localHorizonDirection(0, 90);
    assert.ok(Math.abs(direction.up - 1) < 1e-12);
});

test("stationary pattern volume is clipped by the same mount envelope as access planning", () => {
    const mesh = buildStationPatternMesh({
        ...BASE_STATION,
        operation_mode: "stationary",
        boresight_azimuth_deg: 0,
        boresight_elevation_deg: 45,
        mechanical_azimuth_min_deg: -20,
        mechanical_azimuth_max_deg: 30,
        mechanical_elevation_min_deg: 5,
        mechanical_elevation_max_deg: 55,
        min_elevation_deg: 15
    }, { maxRangeKm: 1_000, azimuthSamples: 24, elevationSamples: 6 });
    assert.equal(mesh.valid, true);
    assert.equal(mesh.azimuth_span_deg, 50);
    assert.equal(mesh.min_elevation_deg, 15);
    assert.equal(mesh.max_elevation_deg, 55);
    for (let index = 3; index < mesh.positions_enu_m.length; index += 3) {
        const east = mesh.positions_enu_m[index];
        const north = mesh.positions_enu_m[index + 1];
        const up = mesh.positions_enu_m[index + 2];
        const horizontal = Math.hypot(east, north);
        const azimuth = Math.atan2(east, north) * 180 / Math.PI;
        const elevation = Math.atan2(up, horizontal) * 180 / Math.PI;
        assert.ok(azimuth >= -20.000001 && azimuth <= 30.000001);
        assert.ok(elevation >= 14.999999 && elevation <= 55.000001);
    }
});

test("3D field-of-regard mesh stays inside the mount azimuth and elevation stops", () => {
    const mesh = buildStationFieldOfRegardMesh({
        ...BASE_STATION,
        min_elevation_deg: 15,
        mechanical_elevation_min_deg: 5,
        mechanical_elevation_max_deg: 55,
        mechanical_azimuth_min_deg: -20,
        mechanical_azimuth_max_deg: 30
    }, { maxRangeKm: 1_000, azimuthSamples: 24, elevationSamples: 6 });
    assert.equal(mesh.valid, true);
    assert.equal(mesh.kind, "mechanical-field-of-regard");
    assert.equal(mesh.azimuth_span_deg, 50);
    assert.equal(mesh.min_elevation_deg, 15);
    assert.equal(mesh.max_elevation_deg, 55);
    for (let index = 3; index < mesh.positions_enu_m.length; index += 3) {
        const east = mesh.positions_enu_m[index];
        const north = mesh.positions_enu_m[index + 1];
        const up = mesh.positions_enu_m[index + 2];
        const horizontal = Math.hypot(east, north);
        const azimuth = Math.atan2(east, north) * 180 / Math.PI;
        const elevation = Math.atan2(up, horizontal) * 180 / Math.PI;
        assert.ok(azimuth >= -20.000001 && azimuth <= 30.000001);
        assert.ok(elevation >= 14.999999 && elevation <= 55.000001);
    }
});
