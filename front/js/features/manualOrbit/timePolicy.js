/**
 * Time-domain policy for a manually designed orbit.
 *
 * The design editor, the scene timeline and finite products all use UTC.
 * They do not become different *time frames* merely because their coverage
 * differs.  What must never happen silently is evaluating an Earth-fixed
 * force outside the ERP supplied for the manual orbit, or treating two
 * disjoint finite ephemerides as if they could be analysed together.
 *
 * This module is deliberately UI/framework independent.  The React TIME tab
 * can use it to set the design window after an ERP upload, while the legacy
 * runtime can use the same result before sending a manual-orbit request.
 */

export const MANUAL_ERP_REQUIRED_FORCE_TERMS = Object.freeze([
    "geopotential",
    "drag"
]);

const START_ALIASES = Object.freeze([
    "startTime",
    "start_time",
    "startUtc",
    "start_utc",
    "startDate",
    "start_date",
    "start",
    "from",
    "coverageStart",
    "coverage_start",
    "startTimeMs",
    "start_time_ms",
    "startMs"
]);

const END_ALIASES = Object.freeze([
    "endTime",
    "end_time",
    "endUtc",
    "end_utc",
    "endDate",
    "end_date",
    "end",
    "to",
    "coverageEnd",
    "coverage_end",
    "stopTime",
    "stop_time",
    "endTimeMs",
    "end_time_ms",
    "endMs"
]);

function firstValue(source, aliases) {
    if (!source || typeof source !== "object") return undefined;
    for (const key of aliases) {
        if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
            return source[key];
        }
    }
    return undefined;
}

function utcMilliseconds(value) {
    if (value instanceof Date) {
        const milliseconds = value.getTime();
        return Number.isFinite(milliseconds) ? milliseconds : null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        // JSON product metadata is normally epoch milliseconds. Accepting a
        // numeric epoch in seconds keeps the policy safe for older SP3/OEM
        // adapters without guessing a calendar label.
        return Math.abs(value) < 10_000_000_000 ? value * 1000 : value;
    }
    if (typeof value !== "string" || !value.trim()) return null;

    const raw = value.trim();
    if (/^[+-]?\d+(?:\.\d+)?$/.test(raw)) {
        return utcMilliseconds(Number(raw));
    }
    // datetime-local values from TIME contain no offset. The editor defines
    // them as UTC, not as the browser's local civil time.
    const withUtcOffset = /(?:Z|[+-]\d\d:\d\d)$/i.test(raw)
        ? raw
        : /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?$/.test(raw)
            ? `${raw}${raw.length === 16 ? ":00" : ""}Z`
            : raw;
    const milliseconds = Date.parse(withUtcOffset);
    return Number.isFinite(milliseconds) ? milliseconds : null;
}

function rangeFromMilliseconds(startMs, endMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null;
    }
    return Object.freeze({
        startMs,
        endMs,
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString()
    });
}

/**
 * Normalise a time interval to a strict, ordered UTC range.
 *
 * A null result means that the caller did not provide an interval, or that
 * it is malformed.  The policy returns the reason separately so callers can
 * present a translated message rather than relying on a thrown Date error.
 */
export function normalizeManualOrbitUtcRange(value) {
    if (!value || typeof value !== "object") return null;
    return rangeFromMilliseconds(
        utcMilliseconds(firstValue(value, START_ALIASES)),
        utcMilliseconds(firstValue(value, END_ALIASES))
    );
}

/** Return whether the complete inner range is covered by the outer range. */
export function utcRangeCovers(outer, inner) {
    const normalizedOuter = normalizeManualOrbitUtcRange(outer);
    const normalizedInner = normalizeManualOrbitUtcRange(inner);
    return Boolean(normalizedOuter && normalizedInner
        && normalizedOuter.startMs <= normalizedInner.startMs
        && normalizedOuter.endMs >= normalizedInner.endMs);
}

/** Return the common UTC interval for a non-empty list of valid ranges. */
export function intersectManualOrbitUtcRanges(ranges = []) {
    const normalized = (Array.isArray(ranges) ? ranges : [ranges])
        .map((range) => normalizeManualOrbitUtcRange(range))
        .filter(Boolean);
    if (!normalized.length) return null;
    return rangeFromMilliseconds(
        Math.max(...normalized.map((range) => range.startMs)),
        Math.min(...normalized.map((range) => range.endMs))
    );
}

/**
 * Returns the automatic TIME design window after an ERP import.
 *
 * The deliberate policy is to use the full validated ERP interval. We do not
 * silently trim it to an existing SP3/OEM interval: that would hide an
 * incompatibility and change the manual design unexpectedly. The returned
 * `jointWindow` from `resolveManualOrbitTimePolicy` is the explicit interval
 * for operations involving both layers.
 */
export function designWindowFromManualErp(erpCoverage) {
    return normalizeManualOrbitUtcRange(erpCoverage);
}

/**
 * Return the physical state-vector epoch used when TIME adopts a validated
 * ERP design window. A successful ERP attach/replacement is explicit, so
 * anchoring the state to the same UTC start prevents retaining an older epoch
 * which the newly selected ERP cannot cover. Later edits remain explicit.
 */
