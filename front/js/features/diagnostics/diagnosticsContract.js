/**
 * Public contract shared by the Built-In Test panel and the legacy runtime.
 *
 * The diagnostics endpoint is intentionally additive: an older Orbit backend
 * may not expose it yet.  Consumers therefore use this module to normalize
 * both the canonical shape and small snake_case/camelCase variations without
 * treating an absent diagnostic as a successful validation.
 */

export const DIAGNOSTICS_STATE_EVENT = "orbit:diagnostics-state";
export const DIAGNOSTICS_LOCAL_STATE_EVENT = "orbit:diagnostics-local-state";
export const DIAGNOSTICS_LOCAL_STATE_REQUEST_EVENT = "orbit:diagnostics-local-state-request";

export const DIAGNOSTIC_ENDPOINT_CANDIDATES = Object.freeze([
    "/api/system/diagnostics",
    "/api/diagnostics"
]);

export const DIAGNOSTIC_COMPONENTS = Object.freeze([
    { id: "startup", label: "Startup sequence" },
    { id: "monitor", label: "Runtime monitor" },
    { id: "erp", label: "ERP / EOP loader" },
    { id: "gravity", label: "Gravity models (EGM96 / EGM2008)" },
    { id: "sp3", label: "SP3 parser" },
    { id: "oem", label: "OEM parser" },
    { id: "propagators", label: "Propagators" },
    { id: "forces", label: "Force models" },
    { id: "mtr", label: "Time manager (MTR)" },
    { id: "frames", label: "Reference frames" },
    { id: "cicd", label: "CI/CD test suite" }
]);

const COMPONENT_ALIASES = Object.freeze({
    startup: "startup",
    startupsequence: "startup",
    startuplifecycle: "startup",
    startupstatus: "startup",
    boot: "startup",
    initialization: "startup",
    erp: "erp",
    eop: "erp",
    erploader: "erp",
    eoploader: "erp",
    gravity: "gravity",
    gravitymodel: "gravity",
    gravitymodels: "gravity",
    geopotential: "gravity",
    geopotentialmodel: "gravity",
    geopotentialmodels: "gravity",
    earthgravity: "gravity",
    sp3: "sp3",
    sp3parser: "sp3",
    preciseproducts: "sp3",
    preciseproduct: "sp3",
    oem: "oem",
    oemparser: "oem",
    propagator: "propagators",
    propagators: "propagators",
    propagation: "propagators",
    forcemodel: "forces",
    forcemodels: "forces",
    forces: "forces",
    mtr: "mtr",
    timemanager: "mtr",
    timemanagement: "mtr",
    time: "mtr",
    monitor: "monitor",
    healthmonitor: "monitor",
    frame: "frames",
    frames: "frames",
    referenceframes: "frames",
    referencesystems: "frames",
    cicd: "cicd",
    ci: "cicd",
    workflows: "cicd",
    testsuite: "cicd"
});

const STATUS_ALIASES = Object.freeze({
    healthy: "healthy",
    health: "healthy",
    ok: "healthy",
    ready: "healthy",
    passed: "healthy",
    pass: "healthy",
    success: "healthy",
    warning: "warning",
    warn: "warning",
    degraded: "warning",
    unknown: "warning",
    unavailable: "warning",
    pending: "warning",
    error: "error",
    failed: "error",
    failure: "error",
    unhealthy: "error",
    down: "error"
});

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
    if (value === undefined || value === null) return "";
    return String(value).trim();
}

