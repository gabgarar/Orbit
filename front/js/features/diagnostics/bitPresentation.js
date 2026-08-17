/**
 * Presentation policy for the Built-In Test (BIT).
 *
 * The server owns the checks and the startup ledger.  This module only
 * decides which already-published facts are meaningful in the current scene
 * and prevents an absent optional product from looking like a failed one.
 */

import {
    DIAGNOSTIC_COMPONENTS,
    findDiagnosticComponent,
    normalizeDiagnosticStatus
} from "./diagnosticsContract.js";
import {
    getStartupProjectReadiness,
    startupStatusFromDiagnosticComponent
} from "./startupStatus.js";

const ALWAYS_VISIBLE_COMPONENT_IDS = new Set([
    "monitor",
    "erp",
    "gravity",
    "propagators",
    "forces",
    "frames"
]);

const CONTEXTUAL_COMPONENT_IDS = new Set(["sp3", "oem", "mtr"]);

function finitePositiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0;
}

function worstStatus(values) {
    const statuses = values.filter(Boolean).map((value) => normalizeDiagnosticStatus(value));
    if (statuses.includes("error")) return "error";
    if (statuses.includes("warning")) return "warning";
    return statuses.length ? "healthy" : "warning";
}

function localStatusFor(id, local) {
    if (id === "sp3") return local?.sp3?.status || "";
    if (id === "oem") return local?.oem?.status || "";
    if (id === "mtr") return local?.mtr?.status || "";
    return "";
}

/** True only when the optional scene fact actually exists. */
export function isBitComponentRelevant(id, { local = null } = {}) {
    if (ALWAYS_VISIBLE_COMPONENT_IDS.has(id)) return true;
    if (!CONTEXTUAL_COMPONENT_IDS.has(id)) return false;
    if (id === "sp3") {
        // The diagnostics service counts persisted products in its registry,
        // not products currently enabled in this scene.  A cached product
        // must never manufacture a SP3 BIT card after the user has removed
        // every SP3 layer, so local scene ownership is authoritative here.
        return finitePositiveNumber(local?.sp3?.activeCount)
            || finitePositiveNumber(local?.sp3?.registeredActiveCount);
    }
    if (id === "oem") return finitePositiveNumber(local?.oem?.activeCount);
    // A monitor process is not an MTR.  Show the MTR only when the browser
    // has published an actual master range for this scene.
    return local?.mtr?.active === true;
}

/**
 * The initial startup ledger is rendered separately as IBIT.  CI/CD is
 * intentionally not a runtime component: release/download gating belongs to
 * GitHub Actions, not a browser-side operational health result.
 */
export function visibleBitComponents(context = {}) {
    return DIAGNOSTIC_COMPONENTS.filter(({ id }) => isBitComponentRelevant(id, context));
}

export function continuousBitComponentStatus(id, { diagnostics = null, local = null } = {}) {
    const component = findDiagnosticComponent(diagnostics, id);
    // MTR is a browser-scene fact. Do not let a server health entry
    // manufacture an MTR result where no master range exists locally.
    const remoteStatus = id === "mtr" ? "" : component?.status;
    return worstStatus([remoteStatus, localStatusFor(id, local)]);
}

/** Current runtime status, derived only from cards that are actually shown. */
export function continuousBitStatus({ availability = "loading", diagnostics = null, local = null } = {}) {
    if (availability !== "available") return "warning";
    const visible = visibleBitComponents({ diagnostics, local });
    return worstStatus(visible.map(({ id }) => continuousBitComponentStatus(id, { diagnostics, local })));
}

/**
 * Describe the latest initial Built-In Test (IBIT) without confusing a
 * timestamp or a generic health state with permission to create a project.
 */
export function initialBitSummary(diagnostics) {
    const component = findDiagnosticComponent(diagnostics, "startup");
    if (!component) {
        return {
            status: "warning",
            result: "Sin resultado publicado",
            message: "El servicio todavía no ha publicado el resultado del IBIT inicial.",
            startup: null,
            terminal: false,
            passed: false
        };
    }

    const startup = startupStatusFromDiagnosticComponent(component);
    if (!startup) {
        return {
            status: "warning",
            result: "Sin resultado legible",
            message: "El servicio publicó el arranque, pero no un ledger de IBIT interpretable.",
            startup: null,
            terminal: false,
            passed: false
        };
    }

    const readiness = getStartupProjectReadiness(startup);
    const terminalStep = startup.steps.find((step) => step.id === "complete");
    const terminal = Boolean(startup.completedAt)
        || Boolean(terminalStep && terminalStep.status !== "pending");
    const hasErrors = startup.errors.length > 0 || readiness.blockers.length > 0 || startup.status === "error";
    const passed = terminal
        && startup.status === "healthy"
        && readiness.ready === true
        && !hasErrors;

    if (hasErrors) {
        return {
            status: "error",
            result: "Falló",
            message: readiness.message || startup.errors[0] || startup.message || "El IBIT inicial publicó un error.",
            startup,
            terminal,
            passed: false
        };
    }
    if (!terminal) {
        return {
            status: "warning",
            result: "En curso",
            message: readiness.message || startup.message || "El IBIT inicial aún está comprobando los recursos requeridos.",
            startup,
            terminal: false,
            passed: false
        };
    }
    if (!passed) {
        return {
            status: "warning",
            result: "Completado con avisos",
            message: readiness.message || startup.warnings[0] || startup.message || "El IBIT inicial terminó con una degradación publicada.",
            startup,
            terminal: true,
            passed: false
        };
    }
    return {
        status: "healthy",
        result: "Superado",
        message: startup.message || "Los recursos de inicio requeridos se validaron correctamente.",
        startup,
        terminal: true,
        passed: true
    };
}
