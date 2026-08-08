/**
 * GeoJSON interchange for authored ground-station layers.
 *
 * GeoJSON RFC 7946 gives GIS users a single, portable WGS-84 file. Unlike a
 * Shapefile it does not split a station into several sidecar files or flatten
 * the RF contract into lossy DBF columns. Runtime Cesium handles, cached link
 * values and meshes are intentionally not exported.
 */

const RF_FIELDS = Object.freeze([
    "antenna_diameter_m",
    "antenna_efficiency",
    "frequency_unit",
    "frequency_hz",
    "frequency_mhz",
    "polarization",
    "polarization_tilt_deg",
    "tx_power_unit",
    "tx_power_dbm",
    "tx_power_w",
    "tx_gain_mode",
    "rx_gain_mode",
    "tx_gain_override_dbi",
    "rx_gain_override_dbi",
    "tx_gain_dbi",
    "rx_gain_dbi",
    "min_link_power_dbm",
    "hpbw_azimuth_deg",
    "hpbw_elevation_deg",
    "pattern_type",
    "side_lobe_level_db",
    "system_temperature_k",
    "atmospheric_loss_db",
    "rain_loss_db",
    "cable_loss_db",
    "connector_loss_db",
    "pointing_rms_mdeg",
    "receiver_bandwidth_hz",
    "required_snr_db",
    "operation_mode",
    "boresight_azimuth_deg",
    "boresight_elevation_deg",
    "mechanical_elevation_min_deg",
    "mechanical_elevation_max_deg",
    "mechanical_azimuth_min_deg",
    "mechanical_azimuth_max_deg",
    "reference_rx_gain_dbi",
    "reference_rx_threshold_dbm"
]);

const VISUAL_FIELDS = Object.freeze([
    "point_size_px",
    "point_symbol",
    "point_color",
    "coverage_visible"
]);

function finiteNumber(value) {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function ownSerializableFields(source, fields) {
    const result = {};
    if (!source || typeof source !== "object") return result;
    for (const field of fields) {
        if (!Object.hasOwn(source, field) || source[field] === undefined) continue;
        const value = source[field];
        if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
            result[field] = value;
        }
    }
    return result;
}

function stationFeature(station, index) {
    if (!station || typeof station !== "object") return null;
    const latitude = finiteNumber(station.latitude_deg);
    const longitude = finiteNumber(station.longitude_deg);
    if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return null;
    }

    const altitude = finiteNumber(station.altitude_m) ?? 0;
    const id = String(station.id || `ground-station-${index + 1}`).trim() || `ground-station-${index + 1}`;
    const name = String(station.name || id).trim() || id;
    const rf = ownSerializableFields(station, RF_FIELDS);
    const visual = ownSerializableFields(station, VISUAL_FIELDS);
    const frequencyMhz = finiteNumber(station.frequency_mhz)
        ?? (finiteNumber(station.frequency_hz) === null ? null : finiteNumber(station.frequency_hz) / 1e6);
    const properties = {
        station_id: id,
        name,
        station_schema_version: Number.isInteger(Number(station.station_schema_version))
            ? Number(station.station_schema_version)
            : 2,
        altitude_m: altitude,
        time_zone: String(station.time_zone || "UTC").trim() || "UTC",
        min_elevation_deg: finiteNumber(station.min_elevation_deg),
        frequency_mhz: frequencyMhz,
        polarization: typeof station.polarization === "string" ? station.polarization : null,
        operation_mode: typeof station.operation_mode === "string" ? station.operation_mode : null,
        "orbit:rf": rf,
        "orbit:visual": visual
    };
    if (Array.isArray(station.monitor_satellite_ids)) {
        properties.monitor_satellite_ids = station.monitor_satellite_ids
            .map((candidate) => String(candidate || "").trim())
            .filter(Boolean);
    }

    return {
        type: "Feature",
        id,
        properties,
        // RFC 7946 always uses WGS-84 longitude, latitude, then optional
        // ellipsoidal height. Do not include a deprecated GeoJSON `crs` member.
        geometry: {
            type: "Point",
            coordinates: [longitude, latitude, altitude]
        }
    };
}

/** Build a standards-compliant GeoJSON FeatureCollection from station layers. */
export function buildGroundStationsGeoJson(stations) {
    const source = Array.isArray(stations) ? stations : [];
    return {
        type: "FeatureCollection",
        features: source.map(stationFeature).filter(Boolean)
    };
}

/**
 * Download authored station layers as a single GeoJSON document.
 *
 * Returning the collection makes the browser action straightforward to test
 * and useful to integrations that want to send the document elsewhere.
 */
export function downloadGroundStationsGeoJson(stations, {
    documentRef = globalThis.document,
    urlApi = globalThis.URL,
    fileName = "orbit-ground-stations.geojson"
} = {}) {
    const collection = buildGroundStationsGeoJson(stations);
    if (!documentRef?.createElement || !urlApi?.createObjectURL || !urlApi?.revokeObjectURL || typeof Blob !== "function") {
        return collection;
    }
    const blob = new Blob([JSON.stringify(collection, null, 2)], { type: "application/geo+json" });
    const url = urlApi.createObjectURL(blob);
    const anchor = Object.assign(documentRef.createElement("a"), {
        href: url,
        download: String(fileName || "orbit-ground-stations.geojson")
    });
    anchor.click();
    urlApi.revokeObjectURL(url);
    return collection;
}
