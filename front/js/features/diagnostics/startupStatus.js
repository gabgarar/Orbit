/**
 * Small browser-side contract for the non-blocking startup presentation.
 *
 * The Python service is authoritative for ERP and gravity work.  The browser
 * can nevertheless publish its own configuration/MTR milestones before the
 * diagnostics endpoint responds.  Keeping the snapshot in `window` prevents
 * a late-mounted React panel from missing early legacy-runtime events.
 */

import { normalizeDiagnosticStatus } from "./diagnosticsContract.js";

export const STARTUP_STATUS_EVENT = "orbit:startup-status";
export const STARTUP_STATUS_REQUEST_EVENT = "orbit:startup-status-request";
export const STARTUP_PROJECT_ACTION_BLOCKED_EVENT = "orbit:startup-project-action-blocked";

// A completed health check is not enough to author or restore a project.
// Only the service's explicit boolean `ready` flag may unlock those actions:
// it is set after every required cache has been downloaded and validated.
export const STARTUP_PROJECT_NOT_READY_MESSAGE = "Orbit está preparando los datos críticos (ERP y modelos de gravedad). Espera a que finalice la descarga y validación antes de crear o importar un proyecto.";

export const STARTUP_STEP_ORDER = Object.freeze([
    "configuration",
    "erp",
    "gravity",
    "gravity-download",
    "gravity-validation",
    "mtr",
    "complete"
]);

export const STARTUP_STEP_LABELS = Object.freeze({
    configuration: "Comprobando configuración…",
    erp: "Verificando parámetros de orientación terrestre (ERP)…",
    gravity: "Comprobando modelos de gravedad locales (EGM96 / EGM2008)…",
    "gravity-download": "Descargando modelos de gravedad faltantes desde NGA…",
    "gravity-validation": "Validando modelos de gravedad…",
    mtr: "Inicializando gestor temporal (MTR)…",
    complete: "Inicio completado."
});

const STEP_ALIASES = Object.freeze({
    configuration: "configuration",
    config: "configuration",
    configurationcheck: "configuration",
    settings: "configuration",
    erp: "erp",
    eop: "erp",
    eopcheck: "erp",
    erpcheck: "erp",
    earthorientation: "erp",
    gravity: "gravity",
    geopotential: "gravity",
    gravitymodels: "gravity",
    gravitymodelcheck: "gravity",
    gravitydownload: "gravity-download",
    downloadgravity: "gravity-download",
    modeldownload: "gravity-download",
    gravityvalidation: "gravity-validation",
    validategravity: "gravity-validation",
    modelvalidation: "gravity-validation",
    mtr: "mtr",
    timemanager: "mtr",
    timemanagement: "mtr",
    complet: "complete",
    complete: "complete",
    completed: "complete",
    ready: "complete",
    startupcomplete: "complete"
});

const PENDING_STATUS_ALIASES = new Set([
    "", "pending", "running", "loading", "queued", "started", "inprogress", "in_progress"
]);

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
    const candidate = record(source);
    if (!candidate) return undefined;
    for (const key of keys) {
        if (candidate[key] !== undefined && candidate[key] !== null && candidate[key] !== "") return candidate[key];
    }
    return undefined;
}

function firstText(source, keys) {
    return text(firstValue(source, keys));
}

function canonicalStepId(value) {
    const key = normalizedKey(value);
    return STEP_ALIASES[key] || key;
}

function normalizeStepStatus(value, fallback = "pending") {
    const key = normalizedKey(value);
    if (PENDING_STATUS_ALIASES.has(key)) return "pending";
    return normalizeDiagnosticStatus(value, fallback);
}

function entries(value) {
    if (Array.isArray(value)) return value.map((item) => ["", item]);
    const source = record(value);
    return source ? Object.entries(source) : [];
}

function stepIndex(id) {
    const index = STARTUP_STEP_ORDER.indexOf(id);
    return index === -1 ? STARTUP_STEP_ORDER.length : index;
}

