/**
 * Deterministic RF engineering helpers for a ground station.
 *
 * The module is deliberately independent from Cesium and the HTTP client.
 * It is the single source of truth for the station designer, coverage
 * presentation, live telemetry and AOS/LOS range gate.  A station by itself
 * cannot describe a real satellite link: a satellite EIRP/polarisation and a
 * receive bandwidth are still required for an actual SNR.  The model therefore
 * exposes a clearly labelled reciprocal design envelope for planning, and only
 * produces a satellite-link SNR when the remote terminal provides RF metadata.
 */

export const SPEED_OF_LIGHT_M_S = 299_792_458;
export const EARTH_MEAN_RADIUS_KM = 6_371.0088;
// The renderer deliberately caps large lobes, but a renderer limit must
// never change an access calculation. This is a generous operational guard
// against pathological user inputs; it is still far beyond Earth-orbit use.
export const MAX_RF_OPERATIONAL_RANGE_KM = 1_000_000;
export const MAX_RF_VISUAL_RANGE_KM = 40_000;

export const RF_DEFAULTS = Object.freeze({
    antenna_diameter_m: 1.2,
    antenna_efficiency: 0.6,
    frequency_mhz: 2200,
    polarization: "RHCP",
    polarization_tilt_deg: 0,
    tx_power_dbm: 38,
    tx_gain_mode: "derived",
    rx_gain_mode: "derived",
    min_link_power_dbm: -80,
    min_elevation_deg: 10,
    pattern_type: "gaussian",
    side_lobe_level_db: 25,
    system_temperature_k: 500,
    atmospheric_loss_db: 0.5,
    rain_loss_db: 0,
    cable_loss_db: 1,
    connector_loss_db: 0.5,
    pointing_rms_mdeg: 50,
    receiver_bandwidth_hz: 25_000,
    required_snr_db: 0,
    operation_mode: "tracking",
    boresight_azimuth_deg: 0,
    boresight_elevation_deg: 90,
    mechanical_elevation_min_deg: 0,
    mechanical_elevation_max_deg: 90,
    mechanical_azimuth_min_deg: -180,
    mechanical_azimuth_max_deg: 180,
    coverage_visible: true
});

const VALID_POLARIZATIONS = new Set(["RHCP", "LHCP", "LINEAR"]);
const VALID_PATTERN_TYPES = new Set(["gaussian", "cosine"]);
const VALID_OPERATION_MODES = new Set(["tracking", "scan", "stationary"]);
const VALID_GAIN_MODES = new Set(["derived", "override"]);