function normalizedKey(value) {
    return text(value).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function firstValue(source, keys) {
    const value = record(source);
    if (!value) return undefined;
    for (const key of keys) {
        if (value[key] !== undefined && value[key] !== null && value[key] !== "") return value[key];
    }
    return undefined;
}

function firstText(source, keys) {
    return text(firstValue(source, keys));
}

function canonicalComponentId(value) {
    return COMPONENT_ALIASES[normalizedKey(value)] || "";
}

function componentLabel(id, fallback = "") {
    return DIAGNOSTIC_COMPONENTS.find((component) => component.id === id)?.label || text(fallback) || id;
}

/** Convert common health spellings to the three statuses rendered by Orbit. */
export function normalizeDiagnosticStatus(value, fallback = "warning") {
    const normalized = STATUS_ALIASES[normalizedKey(value)];
    return normalized || STATUS_ALIASES[normalizedKey(fallback)] || "warning";
}

/**
 * Normalise one endpoint component while preserving `details` verbatim for
 * the presenter.  No field is manufactured: absent server data stays absent.
 */
export function normalizeDiagnosticComponent(value, fallbackId = "") {
    const source = record(value) || {};
    const id = canonicalComponentId(firstText(source, ["id", "key", "name", "component", "component_id", "componentId"]))
        || canonicalComponentId(fallbackId)
        || normalizedKey(fallbackId);
    const nestedDetails = record(firstValue(source, ["details", "data", "payload", "metadata"]));
    // Keep root-level metrics as well as a nested `details` block. Several
    // small service implementations put `status` at the root and diagnostic
    // values beneath `details`; losing either would make the panel look as
    // though the service had not published the value.
    const details = nestedDetails ? { ...source, ...nestedDetails } : source;
    return {
        id,
        label: firstText(source, ["label", "title", "display_name", "displayName", "name"]) || componentLabel(id, fallbackId),
        status: normalizeDiagnosticStatus(firstValue(source, ["status", "health", "state", "result"])),
        lastValidatedAt: firstText(source, [
            "last_validated_at", "lastValidatedAt", "validated_at", "validatedAt",
            "last_validation", "lastValidation", "timestamp", "checked_at", "checkedAt",
            "updated_at", "updatedAt"
        ]),
        summary: firstText(source, ["summary", "description", "message", "detail"]),
        message: firstText(source, ["message", "detail", "error", "reason"]),
        details
    };
}

function componentEntries(value) {
    if (Array.isArray(value)) {
        return value.map((item) => ["", item]);
    }
    const source = record(value);
    return source ? Object.entries(source) : [];
}

/**
 * Accepts both the documented `{ components: [...] }` response and an object
 * keyed by component (`{ erp: {...}, sp3: {...} }`).
 */
export function normalizeSystemDiagnosticsPayload(payload) {
    const source = record(payload) || {};
    const rawComponents = firstValue(source, ["components", "diagnostics", "checks", "health_checks", "healthChecks"]);
    const componentsById = new Map();

    componentEntries(rawComponents).forEach(([fallbackId, value]) => {
        const component = normalizeDiagnosticComponent(value, fallbackId);
        if (component.id) componentsById.set(component.id, component);
    });

    // A compact endpoint may place component blocks at the root.  Respect the
    // named health fields, but never infer a missing block from unrelated data.
    DIAGNOSTIC_COMPONENTS.forEach(({ id }) => {
        if (componentsById.has(id)) return;
        const aliases = Object.entries(COMPONENT_ALIASES)
            .filter(([, canonical]) => canonical === id)
            .map(([alias]) => alias);
        const matchingRootKey = Object.keys(source).find((key) => aliases.includes(normalizedKey(key)));
        if (matchingRootKey) {
            componentsById.set(id, normalizeDiagnosticComponent(source[matchingRootKey], id));
        }
    });

    const components = [...componentsById.values()];
    const explicitStatus = firstValue(source, ["status", "health", "state", "result"]);
    const worstStatus = components.some((component) => component.status === "error")
        ? "error"
        : components.some((component) => component.status === "warning")
            ? "warning"
            : "healthy";
    return {
        status: normalizeDiagnosticStatus(explicitStatus, components.length ? worstStatus : "warning"),
        updatedAt: firstText(source, ["updated_at", "updatedAt", "last_updated_at", "lastUpdatedAt", "timestamp", "checked_at", "checkedAt"]),
        components,
        raw: source
    };
}

export function findDiagnosticComponent(diagnostics, id) {
    const canonicalId = canonicalComponentId(id) || normalizedKey(id);
    return Array.isArray(diagnostics?.components)
        ? diagnostics.components.find((component) => component?.id === canonicalId) || null
        : null;
}

/**
 * Fetch a supported endpoint in order.  A missing endpoint is a controlled
 * outcome, not a rejected import/propagation operation.
 */
export async function fetchSystemDiagnostics(fetchImpl = globalThis.fetch, endpoints = DIAGNOSTIC_ENDPOINT_CANDIDATES, options = {}) {
    if (typeof fetchImpl !== "function") {
        return { availability: "unavailable", endpoint: "", diagnostics: null, error: "Fetch no est\u00e1 disponible en este entorno." };
    }

    const attempts = [];
    for (const endpoint of endpoints) {
        try {
            const response = await fetchImpl(endpoint, {
                method: "GET",
                cache: "no-store",
                headers: { Accept: "application/json" },
                signal: options.signal
            });
            if (!response?.ok) {
                attempts.push(`${endpoint}: HTTP ${response?.status ?? "?"}`);
                continue;
            }
            const payload = await response.json();
            return {
                availability: "available",
                endpoint,
                diagnostics: normalizeSystemDiagnosticsPayload(payload),
                error: ""
            };
        } catch (error) {
            if (error?.name === "AbortError") throw error;
            attempts.push(`${endpoint}: ${text(error?.message) || "no disponible"}`);
        }
    }

    return {
        availability: "unavailable",
        endpoint: "",
        diagnostics: null,
        error: attempts.join(" · ") || "El endpoint de diagn\u00f3sticos no est\u00e1 disponible."
    };
}
