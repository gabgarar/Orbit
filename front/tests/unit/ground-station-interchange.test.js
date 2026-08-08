import assert from "node:assert/strict";
import test from "node:test";

import {
    GROUND_STATION_EXPORT_FORMATS,
    GroundStationInterchangeError,
    buildGroundStationsCsv,
    buildGroundStationsOrbitJson,
    downloadGroundStationsExport,
    parseGroundStationsDocument,
    serializeGroundStationsExport
} from "../../js/features/groundStations/interchange.js";
import { buildGroundStationsGeoJson } from "../../js/features/groundStations/geojson.js";

const STATION = {
    id: "gst:madrid",
    station_schema_version: 2,
    name: "Estación, Madrid",
    latitude_deg: 40.4168,
    longitude_deg: -3.7038,
    altitude_m: 667.1,
    time_zone: "Europe/Madrid",
    min_elevation_deg: 10,
    monitor_satellite_ids: ["25544", "43013"],
    antenna_diameter_m: 1.2,
    antenna_efficiency: 0.61,
    frequency_unit: "hz",
    frequency_hz: 2_200_000_000,
    frequency_mhz: 2200,
    polarization: "RHCP",
    tx_power_unit: "dbm",
    tx_power_dbm: 38,
    tx_gain_mode: "derived",
    rx_gain_mode: "override",
    rx_gain_override_dbi: 21,
    min_link_power_dbm: -80,
    pattern_type: "gaussian",
    hpbw_azimuth_deg: 2.4,
    hpbw_elevation_deg: null,
    side_lobe_level_db: -25,
    system_temperature_k: 500,
    atmospheric_loss_db: 0.5,
    rain_loss_db: 1.2,
    cable_loss_db: 1,
    connector_loss_db: 0.5,
    pointing_rms_mdeg: 50,
    receiver_bandwidth_hz: 25_000,
    required_snr_db: 3,
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
    visible: false,
    entity: { renderer: true },
    radio_range_km: 1000
};

function assertAuthoredStation(station) {
    assert.equal(station.id, "gst:madrid");
    assert.equal(station.name, "Estación, Madrid");
    assert.equal(station.longitude_deg, -3.7038);
    assert.equal(station.latitude_deg, 40.4168);
    assert.equal(station.altitude_m, 667.1);
    assert.deepEqual(station.monitor_satellite_ids, ["25544", "43013"]);
    assert.equal(station.antenna_diameter_m, 1.2);
    assert.equal(station.frequency_hz, 2_200_000_000);
    assert.equal(station.rx_gain_override_dbi, 21);
    assert.equal(station.hpbw_elevation_deg, null);
    assert.equal(station.coverage_visible, true);
    assert.equal(station.visible, false);
    assert.equal("entity" in station, false);
    assert.equal("radio_range_km" in station, false);
}

test("imports exactly the GeoJSON produced by Orbit and preserves authored RF configuration", () => {
    const geojson = buildGroundStationsGeoJson([STATION]);
    // A BOM is common when a GIS application saves UTF-8 interchange files.
    const parsed = parseGroundStationsDocument(`\uFEFF${JSON.stringify(geojson)}`, { fileName: "stations.geojson" });

    assert.equal(parsed.format, GROUND_STATION_EXPORT_FORMATS.GEOJSON);
    assert.deepEqual(parsed.rejected, []);
    assert.equal(parsed.stations.length, 1);
    assertAuthoredStation(parsed.stations[0]);
});

test("skips invalid GeoJSON features but keeps valid point features in the same document", () => {
    const document = buildGroundStationsGeoJson([STATION]);
    document.features.push({
        type: "Feature",
        id: "bad-location",
        properties: { name: "Bad" },
        geometry: { type: "Point", coordinates: [181, 12, 0] }
    });
    document.features.push({
        type: "Feature",
        id: "not-a-point",
        properties: { name: "Line" },
        geometry: { type: "LineString", coordinates: [] }
    });

    const parsed = parseGroundStationsDocument(JSON.stringify(document));
    assert.equal(parsed.stations.length, 1);
    assert.deepEqual(parsed.rejected, [
        { index: 1, reason: "invalid-station" },
        { index: 2, reason: "invalid-station" }
    ]);
});

