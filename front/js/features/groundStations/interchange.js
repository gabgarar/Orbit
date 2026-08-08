/**
 * Portable ground-station interchange.
 *
 * This module deliberately has no Cesium, DOM, File, or fetch dependency.
 * It is the boundary between untrusted interchange files and the authored
 * station records accepted by the workspace. Runtime entities, cached RF
 * values and renderer-specific fields never cross that boundary.
 */

import { buildGroundStationsGeoJson } from "./geojson.js";

export const GROUND_STATION_INTERCHANGE_VERSION = 1;

export const GROUND_STATION_EXPORT_FORMATS = Object.freeze({
    GEOJSON: "geojson",
    ORBIT_JSON: "orbit-json",
    CSV: "csv"
});

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
    "coverage_visible",
    // Layer visibility is authored workspace presentation, not a Cesium
    // runtime handle. Keeping it makes a station exchange restore what the
    // operator intentionally had hidden without exporting renderer state.
    "visible"
]);

const NUMERIC_FIELDS = new Set([
    "altitude_m",
    "min_elevation_deg",
    "antenna_diameter_m",
    "antenna_efficiency",
    "frequency_hz",
    "frequency_mhz",
    "polarization_tilt_deg",
    "tx_power_dbm",
    "tx_power_w",
    "tx_gain_override_dbi",
    "rx_gain_override_dbi",
    "tx_gain_dbi",
    "rx_gain_dbi",
    "min_link_power_dbm",
    "hpbw_azimuth_deg",
    "hpbw_elevation_deg",
    "side_lobe_level_db",
    "system_temperature_k",
    "atmospheric_loss_db",
    "rain_loss_db",
    "cable_loss_db",
    "connector_loss_db",
    "pointing_rms_mdeg",
    "receiver_bandwidth_hz",
    "required_snr_db",
    "boresight_azimuth_deg",
    "boresight_elevation_deg",
    "mechanical_elevation_min_deg",
    "mechanical_elevation_max_deg",
    "mechanical_azimuth_min_deg",
    "mechanical_azimuth_max_deg",
    "reference_rx_gain_dbi",
    "reference_rx_threshold_dbm",
    "point_size_px"
]);

const BOOLEAN_FIELDS = new Set(["coverage_visible", "visible"]);
const TEXT_FIELDS = new Set([
    "time_zone",
    "frequency_unit",
    "polarization",
    "tx_power_unit",
    "tx_gain_mode",
    "rx_gain_mode",
    "pattern_type",
    "operation_mode",
    "point_symbol",
    "point_color"
]);

const CSV_COLUMNS = Object.freeze([
    "station_id",
    "name",
    "station_schema_version",
    "longitude_deg",
    "latitude_deg",
    "altitude_m",
    "time_zone",
    "min_elevation_deg",
    "monitor_satellite_ids",
    ...RF_FIELDS,
    ...VISUAL_FIELDS
]);

const MAX_TEXT_LENGTH = 512;

export class GroundStationInterchangeError extends Error {
    constructor(message, { code = "invalid-document" } = {}) {
        super(message);
        this.name = "GroundStationInterchangeError";
        this.code = code;
    }
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value) {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function nullablePrimitive(value) {
    if (value === null) return null;
    if (["string", "number", "boolean"].includes(typeof value)) return value;
    return undefined;
}

function safeText(value, { fallback = "", maxLength = MAX_TEXT_LENGTH } = {}) {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim().slice(0, maxLength);
    return text || fallback;
}

function safeId(value) {
    return safeText(value, { maxLength: 200 });
}

function optionalNumber(value) {
    if (value === null) return null;
    return finiteNumber(value);
}

function optionalBoolean(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "boolean") return value;
    const normalized = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "si", "sí"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
    return null;
}

function scalarAuthoredFields(source) {
    const result = {};
    if (!isRecord(source)) return result;
    for (const field of [...RF_FIELDS, ...VISUAL_FIELDS]) {
        if (!Object.hasOwn(source, field)) continue;
        const raw = nullablePrimitive(source[field]);
        if (raw === undefined) continue;
        if (NUMERIC_FIELDS.has(field)) {
            const number = optionalNumber(raw);
            if (number !== null || raw === null) result[field] = number;
        } else if (BOOLEAN_FIELDS.has(field)) {
            const boolean = optionalBoolean(raw);
            if (boolean !== null || raw === null) result[field] = boolean;
        } else if (TEXT_FIELDS.has(field)) {
            if (raw === null) result[field] = null;
            else result[field] = safeText(raw, { maxLength: MAX_TEXT_LENGTH });
        }
    }
    return result;
}

