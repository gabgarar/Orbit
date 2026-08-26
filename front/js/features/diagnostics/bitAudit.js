/**
 * Compact, exportable evidence for the operational BIT surface.
 *
 * The project propagation history is already normalized/persisted by the
 * ephemerides runtime.  This module deliberately only reads that metadata and
 * the current PBIT ledger: it never stores samples, raw service responses, or
 * a second diagnostics cache.
 */

import { normalizePropagationHistory } from "../propagatedParameters/propagationHistory.js";

export const BIT_AUDIT_SCHEMA = "orbit-bit-audit/v1";

const KNOWN_STATUSES = new Set(["healthy", "warning", "error", "running", "completed", "failed", "cancelled"]);

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value, maximum = 720) {
    return value === undefined || value === null ? "" : String(value).trim().slice(0, maximum);
}

function nullableText(value, maximum = 720) {
    const normalized = text(value, maximum);
    return normalized || null;
}

function isoDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function status(value, fallback = "warning") {
    const normalized = text(value, 32).toLowerCase();
    return KNOWN_STATUSES.has(normalized) ? normalized : fallback;
}

function stringList(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => text(item)).filter(Boolean).slice(0, 64);
}

function startupAudit(pbit) {
    const summary = record(pbit);
    const startup = record(summary.startup);
    const readiness = record(startup.readiness);
    const steps = Array.isArray(startup.steps) ? startup.steps : [];
    return Object.freeze({
        status: status(summary.status),
        result: nullableText(summary.result, 120),
        message: nullableText(summary.message),
        startedAt: isoDate(startup.startedAt),
        completedAt: isoDate(startup.completedAt),
        readiness: Object.freeze({
            ready: readiness.ready === true,
            state: nullableText(readiness.state, 64),
            message: nullableText(readiness.message)
        }),
        warnings: Object.freeze(stringList(startup.warnings)),
        errors: Object.freeze(stringList(startup.errors)),
        steps: Object.freeze(steps.slice(0, 256).map((step, index) => {
            const source = record(step);
            return Object.freeze({
                id: nullableText(source.id, 160) || `step-${index + 1}`,
                label: nullableText(source.label, 240) || nullableText(source.id, 160) || `Paso ${index + 1}`,
                status: status(source.status),
                timestamp: isoDate(source.timestamp ?? source.updatedAt ?? source.completedAt),
                message: nullableText(source.message)
            });
        }))
    });
}

/**
 * Create a portable export snapshot.  It accepts the UI dashboard rather
 * than remote diagnostics directly so only facts already interpreted by BIT
 * are included.
 */
export function buildBitAuditSnapshot({
    dashboard = null,
    availability = "loading",
    endpoint = "",
    checkedAt = "",
    propagationHistory = [],
    exportedAt = new Date()
} = {}) {
    const source = record(dashboard);
    return Object.freeze({
        schema: BIT_AUDIT_SCHEMA,
        exportedAt: isoDate(exportedAt) || new Date().toISOString(),
        system: Object.freeze({
            status: status(source.status),
            availability: nullableText(availability, 64),
            endpoint: nullableText(endpoint, 360),
            checkedAt: isoDate(checkedAt)
        }),
        pbit: startupAudit(source.pbit),
        // This strips accidental raw sample payloads a second time at the
        // export boundary and maintains the project retention order.
        propagationHistory: Object.freeze(normalizePropagationHistory(propagationHistory))
    });
}

/** Flatten PBIT and propagation data for a table or a CSV file. */
export function bitAuditRows(snapshot) {
    const source = record(snapshot);
    const pbit = record(source.pbit);
    const pbitTimestamp = pbit.completedAt || pbit.startedAt || source?.system?.checkedAt || null;
    const startupRow = {
        id: "pbit:summary",
        kind: "PBIT",
        status: status(pbit.status),
        timestamp: pbitTimestamp,
        title: "Resultado del PBIT de inicio",
        detail: pbit.message || pbit.result || "Sin detalle publicado.",
        target: "",
        source: "",
        propagator: "",
        rangeStart: "",
        rangeEnd: "",
        sampling: "",
        sampleCount: ""
    };
    const steps = Array.isArray(pbit.steps) ? pbit.steps : [];
    const stepRows = steps.map((step) => ({
        id: `pbit:${step.id}`,
        kind: "PBIT",
        status: status(step.status),
        timestamp: step.timestamp || pbitTimestamp,
        title: step.label || step.id || "Paso de inicio",
        detail: step.message || "Sin detalle publicado.",
        target: "",
        source: "",
        propagator: "",
        rangeStart: "",
        rangeEnd: "",
        sampling: "",
        sampleCount: ""
    }));
    const propagationRows = normalizePropagationHistory(source.propagationHistory).map((entry) => ({
        id: `propagation:${entry.id}`,
        kind: "PROPAGACIÓN",
        status: status(entry.status, "running"),
        timestamp: entry.updatedAt || entry.finishedAt || entry.startedAt || null,
        title: entry.target?.name || entry.target?.id || "Órbita sin nombre",
        detail: entry.error || entry.message || "Sin detalle adicional.",
        target: entry.target?.name || entry.target?.id || "",
        source: entry.source || "",
        propagator: entry.propagator || "",
        rangeStart: entry.range?.startTime || "",
        rangeEnd: entry.range?.endTime || "",
        sampling: entry.sampling?.effectiveIntervalSeconds ?? entry.sampling?.requestedIntervalSeconds ?? "",
        sampleCount: entry.result?.sampleCount ?? entry.sampling?.sampleCount ?? ""
    }));
    return Object.freeze([startupRow, ...stepRows, ...propagationRows]);
}

function csvCell(value) {
    const raw = value === undefined || value === null ? "" : String(value);
    return `"${raw.replaceAll("\"", "\"\"")}"`;
}

/** Stable UTF-8 CSV that keeps audit categories and all propagation metadata. */
export function serializeBitAuditCsv(snapshot) {
    const header = [
        "kind", "status", "timestamp_utc", "title", "detail", "target",
        "source", "propagator", "range_start_utc", "range_end_utc",
        "sampling_seconds", "sample_count"
    ];
    const rows = bitAuditRows(snapshot).map((row) => [
        row.kind, row.status, row.timestamp || "", row.title, row.detail,
        row.target, row.source, row.propagator, row.rangeStart, row.rangeEnd,
        row.sampling, row.sampleCount
    ]);
    return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function bitAuditFileName(format = "json", exportedAt = new Date()) {
    const timestamp = (isoDate(exportedAt) || new Date().toISOString())
        .replace(/[:.]/gu, "-")
        .replace(/Z$/u, "Z");
    return `orbit-bit-audit-${timestamp}.${text(format, 16).toLowerCase() === "csv" ? "csv" : "json"}`;
}
