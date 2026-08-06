import { useEffect, useRef, useState } from "react";
import { emitPropagatedParametersOpen } from "../../../front/js/runtime/propagatedParametersEvents.js";

/**
 * UI/event boundary for manually authored orbits.
 *
 * Commands accepted by this component:
 * - `orbit:manual-orbit-open` / `orbit:manual-orbit-close` /
 *   `orbit:manual-orbit-cancel`
 * - `orbit:manual-orbit-toggle` (`detail.open` is optional)
 * - `orbit:manual-orbit-state` ({ open?, tab?, keplerian?, stateVector?,
 *   epochUtc?, epochStartUtc?, epochEndUtc?, groundTrackPreview?,
 *   previewReferenceFrame?, propagator?, objectMetadata?,
 *   propagationOptions? })
 *   to hydrate or synchronize the form. `epochUtc` remains the compatibility
 *   alias for the initial epoch. State
 *   vectors use `{ positionEciKm: { x, y, z }, velocityEciKmS: { x, y, z } }`.
 * - `orbit:manual-orbit-status` ({ kind: "error" | "busy" | "success",
 *   message }) for non-blocking runtime feedback.
 *
 * Events emitted by this component:
 * - `orbit:manual-orbit-panel-state` ({ open, mode: "design" })
 * - `orbit:manual-orbit-change` ({ source, field?, value?, ...payload })
 * - `orbit:manual-orbit-tab-change` ({ tab, ...payload })
 * - `orbit:manual-orbit-sync-request` ({ source, target, ...payload })
 * - `orbit:manual-orbit-create` (full payload)
 * - `orbit:manual-orbit-reset` (the restored payload)
 * - `orbit:manual-orbit-cancel` (full payload when the draft is cancelled)
 * - `orbit:manual-orbit-close` (full payload when this panel requests close)
 *
 * The runtime owns conversion and propagation. In particular, it must answer
 * a change/sync request with `orbit:manual-orbit-state` after converting the
 * other representation; this keeps the React form free of orbital math.
 */

const KEPLERIAN_FIELDS = [
    { key: "semiMajorAxisKm", label: "Semieje mayor", unit: "km", min: 6578, max: 50000, inputMin: 6378.138, inputMax: 500000, step: 1, digits: 0 },
    { key: "eccentricity", label: "Excentricidad", unit: "", min: 0, max: 0.95, inputMin: 0, inputMax: 0.999999, step: 0.0001, digits: 4 },
    { key: "inclinationDeg", label: "Inclinaci\u00f3n", unit: "deg", min: 0, max: 180, step: 0.1, digits: 1 },
    { key: "raanDeg", label: "RAAN", unit: "deg", min: 0, max: 360, step: 0.1, digits: 1 },
    { key: "argumentOfPeriapsisDeg", label: "Argumento de periapsis", unit: "deg", min: 0, max: 360, step: 0.1, digits: 1 },
    { key: "trueAnomalyDeg", label: "Anomal\u00eda verdadera", unit: "deg", min: 0, max: 360, step: 0.1, digits: 1 }
];

const STATE_VECTOR_FIELDS = [
    { key: "positionXKm", label: "Posici\u00f3n X", unit: "km", min: -50000, max: 50000, inputMin: -500000, inputMax: 500000, step: 1, digits: 0 },
    { key: "positionYKm", label: "Posici\u00f3n Y", unit: "km", min: -50000, max: 50000, inputMin: -500000, inputMax: 500000, step: 1, digits: 0 },
    { key: "positionZKm", label: "Posici\u00f3n Z", unit: "km", min: -50000, max: 50000, inputMin: -500000, inputMax: 500000, step: 1, digits: 0 },
    { key: "velocityXKmS", label: "Velocidad X", unit: "km/s", min: -20, max: 20, inputMin: -100, inputMax: 100, step: 0.001, digits: 3 },
    { key: "velocityYKmS", label: "Velocidad Y", unit: "km/s", min: -20, max: 20, inputMin: -100, inputMax: 100, step: 0.001, digits: 3 },
    { key: "velocityZKmS", label: "Velocidad Z", unit: "km/s", min: -20, max: 20, inputMin: -100, inputMax: 100, step: 0.001, digits: 3 }
];

// Keep the identifiers here aligned with the propagation boundary in the
// runtime.  A propagation engine is deliberately kept separate from its
// force model: J2/J3/J4 describe forces, not integrators.
const PROPAGATION_ENGINE_OPTIONS = [
    {
        value: "two-body",
        label: "Kepler analytical",
        availability: "Recommended",
        description: "Analytical central-gravity propagation. Best baseline for manually designed trajectories."
    },
    {
        value: "cowell-rk4",
        label: "Cowell numerical",
        availability: "Numerical",
        description: "Numerically integrates the selected force model. Choose its integrator and optional atmospheric drag below."
    }
];

// Older saved projects exposed these gravity models as top-level
// propagators. Keep the value visible and untouched until the user explicitly
// migrates it to Cowell numerical + the corresponding force model.
const LEGACY_PROPAGATOR_OPTIONS = [
    {
        value: "sgp4",
        label: "Legacy SGP4 / synthetic TLE",
        availability: "Legacy / unavailable",
        description: "SGP4 is not available for manual orbit design. An EME2000 state cannot be converted directly into a NORAD TLE; create the orbit with a physical propagator and use synthetic-TLE export when that workflow is available.",
        unavailable: true,
        legacy: true
    },
    {
        value: "j2",
        label: "Legacy force preset: J2",
        availability: "Legacy preset",
        description: "This project stored J2 as a propagator. It has not been changed. To edit it with the new architecture, explicitly choose Cowell numerical and the J2 force model.",
        unavailable: true,
        legacy: true
    },
    {
        value: "j2-j3-j4",
        label: "Legacy force preset: J2 + J3 + J4",
        availability: "Legacy preset",
        description: "This project stored J2 + J3 + J4 as a propagator. It has not been changed. To edit it with the new architecture, explicitly choose Cowell numerical and the J2 + J3 + J4 force model.",
        unavailable: true,
        legacy: true
    }
];

const COWELL_NUMERICAL_INTEGRATOR_OPTIONS = [
    { value: "rk4", label: "RK4 (Runge-Kutta 4)", description: "Fixed-step fourth-order Runge-Kutta." }
];

const FORCE_TERM_OPTIONS = [
    { value: "central", label: "Central gravity", description: "Always active" },
    { value: "j2", label: "J2", description: "Earth oblateness" },
    { value: "j3", label: "J3", description: "North–south asymmetry" },
    { value: "j4", label: "J4", description: "Higher zonal harmonic" },
    { value: "drag", label: "Atmospheric drag", description: "Density-based perturbation" }
];

const FORCE_TERM_VALUES = FORCE_TERM_OPTIONS.map((option) => option.value);
// Start new designs from the physical baseline. Higher-order harmonics are
// explicit opt-ins, rather than dormant values that a Two-body orbit would
// appear to use without actually applying them.
const DEFAULT_FORCE_TERMS = Object.freeze(["central"]);

function datetimeInputFor(date) {
    return date.toISOString().slice(0, 16);
}

function nowForDatetimeInput() {
    return datetimeInputFor(new Date());
}

function addHoursToDatetimeInput(value, hours) {
    const date = new Date(toUtcEpoch(value));
    if (Number.isNaN(date.getTime())) return value;
    date.setUTCHours(date.getUTCHours() + hours);
    return datetimeInputFor(date);
}

