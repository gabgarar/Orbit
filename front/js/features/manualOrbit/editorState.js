/**
 * Canonical state and boundary helpers for the manual-orbit editor.
 *
 * This module is deliberately independent from React, Cesium and the HTTP
 * client.  It is the only place where the two editor representations meet:
 * callers can feed it the compact/flat values emitted by the UI and always
 * receive a nested ECI state vector plus matching classical elements.
 */

import {
    OrbitalElementsValidationError,
    keplerianToStateVector,
    stateVectorToKeplerian
} from "./orbitalElements.js";

export const DEFAULT_MANUAL_ORBIT_NAME = "Manual Orbit";
export const DEFAULT_MANUAL_ORBIT_PROPAGATOR = "sgp4";

export const DEFAULT_MANUAL_KEPLERIAN = Object.freeze({
    semiMajorAxisKm: 6878,
    eccentricity: 0.001,
    inclinationDeg: 51.6,
    raanDeg: 0,
    argumentOfPeriapsisDeg: 0,
    trueAnomalyDeg: 0
});

const KEPLERIAN_ALIASES = Object.freeze({
    semiMajorAxisKm: ["semiMajorAxisKm", "semi_major_axis_km"],
    eccentricity: ["eccentricity"],
    inclinationDeg: ["inclinationDeg", "inclination_deg"],
    raanDeg: ["raanDeg", "raan_deg"],
    argumentOfPeriapsisDeg: [
        "argumentOfPeriapsisDeg",
        "argument_of_periapsis_deg",
        "argumentOfPerigeeDeg",
        "argument_of_perigee_deg"
    ],
    trueAnomalyDeg: ["trueAnomalyDeg", "true_anomaly_deg"],
    meanAnomalyDeg: ["meanAnomalyDeg", "mean_anomaly_deg"]
});

const STATE_VECTOR_ALIASES = Object.freeze({
    position: ["positionEciKm", "position_eci_km", "positionKm", "position_km"],
    velocity: ["velocityEciKmS", "velocity_eci_km_s", "velocityKmS", "velocity_km_s"],
    positionX: ["positionXKm", "position_x_km"],
    positionY: ["positionYKm", "position_y_km"],
    positionZ: ["positionZKm", "position_z_km"],
    velocityX: ["velocityXKmS", "velocity_x_km_s"],
    velocityY: ["velocityYKmS", "velocity_y_km_s"],
    velocityZ: ["velocityZKmS", "velocity_z_km_s"]
});

const DEFINITION_SOURCE_ALIASES = Object.freeze({
    keplerian: "keplerian",
    elements: "keplerian",
    "state-vector": "state-vector",
    state_vector: "state-vector",
    statevector: "state-vector",
    state: "state-vector"
});

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function hasValue(value) {
    return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}

function readAlias(source, aliases) {
    if (!isRecord(source)) return { found: false, value: undefined };
    for (const key of aliases) {
        if (hasOwn(source, key) && hasValue(source[key])) {
            return { found: true, value: source[key] };
        }
    }
    return { found: false, value: undefined };
}

function valueOrFallback(source, aliases, fallback) {
    const value = readAlias(source, aliases);
    return value.found ? value.value : fallback;
}

function safeObject(value) {
    return isRecord(value) ? value : {};
}

function unwrapPayload(payload) {
    const source = safeObject(payload);
    // Some callers hand over a form inside their event detail.  Keep outer
    // command metadata (such as `source`) authoritative while accepting it.
    if (isRecord(source.form)) return { ...source.form, ...source };
    return source;
}

function asValidationError(error, fallbackMessage) {
    if (error instanceof OrbitalElementsValidationError) return error;
    const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
    return new OrbitalElementsValidationError(`${fallbackMessage}.${detail}`.trim());
}

