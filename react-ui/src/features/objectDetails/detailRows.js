const number = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "-";
const value = (input, fallback = "-") => input === undefined || input === null || input === "" ? fallback : String(input);

export function buildObjectDetails(detail) {
    const telemetry = detail.telemetry || {}; const geo = telemetry.geo || {}; const orbit = detail.orbitInfo || {};
    const visible = detail.visible !== false; const oem = String(detail.sourceFormat || telemetry.source_format || "").toUpperCase() === "OEM";
    const noradId = detail.noradId || telemetry.norad_id || telemetry.norad || telemetry.catalog_number;
    return { title: value(telemetry.id, detail.id), noradId: value(noradId), visible, rows: {
        overview: [["Mission", value(telemetry.mission, telemetry.source_origin || detail.sourceFormat || "Satellite")], ["Source", value(detail.sourceFormat || telemetry.source_format)], ["Status", visible ? "Operational" : "Hidden", visible ? "is-operational" : "is-hidden"], ["Orbit type", value(orbit.label)], ["Altitude", `${number(geo.altitude_m / 1000)} km`], ["Inclination", value(telemetry.inclination_deg ? `${number(telemetry.inclination_deg, 2)} deg` : "-")]],
        orbit: [["Type", value(orbit.label)], ["Latitude", `${number(geo.latitude_deg, 4)} deg`], ["Longitude", `${number(geo.longitude_deg, 4)} deg`], ["Altitude", `${number(geo.altitude_m / 1000)} km`], ["Recommended window", value(orbit.recommendedWindow)], ["Propagation", oem ? "OEM ephemeris" : "SGP4"]],
        telemetry: [["Speed", `${number(telemetry.speed_km_h)} km/h`], ["Velocity", `${number(telemetry.speed_m_s)} m/s`], ["Camera distance", `${number(telemetry.distance_to_camera_m)} m`], ["Telemetry age", `${number(telemetry.telemetry_age_ms, 0)} ms`], ["Trail points", number(telemetry.trail_points, 0)]],
        info: [["NORAD", value(noradId)], ["Source format", value(detail.sourceFormat || telemetry.source_format)], ["Origin", value(telemetry.source_origin)], ["Object ID", value(detail.id)], ["OEM range", oem ? "Locked to OEM ephemeris" : "Manual range available"]]
    } };
}
