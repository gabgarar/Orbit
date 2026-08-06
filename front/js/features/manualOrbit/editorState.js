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
// A manually designed trajectory has a physical ECI state at its epoch, so
// two-body propagation is the honest default.  SGP4 remains available for
// TLE-compatible scenarios, but is not silently imposed on new designs.
export const DEFAULT_MANUAL_ORBIT_PROPAGATOR = "two-body";

// These values describe the authored object and the propagation model, not
// its instantaneous geometry.  Keeping them in the canonical editor state
// means a manual orbit can be reopened without losing its administrative
// identity or the physical assumptions used to generate it.
export const DEFAULT_MANUAL_ORBIT_OBJECT_METADATA = Object.freeze({
    objectType: "satellite",
    missionType: "",
    operator: "",
    country: "",
    launchDate: ""
});

export const DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS = Object.freeze({
    atmosphericDrag: false,
    dragCoefficient: 2.2,
    areaM2: 1,
    massKg: 100,
    // `forceTerms` is the canonical force-model contract. The central term
    // is mandatory; the remaining terms are independently selectable by the
    // Cowell numerical engine. `cowellGravityModel` remains only as a
    // derived compatibility projection for older saved projects/API clients.
    forceTerms: Object.freeze(["central"]),
    cowellGravityModel: "two-body",
    // Keep the numerical method explicit instead of baking it into a force
    // model. Today Cowell exposes RK4; this field makes later methods (for
    // example RKF78) a compatible extension of the project/API contract.
    numericalIntegrator: "rk4"
});

const MANUAL_ORBIT_PROPAGATOR_ALIASES = Object.freeze({
    "two-body": "two-body",
    two_body: "two-body",
    twobody: "two-body",
    kepler: "two-body",
    keplerian: "two-body",
    j2: "j2",
    "j2-secular": "j2",
    "j2-analytic": "j2",
    "j2-j3-j4": "j2-j3-j4",
    j2_j3_j4: "j2-j3-j4",
    j2j3j4: "j2-j3-j4",
    "j2-j3-j4-secular": "j2-j3-j4",
    "cowell-rk4": "cowell-rk4",
    cowell_rk4: "cowell-rk4",
    cowell: "cowell-rk4",
    rk4: "cowell-rk4",
    sgp4: "sgp4",
    "sgp-4": "sgp4"
});

const MANUAL_ORBIT_NUMERICAL_INTEGRATOR_ALIASES = Object.freeze({
    rk4: "rk4",
    "rk-4": "rk4",
    runge_kutta_4: "rk4",
    "runge-kutta-4": "rk4",
    rungekutta4: "rk4"
});

const MANUAL_ORBIT_FORCE_TERM_ORDER = Object.freeze(["central", "j2", "j3", "j4", "drag"]);

const MANUAL_ORBIT_FORCE_TERM_ALIASES = Object.freeze({
    central: "central",
    "central-gravity": "central",
    "two-body": "central",
    twobody: "central",
    kepler: "central",
    keplerian: "central",
    j2: "j2",
    j3: "j3",
    j4: "j4",
    drag: "drag",
    "atmospheric-drag": "drag",
    atmospheric: "drag"
});

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

const OBJECT_METADATA_ALIASES = Object.freeze({
    objectType: ["objectType", "object_type", "type"],
    missionType: ["missionType", "mission_type", "mission"],
    operator: ["operator", "operatorName", "operator_name"],
    country: ["country", "countryCode", "country_code", "operatorCountry", "operator_country"],
    launchDate: ["launchDate", "launch_date"]
});

