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

function hasVector(input) {
    return Boolean(input && [input.x, input.y, input.z].every(hasNumber));
}

function firstVector(...inputs) {
    return inputs.find(hasVector) || null;
}

function frameLabel(input) {
    if (typeof input === "string") return input.trim() || null;
    if (!input || typeof input !== "object") return null;
    const name = String(input.name || input.frame || "").trim();
    const realization = String(input.realization || "").trim();
    if (!name) return realization || null;
    return realization && realization !== name ? `${name} / ${realization}` : name;
}

function optionalRow(label, data, tone) {
    return data === "-" || data === null || data === undefined || data === "" ? [] : [[label, data, tone]];
}

function vectorMagnitude(input) {
    if (!input || ![input.x, input.y, input.z].every(hasNumber)) return null;
    return Math.hypot(Number(input.x), Number(input.y), Number(input.z));
}

function simulationMode(input) {
    if (input === "simulated") return "Simulated";
    if (input === "static") return "Static";
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

function manualPropagationEngineLabel(input) {
    const id = String(input || "").trim().toLowerCase();
    if (id === "cowell-rk4" || id === "cowell") return "Cowell numerical propagation";
    if (id === "two-body" || id === "kepler" || id === "keplerian") return "Keplerian analytical propagation";
    if (id === "sgp4" || id === "sgp-4") return "SGP4 / TLE propagation";
    // Older projects can retain a J2 preset without mislabelling J2 itself
    // as an integrator. Its force model is shown separately below.
    if (id === "j2" || id === "j2-j3-j4") return "Legacy numerical preset";
    return value(input);
}

// A force model is a composable set, not an exclusive propagator setting.
// Old projects only expose a gravity preset and a drag flag; keep that as a
// read-only compatibility path, while modern `forceTerms` stays authoritative.
const FORCE_TERM_ORDER = Object.freeze(["central", "j2", "j3", "j4", "drag"]);
const FORCE_TERM_LABELS = Object.freeze({
    central: "Central gravity",
    j2: "J2",
    j3: "J3",
    j4: "J4",
    drag: "Atmospheric drag"
});

function resolveManualForceTerms(input, { legacyForceModel, legacyPropagator, legacyCowellDefault = false, atmosphericDrag } = {}) {
    const supplied = Array.isArray(input);
    const normalized = new Set(
        (supplied ? input : [])
            .map((term) => String(term || "").trim().toLowerCase())
            .map((term) => ({
                "central-gravity": "central",
                central_gravity: "central",
                "atmospheric-drag": "drag",
                atmospheric_drag: "drag"
            }[term] || term))
            .filter(Boolean)
    );

    if (!supplied) {
        const legacy = String(legacyForceModel || legacyPropagator || "").trim().toLowerCase();
        if (legacy === "j2") normalized.add("j2");
        if (["j2-j3-j4", "j2j3j4"].includes(legacy)) {
            normalized.add("j2");
            normalized.add("j3");
            normalized.add("j4");
        }
        // Before forceTerms existed, Cowell's implicit native default was
        // central + J2 + J3 + J4. Preserve that interpretation for an old
        // record that only carries drag/body fields; a modern response always
        // supplies forceTerms and therefore never takes this branch.
        if (legacyCowellDefault && !legacyForceModel) {
            normalized.add("j2");
            normalized.add("j3");
            normalized.add("j4");
        }
        if (atmosphericDrag === true) normalized.add("drag");
    }

    // This is the mandatory base force for every supported Cowell solution.
    normalized.add("central");
    // Preserve future terms in the information panel even if this build does
    // not yet have a dedicated checkbox for them (SRP, third bodies, EGM…).
    return [
        ...FORCE_TERM_ORDER.filter((term) => normalized.has(term)),
        ...[...normalized].filter((term) => !FORCE_TERM_ORDER.includes(term))
    ];
}

function manualForceTermsLabel(terms) {
    return terms
        .map((term) => FORCE_TERM_LABELS[term] || String(term).replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()))
        .filter(Boolean)
        .join(" + ") || "-";
}