function normalizedMonitorIds(value) {
    let candidates = value;
    if (typeof value === "string") {
        try {
            candidates = JSON.parse(value);
        } catch {
            candidates = value.split(";");
        }
    }
    if (!Array.isArray(candidates)) return [];
    return [...new Set(candidates
        .map((candidate) => safeText(candidate, { maxLength: 200 }))
        .filter(Boolean))];
}

function extractStationInput(source, { coordinates = null, featureId = null } = {}) {
    if (!isRecord(source)) return null;
    const latitude = finiteNumber(coordinates?.[1] ?? source.latitude_deg);
    const longitude = finiteNumber(coordinates?.[0] ?? source.longitude_deg);
    if (latitude === null || longitude === null || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return null;
    }
    const altitude = finiteNumber(coordinates?.[2] ?? source.altitude_m) ?? 0;
    const nestedRf = isRecord(source["orbit:rf"]) ? source["orbit:rf"] : {};
    const nestedVisual = isRecord(source["orbit:visual"]) ? source["orbit:visual"] : {};
    // Flat properties are accepted for interoperable/legacy input. The
    // namespaced version wins when both are present because it carries Orbit's
    // complete authored RF contract in exported GeoJSON.
    const authored = {
        ...scalarAuthoredFields(source),
        ...scalarAuthoredFields(nestedRf),
        ...scalarAuthoredFields(nestedVisual)
    };
    const id = safeId(source.station_id || source.id || featureId);
    const name = safeText(source.name || id || "Ground station", { maxLength: MAX_TEXT_LENGTH });
    const schemaVersion = finiteNumber(source.station_schema_version);
    const station = {
        ...(id ? { id } : {}),
        name,
        station_schema_version: Number.isInteger(schemaVersion) && schemaVersion > 0 ? schemaVersion : 2,
        latitude_deg: latitude,
        longitude_deg: longitude,
        altitude_m: altitude,
        time_zone: safeText(source.time_zone, { fallback: "UTC", maxLength: 128 }),
        min_elevation_deg: finiteNumber(source.min_elevation_deg) ?? 10,
        monitor_satellite_ids: normalizedMonitorIds(source.monitor_satellite_ids),
        ...authored
    };
    // The top-level values form the portable GeoJSON profile. Preserve them
    // if an older exporter omitted them from the namespaced RF object.
    for (const field of RF_FIELDS) {
        if (!Object.hasOwn(station, field) && Object.hasOwn(source, field)) {
            const fieldValue = scalarAuthoredFields({ [field]: source[field] });
            if (Object.hasOwn(fieldValue, field)) station[field] = fieldValue[field];
        }
    }
    return station;
}

function groundStationFeatureToRecord(feature) {
    if (!isRecord(feature) || feature.type !== "Feature") return null;
    if (!isRecord(feature.geometry) || feature.geometry.type !== "Point" || !Array.isArray(feature.geometry.coordinates)) {
        return null;
    }
    return extractStationInput(feature.properties || {}, {
        coordinates: feature.geometry.coordinates,
        featureId: feature.id
    });
}

function normalizeFormat(value) {
    const candidate = String(value || "").trim().toLowerCase();
    if (["geojson", "geo+json", ".geojson", ".json.geojson"].includes(candidate)) return GROUND_STATION_EXPORT_FORMATS.GEOJSON;
    if (["orbit-json", "orbit", "orbit-ground-stations", ".orbit.json", ".orbit-ground-stations.json"].includes(candidate)) return GROUND_STATION_EXPORT_FORMATS.ORBIT_JSON;
    if (["csv", ".csv", "text/csv"].includes(candidate)) return GROUND_STATION_EXPORT_FORMATS.CSV;
    return null;
}

function formatFromFileName(fileName) {
    const name = String(fileName || "").trim().toLowerCase();
    if (name.endsWith(".geojson") || name.endsWith(".geo.json")) return GROUND_STATION_EXPORT_FORMATS.GEOJSON;
    if (name.endsWith(".csv")) return GROUND_STATION_EXPORT_FORMATS.CSV;
    if (name.endsWith(".orbit-ground-stations.json") || name.endsWith(".orbit.json")) return GROUND_STATION_EXPORT_FORMATS.ORBIT_JSON;
    return null;
}

