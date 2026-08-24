/**
 * Presentation model for the operational BIT dashboard.
 *
 * It deliberately separates transport liveness, PBIT readiness, time-data
 * quality and runtime validation. A prediction in ERP, for example, is an
 * operational warning; it is not evidence that the gateway or Python service
 * has failed. New diagnostics only need a section declaration and display
 * copy to join the dashboard.
 */

import {
    findDiagnosticComponent,
    normalizeDiagnosticStatus
} from "./diagnosticsContract.js";
import {
    continuousBitComponentStatus,
    initialBitSummary,
    visibleBitComponents
} from "./bitPresentation.js";

export const BIT_DASHBOARD_SECTIONS = Object.freeze([
    Object.freeze({
        id: "services",
        title: "Servicios de Orbit",
        description: "Disponibilidad del gateway, backend y monitor continuo.",
        componentIds: Object.freeze(["monitor"])
    }),
    Object.freeze({
        id: "time",
        title: "Tiempo y referencia",
        description: "ERP/EOP, reloj de escena y ruta de marcos de referencia.",
        componentIds: Object.freeze(["erp", "frames", "mtr"])
    }),
    Object.freeze({
        id: "runtime",
        title: "Validaciones del runtime",
        description: "Sondas operativas ejecutadas por Orbit; no son CI/CD.",
        componentIds: Object.freeze(["gravity", "propagators", "forces"])
    }),
    Object.freeze({
        id: "scene",
        title: "Datos de la escena",
        description: "Solo aparecen fuentes activas en esta escena.",
        componentIds: Object.freeze(["sp3", "oem"])
    })
]);

export const BIT_COMPONENT_COPY = Object.freeze({
    monitor: "Monitor continuo",
    erp: "ERP / EOP",
    frames: "Marcos de referencia",
    mtr: "Reloj de escena (MTR)",
    gravity: "Modelos de gravedad",
    propagators: "Propagadores",
    forces: "Modelo de fuerzas",
    sp3: "Productos SP3",
    oem: "Efemérides OEM"
});

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function firstText(...values) {
    return values.map(text).find(Boolean) || "";
}

function worstStatus(statuses, fallback = "warning") {
    const normalized = statuses.filter(Boolean).map((status) => normalizeDiagnosticStatus(status));
    if (normalized.includes("error")) return "error";
    if (normalized.includes("warning")) return "warning";
    return normalized.length ? "healthy" : fallback;
}

/** Count status facts without treating an absent component as a passed check. */
export function summarizeBitRows(rows = []) {
    const counts = { healthy: 0, warning: 0, error: 0, total: 0 };
    rows.forEach((row) => {
        const status = normalizeDiagnosticStatus(row?.status, "warning");
        counts[status] += 1;
        counts.total += 1;
    });
    return Object.freeze({ ...counts, status: worstStatus(rows.map((row) => row?.status)) });
}

function componentRow(id, context) {
    const component = findDiagnosticComponent(context.diagnostics, id);
    const status = component
        ? continuousBitComponentStatus(id, context)
        : "warning";
    return Object.freeze({
        id,
        kind: "component",
        label: BIT_COMPONENT_COPY[id] || component?.label || id,
        status,
        message: firstText(
            component?.message,
            component?.summary,
            component ? "Sin incidencias adicionales publicadas." : "Este componente aún no ha publicado su estado."
        ),
        component
    });
}