function sortedSteps(steps) {
    return [...steps]
        .map((step, index) => ({ step, index }))
        .sort((left, right) => stepIndex(left.step.id) - stepIndex(right.step.id) || left.index - right.index)
        .map(({ step }) => step);
}

/** Normalise a single emitted startup entry without claiming a result. */
export function normalizeStartupStep(value, fallbackId = "") {
    const source = record(value);
    const primitive = source ? null : value;
    const id = canonicalStepId(firstText(source, ["id", "key", "name", "step", "step_id", "stepId"]) || fallbackId);
    const statusValue = source
        ? firstValue(source, ["status", "health", "state", "result"])
        : primitive;
    return {
        id,
        label: firstText(source, ["label", "title", "description", "name"]) || STARTUP_STEP_LABELS[id] || text(fallbackId) || id,
        status: normalizeStepStatus(statusValue),
        message: firstText(source, ["message", "detail", "summary", "error", "reason"]),
        timestamp: firstText(source, ["timestamp", "at", "updated_at", "updatedAt", "checked_at", "checkedAt", "completed_at", "completedAt"])
    };
}

function rawStartupSteps(source) {
    const nested = record(firstValue(source, ["details", "data", "payload", "metadata", "startup"]));
    const candidates = [
        firstValue(source, ["steps", "startup_steps", "startupSteps", "log", "events", "entries"]),
        firstValue(nested, ["steps", "startup_steps", "startupSteps", "log", "events", "entries"])
    ];
    return candidates.find((candidate) => Array.isArray(candidate) || record(candidate)) || null;
}

function messages(source, keys) {
    const value = firstValue(source, keys);
    if (Array.isArray(value)) return value.map(text).filter(Boolean);
    const single = text(value);
    return single ? [single] : [];
}

function boolean(value) {
    if (value === true || value === false) return value;
    const normalized = normalizedKey(value);
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
    return null;
}

function boundedNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    const candidate = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(candidate)) return null;
    return Math.min(max, Math.max(min, candidate));
}

function normalizedProgressState(value) {
    const key = normalizedKey(value);
    if (["ready", "complete", "completed", "healthy", "ok", "success"].includes(key)) return "ready";
    if (["error", "failed", "failure"].includes(key)) return "error";
    if (["validating", "validation", "verify", "verifying"].includes(key)) return "validating";
    if (["downloading", "download", "fetching"].includes(key)) return "downloading";
    return "pending";
}

function progressModelEntries(value) {
    if (Array.isArray(value)) return value.map((item) => ["", item]);
    const source = record(value);
    return source ? Object.entries(source) : [];
}

function normalizeProgressModel(value, fallbackModel = "") {
    const source = record(value) || {};
    const downloaded = boundedNumber(firstValue(source, [
        "bytesDownloaded", "bytes_downloaded", "downloadedBytes", "downloaded_bytes", "receivedBytes", "received_bytes"
    ]));
    const total = boundedNumber(firstValue(source, [
        "totalBytes", "total_bytes", "bytesTotal", "bytes_total", "contentLength", "content_length"
    ]));
    const explicitPercent = boundedNumber(firstValue(source, ["percent", "percentage", "progress"]), { max: 100 });
    const inferredPercent = downloaded !== null && total !== null && total > 0
        ? Math.min(100, (downloaded / total) * 100)
        : null;
    const model = firstText(source, ["model", "id", "name", "key"]) || text(fallbackModel);
    return {
        model,
        state: normalizedProgressState(firstValue(source, ["state", "status", "stage"])),
        stage: firstText(source, ["stage", "phase", "operation"]),
        bytesDownloaded: downloaded,
        totalBytes: total,
        percent: explicitPercent ?? inferredPercent,
        message: firstText(source, ["message", "detail", "summary", "error", "reason"]),
        updatedAt: firstText(source, ["updatedAt", "updated_at", "timestamp", "at"])
    };
}