export function buildObjectDetails(detail) {
    const telemetry = detail.telemetry || {}; const geo = telemetry.geo || {}; const orbit = detail.orbitInfo || {};
    const timeRange = detail.timeRange || {};
    const catalogMeta = detail.catalogMeta || {}; const tleSummary = detail.tleSummary || detail.summary || {};
    const visible = detail.visible !== false; const sourceFormat = String(detail.sourceFormat || telemetry.source_format || "").toUpperCase(); const oem = sourceFormat === "OEM";
    const celestial = sourceFormat === "CELESTIAL"
        || ["CELESTIAL_BODY", "EARTH"].includes(String(detail.layerType || "").toUpperCase())
        || String(detail.id || "").toLowerCase() === "body:earth";
    const manual = sourceFormat === "MANUAL";
    const noradId = detail.noradId || telemetry.norad_id || telemetry.norad || telemetry.catalog_number;
    const manualOrbit = catalogMeta.manualOrbit || catalogMeta.manual_orbit || telemetry.manual_orbit || {};
    const manualObjectMetadata = manualOrbit.objectMetadata || manualOrbit.object_metadata || {};
    // A manually authored object may not exist in the catalogue at all. Make
    // its Overview fields first-class metadata instead of hiding them solely
    // inside the orbit-design record.
    const metadataSources = [manualObjectMetadata, catalogMeta, telemetry];
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
    const positionVector = firstVector(telemetry.position, telemetry.position_ecef_m, telemetry.position_eci_m);
    const velocityVector = firstVector(telemetry.velocity, telemetry.velocity_ecef_m_s, telemetry.velocity_eci_m_s);
    const accelerationVector = telemetry.acceleration_ecef_m_s2;
    const positionFrame = frameLabel(telemetry.position_frame || telemetry.reference_frame || telemetry.frame);
    const velocityFrame = frameLabel(telemetry.velocity_frame) || positionFrame;
    const stateFrame = positionFrame || velocityFrame;
    const simulation = telemetry.simulation || {};
    const manualKeplerian = manualOrbit.keplerian || {};
    const manualStateVector = manualOrbit.stateVector || manualOrbit.state_vector || {};
    const manualPosition = manualStateVector.positionEciKm || manualStateVector.position_eci_km || manualStateVector.position || {};
    const manualVelocity = manualStateVector.velocityEciKmS || manualStateVector.velocity_eci_km_s || manualStateVector.velocity || {};
    const manualStateFrame = frameLabel(
        manualStateVector.referenceFrame
        || manualStateVector.reference_frame
        || manualOrbit.referenceFrame
        || manualOrbit.reference_frame
    ) || "EME2000";
    const manualSummary = manualOrbit.summary || manualOrbit.orbitSummary || manualOrbit.orbit_summary || {};
    const manualPropagationOptions = manualOrbit.propagationOptions || manualOrbit.propagation_options || {};
    const manualObjectType = metadataValue([manualObjectMetadata], ["objectType", "object_type"]);
    const rawManualAtmosphericDrag = manualPropagationOptions.atmosphericDrag ?? manualPropagationOptions.atmospheric_drag;
    const manualDragCoefficient = manualPropagationOptions.dragCoefficient ?? manualPropagationOptions.drag_coefficient;
    const manualAreaM2 = manualPropagationOptions.areaM2 ?? manualPropagationOptions.area_m2;
    const manualMassKg = manualPropagationOptions.massKg ?? manualPropagationOptions.mass_kg;
    const manualNumericalIntegrator = manualPropagationOptions.numericalIntegrator ?? manualPropagationOptions.numerical_integrator;
    const manualForceModel = manualPropagationOptions.cowellGravityModel
        ?? manualPropagationOptions.cowell_gravity_model
        ?? manualPropagationOptions.forceModel
        ?? manualPropagationOptions.force_model;
    const manualPropagator = String(manualOrbit.propagator || "").trim().toLowerCase();
    const manualUsesCowell = manualPropagator === "cowell-rk4" || manualPropagator === "cowell";
    const manualUsesLegacyForcePreset = manualPropagator === "j2" || manualPropagator === "j2-j3-j4";
    const rawManualForceTerms = manualPropagationOptions.forceTerms ?? manualPropagationOptions.force_terms;
    const hasManualForceTerms = Array.isArray(rawManualForceTerms);
    const manualForceTerms = resolveManualForceTerms(rawManualForceTerms, {
        legacyForceModel: manualForceModel,
        legacyPropagator: manualPropagator,
        legacyCowellDefault: manualUsesCowell,
        atmosphericDrag: rawManualAtmosphericDrag
    });
    const manualAtmosphericDrag = hasManualForceTerms
        ? manualForceTerms.includes("drag")
        : rawManualAtmosphericDrag;
    // Drag is an optional Cowell force term, never a generic property of a
    // Kepler/SGP4 or immutable legacy preset. Keep its ballistic parameters
    // out of those object records rather than displaying inert values.
    const manualDragRows = manualUsesCowell
        ? [
            ["Atmospheric drag", onOff(manualAtmosphericDrag)],
            ...(manualAtmosphericDrag === true ? [
                ["Drag coefficient", number(manualDragCoefficient, 3)],
                ["Reference area", numberWithUnit(manualAreaM2, "m²", 3)],
                ["Mass", numberWithUnit(manualMassKg, "kg", 3)]
            ] : [])
        ]
        : [];
    const orbitRows = [
        ...optionalRow("Type", value(orbit.label)),
        ...optionalRow("Latitude", numberWithUnit(geo.latitude_deg, "deg", 4)),
        ...optionalRow("Longitude", numberWithUnit(geo.longitude_deg, "deg", 4)),
        ...optionalRow("Altitude", convertedNumberWithUnit(geo.altitude_m, 1000, "km")),
        ...optionalRow(stateFrame ? `Instant speed (${stateFrame})` : "Instant speed", numberWithUnit(telemetry.speed_m_s, "m/s")),
        ...optionalRow("Orbital period", numberWithUnit(tlePeriodMinutes(tleSummary), "min", 2)),
        ...optionalRow("Earth center distance", convertedNumberWithUnit(telemetry.earth_center_distance_m, 1000, "km")),
        ...optionalRow("Reference frame", stateFrame || "-"),
        ...optionalRow(stateFrame ? `Position ${stateFrame}` : "Position", vectorWithUnit(positionVector, "km", 1, 1000)),
        ...optionalRow((velocityFrame || stateFrame) ? `Velocity ${velocityFrame || stateFrame}` : "Velocity", vectorWithUnit(velocityVector, "m/s")),
        ...optionalRow("Ground track", onOff(telemetry.ground_track_enabled)),
        ...(telemetry.ground_track_enabled === true
            ? optionalRow("Footprint radius", convertedNumberWithUnit(telemetry.footprint_radius_m, 1000, "km"))
            : []),
        ...optionalRow("Recommended window", value(orbit.recommendedWindow)),
        ...(!manual ? optionalRow("Propagation", oem ? "OEM ephemeris" : "SGP4") : [])
    ];
    if (celestial) {
        const body = value(telemetry.celestial_body || catalogMeta.celestialBody, "Cuerpo");
        const state = visible ? "Visible" : "Hidden";
        return {
            title,
            noradId: "-",
            visible,
            rows: {
                overview: [
                    ["Name", title],
                    ["Object type", "Cuerpo de referencia"],
                    ["Body", body.replace(/^./, (letter) => letter.toUpperCase())],
                    ["Source", "Modelo de referencia"],
                    ["Status", state, visible ? "is-operational" : "is-hidden"],
                    ["Physical radius", numberWithUnit(telemetry.body_radius_m || catalogMeta.bodyRadiusMeters, "m", 0)]
                ],
                orbit: [
                    ...optionalRow("Reference frame", stateFrame || "-"),
                    ...optionalRow("Earth center distance", convertedNumberWithUnit(telemetry.earth_center_distance_m, 1000, "km", 1)),
                    ...optionalRow(stateFrame ? `Position ${stateFrame}` : "Position", vectorWithUnit(positionVector, "km", 1, 1000)),
                    ...optionalRow("Clock instant", simulationFrame(telemetry.simulation?.current_time || telemetry.timestamp_ms))
                ],
                telemetry: [
                    ["Scene state", value(telemetry.runtime_state)],
                    ["Simulation frame", simulationFrame(telemetry.simulation?.current_time || telemetry.timestamp_ms)],
                    ["Simulation mode", simulationMode(telemetry.simulation?.mode)],
                    ["Time scale", hasNumber(telemetry.simulation?.time_scale) ? `${number(telemetry.simulation.time_scale, 0)}Ã—` : "-"]
                ],
                manual: []
            }
        };
    }
    return { title, noradId: value(noradId), visible, rows: {
        overview: [["Nombre", title], ["Object type", manual ? manualObjectType : "-"], ["Misión", mission], ["Operador / agencia", operator], ["País", country], ["Source", source], ["Fuente TLE", sourceOrigin], ["Status", status, statusTone], ["Orbit type", value(orbit.label)], ["Altitude", numberWithUnit(generalAltitudeKm, "km")], ["NORAD", value(noradId)], ["Object ID", objectId], ["Fecha de lanzamiento", launchDate], ["Vehículo lanzador", launchVehicle], ["Sitio de lanzamiento", launchSite], ["Estado TLE", oem ? "-" : tleStatus(ageHours, orbit)], ["Edad TLE", oem ? "-" : numberWithUnit(ageHours, "h")], ["Última actualización", lastUpdated], ["Fecha inicio", utcDate(timeRange.startDate)], ["Fecha fin", utcDate(timeRange.endDate)], ["Rango OEM", oemRange(timeRange)]],
        // Orbit holds instantaneous geographic/reference-frame state. TLE
        // elements deliberately stay in the dedicated TLE dialog.
        orbit: orbitRows,
        // Telemetry is intentionally limited to values that vary per state
        // sample or simulation frame; it contains no TLE/static orbit fields.
        telemetry: [["Speed", numberWithUnit(telemetry.speed_km_h, "km/h")], ["Velocity", numberWithUnit(telemetry.speed_m_s, "m/s")], ["Velocity vector", vectorWithUnit(velocityVector, "m/s")], ["Acceleration", numberWithUnit(vectorMagnitude(accelerationVector), "m/s²", 3)], ["Acceleration vector", vectorWithUnit(accelerationVector, "m/s²", 3)], ["Camera distance", numberWithUnit(telemetry.distance_to_camera_m, "m")], ["Station distance", convertedNumberWithUnit(telemetry.station_distance_m, 1000, "km")], ["Doppler shift", numberWithUnit(telemetry.doppler_shift_hz, "Hz")], ["Signal delay", numberWithUnit(telemetry.signal_delay_ms, "ms")], ["Path loss", numberWithUnit(telemetry.path_loss_db, "dB")], ["Satellite state", value(telemetry.runtime_state)], ["Simulation frame", simulationFrame(simulation.current_time || telemetry.timestamp_ms)], ["Simulation mode", simulationMode(simulation.mode)], ["Time scale", hasNumber(simulation.time_scale) ? `${number(simulation.time_scale, 0)}×` : "-"], ["Playback", simulation.is_playing === true ? "Playing" : simulation.is_playing === false ? "Paused" : "-"], ["Telemetry age", numberWithUnit(telemetry.telemetry_age_ms, "ms", 0)]],
        manual: manual ? [["Definition", value(manualOrbit.definitionSource || manualOrbit.definition_source)], ["Propagation engine", manualPropagationEngineLabel(manualOrbit.propagator)], ...(manualUsesCowell ? [["Numerical integrator", value(manualNumericalIntegrator, "RK4").toUpperCase()], ["Force terms", manualForceTermsLabel(manualForceTerms)]] : manualUsesLegacyForcePreset ? [["Force terms", manualForceTermsLabel(manualForceTerms)]] : []), ...manualDragRows, ["Epoch", utcDate(manualOrbit.epochUtc || manualOrbit.epoch)], ["Start", utcDate(manualOrbit.startTime || manualOrbit.start_time)], ["End", utcDate(manualOrbit.endTime || manualOrbit.end_time)], ["Ground track", onOff(manualOrbit.groundTrackEnabled ?? manualOrbit.ground_track_enabled)], ["Semi-major axis", numberWithUnit(manualKeplerian.semiMajorAxisKm ?? manualKeplerian.semi_major_axis_km, "km", 3)], ["Eccentricity", number(manualKeplerian.eccentricity, 6)], ["Inclination", numberWithUnit(manualKeplerian.inclinationDeg ?? manualKeplerian.inclination_deg, "deg", 4)], ["RAAN", numberWithUnit(manualKeplerian.raanDeg ?? manualKeplerian.raan_deg, "deg", 4)], ["Arg. periapsis", numberWithUnit(manualKeplerian.argumentOfPeriapsisDeg ?? manualKeplerian.argument_of_periapsis_deg ?? manualKeplerian.argument_of_perigee_deg, "deg", 4)], ["True anomaly", numberWithUnit(manualKeplerian.trueAnomalyDeg ?? manualKeplerian.true_anomaly_deg, "deg", 4)], [`Position ${manualStateFrame}`, vectorWithUnit(manualPosition, "km", 3)], [`Velocity ${manualStateFrame}`, vectorWithUnit(manualVelocity, "km/s", 5)], ["Perigee", numberWithUnit(manualSummary.perigeeAltitudeKm ?? manualSummary.perigee_altitude_km ?? manualSummary.perigeeKm ?? manualSummary.perigee_km, "km", 3)], ["Apogee", numberWithUnit(manualSummary.apogeeAltitudeKm ?? manualSummary.apogee_altitude_km ?? manualSummary.perigeeKm ?? manualSummary.apogee_km, "km", 3)], ["Period", numberWithUnit(manualSummary.periodMinutes ?? manualSummary.period_minutes ?? (hasNumber(manualSummary.orbitalPeriodSeconds ?? manualSummary.orbital_period_seconds) ? Number(manualSummary.orbitalPeriodSeconds ?? manualSummary.orbital_period_seconds) / 60 : null), "min", 3)]] : []
    } };
}