test("exports and imports the lossless, versioned Orbit JSON envelope", () => {
    const document = buildGroundStationsOrbitJson([STATION]);
    assert.deepEqual(Object.keys(document), ["format", "version", "stations"]);
    assert.equal(document.format, "orbit-ground-stations");
    assert.equal(document.version, 1);

    const parsed = parseGroundStationsDocument(JSON.stringify(document), { fileName: "stations.orbit-ground-stations.json" });
    assert.equal(parsed.format, GROUND_STATION_EXPORT_FORMATS.ORBIT_JSON);
    assert.deepEqual(parsed.rejected, []);
    assertAuthoredStation(parsed.stations[0]);
});

test("CSV exchange quotes names, stores monitor IDs, and round-trips authored scalar RF fields", () => {
    const csv = buildGroundStationsCsv([STATION]);
    assert.match(csv, /^station_id,name,station_schema_version,/);
    assert.match(csv, /"Estación, Madrid"/);
    assert.match(csv, /"\[""25544"",""43013""\]"/);

    const parsed = parseGroundStationsDocument(csv, { fileName: "stations.csv" });
    assert.equal(parsed.format, GROUND_STATION_EXPORT_FORMATS.CSV);
    assert.deepEqual(parsed.rejected, []);
    assertAuthoredStation(parsed.stations[0]);
});

test("serialized exports expose the right portable MIME type and extension", () => {
    const geojson = serializeGroundStationsExport([STATION], "geojson");
    assert.equal(geojson.extension, ".geojson");
    assert.equal(geojson.mimeType, "application/geo+json");
    assert.equal(geojson.document.type, "FeatureCollection");

    const orbitJson = serializeGroundStationsExport([STATION], "orbit-json");
    assert.equal(orbitJson.extension, ".json");
    assert.equal(orbitJson.mimeType, "application/json");
    assert.equal(orbitJson.document.stations.length, 1);

    const csv = serializeGroundStationsExport([STATION], "csv");
    assert.equal(csv.extension, ".csv");
    assert.equal(csv.mimeType, "text/csv;charset=utf-8");
    assert.equal(csv.document, null);
});

test("download adapter uses the chosen format and releases its object URL", async () => {
    const calls = [];
    let blob = null;
    const anchor = { click: () => calls.push("click") };
    const exported = downloadGroundStationsExport([STATION], "csv", {
        fileName: "madrid.csv",
        documentRef: { createElement: () => anchor },
        urlApi: {
            createObjectURL: (nextBlob) => {
                blob = nextBlob;
                return "blob:ground-stations-csv";
            },
            revokeObjectURL: (url) => calls.push(url)
        }
    });

    assert.equal(exported.format, "csv");
    assert.equal(anchor.download, "madrid.csv");
    assert.equal(anchor.href, "blob:ground-stations-csv");
    assert.deepEqual(calls, ["click", "blob:ground-stations-csv"]);
    assert.equal(blob.type, "text/csv;charset=utf-8");
    assert.match(await blob.text(), /^station_id,name,station_schema_version,/);
});

test("download adapter derives a filename extension from the requested format", () => {
    const anchor = { click() {} };
    downloadGroundStationsExport([STATION], "orbit-json", {
        documentRef: { createElement: () => anchor },
        urlApi: { createObjectURL: () => "blob:orbit-json", revokeObjectURL() {} }
    });
    assert.equal(anchor.download, "orbit-ground-stations.json");
});

test("invalid documents fail clearly while an empty supported collection remains safe", () => {
    assert.throws(
        () => parseGroundStationsDocument("not json", { fileName: "stations.geojson" }),
        (error) => error instanceof GroundStationInterchangeError && error.code === "invalid-json"
    );
    assert.throws(
        () => parseGroundStationsDocument("name,latitude_deg\nMadrid,40.4", { fileName: "stations.csv" }),
        (error) => error instanceof GroundStationInterchangeError && error.code === "invalid-csv-schema"
    );
    const parsed = parseGroundStationsDocument(JSON.stringify({ type: "FeatureCollection", features: [] }));
    assert.deepEqual(parsed, { format: "geojson", stations: [], rejected: [] });
});
