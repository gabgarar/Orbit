import { tleEpochAgeMs, tleEpochToDate } from "../../../../front/js/features/objectDetails/tleEpoch.js";

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

const EARTH_RADIUS_KM = 6378.137;
const EARTH_MU_KM3_S2 = 398600.4418;
const INPUT_UNAVAILABLE = "No disponible en la fuente";

function tleDerivedGeometry(summary) {
    const meanMotionRevDay = Number(summary?.meanMotionRevDay);
    const eccentricity = Number(summary?.eccentricity);
    if (!Number.isFinite(meanMotionRevDay) || meanMotionRevDay <= 0) {
        return { semiMajorAxisKm: null, perigeeAltitudeKm: null, apogeeAltitudeKm: null };
    }
    const meanMotionRadS = meanMotionRevDay * (2 * Math.PI) / 86400;
    const semiMajorAxisKm = Math.cbrt(EARTH_MU_KM3_S2 / (meanMotionRadS * meanMotionRadS));
    if (!Number.isFinite(semiMajorAxisKm)) {
        return { semiMajorAxisKm: null, perigeeAltitudeKm: null, apogeeAltitudeKm: null };
    }
    const validEccentricity = Number.isFinite(eccentricity) && eccentricity >= 0 && eccentricity < 1;
    return {
        semiMajorAxisKm,
        perigeeAltitudeKm: validEccentricity ? (semiMajorAxisKm * (1 - eccentricity)) - EARTH_RADIUS_KM : null,
        apogeeAltitudeKm: validEccentricity ? (semiMajorAxisKm * (1 + eccentricity)) - EARTH_RADIUS_KM : null
    };
}

function sourceInputLabel(sourceFormat, { manual = false } = {}) {
    if (manual || sourceFormat === "MANUAL") return "Manual";
    if (sourceFormat === "STATE_VECTOR" || sourceFormat === "STATE VECTOR") return "State Vector";
    if (sourceFormat === "SP3") return "SP3";
    if (sourceFormat === "OEM") return "OEM";
    if (sourceFormat === "OMM") return "OMM";
    if (sourceFormat === "TLE") return "TLE";
    return sourceFormat || "-";
}
const missingMetadataValues = new Set(["", "-", "unknown", "n/a", "na", "none", "null", "undefined"]);

function metadataValue(sources, keys, fallback = "-") {
    for (const source of sources) {
        if (!source || typeof source !== "object") continue;
        for (const key of keys) {
            const raw = source[key];
            if (raw === undefined || raw === null) continue;
            if (typeof raw === "object") continue;
            const normalized = String(raw).trim();
            if (!missingMetadataValues.has(normalized.toLowerCase())) return normalized;
        }
    }
    return fallback;
}