/**
 * Preserve download facts independently from the generic diagnostic card.
 * All values are optional because HTTP does not always expose Content-Length;
 * presenters must render an indeterminate bar instead of fabricating 100%.
 */
export function normalizeStartupProgress(value) {
    const source = record(value) || {};
    const nested = record(firstValue(source, ["details", "data", "payload", "metadata", "startup"])) || {};
    const merged = { ...source, ...nested };
    const rawProgress = record(firstValue(merged, ["progress", "startupProgress", "startup_progress"])) || {};
    const modelsSource = firstValue(rawProgress, ["models", "gravityModels", "gravity_models"]);
    const models = progressModelEntries(modelsSource)
        .map(([fallbackModel, item]) => normalizeProgressModel(item, fallbackModel))
        .filter((model) => model.model || model.message || model.bytesDownloaded !== null || model.percent !== null);
    const completedModels = boundedNumber(firstValue(rawProgress, ["completedModels", "completed_models", "completed", "done"]));
    const totalModels = boundedNumber(firstValue(rawProgress, ["totalModels", "total_models", "total", "count"]));
    const explicitPercent = boundedNumber(firstValue(rawProgress, ["percent", "percentage", "progress"]), { max: 100 });
    const inferredPercent = completedModels !== null && totalModels !== null && totalModels > 0
        ? Math.min(100, (completedModels / totalModels) * 100)
        : null;
    return {
        state: normalizedProgressState(firstValue(rawProgress, ["state", "status", "stage"])),
        currentModel: firstText(rawProgress, ["currentModel", "current_model", "model", "activeModel", "active_model"]),
        completedModels,
        totalModels,
        percent: explicitPercent ?? inferredPercent,
        models,
        message: firstText(rawProgress, ["message", "detail", "summary", "error", "reason"])
    };
}

function normalizeReadiness(value) {
    const source = record(value) || {};
    const nested = record(firstValue(source, ["details", "data", "payload", "metadata", "startup"])) || {};
    const merged = { ...source, ...nested };
    const rawReadiness = record(firstValue(merged, ["readiness"])) || {};
    const rawReady = firstValue(merged, ["ready"]);
    const ready = boolean(rawReady);
    const normalizeReadinessItems = (items) => Array.isArray(items)
        ? items.map((item) => {
            const blocker = record(item) || {};
            return {
                id: firstText(blocker, ["id", "key", "name", "step"]),
                status: normalizeStepStatus(firstValue(blocker, ["status", "health", "state", "result"])),
                message: firstText(blocker, ["message", "detail", "summary", "error", "reason"])
            };
        }).filter((item) => item.id || item.message)
        : [];
    const blockers = normalizeReadinessItems(rawReadiness.blockers);
    // A degradation is terminal and may still permit project creation.  Keep
    // it distinct from a blocker so the start-up warning notice can explain
    // the condition without changing the backend-owned readiness decision.
    const degradations = normalizeReadinessItems(rawReadiness.degradations);
    return {
        // Do not infer this from `status`, terminal timestamps, or warnings.
        // The backend owns the decision that all mandatory startup work passed.
        ready: ready === true,
        hasExplicitReady: ready !== null,
        state: firstText(rawReadiness, ["state", "status"]) || (ready === true ? "ready" : (ready === false ? "blocked" : "pending")),
        requiredSteps: Array.isArray(rawReadiness.requiredSteps)
            ? rawReadiness.requiredSteps.map(text).filter(Boolean)
            : (Array.isArray(rawReadiness.required_steps) ? rawReadiness.required_steps.map(text).filter(Boolean) : []),
        blockers,
        degradations,
        message: firstText(rawReadiness, ["message", "detail", "summary", "error", "reason"])
    };
}

/**
 * Accepts a standalone DOM event, a service `startup` diagnostic component,
 * or its nested `details`.  Missing steps remain missing rather than being
 * silently shown as healthy.
 */