function normalizeName(value, fallback = DEFAULT_MANUAL_ORBIT_NAME) {
    const candidate = hasValue(value) ? String(value).trim() : String(fallback || DEFAULT_MANUAL_ORBIT_NAME).trim();
    if (!candidate) return DEFAULT_MANUAL_ORBIT_NAME;
    if (candidate.length > 120) {
        throw new OrbitalElementsValidationError("Manual orbit name must not exceed 120 characters.");
    }
    if (/\r|\n/.test(candidate)) {
        throw new OrbitalElementsValidationError("Manual orbit name must not contain line breaks.");
    }
    return candidate;
}

function normalizeEpochUtc(value, fallback) {
    const candidate = hasValue(value) ? value : fallback;
    const date = candidate instanceof Date ? candidate : new Date(candidate);
    if (Number.isNaN(date.getTime())) {
        throw new OrbitalElementsValidationError("epochUtc must be a valid UTC timestamp.");
    }
    return date.toISOString();
}

function normalizePropagator(value, fallback = DEFAULT_MANUAL_ORBIT_PROPAGATOR) {
    const candidate = hasValue(value) ? String(value).trim().toLowerCase() : String(fallback || DEFAULT_MANUAL_ORBIT_PROPAGATOR).trim().toLowerCase();
    if (!candidate) return DEFAULT_MANUAL_ORBIT_PROPAGATOR;
    if (candidate.length > 40) {
        throw new OrbitalElementsValidationError("Propagator name must not exceed 40 characters.");
    }
    return candidate;
}

function normalizeDefinitionSource(value) {
    if (!hasValue(value)) return null;
    const normalized = String(value).trim().toLowerCase().replace(/\s+/g, "-");
    return DEFINITION_SOURCE_ALIASES[normalized] || null;
}

/** Normalize the UI/runtime aliases for a definition source. */
export function normalizeManualOrbitSource(value) {
    return normalizeDefinitionSource(value);
}

function getKeplerianInput(payload) {
    const source = unwrapPayload(payload);
    return safeObject(source.keplerian);
}

function getStateVectorInput(payload) {
    const source = unwrapPayload(payload);
    return safeObject(source.stateVector || source.state_vector);
}

function hasAnyAlias(source, aliasGroups) {
    return aliasGroups.some((aliases) => readAlias(source, aliases).found);
}

function hasKeplerianInput(payload) {
    const source = unwrapPayload(payload);
    const nested = getKeplerianInput(source);
    const aliases = Object.values(KEPLERIAN_ALIASES);
    return hasAnyAlias(nested, aliases) || hasAnyAlias(source, aliases);
}

function hasStateVectorInput(payload) {
    const source = unwrapPayload(payload);
    const nested = getStateVectorInput(source);
    const aliases = Object.values(STATE_VECTOR_ALIASES);
    return hasAnyAlias(nested, aliases) || hasAnyAlias(source, aliases);
}

function mergeRawInputs(nested, root) {
    // Nested payloads are the intended contract, but root-level legacy values
    // remain useful for callers that predate the React editor.
    return { ...safeObject(root), ...safeObject(nested) };
}