function toUtcEpoch(value) {
    if (typeof value !== "string" || !value) return "";
    const normalized = /(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}${value.length === 16 ? ":00" : ""}Z`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function toDatetimeInput(value, fallback) {
    const utcEpoch = toUtcEpoch(value);
    const date = new Date(utcEpoch);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString().slice(0, 16);
}

function normalizePreviewReferenceFrame(value, fallback = "eme2000") {
    const normalize = (candidate) => {
        const normalized = String(candidate || "").trim().toLowerCase();
        if (["itrf", "ecef", "earth-fixed", "earth_fixed"].includes(normalized)) return "itrf";
        if (["eme2000", "eci", "inertial"].includes(normalized)) return "eme2000";
        return null;
    };
    return normalize(value) || normalize(fallback) || "eme2000";
}

function canonicalPropagatorName(value) {
    // Accept labels such as "J2 + J3 + J4" as well as persisted IDs.  The
    // selector itself emits IDs, but opening an older/project-created record
    // must never turn a valid higher-order model into an "unavailable" one.
    const normalized = String(value || "").trim().toLowerCase().replace(/[\s_+]+/g, "-");
    if (!normalized) return "";
    if (["two-body", "twobody", "kepler", "keplerian"].includes(normalized)) return "two-body";
    if (["j2", "j2-secular", "j2-analytic"].includes(normalized)) return "j2";
    if (["j2-j3-j4", "j2j3j4", "j2-j3j4", "j2j3-j4"].includes(normalized)) return "j2-j3-j4";
    if (["cowell-rk4", "cowellrk4", "cowell", "rk4"].includes(normalized)) return "cowell-rk4";
    if (["sgp4", "sgp-4"].includes(normalized)) return "sgp4";
    return normalized;
}

function normalizePropagator(value, fallback = "two-body") {
    // Preserve a project model that this UI does not know yet.  Selecting a
    // different model remains explicit; opening an older/future project must
    // never silently rewrite its propagator to Two-body.
    return canonicalPropagatorName(value) || canonicalPropagatorName(fallback) || "two-body";
}

function normalizeCowellGravityModel(value, fallback = "two-body") {
    const candidate = canonicalPropagatorName(value);
    return ["two-body", "j2", "j2-j3-j4"].includes(candidate)
        ? candidate
        : fallback;
}

function normalizeNumericalIntegrator(value, fallback = "rk4") {
    const normalized = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
    if (["rk4", "rk-4", "runge-kutta-4", "rungekutta4"].includes(normalized)) return "rk4";
    return fallback;
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "yes", "on"].includes(normalized)) return true;
        if (["false", "0", "no", "off", ""].includes(normalized)) return false;
    }
    return fallback;
}

function propagatorOptionFor(value) {
    const known = PROPAGATION_ENGINE_OPTIONS.find((option) => option.value === value)
        ?? LEGACY_PROPAGATOR_OPTIONS.find((option) => option.value === value);
    if (known) return known;
    return {
        value,
        label: `Unavailable model: ${value}`,
        availability: "Unavailable",
        description: "This project uses a propagator unavailable in this build. Choose an installed model before updating the orbit.",
        unavailable: true
    };
}

function normalizeForceTerm(value) {
    const normalized = String(value || "").trim().toLowerCase().replace(/[\s_+]+/g, "-");
    if (["central", "central-gravity", "two-body", "twobody", "kepler"].includes(normalized)) return "central";
    if (["j2", "j-2"].includes(normalized)) return "j2";
    if (["j3", "j-3"].includes(normalized)) return "j3";
    if (["j4", "j-4"].includes(normalized)) return "j4";
    if (["drag", "atmospheric-drag", "atmosphericdrag"].includes(normalized)) return "drag";
    // Keep a future term intact when an older UI opens the project. It is not
    // rendered as a checkbox until this build supports it, but must never be
    // silently discarded merely because the user adjusts J2 or drag.
    return /^[a-z][a-z0-9-]{0,39}$/.test(normalized) ? normalized : "";
}

function parseForceTerms(value) {
    if (Array.isArray(value)) {
        return {
            present: true,
            terms: value.flatMap((entry) => parseForceTerms(entry).terms)
        };
    }
    if (typeof value === "string") {
        const compact = value.trim().toLowerCase().replace(/[\s_+]+/g, "-");
        // Historical scalar presets are accepted as an input convenience,
        // but immediately expanded into the independent-term representation.
        if (["j2-j3-j4", "j2j3j4"].includes(compact)) {
            return { present: true, terms: ["j2", "j3", "j4"] };
        }
        return {
            present: true,
            terms: value.split(/[\s,;+|]+/).map(normalizeForceTerm).filter(Boolean)
        };
    }
    if (!value || typeof value !== "object") {
        const term = normalizeForceTerm(value);
        return { present: value !== undefined && value !== null, terms: term ? [term] : [] };
    }
    const knownKeys = {
        central: ["central", "centralGravity", "central_gravity"],
        j2: ["j2"],
        j3: ["j3"],
        j4: ["j4"],
        drag: ["drag", "atmosphericDrag", "atmospheric_drag"]
    };
    const terms = Object.entries(knownKeys).flatMap(([term, keys]) => keys.some((key) => value[key] === true) ? [term] : []);
    const present = Object.values(knownKeys).some((keys) => keys.some((key) => Object.hasOwn(value, key)));
    return { present, terms };
}

function normalizeForceTerms(value, fallback = DEFAULT_FORCE_TERMS, legacyGravityModel = "two-body", legacyAtmosphericDrag = false) {
    const parsed = parseForceTerms(value);
    const fallbackParsed = parseForceTerms(fallback);
    const rawTerms = parsed.present
        ? parsed.terms
        : fallbackParsed.present
            ? fallbackParsed.terms
            : forceTermsForLegacyGravityModel(legacyGravityModel, legacyAtmosphericDrag);
    const unique = new Set(rawTerms.filter(Boolean));
    unique.add("central");
    return [
        ...FORCE_TERM_VALUES.filter((term) => unique.has(term)),
        ...[...unique].filter((term) => !FORCE_TERM_VALUES.includes(term))
    ];
}

function forceTermsForLegacyGravityModel(value, atmosphericDrag = false) {
    const model = normalizeCowellGravityModel(value, "two-body");
    const terms = ["central"];
    if (model === "j2" || model === "j2-j3-j4") terms.push("j2");
    if (model === "j2-j3-j4") terms.push("j3", "j4");
    if (atmosphericDrag) terms.push("drag");
    return terms;
}

function legacyGravityModelForForceTerms(forceTerms) {
    const terms = new Set(normalizeForceTerms(forceTerms, ["central"], "two-body", false));
    const unsupported = [...terms].filter((term) => !FORCE_TERM_VALUES.includes(term));
    if (unsupported.length) return null;
    if (terms.has("j3") || terms.has("j4")) {
        return terms.has("j2") && terms.has("j3") && terms.has("j4")
            ? "j2-j3-j4"
            : null;
    }
    return terms.has("j2") ? "j2" : "two-body";
}

function forceTermsLabel(forceTerms) {
    const terms = new Set(forceTerms);
    const known = FORCE_TERM_OPTIONS
        .filter((option) => terms.has(option.value))
        .map((option) => option.label)
    const unsupported = forceTerms
        .filter((term) => !FORCE_TERM_VALUES.includes(term))
        .map((term) => `${String(term).toUpperCase()} (unavailable)`);
    return [...known, ...unsupported].join(", ");
}

function createDefaultForm() {
    const epochStartUtc = nowForDatetimeInput();
    return {
        name: "Manual Orbit",
        // `epochUtc` remains in local form state only as an adapter for the
        // original runtime contract. The explicit design range is canonical.
        epochUtc: epochStartUtc,
        epochStartUtc,
        epochEndUtc: addHoursToDatetimeInput(epochStartUtc, 24),
        // This is an immediate design-preview aid and is kept when the
        // resulting manual satellite is confirmed.
        groundTrackPreview: false,
        // This affects only the transient design preview. The input state
        // vector and the confirmed orbit always retain their EME2000 contract.
        previewReferenceFrame: "eme2000",
        // Manual inputs are state/element based rather than TLE based, so an
        // ideal two-body model is the reliable starting point. Existing
        // synthetic-TLE records stay visible as unavailable legacy records.
        propagator: "two-body",
        objectMetadata: {
            objectType: "satellite",
            missionType: "",
            operator: "",
            country: "",
            launchDate: ""
        },
        propagationOptions: {
            numericalIntegrator: "rk4",
            forceTerms: [...DEFAULT_FORCE_TERMS],
            atmosphericDrag: false,
            dragCoefficient: 2.2,
            areaM2: 1,
            massKg: 100,
            cowellGravityModel: "two-body"
        },
        keplerian: {
            semiMajorAxisKm: 6878,
            eccentricity: 0.001,
            inclinationDeg: 51.6,
            raanDeg: 0,
            argumentOfPeriapsisDeg: 0,
            trueAnomalyDeg: 0
        },
        stateVector: {
            positionXKm: 6878,
            positionYKm: 0,
            positionZKm: 0,
            velocityXKmS: 0,
            velocityYKmS: 7.613,
            velocityZKmS: 0
        }
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function asNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function formatNumber(value, digits) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(Number(numeric.toFixed(digits))) : "";
}

function formatDistanceKm(value) {
    if (!Number.isFinite(value)) return "--";
    const digits = Math.abs(value) < 100 ? 1 : 0;
    return `${Number(value.toFixed(digits)).toLocaleString("en-US")} km`;
}

function getKeplerianDerived(keplerian = {}) {
    const semiMajorAxisKm = Number(keplerian.semiMajorAxisKm);
    const eccentricity = Number(keplerian.eccentricity);
    if (!Number.isFinite(semiMajorAxisKm) || !Number.isFinite(eccentricity) || semiMajorAxisKm <= 0 || eccentricity < 0 || eccentricity >= 1) {
        return { perigeeAltitudeKm: Number.NaN, apogeeAltitudeKm: Number.NaN };
    }
    const earthRadiusKm = 6378.137;
    return {
        perigeeAltitudeKm: (semiMajorAxisKm * (1 - eccentricity)) - earthRadiusKm,
        apogeeAltitudeKm: (semiMajorAxisKm * (1 + eccentricity)) - earthRadiusKm
    };
}

function isValidEpochRange(form) {
    const start = new Date(toUtcEpoch(form.epochStartUtc || form.epochUtc));
    const end = new Date(toUtcEpoch(form.epochEndUtc));
    return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end.getTime() > start.getTime();
}

function dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

function getPersistedManualOrbitState() {
    if (typeof window === "undefined") return null;
    const state = window.__orbitManualOrbitState;
    return state && typeof state === "object" ? state : null;
}

function stateVectorPayload(stateVector) {
    return {
        positionEciKm: {
            x: stateVector.positionXKm,
            y: stateVector.positionYKm,
            z: stateVector.positionZKm
        },
        velocityEciKmS: {
            x: stateVector.velocityXKmS,
            y: stateVector.velocityYKmS,
            z: stateVector.velocityZKmS
        }
    };
}

function flattenStateVector(stateVector = {}) {
    return {
        positionXKm: stateVector.positionXKm ?? stateVector.positionEciKm?.x,
        positionYKm: stateVector.positionYKm ?? stateVector.positionEciKm?.y,
        positionZKm: stateVector.positionZKm ?? stateVector.positionEciKm?.z,
        velocityXKmS: stateVector.velocityXKmS ?? stateVector.velocityEciKmS?.x,
        velocityYKmS: stateVector.velocityYKmS ?? stateVector.velocityEciKmS?.y,
        velocityZKmS: stateVector.velocityZKmS ?? stateVector.velocityEciKmS?.z
    };
}

function normalizeLaunchDate(value, fallback = "") {
    if (typeof value !== "string" || !value.trim()) return fallback;
    const normalized = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString().slice(0, 10);
}

function normalizeObjectMetadata(value, fallback = {}) {
    const source = value && typeof value === "object" ? value : {};
    const asText = (key) => typeof source[key] === "string" ? source[key] : (fallback[key] ?? "");
    return {
        objectType: asText("objectType") || "satellite",
        missionType: asText("missionType"),
        operator: asText("operator"),
        country: asText("country"),
        launchDate: normalizeLaunchDate(source.launchDate, fallback.launchDate ?? "")
    };
}

function boundedNumber(value, fallback, min, max) {
    return clamp(asNumber(value, fallback), min, max);
}

function normalizePropagationOptions(value, fallback = {}) {
    const source = value && typeof value === "object" ? value : {};
    const rawForceTerms = source.forceTerms ?? source.force_terms ?? source.gravityTerms ?? source.gravity_terms;
    const parsedForceTerms = parseForceTerms(rawForceTerms);
    const sourceGravityModel = source.cowellGravityModel
        ?? source.cowell_gravity_model
        ?? source.forceModel
        ?? source.force_model;
    const sourceAtmosphericDrag = source.atmosphericDrag ?? source.atmospheric_drag;
    const sourceHasLegacyGravityModel = typeof sourceGravityModel === "string";
    const sourceHasLegacyOptionSignal = [
        "atmosphericDrag", "atmospheric_drag",
        "dragCoefficient", "drag_coefficient",
        "areaM2", "area_m2",
        "massKg", "mass_kg",
        "numericalIntegrator", "numerical_integrator"
    ].some((key) => Object.hasOwn(source, key));
    const fallbackGravityModel = fallback.cowellGravityModel
        ?? fallback.cowell_gravity_model
        ?? fallback.forceModel
        ?? fallback.force_model
        ?? "two-body";
    const fallbackAtmosphericDrag = fallback.atmosphericDrag ?? fallback.atmospheric_drag;
    const forceTerms = parsedForceTerms.present
        ? normalizeForceTerms(rawForceTerms, ["central"], "two-body", false)
        : sourceHasLegacyGravityModel || sourceHasLegacyOptionSignal
            // Earlier projects could store only the drag fields. Their
            // historical Cowell default was central + J2 + J3 + J4, whereas
            // a clean new form starts from central gravity alone.
            ? forceTermsForLegacyGravityModel(sourceGravityModel ?? "j2-j3-j4", normalizeBoolean(sourceAtmosphericDrag))
            : normalizeForceTerms(
                fallback.forceTerms ?? fallback.force_terms ?? fallback.gravityTerms ?? fallback.gravity_terms,
                DEFAULT_FORCE_TERMS,
                fallbackGravityModel,
                normalizeBoolean(fallbackAtmosphericDrag)
            );
    const cowellGravityModel = legacyGravityModelForForceTerms(forceTerms);
    return {
        numericalIntegrator: normalizeNumericalIntegrator(
            source.numericalIntegrator ?? source.numerical_integrator,
            fallback.numericalIntegrator ?? "rk4"
        ),
        // `forceTerms` is canonical. These two flat fields remain derived
        // compatibility aliases for project records and older API clients.
        forceTerms,
        atmosphericDrag: forceTerms.includes("drag"),
        dragCoefficient: boundedNumber(source.dragCoefficient ?? source.drag_coefficient, fallback.dragCoefficient ?? fallback.drag_coefficient ?? 2.2, 0.01, 10),
        areaM2: boundedNumber(source.areaM2 ?? source.area_m2, fallback.areaM2 ?? fallback.area_m2 ?? 1, 0.0001, 100000),
        massKg: boundedNumber(source.massKg ?? source.mass_kg, fallback.massKg ?? fallback.mass_kg ?? 100, 0.001, 1000000),
        cowellGravityModel
    };
}

function activeForceTermsForEngine(propagator, configuredTerms) {
    if (propagator === "cowell-rk4") return configuredTerms;
    if (propagator === "j2") return ["central", "j2"];
    if (propagator === "j2-j3-j4") return ["central", "j2", "j3", "j4"];
    return ["central"];
}

function payloadPropagationOptions(value, { propagator }) {
    const options = normalizePropagationOptions(value);
    const forceTerms = activeForceTermsForEngine(propagator, options.forceTerms);
    const supportsDrag = propagator === "cowell-rk4";
    const cowellGravityModel = legacyGravityModelForForceTerms(forceTerms);
    const result = {
        forceTerms,
        atmosphericDrag: supportsDrag && forceTerms.includes("drag"),
        ...(supportsDrag && cowellGravityModel ? { cowellGravityModel } : {}),
        dragCoefficient: options.dragCoefficient,
        areaM2: options.areaM2,
        massKg: options.massKg
    };
    if (supportsDrag) {
        result.numericalIntegrator = options.numericalIntegrator;
    }
    return result;
}

function inputClassName(extra = "") {
    return `!h-[33px] !min-w-0 !rounded-lg !border !border-[#294361] !bg-[#0b1728] !px-2 !font-[system-ui,sans-serif] !text-[12px] !font-medium !text-[#eaf2ff] !outline-none focus:!border-[#5d8fff] focus:!shadow-[0_0_0_2px_rgba(75,122,255,.16)] ${extra}`;
}

function payloadFor(form) {
    const epochStartUtc = toUtcEpoch(form.epochStartUtc || form.epochUtc);
    const propagator = normalizePropagator(form.propagator);
    const propagationOptions = payloadPropagationOptions(form.propagationOptions, {
        propagator
    });
    return {
        name: form.name,
        // Kept for the existing editor/runtime bridge. New code should use
        // the explicit range below, which represents the design window.
        epochUtc: epochStartUtc,
        epochStartUtc,
        epochEndUtc: toUtcEpoch(form.epochEndUtc),
        groundTrackPreview: form.groundTrackPreview === true,
        previewReferenceFrame: normalizePreviewReferenceFrame(form.previewReferenceFrame),
        designMode: true,
        propagator,
        objectMetadata: normalizeObjectMetadata(form.objectMetadata),
        propagationOptions,
        keplerian: { ...form.keplerian },
        stateVector: stateVectorPayload(form.stateVector)
    };
}

function mergeIncomingForm(current, detail = {}) {
    const source = detail.form && typeof detail.form === "object" ? detail.form : detail;
    const mergeGroup = (group, fields) => {
        const incoming = source[group];
        if (!incoming || typeof incoming !== "object") return current[group];
        const values = group === "stateVector" ? flattenStateVector(incoming) : incoming;
        return fields.reduce((next, field) => {
            if (Object.hasOwn(values, field.key) && values[field.key] !== undefined) {
                next[field.key] = clamp(
                    asNumber(values[field.key], current[group][field.key]),
                    field.inputMin ?? field.min,
                    field.inputMax ?? field.max
                );
            }
            return next;
        }, { ...current[group] });
    };
    const initialEpoch = typeof source.epochStartUtc === "string"
        ? source.epochStartUtc
        : typeof source.epochUtc === "string"
            ? source.epochUtc
            : current.epochStartUtc;
    const epochStartUtc = toDatetimeInput(initialEpoch, current.epochStartUtc);
    const epochEndUtc = typeof source.epochEndUtc === "string"
        ? toDatetimeInput(source.epochEndUtc, current.epochEndUtc)
        : current.epochEndUtc;
    const incomingObjectMetadata = source.objectMetadata && typeof source.objectMetadata === "object"
        ? source.objectMetadata
        : {
            objectType: source.objectType,
            missionType: source.missionType,
            operator: source.operator,
            country: source.country,
            launchDate: source.launchDate
        };
    const nestedPropagationOptions = source.propagationOptions ?? source.propagation_options;
    const incomingPropagationOptions = nestedPropagationOptions && typeof nestedPropagationOptions === "object"
        ? nestedPropagationOptions
        : {
            numericalIntegrator: source.numericalIntegrator ?? source.numerical_integrator,
            forceTerms: source.forceTerms ?? source.force_terms ?? source.gravityTerms ?? source.gravity_terms,
            atmosphericDrag: source.atmosphericDrag ?? source.atmospheric_drag,
            dragCoefficient: source.dragCoefficient ?? source.drag_coefficient,
            areaM2: source.areaM2 ?? source.area_m2,
            massKg: source.massKg ?? source.mass_kg,
            cowellGravityModel: source.cowellGravityModel ?? source.cowell_gravity_model ?? source.forceModel ?? source.force_model
        };
    const propagator = normalizePropagator(source.propagator, current.propagator);
    const propagationOptions = normalizePropagationOptions(incomingPropagationOptions, current.propagationOptions);
    return {
        name: typeof source.name === "string" ? source.name : current.name,
        epochUtc: epochStartUtc,
        epochStartUtc,
        epochEndUtc,
        groundTrackPreview: typeof source.groundTrackPreview === "boolean" ? source.groundTrackPreview : current.groundTrackPreview,
        previewReferenceFrame: normalizePreviewReferenceFrame(
            source.previewReferenceFrame ?? source.preview_reference_frame,
            current.previewReferenceFrame
        ),
        propagator,
        objectMetadata: normalizeObjectMetadata(incomingObjectMetadata, current.objectMetadata),
        propagationOptions,
        keplerian: mergeGroup("keplerian", KEPLERIAN_FIELDS),
        stateVector: mergeGroup("stateVector", STATE_VECTOR_FIELDS)
    };
}

function NumericRangeField({ field, value, onChange }) {
    const inputRef = useRef(null);
    const [draft, setDraft] = useState(() => formatNumber(value, field.digits));
    const inputMin = field.inputMin ?? field.min;
    const inputMax = field.inputMax ?? field.max;

    useEffect(() => {
        if (document.activeElement !== inputRef.current) setDraft(formatNumber(value, field.digits));
    }, [field.digits, value]);

    const commit = (rawValue) => {
        const numeric = Number(rawValue);
        if (!Number.isFinite(numeric)) {
            setDraft(formatNumber(value, field.digits));
            return;
        }
        const next = clamp(numeric, inputMin, inputMax);
        onChange(next);
        setDraft(formatNumber(next, field.digits));
    };
    const rangeValue = clamp(asNumber(value, field.min), field.min, field.max);

    return <label className="grid min-w-0 gap-1.5 rounded-lg border border-[#1c2e49] bg-[#091322] px-2.5 py-2 font-[system-ui,sans-serif]">
        <span className="flex min-w-0 items-center justify-between gap-2 text-[11px] leading-none font-semibold text-[#c7d5ea]">
            <span className="truncate">{field.label}</span>
            {field.unit && <small className="shrink-0 text-[10px] font-medium text-[#7f94b4]">{field.unit}</small>}
        </span>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <input ref={inputRef} className="!h-[29px] !min-w-0 !rounded-md !border !border-[#2d486d] !bg-[#0d1a2d] !px-2 !font-[system-ui,sans-serif] !text-[12px] !leading-none !font-semibold !text-[#edf4ff] !outline-none focus:!border-[#5d8fff] focus:!shadow-[0_0_0_2px_rgba(75,122,255,.16)]" type="number" min={inputMin} max={inputMax} step={field.step} inputMode="decimal" value={draft} aria-label={`${field.label}${field.unit ? ` (${field.unit})` : ""}`} onChange={(event) => {
                const nextDraft = event.target.value;
                setDraft(nextDraft);
                if (Number.isFinite(Number(nextDraft))) onChange(clamp(Number(nextDraft), inputMin, inputMax));
            }} onBlur={(event) => commit(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
            <span className="min-w-[30px] text-right text-[9px] font-medium tabular-nums text-[#7890b2]">{formatNumber(rangeValue, field.digits)}</span>
        </div>
        <input className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#223858] accent-[#5b83ff]" type="range" min={field.min} max={field.max} step={field.step} value={rangeValue} aria-label={`Ajustar ${field.label}`} onChange={(event) => onChange(Number(event.target.value))} />
        <span className="flex justify-between text-[9px] leading-none tabular-nums text-[#5f7598]"><span>{formatNumber(field.min, field.digits)}</span><span>{formatNumber(field.max, field.digits)}</span></span>
    </label>;
}

function ForceTermToggle({ option, checked, onChange, required = false }) {
    const inputId = `manual-orbit-force-${option.value}`;
    return <label title={option.description} className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 rounded-md border px-2 py-1.5 transition-colors ${checked ? "border-[#466ead] bg-[#132745]" : "border-[#263b59] bg-[#0a1627] hover:border-[#3a587e]"} ${required ? "cursor-not-allowed opacity-85" : "cursor-pointer"}`} htmlFor={inputId}>
        <input id={inputId} className="peer sr-only" type="checkbox" checked={checked} disabled={required} onChange={(event) => onChange(event.target.checked)} />
        <span className={`relative row-span-2 inline-flex h-4 w-4 items-center justify-center rounded border transition-colors ${checked ? "border-[#7399ff] bg-[#4268de]" : "border-[#526b91] bg-[#0c1b30]"}`} aria-hidden="true">
            {checked && <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none"><path d="M2.2 6.2 4.7 8.5 9.8 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </span>
        <span className="min-w-0 text-[10px] leading-none font-semibold text-[#dce8fb]">{option.label}{required && <small className="ml-1 text-[8px] font-bold tracking-[.06em] text-[#8eabdc]">REQUIRED</small>}</span>
        <small className="min-w-0 truncate text-[9px] leading-none font-medium text-[#7f96b8]">{option.description}</small>
    </label>;
}

export default function ManualOrbitPanel() {
    const [open, setOpen] = useState(() => getPersistedManualOrbitState()?.open === true);
    const [activeTab, setActiveTab] = useState(() => {
        const tab = getPersistedManualOrbitState()?.activeTab ?? getPersistedManualOrbitState()?.panelTab;
        return ["overview", "orbit", "propagation"].includes(tab) ? tab : "overview";
    });
    const [definitionTab, setDefinitionTab] = useState(() => getPersistedManualOrbitState()?.tab === "state-vector" ? "state-vector" : "keplerian");
    const [form, setForm] = useState(() => mergeIncomingForm(createDefaultForm(), getPersistedManualOrbitState() || {}));
    const [status, setStatus] = useState(null);
    const [vectorsVisible, setVectorsVisible] = useState(false);
    // The runtime owns the replacement target.  Keeping only its id in the
    // UI lets the same form distinguish a new authored orbit from an edit
    // without ever making catalogue objects editable in React.
    const [editingManualOrbitId, setEditingManualOrbitId] = useState(() => {
        const id = String(getPersistedManualOrbitState()?.editingManualOrbitId || "").trim();
        return id || null;
    });
    const openRef = useRef(open);

    const publishPanelState = (nextOpen) => dispatch("orbit:manual-orbit-panel-state", {
        open: nextOpen,
        mode: "design",
        designMode: true
    });
    const setPanelOpen = (nextOpen) => {
        const resolved = Boolean(nextOpen);
        if (openRef.current === resolved) return;
        openRef.current = resolved;
        setOpen(resolved);
        publishPanelState(resolved);
    };

    useEffect(() => {
        const onOpen = (event) => {
            if (event.detail && typeof event.detail === "object") setForm((current) => mergeIncomingForm(current, event.detail));
            setActiveTab("overview");
            setStatus(null);
            setVectorsVisible(false);
            setPanelOpen(true);
        };
        const onClose = () => {
            window.dispatchEvent(new CustomEvent("orbit:manual-orbit-vectors-action", { detail: { visible: false } }));
            setVectorsVisible(false);
            setEditingManualOrbitId(null);
            setPanelOpen(false);
        };
        const onCancel = () => {
            window.dispatchEvent(new CustomEvent("orbit:manual-orbit-vectors-action", { detail: { visible: false } }));
            setVectorsVisible(false);
            setEditingManualOrbitId(null);
            setPanelOpen(false);
        };
        const onToggle = (event) => {
            const nextOpen = typeof event.detail?.open === "boolean" ? event.detail.open : !openRef.current;
            setPanelOpen(nextOpen);
        };
        const onState = (event) => {
            const detail = event.detail || {};
            setForm((current) => mergeIncomingForm(current, detail));
            if (Object.hasOwn(detail, "editingManualOrbitId")) {
                const id = String(detail.editingManualOrbitId || "").trim();
                setEditingManualOrbitId(id || null);
            }
            if (typeof detail.open === "boolean") setPanelOpen(detail.open);
            if (detail.tab === "keplerian" || detail.tab === "state-vector") setDefinitionTab(detail.tab);
            const requestedTopLevelTab = detail.activeTab ?? detail.panelTab;
            if (["overview", "orbit", "propagation"].includes(requestedTopLevelTab)) setActiveTab(requestedTopLevelTab);
        };
        const onStatus = (event) => {
            const detail = event.detail || {};
            const kind = ["error", "busy", "success"].includes(detail.kind) ? detail.kind : null;
            if (!kind) {
                setStatus(null);
                return;
            }
            const fallback = kind === "busy" ? "Creating manual orbit…" : kind === "success" ? "Manual orbit created." : "Unable to create the manual orbit.";
            setStatus({ kind, message: String(detail.message || fallback) });
        };
        window.addEventListener("orbit:manual-orbit-open", onOpen);
        window.addEventListener("orbit:manual-orbit-close", onClose);
        window.addEventListener("orbit:manual-orbit-cancel", onCancel);
        window.addEventListener("orbit:manual-orbit-toggle", onToggle);
        window.addEventListener("orbit:manual-orbit-state", onState);
        window.addEventListener("orbit:manual-orbit-status", onStatus);
        return () => {
            window.removeEventListener("orbit:manual-orbit-open", onOpen);
            window.removeEventListener("orbit:manual-orbit-close", onClose);
            window.removeEventListener("orbit:manual-orbit-cancel", onCancel);
            window.removeEventListener("orbit:manual-orbit-toggle", onToggle);
            window.removeEventListener("orbit:manual-orbit-state", onState);
            window.removeEventListener("orbit:manual-orbit-status", onStatus);
        };
    }, []);

    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
            if (event.key !== "Escape") return;
            dispatch("orbit:manual-orbit-close", { ...payloadFor(form), reason: "escape" });
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [form, open]);

    const emitChange = (source, nextForm, field, value) => dispatch("orbit:manual-orbit-change", {
        source,
        ...(field ? { field, value } : {}),
        ...payloadFor(nextForm)
    });
    const updateField = (group, key, value) => {
        const next = { ...form, [group]: { ...form[group], [key]: value } };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        emitChange(group, next, key, value);
    };
    const updateEpochStart = (epochStartUtc) => {
        const next = { ...form, epochUtc: epochStartUtc, epochStartUtc };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        emitChange("epoch-range", next, "epochStartUtc", toUtcEpoch(epochStartUtc));
    };
    const updateEpochEnd = (epochEndUtc) => {
        const next = { ...form, epochEndUtc };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        emitChange("epoch-range", next, "epochEndUtc", toUtcEpoch(epochEndUtc));
    };
    const updateGroundTrackPreview = (groundTrackPreview) => {
        const next = { ...form, groundTrackPreview };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        emitChange("ground-track", next, "groundTrackPreview", groundTrackPreview);
    };
    const updatePreviewReferenceFrame = (previewReferenceFrame) => {
        const next = {
            ...form,
            previewReferenceFrame: normalizePreviewReferenceFrame(previewReferenceFrame, form.previewReferenceFrame)
        };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        // This is deliberately a geometry-refreshing source. It changes only
        // the transient preview representation, never the authored orbit.
        emitChange("preview-reference-frame", next, "previewReferenceFrame", next.previewReferenceFrame);
    };
    const updateName = (name) => {
        const next = { ...form, name };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        // Keep an empty draft locally so a user can replace the whole name
        // with the keyboard. The runtime is only updated once it is valid.
        if (name.trim()) {
            emitChange("name", next, "name", name);
        }
    };
    const updatePropagator = (propagator) => {
        const nextPropagator = normalizePropagator(propagator, form.propagator);
        // `forceTerms` describes active physics, never a dormant Cowell
        // draft. This prevents a Two-body or legacy record from claiming J2/J3/J4
        // in its persisted metadata when those forces are not applied.
        const nextForceTerms = nextPropagator === "cowell-rk4"
            ? normalizeForceTerms(form.propagationOptions.forceTerms)
            : nextPropagator === "j2"
                ? ["central", "j2"]
                : nextPropagator === "j2-j3-j4"
                    ? ["central", "j2", "j3", "j4"]
                    : ["central"];
        const next = {
            ...form,
            propagator: nextPropagator,
            propagationOptions: {
                ...form.propagationOptions,
                forceTerms: nextForceTerms,
                atmosphericDrag: nextForceTerms.includes("drag"),
                cowellGravityModel: legacyGravityModelForForceTerms(nextForceTerms)
            }
        };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        emitChange("propagator", next, "propagator", next.propagator);
    };
    const updateObjectMetadata = (key, value) => {
        const next = { ...form, objectMetadata: { ...form.objectMetadata, [key]: value } };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        emitChange("object-metadata", next, `objectMetadata.${key}`, value);
    };
    const updatePropagationOption = (key, value) => {
        const next = {
            ...form,
            propagationOptions: {
                ...form.propagationOptions,
                [key]: value
            }
        };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        emitChange("propagation-options", next, `propagationOptions.${key}`, value);
    };
    const updateForceTerm = (term, enabled) => {
        if (term === "central" || form.propagator !== "cowell-rk4") return;
        const currentTerms = normalizeForceTerms(form.propagationOptions.forceTerms);
        const nextTerms = new Set(currentTerms);
        if (enabled) nextTerms.add(term);
        else nextTerms.delete(term);
        nextTerms.add("central");
        // Keep not-yet-renderable future terms (for example SRP) while this
        // build edits a known checkbox. Their execution remains backend
        // authoritative, but changing J2 must not erase project data.
        const forceTerms = [
            ...FORCE_TERM_VALUES.filter((value) => nextTerms.has(value)),
            ...currentTerms.filter((value) => !FORCE_TERM_VALUES.includes(value) && nextTerms.has(value))
        ];
        const cowellGravityModel = legacyGravityModelForForceTerms(forceTerms);
        const next = {
            ...form,
            propagationOptions: {
                ...form.propagationOptions,
                forceTerms,
                atmosphericDrag: forceTerms.includes("drag"),
                cowellGravityModel
            }
        };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        emitChange("force-terms", next, "propagationOptions.forceTerms", forceTerms);
    };
    const switchDefinitionTab = (nextTab) => {
        if (nextTab === definitionTab) return;
        setDefinitionTab(nextTab);
        const source = nextTab === "state-vector" ? "keplerian" : "state-vector";
        dispatch("orbit:manual-orbit-tab-change", { tab: nextTab, ...payloadFor(form) });
        dispatch("orbit:manual-orbit-sync-request", { source, target: nextTab, ...payloadFor(form) });
    };
    const reset = () => {
        const next = createDefaultForm();
        setForm(next);
        dispatch("orbit:manual-orbit-reset", payloadFor(next));
    };
    const requestClose = (reason = "close") => {
        const detail = { ...payloadFor(form), reason };
        dispatch(reason === "cancel" ? "orbit:manual-orbit-cancel" : "orbit:manual-orbit-close", detail);
    };
    const openPropagatedParameters = () => {
        const manualOrbit = payloadFor(form);
        const start = new Date(manualOrbit.epochStartUtc);
        const end = new Date(manualOrbit.epochEndUtc);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
            return;
        }
        emitPropagatedParametersOpen({
            source: "manual-design",
            manualOrbit,
            startTime: start.toISOString(),
            endTime: end.toISOString()
        });
    };
    const togglePreviewVectors = () => {
        const visible = !vectorsVisible;
        setVectorsVisible(visible);
        window.dispatchEvent(new CustomEvent("orbit:manual-orbit-vectors-action", {
            detail: { visible, manualOrbit: payloadFor(form) }
        }));
    };

    useEffect(() => {
        window.addEventListener("orbit:manual-orbit-propagated-parameters-request", openPropagatedParameters);
        return () => window.removeEventListener("orbit:manual-orbit-propagated-parameters-request", openPropagatedParameters);
    }, [form]);

    useEffect(() => {
        if (!vectorsVisible) return;
        window.dispatchEvent(new CustomEvent("orbit:manual-orbit-vectors-action", {
            detail: { visible: true, manualOrbit: payloadFor(form) }
        }));
    }, [form, vectorsVisible]);

    if (!open) return null;

    const fields = definitionTab === "keplerian" ? KEPLERIAN_FIELDS : STATE_VECTOR_FIELDS;
    const group = definitionTab === "keplerian" ? "keplerian" : "stateVector";
    const title = definitionTab === "keplerian" ? "Keplerian elements" : "State vector";
    const derived = getKeplerianDerived(form.keplerian);
    const epochRangeValid = isValidEpochRange(form);
    const selectedPropagator = propagatorOptionFor(form.propagator);
    const activeForceTerms = normalizeForceTerms(form.propagationOptions.forceTerms);
    const unsupportedForceTerms = activeForceTerms.filter((term) => !FORCE_TERM_VALUES.includes(term));
    const selectedNumericalIntegrator = COWELL_NUMERICAL_INTEGRATOR_OPTIONS.find(
        (option) => option.value === form.propagationOptions.numericalIntegrator
    ) ?? { label: form.propagationOptions.numericalIntegrator };
    const previewFrameDescription = selectedPropagator.legacy
        ? selectedPropagator.description
        : selectedPropagator.value === "cowell-rk4"
            ? `EME2000 preview uses Cowell numerical with ${selectedNumericalIntegrator.label}. Active force terms: ${forceTermsLabel(activeForceTerms)}. ITRF shows that same propagation fixed to Earth.`
            : "EME2000 preview follows the native inertial trajectory. ITRF shows that same propagation fixed to Earth. This does not change the EME2000 input state or orbital definition.";
    const statusTone = status?.kind === "error"
        ? "border-[#874252] bg-[#291821] text-[#ffd0d9]"
        : status?.kind === "success"
            ? "border-[#2d7252] bg-[#102a22] text-[#b8f1d0]"
            : "border-[#776035] bg-[#2d2617] text-[#f5d38e]";
    const isEditingManualOrbit = Boolean(editingManualOrbitId);
    const dragEnabled = selectedPropagator.value === "cowell-rk4" && activeForceTerms.includes("drag");

    // The time dock and project-time footer are intentionally hidden while
    // this design panel is open. Keep header/body/footer in independent grid
    // rows so only the body scrolls and the actions never move or shrink.
    return <aside id="manualOrbitPanel" className="pointer-events-auto fixed top-[86px] right-[14px] bottom-[14px] z-[10126] grid min-h-0 w-[min(380px,calc(100vw-28px))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden box-border rounded-[10px] border border-[rgba(65,99,147,.66)] bg-[linear-gradient(145deg,rgba(12,25,42,.98),rgba(5,14,25,.98))] font-[system-ui,sans-serif] text-[#dbe7fa] shadow-[0_22px_60px_rgba(0,0,0,.5),inset_0_1px_rgba(255,255,255,.045)] max-[760px]:top-20 max-[760px]:right-2.5 max-[760px]:bottom-2.5 max-[760px]:w-[min(360px,calc(100vw-20px))]" role="dialog" aria-modal="false" aria-labelledby="manualOrbitTitle">
        <header className="flex shrink-0 items-center justify-between border-b border-[#1e3049] px-4 pt-3.5 pb-3">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <h2 id="manualOrbitTitle" className="m-0 text-[16px] leading-none font-bold tracking-[.015em] text-[#f1f6ff]">{isEditingManualOrbit ? "Edit manual orbit" : "Manual orbit"}</h2>
                    <span className={`rounded-full border px-1.5 py-1 text-[8px] leading-none font-bold uppercase tracking-[.09em] ${isEditingManualOrbit ? "border-[#5584dc] bg-[#17325d] text-[#d3e4ff]" : "border-[#356dc2] bg-[#102747] text-[#b7d4ff]"}`}>{isEditingManualOrbit ? "Editing existing orbit" : "Orbit design mode"}</span>
                </div>
                <p className="mt-1.5 mb-0 text-[10px] leading-[1.3] font-medium text-[#91a5c1]">{isEditingManualOrbit ? "Modifica la definici\u00f3n; al actualizar se sustituir\u00e1 esta misma \u00f3rbita." : "Escena aislada para dise\u00f1ar y previsualizar una \u00f3rbita."}</p>
            </div>
            <button className="inline-flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-[#294361] bg-[#0c192b] p-0 text-[18px] leading-none text-[#bdcbe0] hover:border-[#5075a6] hover:bg-[#14243d] hover:text-[#f4f8ff]" type="button" aria-label={"Cerrar creador de \u00f3rbita manual"} onClick={() => requestClose("close")}>&times;</button>
        </header>

        <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-3 pb-5 [scrollbar-color:#355179_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#355179]">
            <nav className="relative z-[1] grid grid-cols-3 border-b border-[#1c2c43]" aria-label="Manual orbit sections" role="tablist">
                <button className={`relative cursor-pointer border-0 bg-transparent px-0.5 pt-2.5 pb-3 text-[10px] leading-none font-bold ${activeTab === "overview" ? "text-[#eaf1ff] after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-0.5 after:bg-[#4476ff] after:shadow-[0_0_8px_#4476ff] after:content-['']" : "text-[#8d9bb1] hover:text-[#cbd8ec]"}`} type="button" role="tab" aria-selected={activeTab === "overview"} aria-controls="manual-orbit-overview" onClick={() => setActiveTab("overview")}>OVERVIEW</button>
                <button className={`relative cursor-pointer border-0 bg-transparent px-0.5 pt-2.5 pb-3 text-[10px] leading-none font-bold ${activeTab === "orbit" ? "text-[#eaf1ff] after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-0.5 after:bg-[#4476ff] after:shadow-[0_0_8px_#4476ff] after:content-['']" : "text-[#8d9bb1] hover:text-[#cbd8ec]"}`} type="button" role="tab" aria-selected={activeTab === "orbit"} aria-controls="manual-orbit-orbit" onClick={() => setActiveTab("orbit")}>ORBIT</button>
                <button className={`relative cursor-pointer border-0 bg-transparent px-0.5 pt-2.5 pb-3 text-[10px] leading-none font-bold ${activeTab === "propagation" ? "text-[#eaf1ff] after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-0.5 after:bg-[#4476ff] after:shadow-[0_0_8px_#4476ff] after:content-['']" : "text-[#8d9bb1] hover:text-[#cbd8ec]"}`} type="button" role="tab" aria-selected={activeTab === "propagation"} aria-controls="manual-orbit-propagation" onClick={() => setActiveTab("propagation")}>PROPAGATION</button>
            </nav>

            {status && <div className={`mt-3 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[10px] leading-[1.35] font-semibold ${statusTone}`} role="status" aria-live="polite">
                <i className={`mt-[3px] size-1.5 shrink-0 rounded-full ${status.kind === "error" ? "bg-[#ff7890]" : status.kind === "success" ? "bg-[#64d997]" : "bg-[#f4bb4e]"}`} aria-hidden="true" />
                <span>{status.message}</span>
            </div>}

            {activeTab === "overview" && <section id="manual-orbit-overview" className="pt-3" role="tabpanel">
                <section id="manualOrbitCentralBody" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[#31527d] bg-[#0a1a2f] px-3 py-2.5" aria-labelledby="manualOrbitCentralBodyTitle">
                    <span className="min-w-0">
                        <span id="manualOrbitCentralBodyTitle" className="block text-[9px] leading-none font-bold uppercase tracking-[.08em] text-[#83a8df]">Central body</span>
                        <strong className="mt-1 block text-[12px] leading-none text-[#edf5ff]">Earth</strong>
                    </span>
                    <span className="shrink-0 rounded-full border border-[#2f5d9d] bg-[#102b4d] px-2 py-1 text-[9px] leading-none font-bold text-[#bad7ff]">WGS-84</span>
                    <small className="sr-only">Manual orbit design is currently geocentric. Earth is the fixed central body.</small>
                </section>
                <div className="flex items-baseline justify-between gap-2">
                    <h3 className="m-0 text-[12px] leading-none font-bold text-[#e7effd]">Object record</h3>
                    <span className="text-[9px] leading-none font-semibold tracking-[.06em] text-[#7f94b4]">METADATA</span>
                </div>
                <p className="mt-1.5 mb-3 text-[10px] leading-[1.35] text-[#8498b5]">Administrative fields for the object. They do not alter its orbital state.</p>
                <div className="grid gap-2.5">
                    <label className="grid gap-1.5 text-[11px] font-semibold text-[#c7d5ea]">
                        <span>Name</span>
                        <input className={inputClassName()} type="text" value={form.name} maxLength={80} placeholder="Manual Orbit" onChange={(event) => updateName(event.target.value)} />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold text-[#c7d5ea]">
                            <span>Object type</span>
                            <input className={inputClassName()} type="text" value={form.objectMetadata.objectType} maxLength={60} placeholder="Satellite" onChange={(event) => updateObjectMetadata("objectType", event.target.value)} />
                        </label>
                        <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold text-[#c7d5ea]">
                            <span>Mission type</span>
                            <input className={inputClassName()} type="text" value={form.objectMetadata.missionType} maxLength={80} placeholder="Earth observation" onChange={(event) => updateObjectMetadata("missionType", event.target.value)} />
                        </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold text-[#c7d5ea]">
                            <span>Operator / agency</span>
                            <input className={inputClassName()} type="text" value={form.objectMetadata.operator} maxLength={100} placeholder="Optional" onChange={(event) => updateObjectMetadata("operator", event.target.value)} />
                        </label>
                        <label className="grid min-w-0 gap-1.5 text-[10px] font-semibold text-[#c7d5ea]">
                            <span>Country</span>
                            <input className={inputClassName()} type="text" value={form.objectMetadata.country} maxLength={80} placeholder="Optional" onChange={(event) => updateObjectMetadata("country", event.target.value)} />
                        </label>
                    </div>
                    <label className="grid gap-1.5 text-[10px] font-semibold text-[#c7d5ea]">
                        <span className="flex items-center justify-between gap-2"><span>Launch date</span><small className="font-medium text-[#7f94b4]">OPTIONAL</small></span>
                        <input className={inputClassName("max-w-[180px]")} type="date" value={form.objectMetadata.launchDate} onChange={(event) => updateObjectMetadata("launchDate", event.target.value)} />
                    </label>
                </div>
            </section>}

            {activeTab === "propagation" && <>
            <section id="manual-orbit-propagation" className="mt-3 rounded-lg border border-[#1f3655] bg-[#091526] p-2.5" role="tabpanel" aria-label="Design time window">
                <div className="flex items-baseline justify-between gap-2">
                    <h3 className="m-0 text-[11px] leading-none font-bold text-[#dbe9ff]">Design window</h3>
                    <span className="text-[9px] leading-none font-bold tracking-[.06em] text-[#87a4d1]">UTC</span>
                </div>
                <p className="mt-1 mb-2 text-[10px] leading-[1.35] text-[#8498b5]">La órbita creada se propaga exactamente entre estos instantes; la vista previa muestra una revolución inercial en el epoch inicial.</p>
                <div className="grid grid-cols-2 gap-2">
                    <label className="grid min-w-0 gap-1 font-[system-ui,sans-serif] text-[10px] font-semibold text-[#c7d5ea]">
                        <span>Epoch initial</span>
                        <input className="!h-[33px] !min-w-0 !rounded-lg !border !border-[#294361] !bg-[#0b1728] !px-1.5 !font-[system-ui,sans-serif] !text-[11px] !font-medium !text-[#eaf2ff] !outline-none focus:!border-[#5d8fff] focus:!shadow-[0_0_0_2px_rgba(75,122,255,.16)]" type="datetime-local" value={form.epochStartUtc} onChange={(event) => updateEpochStart(event.target.value)} />
                    </label>
                    <label className="grid min-w-0 gap-1 font-[system-ui,sans-serif] text-[10px] font-semibold text-[#c7d5ea]">
                        <span>Epoch final</span>
                        <input className="!h-[33px] !min-w-0 !rounded-lg !border !border-[#294361] !bg-[#0b1728] !px-1.5 !font-[system-ui,sans-serif] !text-[11px] !font-medium !text-[#eaf2ff] !outline-none focus:!border-[#5d8fff] focus:!shadow-[0_0_0_2px_rgba(75,122,255,.16)]" type="datetime-local" min={form.epochStartUtc} value={form.epochEndUtc} onChange={(event) => updateEpochEnd(event.target.value)} />
                    </label>
                </div>
                {!epochRangeValid && <p className="mt-2 mb-0 text-[10px] leading-[1.35] font-semibold text-[#ff9cab]" role="alert">El epoch final debe ser posterior al inicial.</p>}
            </section>

            <section className="mt-3 rounded-lg border border-[#1f3655] bg-[#091526] p-2.5" aria-labelledby="manualOrbitPreviewFrameTitle">
                <div className="flex items-baseline justify-between gap-2">
                    <h3 id="manualOrbitPreviewFrameTitle" className="m-0 text-[11px] leading-none font-bold text-[#dbe9ff]">Orbit preview frame</h3>
                    <span className="text-[9px] leading-none font-bold tracking-[.06em] text-[#87a4d1]">DISPLAY ONLY</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1 rounded-md border border-[#1b304d] bg-[#08111f] p-1" role="radiogroup" aria-label="Orbit preview reference frame">
                    <button className={`cursor-pointer rounded-[5px] border-0 px-2 py-2 text-left text-[10px] leading-none font-bold ${form.previewReferenceFrame === "eme2000" ? "bg-[#233b69] text-[#f3f7ff] shadow-[inset_0_0_0_1px_rgba(122,161,255,.42)]" : "bg-transparent text-[#93a4bd] hover:bg-[#13223a] hover:text-[#dce7f8]"}`} type="button" role="radio" aria-checked={form.previewReferenceFrame === "eme2000"} onClick={() => updatePreviewReferenceFrame("eme2000")}>
                        <span className="block">EME2000</span>
                        <small className="mt-1 block text-[9px] font-medium opacity-75">Inertial trajectory</small>
                    </button>
                    <button className={`cursor-pointer rounded-[5px] border-0 px-2 py-2 text-left text-[10px] leading-none font-bold ${form.previewReferenceFrame === "itrf" ? "bg-[#233b69] text-[#f3f7ff] shadow-[inset_0_0_0_1px_rgba(122,161,255,.42)]" : "bg-transparent text-[#93a4bd] hover:bg-[#13223a] hover:text-[#dce7f8]"}`} type="button" role="radio" aria-checked={form.previewReferenceFrame === "itrf"} onClick={() => updatePreviewReferenceFrame("itrf")}>
                        <span className="block">ITRF</span>
                        <small className="mt-1 block text-[9px] font-medium opacity-75">Earth-fixed path</small>
                    </button>
                </div>
                <p className="mt-2 mb-0 text-[10px] leading-[1.35] text-[#8498b5]">{previewFrameDescription}</p>
            </section>
            </>}

            {activeTab === "orbit" && <section id="manual-orbit-orbit" className="mt-3" role="tabpanel">
                <div className="flex items-baseline justify-between gap-2">
                    <h3 className="m-0 text-[12px] leading-none font-bold text-[#e7effd]">Orbital definition</h3>
                    <span className="text-[9px] leading-none font-semibold tracking-[.06em] text-[#7f94b4]">EME2000</span>
                </div>
                <p className="mt-1.5 mb-3 text-[10px] leading-[1.35] text-[#8498b5]">Edit either representation; the runtime keeps the other one synchronized.</p>
                <nav className="grid grid-cols-2 gap-1 rounded-lg border border-[#1d304b] bg-[#08111f] p-1" aria-label="Orbital definition method" role="tablist">
                    <button className={`relative cursor-pointer rounded-[5px] border-0 px-2 py-2 text-[10px] leading-none font-bold ${definitionTab === "keplerian" ? "bg-[#233b69] text-[#f3f7ff] shadow-[inset_0_0_0_1px_rgba(122,161,255,.42)]" : "bg-transparent text-[#93a4bd] hover:bg-[#13223a] hover:text-[#dce7f8]"}`} type="button" role="tab" aria-selected={definitionTab === "keplerian"} aria-controls="manual-orbit-keplerian" onClick={() => switchDefinitionTab("keplerian")}>Keplerian</button>
                    <button className={`relative cursor-pointer rounded-[5px] border-0 px-2 py-2 text-[10px] leading-none font-bold ${definitionTab === "state-vector" ? "bg-[#233b69] text-[#f3f7ff] shadow-[inset_0_0_0_1px_rgba(122,161,255,.42)]" : "bg-transparent text-[#93a4bd] hover:bg-[#13223a] hover:text-[#dce7f8]"}`} type="button" role="tab" aria-selected={definitionTab === "state-vector"} aria-controls="manual-orbit-state-vector" onClick={() => switchDefinitionTab("state-vector")}>State vector</button>
                </nav>
                <section id={`manual-orbit-${definitionTab}`} className="mt-3" role="tabpanel">
                <div className="mb-2 flex items-end justify-between gap-3">
                    <div>
                        <h3 className="m-0 text-[12px] leading-none font-bold text-[#e7effd]">{title}</h3>
                        <p className="mt-1 mb-0 text-[10px] leading-[1.35] text-[#8498b5]">Use the slider for a quick adjustment or enter an exact value.</p>
                    </div>
                    <span className="shrink-0 rounded-full border border-[#2d4770] bg-[#10213a] px-2 py-1 text-[9px] leading-none font-bold tracking-[.045em] text-[#9fc0ff]">{definitionTab === "keplerian" ? "CLASSICAL" : "EME2000"}</span>
                </div>
                <div className="grid gap-2">
                    {fields.map((field) => <NumericRangeField key={field.key} field={field} value={form[group][field.key]} onChange={(value) => updateField(group, field.key, value)} />)}
                </div>
            </section>

            <section className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-[#1d3655] bg-[#091526] p-2.5" aria-label="Derivados orbitales">
                <div className="col-span-2 flex items-center justify-between">
                    <h3 className="m-0 text-[11px] leading-none font-bold text-[#dbe9ff]">Derived geometry</h3>
                    <span className="text-[9px] leading-none font-medium text-[#7f94b4]">Keplerian</span>
                </div>
                <div className="rounded-md border border-[#1b304d] bg-[#0c1a2d] px-2 py-1.5">
                    <span className="block text-[9px] leading-none font-semibold text-[#8fa4c4]">Perigee</span>
                    <strong className="mt-1 block text-[12px] leading-none font-bold tabular-nums text-[#eef5ff]">{formatDistanceKm(derived.perigeeAltitudeKm)}</strong>
                </div>
                <div className="rounded-md border border-[#1b304d] bg-[#0c1a2d] px-2 py-1.5">
                    <span className="block text-[9px] leading-none font-semibold text-[#8fa4c4]">Apogee</span>
                    <strong className="mt-1 block text-[12px] leading-none font-bold tabular-nums text-[#eef5ff]">{formatDistanceKm(derived.apogeeAltitudeKm)}</strong>
                </div>
            </section>
            </section>}

            {activeTab === "propagation" && <>
            <section className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[#1f3655] bg-[#091526] px-2.5 py-2.5 font-[system-ui,sans-serif]" aria-label="Ground track">
                <span className="min-w-0">
                    <strong className="block text-[11px] leading-none text-[#dbe9ff]">Ground track</strong>
                    <small className="mt-1 block text-[10px] leading-[1.3] font-medium text-[#7f94b4]">Mostrar u ocultar durante el diseño; se conserva al confirmar.</small>
                </span>
                <button className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border p-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#83a7ff] ${form.groundTrackPreview ? "border-[#527cf6] bg-[#3157d5]" : "border-[#3b5579] bg-[#15243a]"}`} type="button" role="switch" aria-checked={form.groundTrackPreview} aria-label="Mostrar u ocultar ground track durante el diseño" onClick={() => updateGroundTrackPreview(!form.groundTrackPreview)}>
                    <span className={`absolute top-[3px] size-3 rounded-full bg-[#c8d5e9] transition-[transform,background-color] ${form.groundTrackPreview ? "translate-x-5 bg-white" : "translate-x-[3px]"}`} aria-hidden="true" />
                </button>
            </section>

            <section className="mt-3 grid gap-1.5 border-t border-[#1b2d45] pt-3 font-[system-ui,sans-serif]" aria-labelledby="manualOrbitPropagatorTitle">
                <div className="flex items-center justify-between gap-2">
                    <h3 id="manualOrbitPropagatorTitle" className="m-0 text-[11px] leading-none font-semibold text-[#c7d5ea]">Propagation engine</h3>
                    <span className={`shrink-0 rounded-full border px-1.5 py-1 text-[8px] leading-none font-bold uppercase tracking-[.07em] ${selectedPropagator.unavailable ? "border-[#7a4b4b] bg-[#2b1a1d] text-[#ffc3c3]" : selectedPropagator.value === "two-body" ? "border-[#356dc2] bg-[#102747] text-[#b7d4ff]" : "border-[#3b7359] bg-[#102a22] text-[#b8f1d0]"}`}>{selectedPropagator.availability}</span>
                </div>
                <select className={inputClassName("!h-[34px] !cursor-pointer !font-semibold")} value={form.propagator} aria-describedby="manualOrbitPropagatorDescription" onChange={(event) => updatePropagator(event.target.value)}>
                    {selectedPropagator.unavailable && <option value={selectedPropagator.value} disabled>{selectedPropagator.label}</option>}
                    {PROPAGATION_ENGINE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <p id="manualOrbitPropagatorDescription" className="m-0 text-[10px] leading-[1.35] font-medium text-[#7f94b4]">{selectedPropagator.description}</p>
                {selectedPropagator.value === "cowell-rk4" && <div className="mt-1 grid gap-2 rounded-md border border-[#213b5d] bg-[#0b182a] p-2" aria-label="Cowell numerical configuration">
                    <label className="grid gap-1.5 text-[10px] font-semibold text-[#c7d5ea]">
                        <span>Numerical integrator</span>
                        <select className={inputClassName("!h-[31px] !cursor-pointer !text-[11px]")} value={form.propagationOptions.numericalIntegrator} onChange={(event) => updatePropagationOption("numericalIntegrator", normalizeNumericalIntegrator(event.target.value, form.propagationOptions.numericalIntegrator))}>
                            {COWELL_NUMERICAL_INTEGRATOR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        <small className="text-[9px] leading-[1.3] font-medium text-[#7f94b4]">RK4 is available now; future numerical integrators will be added here.</small>
                    </label>
                    <fieldset className="grid gap-1.5 rounded-md border border-[#1d3658] bg-[#081426] p-2" aria-describedby="manualOrbitForceTermsDescription">
                        <legend className="px-1 text-[10px] leading-none font-semibold text-[#c7d5ea]">Force model</legend>
                        <p id="manualOrbitForceTermsDescription" className="m-0 text-[9px] leading-[1.3] font-medium text-[#7f94b4]">Combine perturbations independently. Central gravity is the mandatory base term.</p>
                        {unsupportedForceTerms.length > 0 && <p className="m-0 rounded border border-[#66543a] bg-[#251f16] px-1.5 py-1 text-[9px] leading-[1.3] font-medium text-[#f0d39d]" role="status">Unsupported terms are preserved: {unsupportedForceTerms.join(", ")}. This build cannot edit or propagate them yet.</p>}
                        <div className="grid grid-cols-2 gap-1.5">
                            {FORCE_TERM_OPTIONS.map((option) => <div key={option.value} className={option.value === "drag" ? "col-span-2" : ""}>
                                <ForceTermToggle option={option} checked={activeForceTerms.includes(option.value)} required={option.value === "central"} onChange={(enabled) => updateForceTerm(option.value, enabled)} />
                            </div>)}
                        </div>
                    </fieldset>
                    {dragEnabled && <div className="grid gap-2 rounded-md border border-[#31506f] bg-[#0d1d34] p-2" aria-label="Atmospheric drag parameters">
                        <p className="m-0 text-[9px] leading-[1.35] font-medium text-[#b8d2f3]">Density-based drag is integrated with the selected force terms. Its effect becomes weak above 600 km and negligible above 1,500 km.</p>
                        <div className="grid grid-cols-3 gap-2">
                            <label className="grid min-w-0 gap-1 text-[9px] font-semibold text-[#c7d5ea]">
                                <span>Cd</span>
                                <input className={inputClassName("!h-[31px] !px-1.5 !text-[11px]")} type="number" min="0.01" max="10" step="0.01" inputMode="decimal" value={form.propagationOptions.dragCoefficient} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updatePropagationOption("dragCoefficient", boundedNumber(value, form.propagationOptions.dragCoefficient, 0.01, 10)); }} />
                            </label>
                            <label className="grid min-w-0 gap-1 text-[9px] font-semibold text-[#c7d5ea]">
                                <span>Area (m²)</span>
                                <input className={inputClassName("!h-[31px] !px-1.5 !text-[11px]")} type="number" min="0.0001" max="100000" step="0.01" inputMode="decimal" value={form.propagationOptions.areaM2} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updatePropagationOption("areaM2", boundedNumber(value, form.propagationOptions.areaM2, 0.0001, 100000)); }} />
                            </label>
                            <label className="grid min-w-0 gap-1 text-[9px] font-semibold text-[#c7d5ea]">
                                <span>Mass (kg)</span>
                                <input className={inputClassName("!h-[31px] !px-1.5 !text-[11px]")} type="number" min="0.001" max="1000000" step="0.1" inputMode="decimal" value={form.propagationOptions.massKg} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updatePropagationOption("massKg", boundedNumber(value, form.propagationOptions.massKg, 0.001, 1000000)); }} />
                            </label>
                        </div>
                    </div>}
                </div>}
            </section>

            <button className="mt-3 inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#294d7b] bg-[#0d1d33] px-3 py-2 text-[10px] leading-none font-bold text-[#b7d4ff] hover:border-[#5787c9] hover:bg-[#142a49] hover:text-[#edf5ff] disabled:cursor-not-allowed disabled:opacity-45" type="button" title={selectedPropagator.unavailable ? "Choose an installed propagator before inspecting propagated parameters." : "Inspect the orbital elements over this design window."} disabled={!epochRangeValid || selectedPropagator.unavailable} onClick={openPropagatedParameters}>Ver parámetros propagados</button>
            </>}
            <button className="mt-3 w-full cursor-pointer rounded-lg border border-[#39445a] bg-[#111a29] px-3 py-2 text-[10px] leading-none font-bold text-[#b7c5da] hover:border-[#637c9f] hover:bg-[#17253a] hover:text-[#ecf3ff]" type="button" onClick={reset}>Reset values</button>
        </div>

        <div className="min-h-0 shrink-0 border-t border-[#1e3049] bg-[rgba(6,14,25,.84)] shadow-[0_-8px_18px_rgba(0,0,0,.14)]">
            <div className="px-4 pt-3 pb-2">
                <button className="inline-flex min-h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[#416b9e] bg-[#10253f] px-3 py-2 text-[10px] leading-none font-bold text-[#cbe2ff] hover:border-[#6699d3] hover:bg-[#173758]" type="button" onClick={togglePreviewVectors}>{vectorsVisible ? "Ocultar ejes y vectores" : "Ver ejes y vectores"}</button>
            </div>
            <footer className="grid grid-cols-2 gap-2 border-t border-[#1b2c43] px-4 pt-2 pb-3">
                <button className="min-h-[34px] cursor-pointer rounded-lg border border-[#3c3145] bg-[#1b1320] px-3 text-[11px] leading-none font-bold text-[#e1b5c1] hover:border-[#885166] hover:bg-[#2a1721] hover:text-[#ffe2e9]" type="button" onClick={() => requestClose("cancel")}>Cancel</button>
                <button className="min-h-[34px] cursor-pointer rounded-lg border border-[#476dce] bg-[#3657dc] px-3 text-[11px] leading-none font-bold text-white shadow-[0_6px_16px_rgba(41,76,220,.3)] hover:border-[#6e91ff] hover:bg-[#4668ee] disabled:cursor-wait disabled:opacity-55" type="button" title={selectedPropagator.unavailable ? "Choose an installed propagator before updating this orbit." : undefined} disabled={status?.kind === "busy" || !epochRangeValid || selectedPropagator.unavailable} onClick={() => dispatch("orbit:manual-orbit-create", payloadFor(form))}>{status?.kind === "busy" ? (isEditingManualOrbit ? "Updating..." : "Creating...") : (isEditingManualOrbit ? "Actualizar \u00f3rbita" : "Crear \u00f3rbita")}</button>
            </footer>
        </div>
    </aside>;
}
