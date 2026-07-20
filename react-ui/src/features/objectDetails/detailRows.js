import { tleEpochAgeMs } from "../../../../front/js/features/objectDetails/tleEpoch.js";

const number = (input, digits = 1) => input !== null && input !== undefined && input !== "" && Number.isFinite(Number(input)) ? Number(input).toFixed(digits) : "-";
const value = (input, fallback = "-") => input === undefined || input === null || input === "" ? fallback : String(input);
const utcDate = (input) => {
    if (!input) return "-";
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? "-" : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};
const hours = (input) => {
    const total = Number(input);
    if (!Number.isFinite(total)) return "-";
    const rounded = Math.round(total * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} h`;
};
const oemRange = (range) => {
    if (range.label) return String(range.label);
    const duration = hours(range.oemRangeHours);
    if (duration === "-") return duration;
    if (range.mode === "realtime") return `${duration} hacia futuro`;
    return range.mode === "range" ? `${duration} (inicio → fin)` : duration;
};

const hasNumber = (input) => input !== null && input !== undefined && input !== "" && Number.isFinite(Number(input));
const numberWithUnit = (input, unit, digits = 1) => hasNumber(input) ? `${number(input, digits)} ${unit}` : "-";
const convertedNumberWithUnit = (input, divisor, unit, digits = 1) => hasNumber(input) ? numberWithUnit(Number(input) / divisor, unit, digits) : "-";
const onOff = (input) => input === true ? "On" : input === false ? "Off" : "-";

function vectorWithUnit(input, unit, digits = 1, divisor = 1) {
    if (!input || ![input.x, input.y, input.z].every(hasNumber)) return "-";
    return `(${number(Number(input.x) / divisor, digits)}, ${number(Number(input.y) / divisor, digits)}, ${number(Number(input.z) / divisor, digits)}) ${unit}`;
}

function vectorMagnitude(input) {
    if (!input || ![input.x, input.y, input.z].every(hasNumber)) return null;
    return Math.hypot(Number(input.x), Number(input.y), Number(input.z));
}

function simulationMode(input) {
    if (input === "simulated") return "Simulated";
    if (input === "realtime") return "Real time";
    return "-";
}

function simulationFrame(input) {
    return input ? utcDate(input) : "-";
}

function tlePeriodMinutes(summary) {
    const meanMotionRevDay = Number(summary?.meanMotionRevDay);
    return Number.isFinite(meanMotionRevDay) && meanMotionRevDay > 0
        ? 1440 / meanMotionRevDay
        : null;
}
const missingMetadataValues = new Set(["", "-", "unknown", "n/a", "na", "none", "null", "undefined"]);

function metadataValue(sources, keys, fallback = "-") {
    for (const source of sources) {
        if (!source || typeof source !== "object") continue;
        for (const key of keys) {
            const raw = source[key];
            if (raw === undefined || raw === null) continue;
            const normalized = String(raw).trim();
            if (!missingMetadataValues.has(normalized.toLowerCase())) return normalized;
        }
    }
    return fallback;
}

function tleAgeHours(summary, referenceTimeMs) {
    const ageMs = tleEpochAgeMs(summary?.epoch, hasNumber(referenceTimeMs) ? Number(referenceTimeMs) : Date.now());
    return Number.isFinite(ageMs) ? Math.max(0, ageMs / (60 * 60 * 1000)) : null;
}

function tleStatus(ageHours, orbit) {
    const recommendedDays = Number(orbit?.recommendedMaxDays);
    if (!Number.isFinite(ageHours) || !Number.isFinite(recommendedDays) || recommendedDays <= 0) return "-";
    const recommendedHours = recommendedDays * 24;
    if (ageHours <= recommendedHours) return "Vigente";
    if (ageHours <= recommendedHours * 2) return "Antiguo";
    return "Caducado";
}

function metadataDate(sources, keys) {
    const raw = metadataValue(sources, keys, "");
    return raw ? utcDate(raw) : "-";
}

export function buildObjectDetails(detail) {
    const telemetry = detail.telemetry || {}; const geo = telemetry.geo || {}; const orbit = detail.orbitInfo || {};
    const timeRange = detail.timeRange || {};
    const catalogMeta = detail.catalogMeta || {}; const tleSummary = detail.tleSummary || detail.summary || {};
    const visible = detail.visible !== false; const sourceFormat = String(detail.sourceFormat || telemetry.source_format || "").toUpperCase(); const oem = sourceFormat === "OEM";
    const noradId = detail.noradId || telemetry.norad_id || telemetry.norad || telemetry.catalog_number;
    const metadataSources = [catalogMeta, telemetry];
    const title = metadataValue(metadataSources, ["name", "catalogName", "objectName", "object_name", "satelliteName"], value(telemetry.id, detail.id));
    const mission = metadataValue(metadataSources, ["missionType", "mission_type", "mission"]);
    const operator = metadataValue(metadataSources, ["operatorLabel", "operator", "agency", "ownerLabel", "owner"]);
    const country = metadataValue(metadataSources, ["country", "countryCode", "country_code", "operatorCountry", "operator_country"]);
    const source = metadataValue(metadataSources, ["sourceFormat", "source_format"], sourceFormat || "-");
    const sourceOrigin = oem ? "-" : metadataValue(metadataSources, ["tleSource", "tle_source", "sourceOrigin", "source_origin"]);
    const tleObjectId = metadataValue([tleSummary], ["internationalDesignator", "international_designator"], value(detail.id));
    const objectId = metadataValue(metadataSources, ["objectId", "object_id", "internationalDesignator", "international_designator"], tleObjectId);
    const launchDate = metadataDate(metadataSources, ["launchDate", "launch_date", "launchTimestamp", "launch_timestamp"]);
    const launchVehicle = metadataValue(metadataSources, ["launchVehicle", "launch_vehicle", "vehicle"]);
    const launchSite = metadataValue(metadataSources, ["launchSite", "launch_site", "site"]);
    const lastUpdated = oem ? "-" : metadataDate(metadataSources, ["tleUpdatedAt", "tle_updated_at", "updatedAt", "updated_at", "lastUpdated", "last_updated"]);
    const ageHours = oem ? null : tleAgeHours(tleSummary, detail.referenceTimeMs ?? telemetry.timestamp_ms);
    const generalAltitudeKm = hasNumber(orbit.altitudeKm) ? orbit.altitudeKm : (hasNumber(geo.altitude_m) ? Number(geo.altitude_m) / 1000 : null);
    const status = detail.active === false ? "Inactive" : (visible ? "Operational" : "Hidden");
    const statusTone = status === "Operational" ? "is-operational" : (status === "Hidden" ? "is-hidden" : undefined);
    const velocityVector = telemetry.velocity_ecef_m_s || telemetry.velocity;
    const accelerationVector = telemetry.acceleration_ecef_m_s2;
    const simulation = telemetry.simulation || {};
    return { title, noradId: value(noradId), visible, rows: {
        overview: [["Nombre", title], ["Misión", mission], ["Operador / agencia", operator], ["País", country], ["Source", source], ["Fuente TLE", sourceOrigin], ["Status", status, statusTone], ["Orbit type", value(orbit.label)], ["Altitude", numberWithUnit(generalAltitudeKm, "km")], ["NORAD", value(noradId)], ["Object ID", objectId], ["Fecha de lanzamiento", launchDate], ["Vehículo lanzador", launchVehicle], ["Sitio de lanzamiento", launchSite], ["Estado TLE", oem ? "-" : tleStatus(ageHours, orbit)], ["Edad TLE", oem ? "-" : numberWithUnit(ageHours, "h")], ["Última actualización", lastUpdated], ["Fecha inicio", utcDate(timeRange.startDate)], ["Fecha fin", utcDate(timeRange.endDate)], ["Rango OEM", oemRange(timeRange)]],
        // Orbit holds instantaneous geographic/reference-frame state. TLE
        // elements deliberately stay in the dedicated TLE dialog.
        orbit: [["Type", value(orbit.label)], ["Latitude", numberWithUnit(geo.latitude_deg, "deg", 4)], ["Longitude", numberWithUnit(geo.longitude_deg, "deg", 4)], ["Altitude", convertedNumberWithUnit(geo.altitude_m, 1000, "km")], ["Instant speed", numberWithUnit(telemetry.speed_m_s, "m/s")], ["Orbital period", numberWithUnit(tlePeriodMinutes(tleSummary), "min", 2)], ["True anomaly", "-"], ["Argument of latitude", "-"], ["Earth center distance", convertedNumberWithUnit(telemetry.earth_center_distance_m, 1000, "km")], ["Station distance", convertedNumberWithUnit(telemetry.station_distance_m, 1000, "km")], ["Elevation / azimuth", "-"], ["AOS / LOS", "-"], ["Position ECI", vectorWithUnit(telemetry.position_eci_m, "km", 1, 1000)], ["Velocity ECI", vectorWithUnit(telemetry.velocity_eci_m_s, "m/s")], ["Position ECEF", vectorWithUnit(telemetry.position_ecef_m, "km", 1, 1000)], ["Velocity ECEF", vectorWithUnit(telemetry.velocity_ecef_m_s, "m/s")], ["Reference frame", value(telemetry.position_frame)], ["Ground track", onOff(telemetry.ground_track_enabled)], ["Footprint", onOff(telemetry.footprint_enabled)], ["Footprint radius", convertedNumberWithUnit(telemetry.footprint_radius_m, 1000, "km")], ["Velocity vector display", onOff(telemetry.velocity_vector_enabled)], ["Recommended window", value(orbit.recommendedWindow)], ["Propagation", oem ? "OEM ephemeris" : "SGP4"]],
        // Telemetry is intentionally limited to values that vary per state
        // sample or simulation frame; it contains no TLE/static orbit fields.
        telemetry: [["Speed", numberWithUnit(telemetry.speed_km_h, "km/h")], ["Velocity", numberWithUnit(telemetry.speed_m_s, "m/s")], ["Velocity vector", vectorWithUnit(velocityVector, "m/s")], ["Acceleration", numberWithUnit(vectorMagnitude(accelerationVector), "m/s²", 3)], ["Acceleration vector", vectorWithUnit(accelerationVector, "m/s²", 3)], ["Camera distance", numberWithUnit(telemetry.distance_to_camera_m, "m")], ["Station distance", convertedNumberWithUnit(telemetry.station_distance_m, 1000, "km")], ["Doppler shift", numberWithUnit(telemetry.doppler_shift_hz, "Hz")], ["Signal delay", numberWithUnit(telemetry.signal_delay_ms, "ms")], ["Path loss", numberWithUnit(telemetry.path_loss_db, "dB")], ["Satellite state", value(telemetry.runtime_state)], ["Simulation frame", simulationFrame(simulation.current_time || telemetry.timestamp_ms)], ["Simulation mode", simulationMode(simulation.mode)], ["Time scale", hasNumber(simulation.time_scale) ? `${number(simulation.time_scale, 0)}×` : "-"], ["Playback", simulation.is_playing === true ? "Playing" : simulation.is_playing === false ? "Paused" : "-"], ["Telemetry age", numberWithUnit(telemetry.telemetry_age_ms, "ms", 0)]]
    } };
}