function conversionKeplerian(raw, fallback) {
    const source = safeObject(raw);
    const base = safeObject(fallback);
    const trueAnomaly = readAlias(source, KEPLERIAN_ALIASES.trueAnomalyDeg);
    const meanAnomaly = readAlias(source, KEPLERIAN_ALIASES.meanAnomalyDeg);
    // `orbitalElements` intentionally requires precisely one anomaly.  The
    // canonical editor keeps both derived values, so favour a supplied true
    // anomaly and otherwise retain the current canonical true anomaly.
    const anomaly = trueAnomaly.found
        ? { trueAnomalyDeg: trueAnomaly.value }
        : meanAnomaly.found
            ? { meanAnomalyDeg: meanAnomaly.value }
            : { trueAnomalyDeg: valueOrFallback(base, KEPLERIAN_ALIASES.trueAnomalyDeg, DEFAULT_MANUAL_KEPLERIAN.trueAnomalyDeg) };

    return {
        semiMajorAxisKm: valueOrFallback(source, KEPLERIAN_ALIASES.semiMajorAxisKm, valueOrFallback(base, KEPLERIAN_ALIASES.semiMajorAxisKm, DEFAULT_MANUAL_KEPLERIAN.semiMajorAxisKm)),
        eccentricity: valueOrFallback(source, KEPLERIAN_ALIASES.eccentricity, valueOrFallback(base, KEPLERIAN_ALIASES.eccentricity, DEFAULT_MANUAL_KEPLERIAN.eccentricity)),
        inclinationDeg: valueOrFallback(source, KEPLERIAN_ALIASES.inclinationDeg, valueOrFallback(base, KEPLERIAN_ALIASES.inclinationDeg, DEFAULT_MANUAL_KEPLERIAN.inclinationDeg)),
        raanDeg: valueOrFallback(source, KEPLERIAN_ALIASES.raanDeg, valueOrFallback(base, KEPLERIAN_ALIASES.raanDeg, DEFAULT_MANUAL_KEPLERIAN.raanDeg)),
        argumentOfPeriapsisDeg: valueOrFallback(source, KEPLERIAN_ALIASES.argumentOfPeriapsisDeg, valueOrFallback(base, KEPLERIAN_ALIASES.argumentOfPeriapsisDeg, DEFAULT_MANUAL_KEPLERIAN.argumentOfPeriapsisDeg)),
        ...anomaly
    };
}

function normalizeStateVectorInput(raw, fallback) {
    const source = safeObject(raw);
    const base = safeObject(fallback);
    const sourcePosition = readAlias(source, STATE_VECTOR_ALIASES.position);
    const sourceVelocity = readAlias(source, STATE_VECTOR_ALIASES.velocity);
    const basePosition = readAlias(base, STATE_VECTOR_ALIASES.position).value || {};
    const baseVelocity = readAlias(base, STATE_VECTOR_ALIASES.velocity).value || {};
    const sourcePositionValue = safeObject(sourcePosition.value);
    const sourceVelocityValue = safeObject(sourceVelocity.value);

    return {
        positionEciKm: {
            x: valueOrFallback(sourcePositionValue, ["x"], valueOrFallback(source, STATE_VECTOR_ALIASES.positionX, valueOrFallback(basePosition, ["x"], 0))),
            y: valueOrFallback(sourcePositionValue, ["y"], valueOrFallback(source, STATE_VECTOR_ALIASES.positionY, valueOrFallback(basePosition, ["y"], 0))),
            z: valueOrFallback(sourcePositionValue, ["z"], valueOrFallback(source, STATE_VECTOR_ALIASES.positionZ, valueOrFallback(basePosition, ["z"], 0)))
        },
        velocityEciKmS: {
            x: valueOrFallback(sourceVelocityValue, ["x"], valueOrFallback(source, STATE_VECTOR_ALIASES.velocityX, valueOrFallback(baseVelocity, ["x"], 0))),
            y: valueOrFallback(sourceVelocityValue, ["y"], valueOrFallback(source, STATE_VECTOR_ALIASES.velocityY, valueOrFallback(baseVelocity, ["y"], 0))),
            z: valueOrFallback(sourceVelocityValue, ["z"], valueOrFallback(source, STATE_VECTOR_ALIASES.velocityZ, valueOrFallback(baseVelocity, ["z"], 0)))
        }
    };
}

function canonicalKeplerian(value) {
    return {
        semiMajorAxisKm: value.semiMajorAxisKm,
        eccentricity: value.eccentricity,
        inclinationDeg: value.inclinationDeg,
        raanDeg: value.raanDeg,
        argumentOfPeriapsisDeg: value.argumentOfPeriapsisDeg,
        trueAnomalyDeg: value.trueAnomalyDeg,
        meanAnomalyDeg: value.meanAnomalyDeg
    };
}

function canonicalStateVector(value) {
    return {
        positionEciKm: {
            x: value.positionEciKm.x,
            y: value.positionEciKm.y,
            z: value.positionEciKm.z
        },
        velocityEciKmS: {
            x: value.velocityEciKmS.x,
            y: value.velocityEciKmS.y,
            z: value.velocityEciKmS.z
        }
    };
}