function parseJson(text) {
    try {
        // UTF-8 BOMs are common in files saved by spreadsheet/GIS tools and
        // are not part of JSON itself. Treat them like the CSV path does.
        return JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
        throw new GroundStationInterchangeError("El archivo no contiene JSON válido.", { code: "invalid-json" });
    }
}

function resolveJsonFormat(document, requested) {
    if (requested) return requested;
    if (document?.type === "FeatureCollection" || document?.type === "Feature") return GROUND_STATION_EXPORT_FORMATS.GEOJSON;
    if (Array.isArray(document?.stations) || Array.isArray(document?.groundStations)) return GROUND_STATION_EXPORT_FORMATS.ORBIT_JSON;
    return null;
}

function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (quoted) {
            if (character === '"' && text[index + 1] === '"') {
                cell += '"';
                index += 1;
            } else if (character === '"') {
                quoted = false;
            } else {
                cell += character;
            }
            continue;
        }
        if (character === '"') {
            quoted = true;
        } else if (character === ",") {
            row.push(cell); cell = "";
        } else if (character === "\n") {
            row.push(cell); rows.push(row); row = []; cell = "";
        } else if (character !== "\r") {
            cell += character;
        }
    }
    if (quoted) {
        throw new GroundStationInterchangeError("El CSV contiene una cadena entrecomillada sin cerrar.", { code: "invalid-csv" });
    }
    if (cell || row.length) {
        row.push(cell); rows.push(row);
    }
    return rows.filter((row) => row.some((cellValue) => String(cellValue).trim() !== ""));
}

function parseCsvDocument(text) {
    const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
    if (!rows.length) {
        throw new GroundStationInterchangeError("El CSV no contiene estaciones.", { code: "empty-document" });
    }
    const header = rows[0].map((name) => String(name).trim());
    const required = ["latitude_deg", "longitude_deg"];
    if (required.some((field) => !header.includes(field))) {
        throw new GroundStationInterchangeError("El CSV debe incluir las columnas latitude_deg y longitude_deg.", { code: "invalid-csv-schema" });
    }
    return rows.slice(1).map((row) => Object.fromEntries(header.map((field, index) => {
        const value = row[index] ?? "";
        // Our exporter includes every known scalar column. In that profile an
        // empty numeric/boolean cell represents an explicit null, preserving
        // optional overrides such as HPBW on a CSV round trip. Text cells stay
        // empty strings so a hand-authored CSV can still use defaults.
        if ((NUMERIC_FIELDS.has(field) || BOOLEAN_FIELDS.has(field)) && String(value).trim() === "") {
            return [field, null];
        }
        return [field, value];
    })));
}