export function physicalEpochAtDesignWindowStart(designWindow) {
    return normalizeManualOrbitUtcRange(designWindow)?.startTime || null;
}

/** Whether selected forces require an Earth-orientation ERP in manual TIME. */
export function manualOrbitForceTermsRequireErp(forceTerms = []) {
    const terms = Array.isArray(forceTerms)
        ? forceTerms
        : typeof forceTerms === "string"
            ? forceTerms.split(/[\s,;+|]+/)
            : [];
    const aliases = {
        "atmospheric-drag": "drag",
        atmosphericdrag: "drag",
        "full-geopotential": "geopotential",
        fullgeopotential: "geopotential",
        "gravity-field": "geopotential"
    };
    const normalized = new Set(terms.map((term) => {
        const value = String(term || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
        return aliases[value] || value;
    }));
    return MANUAL_ERP_REQUIRED_FORCE_TERMS.some((term) => normalized.has(term));
}

function normalizeFiniteRanges(value) {
    const values = Array.isArray(value) ? value : [];
    return values
        .map((entry) => {
            const range = normalizeManualOrbitUtcRange(entry?.range || entry);
            if (!range) return null;
            return {
                ...range,
                source: String(entry?.source || entry?.kind || entry?.format || "finite ephemeris").trim() || "finite ephemeris"
            };
        })
        .filter(Boolean);
}

/**
 * Assess the manual design against ERP and already active finite products.
 *
 * `canCreate` deliberately concerns only the manual orbit's own physical
 * contract. A non-overlapping SP3/OEM does not make an otherwise valid manual
 * propagation false; it instead sets `jointOperationsAllowed` to false so a
 * future comparison, conjunction or joint chart has no licence to fabricate
 * samples outside a product's published domain.
 */
export function resolveManualOrbitTimePolicy({
    designWindow,
    physicalEpoch,
    erpCoverage,
    forceTerms = [],
    sceneWindow,
    finiteEphemerisRanges = []
} = {}) {
    const design = normalizeManualOrbitUtcRange(designWindow);
    // The propagated state is defined at this instant. It may differ from
    // the visible design window, so ERP coverage must include it as well:
    // Cowell integrates from the state epoch to the requested samples.
    const physicalEpochProvided = !(physicalEpoch === undefined || physicalEpoch === null || physicalEpoch === "");
    const physicalEpochMs = physicalEpochProvided ? utcMilliseconds(physicalEpoch) : null;
    const erp = normalizeManualOrbitUtcRange(erpCoverage);
    const scene = normalizeManualOrbitUtcRange(sceneWindow);
    const finite = normalizeFiniteRanges(finiteEphemerisRanges);
    const requiresErp = manualOrbitForceTermsRequireErp(forceTerms);
    const blockingReasons = [];
    const warnings = [];

    if (!design) {
        blockingReasons.push("invalid-design-window");
    }
    if (requiresErp && !erp) {
        blockingReasons.push("missing-erp");
    }
    if (requiresErp && erp && design && !utcRangeCovers(erp, design)) {
        blockingReasons.push("erp-does-not-cover-design-window");
    }
    if (requiresErp && physicalEpochProvided && !Number.isFinite(physicalEpochMs)) {
        blockingReasons.push("invalid-physical-epoch");
    } else if (requiresErp && physicalEpochProvided && erp && !(
        physicalEpochMs >= erp.startMs && physicalEpochMs <= erp.endMs
    )) {
        blockingReasons.push("erp-does-not-cover-physical-epoch");
    }

    const sharedInputs = [design, scene, ...finite].filter(Boolean);
    const hasSceneConstraint = Boolean(scene || finite.length);
    const jointWindow = hasSceneConstraint && design
        ? intersectManualOrbitUtcRanges(sharedInputs)
        : null;
    const sceneRelation = !hasSceneConstraint
        ? "not-applicable"
        : jointWindow
            ? utcRangeCovers(jointWindow, design) ? "contained" : "overlap"
            : "disjoint";

    if (sceneRelation === "overlap") {
        warnings.push("joint-operations-must-use-common-window");
    } else if (sceneRelation === "disjoint") {
        warnings.push("no-common-window-with-active-scene");
    }

    return Object.freeze({
        canCreate: blockingReasons.length === 0,
        requiresErp,
        erpCoversDesign: Boolean(erp && design && utcRangeCovers(erp, design)),
        physicalEpoch: Number.isFinite(physicalEpochMs)
            ? new Date(physicalEpochMs).toISOString()
            : null,
        erpCoversPhysicalEpoch: Boolean(
            erp
            && Number.isFinite(physicalEpochMs)
            && physicalEpochMs >= erp.startMs
            && physicalEpochMs <= erp.endMs
        ),
        designWindow: design,
        erpCoverage: erp,
        sceneWindow: scene,
        finiteEphemerisRanges: Object.freeze(finite),
        jointWindow,
        jointOperationsAllowed: Boolean(jointWindow),
        sceneRelation,
        blockingReasons: Object.freeze(blockingReasons),
        warnings: Object.freeze(warnings)
    });
}