function metadataFor(payload, fallback) {
    const source = unwrapPayload(payload);
    const base = safeObject(fallback);
    return {
        name: normalizeName(valueOrFallback(source, ["name"], base.name)),
        epochUtc: normalizeEpochUtc(valueOrFallback(source, ["epochUtc", "epoch_utc", "epoch"], base.epochUtc), base.epochUtc),
        propagator: normalizePropagator(valueOrFallback(source, ["propagator"], base.propagator), base.propagator)
    };
}

function canonicalFromKeplerian(metadata, input, fallbackKeplerian) {
    try {
        const converted = keplerianToStateVector(conversionKeplerian(input, fallbackKeplerian));
        return {
            ...metadata,
            keplerian: canonicalKeplerian(converted),
            stateVector: canonicalStateVector(converted)
        };
    } catch (error) {
        throw asValidationError(error, "Invalid Keplerian manual-orbit definition");
    }
}

function canonicalFromStateVector(metadata, input, fallbackStateVector) {
    try {
        const normalizedStateVector = normalizeStateVectorInput(input, fallbackStateVector);
        const converted = stateVectorToKeplerian(normalizedStateVector);
        return {
            ...metadata,
            keplerian: canonicalKeplerian(converted),
            stateVector: canonicalStateVector(normalizedStateVector)
        };
    } catch (error) {
        throw asValidationError(error, "Invalid ECI state-vector manual-orbit definition");
    }
}

function inferDefinitionSource(payload) {
    if (hasKeplerianInput(payload)) return "keplerian";
    if (hasStateVectorInput(payload)) return "state-vector";
    return null;
}

function sourceInstruction(payload, explicitSource) {
    const source = unwrapPayload(payload);
    const supplied = explicitSource !== undefined
        ? explicitSource
        : valueOrFallback(source, ["definitionSource", "definition_source", "source"], undefined);
    const wasSupplied = explicitSource !== undefined || hasValue(supplied);
    return {
        source: normalizeDefinitionSource(supplied),
        wasSupplied
    };
}

function buildDefaultMetadata(options = {}) {
    const now = options.now ?? options.epochUtc ?? options.epoch ?? new Date();
    return {
        name: normalizeName(options.name, DEFAULT_MANUAL_ORBIT_NAME),
        epochUtc: normalizeEpochUtc(options.epochUtc ?? options.epoch ?? now, now),
        propagator: normalizePropagator(options.propagator, DEFAULT_MANUAL_ORBIT_PROPAGATOR)
    };
}

/**
 * Create the fully synchronized default editor state. `options.now` is useful
 * for deterministic callers and tests; it can be a Date or ISO timestamp.
 */
export function createDefaultManualOrbitState(options = {}) {
    return canonicalFromKeplerian(buildDefaultMetadata(options), DEFAULT_MANUAL_KEPLERIAN, DEFAULT_MANUAL_KEPLERIAN);
}

function canonicalizeCurrent(current) {
    if (!isRecord(current)) return createDefaultManualOrbitState();
    const metadataOptions = {
        name: current.name,
        epochUtc: current.epochUtc ?? current.epoch_utc ?? current.epoch,
        propagator: current.propagator,
        now: current.epochUtc ?? current.epoch_utc ?? current.epoch
    };
    const fallback = createDefaultManualOrbitState(metadataOptions);
    const instruction = sourceInstruction(current, undefined);
    const source = instruction.source || inferDefinitionSource(current) || "keplerian";
    const metadata = metadataFor(current, fallback);
    if (source === "state-vector") {
        const rawState = mergeRawInputs(getStateVectorInput(current), current);
        return canonicalFromStateVector(metadata, rawState, fallback.stateVector);
    }
    const rawKeplerian = mergeRawInputs(getKeplerianInput(current), current);
    return canonicalFromKeplerian(metadata, rawKeplerian, fallback.keplerian);
}

/**
 * Normalize an arbitrary manual-orbit payload to the canonical editor form.
 *
 * Both nested ECI vectors and legacy flat fields such as `positionXKm` are
 * accepted. When no authoritative source is declared, Keplerian values win
 * if both representations are supplied (matching the API's default).
 */
