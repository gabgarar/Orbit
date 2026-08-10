import { tleEpochAgeMs, tleEpochToDate } from "../../../../front/js/features/objectDetails/tleEpoch.js";
import { formatReferenceFrame } from "../../../../front/js/features/frames/referenceFrame.js";
import { resolvePreciseProductFrameStatus } from "../../../../front/js/features/preciseProducts/frameStatus.js";

const number = (input, digits = 1) => input !== null && input !== undefined && input !== "" && Number.isFinite(Number(input)) ? Number(input).toFixed(digits) : "-";
const value = (input, fallback = "-") => input === undefined || input === null || input === "" ? fallback : String(input);
const utcDate = (input) => {
    if (!input) return "-";
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? "-" : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
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
    if (typeof input === "string") return formatReferenceFrame(input) || null;
    if (!input || typeof input !== "object") return null;
    const name = String(input.name || input.frame || "").trim();
    const realization = String(input.realization || "").trim();
    if (!name) return formatReferenceFrame(realization) || null;
    const label = realization && realization !== name ? `${name} / ${realization}` : name;
    return formatReferenceFrame(label) || null;
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

function preciseRenderingStatus(status) {
    return status?.renderingLabel || INPUT_UNAVAILABLE;
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

/**
 * Present one stable, source-neutral inspector contract. This projection
 * separates administrative identity, current
 * state, live telemetry, source input and propagation configuration.
 */
export function buildObjectDetails(detail) {
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
        || telemetry.sp3
        || {};
    const metadataSources = [manualObjectMetadata, inputMetadata, catalogMeta, telemetry];
    const preciseFrameStatus = sourceFormat === "SP3"
        ? resolvePreciseProductFrameStatus({
            ...catalogMeta,
            inputMetadata,
            sp3: telemetry.sp3 || inputMetadata,
            renderer_reference: telemetry.renderer_reference || telemetry.rendererReference || null,
            earth_orientation: telemetry.earth_orientation || telemetry.earthOrientation || null
        }, {
            runtimeFrame: telemetry.position_frame
                || telemetry.reference_frame
                || telemetry.frame
                || ""
        })
        : null;
    const preciseRenderingUnavailable = preciseFrameStatus?.available === false;
    // Keep the legacy metadata precedence for existing workspaces. Input
    // metadata remains available in its dedicated tab, but must not rename an
    // already identified catalogue or manually authored object.
    const title = metadataValue(
        [manualObjectMetadata, catalogMeta, telemetry],
        ["name", "catalogName", "objectName", "object_name", "satelliteName"],
        value(telemetry.id, detail.id)
    );
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
    const displayStateFrame = preciseFrameStatus
        ? (frameLabel(telemetry.position_frame_display) || preciseFrameStatus.displayFrame || stateFrame)
        : stateFrame;
    const earthFixed = !preciseRenderingUnavailable && /(?:ITRF|ECEF|PEF|TIRS)/i.test(stateFrame || "");
    const unavailableGeography = preciseRenderingUnavailable
        ? `No disponible: ${preciseRenderingStatus(preciseFrameStatus)}`
        : stateFrame
        ? `No aplicable: ${stateFrame} no es terrestre`
        : "Sin estado instantáneo";
    const simulation = telemetry.simulation || {};
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
    // Manual payloads have used both altitude and short aliases. Keep those
    // aliases explicit so perigee and apogee can never be conflated.
    const manualPerigeeAltitudeKm = manualSummary.perigeeAltitudeKm
        ?? manualSummary.perigee_altitude_km
        ?? manualSummary.perigeeKm
        ?? manualSummary.perigee_km;
    const manualApogeeAltitudeKm = manualSummary.apogeeAltitudeKm
        ?? manualSummary.apogee_altitude_km
        ?? manualSummary.apogeeKm
        ?? manualSummary.apogee_km;
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
        [displayStateFrame ? `Velocidad instantánea (${displayStateFrame})` : "Velocidad instantánea", preciseRenderingUnavailable ? unavailableGeography : numberWithUnit(telemetry.speed_m_s, "m/s")],
        ["Período orbital", numberWithUnit(orbitalPeriodMinutes, "min", 2)],
        ["Anomalía verdadera", numberWithUnit(telemetry.true_anomaly_deg ?? telemetry.trueAnomalyDeg, "deg", 3)],
        ["Argumento de latitud", numberWithUnit(telemetry.argument_of_latitude_deg ?? telemetry.argumentOfLatitudeDeg, "deg", 3)],
        ["Distancia al centro de la Tierra", convertedNumberWithUnit(telemetry.earth_center_distance_m, 1000, "km")],
        ["Marco de referencia", displayStateFrame || "-"],
        [preciseRenderingUnavailable ? "Estado cartesiano" : (displayStateFrame ? `Posición ${displayStateFrame}` : "Posición"), preciseRenderingUnavailable ? unavailableGeography : vectorWithUnit(positionVector, "km", 1, 1000)],
        [preciseRenderingUnavailable ? "Velocidad cartesiana" : ((displayStateFrame || velocityFrame || stateFrame) ? `Velocidad ${displayStateFrame || velocityFrame || stateFrame}` : "Velocidad"), preciseRenderingUnavailable ? unavailableGeography : vectorWithUnit(velocityVector, "m/s")],
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
    if (preciseFrameStatus) {
        telemetryRows.push(
            ["Marco del estado", displayStateFrame || preciseFrameStatus.nativeFrame],
            ["Estado de representación", preciseRenderingStatus(preciseFrameStatus)]
        );
    }
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
            ["Perigeo", numberWithUnit(manualPerigeeAltitudeKm, "km", 3)],
            ["Apogeo", numberWithUnit(manualApogeeAltitudeKm, "km", 3)]
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
            ["Clase de producto", metadataValue(metadataSources, ["productClass", "product_class", "quality", "dataQuality", "data_quality"], INPUT_UNAVAILABLE)],
            ["Producto", metadataValue(metadataSources, ["productId", "product_id", "productName", "product_name"], INPUT_UNAVAILABLE)],
            ["Archivo SP3", metadataValue(metadataSources, ["fileName", "file_name", "orbitFile", "orbit_file", "sp3_file"], INPUT_UNAVAILABLE)],
            ["Archivo CLK", metadataValue(metadataSources, ["clockFile", "clock_file", "clk_file"], "No incluido")],
            ["Época", inputEpoch],
            ["Inicio de cobertura", utcDate(metadataValue(metadataSources, ["startTimeMs", "start_time_ms", "startTime", "start_time", "coverageStart", "coverage_start"], ""))],
            ["Fin de cobertura", utcDate(metadataValue(metadataSources, ["endTimeMs", "end_time_ms", "endTime", "end_time", "coverageEnd", "coverage_end", "stop_time"], ""))],
            ["Marco nativo", preciseFrameStatus?.nativeFrame || metadataValue(metadataSources, ["nativeReferenceFrame", "native_reference_frame", "referenceFrame", "reference_frame", "frame", "coordSystem", "coordinate_system"], INPUT_UNAVAILABLE)],
            ["Sistema de tiempo", metadataValue(metadataSources, ["timeSystem", "time_system", "timeScale", "time_scale"], INPUT_UNAVAILABLE)],
            ["Marco de representación", preciseFrameStatus?.displayFrame || INPUT_UNAVAILABLE],
            ["Estado de representación", preciseRenderingStatus(preciseFrameStatus)],
            ["Operación de realización", preciseFrameStatus?.operation || "No aplicada"],
            ["Efeméride precisa", metadataPresence(metadataSources, ["states", "samples", "preciseEphemeris", "precise_ephemeris"])],
            ["Correcciones de reloj", metadataPresence(metadataSources, ["clockCorrections", "clock_corrections", "clocks"])],
            ["RMS", metadataPresence(metadataSources, ["rms", "accuracy", "standardDeviation", "standard_deviation"])],
            ["Estado", "Registrado en el runtime de efemérides precisas"]
        ];
    } else {
        inputRows = [["Tipo de entrada", inputType], ["Época", inputEpoch], ["Metadatos", INPUT_UNAVAILABLE]];
    }
    const dynamicsFrame = manual ? "EME2000"
        : (sourceFormat === "TLE" || sourceFormat === "OMM") ? "TEME"
            : sourceFormat === "OEM" ? value(oem.ref_frame, INPUT_UNAVAILABLE)
                : sourceFormat === "SP3" ? (preciseFrameStatus?.nativeFrame || INPUT_UNAVAILABLE)
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
            ["Marco de salida", preciseFrameStatus ? (preciseFrameStatus.available === false ? INPUT_UNAVAILABLE : (displayStateFrame || preciseFrameStatus.displayFrame)) : (stateFrame || INPUT_UNAVAILABLE)],
            ["Marco mostrado", preciseFrameStatus ? (displayStateFrame || preciseFrameStatus.displayFrame) : (stateFrame || INPUT_UNAVAILABLE)],
            ...(preciseFrameStatus ? [["Estado de representación", preciseRenderingStatus(preciseFrameStatus)]] : []),
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
