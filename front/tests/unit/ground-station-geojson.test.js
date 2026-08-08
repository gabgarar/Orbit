import assert from "node:assert/strict";
import test from "node:test";

import {
    buildGroundStationsGeoJson,
    downloadGroundStationsGeoJson
} from "../../js/features/groundStations/geojson.js";

const STATION = {
    id: "ground-station:madrid",
    station_schema_version: 2,
    name: "Est. Madrid",
    latitude_deg: 40.4168,
    longitude_deg: -3.7038,
    altitude_m: 667.1,
    time_zone: "Europe/Madrid",
    min_elevation_deg: 10,
    antenna_diameter_m: 1.2,
    antenna_efficiency: 0.61,
    frequency_unit: "hz",
    frequency_hz: 2_200_000_000,
    frequency_mhz: 2200,
    polarization: "RHCP",
    polarization_tilt_deg: 12.5,
    tx_power_unit: "dbm",
    tx_power_dbm: 38,
    tx_power_w: null,
    tx_gain_mode: "derived",
    tx_gain_override_dbi: null,
    // Legacy explicit gains remain part of an authored station contract.
    tx_gain_dbi: 18,
    rx_gain_mode: "override",
    rx_gain_override_dbi: 21,
    rx_gain_dbi: 21,
    min_link_power_dbm: -80,
    pattern_type: "gaussian",
    hpbw_azimuth_deg: 2.4,
    hpbw_elevation_deg: 2.2,
    side_lobe_level_db: -25,
    system_temperature_k: 500,
    receiver_bandwidth_hz: 25_000,
    required_snr_db: 3,
    atmospheric_loss_db: 0.5,
    rain_loss_db: 1.2,
    cable_loss_db: 1,
    connector_loss_db: 0.5,
    pointing_rms_mdeg: 50,
    operation_mode: "tracking",
    boresight_azimuth_deg: 145,
    boresight_elevation_deg: 42,
    mechanical_azimuth_min_deg: -170,
    mechanical_azimuth_max_deg: 170,
    mechanical_elevation_min_deg: 5,
    mechanical_elevation_max_deg: 85,
    reference_rx_gain_dbi: 3,
    reference_rx_threshold_dbm: -105,
    point_symbol: "circle",
    point_color: "#3cc4ff",
    point_size_px: 12,
    coverage_visible: true,
    entity: { runtime: true },
    coverageEntity: { runtime: true },
    patternMeshEntity: { runtime: true }
};

test("ground-station GeoJSON uses RFC 7946 WGS-84 point coordinates and QGIS-friendly fields", () => {
    const collection = buildGroundStationsGeoJson([STATION]);

    assert.equal(collection.type, "FeatureCollection");
    assert.equal(collection.features.length, 1);
    const [feature] = collection.features;
    assert.equal(feature.type, "Feature");
    assert.equal(feature.id, STATION.id);
    assert.deepEqual(feature.geometry, {
        type: "Point",
        // GeoJSON positions are longitude, latitude, then ellipsoidal height in metres.
        coordinates: [-3.7038, 40.4168, 667.1]
    });

    assert.equal(feature.properties.name, "Est. Madrid");
    assert.equal(feature.properties.station_id, STATION.id);
    assert.equal(feature.properties.station_schema_version, 2);
    assert.equal(feature.properties.time_zone, "Europe/Madrid");
    assert.equal(feature.properties.altitude_m, 667.1);
    assert.equal(feature.properties.min_elevation_deg, 10);
    assert.equal(feature.properties.frequency_mhz, 2200);
    assert.equal(feature.properties.polarization, "RHCP");
    assert.equal(feature.properties.operation_mode, "tracking");
});