const PROPAGATION_OPTIONS_ALIASES = Object.freeze({
    atmosphericDrag: ["atmosphericDrag", "atmospheric_drag"],
    dragCoefficient: ["dragCoefficient", "drag_coefficient"],
    areaM2: ["areaM2", "area_m2"],
    massKg: ["massKg", "mass_kg"],
    forceTerms: ["forceTerms", "force_terms", "gravityTerms", "gravity_terms"],
    cowellGravityModel: ["cowellGravityModel", "cowell_gravity_model", "forceModel", "force_model"],
    numericalIntegrator: ["numericalIntegrator", "numerical_integrator"]
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

// Object metadata intentionally permits an empty string: clearing an
// operator or launch date must not revive an older value from the fallback
// state. Geometry fields, by contrast, use `readAlias` and require a value.
function readAliasIncludingEmpty(source, aliases) {
    if (!isRecord(source)) return { found: false, value: undefined };
    for (const key of aliases) {
        if (hasOwn(source, key)) {
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

function nestedRecord(source, camelKey, snakeKey) {
    const sourceRecord = safeObject(source);
    if (isRecord(sourceRecord[camelKey])) return sourceRecord[camelKey];
    if (isRecord(sourceRecord[snakeKey])) return sourceRecord[snakeKey];
    return {};
}

function normalizedText(value, fallback = "", { fallbackWhenEmpty = false, maximumLength = 160 } = {}) {
    const candidate = value === undefined || value === null ? "" : String(value).trim();
    if (candidate.length > maximumLength) {
        throw new OrbitalElementsValidationError(`Manual orbit metadata must not exceed ${maximumLength} characters.`);
    }
    return candidate || (fallbackWhenEmpty ? String(fallback || "").trim() : "");
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "yes", "on"].includes(normalized)) return true;
        if (["false", "0", "no", "off", ""].includes(normalized)) return false;
    }
    return fallback === true;
}

function normalizePositiveNumber(value, fallback, label, { minimum = 0, strictlyPositive = false } = {}) {
    const raw = value === undefined || value === null || value === "" ? fallback : value;
    const numeric = Number(raw);
    const valid = Number.isFinite(numeric)
        && (strictlyPositive ? numeric > minimum : numeric >= minimum);
    if (!valid) {
        const comparison = strictlyPositive ? "greater than" : "at least";
        throw new OrbitalElementsValidationError(`${label} must be ${comparison} ${minimum}.`);
    }
    return numeric;
}

function normalizeObjectMetadata(value, fallback = DEFAULT_MANUAL_ORBIT_OBJECT_METADATA) {
    const source = safeObject(value);
    const base = safeObject(fallback);
    const read = (key) => {
        const supplied = readAliasIncludingEmpty(source, OBJECT_METADATA_ALIASES[key]);
        if (supplied.found) return supplied.value;
        return readAliasIncludingEmpty(base, OBJECT_METADATA_ALIASES[key]).value;
    };
    return {
        objectType: normalizedText(
            read("objectType"),
            DEFAULT_MANUAL_ORBIT_OBJECT_METADATA.objectType,
            { fallbackWhenEmpty: true, maximumLength: 80 }
        ),
        missionType: normalizedText(read("missionType"), "", { maximumLength: 160 }),
        operator: normalizedText(read("operator"), "", { maximumLength: 160 }),
        country: normalizedText(read("country"), "", { maximumLength: 120 }),
        launchDate: normalizedText(read("launchDate"), "", { maximumLength: 64 })
    };
}

function optionAlias(source, key) {
    const result = readAliasIncludingEmpty(source, PROPAGATION_OPTIONS_ALIASES[key]);
    // `undefined`/`null` do not express a chosen force model. An explicit
    // empty array, however, intentionally means central gravity only.
    return result.found && result.value !== undefined && result.value !== null
        ? result
        : { found: false, value: undefined };
}

function forceTermInputValues(value) {
    if (Array.isArray(value)) {
        return value.flatMap((entry) => forceTermInputValues(entry));
    }
    if (value === undefined || value === null) return [];
    if (typeof value === "string") {
        const compact = value.trim().toLowerCase().replace(/[\s_+/]+/g, "-");
        if (["j2-j3-j4", "j2j3j4"].includes(compact)) {
            return ["j2", "j3", "j4"];
        }
        // Accept compact request forms such as `central + J2 + drag` without
        // treating the legacy `forceModel` field as an array contract.
        return value.split(/[,;+|]/g);
    }
    return [value];
}

function normalizeForceTerm(value) {
    const candidate = String(value ?? "").trim().toLowerCase().replace(/[\s_+/]+/g, "-");
    if (!candidate) return null;
    if (candidate.length > 40 || !/^[a-z][a-z0-9-]*$/.test(candidate)) {
        throw new OrbitalElementsValidationError("Force-term identifiers must be short lowercase names.");
    }
    return MANUAL_ORBIT_FORCE_TERM_ALIASES[candidate] || candidate;
}

/**
 * Canonicalize independently selectable force terms. `central` is always
 * present, known terms use a stable physical order, and unknown future terms
 * are retained after known terms so a project is not silently rewritten by
 * an older browser.
 */
export function normalizeManualOrbitForceTerms(value, fallback = DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.forceTerms) {
    const raw = value === undefined || value === null ? fallback : value;
    const supplied = forceTermInputValues(raw)
        .map((entry) => normalizeForceTerm(entry))
        .filter(Boolean);
    const seen = new Set(["central", ...supplied]);
    const known = MANUAL_ORBIT_FORCE_TERM_ORDER.filter((term) => seen.has(term));
    const future = [...seen].filter((term) => !MANUAL_ORBIT_FORCE_TERM_ORDER.includes(term));
    return [...known, ...future];
}

function forceTermsFromLegacyModel(value, fallback = DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.cowellGravityModel) {
    switch (normalizeCowellGravityModel(value, fallback)) {
        case "two-body":
            return ["central"];
        case "j2":
            return ["central", "j2"];
        default:
            return ["central", "j2", "j3", "j4"];
    }
}

function legacyModelFromForceTerms(forceTerms) {
    const normalized = normalizeManualOrbitForceTerms(forceTerms).filter((term) => term !== "drag");
    // The legacy field cannot represent arbitrary combinations. Project only
    // exact historical presets; a nearest-match would silently advertise
    // different physics than the explicit forceTerms actually describe.
    if (normalized.some((term) => !MANUAL_ORBIT_FORCE_TERM_ORDER.includes(term))) {
        return null;
    }
    if (normalized.includes("j3") || normalized.includes("j4")) {
        return normalized.includes("j2") && normalized.includes("j3") && normalized.includes("j4")
            ? "j2-j3-j4"
            : null;
    }
    if (normalized.includes("j2")) return "j2";
    return "two-body";
}

function hasLegacyPropagationOptionSignal(source) {
    const record = safeObject(source);
    // Before forceTerms existed, a Cowell configuration could contain only
    // its drag settings or numerical-integrator choice. Those payloads
    // historically defaulted to the full J2 + J3 + J4 gravity preset. A
    // genuinely new, empty options object remains the central-gravity default.
    return [
        ...PROPAGATION_OPTIONS_ALIASES.atmosphericDrag,
        ...PROPAGATION_OPTIONS_ALIASES.dragCoefficient,
        ...PROPAGATION_OPTIONS_ALIASES.areaM2,
        ...PROPAGATION_OPTIONS_ALIASES.massKg,
        ...PROPAGATION_OPTIONS_ALIASES.numericalIntegrator
    ].some((key) => hasOwn(record, key));
}

function resolveForceTerms(source, base) {
    const suppliedTerms = optionAlias(source, "forceTerms");
    if (suppliedTerms.found) {
        // New forceTerms/gravityTerms are canonical and deliberately override
        // every legacy gravity/drag flag found in the same payload.
        return normalizeManualOrbitForceTerms(suppliedTerms.value);
    }

    const suppliedLegacyModel = optionAlias(source, "cowellGravityModel");
    const fallbackTerms = optionAlias(base, "forceTerms");
    const fallbackLegacyModel = optionAlias(base, "cowellGravityModel");
    const suppliedDrag = optionAlias(source, "atmosphericDrag");
    const fallbackDrag = optionAlias(base, "atmosphericDrag");

    let gravityTerms;
    if (suppliedLegacyModel.found) {
        gravityTerms = forceTermsFromLegacyModel(suppliedLegacyModel.value);
    } else if (hasLegacyPropagationOptionSignal(source)) {
        gravityTerms = forceTermsFromLegacyModel("j2-j3-j4");
    } else if (fallbackTerms.found) {
        gravityTerms = normalizeManualOrbitForceTerms(fallbackTerms.value).filter((term) => term !== "drag");
    } else if (fallbackLegacyModel.found) {
        gravityTerms = forceTermsFromLegacyModel(fallbackLegacyModel.value);
    } else {
        gravityTerms = normalizeManualOrbitForceTerms(DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.forceTerms);
    }

    const inheritedDrag = fallbackTerms.found
        ? normalizeManualOrbitForceTerms(fallbackTerms.value).includes("drag")
        : normalizeBoolean(fallbackDrag.value, DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.atmosphericDrag);
    const dragEnabled = suppliedDrag.found
        ? normalizeBoolean(suppliedDrag.value, inheritedDrag)
        : inheritedDrag;
    return normalizeManualOrbitForceTerms([...gravityTerms, ...(dragEnabled ? ["drag"] : [])]);
}

function normalizePropagationOptions(value, fallback = DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS) {
    const source = safeObject(value);
    const base = safeObject(fallback);
    const read = (key) => {
        const supplied = optionAlias(source, key);
        if (supplied.found) return supplied.value;
        return optionAlias(base, key).value;
    };
    const forceTerms = resolveForceTerms(source, base);
    return {
        // These two fields are compatibility projections. New callers should
        // use forceTerms, where membership of `drag` is the source of truth.
        atmosphericDrag: forceTerms.includes("drag"),
        dragCoefficient: normalizePositiveNumber(
            read("dragCoefficient"),
            DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.dragCoefficient,
            "Drag coefficient",
            { minimum: 0 }
        ),
        areaM2: normalizePositiveNumber(
            read("areaM2"),
            DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.areaM2,
            "Reference area",
            { minimum: 0, strictlyPositive: true }
        ),
        massKg: normalizePositiveNumber(
            read("massKg"),
            DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.massKg,
            "Mass",
            { minimum: 0, strictlyPositive: true }
        ),
        forceTerms,
        cowellGravityModel: legacyModelFromForceTerms(forceTerms),
        numericalIntegrator: normalizeManualOrbitNumericalIntegrator(
            read("numericalIntegrator"),
            DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS.numericalIntegrator
        )
    };
}

function normalizeCowellGravityModel(value, fallback = "two-body") {
    const candidate = normalizeManualOrbitPropagator(value, fallback);
    return ["two-body", "j2", "j2-j3-j4"].includes(candidate)
        ? candidate
        : fallback;
}

function forceTermsForFixedEngine(propagator) {
    if (propagator === "two-body" || propagator === "sgp4") return ["central"];
    if (propagator === "j2") return ["central", "j2"];
    if (propagator === "j2-j3-j4") return ["central", "j2", "j3", "j4"];
    return null;
}

function scopePropagationOptionsToEngine(propagator, propagationOptions) {
    let forceTerms = normalizeManualOrbitForceTerms(propagationOptions.forceTerms);
    const fixedForceTerms = forceTermsForFixedEngine(propagator);
    // The selected engine is physically authoritative. A two-body or SGP4
    // object must not persist/echo J2/J3/J4 merely because those were left in
    // a Cowell design draft; legacy public presets likewise retain their
    // historical force composition exactly.
    if (fixedForceTerms) {
        forceTerms = fixedForceTerms;
    }
    forceTerms = normalizeManualOrbitForceTerms(forceTerms);
    return {
        ...propagationOptions,
        forceTerms,
        atmosphericDrag: forceTerms.includes("drag"),
        cowellGravityModel: legacyModelFromForceTerms(forceTerms)
    };
}

/**
 * Normalize a numerical-integration method independently from a force
 * model. Unknown values remain serializable so saved projects can survive a
 * client deployed before a future integrator is added to its selector; the
 * backend remains authoritative about availability at execution time.
 */
export function normalizeManualOrbitNumericalIntegrator(value, fallback = "rk4") {
    const raw = hasValue(value) ? value : (hasValue(fallback) ? fallback : "rk4");
    const candidate = String(raw).trim().toLowerCase().replace(/[\s_+/]+/g, "-");
    if (!candidate) return "rk4";
    if (candidate.length > 40) {
        throw new OrbitalElementsValidationError("Numerical integrator name must not exceed 40 characters.");
    }
    return MANUAL_ORBIT_NUMERICAL_INTEGRATOR_ALIASES[candidate] || candidate;
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

/**
 * Normalize the currently supported aliases without closing the persisted
 * project format to future propagators.  The backend remains authoritative
 * for whether a named model is available at run time.
 */
export function normalizeManualOrbitPropagator(value, fallback = DEFAULT_MANUAL_ORBIT_PROPAGATOR) {
    const raw = hasValue(value)
        ? value
        : (hasValue(fallback) ? fallback : DEFAULT_MANUAL_ORBIT_PROPAGATOR);
    const candidate = String(raw).trim().toLowerCase().replace(/[\s_+/]+/g, "-");
    if (!candidate) return DEFAULT_MANUAL_ORBIT_PROPAGATOR;
    if (candidate.length > 40) {
        throw new OrbitalElementsValidationError("Propagator name must not exceed 40 characters.");
    }
    return MANUAL_ORBIT_PROPAGATOR_ALIASES[candidate] || candidate;
}

function normalizePropagator(value, fallback = DEFAULT_MANUAL_ORBIT_PROPAGATOR) {
    return normalizeManualOrbitPropagator(value, fallback);
}

function normalizeDefinitionSource(value) {
    if (!hasValue(value)) return null;
    const normalized = String(value).trim().toLowerCase().replace(/\s+/g, "-");
    return DEFINITION_SOURCE_ALIASES[normalized] || null;
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
    const propagator = normalizePropagator(valueOrFallback(source, ["propagator"], base.propagator), base.propagator);
    const rawPropagationOptions = nestedRecord(source, "propagationOptions", "propagation_options");
    const propagationOptions = scopePropagationOptionsToEngine(
        propagator,
        normalizePropagationOptions(
            rawPropagationOptions,
        base.propagationOptions ?? base.propagation_options ?? DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS
        )
    );
    return {
        name: normalizeName(valueOrFallback(source, ["name"], base.name)),
        epochUtc: normalizeEpochUtc(valueOrFallback(source, ["epochUtc", "epoch_utc", "epoch"], base.epochUtc), base.epochUtc),
        propagator,
        objectMetadata: normalizeObjectMetadata(
            nestedRecord(source, "objectMetadata", "object_metadata"),
            base.objectMetadata ?? base.object_metadata ?? DEFAULT_MANUAL_ORBIT_OBJECT_METADATA
        ),
        propagationOptions
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
    const propagator = normalizePropagator(options.propagator, DEFAULT_MANUAL_ORBIT_PROPAGATOR);
    const rawPropagationOptions = nestedRecord(options, "propagationOptions", "propagation_options");
    const propagationOptions = scopePropagationOptionsToEngine(
        propagator,
        normalizePropagationOptions(
            rawPropagationOptions,
        DEFAULT_MANUAL_ORBIT_PROPAGATION_OPTIONS
        )
    );
    return {
        name: normalizeName(options.name, DEFAULT_MANUAL_ORBIT_NAME),
        epochUtc: normalizeEpochUtc(options.epochUtc ?? options.epoch ?? now, now),
        propagator,
        objectMetadata: normalizeObjectMetadata(
            nestedRecord(options, "objectMetadata", "object_metadata"),
            DEFAULT_MANUAL_ORBIT_OBJECT_METADATA
        ),
        propagationOptions
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
        objectMetadata: current.objectMetadata ?? current.object_metadata,
        propagationOptions: current.propagationOptions ?? current.propagation_options,
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

function apiObjectMetadata(value) {
    return {
        object_type: value.objectType,
        mission_type: value.missionType,
        operator: value.operator,
        country: value.country,
        launch_date: value.launchDate
    };
}

function apiPropagationOptions(value, propagator) {
    const result = {
        // Canonical model contract. An exact historical gravity alias is
        // added below only when one exists; custom compositions must not be
        // rounded to a different legacy model.
        force_terms: [...value.forceTerms],
        atmospheric_drag: value.atmosphericDrag,
        drag_coefficient: value.dragCoefficient,
        area_m2: value.areaM2,
        mass_kg: value.massKg
    };
    // RK4 is an implementation detail of Cowell. Fixed analytical/legacy
    // engines must not advertise a numerical integrator merely because an
    // older project retained that editor field. Keep unknown future engines
    // untouched so a newer project's contract is not destroyed by this UI.
    const fixedEngineTerms = forceTermsForFixedEngine(normalizePropagator(propagator));
    if (!fixedEngineTerms) {
        result.numerical_integrator = value.numericalIntegrator;
        if (value.cowellGravityModel) {
            result.cowell_gravity_model = value.cowellGravityModel;
        }
    }
    return result;
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
        state_vector: apiStateVector(canonical.stateVector),
        object_metadata: apiObjectMetadata(canonical.objectMetadata),
        propagation_options: apiPropagationOptions(canonical.propagationOptions, canonical.propagator)
    };
    appendApiOption(result, options, "startTime", "start_time");
    appendApiOption(result, options, "endTime", "end_time");
    appendApiOption(result, options, "horizonHours", "horizon_hours");
    appendApiOption(result, options, "stepSeconds", "step_seconds");
    if (typeof options.includeVelocity === "boolean") result.include_velocity = options.includeVelocity;
    return result;
}