function metadataPresence(sources, keys, fallback = INPUT_UNAVAILABLE) {
    for (const source of sources) {
        if (!source || typeof source !== "object") continue;
        for (const key of keys) {
            const raw = source[key];
            if (raw === undefined || raw === null || raw === "") continue;
            if (Array.isArray(raw)) return raw.length ? `${raw.length} registros` : fallback;
            if (typeof raw === "object") return Object.keys(raw).length ? "Disponible" : fallback;
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

function inputEpochText(sourceFormat, tleSummary, oem, manualOrbit, metadataSources) {
    if (sourceFormat === "TLE" || sourceFormat === "OMM") {
        const epoch = tleEpochToDate(tleSummary?.epoch);
        if (epoch) return utcDate(epoch.getTime());
        const declaredEpoch = metadataValue(metadataSources, ["epoch", "epochUtc", "epoch_utc", "epochTime", "epoch_time"], "");
        const formatted = utcDate(declaredEpoch);
        return formatted === "-" ? INPUT_UNAVAILABLE : formatted;
    }
    if (sourceFormat === "OEM") {
        const epoch = oem?.start_time_ms
            || oem?.start_time
            || metadataValue(metadataSources, ["startTime", "start_time", "epoch", "epochUtc", "epoch_utc"], "");
        const formatted = utcDate(epoch);
        return formatted === "-" ? INPUT_UNAVAILABLE : formatted;
    }
    const epoch = manualOrbit?.epochUtc
        || manualOrbit?.epoch_utc
        || manualOrbit?.epoch
        || metadataValue(metadataSources, ["epoch", "epochUtc", "epoch_utc", "epochTime", "epoch_time"], "");
    const formatted = utcDate(epoch);
    return formatted === "-" ? INPUT_UNAVAILABLE : formatted;
}

function inputAgeText(sourceFormat, tleSummary, referenceTimeMs, inputEpoch) {
    if (sourceFormat === "OEM" || sourceFormat === "SP3") return "Cobertura de efemérides";
    if (sourceFormat === "TLE" || sourceFormat === "OMM") {
        return numberWithUnit(tleAgeHours(tleSummary, referenceTimeMs), "h");
    }
    const epochMs = Date.parse(String(inputEpoch || ""));
    const reference = Number(referenceTimeMs);
    if (!Number.isFinite(epochMs) || !Number.isFinite(reference)) return INPUT_UNAVAILABLE;
    return numberWithUnit(Math.max(0, (reference - epochMs) / 3_600_000), "h");
}

function tleInputRows(tleSummary) {
    const geometry = tleDerivedGeometry(tleSummary);
    return [
        ["Línea TLE 1", value(tleSummary?.line1, INPUT_UNAVAILABLE)],
        ["Línea TLE 2", value(tleSummary?.line2, INPUT_UNAVAILABLE)],
        ["Época", inputEpochText("TLE", tleSummary, null, null, [])],
        ["Movimiento medio", numberWithUnit(tleSummary?.meanMotionRevDay, "rev/día", 8)],
        ["BSTAR", value(tleSummary?.bstar, INPUT_UNAVAILABLE)],
        ["Inclinación", numberWithUnit(tleSummary?.inclinationDeg, "deg", 4)],
        ["RAAN", numberWithUnit(tleSummary?.raanDeg, "deg", 4)],
        ["Excentricidad", number(tleSummary?.eccentricity, 7)],
        ["Argumento de perigeo", numberWithUnit(tleSummary?.argPerigeeDeg, "deg", 4)],
        ["Anomalía media", numberWithUnit(tleSummary?.meanAnomalyDeg, "deg", 4)],
        ["Período", numberWithUnit(tlePeriodMinutes(tleSummary), "min", 3)],
        ["Semieje mayor", numberWithUnit(geometry.semiMajorAxisKm, "km", 3)],
        ["Perigeo", numberWithUnit(geometry.perigeeAltitudeKm, "km", 3)],
        ["Apogeo", numberWithUnit(geometry.apogeeAltitudeKm, "km", 3)]
    ];
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
    if (id === "sgp4" || id === "sgp-4") return "Legacy SGP4 / synthetic TLE (unsupported)";
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

function buildLegacyObjectDetails(detail) {
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
    const oemMetadata = telemetry.oem || catalogMeta.oem || {};
    const inputMetadata = catalogMeta.inputMetadata
        || catalogMeta.input_metadata
        || catalogMeta.sourceMetadata
        || catalogMeta.source_metadata
        || telemetry.input_metadata
        || telemetry.inputMetadata
        || {};
    const inputMetadataSources = [inputMetadata, catalogMeta, telemetry];
    const inputType = sourceInputLabel(sourceFormat, { manual });
    const inputEpoch = inputEpochText(sourceFormat, tleSummary, oemMetadata, manualOrbit, inputMetadataSources);
    const inputAge = inputAgeText(sourceFormat, tleSummary, detail.referenceTimeMs ?? telemetry.timestamp_ms, inputEpoch);
    const declaredDataQuality = metadataValue(inputMetadataSources, ["dataQuality", "data_quality", "quality", "precision", "accuracy"], "");
    const qualityFromTle = tleStatus(ageHours, orbit);
    const dataQuality = declaredDataQuality || (
        sourceFormat === "SP3" ? "Alta precisión (SP3)"
            : sourceFormat === "OEM" ? "Según efeméride de entrada"
                : sourceFormat === "MANUAL" ? "Definición manual"
                    : qualityFromTle === "Vigente" ? "Buena"
                        : qualityFromTle === "Antiguo" || qualityFromTle === "Caducado" ? "Pobre"
                            : INPUT_UNAVAILABLE
    );
    const sourceProvider = sourceOrigin === "-"
        ? metadataValue(inputMetadataSources, ["provider", "sourceProvider", "source_provider", "originator", "agency"], INPUT_UNAVAILABLE)
        : sourceOrigin;
    const isEarthFixedState = /(?:ITRF|ECEF|PEF|TIRS)/i.test(stateFrame || "");
    const unavailableState = stateFrame ? `No disponible en ${stateFrame}` : "Sin estado instantáneo";
    const geoUnavailable = stateFrame && !isEarthFixedState
        ? `No aplicable: ${stateFrame} no es terrestre`
        : unavailableState;
    const orbitalPeriodMinutes = hasNumber(telemetry.orbital_period_seconds)
        ? Number(telemetry.orbital_period_seconds) / 60
        : manual
            ? manualSummary.periodMinutes ?? manualSummary.period_minutes ?? (hasNumber(manualSummary.orbitalPeriodSeconds ?? manualSummary.orbital_period_seconds)
                ? Number(manualSummary.orbitalPeriodSeconds ?? manualSummary.orbital_period_seconds) / 60
                : null)
            : tlePeriodMinutes(tleSummary);
    const instantaneousTrueAnomaly = telemetry.true_anomaly_deg ?? telemetry.trueAnomalyDeg;
    const instantaneousArgumentOfLatitude = telemetry.argument_of_latitude_deg ?? telemetry.argumentOfLatitudeDeg;
    const stationDistance = convertedNumberWithUnit(telemetry.station_distance_m, 1000, "km");
    const aos = telemetry.aos || telemetry.next_aos || telemetry.nextAos;
    const los = telemetry.los || telemetry.next_los || telemetry.nextLos;
    const aosLos = aos || los
        ? `${aos ? utcDate(aos) : "AOS -"} · ${los ? utcDate(los) : "LOS -"}`
        : "Sin estación seleccionada";
    const groundTrackState = telemetry.ground_track_enabled === true
        ? (telemetry.ground_track_visible === false ? "Configurado, oculto" : "Activo")
        : "Desactivado";
    const orbitRows = [
        ["Tipo de órbita", value(orbit.label)],
        ["Latitud", isEarthFixedState ? numberWithUnit(geo.latitude_deg, "deg", 4) : geoUnavailable],
        ["Longitud", isEarthFixedState ? numberWithUnit(geo.longitude_deg, "deg", 4) : geoUnavailable],
        ["Altitud", isEarthFixedState ? convertedNumberWithUnit(geo.altitude_m, 1000, "km") : geoUnavailable],
        [stateFrame ? `Velocidad instantánea (${stateFrame})` : "Velocidad instantánea", numberWithUnit(telemetry.speed_m_s, "m/s")],
        ["Período orbital", numberWithUnit(orbitalPeriodMinutes, "min", 2)],
        ["Anomalía verdadera", numberWithUnit(instantaneousTrueAnomaly, "deg", 3)],
        ["Argumento de latitud", numberWithUnit(instantaneousArgumentOfLatitude, "deg", 3)],
        ["Distancia al centro de la Tierra", convertedNumberWithUnit(telemetry.earth_center_distance_m, 1000, "km")],
        ["Marco de referencia", stateFrame || "-"],
        [stateFrame ? `Posición ${stateFrame}` : "Posición", vectorWithUnit(positionVector, "km", 1, 1000)],
        [(velocityFrame || stateFrame) ? `Velocidad ${velocityFrame || stateFrame}` : "Velocidad", vectorWithUnit(velocityVector, "m/s")],
        ["Distancia a estación", stationDistance === "-" ? "Sin estación seleccionada" : stationDistance],
        ["AOS / LOS", aosLos],
        ["Ground track", groundTrackState],
        ["Radio de huella", telemetry.ground_track_enabled === true
            ? convertedNumberWithUnit(telemetry.footprint_radius_m, 1000, "km")
            : "No activo"],
        ["Ventana recomendada", value(orbit.recommendedWindow)]
    ];
    const manualInputRows = [
        ["Tipo de entrada", inputType],
        ["Definición", value(manualOrbit.definitionSource || manualOrbit.definition_source, INPUT_UNAVAILABLE)],
        ["Época", inputEpoch],
        ["Marco del vector de estado", manualStateFrame],
        [`r / Posición ${manualStateFrame}`, vectorWithUnit(manualPosition, "km", 3)],
        [`v / Velocidad ${manualStateFrame}`, vectorWithUnit(manualVelocity, "km/s", 5)],
        ["Interpretación kepleriana", hasNumber(manualKeplerian.semiMajorAxisKm ?? manualKeplerian.semi_major_axis_km)
            ? "Elementos osculantes" : INPUT_UNAVAILABLE],
        ["Semieje mayor", numberWithUnit(manualKeplerian.semiMajorAxisKm ?? manualKeplerian.semi_major_axis_km, "km", 3)],
        ["Excentricidad", number(manualKeplerian.eccentricity, 6)],
        ["Inclinación", numberWithUnit(manualKeplerian.inclinationDeg ?? manualKeplerian.inclination_deg, "deg", 4)],
        ["RAAN", numberWithUnit(manualKeplerian.raanDeg ?? manualKeplerian.raan_deg, "deg", 4)],
        ["Argumento de periapsis", numberWithUnit(manualKeplerian.argumentOfPeriapsisDeg ?? manualKeplerian.argument_of_periapsis_deg ?? manualKeplerian.argument_of_perigee_deg, "deg", 4)],
        ["Anomalía verdadera", numberWithUnit(manualKeplerian.trueAnomalyDeg ?? manualKeplerian.true_anomaly_deg, "deg", 4)],
        ["Perigeo", numberWithUnit(manualSummary.perigeeAltitudeKm ?? manualSummary.perigee_altitude_km ?? manualSummary.perigeeKm ?? manualSummary.perigee_km, "km", 3)],
        ["Apogeo", numberWithUnit(manualSummary.apogeeAltitudeKm ?? manualSummary.apogee_altitude_km ?? manualSummary.apogeeKm ?? manualSummary.apogee_km, "km", 3)],
        ["Período", numberWithUnit(manualSummary.periodMinutes ?? manualSummary.period_minutes ?? (hasNumber(manualSummary.orbitalPeriodSeconds ?? manualSummary.orbital_period_seconds)
            ? Number(manualSummary.orbitalPeriodSeconds ?? manualSummary.orbital_period_seconds) / 60 : null), "min", 3)]
    ];
    const inputRows = (() => {
        if (manual || sourceFormat === "STATE_VECTOR" || sourceFormat === "STATE VECTOR") {
            return manualInputRows;
        }
        if (sourceFormat === "TLE") {
            return [["Tipo de entrada", "TLE"], ...tleInputRows(tleSummary)];
        }
        if (sourceFormat === "OMM") {
            const embeddedTle = Boolean(tleSummary?.line1 && tleSummary?.line2);
            return [
                ["Tipo de entrada", "OMM"],
                ["Época", inputEpoch],
                ["Representación activa", embeddedTle ? "SGP4 con TLE derivado" : INPUT_UNAVAILABLE],
                ["Estado vector", metadataPresence(inputMetadataSources, ["stateVector", "state_vector", "cartesianState", "cartesian_state"])],
                ["Covarianza", metadataPresence(inputMetadataSources, ["covariance", "covarianceMatrix", "covariance_matrix"])],
                ["Maniobras", metadataPresence(inputMetadataSources, ["maneuvers", "maneuvers", "maneuver_data", "maneuverData"])],
                ["Modelo de arrastre", metadataPresence(inputMetadataSources, ["dragModel", "drag_model"])],
                ["Modelo SRP", metadataPresence(inputMetadataSources, ["solarRadiationPressureModel", "solar_radiation_pressure_model", "srpModel", "srp_model"])],
                ["Incertidumbres", metadataPresence(inputMetadataSources, ["uncertainties", "uncertainty", "uncertainty_data"])],
                ["OMM original", "No persistido por el runtime actual"]
            ];
        }
        if (sourceFormat === "OEM") {
            return [
                ["Tipo de entrada", "OEM"],
                ["Archivo", value(oemMetadata.file_name, INPUT_UNAVAILABLE)],
                ["Objeto", value(oemMetadata.object_name, value(title, INPUT_UNAVAILABLE))],
                ["Object ID", value(oemMetadata.object_id, INPUT_UNAVAILABLE)],
                ["Centro", value(oemMetadata.center_name, INPUT_UNAVAILABLE)],
                ["Marco declarado", value(oemMetadata.ref_frame, INPUT_UNAVAILABLE)],
                ["Sistema de tiempo", value(oemMetadata.time_system, INPUT_UNAVAILABLE)],
                ["Inicio", utcDate(oemMetadata.start_time_ms || oemMetadata.start_time)],
                ["Fin", utcDate(oemMetadata.end_time_ms || oemMetadata.stop_time || oemMetadata.end_time)],
                ["Muestras", number(oemMetadata.samples, 0)],
                ["Vectores de estado", metadataPresence(inputMetadataSources, ["states", "state_vectors", "stateVectors"], hasNumber(oemMetadata.samples) ? `${number(oemMetadata.samples, 0)} muestras` : INPUT_UNAVAILABLE)],
                ["Covarianza", metadataPresence(inputMetadataSources, ["covariance", "covariances"])],
                ["Maniobras", metadataPresence(inputMetadataSources, ["maneuvers", "maneuver_data", "maneuverData"])],
                ["Metadatos", "Disponibles en el encabezado OEM"]
            ];
        }
        if (sourceFormat === "SP3") {
            return [
                ["Tipo de entrada", "SP3"],
                ["Proveedor", metadataValue(inputMetadataSources, ["provider", "agency", "orbitType", "orbit_type"], INPUT_UNAVAILABLE)],
                ["Época", inputEpoch],
                ["Marco declarado", metadataValue(inputMetadataSources, ["referenceFrame", "reference_frame", "frame", "coordSystem", "coordinate_system"], INPUT_UNAVAILABLE)],
                ["Sistema de tiempo", metadataValue(inputMetadataSources, ["timeSystem", "time_system", "timeScale", "time_scale"], INPUT_UNAVAILABLE)],
                ["Efeméride precisa", metadataPresence(inputMetadataSources, ["states", "samples", "preciseEphemeris", "precise_ephemeris"])],
                ["Correcciones de reloj", metadataPresence(inputMetadataSources, ["clockCorrections", "clock_corrections", "clocks"])],
                ["RMS", metadataPresence(inputMetadataSources, ["rms", "accuracy", "standardDeviation", "standard_deviation"])],
                ["Estado", "Formato preparado; aún no conectado al runtime"]
            ];
        }
        return [
            ["Tipo de entrada", inputType],
            ["Época", inputEpoch],
            ["Marco declarado", metadataValue(inputMetadataSources, ["referenceFrame", "reference_frame", "frame"], INPUT_UNAVAILABLE)],
            ["Metadatos de entrada", metadataPresence(inputMetadataSources, ["input", "metadata", "sourceMetadata", "source_metadata"])]];
    })();
    const dynamicsFrame = manual
        ? "EME2000"
        : (sourceFormat === "TLE" || sourceFormat === "OMM")
            ? "TEME"
            : sourceFormat === "OEM"
                ? value(oemMetadata.ref_frame, INPUT_UNAVAILABLE)
                : metadataValue(inputMetadataSources, ["dynamicsFrame", "dynamics_frame", "referenceFrame", "reference_frame", "frame"], INPUT_UNAVAILABLE);
    const propagationEngine = manual
        ? manualPropagationEngineLabel(manualOrbit.propagator)
        : sourceFormat === "TLE" ? "SGP4"
            : sourceFormat === "OMM" ? "SGP4 (OMM/TLE compatible)"
                : sourceFormat === "OEM" ? "Reproducción de efemérides OEM"
                    : sourceFormat === "SP3" ? "Reproducción de efemérides precisas"
                        : "No declarado";
    const numericalIntegrator = manualUsesCowell
        ? value(manualNumericalIntegrator, "RK4").toUpperCase()
        : manualUsesLegacyForcePreset ? "RK4 de paso fijo"
            : manual ? "Solución analítica"
                : (sourceFormat === "TLE" || sourceFormat === "OMM") ? "Modelo analítico SGP4"
                    : (sourceFormat === "OEM" || sourceFormat === "SP3") ? "Interpolación de efemérides" : INPUT_UNAVAILABLE;
    const forceModel = manual
        ? manualForceTermsLabel(manualForceTerms)
        : (sourceFormat === "TLE" || sourceFormat === "OMM") ? "Modelo NORAD fijo (SGP4)"
            : (sourceFormat === "OEM" || sourceFormat === "SP3") ? "Contenido en la efeméride de entrada"
                : INPUT_UNAVAILABLE;
    const propagationRows = [
        ["Motor", propagationEngine],
        ["Integrador", numericalIntegrator],
        ["Modelo de fuerzas", forceModel],
        ...manualDragRows,
        ["Marco de integración", dynamicsFrame],
        ["Marco de salida", stateFrame || INPUT_UNAVAILABLE],
        ["Marco mostrado", stateFrame || INPUT_UNAVAILABLE],
        ["Modo temporal", simulationMode(simulation.mode)],
        ["Escala temporal", hasNumber(simulation.time_scale) ? `${number(simulation.time_scale, 0)}×` : "-"],
        ["Reproducción", simulation.is_playing === true ? "En marcha" : simulation.is_playing === false ? "Pausada" : "-"]
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

/**
 * Present one stable, source-neutral inspector contract.  The legacy builder
 * above still performs the compatibility parsing used by older workspaces;
 * this projection deliberately separates administrative identity, current
 * state, live telemetry, source input and propagation configuration.
 */
export function buildObjectDetails(detail) {
    const legacy = buildLegacyObjectDetails(detail);
    const telemetry = detail.telemetry || {};
    const geo = telemetry.geo || {};
    const catalogMeta = detail.catalogMeta || {};
    const tleSummary = detail.tleSummary || detail.summary || {};
    const orbit = detail.orbitInfo || {};
    const sourceFormat = String(detail.sourceFormat || telemetry.source_format || catalogMeta.sourceFormat || "TLE").toUpperCase();
    const manual = sourceFormat === "MANUAL";
    const celestial = sourceFormat === "CELESTIAL"
        || ["CELESTIAL_BODY", "EARTH"].includes(String(detail.layerType || "").toUpperCase())
        || String(detail.id || "").toLowerCase() === "body:earth";
    const visible = detail.visible !== false;
    const manualOrbit = catalogMeta.manualOrbit || catalogMeta.manual_orbit || telemetry.manual_orbit || {};
    const manualObjectMetadata = manualOrbit.objectMetadata || manualOrbit.object_metadata || {};
    const inputMetadata = catalogMeta.inputMetadata
        || catalogMeta.input_metadata
        || catalogMeta.sourceMetadata
        || catalogMeta.source_metadata
        || telemetry.inputMetadata
        || telemetry.input_metadata
        || {};
    const metadataSources = [manualObjectMetadata, inputMetadata, catalogMeta, telemetry];
    const title = legacy.title || metadataValue(metadataSources, ["name", "catalogName", "objectName", "object_name"], value(detail.id));
    const noradId = detail.noradId || telemetry.norad_id || telemetry.norad || telemetry.catalog_number || tleSummary.noradId || tleSummary.norad_id || "-";
    const cosparId = metadataValue(
        [manualObjectMetadata, inputMetadata, catalogMeta, tleSummary],
        ["objectId", "object_id", "internationalDesignator", "international_designator"],
        "-"
    );
    const inputType = celestial ? "Modelo de referencia" : sourceInputLabel(sourceFormat, { manual });
    const oem = telemetry.oem || catalogMeta.oem || {};
    const inputEpoch = celestial ? "-" : inputEpochText(sourceFormat, tleSummary, oem, manualOrbit, metadataSources);
    const referenceTimeMs = detail.referenceTimeMs ?? telemetry.timestamp_ms;
    const inputAge = celestial ? "-" : inputAgeText(sourceFormat, tleSummary, referenceTimeMs, inputEpoch);
    const source = celestial
        ? "Cesium"
        : metadataValue(metadataSources, ["tleSource", "tle_source", "sourceProvider", "source_provider", "provider", "originator", "sourceOrigin", "source_origin"], INPUT_UNAVAILABLE);
    const status = detail.active === false ? "Inactive" : (visible ? "Operational" : "Hidden");
    const statusTone = status === "Operational" ? "is-operational" : (status === "Hidden" ? "is-hidden" : undefined);
    const declaredQuality = metadataValue(metadataSources, ["dataQuality", "data_quality", "quality", "precision", "accuracy"], "");
    const tleAge = tleAgeHours(tleSummary, referenceTimeMs);
    const tleFreshness = tleStatus(tleAge, orbit);
    const quality = celestial ? "Modelo de referencia"
        : declaredQuality || (sourceFormat === "SP3" ? "Alta precisión (SP3)"
            : sourceFormat === "OEM" ? "Según efeméride de entrada"
                : manual ? "Definición manual"
                    : tleFreshness === "Vigente" ? "Buena"
                        : tleFreshness === "Antiguo" || tleFreshness === "Caducado" ? "Pobre"
                            : INPUT_UNAVAILABLE);
    const positionVector = firstVector(telemetry.position, telemetry.position_ecef_m, telemetry.position_eci_m);
    const velocityVector = firstVector(telemetry.velocity, telemetry.velocity_ecef_m_s, telemetry.velocity_eci_m_s);
    const accelerationVector = telemetry.acceleration_ecef_m_s2 || telemetry.acceleration;
    const positionFrame = frameLabel(telemetry.position_frame || telemetry.reference_frame || telemetry.frame);
    const velocityFrame = frameLabel(telemetry.velocity_frame) || positionFrame;
    const stateFrame = positionFrame || velocityFrame;
    const earthFixed = /(?:ITRF|ECEF|PEF|TIRS)/i.test(stateFrame || "");
    const unavailableGeography = stateFrame
        ? `No aplicable: ${stateFrame} no es terrestre`
        : "Sin estado instantáneo";
    const simulation = telemetry.simulation || {};
    const legacyManualRows = Object.fromEntries(legacy.rows.manual || []);
    const manualStateVector = manualOrbit.stateVector || manualOrbit.state_vector || {};
    const manualStateFrame = frameLabel(
        manualStateVector.referenceFrame
        || manualStateVector.reference_frame
        || manualOrbit.referenceFrame
        || manualOrbit.reference_frame
    ) || "EME2000";
    const manualPosition = manualStateVector.positionEciKm || manualStateVector.position_eci_km || manualStateVector.position || {};
    const manualVelocity = manualStateVector.velocityEciKmS || manualStateVector.velocity_eci_km_s || manualStateVector.velocity || {};
    const manualKeplerian = manualOrbit.keplerian || {};
    const manualSummary = manualOrbit.summary || manualOrbit.orbitSummary || manualOrbit.orbit_summary || {};
    const manualOptions = manualOrbit.propagationOptions || manualOrbit.propagation_options || {};
    const manualPropagator = String(manualOrbit.propagator || "").trim().toLowerCase();
    const manualUsesCowell = manualPropagator === "cowell-rk4" || manualPropagator === "cowell";
    const manualLegacyPreset = manualPropagator === "j2" || manualPropagator === "j2-j3-j4";
    const rawForceTerms = manualOptions.forceTerms ?? manualOptions.force_terms;
    const manualForceTerms = resolveManualForceTerms(rawForceTerms, {
        legacyForceModel: manualOptions.cowellGravityModel ?? manualOptions.cowell_gravity_model ?? manualOptions.forceModel ?? manualOptions.force_model,
        legacyPropagator: manualPropagator,
        legacyCowellDefault: manualUsesCowell,
        atmosphericDrag: manualOptions.atmosphericDrag ?? manualOptions.atmospheric_drag
    });
    const manualPeriod = manualSummary.periodMinutes ?? manualSummary.period_minutes ?? (hasNumber(manualSummary.orbitalPeriodSeconds ?? manualSummary.orbital_period_seconds)
        ? Number(manualSummary.orbitalPeriodSeconds ?? manualSummary.orbital_period_seconds) / 60 : null);
    const orbitalPeriodMinutes = hasNumber(telemetry.orbital_period_seconds)
        ? Number(telemetry.orbital_period_seconds) / 60
        : manual ? manualPeriod : tlePeriodMinutes(tleSummary);
    const aos = telemetry.aos || telemetry.next_aos || telemetry.nextAos;
    const los = telemetry.los || telemetry.next_los || telemetry.nextLos;
    const aosLos = aos || los
        ? `${aos ? utcDate(aos) : "AOS -"} · ${los ? utcDate(los) : "LOS -"}`
        : "Sin estación seleccionada";
    const groundTrackState = telemetry.ground_track_enabled === true
        ? (telemetry.ground_track_visible === false ? "Configurado, oculto" : "Activo")
        : "Desactivado";

    const overviewRows = [
        ["Nombre", title],
        ["NORAD", celestial ? "-" : value(noradId)],
        ["COSPAR", celestial ? "-" : cosparId],
        ["Tipo de entrada", inputType],
        ["Época de entrada", inputEpoch],
        ["Fuente", source],
        ["Estado del objeto", status, statusTone],
        ["Fecha de lanzamiento", metadataDate(metadataSources, ["launchDate", "launch_date", "launchTimestamp", "launch_timestamp"])],
        ["Edad del dato", inputAge],
        ["Calidad del dato", quality],
        ["Tipo de objeto", metadataValue([manualObjectMetadata, catalogMeta, telemetry], ["objectType", "object_type"], celestial ? "Cuerpo de referencia" : "-")],
        ["Misión", metadataValue(metadataSources, ["missionType", "mission_type", "mission"])],
        ["Operador / agencia", metadataValue(metadataSources, ["operatorLabel", "operator", "agency", "ownerLabel", "owner"])],
        ["País", metadataValue(metadataSources, ["country", "countryCode", "country_code", "operatorCountry", "operator_country"])],
        ["Última actualización", metadataDate(metadataSources, ["tleUpdatedAt", "tle_updated_at", "updatedAt", "updated_at", "lastUpdated", "last_updated"])]
    ];
    const orbitRows = [
        ["Tipo de órbita", value(orbit.label)],
        ["Latitud", earthFixed ? numberWithUnit(geo.latitude_deg, "deg", 4) : unavailableGeography],
        ["Longitud", earthFixed ? numberWithUnit(geo.longitude_deg, "deg", 4) : unavailableGeography],
        ["Altitud", earthFixed ? convertedNumberWithUnit(geo.altitude_m, 1000, "km") : unavailableGeography],
        [stateFrame ? `Velocidad instantánea (${stateFrame})` : "Velocidad instantánea", numberWithUnit(telemetry.speed_m_s, "m/s")],
        ["Período orbital", numberWithUnit(orbitalPeriodMinutes, "min", 2)],
        ["Anomalía verdadera", numberWithUnit(telemetry.true_anomaly_deg ?? telemetry.trueAnomalyDeg, "deg", 3)],
        ["Argumento de latitud", numberWithUnit(telemetry.argument_of_latitude_deg ?? telemetry.argumentOfLatitudeDeg, "deg", 3)],
        ["Distancia al centro de la Tierra", convertedNumberWithUnit(telemetry.earth_center_distance_m, 1000, "km")],
        ["Marco de referencia", stateFrame || "-"],
        [stateFrame ? `Posición ${stateFrame}` : "Posición", vectorWithUnit(positionVector, "km", 1, 1000)],
        [(velocityFrame || stateFrame) ? `Velocidad ${velocityFrame || stateFrame}` : "Velocidad", vectorWithUnit(velocityVector, "m/s")],
        ["Distancia a estación", hasNumber(telemetry.station_distance_m) ? convertedNumberWithUnit(telemetry.station_distance_m, 1000, "km") : "Sin estación seleccionada"],
        ["AOS / LOS", aosLos],
        ["Ground track", groundTrackState],
        ["Radio de huella", telemetry.ground_track_enabled === true ? convertedNumberWithUnit(telemetry.footprint_radius_m, 1000, "km") : "No activo"]
    ];
    const telemetryRows = [
        ["Velocidad", numberWithUnit(telemetry.speed_km_h, "km/h")],
        ["Módulo de velocidad", numberWithUnit(telemetry.speed_m_s, "m/s")],
        ["Vector velocidad", vectorWithUnit(velocityVector, "m/s")],
        ["Aceleración", numberWithUnit(vectorMagnitude(accelerationVector), "m/s²", 3)],
        ["Vector aceleración", vectorWithUnit(accelerationVector, "m/s²", 3)],
        ["Doppler", numberWithUnit(telemetry.doppler_shift_hz, "Hz")],
        ["Retardo de señal", numberWithUnit(telemetry.signal_delay_ms, "ms")],
        ["Pérdida de trayecto", numberWithUnit(telemetry.path_loss_db, "dB")],
        ["Estado del satélite", value(telemetry.runtime_state)],
        ["Modo temporal", simulationMode(simulation.mode)],
        ["Escala temporal", hasNumber(simulation.time_scale) ? `${number(simulation.time_scale, 0)}×` : "-"],
        ["Edad de telemetría", numberWithUnit(telemetry.telemetry_age_ms, "ms", 0)]
    ];
    let inputRows;
    if (celestial) {
        inputRows = [["Tipo de entrada", "Modelo de referencia"], ["Fuente", "Cesium"]];
    } else if (manual || sourceFormat === "STATE_VECTOR" || sourceFormat === "STATE VECTOR") {
        inputRows = [
            ["Tipo de entrada", inputType],
            ["Definición", value(manualOrbit.definitionSource || manualOrbit.definition_source, INPUT_UNAVAILABLE)],
            ["Época", inputEpoch],
            ["Marco del vector de estado", manualStateFrame],
            [`r / Posición ${manualStateFrame}`, vectorWithUnit(manualPosition, "km", 3)],
            [`v / Velocidad ${manualStateFrame}`, vectorWithUnit(manualVelocity, "km/s", 5)],
            ["Interpretación kepleriana", hasNumber(manualKeplerian.semiMajorAxisKm ?? manualKeplerian.semi_major_axis_km) ? "Elementos osculantes" : INPUT_UNAVAILABLE],
            ["Semieje mayor", numberWithUnit(manualKeplerian.semiMajorAxisKm ?? manualKeplerian.semi_major_axis_km, "km", 3)],
            ["Excentricidad", number(manualKeplerian.eccentricity, 6)],
            ["Inclinación", numberWithUnit(manualKeplerian.inclinationDeg ?? manualKeplerian.inclination_deg, "deg", 4)],
            ["RAAN", numberWithUnit(manualKeplerian.raanDeg ?? manualKeplerian.raan_deg, "deg", 4)],
            ["Argumento de periapsis", numberWithUnit(manualKeplerian.argumentOfPeriapsisDeg ?? manualKeplerian.argument_of_periapsis_deg ?? manualKeplerian.argument_of_perigee_deg, "deg", 4)],
            ["Anomalía verdadera", numberWithUnit(manualKeplerian.trueAnomalyDeg ?? manualKeplerian.true_anomaly_deg, "deg", 4)],
            ["Perigeo", legacyManualRows.Perigee || numberWithUnit(manualSummary.perigeeAltitudeKm ?? manualSummary.perigee_altitude_km ?? manualSummary.perigeeKm ?? manualSummary.perigee_km, "km", 3)],
            ["Apogeo", legacyManualRows.Apogee || numberWithUnit(manualSummary.apogeeAltitudeKm ?? manualSummary.apogee_altitude_km ?? manualSummary.apogeeKm ?? manualSummary.apogee_km, "km", 3)]
        ];
    } else if (sourceFormat === "TLE") {
        inputRows = [["Tipo de entrada", "TLE"], ...tleInputRows(tleSummary)];
    } else if (sourceFormat === "OMM") {
        const embeddedTle = Boolean(tleSummary.line1 && tleSummary.line2);
        inputRows = [
            ["Tipo de entrada", "OMM"], ["Época", inputEpoch],
            ["Representación activa", embeddedTle ? "SGP4 con TLE derivado" : INPUT_UNAVAILABLE],
            ["Estado vector", metadataPresence(metadataSources, ["stateVector", "state_vector", "cartesianState", "cartesian_state"])],
            ["Covarianza", metadataPresence(metadataSources, ["covariance", "covarianceMatrix", "covariance_matrix"])],
            ["Maniobras", metadataPresence(metadataSources, ["maneuvers", "maneuver_data", "maneuverData"])],
            ["Modelo de arrastre", metadataPresence(metadataSources, ["dragModel", "drag_model"])],
            ["Modelo SRP", metadataPresence(metadataSources, ["solarRadiationPressureModel", "solar_radiation_pressure_model", "srpModel", "srp_model"])],
            ["Incertidumbres", metadataPresence(metadataSources, ["uncertainties", "uncertainty", "uncertainty_data"])],
            ["OMM original", "No persistido por el runtime actual"]
        ];
    } else if (sourceFormat === "OEM") {
        inputRows = [
            ["Tipo de entrada", "OEM"], ["Archivo", value(oem.file_name, INPUT_UNAVAILABLE)],
            ["Objeto", value(oem.object_name, title)], ["Object ID", value(oem.object_id, INPUT_UNAVAILABLE)],
            ["Centro", value(oem.center_name, INPUT_UNAVAILABLE)], ["Marco declarado", value(oem.ref_frame, INPUT_UNAVAILABLE)],
            ["Sistema de tiempo", value(oem.time_system, INPUT_UNAVAILABLE)],
            ["Inicio", utcDate(oem.start_time_ms || oem.start_time)], ["Fin", utcDate(oem.end_time_ms || oem.stop_time || oem.end_time)],
            ["Muestras", number(oem.samples, 0)],
            ["Vectores de estado", hasNumber(oem.samples) ? `${number(oem.samples, 0)} muestras` : metadataPresence(metadataSources, ["states", "state_vectors", "stateVectors"])],
            ["Covarianza", metadataPresence(metadataSources, ["covariance", "covariances"])],
            ["Maniobras", metadataPresence(metadataSources, ["maneuvers", "maneuver_data", "maneuverData"])]
        ];
    } else if (sourceFormat === "SP3") {
        inputRows = [
            ["Tipo de entrada", "SP3"],
            ["Proveedor", metadataValue(metadataSources, ["provider", "agency", "orbitType", "orbit_type"], INPUT_UNAVAILABLE)],
            ["Época", inputEpoch],
            ["Marco declarado", metadataValue(metadataSources, ["referenceFrame", "reference_frame", "frame", "coordSystem", "coordinate_system"], INPUT_UNAVAILABLE)],
            ["Sistema de tiempo", metadataValue(metadataSources, ["timeSystem", "time_system", "timeScale", "time_scale"], INPUT_UNAVAILABLE)],
            ["Efeméride precisa", metadataPresence(metadataSources, ["states", "samples", "preciseEphemeris", "precise_ephemeris"])],
            ["Correcciones de reloj", metadataPresence(metadataSources, ["clockCorrections", "clock_corrections", "clocks"])],
            ["RMS", metadataPresence(metadataSources, ["rms", "accuracy", "standardDeviation", "standard_deviation"])],
            ["Estado", "Formato preparado; aún no conectado al runtime"]
        ];
    } else {
        inputRows = [["Tipo de entrada", inputType], ["Época", inputEpoch], ["Metadatos", INPUT_UNAVAILABLE]];
    }
    const dynamicsFrame = manual ? "EME2000"
        : (sourceFormat === "TLE" || sourceFormat === "OMM") ? "TEME"
            : sourceFormat === "OEM" ? value(oem.ref_frame, INPUT_UNAVAILABLE)
                : metadataValue(metadataSources, ["dynamicsFrame", "dynamics_frame", "referenceFrame", "reference_frame", "frame"], INPUT_UNAVAILABLE);
    const propagationRows = celestial
        ? [["Motor", "No aplica"], ["Marco mostrado", stateFrame || "-"]]
        : [
            ["Motor", manual ? manualPropagationEngineLabel(manualOrbit.propagator)
                : sourceFormat === "TLE" ? "SGP4"
                    : sourceFormat === "OMM" ? "SGP4 (OMM/TLE compatible)"
                        : sourceFormat === "OEM" ? "Reproducción de efemérides OEM"
                            : sourceFormat === "SP3" ? "Reproducción de efemérides precisas" : "No declarado"],
            ["Integrador", manualUsesCowell ? value(manualOptions.numericalIntegrator ?? manualOptions.numerical_integrator, "RK4").toUpperCase()
                : manualLegacyPreset ? "RK4 de paso fijo"
                    : manual ? "Solución analítica"
                        : (sourceFormat === "TLE" || sourceFormat === "OMM") ? "Modelo analítico SGP4"
                            : (sourceFormat === "OEM" || sourceFormat === "SP3") ? "Interpolación de efemérides" : INPUT_UNAVAILABLE],
            ["Modelo de fuerzas", manual ? manualForceTermsLabel(manualForceTerms)
                : (sourceFormat === "TLE" || sourceFormat === "OMM") ? "Modelo NORAD fijo (SGP4)"
                    : (sourceFormat === "OEM" || sourceFormat === "SP3") ? "Contenido en la efeméride de entrada" : INPUT_UNAVAILABLE],
            ...(manualUsesCowell ? [["Arrastre atmosférico", onOff(manualForceTerms.includes("drag"))]] : []),
            ["Marco de integración", dynamicsFrame],
            ["Marco de salida", stateFrame || INPUT_UNAVAILABLE],
            ["Marco mostrado", stateFrame || INPUT_UNAVAILABLE],
            ["Modo temporal", simulationMode(simulation.mode)],
            ["Escala temporal", hasNumber(simulation.time_scale) ? `${number(simulation.time_scale, 0)}×` : "-"]
        ];
    return {
        title,
        noradId: celestial ? "-" : value(noradId),
        visible,
        rows: {
            overview: overviewRows,
            orbit: orbitRows,
            telemetry: telemetryRows,
            input: inputRows,
            propagation: propagationRows
        }
    };
}