function toCsvCell(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function recordsResult(format, candidates, mapper = (candidate) => extractStationInput(candidate)) {
    const stations = [];
    const rejected = [];
    candidates.forEach((candidate, index) => {
        const station = mapper(candidate);
        if (station) stations.push(station);
        else rejected.push({ index, reason: "invalid-station" });
    });
    return { format, stations, rejected };
}

/**
 * Parse a portable station export. Invalid rows/features are reported rather
 * than poisoning the complete import; an unrecognised or malformed document
 * raises GroundStationInterchangeError.
 */
export function parseGroundStationsDocument(text, { format = null, fileName = "" } = {}) {
    if (typeof text !== "string" || !text.trim()) {
        throw new GroundStationInterchangeError("El archivo de estaciones está vacío.", { code: "empty-document" });
    }
    let resolvedFormat = normalizeFormat(format) || formatFromFileName(fileName);
    if (resolvedFormat === GROUND_STATION_EXPORT_FORMATS.CSV) {
        return recordsResult(resolvedFormat, parseCsvDocument(text));
    }

    const document = parseJson(text);
    resolvedFormat = resolveJsonFormat(document, resolvedFormat);
    if (resolvedFormat === GROUND_STATION_EXPORT_FORMATS.GEOJSON) {
        const features = document?.type === "Feature" ? [document] : document?.features;
        if (!Array.isArray(features)) {
            throw new GroundStationInterchangeError("El GeoJSON debe ser una Feature o FeatureCollection.", { code: "invalid-geojson" });
        }
        return recordsResult(resolvedFormat, features, groundStationFeatureToRecord);
    }
    if (resolvedFormat === GROUND_STATION_EXPORT_FORMATS.ORBIT_JSON) {
        const stations = Array.isArray(document?.stations) ? document.stations : document?.groundStations;
        if (!Array.isArray(stations)) {
            throw new GroundStationInterchangeError("El JSON de Orbit debe contener una lista de estaciones.", { code: "invalid-orbit-json" });
        }
        return recordsResult(resolvedFormat, stations);
    }
    throw new GroundStationInterchangeError("No se reconoce el formato de estaciones. Usa GeoJSON, Orbit JSON o CSV.", { code: "unsupported-format" });
}

/** Build Orbit's lossless, versioned JSON exchange envelope. */
export function buildGroundStationsOrbitJson(stations) {
    const normalized = (Array.isArray(stations) ? stations : [])
        .map((station) => extractStationInput(station))
        .filter(Boolean);
    return {
        format: "orbit-ground-stations",
        version: GROUND_STATION_INTERCHANGE_VERSION,
        stations: normalized
    };
}

/** Build a human-editable CSV profile. All authored scalar fields are flat. */
export function buildGroundStationsCsv(stations) {
    const normalized = (Array.isArray(stations) ? stations : [])
        .map((station) => extractStationInput(station))
        .filter(Boolean);
    const lines = [CSV_COLUMNS.join(",")];
    for (const station of normalized) {
        const row = {
            ...station,
            station_id: station.id || "",
            name: station.name,
            station_schema_version: station.station_schema_version,
            longitude_deg: station.longitude_deg,
            latitude_deg: station.latitude_deg,
            altitude_m: station.altitude_m,
            time_zone: station.time_zone,
            min_elevation_deg: station.min_elevation_deg,
            monitor_satellite_ids: JSON.stringify(station.monitor_satellite_ids || [])
        };
        lines.push(CSV_COLUMNS.map((field) => toCsvCell(row[field])).join(","));
    }
    return `${lines.join("\r\n")}\r\n`;
}

/**
 * Serialize a station set for a browser, API, or filesystem adapter. The
 * returned value is intentionally data-only; callers choose how to download
 * or persist it.
 */
export function serializeGroundStationsExport(stations, format = GROUND_STATION_EXPORT_FORMATS.GEOJSON) {
    const resolvedFormat = normalizeFormat(format);
    if (!resolvedFormat) {
        throw new GroundStationInterchangeError("Formato de exportación no soportado.", { code: "unsupported-format" });
    }
    if (resolvedFormat === GROUND_STATION_EXPORT_FORMATS.GEOJSON) {
        const document = buildGroundStationsGeoJson(stations);
        return {
            format: resolvedFormat,
            extension: ".geojson",
            mimeType: "application/geo+json",
            document,
            text: `${JSON.stringify(document, null, 2)}\n`
        };
    }
    if (resolvedFormat === GROUND_STATION_EXPORT_FORMATS.ORBIT_JSON) {
        const document = buildGroundStationsOrbitJson(stations);
        return {
            format: resolvedFormat,
            extension: ".json",
            mimeType: "application/json",
            document,
            text: `${JSON.stringify(document, null, 2)}\n`
        };
    }
    return {
        format: resolvedFormat,
        extension: ".csv",
        mimeType: "text/csv;charset=utf-8",
        document: null,
        text: buildGroundStationsCsv(stations)
    };
}

/**
 * Download an interchange document while keeping browser APIs out of the
 * builders and parsers above. Returning the serialized result makes this
 * adapter deterministic in unit tests and useful to non-browser callers.
 */
export function downloadGroundStationsExport(stations, format, {
    documentRef = globalThis.document,
    urlApi = globalThis.URL,
    fileName = ""
} = {}) {
    const serialized = serializeGroundStationsExport(stations, format);
    const resolvedFileName = String(fileName || `orbit-ground-stations${serialized.extension}`);
    if (!documentRef?.createElement || !urlApi?.createObjectURL || !urlApi?.revokeObjectURL || typeof Blob !== "function") {
        return serialized;
    }
    const blob = new Blob([serialized.text], { type: serialized.mimeType });
    const url = urlApi.createObjectURL(blob);
    const anchor = Object.assign(documentRef.createElement("a"), {
        href: url,
        download: resolvedFileName
    });
    anchor.click();
    urlApi.revokeObjectURL(url);
    return serialized;
}