function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function finiteOptional(value) {
    if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

function normalizedChoice(value, allowed, fallback) {
    const candidate = String(value || "").trim().toLowerCase();
    return allowed.has(candidate) ? candidate : fallback;
}

function normalizedPolarization(value) {
    const candidate = String(value || "").trim().toUpperCase();
    return VALID_POLARIZATIONS.has(candidate) ? candidate : RF_DEFAULTS.polarization;
}

function normalizeAzimuth(value) {
    const azimuth = finiteNumber(value, 0);
    return ((azimuth + 180) % 360 + 360) % 360 - 180;
}

// Keep +180 as an authored mechanical end stop. Normalizing it to -180 is
// mathematically equivalent, but makes a full -180…180 mount look like a
// zero-width interval when it is shown back in the station editor.
function normalizeAzimuthLimit(value, fallback) {
    const raw = finiteNumber(value, fallback);
    const normalized = normalizeAzimuth(raw);
    return Math.abs(normalized + 180) < 1e-9 && raw > 0 ? 180 : normalized;
}

function localHorizonDirection(azimuthDeg, elevationDeg) {
    const azimuth = finiteNumber(azimuthDeg, 0) * Math.PI / 180;
    const elevation = finiteNumber(elevationDeg, 0) * Math.PI / 180;
    const horizontal = Math.cos(elevation);
    return [
        horizontal * Math.sin(azimuth),
        horizontal * Math.cos(azimuth),
        Math.sin(elevation)
    ];
}

function dotDirection(left, right) {
    return (left[0] * right[0]) + (left[1] * right[1]) + (left[2] * right[2]);
}

function isAzimuthWithinBounds(azimuthDeg, minimumDeg, maximumDeg) {
    const azimuth = normalizeAzimuth(azimuthDeg);
    const minimum = normalizeAzimuth(minimumDeg);
    const maximum = normalizeAzimuth(maximumDeg);
    // Equal bounds describe a full mechanical rotation, a useful default for
    // an azimuth mount. A wrapped interval (for example 150 to -150) is valid.
    if (Math.abs(minimum - maximum) < 1e-9) return true;
    return minimum <= maximum
        ? azimuth >= minimum && azimuth <= maximum
        : azimuth >= minimum || azimuth <= maximum;
}

function mechanicalAzimuthSweep(minimumDeg, maximumDeg) {
    const authoredMinimum = finiteNumber(minimumDeg, -180);
    const authoredMaximum = finiteNumber(maximumDeg, 180);
    const startDeg = normalizeAzimuth(authoredMinimum);
    const rawSpanDeg = Math.abs(authoredMaximum - authoredMinimum);
    if (rawSpanDeg < 1e-9 || rawSpanDeg >= 359.999) {
        return { start_deg: startDeg, span_deg: 360, full: true };
    }
    return {
        start_deg: startDeg,
        span_deg: (normalizeAzimuth(authoredMaximum) - startDeg + 360) % 360,
        full: false
    };
}

/** Convert a power expressed in dBm to Watts. */
export function dbmToWatts(dbm) {
    const value = finiteOptional(dbm);
    return value === null ? null : 10 ** ((value - 30) / 10);
}

/** Convert a power expressed in Watts to dBm. */
export function wattsToDbm(watts) {
    const value = finiteOptional(watts);
    return value === null || value <= 0 ? null : 10 * Math.log10(value * 1000);
}

/**
 * Peak gain of a circular aperture: eta * (pi D / lambda)^2.
 * Returned in dBi, with D in metres and frequency in MHz.
 */
export function calculateDishGainDbi(diameterM, efficiency, frequencyMhz) {
    const diameter = finiteOptional(diameterM);
    const eta = finiteOptional(efficiency);
    const frequencyHz = finiteOptional(frequencyMhz) * 1e6;
    if (diameter === null || eta === null || frequencyHz === null || diameter <= 0 || eta <= 0 || frequencyHz <= 0) {
        return null;
    }
    const wavelengthM = SPEED_OF_LIGHT_M_S / frequencyHz;
    return 10 * Math.log10(eta * ((Math.PI * diameter / wavelengthM) ** 2));
}

/** Approximate circular-aperture half-power beamwidth, in degrees. */
export function calculateDishHpbwDeg(diameterM, frequencyMhz) {
    const diameter = finiteOptional(diameterM);
    const frequencyHz = finiteOptional(frequencyMhz) * 1e6;
    if (diameter === null || frequencyHz === null || diameter <= 0 || frequencyHz <= 0) return null;
    const wavelengthM = SPEED_OF_LIGHT_M_S / frequencyHz;
    // 70 lambda/D is the usual practical HPBW approximation for a dish.
    return clamp(70 * wavelengthM / diameter, 0.05, 180);
}

/** Free-space path loss in dB, f in MHz and range in km. */
export function calculateFreeSpacePathLossDb(frequencyMhz, rangeKm) {
    const frequency = finiteOptional(frequencyMhz);
    const range = finiteOptional(rangeKm);
    if (frequency === null || range === null || frequency <= 0 || range <= 0) return null;
    return 32.44 + (20 * Math.log10(frequency)) + (20 * Math.log10(range));
}

/** Thermal noise floor kTB, expressed in dBm. */
export function calculateThermalNoiseFloorDbm(systemTemperatureK, bandwidthHz) {
    const temperature = finiteOptional(systemTemperatureK);
    const bandwidth = finiteOptional(bandwidthHz);
    if (temperature === null || bandwidth === null || temperature <= 0 || bandwidth <= 0) return null;
    // k = -228.6 dBW/K/Hz, transformed to dBm.
    return -198.6 + (10 * Math.log10(temperature)) + (10 * Math.log10(bandwidth));
}

/**
 * Compute the loss produced by a polarisation mismatch. Values are deliberately
 * conservative where a circular pair has opposite handedness. An unknown
 * polarisation must be passed as null by callers that do not want a claim.
 */
export function calculatePolarizationMismatchLossDb(transmitPolarization, receivePolarization, transmitTiltDeg = 0, receiveTiltDeg = 0) {
    const tx = String(transmitPolarization || "").trim().toUpperCase();
    const rx = String(receivePolarization || "").trim().toUpperCase();
    if (!tx || !rx || tx === rx) {
        if (tx !== "LINEAR" || rx !== "LINEAR") return 0;
        const alignment = Math.abs(Math.cos((finiteNumber(transmitTiltDeg, 0) - finiteNumber(receiveTiltDeg, 0)) * Math.PI / 180));
        return alignment <= 1e-6 ? 60 : Math.min(60, -20 * Math.log10(alignment));
    }
    if ((tx === "RHCP" && rx === "LHCP") || (tx === "LHCP" && rx === "RHCP")) return 60;
    if (tx === "LINEAR" || rx === "LINEAR") return 3;
    return 0;
}

/**
 * Gaussian or cosine^n gain pattern at an azimuth/elevation offset. HPBW is
 * the full half-power beamwidth, so a one-dimensional offset of HPBW/2 gives
 * -3 dB. Side lobes are represented by a conservative floor, not by invented
 * lobe positions.
 */
export function calculatePatternGainDbi({
    peakGainDbi,
    patternType = RF_DEFAULTS.pattern_type,
    hpbwAzimuthDeg,
    hpbwElevationDeg,
    sideLobeLevelDb = RF_DEFAULTS.side_lobe_level_db,
    azimuthOffsetDeg = 0,
    elevationOffsetDeg = 0
} = {}) {
    const peak = finiteOptional(peakGainDbi);
    const hpbwAzimuth = finiteOptional(hpbwAzimuthDeg);
    const hpbwElevation = finiteOptional(hpbwElevationDeg);
    if (peak === null || hpbwAzimuth === null || hpbwElevation === null || hpbwAzimuth <= 0 || hpbwElevation <= 0) return null;
    const normalizedOffset = Math.hypot(
        finiteNumber(azimuthOffsetDeg, 0) / (hpbwAzimuth / 2),
        finiteNumber(elevationOffsetDeg, 0) / (hpbwElevation / 2)
    );
    const type = normalizedChoice(patternType, VALID_PATTERN_TYPES, RF_DEFAULTS.pattern_type);
    let mainLobeLossDb;
    if (type === "cosine") {
        const equivalentHalfPowerDeg = Math.sqrt(hpbwAzimuth * hpbwElevation) / 2;
        const cosineAtHalfPower = Math.cos(equivalentHalfPowerDeg * Math.PI / 180);
        const exponent = cosineAtHalfPower > 0 ? Math.log(0.5) / Math.log(cosineAtHalfPower) : 1;
        const angleDeg = normalizedOffset * equivalentHalfPowerDeg;
        const cosine = Math.max(0, Math.cos(angleDeg * Math.PI / 180));
        mainLobeLossDb = cosine > 0 ? 10 * Math.log10(cosine ** exponent) : -Infinity;
    } else {
        mainLobeLossDb = -3 * (normalizedOffset ** 2);
    }
    const sideLobeFloorDb = -Math.max(0, finiteNumber(sideLobeLevelDb, RF_DEFAULTS.side_lobe_level_db));
    return peak + Math.max(mainLobeLossDb, sideLobeFloorDb);
}

/** Gaussian RMS pointing loss at boresight. */
export function calculatePointingLossDb(pointingRmsMillideg, hpbwAzimuthDeg, hpbwElevationDeg) {
    const pointingDeg = finiteOptional(pointingRmsMillideg);
    const hpbwAzimuth = finiteOptional(hpbwAzimuthDeg);
    const hpbwElevation = finiteOptional(hpbwElevationDeg);
    if (pointingDeg === null || hpbwAzimuth === null || hpbwElevation === null || hpbwAzimuth <= 0 || hpbwElevation <= 0) return null;
    const representativeHpbwDeg = Math.sqrt(hpbwAzimuth * hpbwElevation);
    return Math.max(0, 3 * ((pointingDeg / 1000) / (representativeHpbwDeg / 2)) ** 2);
}

/** WGS-84-independent first-order ground footprint from a slant range. */
export function calculateGroundFootprintRadiusKm(rangeKm, elevationMaskDeg = 0, earthRadiusKm = EARTH_MEAN_RADIUS_KM) {
    const range = finiteOptional(rangeKm);
    const elevation = finiteOptional(elevationMaskDeg);
    const radius = finiteOptional(earthRadiusKm);
    if (range === null || elevation === null || radius === null || range <= 0 || radius <= 0) return null;
    const elevationRadians = clamp(elevation, 0, 90) * Math.PI / 180;
    const centralAngle = Math.atan2(range * Math.cos(elevationRadians), radius + (range * Math.sin(elevationRadians)));
    return radius * Math.max(0, centralAngle);
}

/**
 * Sample the 2D ground projection of an RF field of regard without Cesium.
 *
 * It is a scene projection, not a substitute for line-of-sight visibility:
 * each point is generated from the direction-dependent operational range at
 * the lower/upper reachable elevation. Restricted mounts produce a sector;
 * a finite elevation ceiling produces an annular sector. The browser can turn
 * these samples into a geodesic polygon while the API keeps using ITRF sight
 * geometry for actual AOS/LOS.
 */
export function sampleStationGroundFootprint(station, { azimuthSamples = 72, maxRangeKm = null } = {}) {
    const model = calculateStationRfModel(station);
    const baseRangeKm = finiteOptional(maxRangeKm) ?? model.visual_range_km;
    const minElevationDeg = Math.max(model.min_elevation_deg, model.mechanical_elevation_min_deg);
    const maxElevationDeg = model.mechanical_elevation_max_deg;
    if (baseRangeKm === null || baseRangeKm <= 0 || maxElevationDeg <= minElevationDeg) {
        return { model, valid: false, reason: "range-or-elevation-envelope-unavailable", samples: [] };
    }
    const sweep = mechanicalAzimuthSweep(model.mechanical_azimuth_min_deg, model.mechanical_azimuth_max_deg);
    const requestedAzimuths = Math.max(12, Math.min(144, Math.floor(finiteNumber(azimuthSamples, 72))));
    const count = sweep.full
        ? requestedAzimuths
        : Math.max(2, Math.round((requestedAzimuths * sweep.span_deg) / 360) + 1);
    const samples = [];
    for (let index = 0; index < count; index += 1) {
        const fraction = sweep.full ? index / count : index / (count - 1);
        const azimuthDeg = normalizeAzimuth(sweep.start_deg + (sweep.span_deg * fraction));
        const rangeForElevation = (elevationDeg) => {
            if (model.operation_mode !== "stationary") return baseRangeKm;
            const offsets = calculateDirectionalPatternOffsetsDeg(
                azimuthDeg,
                elevationDeg,
                model.boresight_azimuth_deg,
                model.boresight_elevation_deg
            );
            const gainDbi = calculatePatternGainDbi({
                peakGainDbi: model.tx_effective_gain_dbi,
                patternType: model.pattern_type,
                hpbwAzimuthDeg: model.hpbw_azimuth_deg,
                hpbwElevationDeg: model.hpbw_elevation_deg,
                sideLobeLevelDb: model.side_lobe_level_db,
                azimuthOffsetDeg: offsets.azimuth_offset_deg,
                elevationOffsetDeg: offsets.elevation_offset_deg
            });
            const rangeRatio = gainDbi === null || model.tx_effective_gain_dbi === null
                ? 0
                : Math.max(0, 10 ** ((gainDbi - model.tx_effective_gain_dbi) / 20));
            return baseRangeKm * rangeRatio;
        };
        const lowRangeKm = rangeForElevation(minElevationDeg);
        const highRangeKm = rangeForElevation(maxElevationDeg);
        const lowRadiusKm = calculateGroundFootprintRadiusKm(lowRangeKm, minElevationDeg) ?? 0;
        const highRadiusKm = maxElevationDeg >= 89.999
            ? 0
            : calculateGroundFootprintRadiusKm(highRangeKm, maxElevationDeg) ?? 0;
        samples.push({
            azimuth_deg: azimuthDeg,
            outer_radius_km: Math.max(lowRadiusKm, highRadiusKm),
            inner_radius_km: Math.min(lowRadiusKm, highRadiusKm),
            range_at_min_elevation_km: lowRangeKm,
            range_at_max_elevation_km: highRangeKm
        });
    }
    return {
        model,
        valid: true,
        kind: maxElevationDeg >= 89.999 ? "sector" : "annular-sector",
        azimuth_start_deg: sweep.start_deg,
        azimuth_span_deg: sweep.span_deg,
        min_elevation_deg: minElevationDeg,
        max_elevation_deg: maxElevationDeg,
        samples
    };
}

/** Determine whether an azimuth/elevation pair can be mechanically reached. */
export function isMechanicallyReachable(station, azimuthDeg, elevationDeg) {
    const config = normalizeGroundStationRf(station);
    const elevation = finiteOptional(elevationDeg);
    if (elevation === null) return false;
    // Azimuth is a display coordinate, not a physical direction at the
    // zenith. Do not reject a zenith target because atan2 happened to report
    // an azimuth that falls outside a restricted mount interval.
    const azimuthIsDefined = Math.abs(Math.cos(elevation * Math.PI / 180)) > 1e-10;
    return elevation >= config.mechanical_elevation_min_deg
        && elevation <= config.mechanical_elevation_max_deg
        && (!azimuthIsDefined || isAzimuthWithinBounds(azimuthDeg, config.mechanical_azimuth_min_deg, config.mechanical_azimuth_max_deg));
}

/**
 * Resolve a target direction in the tangent basis of a boresight.
 *
 * A raw ``target azimuth - boresight azimuth`` is not a physical angular
 * error at the zenith: azimuth is undefined there. Projecting both local
 * horizon vectors onto the boresight tangent plane keeps an exactly zenith
 * target at zero error for every authored azimuth while retaining separate
 * azimuth/elevation widths for an elliptical pattern.
 */
export function calculateDirectionalPatternOffsetsDeg(
    targetAzimuthDeg,
    targetElevationDeg,
    boresightAzimuthDeg,
    boresightElevationDeg
) {
    const target = localHorizonDirection(targetAzimuthDeg, targetElevationDeg);
    const boresight = localHorizonDirection(boresightAzimuthDeg, boresightElevationDeg);
    const azimuth = finiteNumber(boresightAzimuthDeg, 0) * Math.PI / 180;
    const elevation = finiteNumber(boresightElevationDeg, 0) * Math.PI / 180;
    // These are orthonormal tangent directions for increasing azimuth and
    // elevation. At the zenith the azimuth tangent is an authored roll
    // reference, while the target vector itself remains azimuth-independent.
    const azimuthTangent = [Math.cos(azimuth), -Math.sin(azimuth), 0];
    const elevationTangent = [
        -Math.sin(elevation) * Math.sin(azimuth),
        -Math.sin(elevation) * Math.cos(azimuth),
        Math.cos(elevation)
    ];
    const axial = dotDirection(target, boresight);
    const azimuthOffsetDeg = Math.atan2(dotDirection(target, azimuthTangent), axial) * 180 / Math.PI;
    const elevationOffsetDeg = Math.atan2(dotDirection(target, elevationTangent), axial) * 180 / Math.PI;
    return {
        azimuth_offset_deg: azimuthOffsetDeg,
        elevation_offset_deg: elevationOffsetDeg,
        separation_deg: Math.acos(clamp(axial, -1, 1)) * 180 / Math.PI
    };
}

/**
 * Evaluate mask, mechanics and the station mode before considering RF power.
 * Scan has no schedule in the current product, so it describes a potential
 * mechanical field of regard rather than inventing an instantaneous beam or
 * publishing a false operational pass.
 *
 * A stationary antenna is not treated as a binary cone. HPBW describes the
 * -3 dB contour, not an opaque physical wall: once a target is mechanically
 * reachable, the configured gain pattern and its link threshold determine
 * whether a link closes. ``in_fixed_beam`` is retained as a useful main-lobe
 * diagnostic for the UI and old consumers, but it is deliberately not the
 * access gate.
 */
export function evaluateStationFieldOfRegard(station, azimuthDeg, elevationDeg) {
    const model = calculateStationRfModel(station);
    const elevation = finiteOptional(elevationDeg);
    const azimuth = finiteOptional(azimuthDeg);
    if (elevation === null || azimuth === null) {
        return { model, usable: false, reason: "look-angles-required", azimuth_offset_deg: null, elevation_offset_deg: null, boresight_separation_deg: null };
    }
    const aboveMask = elevation >= model.min_elevation_deg;
    const mechanicallyReachable = isMechanicallyReachable(model, azimuth, elevation);
    const patternOffsets = calculateDirectionalPatternOffsetsDeg(
        azimuth,
        elevation,
        model.boresight_azimuth_deg,
        model.boresight_elevation_deg
    );
    const normalizedBeamOffset = Math.hypot(
        patternOffsets.azimuth_offset_deg / (model.hpbw_azimuth_deg / 2),
        patternOffsets.elevation_offset_deg / (model.hpbw_elevation_deg / 2)
    );
    const inFixedBeam = model.operation_mode !== "stationary"
        || normalizedBeamOffset <= 1;
    const potentiallyReachable = aboveMask && mechanicallyReachable;
    const scanScheduleRequired = model.operation_mode === "scan";
    const operationalReady = potentiallyReachable && !scanScheduleRequired;
    return {
        model,
        usable: operationalReady,
        potentially_reachable: potentiallyReachable,
        operational_ready: operationalReady,
        mode_requires_schedule: scanScheduleRequired,
        reason: !aboveMask
            ? "elevation-mask"
            : !mechanicallyReachable
                ? "mechanical-limit"
                : scanScheduleRequired
                    ? "scan-schedule-required"
                    : null,
        azimuth_offset_deg: model.operation_mode === "stationary" ? patternOffsets.azimuth_offset_deg : 0,
        elevation_offset_deg: model.operation_mode === "stationary" ? patternOffsets.elevation_offset_deg : 0,
        boresight_separation_deg: patternOffsets.separation_deg,
        normalized_beam_offset: model.operation_mode === "stationary" ? normalizedBeamOffset : 0,
        above_mask: aboveMask,
        mechanically_reachable: mechanicallyReachable,
        in_fixed_beam: inFixedBeam
    };
}

/** Normalize a persisted or editor-provided RF station contract. */
export function normalizeGroundStationRf(station = {}) {
    const hasAperture = finiteOptional(station?.antenna_diameter_m) !== null;
    const legacyTxGain = finiteOptional(station?.tx_gain_dbi);
    const legacyRxGain = finiteOptional(station?.rx_gain_dbi);
    const txGainOverride = finiteOptional(station?.tx_gain_override_dbi) ?? legacyTxGain;
    const rxGainOverride = finiteOptional(station?.rx_gain_override_dbi) ?? legacyRxGain;
    const inferredLegacyGainMode = !hasAperture && (legacyTxGain !== null || legacyRxGain !== null) ? "override" : "derived";
    const minElevation = clamp(finiteNumber(station?.min_elevation_deg, RF_DEFAULTS.min_elevation_deg), 0, 90);
    const mechanicalMinimum = clamp(finiteNumber(station?.mechanical_elevation_min_deg, Math.min(minElevation, RF_DEFAULTS.mechanical_elevation_min_deg)), 0, 90);
    const mechanicalMaximum = clamp(finiteNumber(station?.mechanical_elevation_max_deg, RF_DEFAULTS.mechanical_elevation_max_deg), mechanicalMinimum, 90);
    const requestedFrequencyUnit = String(station?.frequency_unit || "mhz").trim().toLowerCase();
    const frequencyFromMhz = finiteOptional(station?.frequency_mhz);
    const frequencyFromHz = finiteOptional(station?.frequency_hz);
    const frequencyMhz = frequencyFromMhz !== null && frequencyFromMhz > 0
        ? frequencyFromMhz
        : frequencyFromHz !== null && frequencyFromHz > 0
            ? frequencyFromHz / 1e6
            : RF_DEFAULTS.frequency_mhz;
    const requestedPowerUnit = String(station?.tx_power_unit || "dbm").trim().toLowerCase();
    const txPowerFromWatts = wattsToDbm(station?.tx_power_w);
    const txPowerFromDbm = finiteOptional(station?.tx_power_dbm);
    const txPowerDbm = requestedPowerUnit === "w" && txPowerFromWatts !== null
        ? txPowerFromWatts
        : txPowerFromDbm ?? txPowerFromWatts ?? RF_DEFAULTS.tx_power_dbm;
    return {
        min_elevation_deg: minElevation,
        antenna_diameter_m: clamp(finiteNumber(station?.antenna_diameter_m, RF_DEFAULTS.antenna_diameter_m), 0.01, 100),
        antenna_efficiency: clamp(finiteNumber(station?.antenna_efficiency, RF_DEFAULTS.antenna_efficiency), 0.01, 1),
        frequency_unit: requestedFrequencyUnit === "hz" ? "hz" : "mhz",
        frequency_mhz: clamp(frequencyMhz, 0.001, 1_000_000),
        polarization: normalizedPolarization(station?.polarization),
        polarization_tilt_deg: normalizeAzimuth(station?.polarization_tilt_deg),
        tx_power_unit: requestedPowerUnit === "w" ? "w" : "dbm",
        tx_power_dbm: clamp(txPowerDbm, -200, 200),
        tx_gain_mode: normalizedChoice(station?.tx_gain_mode, VALID_GAIN_MODES, inferredLegacyGainMode),
        rx_gain_mode: normalizedChoice(station?.rx_gain_mode, VALID_GAIN_MODES, inferredLegacyGainMode),
        tx_gain_override_dbi: txGainOverride,
        rx_gain_override_dbi: rxGainOverride,
        min_link_power_dbm: clamp(finiteNumber(station?.min_link_power_dbm, RF_DEFAULTS.min_link_power_dbm), -250, 50),
        hpbw_azimuth_deg: finiteOptional(station?.hpbw_azimuth_deg),
        hpbw_elevation_deg: finiteOptional(station?.hpbw_elevation_deg),
        pattern_type: normalizedChoice(station?.pattern_type, VALID_PATTERN_TYPES, RF_DEFAULTS.pattern_type),
        side_lobe_level_db: clamp(finiteNumber(station?.side_lobe_level_db, RF_DEFAULTS.side_lobe_level_db), 0, 120),
        system_temperature_k: clamp(finiteNumber(station?.system_temperature_k, RF_DEFAULTS.system_temperature_k), 1, 100_000),
        atmospheric_loss_db: clamp(finiteNumber(station?.atmospheric_loss_db, RF_DEFAULTS.atmospheric_loss_db), 0, 100),
        rain_loss_db: clamp(finiteNumber(station?.rain_loss_db, RF_DEFAULTS.rain_loss_db), 0, 100),
        cable_loss_db: clamp(finiteNumber(station?.cable_loss_db, RF_DEFAULTS.cable_loss_db), 0, 100),
        connector_loss_db: clamp(finiteNumber(station?.connector_loss_db, RF_DEFAULTS.connector_loss_db), 0, 100),
        pointing_rms_mdeg: clamp(finiteNumber(station?.pointing_rms_mdeg, RF_DEFAULTS.pointing_rms_mdeg), 0, 90_000),
        receiver_bandwidth_hz: clamp(finiteNumber(station?.receiver_bandwidth_hz, RF_DEFAULTS.receiver_bandwidth_hz), 1, 10_000_000_000),
        required_snr_db: clamp(finiteNumber(station?.required_snr_db, RF_DEFAULTS.required_snr_db), -100, 100),
        operation_mode: normalizedChoice(station?.operation_mode, VALID_OPERATION_MODES, RF_DEFAULTS.operation_mode),
        boresight_azimuth_deg: normalizeAzimuth(station?.boresight_azimuth_deg),
        boresight_elevation_deg: clamp(finiteNumber(station?.boresight_elevation_deg, RF_DEFAULTS.boresight_elevation_deg), 0, 90),
        mechanical_elevation_min_deg: mechanicalMinimum,
        mechanical_elevation_max_deg: mechanicalMaximum,
        mechanical_azimuth_min_deg: normalizeAzimuthLimit(station?.mechanical_azimuth_min_deg, RF_DEFAULTS.mechanical_azimuth_min_deg),
        mechanical_azimuth_max_deg: normalizeAzimuthLimit(station?.mechanical_azimuth_max_deg, RF_DEFAULTS.mechanical_azimuth_max_deg),
        coverage_visible: station?.coverage_visible !== false,
        // A real one-way satellite link may override these from its RF profile.
        reference_rx_gain_dbi: finiteOptional(station?.reference_rx_gain_dbi),
        reference_rx_threshold_dbm: finiteOptional(station?.reference_rx_threshold_dbm)
    };
}

/**
 * Build the RF station model and all derived values used by the application.
 * `max_range_km` describes a reciprocal planning terminal unless explicit
 * reference receiver parameters are supplied; it is not claimed as a
 * prediction of an arbitrary satellite link.
 */
export function calculateStationRfModel(station = {}) {
    const config = normalizeGroundStationRf(station);
    const derivedGainDbi = calculateDishGainDbi(config.antenna_diameter_m, config.antenna_efficiency, config.frequency_mhz);
    const derivedHpbwDeg = calculateDishHpbwDeg(config.antenna_diameter_m, config.frequency_mhz);
    const hpbwAzimuthDeg = clamp(config.hpbw_azimuth_deg ?? derivedHpbwDeg ?? 180, 0.05, 180);
    const hpbwElevationDeg = clamp(config.hpbw_elevation_deg ?? derivedHpbwDeg ?? 180, 0.05, 180);
    const txGainDbi = config.tx_gain_mode === "override" && config.tx_gain_override_dbi !== null
        ? config.tx_gain_override_dbi
        : derivedGainDbi;
    const rxGainDbi = config.rx_gain_mode === "override" && config.rx_gain_override_dbi !== null
        ? config.rx_gain_override_dbi
        : derivedGainDbi;
    const pointingLossDb = calculatePointingLossDb(config.pointing_rms_mdeg, hpbwAzimuthDeg, hpbwElevationDeg) ?? 0;
    const txEffectiveGainDbi = txGainDbi === null ? null : txGainDbi - pointingLossDb;
    const rxEffectiveGainDbi = rxGainDbi === null ? null : rxGainDbi - pointingLossDb;
    const propagationLossDb = config.atmospheric_loss_db + config.rain_loss_db;
    const stationHardwareLossDb = config.cable_loss_db + config.connector_loss_db;
    const totalSystemLossDb = propagationLossDb + stationHardwareLossDb + pointingLossDb;
    const receiverNoiseFloorDbm = calculateThermalNoiseFloorDbm(config.system_temperature_k, config.receiver_bandwidth_hz);
    const systemGtDbPerK = rxEffectiveGainDbi === null
        ? null
        : rxEffectiveGainDbi - stationHardwareLossDb - (10 * Math.log10(config.system_temperature_k));
    const referenceReceiverGainDbi = config.reference_rx_gain_dbi ?? rxGainDbi;
    const referenceReceiverThresholdDbm = config.reference_rx_threshold_dbm ?? config.min_link_power_dbm;
    const maxRangeBudgetDb = txEffectiveGainDbi === null || referenceReceiverGainDbi === null
        ? null
        : config.tx_power_dbm + txEffectiveGainDbi + referenceReceiverGainDbi - propagationLossDb - stationHardwareLossDb - referenceReceiverThresholdDbm;
    const maxRangeKm = maxRangeBudgetDb === null
        ? null
        : 10 ** ((maxRangeBudgetDb - 32.44 - (20 * Math.log10(config.frequency_mhz))) / 20);
    // Retain the calculated small-range result exactly. A 1 km lower clamp
    // would make the AOS/LOS service claim access that the link budget has
    // already rejected. The upper ceiling is only a malformed-input guard
    // shared with the backend operational gate.
    const operationalRangeKm = maxRangeKm === null
        ? null
        : Math.min(MAX_RF_OPERATIONAL_RANGE_KM, maxRangeKm);
    const visualRangeKm = operationalRangeKm === null
        ? null
        : Math.min(MAX_RF_VISUAL_RANGE_KM, operationalRangeKm);
    // The map projection derives from the physical planning range, not the
    // renderer cap. A high-gain station must not lose valid AOS/LOS windows
    // merely because its 3D mesh is intentionally kept compact.
    const footprintRadiusKm = operationalRangeKm === null
        ? null
        : calculateGroundFootprintRadiusKm(operationalRangeKm, Math.max(config.min_elevation_deg, config.mechanical_elevation_min_deg));
    const visualFootprintRadiusKm = visualRangeKm === null
        ? null
        : calculateGroundFootprintRadiusKm(visualRangeKm, Math.max(config.min_elevation_deg, config.mechanical_elevation_min_deg));
    return {
        ...config,
        wavelength_m: SPEED_OF_LIGHT_M_S / (config.frequency_mhz * 1e6),
        tx_power_w: dbmToWatts(config.tx_power_dbm),
        derived_gain_dbi: derivedGainDbi,
        gain_max_dbi: derivedGainDbi,
        tx_gain_dbi: txGainDbi,
        rx_gain_dbi: rxGainDbi,
        tx_effective_gain_dbi: txEffectiveGainDbi,
        rx_effective_gain_dbi: rxEffectiveGainDbi,
        hpbw_azimuth_deg: hpbwAzimuthDeg,
        hpbw_elevation_deg: hpbwElevationDeg,
        pointing_loss_db: pointingLossDb,
        propagation_loss_db: propagationLossDb,
        station_hardware_loss_db: stationHardwareLossDb,
        total_system_loss_db: totalSystemLossDb,
        system_gt_db_per_k: systemGtDbPerK,
        receiver_noise_floor_dbm: receiverNoiseFloorDbm,
        reference_receiver_gain_dbi: referenceReceiverGainDbi,
        reference_receiver_threshold_dbm: referenceReceiverThresholdDbm,
        max_range_km: maxRangeKm,
        operational_range_km: operationalRangeKm,
        visual_range_km: visualRangeKm,
        ground_footprint_radius_km: footprintRadiusKm,
        visual_ground_footprint_radius_km: visualFootprintRadiusKm,
        range_contract: config.reference_rx_gain_dbi !== null || config.reference_rx_threshold_dbm !== null
            ? "reference-terminal"
            : "reciprocal-planning"
    };
}

/** Evaluate a reciprocal planning link at a particular slant range. */
export function calculateStationPlanningLink(station, rangeKm, { azimuthDeg = null, elevationDeg = null, azimuthOffsetDeg = 0, elevationOffsetDeg = 0 } = {}) {
    const model = calculateStationRfModel(station);
    const fieldOfRegard = azimuthDeg === null || elevationDeg === null
        ? null
        : evaluateStationFieldOfRegard(station, azimuthDeg, elevationDeg);
    const effectiveAzimuthOffsetDeg = fieldOfRegard?.azimuth_offset_deg ?? azimuthOffsetDeg;
    const effectiveElevationOffsetDeg = fieldOfRegard?.elevation_offset_deg ?? elevationOffsetDeg;
    const fsplDb = calculateFreeSpacePathLossDb(model.frequency_mhz, rangeKm);
    const range = finiteOptional(rangeKm);
    const withinOperationalRange = range !== null
        && (model.operational_range_km === null || range <= model.operational_range_km);
    const directionalTxGainDbi = calculatePatternGainDbi({
        peakGainDbi: model.tx_effective_gain_dbi,
        patternType: model.pattern_type,
        hpbwAzimuthDeg: model.hpbw_azimuth_deg,
        hpbwElevationDeg: model.hpbw_elevation_deg,
        sideLobeLevelDb: model.side_lobe_level_db,
        azimuthOffsetDeg: effectiveAzimuthOffsetDeg,
        elevationOffsetDeg: effectiveElevationOffsetDeg
    });
    if (fsplDb === null || directionalTxGainDbi === null || model.reference_receiver_gain_dbi === null) {
        return {
            ...model,
            field_of_regard: fieldOfRegard,
            fspl_db: fsplDb,
            within_operational_range: withinOperationalRange,
            received_power_dbm: null,
            link_margin_db: null,
            potentially_usable: false,
            usable: false
        };
    }
    const receivedPowerDbm = model.tx_power_dbm + directionalTxGainDbi + model.reference_receiver_gain_dbi
        - fsplDb - model.propagation_loss_db - model.station_hardware_loss_db;
    const potentiallyUsable = (fieldOfRegard?.potentially_reachable ?? true)
        && withinOperationalRange
        && receivedPowerDbm >= model.reference_receiver_threshold_dbm;
    return {
        ...model,
        field_of_regard: fieldOfRegard,
        fspl_db: fsplDb,
        within_operational_range: withinOperationalRange,
        directional_tx_gain_dbi: directionalTxGainDbi,
        received_power_dbm: receivedPowerDbm,
        link_margin_db: receivedPowerDbm - model.reference_receiver_threshold_dbm,
        potentially_usable: potentiallyUsable,
        usable: (fieldOfRegard?.operational_ready ?? true) && potentiallyUsable
    };
}

/**
 * Validate a remote satellite downlink profile and derive its boresight link
 * envelope. The result is intentionally independent of a target position so
 * pass analysis can use the same range contract as live telemetry.
 *
 * The occupied signal bandwidth must fit *entirely* inside the station
 * receiver passband: ``|Δf| + B_signal / 2 <= B_rx / 2``. Testing the carrier
 * and bandwidth separately would accept a clipped signal.
 */
export function calculateSatelliteDownlinkEnvelope(station, satelliteRf) {
    const model = calculateStationRfModel(station);
    const eirpDbm = finiteOptional(satelliteRf?.eirp_dbm);
    const remoteFrequencyMhz = finiteOptional(satelliteRf?.frequency_mhz)
        ?? (() => {
            const frequencyHz = finiteOptional(satelliteRf?.frequency_hz);
            return frequencyHz === null ? null : frequencyHz / 1e6;
        })();
    const remotePolarization = String(satelliteRf?.polarization || "").trim().toUpperCase();
    const signalBandwidthHz = finiteOptional(satelliteRf?.bandwidth_hz);
    const missingFields = [
        eirpDbm === null ? "eirp_dbm" : null,
        remoteFrequencyMhz === null || remoteFrequencyMhz <= 0 ? "frequency_mhz" : null,
        !VALID_POLARIZATIONS.has(remotePolarization) ? "polarization" : null,
        signalBandwidthHz === null || signalBandwidthHz <= 0 ? "bandwidth_hz" : null
    ].filter(Boolean);
    const frequencyOffsetHz = remoteFrequencyMhz === null
        ? null
        : Math.abs(remoteFrequencyMhz - model.frequency_mhz) * 1e6;
    const receiverHalfBandwidthHz = model.receiver_bandwidth_hz / 2;
    const signalHalfBandwidthHz = signalBandwidthHz === null ? null : signalBandwidthHz / 2;
    const channelCompatible = frequencyOffsetHz !== null
        && signalHalfBandwidthHz !== null
        && frequencyOffsetHz + signalHalfBandwidthHz <= receiverHalfBandwidthHz + 1e-9;
    const noiseFloorDbm = calculateThermalNoiseFloorDbm(model.system_temperature_k, model.receiver_bandwidth_hz);
    const polarizationLossDb = calculatePolarizationMismatchLossDb(
        remotePolarization,
        model.polarization,
        satelliteRf?.polarization_tilt_deg,
        model.polarization_tilt_deg
    );
    const requiredReceivePowerDbm = noiseFloorDbm === null
        ? model.min_link_power_dbm
        : Math.max(model.min_link_power_dbm, noiseFloorDbm + model.required_snr_db);

    if (missingFields.length || model.rx_effective_gain_dbi === null) {
        return {
            ...model,
            available: false,
            reason: "satellite-rf-profile-required",
            missing_fields: missingFields,
            frequency_offset_hz: frequencyOffsetHz,
            signal_bandwidth_hz: signalBandwidthHz,
            receiver_bandwidth_hz: model.receiver_bandwidth_hz,
            received_power_dbm: null,
            snr_db: null,
            link_margin_db: null,
            boresight_max_range_km: null,
            operational_max_range_km: null
        };
    }
    if (!channelCompatible) {
        const signalExceedsReceiver = signalBandwidthHz > model.receiver_bandwidth_hz;
        return {
            ...model,
            available: false,
            reason: signalExceedsReceiver
                ? "signal-bandwidth-exceeds-receiver-bandwidth"
                : "signal-outside-receiver-bandwidth",
            missing_fields: [],
            frequency_offset_hz: frequencyOffsetHz,
            signal_bandwidth_hz: signalBandwidthHz,
            receiver_bandwidth_hz: model.receiver_bandwidth_hz,
            received_power_dbm: null,
            snr_db: null,
            link_margin_db: null,
            boresight_max_range_km: null,
            operational_max_range_km: null
        };
    }

    const boresightBudgetDb = eirpDbm + model.rx_effective_gain_dbi - model.propagation_loss_db
        - model.station_hardware_loss_db - polarizationLossDb - requiredReceivePowerDbm;
    const boresightMaxRangeKm = 10 ** ((boresightBudgetDb - 32.44 - (20 * Math.log10(remoteFrequencyMhz))) / 20);
    return {
        ...model,
        available: true,
        reason: null,
        missing_fields: [],
        remote_eirp_dbm: eirpDbm,
        remote_frequency_mhz: remoteFrequencyMhz,
        remote_polarization: remotePolarization,
        frequency_offset_hz: frequencyOffsetHz,
        signal_bandwidth_hz: signalBandwidthHz,
        receiver_bandwidth_hz: model.receiver_bandwidth_hz,
        polarization_loss_db: polarizationLossDb,
        noise_floor_dbm: noiseFloorDbm,
        required_receive_power_dbm: requiredReceivePowerDbm,
        boresight_max_range_km: boresightMaxRangeKm,
        operational_max_range_km: Math.min(MAX_RF_OPERATIONAL_RANGE_KM, boresightMaxRangeKm)
    };
}

/**
 * Evaluate a true downlink only when the satellite exposes a complete,
 * compatible RF profile. It is a one-way satellite-to-station calculation;
 * uplink requires a remote satellite receiver model and is not inferred.
 */
export function calculateSatelliteDownlink(station, satelliteRf, rangeKm, {
    azimuthDeg = null,
    elevationDeg = null,
    azimuthOffsetDeg = 0,
    elevationOffsetDeg = 0
} = {}) {
    const envelope = calculateSatelliteDownlinkEnvelope(station, satelliteRf);
    const fieldOfRegard = azimuthDeg === null || elevationDeg === null
        ? null
        : evaluateStationFieldOfRegard(station, azimuthDeg, elevationDeg);
    const fsplDb = calculateFreeSpacePathLossDb(envelope.remote_frequency_mhz ?? envelope.frequency_mhz, rangeKm);
    const range = finiteOptional(rangeKm);
    const withinOperationalRange = range !== null && range <= MAX_RF_OPERATIONAL_RANGE_KM;
    if (!envelope.available || fsplDb === null) {
        return {
            ...envelope,
            field_of_regard: fieldOfRegard,
            fspl_db: fsplDb,
            within_operational_range: withinOperationalRange,
            received_power_dbm: null,
            snr_db: null,
            link_margin_db: null,
            snr_margin_db: null,
            potentially_usable: false,
            usable: false
        };
    }
    // Prefer physical look angles whenever the caller has them. Passing only
    // offsets is retained for a non-geometric chart, never for live links.
    const effectiveAzimuthOffsetDeg = fieldOfRegard?.azimuth_offset_deg ?? azimuthOffsetDeg;
    const effectiveElevationOffsetDeg = fieldOfRegard?.elevation_offset_deg ?? elevationOffsetDeg;
    const directionalRxGainDbi = calculatePatternGainDbi({
        peakGainDbi: envelope.rx_effective_gain_dbi,
        patternType: envelope.pattern_type,
        hpbwAzimuthDeg: envelope.hpbw_azimuth_deg,
        hpbwElevationDeg: envelope.hpbw_elevation_deg,
        sideLobeLevelDb: envelope.side_lobe_level_db,
        azimuthOffsetDeg: effectiveAzimuthOffsetDeg,
        elevationOffsetDeg: effectiveElevationOffsetDeg
    });
    const receivedPowerDbm = envelope.remote_eirp_dbm + directionalRxGainDbi - fsplDb - envelope.propagation_loss_db
        - envelope.station_hardware_loss_db - envelope.polarization_loss_db;
    const snrDb = envelope.noise_floor_dbm === null ? null : receivedPowerDbm - envelope.noise_floor_dbm;
    const potentiallyUsable = (fieldOfRegard?.potentially_reachable ?? true)
        && withinOperationalRange
        && receivedPowerDbm >= envelope.min_link_power_dbm
        && (snrDb === null || snrDb >= envelope.required_snr_db);
    return {
        ...envelope,
        field_of_regard: fieldOfRegard,
        fspl_db: fsplDb,
        within_operational_range: withinOperationalRange,
        directional_rx_gain_dbi: directionalRxGainDbi,
        received_power_dbm: receivedPowerDbm,
        snr_db: snrDb,
        link_margin_db: receivedPowerDbm - envelope.min_link_power_dbm,
        snr_margin_db: snrDb === null ? null : snrDb - envelope.required_snr_db,
        potentially_usable: potentiallyUsable,
        usable: (fieldOfRegard?.operational_ready ?? true) && potentiallyUsable
    };
}

/**
 * Discrete polar sampling ready for charts or a Cesium mesh. Each sample is
 * encoded in antenna-local azimuth/elevation offsets and has a normalized
 * radius whose variation follows the selected gain pattern.
 */
export function sampleAntennaPattern(station, { azimuthSamples = 72, elevationSamples = 24 } = {}) {
    const model = calculateStationRfModel(station);
    const azimuthCount = Math.max(8, Math.floor(finiteNumber(azimuthSamples, 72)));
    const elevationCount = Math.max(4, Math.floor(finiteNumber(elevationSamples, 24)));
    const maxOffsetDeg = Math.min(90, Math.max(model.hpbw_azimuth_deg, model.hpbw_elevation_deg) * 3);
    const samples = [];
    const floorGain = Math.max(0.001, 10 ** (-model.side_lobe_level_db / 10));
    for (let elevationIndex = 0; elevationIndex <= elevationCount; elevationIndex += 1) {
        const elevationOffsetDeg = -maxOffsetDeg + ((2 * maxOffsetDeg * elevationIndex) / elevationCount);
        for (let azimuthIndex = 0; azimuthIndex <= azimuthCount; azimuthIndex += 1) {
            const azimuthOffsetDeg = -maxOffsetDeg + ((2 * maxOffsetDeg * azimuthIndex) / azimuthCount);
            const gainDbi = calculatePatternGainDbi({
                peakGainDbi: model.tx_effective_gain_dbi,
                patternType: model.pattern_type,
                hpbwAzimuthDeg: model.hpbw_azimuth_deg,
                hpbwElevationDeg: model.hpbw_elevation_deg,
                sideLobeLevelDb: model.side_lobe_level_db,
                azimuthOffsetDeg,
                elevationOffsetDeg
            });
            const gainRatio = gainDbi === null || model.tx_effective_gain_dbi === null
                ? floorGain
                : Math.max(floorGain, 10 ** ((gainDbi - model.tx_effective_gain_dbi) / 10));
            // In free space the admissible slant range varies with the square
            // root of the power gain ratio (FSPL is 20 log10(range)). Keep the
            // physical range ratio separate from power gain so both charts and
            // a 3D mesh can use the correct quantity.
            const rangeRatio = Math.sqrt(gainRatio);
            samples.push({
                azimuth_offset_deg: azimuthOffsetDeg,
                elevation_offset_deg: elevationOffsetDeg,
                gain_dbi: gainDbi,
                normalized_gain: gainRatio,
                normalized_radius: rangeRatio,
                link_range_ratio: rangeRatio
            });
        }
    }
    return { model, azimuth_samples: azimuthCount, elevation_samples: elevationCount, max_offset_deg: maxOffsetDeg, samples };
}

/**
 * Discrete downlink performance map at a fixed slant range.
 *
 * This is deliberately an antenna-local ``(Δaz, Δel)`` map, not a terrain
 * heat map: terrain/SNR maps additionally need a selected satellite state,
 * Earth occultation and a time. It gives plots a truthful way to render the
 * available ``P_RX`` and SNR around a boresight whenever the remote satellite
 * has supplied a complete RF profile.
 */
export function sampleSatelliteDownlinkPattern(station, satelliteRf, rangeKm, {
    azimuthSamples = 72,
    elevationSamples = 24
} = {}) {
    const envelope = calculateSatelliteDownlinkEnvelope(station, satelliteRf);
    const range = finiteOptional(rangeKm);
    if (!envelope.available || range === null || range <= 0) {
        return {
            model: envelope,
            available: false,
            reason: !envelope.available ? envelope.reason : "range-km-required",
            range_km: range,
            samples: []
        };
    }
    const pattern = sampleAntennaPattern(station, { azimuthSamples, elevationSamples });
    const samples = pattern.samples.map((sample) => {
        const link = calculateSatelliteDownlink(station, satelliteRf, range, {
            azimuthOffsetDeg: sample.azimuth_offset_deg,
            elevationOffsetDeg: sample.elevation_offset_deg
        });
        return {
            ...sample,
            received_power_dbm: link.received_power_dbm,
            snr_db: link.snr_db,
            link_margin_db: link.link_margin_db,
            snr_margin_db: link.snr_margin_db,
            usable: link.usable
        };
    });
    return {
        model: envelope,
        available: true,
        range_km: range,
        azimuth_samples: pattern.azimuth_samples,
        elevation_samples: pattern.elevation_samples,
        max_offset_deg: pattern.max_offset_deg,
        samples
    };
}