function serviceRows({ availability, runtimeHealth, diagnostics }) {
    const healthAvailable = runtimeHealth?.availability === "available";
    const healthPending = !runtimeHealth;
    const gatewayStatus = healthAvailable
        ? normalizeDiagnosticStatus(runtimeHealth?.gatewayStatus, "warning")
        : healthPending
            ? "warning"
            : "error";
    const pythonStatus = healthAvailable
        ? normalizeDiagnosticStatus(runtimeHealth?.pythonBackendStatus, "warning")
        : "warning";
    const diagnosticsStatus = availability === "available" ? "healthy" : "warning";
    const monitor = componentRow("monitor", { diagnostics, local: null });
    return Object.freeze([
        Object.freeze({
            id: "gateway",
            kind: "service",
            label: "Gateway web",
            status: gatewayStatus,
            message: healthAvailable
                ? "El punto de entrada HTTP respondió a la comprobación de vida."
                : healthPending
                    ? "Comprobación de vida pendiente."
                    : firstText(runtimeHealth?.error, "No se pudo comprobar el gateway local."),
            health: runtimeHealth || null
        }),
        Object.freeze({
            id: "python-backend",
            kind: "service",
            label: "Backend Python",
            status: pythonStatus,
            message: healthAvailable
                ? "Estado publicado por la comprobación de vida del gateway."
                : healthPending
                    ? "Pendiente de la primera comprobación de vida."
                    : "El estado del backend no está disponible mientras el gateway no responda.",
            health: runtimeHealth || null
        }),
        Object.freeze({
            id: "diagnostics-api",
            kind: "service",
            label: "Canal de diagnósticos",
            status: diagnosticsStatus,
            message: diagnosticsStatus === "healthy"
                ? "El endpoint de diagnósticos respondió correctamente."
                : "No hay una respuesta vigente del endpoint de diagnósticos.",
            health: null
        }),
        monitor
    ]);
}

function uniqueIssues(rows) {
    const seen = new Set();
    return rows.reduce((issues, row) => {
        if (!row || row.status === "healthy") return issues;
        const message = firstText(row.message, row.label);
        const key = `${row.status}:${row.id}:${message}`.toLocaleLowerCase();
        if (!message || seen.has(key)) return issues;
        seen.add(key);
        issues.push(Object.freeze({
            id: row.id,
            sectionId: row.sectionId || "",
            status: row.status,
            label: row.label,
            message
        }));
        return issues;
    }, []);
}

/**
 * Produce the stable, compact data model rendered by BuiltInTestPanel.
 * Contextual sources (SP3/OEM/MTR) retain the existing relevance policy, so
 * dormant caches never appear as a failed capability.
 */
export function buildBitDashboard({
    availability = "loading",
    diagnostics = null,
    local = null,
    runtimeHealth = null
} = {}) {
    const context = { diagnostics, local };
    const visibleIds = new Set(visibleBitComponents(context).map(({ id }) => id));
    const services = serviceRows({ availability, runtimeHealth, diagnostics });
    const sections = BIT_DASHBOARD_SECTIONS.map((definition) => {
        const rows = definition.id === "services"
            ? [...services]
            : definition.componentIds
                .filter((id) => visibleIds.has(id))
                .map((id) => componentRow(id, context));
        const taggedRows = rows.map((row) => Object.freeze({ ...row, sectionId: definition.id }));
        return Object.freeze({
            ...definition,
            rows: Object.freeze(taggedRows),
            summary: summarizeBitRows(taggedRows)
        });
    }).filter((section) => section.rows.length > 0);

    const pbit = initialBitSummary(diagnostics);
    const pbitRow = Object.freeze({
        id: "pbit",
        sectionId: "startup",
        label: "PBIT de inicio",
        status: pbit.status,
        message: pbit.message
    });
    const sectionById = new Map(sections.map((section) => [section.id, section]));
    const runtime = sectionById.get("runtime")?.summary || summarizeBitRows([]);
    const time = sectionById.get("time")?.summary || summarizeBitRows([]);
    const overallStatus = worstStatus([
        sectionById.get("services")?.summary.status,
        pbit.status,
        runtime.status,
        time.status
    ]);
    const issues = uniqueIssues([
        pbitRow,
        ...sections.flatMap((section) => section.rows)
    ]);

    return Object.freeze({
        status: overallStatus,
        pbit,
        sections: Object.freeze(sections),
        summaries: Object.freeze({
            services: sectionById.get("services")?.summary || summarizeBitRows([]),
            pbit: Object.freeze({ ...summarizeBitRows([pbitRow]), projectReady: pbit.startup?.readiness?.ready === true }),
            runtime,
            time
        }),
        issues: Object.freeze(issues)
    });
}