export function normalizeStartupStatus(value) {
    const source = record(value) || {};
    const nested = record(firstValue(source, ["details", "data", "payload", "metadata", "startup"])) || {};
    const merged = { ...source, ...nested };
    const readiness = normalizeReadiness(value);
    const byId = new Map();
    entries(rawStartupSteps(merged)).forEach(([fallbackId, item]) => {
        const step = normalizeStartupStep(item, fallbackId);
        if (step.id) byId.set(step.id, step);
    });

    const individualStep = firstValue(merged, ["step", "startup_step", "startupStep", "append"]);
    if (individualStep !== undefined) {
        const step = normalizeStartupStep(individualStep);
        if (step.id) byId.set(step.id, step);
    }

    const statusValue = firstValue(merged, ["status", "health", "state", "result"]);
    const completedAt = firstText(merged, ["completed_at", "completedAt", "finished_at", "finishedAt", "ended_at", "endedAt"]);
    const status = completedAt && !text(statusValue) ? "healthy" : normalizeStepStatus(statusValue);
    return {
        status,
        source: firstText(merged, ["source", "origin", "provider"]),
        startedAt: firstText(merged, ["started_at", "startedAt", "created_at", "createdAt"]),
        completedAt,
        updatedAt: firstText(merged, ["updated_at", "updatedAt", "last_validated_at", "lastValidatedAt", "timestamp", "checked_at", "checkedAt"]),
        message: firstText(merged, ["message", "summary", "detail", "error", "reason"]),
        warnings: messages(merged, ["warnings", "warning", "alerts"]),
        errors: messages(merged, ["errors", "error"]),
        steps: sortedSteps([...byId.values()]),
        ready: readiness.ready,
        readiness,
        progress: normalizeStartupProgress(value),
        replace: merged.replace === true
    };
}

function mergeMessageLists(left, right) {
    return [...left, ...right].filter((value, index, values) => value && values.indexOf(value) === index);
}

/** Merge updates by step id so real-time event entries append safely. */
export function mergeStartupStatus(previous, update) {
    const before = normalizeStartupStatus(previous);
    const incoming = normalizeStartupStatus(update);
    const incomingReadiness = incoming.readiness;
    const readiness = incomingReadiness.hasExplicitReady
        ? incomingReadiness
        : {
            ...before.readiness,
            state: incomingReadiness.state !== "pending" ? incomingReadiness.state : before.readiness.state,
            requiredSteps: incomingReadiness.requiredSteps.length
                ? incomingReadiness.requiredSteps
                : before.readiness.requiredSteps,
            blockers: incomingReadiness.blockers.length
                ? incomingReadiness.blockers
                : before.readiness.blockers,
            degradations: incomingReadiness.degradations.length
                ? incomingReadiness.degradations
                : before.readiness.degradations,
            message: incomingReadiness.message || before.readiness.message
        };
    const steps = new Map((incoming.replace ? [] : before.steps).map((step) => [step.id, step]));
    incoming.steps.forEach((next) => {
        const current = steps.get(next.id);
        steps.set(next.id, current ? {
            ...current,
            ...next,
            label: next.label || current.label,
            message: next.message || current.message,
            timestamp: next.timestamp || current.timestamp
        } : next);
    });

    return {
        status: incoming.status !== "pending" || before.status === "pending" ? incoming.status : before.status,
        source: incoming.source || before.source,
        startedAt: incoming.startedAt || before.startedAt,
        completedAt: incoming.completedAt || before.completedAt,
        updatedAt: incoming.updatedAt || before.updatedAt,
        message: incoming.message || before.message,
        warnings: mergeMessageLists(incoming.replace ? [] : before.warnings, incoming.warnings),
        errors: mergeMessageLists(incoming.replace ? [] : before.errors, incoming.errors),
        steps: sortedSteps([...steps.values()]),
        ready: readiness.ready === true,
        readiness,
        // A full service diagnostics snapshot replaces this object. Browser
        // events that only append a step leave the last known download facts
        // intact so the progress bar does not jump backwards.
        progress: incoming.progress.models.length
            || incoming.progress.percent !== null
            || incoming.progress.message
            || incoming.progress.currentModel
            || incoming.progress.state !== "pending"
            ? incoming.progress
            : before.progress,
        replace: false
    };
}

