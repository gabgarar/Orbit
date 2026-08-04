/**
 * Classical Keplerian element <-> Cartesian state-vector conversions.
 *
 * This module intentionally has no Cesium or DOM dependency.  Positions are
 * expressed in ECI kilometres, velocities in ECI kilometres per second, and
 * all public angular values are degrees.  It covers bounded elliptic two-body
 * orbits only; SGP4 propagation is a separate concern from this geometry
 * conversion.
 */

/** WGS-84 Earth gravitational parameter, in km^3 / s^2. */
export const WGS84_EARTH_MU_KM3_S2 = 398600.4418;

const TWO_PI = 2 * Math.PI;
const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_ECCENTRICITY_TOLERANCE = 1e-10;
const DEFAULT_KEPLER_TOLERANCE = 1e-13;
const MAX_KEPLER_ITERATIONS = 50;

export class OrbitalElementsValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = "OrbitalElementsValidationError";
    }
}

function numeric(value, label) {
    const result = Number(value);
    if (!Number.isFinite(result)) {
        throw new OrbitalElementsValidationError(`${label} must be a finite number.`);
    }
    return result;
}

function supplied(value) {
    return value !== undefined && value !== null && String(value).trim() !== "";
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function wrapRadians(value) {
    const wrapped = value % TWO_PI;
    return wrapped < 0 ? wrapped + TWO_PI : wrapped;
}

function signedRadians(value) {
    const wrapped = wrapRadians(value);
    return wrapped > Math.PI ? wrapped - TWO_PI : wrapped;
}

/** Normalize an angle to the half-open [0, 360) degree interval. */
export function normalizeDegrees(value) {
    const degrees = numeric(value, "Angle");
    const wrapped = degrees % 360;
    return Object.is(wrapped, -0) ? 0 : (wrapped < 0 ? wrapped + 360 : wrapped);
}

export function degreesToRadians(value) {
    return numeric(value, "Angle") * DEG_TO_RAD;
}

export function radiansToDegrees(value) {
    return numeric(value, "Angle") * RAD_TO_DEG;
}

function resolveMu(options = {}) {
    const mu = options.muKm3S2 ?? WGS84_EARTH_MU_KM3_S2;
    const result = numeric(mu, "muKm3S2");
    if (!(result > 0)) {
        throw new OrbitalElementsValidationError("muKm3S2 must be greater than zero.");
    }
    return result;
}

function resolveEccentricityTolerance(options = {}) {
    const tolerance = options.eccentricityTolerance ?? DEFAULT_ECCENTRICITY_TOLERANCE;
    const result = numeric(tolerance, "eccentricityTolerance");
    if (!(result > 0) || result >= 1) {
        throw new OrbitalElementsValidationError("eccentricityTolerance must be greater than zero and less than one.");
    }
    return result;
}

function vector(value, label) {
    if (!value || typeof value !== "object") {
        throw new OrbitalElementsValidationError(`${label} must be an { x, y, z } vector.`);
    }
    return {
        x: numeric(value.x, `${label}.x`),
        y: numeric(value.y, `${label}.y`),
        z: numeric(value.z, `${label}.z`)
    };
}

function subtract(left, right) {
    return { x: left.x - right.x, y: left.y - right.y, z: left.z - right.z };
}

function scale(value, factor) {
    return { x: value.x * factor, y: value.y * factor, z: value.z * factor };
}

function dot(left, right) {
    return (left.x * right.x) + (left.y * right.y) + (left.z * right.z);
}

function cross(left, right) {
    return {
        x: (left.y * right.z) - (left.z * right.y),
        y: (left.z * right.x) - (left.x * right.z),
        z: (left.x * right.y) - (left.y * right.x)
    };
}

function magnitude(value) {
    return Math.hypot(value.x, value.y, value.z);
}

function angleFromCosine(value) {
    return Math.acos(clamp(value, -1, 1));
}

function periodSeconds(semiMajorAxisKm, muKm3S2) {
    return TWO_PI * Math.sqrt((semiMajorAxisKm ** 3) / muKm3S2);
}

function eccentricAnomalyFromTrueRadians(trueAnomalyRad, eccentricity) {
    const eccentricAnomaly = 2 * Math.atan2(
        Math.sqrt(1 - eccentricity) * Math.sin(trueAnomalyRad / 2),
        Math.sqrt(1 + eccentricity) * Math.cos(trueAnomalyRad / 2)
    );
    return wrapRadians(eccentricAnomaly);
}

function trueAnomalyFromEccentricRadians(eccentricAnomalyRad, eccentricity) {
    const trueAnomaly = 2 * Math.atan2(
        Math.sqrt(1 + eccentricity) * Math.sin(eccentricAnomalyRad / 2),
        Math.sqrt(1 - eccentricity) * Math.cos(eccentricAnomalyRad / 2)
    );
    return wrapRadians(trueAnomaly);
}

function solveEccentricAnomalyRadians(meanAnomalyRad, eccentricity) {
    const mean = signedRadians(meanAnomalyRad);
    let eccentricAnomaly = eccentricity < 0.8
        ? mean
        : (mean >= 0 ? Math.PI : -Math.PI);

    for (let index = 0; index < MAX_KEPLER_ITERATIONS; index += 1) {
        const residual = eccentricAnomaly - (eccentricity * Math.sin(eccentricAnomaly)) - mean;
        const derivative = 1 - (eccentricity * Math.cos(eccentricAnomaly));
        const correction = residual / derivative;
        eccentricAnomaly -= correction;
        if (Math.abs(correction) <= DEFAULT_KEPLER_TOLERANCE) {
            return wrapRadians(eccentricAnomaly);
        }
    }

    throw new OrbitalElementsValidationError("Kepler equation did not converge for the supplied mean anomaly.");
}

/**
 * Convert a true anomaly in degrees to a mean anomaly in degrees for an
 * elliptic orbit. Both input and output are normalized to [0, 360).
 */
export function trueAnomalyToMeanAnomalyDeg(trueAnomalyDeg, eccentricity) {
    const e = numeric(eccentricity, "eccentricity");
    if (e < 0 || e >= 1) {
        throw new OrbitalElementsValidationError("eccentricity must be in the [0, 1) interval for an elliptic orbit.");
    }
    const trueAnomalyRad = degreesToRadians(normalizeDegrees(trueAnomalyDeg));
    const eccentricAnomalyRad = eccentricAnomalyFromTrueRadians(trueAnomalyRad, e);
    return normalizeDegrees(radiansToDegrees(eccentricAnomalyRad - (e * Math.sin(eccentricAnomalyRad))));
}

/**
 * Convert a mean anomaly in degrees to a true anomaly in degrees for an
 * elliptic orbit. Both input and output are normalized to [0, 360).
 */
export function meanAnomalyToTrueAnomalyDeg(meanAnomalyDeg, eccentricity) {
    const e = numeric(eccentricity, "eccentricity");
    if (e < 0 || e >= 1) {
        throw new OrbitalElementsValidationError("eccentricity must be in the [0, 1) interval for an elliptic orbit.");
    }
    const meanAnomalyRad = degreesToRadians(normalizeDegrees(meanAnomalyDeg));
    const eccentricAnomalyRad = solveEccentricAnomalyRadians(meanAnomalyRad, e);
    return normalizeDegrees(radiansToDegrees(trueAnomalyFromEccentricRadians(eccentricAnomalyRad, e)));
}

function normalizedKeplerianElements(elements, options = {}) {
    if (!elements || typeof elements !== "object") {
        throw new OrbitalElementsValidationError("Keplerian elements must be an object.");
    }

    const semiMajorAxisKm = numeric(elements.semiMajorAxisKm, "semiMajorAxisKm");
    const eccentricity = numeric(elements.eccentricity, "eccentricity");
    const inclinationDeg = numeric(elements.inclinationDeg, "inclinationDeg");
    const raanDeg = normalizeDegrees(elements.raanDeg);
    const argumentOfPeriapsisDeg = normalizeDegrees(elements.argumentOfPeriapsisDeg);
    const muKm3S2 = resolveMu(options);

    if (!(semiMajorAxisKm > 0)) {
        throw new OrbitalElementsValidationError("semiMajorAxisKm must be greater than zero.");
    }
    if (eccentricity < 0 || eccentricity >= 1) {
        throw new OrbitalElementsValidationError("eccentricity must be in the [0, 1) interval for an elliptic orbit.");
    }
    if (inclinationDeg < 0 || inclinationDeg > 180) {
        throw new OrbitalElementsValidationError("inclinationDeg must be in the [0, 180] interval.");
    }

    const hasTrueAnomaly = supplied(elements.trueAnomalyDeg);
    const hasMeanAnomaly = supplied(elements.meanAnomalyDeg);
    if (hasTrueAnomaly === hasMeanAnomaly) {
        throw new OrbitalElementsValidationError("Provide exactly one of trueAnomalyDeg or meanAnomalyDeg.");
    }

    const trueAnomalyDeg = hasTrueAnomaly
        ? normalizeDegrees(elements.trueAnomalyDeg)
        : meanAnomalyToTrueAnomalyDeg(elements.meanAnomalyDeg, eccentricity);
    const meanAnomalyDeg = hasMeanAnomaly
        ? normalizeDegrees(elements.meanAnomalyDeg)
        : trueAnomalyToMeanAnomalyDeg(trueAnomalyDeg, eccentricity);

    return {
        semiMajorAxisKm,
        eccentricity,
        inclinationDeg,
        raanDeg,
        argumentOfPeriapsisDeg,
        trueAnomalyDeg,
        meanAnomalyDeg,
        inputAnomalyType: hasTrueAnomaly ? "true" : "mean",
        muKm3S2
    };
}

/**
 * Validate and normalize classical Keplerian elements. The returned object
 * uses km, degrees, and includes both true and mean anomaly.
 */
export function validateKeplerianElements(elements, options = {}) {
    return normalizedKeplerianElements(elements, options);
}

function normalizedStateVector(stateVector, options = {}) {
    if (!stateVector || typeof stateVector !== "object") {
        throw new OrbitalElementsValidationError("State vector must be an object.");
    }

    const positionEciKm = vector(stateVector.positionEciKm, "positionEciKm");
    const velocityEciKmS = vector(stateVector.velocityEciKmS, "velocityEciKmS");
    const positionMagnitudeKm = magnitude(positionEciKm);
    const velocityMagnitudeKmS = magnitude(velocityEciKmS);

    if (!(positionMagnitudeKm > 0)) {
        throw new OrbitalElementsValidationError("positionEciKm must not be the zero vector.");
    }
    if (!(velocityMagnitudeKmS > 0)) {
        throw new OrbitalElementsValidationError("velocityEciKmS must not be the zero vector.");
    }

    return {
        positionEciKm,
        velocityEciKmS,
        positionMagnitudeKm,
        velocityMagnitudeKmS,
        muKm3S2: resolveMu(options),
        eccentricityTolerance: resolveEccentricityTolerance(options)
    };
}

/**
 * Validate a Cartesian ECI state vector. Units are km and km/s.
 */
export function validateEciStateVector(stateVector, options = {}) {
    return normalizedStateVector(stateVector, options);
}

function orbitalDerivedValues(semiMajorAxisKm, eccentricity, muKm3S2) {
    const semiLatusRectumKm = semiMajorAxisKm * (1 - (eccentricity * eccentricity));
    return {
        semiLatusRectumKm,
        periapsisRadiusKm: semiMajorAxisKm * (1 - eccentricity),
        apoapsisRadiusKm: semiMajorAxisKm * (1 + eccentricity),
        orbitalPeriodSeconds: periodSeconds(semiMajorAxisKm, muKm3S2)
    };
}

/**
 * Convert classical Keplerian elements to an ECI Cartesian state vector.
 *
 * Input shape:
 * `{ semiMajorAxisKm, eccentricity, inclinationDeg, raanDeg,
 *    argumentOfPeriapsisDeg, trueAnomalyDeg | meanAnomalyDeg }`
 *
 * The output can be supplied unchanged to `stateVectorToKeplerian`.
 */
export function keplerianToStateVector(elements, options = {}) {
    const normalized = normalizedKeplerianElements(elements, options);
    const {
        semiMajorAxisKm,
        eccentricity,
        inclinationDeg,
        raanDeg,
        argumentOfPeriapsisDeg,
        trueAnomalyDeg,
        meanAnomalyDeg,
        inputAnomalyType,
        muKm3S2
    } = normalized;

    const inclinationRad = degreesToRadians(inclinationDeg);
    const raanRad = degreesToRadians(raanDeg);
    const argumentOfPeriapsisRad = degreesToRadians(argumentOfPeriapsisDeg);
    const trueAnomalyRad = degreesToRadians(trueAnomalyDeg);
    const semiLatusRectumKm = semiMajorAxisKm * (1 - (eccentricity * eccentricity));
    const radiusKm = semiLatusRectumKm / (1 + (eccentricity * Math.cos(trueAnomalyRad)));
    const velocityScaleKmS = Math.sqrt(muKm3S2 / semiLatusRectumKm);

    const positionPerifocalKm = {
        x: radiusKm * Math.cos(trueAnomalyRad),
        y: radiusKm * Math.sin(trueAnomalyRad),
        z: 0
    };
    const velocityPerifocalKmS = {
        x: -velocityScaleKmS * Math.sin(trueAnomalyRad),
        y: velocityScaleKmS * (eccentricity + Math.cos(trueAnomalyRad)),
        z: 0
    };

    const cosRaan = Math.cos(raanRad);
    const sinRaan = Math.sin(raanRad);
    const cosInclination = Math.cos(inclinationRad);
    const sinInclination = Math.sin(inclinationRad);
    const cosArgument = Math.cos(argumentOfPeriapsisRad);
    const sinArgument = Math.sin(argumentOfPeriapsisRad);
    const rotation = {
        m11: (cosRaan * cosArgument) - (sinRaan * sinArgument * cosInclination),
        m12: (-cosRaan * sinArgument) - (sinRaan * cosArgument * cosInclination),
        m21: (sinRaan * cosArgument) + (cosRaan * sinArgument * cosInclination),
        m22: (-sinRaan * sinArgument) + (cosRaan * cosArgument * cosInclination),
        m31: sinArgument * sinInclination,
        m32: cosArgument * sinInclination
    };
    const rotatePerifocal = (perifocal) => ({
        x: (rotation.m11 * perifocal.x) + (rotation.m12 * perifocal.y),
        y: (rotation.m21 * perifocal.x) + (rotation.m22 * perifocal.y),
        z: (rotation.m31 * perifocal.x) + (rotation.m32 * perifocal.y)
    });

    const eccentricAnomalyRad = eccentricAnomalyFromTrueRadians(trueAnomalyRad, eccentricity);
    return {
        positionEciKm: rotatePerifocal(positionPerifocalKm),
        velocityEciKmS: rotatePerifocal(velocityPerifocalKmS),
        semiMajorAxisKm,
        eccentricity,
        inclinationDeg,
        raanDeg,
        argumentOfPeriapsisDeg,
        trueAnomalyDeg,
        meanAnomalyDeg,
        eccentricAnomalyDeg: normalizeDegrees(radiansToDegrees(eccentricAnomalyRad)),
        inputAnomalyType,
        radiusKm,
        ...orbitalDerivedValues(semiMajorAxisKm, eccentricity, muKm3S2),
        muKm3S2
    };
}

/**
 * Convert an ECI Cartesian state vector to classical Keplerian elements.
 *
 * Input shape: `{ positionEciKm: { x, y, z }, velocityEciKmS: { x, y, z } }`.
 * Only elliptic states are representable in the manual-orbit editor.  For
 * circular singularities, `argumentOfPeriapsisDeg` is set to zero and the
 * reported true anomaly is respectively argument of latitude or true
 * longitude so that converting it back retains the same state.
 */
export function stateVectorToKeplerian(stateVector, options = {}) {
    const normalized = normalizedStateVector(stateVector, options);
    const {
        positionEciKm: position,
        velocityEciKmS: velocity,
        positionMagnitudeKm: radiusKm,
        velocityMagnitudeKmS,
        muKm3S2,
        eccentricityTolerance
    } = normalized;

    const angularMomentum = cross(position, velocity);
    const angularMomentumMagnitude = magnitude(angularMomentum);
    if (!(angularMomentumMagnitude > 0)) {
        throw new OrbitalElementsValidationError("State vector has zero angular momentum and cannot describe an orbit.");
    }

    const specificEnergyKm2S2 = ((velocityMagnitudeKmS * velocityMagnitudeKmS) / 2) - (muKm3S2 / radiusKm);
    if (!(specificEnergyKm2S2 < 0)) {
        throw new OrbitalElementsValidationError("Only bound elliptic state vectors are supported.");
    }
    const semiMajorAxisKm = -muKm3S2 / (2 * specificEnergyKm2S2);
    const eccentricityVector = subtract(
        scale(position, ((velocityMagnitudeKmS * velocityMagnitudeKmS) - (muKm3S2 / radiusKm)) / muKm3S2),
        scale(velocity, dot(position, velocity) / muKm3S2)
    );
    const rawEccentricity = magnitude(eccentricityVector);
    if (rawEccentricity >= 1) {
        throw new OrbitalElementsValidationError("Only elliptic state vectors with eccentricity below one are supported.");
    }
    const circular = rawEccentricity < eccentricityTolerance;
    const eccentricity = circular ? 0 : rawEccentricity;

    const node = { x: -angularMomentum.y, y: angularMomentum.x, z: 0 };
    const nodeMagnitude = magnitude(node);
    const equatorial = nodeMagnitude <= (angularMomentumMagnitude * eccentricityTolerance);
    const inclinationRad = angleFromCosine(angularMomentum.z / angularMomentumMagnitude);
    const retrogradeEquatorial = equatorial && angularMomentum.z < 0;
    const raanRad = equatorial ? 0 : wrapRadians(Math.atan2(node.y, node.x));

    let argumentOfPeriapsisRad = 0;
    let trueAnomalyRad;
    let anomalyReference = "true-anomaly";

    if (!circular) {
        if (equatorial) {
            const longitudeOfPeriapsis = Math.atan2(eccentricityVector.y, eccentricityVector.x);
            argumentOfPeriapsisRad = retrogradeEquatorial
                ? wrapRadians(-longitudeOfPeriapsis)
                : wrapRadians(longitudeOfPeriapsis);
        } else {
            argumentOfPeriapsisRad = angleFromCosine(dot(node, eccentricityVector) / (nodeMagnitude * eccentricity));
            if (eccentricityVector.z < 0) argumentOfPeriapsisRad = TWO_PI - argumentOfPeriapsisRad;
        }

        trueAnomalyRad = angleFromCosine(dot(eccentricityVector, position) / (eccentricity * radiusKm));
        if (dot(position, velocity) < 0) trueAnomalyRad = TWO_PI - trueAnomalyRad;
    } else if (equatorial) {
        const trueLongitude = Math.atan2(position.y, position.x);
        trueAnomalyRad = retrogradeEquatorial ? wrapRadians(-trueLongitude) : wrapRadians(trueLongitude);
        anomalyReference = "true-longitude";
    } else {
        trueAnomalyRad = angleFromCosine(dot(node, position) / (nodeMagnitude * radiusKm));
        if (position.z < 0) trueAnomalyRad = TWO_PI - trueAnomalyRad;
        anomalyReference = "argument-of-latitude";
    }

    const eccentricAnomalyRad = eccentricAnomalyFromTrueRadians(trueAnomalyRad, eccentricity);
    const meanAnomalyRad = wrapRadians(eccentricAnomalyRad - (eccentricity * Math.sin(eccentricAnomalyRad)));
    const inclinationDeg = radiansToDegrees(inclinationRad);
    const raanDeg = normalizeDegrees(radiansToDegrees(raanRad));
    const argumentOfPeriapsisDeg = normalizeDegrees(radiansToDegrees(argumentOfPeriapsisRad));
    const trueAnomalyDeg = normalizeDegrees(radiansToDegrees(trueAnomalyRad));

    return {
        semiMajorAxisKm,
        eccentricity,
        inclinationDeg,
        raanDeg,
        argumentOfPeriapsisDeg,
        trueAnomalyDeg,
        meanAnomalyDeg: normalizeDegrees(radiansToDegrees(meanAnomalyRad)),
        eccentricAnomalyDeg: normalizeDegrees(radiansToDegrees(eccentricAnomalyRad)),
        anomalyReference,
        radiusKm,
        specificEnergyKm2S2,
        specificAngularMomentumKm2S: angularMomentumMagnitude,
        ...orbitalDerivedValues(semiMajorAxisKm, eccentricity, muKm3S2),
        muKm3S2
    };
}