export function normalizeManualOrbitState(payload = {}, options = {}) {
    const source = unwrapPayload(payload);
    const fallback = options.fallback ? canonicalizeCurrent(options.fallback) : createDefaultManualOrbitState({
        now: source.epochUtc ?? source.epoch_utc ?? source.epoch
    });
    const instruction = sourceInstruction(source, options.source);
    const resolvedSource = instruction.source || inferDefinitionSource(source) || "keplerian";
    const metadata = metadataFor(source, fallback);

    if (resolvedSource === "state-vector") {
        return canonicalFromStateVector(metadata, mergeRawInputs(getStateVectorInput(source), source), fallback.stateVector);
    }
    return canonicalFromKeplerian(metadata, mergeRawInputs(getKeplerianInput(source), source), fallback.keplerian);
}

/**
 * Apply a UI/runtime change to a canonical manual-orbit state.
 *
 * `source` accepts `keplerian`, `state-vector`, `stateVector` and backend
 * aliases. Metadata-only changes (`name`, `epoch`, `propagator`) retain the
 * existing synchronized geometry rather than letting a stale form overwrite
 * it. A returned state is always synchronized in both directions.
 */
export function synchronizeManualOrbitState(current, payload = {}, source) {
    const base = canonicalizeCurrent(current);
    const input = unwrapPayload(payload);
    const instruction = sourceInstruction(input, source);
    const resolvedSource = instruction.source || (instruction.wasSupplied ? null : inferDefinitionSource(input));
    const metadata = metadataFor(input, base);

    if (resolvedSource === "state-vector") {
        return canonicalFromStateVector(metadata, mergeRawInputs(getStateVectorInput(input), input), base.stateVector);
    }
    if (resolvedSource === "keplerian") {
        return canonicalFromKeplerian(metadata, mergeRawInputs(getKeplerianInput(input), input), base.keplerian);
    }
    return {
        ...metadata,
        keplerian: canonicalKeplerian(base.keplerian),
        stateVector: canonicalStateVector(base.stateVector)
    };
}

function apiKeplerian(value) {
    return {
        semi_major_axis_km: value.semiMajorAxisKm,
        eccentricity: value.eccentricity,
        inclination_deg: value.inclinationDeg,
        raan_deg: value.raanDeg,
        argument_of_perigee_deg: value.argumentOfPeriapsisDeg,
        true_anomaly_deg: value.trueAnomalyDeg,
        mean_anomaly_deg: value.meanAnomalyDeg
    };
}

function apiStateVector(value) {
    return {
        position_eci_km: { ...value.positionEciKm },
        velocity_eci_km_s: { ...value.velocityEciKmS }
    };
}

function appendApiOption(result, options, optionKey, apiKey) {
    if (!hasValue(options?.[optionKey])) return;
    result[apiKey] = options[optionKey] instanceof Date
        ? options[optionKey].toISOString()
        : options[optionKey];
}

/**
 * Serialize a canonical/manual UI state for the Python manual-orbit endpoint.
 * The endpoint receives both representations, while `definition_source`
 * records the form the user last edited and therefore must be propagated.
 */
export function toManualOrbitApiPayload(state, options = {}) {
    const source = normalizeDefinitionSource(options.source) || "keplerian";
    const canonical = normalizeManualOrbitState(state, { source });
    const result = {
        name: canonical.name,
        epoch: canonical.epochUtc,
        propagator: canonical.propagator,
        definition_source: source,
        keplerian: apiKeplerian(canonical.keplerian),
        state_vector: apiStateVector(canonical.stateVector)
    };
    appendApiOption(result, options, "startTime", "start_time");
    appendApiOption(result, options, "endTime", "end_time");
    appendApiOption(result, options, "horizonHours", "horizon_hours");
    appendApiOption(result, options, "stepSeconds", "step_seconds");
    if (typeof options.includeVelocity === "boolean") result.include_velocity = options.includeVelocity;
    return result;
}
