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
    CSV: "csv",
    KML: "kml",
    KMZ: "kmz",
    GPKG: "gpkg",
    WKT: "wkt",
    WKB: "wkb"
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
    if (["orbit-json", "orbit", "orbit-ground-stations", "json", ".json", ".orbit.json", ".orbit-ground-stations.json"].includes(candidate)) return GROUND_STATION_EXPORT_FORMATS.ORBIT_JSON;
    if (["csv", ".csv", "text/csv"].includes(candidate)) return GROUND_STATION_EXPORT_FORMATS.CSV;
    if (["kml", ".kml"].includes(candidate)) return GROUND_STATION_EXPORT_FORMATS.KML;
    if (["kmz", ".kmz"].includes(candidate)) return GROUND_STATION_EXPORT_FORMATS.KMZ;
    if (["gpkg", "geopackage", ".gpkg"].includes(candidate)) return GROUND_STATION_EXPORT_FORMATS.GPKG;
    if (["wkt", ".wkt"].includes(candidate)) return GROUND_STATION_EXPORT_FORMATS.WKT;
    if (["wkb", ".wkb", "application/vnd.ogc.wkb"].includes(candidate)) return GROUND_STATION_EXPORT_FORMATS.WKB;
    return null;
}

function formatFromFileName(fileName) {
    const name = String(fileName || "").trim().toLowerCase();
    if (name.endsWith(".geojson") || name.endsWith(".geo.json")) return GROUND_STATION_EXPORT_FORMATS.GEOJSON;
    if (name.endsWith(".csv")) return GROUND_STATION_EXPORT_FORMATS.CSV;
    if (name.endsWith(".orbit-ground-stations.json") || name.endsWith(".orbit.json")) return GROUND_STATION_EXPORT_FORMATS.ORBIT_JSON;
    if (name.endsWith(".kml")) return GROUND_STATION_EXPORT_FORMATS.KML;
    if (name.endsWith(".kmz")) return GROUND_STATION_EXPORT_FORMATS.KMZ;
    if (name.endsWith(".gpkg")) return GROUND_STATION_EXPORT_FORMATS.GPKG;
    if (name.endsWith(".wkt")) return GROUND_STATION_EXPORT_FORMATS.WKT;
    if (name.endsWith(".wkb")) return GROUND_STATION_EXPORT_FORMATS.WKB;
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
    if ([
        GROUND_STATION_EXPORT_FORMATS.KML,
        GROUND_STATION_EXPORT_FORMATS.KMZ,
        GROUND_STATION_EXPORT_FORMATS.GPKG,
        GROUND_STATION_EXPORT_FORMATS.WKT,
        GROUND_STATION_EXPORT_FORMATS.WKB
    ].includes(resolvedFormat)) {
        throw new GroundStationInterchangeError("Este formato de estaciones solo esta disponible para exportacion; importa GeoJSON, Orbit JSON o CSV.", { code: "unsupported-import-format" });
    }
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

function normalizedExportStations(stations) {
    return (Array.isArray(stations) ? stations : [])
        .map((station) => extractStationInput(station))
        .filter(Boolean);
}

/**
 * Return the authored station contract suitable for an API request. This is
 * intentionally separate from the live layer object: Cesium entities, mesh
 * handles, cached RF values and other runtime data must never be serialized.
 */
export function normalizeGroundStationExportRecords(stations) {
    return normalizedExportStations(stations);
}

function xmlEscape(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function kmlData(name, value) {
    if (value === null || value === undefined || value === "") return "";
    return `<Data name="${xmlEscape(name)}"><value>${xmlEscape(value)}</value></Data>`;
}

/**
 * KML is a visual spatial interchange, not Orbit's lossless station
 * contract. Keep a short, useful metadata profile in ExtendedData and leave
 * renderer handles, RF caches, and other runtime state behind.
 */
export function buildGroundStationsKml(stations) {
    const placemarks = normalizedExportStations(stations).map((station) => {
        const frequencyMhz = finiteNumber(station.frequency_mhz)
            ?? (finiteNumber(station.frequency_hz) === null ? null : finiteNumber(station.frequency_hz) / 1e6);
        const fields = [
            ["station_id", station.id],
            ["time_zone", station.time_zone],
            ["min_elevation_deg", station.min_elevation_deg],
            ["frequency_mhz", frequencyMhz],
            ["polarization", station.polarization],
            ["operation_mode", station.operation_mode]
        ].map(([name, value]) => kmlData(name, value)).filter(Boolean).join("");
        return `<Placemark><name>${xmlEscape(station.name)}</name><ExtendedData>${fields}</ExtendedData><Point><altitudeMode>absolute</altitudeMode><coordinates>${station.longitude_deg},${station.latitude_deg},${station.altitude_m}</coordinates></Point></Placemark>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Orbit ground stations</name>${placemarks}</Document></kml>\n`;
}

function coordinateText(station) {
    return `${station.longitude_deg} ${station.latitude_deg} ${station.altitude_m}`;
}

/** Export station geometry only in OGC Well-Known Text. */
export function buildGroundStationsWkt(stations) {
    const normalized = normalizedExportStations(stations);
    if (!normalized.length) return "MULTIPOINT Z EMPTY\n";
    if (normalized.length === 1) return `POINT Z (${coordinateText(normalized[0])})\n`;
    return `MULTIPOINT Z (${normalized.map((station) => `(${coordinateText(station)})`).join(", ")})\n`;
}

function writeWkbPoint(view, offset, station) {
    view.setUint8(offset, 1); // little-endian byte order
    view.setUint32(offset + 1, 1001, true); // ISO WKB Point Z
    view.setFloat64(offset + 5, station.longitude_deg, true);
    view.setFloat64(offset + 13, station.latitude_deg, true);
    view.setFloat64(offset + 21, station.altitude_m, true);
    return offset + 29;
}

/** Export station geometry only in ISO WKB little-endian form. */
export function buildGroundStationsWkb(stations) {
    const normalized = normalizedExportStations(stations);
    if (normalized.length === 1) {
        const buffer = new ArrayBuffer(29);
        writeWkbPoint(new DataView(buffer), 0, normalized[0]);
        return new Uint8Array(buffer);
    }
    const buffer = new ArrayBuffer(9 + (29 * normalized.length));
    const view = new DataView(buffer);
    view.setUint8(0, 1); // little-endian byte order
    view.setUint32(1, 1004, true); // ISO WKB MultiPoint Z
    view.setUint32(5, normalized.length, true);
    let offset = 9;
    for (const station of normalized) offset = writeWkbPoint(view, offset, station);
    return new Uint8Array(buffer);
}

function crc32(bytes) {
    let value = 0xffffffff;
    for (const byte of bytes) {
        value ^= byte;
        for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
    return (value ^ 0xffffffff) >>> 0;
}

function concatBytes(...chunks) {
    const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

/**
 * Create a small standards-compliant, uncompressed KMZ archive. A station
 * export only needs doc.kml, so a dependency-heavy ZIP library would add no
 * value to the browser bundle.
 */
export function buildGroundStationsKmz(stations) {
    const encoder = new TextEncoder();
    const name = encoder.encode("doc.kml");
    const contents = encoder.encode(buildGroundStationsKml(stations));
    const crc = crc32(contents);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true); // store, never compress
    localView.setUint32(14, crc, true);
    localView.setUint32(18, contents.length, true);
    localView.setUint32(22, contents.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, 0, true); // store
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, contents.length, true);
    centralView.setUint32(24, contents.length, true);
    centralView.setUint16(28, name.length, true);
    central.set(name, 46);

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, 1, true);
    endView.setUint16(10, 1, true);
    endView.setUint32(12, central.length, true);
    endView.setUint32(16, local.length + contents.length, true);
    return concatBytes(local, contents, central, end);
}

/**
 * GeoPackage is binary SQLite and deliberately runs through the local Python
 * service. The browser retains the other formats for offline export.
 */
export function requiresGroundStationExportService(format) {
    return normalizeFormat(format) === GROUND_STATION_EXPORT_FORMATS.GPKG;
}

/**
 * Serialize a station set for a browser, API, or filesystem adapter. The
 * returned value is intentionally data-only; callers choose how to download
 * or persist it.
 */
export function serializeGroundStationsExport(stations, format = GROUND_STATION_EXPORT_FORMATS.GEOJSON) {
    const resolvedFormat = normalizeFormat(format);
    const requiresService = resolvedFormat === GROUND_STATION_EXPORT_FORMATS.GPKG;
    if (requiresService) {
        throw new GroundStationInterchangeError("GeoPackage requiere el servicio local de exportacion.", { code: "server-export-required" });
    }
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
    if (resolvedFormat === GROUND_STATION_EXPORT_FORMATS.KML) {
        return {
            format: resolvedFormat,
            extension: ".kml",
            mimeType: "application/vnd.google-earth.kml+xml;charset=utf-8",
            document: null,
            text: buildGroundStationsKml(stations)
        };
    }
    if (resolvedFormat === GROUND_STATION_EXPORT_FORMATS.KMZ) {
        return {
            format: resolvedFormat,
            extension: ".kmz",
            mimeType: "application/vnd.google-earth.kmz",
            document: null,
            text: null,
            bytes: buildGroundStationsKmz(stations)
        };
    }
    if (resolvedFormat === GROUND_STATION_EXPORT_FORMATS.WKT) {
        return {
            format: resolvedFormat,
            extension: ".wkt",
            mimeType: "text/plain;charset=utf-8",
            document: null,
            text: buildGroundStationsWkt(stations)
        };
    }
    if (resolvedFormat === GROUND_STATION_EXPORT_FORMATS.WKB) {
        return {
            format: resolvedFormat,
            extension: ".wkb",
            mimeType: "application/vnd.ogc.wkb",
            document: null,
            text: null,
            bytes: buildGroundStationsWkb(stations)
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
    const payload = serialized.bytes || serialized.text || "";
    const blob = new Blob([payload], { type: serialized.mimeType });
    const url = urlApi.createObjectURL(blob);
    const anchor = Object.assign(documentRef.createElement("a"), {
        href: url,
        download: resolvedFileName
    });
    anchor.click();
    urlApi.revokeObjectURL(url);
    return serialized;
}