/**
 * The sole frontend gate for creating/restoring a project.  `ready` must be
 * explicitly published by the service; health/terminal state is deliberately
 * not treated as permission because it can describe a degraded startup.
 */
export function getStartupProjectReadiness(value) {
    const startup = normalizeStartupStatus(value);
    const readiness = startup.readiness || {};
    const ready = startup.ready === true;
    const firstBlocker = Array.isArray(readiness.blockers)
        ? readiness.blockers.find((blocker) => blocker?.message)
        : null;
    const message = ready
        ? ""
        : readiness.message
            || firstBlocker?.message
            || (startup.errors?.[0] ? `Orbit no puede preparar los datos críticos: ${startup.errors[0]}` : STARTUP_PROJECT_NOT_READY_MESSAGE);
    return Object.freeze({
        ready,
        state: ready ? "ready" : (readiness.state || "pending"),
        message,
        blockers: Array.isArray(readiness.blockers) ? readiness.blockers : [],
        degradations: Array.isArray(readiness.degradations) ? readiness.degradations : [],
        requiredSteps: Array.isArray(readiness.requiredSteps) ? readiness.requiredSteps : []
    });
}

/** Notify any presenter that a guarded project action was declined. */
export function publishStartupProjectActionBlocked(action, windowRef = globalThis.window) {
    const readiness = getStartupProjectReadiness(windowRef?.__orbitStartupStatus);
    const detail = Object.freeze({
        action: text(action),
        ...readiness
    });
    const EventConstructor = windowRef?.CustomEvent || globalThis.CustomEvent;
    if (typeof windowRef?.dispatchEvent === "function" && typeof EventConstructor === "function") {
        windowRef.dispatchEvent(new EventConstructor(STARTUP_PROJECT_ACTION_BLOCKED_EVENT, { detail }));
    }
    return detail;
}

/** True only when the backend/local publisher explicitly reached a terminal state. */
export function isStartupTerminal(status) {
    const normalized = normalizeStartupStatus(status);
    return normalized.status === "error"
        || normalized.status === "healthy"
        || Boolean(normalized.completedAt)
        || normalized.steps.some((step) => step.id === "complete" && step.status !== "pending");
}

/** Cache and publish a partial or complete startup snapshot for late consumers. */
export function publishStartupStatus(update, windowRef = globalThis.window) {
    const current = windowRef?.__orbitStartupStatus;
    const snapshot = mergeStartupStatus(current, update);
    if (!windowRef || typeof windowRef !== "object") return snapshot;
    windowRef.__orbitStartupStatus = snapshot;
    const EventConstructor = windowRef.CustomEvent || globalThis.CustomEvent;
    if (typeof windowRef.dispatchEvent === "function" && typeof EventConstructor === "function") {
        windowRef.dispatchEvent(new EventConstructor(STARTUP_STATUS_EVENT, { detail: snapshot }));
    }
    return snapshot;
}

/** Pull a startup lifecycle from an already-normalised diagnostics component. */
export function startupStatusFromDiagnosticComponent(component) {
    if (!record(component)) return null;
    const details = record(component.details) || {};
    // `normalizeDiagnosticComponent` deliberately renders a generic pending
    // diagnostic as a warning because its cards only expose three states.  A
    // startup ledger has a real fourth, transient state, so prefer the
    // preserved service value in `details` before the presentation status.
    const rawStatus = firstValue(details, ["status", "health", "state", "result"])
        ?? component.status;
    return normalizeStartupStatus({
        // Keep root readiness/progress facts: diagnostics components commonly
        // put `ready` at the component level and verbose download metrics in
        // `details`.
        ...component,
        ...details,
        status: rawStatus,
        message: component.message || component.summary || details.message,
        lastValidatedAt: component.lastValidatedAt || details.lastValidatedAt
    });
}