test("ground-station GeoJSON preserves authored RF settings under the orbit:rf namespace without renderer handles", () => {
    const [feature] = buildGroundStationsGeoJson([STATION]).features;
    const rf = feature.properties["orbit:rf"];

    assert.deepEqual(rf, {
        antenna_diameter_m: 1.2,
        antenna_efficiency: 0.61,
        frequency_unit: "hz",
        frequency_hz: 2_200_000_000,
        frequency_mhz: 2200,
        polarization: "RHCP",
        polarization_tilt_deg: 12.5,
        tx_power_unit: "dbm",
        tx_power_dbm: 38,
        tx_power_w: null,
        tx_gain_mode: "derived",
        tx_gain_override_dbi: null,
        tx_gain_dbi: 18,
        rx_gain_mode: "override",
        rx_gain_override_dbi: 21,
        rx_gain_dbi: 21,
        min_link_power_dbm: -80,
        pattern_type: "gaussian",
        hpbw_azimuth_deg: 2.4,
        hpbw_elevation_deg: 2.2,
        side_lobe_level_db: -25,
        system_temperature_k: 500,
        receiver_bandwidth_hz: 25_000,
        required_snr_db: 3,
        atmospheric_loss_db: 0.5,
        rain_loss_db: 1.2,
        cable_loss_db: 1,
        connector_loss_db: 0.5,
        pointing_rms_mdeg: 50,
        operation_mode: "tracking",
        boresight_azimuth_deg: 145,
        boresight_elevation_deg: 42,
        mechanical_azimuth_min_deg: -170,
        mechanical_azimuth_max_deg: 170,
        mechanical_elevation_min_deg: 5,
        mechanical_elevation_max_deg: 85,
        reference_rx_gain_dbi: 3,
        reference_rx_threshold_dbm: -105
    });
    assert.equal("entity" in feature.properties, false);
    assert.equal("coverageEntity" in feature.properties, false);
    assert.equal("patternMeshEntity" in feature.properties, false);
    assert.doesNotThrow(() => JSON.stringify(feature));
});

test("ground-station GeoJSON keeps explicitly null optional RF controls without inventing a derived override", () => {
    const [feature] = buildGroundStationsGeoJson([{
        ...STATION,
        tx_power_unit: "w",
        tx_power_dbm: null,
        tx_power_w: 10,
        tx_gain_override_dbi: null,
        hpbw_azimuth_deg: null,
        hpbw_elevation_deg: null,
        reference_rx_gain_dbi: null,
        reference_rx_threshold_dbm: null
    }]).features;

    const rf = feature.properties["orbit:rf"];
    assert.equal(rf.tx_power_unit, "w");
    assert.equal(rf.tx_power_w, 10);
    assert.equal(rf.tx_power_dbm, null);
    assert.equal(rf.tx_gain_override_dbi, null);
    assert.equal(rf.hpbw_azimuth_deg, null);
    assert.equal(rf.hpbw_elevation_deg, null);
    assert.equal(rf.reference_rx_gain_dbi, null);
    assert.equal(rf.reference_rx_threshold_dbm, null);
});

test("ground-station GeoJSON skips malformed locations and remains a valid empty FeatureCollection", () => {
    const collection = buildGroundStationsGeoJson([
        { ...STATION, id: "invalid-latitude", latitude_deg: 91 },
        { ...STATION, id: "invalid-longitude", longitude_deg: -181 },
        { ...STATION, id: "missing-longitude", longitude_deg: null },
        { ...STATION, id: "blank-latitude", latitude_deg: "" },
        null
    ]);

    assert.deepEqual(collection, { type: "FeatureCollection", features: [] });
});

test("ground-station GeoJSON download serializes the collection, uses a deterministic filename, and releases its URL", async () => {
    const calls = [];
    let capturedBlob = null;
    const anchor = { click: () => calls.push("click") };

    const exported = downloadGroundStationsGeoJson([STATION], {
        documentRef: { createElement: () => anchor },
        urlApi: {
            createObjectURL: (blob) => {
                capturedBlob = blob;
                return "blob:ground-stations";
            },
            revokeObjectURL: (url) => calls.push(url)
        }
    });

    assert.equal(exported.type, "FeatureCollection");
    assert.equal(anchor.href, "blob:ground-stations");
    assert.equal(anchor.download, "orbit-ground-stations.geojson");
    assert.deepEqual(calls, ["click", "blob:ground-stations"]);
    assert.equal(capturedBlob.type, "application/geo+json");
    assert.deepEqual(JSON.parse(await capturedBlob.text()), exported);
});
