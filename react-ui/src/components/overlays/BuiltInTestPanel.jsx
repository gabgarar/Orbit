import { useEffect, useMemo, useRef, useState } from "react";
import PanelCloseButton from "../PanelCloseButton.jsx";
import {
    normalizeDiagnosticStatus
} from "../../../../front/js/features/diagnostics/diagnosticsContract.js";
import { buildBitDashboard } from "../../../../front/js/features/diagnostics/bitDashboardPresentation.js";
import {
    bitAuditFileName,
    bitAuditRows,
    buildBitAuditSnapshot,
    serializeBitAuditCsv
} from "../../../../front/js/features/diagnostics/bitAudit.js";

const statusStyle = Object.freeze({
    healthy: {
        label: "Healthy",
        dot: "bg-[#48d99b]",
        badge: "border-[#247958] bg-[#0e382d] text-[#8aebbb]",
        border: "border-[#2b765a]"
    },
    warning: {
        label: "Aviso",
        dot: "bg-[#f1ba58]",
        badge: "border-[#86612b] bg-[#3d2c14] text-[#ffd184]",
        border: "border-[#82622e]"
    },
    error: {
        label: "Error",
        dot: "bg-[#f17878]",
        badge: "border-[#8d3b42] bg-[#401d25] text-[#ffabb1]",
        border: "border-[#88444d]"
    }
});

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizedKey(value) {
    return text(value).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function readValue(source, aliases) {
    const root = record(source);
    if (!root) return undefined;
    const wanted = new Set(aliases.map(normalizedKey));
    const matchingKey = Object.keys(root).find((key) => wanted.has(normalizedKey(key)));
    return matchingKey ? root[matchingKey] : undefined;
}

function componentValue(component, aliases) {
    return readValue(component?.details, aliases) ?? readValue(component, aliases);
}

function status(value, fallback = "warning") {
    return normalizeDiagnosticStatus(value, fallback);
}

function utcTimestamp(value, unavailable = "No publicado") {
    const raw = text(value);
    if (!raw) return unavailable;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return `${date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })} ${date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}

function rangeText(value, unavailable = "No publicado") {
    if (!value) return unavailable;
    if (typeof value === "string") return value;
    const source = record(value);
    if (!source) return unavailable;
    const start = readValue(source, ["start", "start_time", "startTime", "from", "begin"]);
    const end = readValue(source, ["end", "end_time", "endTime", "to", "stop"]);
    if (!start || !end) return unavailable;
    return `${utcTimestamp(start, text(start))} — ${utcTimestamp(end, text(end))}`;
}

function booleanText(value, unavailable = "No publicado") {
    const nested = record(value);
    if (nested) {
        const published = readValue(nested, [
            "passed", "valid", "validated", "available", "ready", "loaded",
            "ok", "status", "health", "state", "result"
        ]);
        return published === undefined ? unavailable : booleanText(published, unavailable);
    }
    if (value === true) return "Sí";
    if (value === false) return "No";
    const normalized = text(value).toLowerCase();
    if (["true", "yes", "ok", "ready", "loaded", "healthy", "available", "applied"].includes(normalized)) return "Sí";
    if (["false", "no", "missing", "unavailable", "not_loaded", "not loaded"].includes(normalized)) return "No";
    return normalized ? text(value) : unavailable;
}

function sourceLink(value) {
    const source = text(value);
    if (!source) return "No publicado";
    if (!/^https?:\/\//i.test(source)) return source;
    return <a className="break-all text-[#97bbff] underline decoration-[#4e79bb] underline-offset-2 hover:text-white" href={source} target="_blank" rel="noreferrer">{source}</a>;
}

function statusStyleFor(value) {
    return statusStyle[status(value)] || statusStyle.warning;
}

function StatusBadge({ value, label = "" }) {
    const current = status(value);
    const style = statusStyleFor(current);
    return <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] leading-none font-bold ${style.badge}`}><span className={`size-1.5 rounded-full ${style.dot}`} aria-hidden="true" />{label || style.label}</span>;
}

function StatusDot({ value }) {
    const style = statusStyleFor(value);
    return <span className={`mt-0.5 size-2 shrink-0 rounded-full ${style.dot} shadow-[0_0_7px_currentColor]`} aria-hidden="true" />;
}

function RefreshIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.9]"><path d="M20 11a8 8 0 0 0-14.9-3.9L3 9.2M3 4.8v4.4h4.4M4 13a8 8 0 0 0 14.9 3.9l2.1-2.1M21 19.2v-4.4h-4.4" /></svg>;
}

function DownloadIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.9]"><path d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v3h16v-3" /></svg>;
}

function Chevron() {
    return <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 shrink-0 fill-none stroke-current transition-transform duration-150 group-open:rotate-90 [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]"><path d="m6 3 5 5-5 5" /></svg>;
}

const BIT_TABS = Object.freeze([
    Object.freeze({ id: "overview", label: "Resumen" }),
    Object.freeze({ id: "services", label: "Servicios" }),
    Object.freeze({ id: "validation", label: "Validación" }),
    Object.freeze({ id: "audit", label: "Auditoría" })
]);

function auditStatusPresentation(value) {
    const normalized = text(value).toLowerCase();
    if (normalized === "completed") return { status: "healthy", label: "Completada" };
    if (normalized === "failed") return { status: "error", label: "Error" };
    if (normalized === "cancelled") return { status: "warning", label: "Cancelada" };
    if (normalized === "running") return { status: "warning", label: "En curso" };
    return { status: status(normalized), label: statusStyleFor(normalized).label };
}

function sectionTab(sectionId) {
    if (sectionId === "services") return "services";
    if (["startup", "time", "runtime", "scene"].includes(sectionId)) return "validation";
    return "overview";
}

function downloadAuditSnapshot(snapshot, format) {
    if (typeof document === "undefined" || typeof Blob === "undefined" || !globalThis.URL?.createObjectURL) return false;
    const normalizedFormat = format === "csv" ? "csv" : "json";
    const content = normalizedFormat === "csv"
        ? serializeBitAuditCsv(snapshot)
        : `${JSON.stringify(snapshot, null, 2)}\n`;
    const blob = new Blob([content], { type: normalizedFormat === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8" });
    const url = globalThis.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = bitAuditFileName(normalizedFormat, snapshot.exportedAt);
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => globalThis.URL.revokeObjectURL(url), 0);
    return true;
}

function DetailField({ label, value }) {
    return <div className="grid grid-cols-[minmax(116px,.86fr)_minmax(0,1.4fr)] gap-x-3 border-t border-[#203650] py-1.5 first:border-t-0 first:pt-0">
        <dt className="text-[10px] leading-snug text-[#91a4c0]">{label}</dt>
        <dd className="m-0 min-w-0 break-words text-right text-[10px] leading-snug font-medium text-[#d9e5f6]">{value}</dd>
    </div>;
}

function DetailList({ items }) {
    const visible = items.filter((item) => item?.[0] && item?.[1] !== undefined && item?.[1] !== null && item?.[1] !== "");
    if (!visible.length) return <p className="m-0 text-[10px] leading-snug text-[#97abc7]">No hay más datos publicados para esta comprobación.</p>;
    return <dl className="m-0">{visible.map(([label, value]) => <DetailField key={label} label={label} value={value} />)}</dl>;
}

function gravityValue(component, modelName) {
    const models = componentValue(component, ["models", "gravity_models", "gravityModels", "registry"]);
    const model = Array.isArray(models)
        ? models.find((candidate) => normalizedKey(readValue(candidate, ["id", "name", "model"])) === normalizedKey(modelName))
        : record(models)?.[modelName];
    if (!model) return "No publicado";
    const modelStatus = text(readValue(model, ["status", "health", "state"])) || "sin estado";
    const degree = readValue(model, ["max_degree", "maxDegree"]);
    const order = readValue(model, ["max_order", "maxOrder"]);
    return `${modelStatus}${degree !== undefined || order !== undefined ? ` · máx. ${degree ?? "?"} × ${order ?? "?"}` : ""}`;
}

function componentDetails(row, local) {
    const component = row.component;
    const items = [
        ["Estado publicado", <StatusBadge value={row.status} key="status" />],
        ["Última validación", utcTimestamp(component?.lastValidatedAt, component ? "No publicado" : "Pendiente")]
    ];
    if (!component) {
        items.push(["Información", row.message]);
        return items;
    }

    if (row.id === "erp") {
        const selection = componentValue(component, ["selection"]);
        const current = record(readValue(selection, ["current"]));
        items.push(
            ["Fuente activa", sourceLink(readValue(current, ["source"]) || componentValue(component, ["source", "source_url", "sourceUrl"]))],
            ["Calidad actual", text(readValue(current, ["qualityLabel", "quality_label", "quality"])) || "No publicada"],
            ["Cobertura", rangeText(componentValue(component, ["coverage", "coverage_range", "coverageRange"]))],
            ["Caché vigente", booleanText(componentValue(component, ["cacheFresh", "cache_fresh"]))],
            ["Renovación pendiente", booleanText(componentValue(component, ["refreshDue", "refresh_due"]))]
        );
    } else if (row.id === "frames") {
        items.push(
            ["Ruta", componentValue(component, ["route", "eci_route", "eciRoute", "frame_route", "frameRoute"]) || "No publicada"],
            ["Calidad EOP", componentValue(component, ["eopQuality", "eop_quality"]) || "No publicada"]
        );
    } else if (row.id === "mtr") {
        items.push(
            ["Rango activo", rangeText(local?.mtr?.range, "Sin MTR establecido")],
            ["Ajuste de timeline", local?.mtr?.active ? (local.mtr.timelineClamped ? "Activo" : "Fuera de rango: requiere revisión") : "No aplica"]
        );
    } else if (row.id === "gravity") {
        items.push(
            ["Modelo activo", componentValue(component, ["active_model", "activeModel", "model"]) || "No publicado"],
            ["EGM96", gravityValue(component, "EGM96")],
            ["EGM2008", gravityValue(component, "EGM2008")]
        );
    } else if (row.id === "propagators") {
        items.push(
            ["Conservación de energía", booleanText(componentValue(component, ["energy_conservation", "energyConservation", "energy_ok", "energyOk"]))],
            ["Estabilidad RK4", booleanText(componentValue(component, ["stability", "stability_test", "stabilityTest", "stable"]))]
        );
    } else if (row.id === "forces") {
        const fullGeopotential = record(componentValue(component, ["fullGeopotential", "full_geopotential"]));
        const drag = record(componentValue(component, ["drag"]));
        const srp = record(componentValue(component, ["solarRadiationPressure", "solar_radiation_pressure"]));
        items.push(
            ["Geopotencial completo", booleanText(readValue(fullGeopotential, ["available", "ready"]))],
            ["Arrastre atmosférico", booleanText(readValue(drag, ["available", "ready"]))],
            ["Presión solar", booleanText(readValue(srp, ["available", "ready"]))]
        );
    } else if (row.id === "sp3") {
        items.push(
            ["SP3 activos", String(local?.sp3?.activeCount ?? 0)],
            ["Cobertura local", rangeText(local?.sp3?.coverage, "No hay cobertura SP3 activa")],
            ["ERP aplicado", booleanText(local?.sp3?.usingEop)]
        );
    } else if (row.id === "oem") {
        items.push(
            ["OEM activos", String(local?.oem?.activeCount ?? 0)],
            ["Cobertura local", rangeText(local?.oem?.coverage, "No hay cobertura OEM activa")]
        );
    } else if (row.id === "monitor") {
        items.push(["Monitor activo", booleanText(componentValue(component, ["running", "active", "available"]))]);
    }
    items.push(["Mensaje", row.message]);
    return items;
}

function serviceDetails(row, checkedAt) {
    const health = row.health;
    return [
        ["Estado", <StatusBadge value={row.status} key="status" />],
        ["Última comprobación", utcTimestamp(checkedAt, "Pendiente")],
        ...(health?.endpoint ? [["Endpoint", <code className="text-[#a9c8ff]" key="endpoint">{health.endpoint}</code>]] : []),
        ...(health?.error ? [["Detalle", health.error]] : []),
        ["Información", row.message]
    ];
}

function BitStatusRow({ row, local, checkedAt }) {
    return <details className="group min-w-0 rounded-[7px] border border-[#243f60] bg-[#09172a]/80 transition-colors open:border-[#3a5f8e] open:bg-[#0b1c31]">
        <summary className="flex list-none cursor-pointer items-center gap-2 px-2.5 py-2 text-left [&::-webkit-details-marker]:hidden">
            <StatusDot value={row.status} />
            <span className="min-w-0 flex-1"><strong className="block truncate text-[11px] leading-tight font-semibold text-[#e0ebfa]">{row.label}</strong><span className="mt-0.5 block truncate text-[9px] leading-tight text-[#93a9c6]">{row.message}</span></span>
            <StatusBadge value={row.status} />
            <span className="text-[#88a6d4]"><Chevron /></span>
        </summary>
        <div className="border-t border-[#213b59] px-2.5 py-2.5">
            <DetailList items={row.kind === "service" ? serviceDetails(row, checkedAt) : componentDetails(row, local)} />
        </div>
    </details>;
}

function summaryCopy(summary) {
    if (!summary?.total) return "Pendiente de publicación";
    if (summary.error) return `${summary.error} error${summary.error === 1 ? "" : "es"}`;
    if (summary.warning) return `${summary.healthy}/${summary.total} healthy · ${summary.warning} aviso${summary.warning === 1 ? "" : "s"}`;
    return `${summary.healthy}/${summary.total} healthy`;
}

function OverviewMetric({ label, value, summary }) {
    return <div className="min-w-0 border-l border-[#284664] px-2.5 first:border-l-0 first:pl-0">
        <div className="flex items-center gap-1.5"><StatusDot value={summary?.status} /><span className="truncate text-[9px] font-bold tracking-[.1em] text-[#86a6d6] uppercase">{label}</span></div>
        <strong className="mt-1 block truncate text-[11px] leading-tight font-semibold text-[#e8f1fd]">{value}</strong>
        {summary && <span className="mt-0.5 block truncate text-[9px] leading-tight text-[#8ea5c4]">{summaryCopy(summary)}</span>}
    </div>;
}

function PbitSection({ pbit }) {
    const startup = pbit.startup;
    const steps = Array.isArray(startup?.steps) ? startup.steps : [];
    const readiness = startup?.readiness;
    const terminalSteps = steps.filter((step) => !["pending", "running", "queued", "loading"].includes(text(step?.status).toLowerCase()));
    const isProjectReady = readiness?.ready === true;
    const open = pbit.status !== "healthy";
    return <section id="bit-section-startup" className={`overflow-hidden rounded-[9px] border bg-[linear-gradient(145deg,rgba(14,31,53,.96),rgba(8,19,34,.96))] ${statusStyleFor(pbit.status).border}`} aria-labelledby="bit-pbit-heading">
        <div className="flex min-w-0 items-start justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0"><span className="block text-[9px] font-bold tracking-[.14em] text-[#7ea2e4]">ARRANQUE</span><h3 id="bit-pbit-heading" className="mt-1 mb-0 text-[13px] leading-tight font-semibold text-[#edf4ff]">PBIT de inicio</h3><p className="mt-1 mb-0 text-[10px] leading-snug text-[#9db1cd]">{pbit.message}</p></div>
            <div className="flex shrink-0 flex-col items-end gap-1"><StatusBadge value={pbit.status} label={pbit.result} /><span className={`text-[9px] font-semibold ${isProjectReady ? "text-[#8aebbb]" : "text-[#ffd184]"}`}>{isProjectReady ? "Proyecto habilitado" : "Proyecto bloqueado"}</span></div>
        </div>
        <div className="grid grid-cols-3 border-y border-[#233e5d] bg-[#08172a]/75 px-3 py-2 text-[9px] text-[#90a8c7]">
            <span>Pasos <strong className="ml-1 text-[#e0ebf9]">{terminalSteps.length}/{steps.length || "—"}</strong></span>
            <span className="text-center">Avisos <strong className="ml-1 text-[#f2c66d]">{startup?.warnings?.length || 0}</strong></span>
            <span className="text-right">Errores <strong className="ml-1 text-[#ff9aa3]">{startup?.errors?.length || 0}</strong></span>
        </div>
        {steps.length > 0 && <details className="group" open={open}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[10px] font-semibold text-[#b7cdf0] [&::-webkit-details-marker]:hidden"><span>Ver pasos y mensajes del PBIT</span><Chevron /></summary>
            <ol className="m-0 list-none border-t border-[#203956] px-3 py-1.5">
                {steps.map((step) => <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 border-b border-[#1e3651] py-1.5 last:border-b-0" key={`${step.id}-${step.timestamp || "current"}`}><StatusDot value={step.status} /><span className="min-w-0"><strong className="block text-[10px] leading-snug font-semibold text-[#dce9fa]">{step.label}</strong>{step.message && <small className="mt-0.5 block text-[9px] leading-snug text-[#94a9c7]">{step.message}</small>}</span><StatusBadge value={step.status} /></li>)}
            </ol>
        </details>}
    </section>;
}

function BitSection({ section, local, checkedAt }) {
    const hasAttention = section.summary.status !== "healthy";
    return <section id={`bit-section-${section.id}`} className={`overflow-hidden rounded-[9px] border bg-[linear-gradient(145deg,rgba(12,28,49,.94),rgba(7,18,32,.96))] ${hasAttention ? statusStyleFor(section.summary.status).border : "border-[#294766]"}`} aria-labelledby={`bit-${section.id}-heading`}>
        <header className="flex min-w-0 items-start justify-between gap-3 border-b border-[#203a58] px-3 py-2.5">
            <div className="min-w-0"><h3 id={`bit-${section.id}-heading`} className="m-0 text-[12px] leading-tight font-semibold text-[#e7effb]">{section.title}</h3><p className="mt-1 mb-0 text-[9px] leading-snug text-[#91a7c5]">{section.description}</p></div>
            <div className="shrink-0 text-right"><StatusBadge value={section.summary.status} /><span className="mt-1 block text-[9px] leading-none text-[#8da4c2]">{summaryCopy(section.summary)}</span></div>
        </header>
        <div className="grid gap-1.5 p-2.5 sm:grid-cols-2">{section.rows.map((row) => <BitStatusRow row={row} local={local} checkedAt={checkedAt} key={row.id} />)}</div>
    </section>;
}

function AttentionSummary({ issues, onNavigate = null }) {
    const visible = issues.slice(0, 3);
    if (!visible.length) return null;
    return <aside className="rounded-[8px] border border-[#86612b] bg-[linear-gradient(100deg,rgba(67,47,20,.72),rgba(37,30,25,.62))] px-3 py-2.5" role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-2"><strong className="text-[10px] font-semibold text-[#ffe0a3]">{issues.length} condición{issues.length === 1 ? "" : "es"} requiere{issues.length === 1 ? "" : "n"} revisión</strong><span className="text-[9px] text-[#e4bd70]">BIT operativo</span></div>
        <ul className="mt-1.5 mb-0 grid list-none gap-1 p-0">{visible.map((issue) => <li key={`${issue.sectionId}-${issue.id}`} className="min-w-0 text-[9px] leading-snug text-[#dec79a]"><button className="cursor-pointer border-0 bg-transparent p-0 text-left text-[#ffe0a3] underline decoration-[#a67d38] underline-offset-2 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffe39a]" type="button" onClick={() => onNavigate?.(sectionTab(issue.sectionId))}>{issue.label}</button><span> · {issue.message}</span></li>)}</ul>
        {issues.length > visible.length && <p className="mt-1.5 mb-0 text-[9px] text-[#cfb580]">Y {issues.length - visible.length} condición{issues.length - visible.length === 1 ? "" : "es"} más en las secciones.</p>}
    </aside>;
}

function AuditTab({ audit, exportFeedback, onExport }) {
    const rows = bitAuditRows(audit);
    const propagationCount = Array.isArray(audit?.propagationHistory) ? audit.propagationHistory.length : 0;
    const pbit = audit?.pbit || {};
    return <section className="grid min-h-0 gap-3" aria-label="Auditoría operativa de Orbit" data-testid="bit-audit-tab">
        <section className="rounded-[8px] border border-[#294866] bg-[linear-gradient(145deg,rgba(13,29,50,.96),rgba(8,18,33,.96))] px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <span className="block text-[10px] font-bold tracking-[.11em] text-[#86a6d6] uppercase">Registro operativo</span>
                    <h3 className="mt-1 mb-0 text-[13px] leading-tight font-semibold text-[#edf4ff]">Auditoría del PBIT y las propagaciones</h3>
                    <p className="mt-1 mb-0 max-w-[680px] text-[11px] leading-snug text-[#9aafcc]">El registro del proyecto conserva solicitudes y resultados resumidos; no incluye muestras, ficheros fuente ni respuestas crudas.</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1.5">
                    <button className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[6px] border border-[#36577f] bg-[#102039] px-2.5 text-[10px] font-semibold text-[#cfe0f8] transition-colors hover:border-[#628bd0] hover:bg-[#173054] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7198ff]" type="button" onClick={() => onExport("csv")}><DownloadIcon />CSV</button>
                    <button className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[6px] border border-[#36577f] bg-[#102039] px-2.5 text-[10px] font-semibold text-[#cfe0f8] transition-colors hover:border-[#628bd0] hover:bg-[#173054] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7198ff]" type="button" onClick={() => onExport("json")}><DownloadIcon />JSON</button>
                </div>
            </div>
            <div className="mt-3 grid grid-cols-2 divide-x divide-[#284663] rounded-[6px] border border-[#294866] bg-[#09182b] sm:grid-cols-4" aria-label="Resumen de auditoría">
                <OverviewMetric label="PBIT" value={pbit.result || "Pendiente"} summary={{ status: pbit.status || "warning", total: 1, healthy: pbit.status === "healthy" ? 1 : 0, warning: pbit.status === "warning" ? 1 : 0, error: pbit.status === "error" ? 1 : 0 }} />
                <OverviewMetric label="Propagaciones" value={String(propagationCount)} summary={{ status: propagationCount ? "healthy" : "warning", total: propagationCount || 1, healthy: propagationCount, warning: propagationCount ? 0 : 1, error: 0 }} />
                <OverviewMetric label="Retención" value="200 últimas" summary={{ status: "healthy", total: 1, healthy: 1, warning: 0, error: 0 }} />
                <OverviewMetric label="Exportación" value="Local" summary={{ status: "healthy", total: 1, healthy: 1, warning: 0, error: 0 }} />
            </div>
            {exportFeedback && <p className={`mt-2 mb-0 rounded-[6px] border px-2.5 py-2 text-[10px] leading-snug ${exportFeedback.startsWith("No se") ? "border-[#87464f] bg-[#401f27] text-[#ffc3cb]" : "border-[#315c89] bg-[#10233d] text-[#c6dcff]"}`} role="status">{exportFeedback}</p>}
        </section>

        <section className="min-h-0 overflow-hidden rounded-[8px] border border-[#294866] bg-[rgba(8,21,38,.82)]" aria-labelledby="bit-audit-table-title">
            <header className="flex items-center justify-between gap-3 border-b border-[#243e5d] px-3 py-2.5">
                <div className="min-w-0"><h3 id="bit-audit-table-title" className="m-0 text-[12px] font-semibold text-[#e7effb]">Eventos auditables</h3><p className="mt-0.5 mb-0 text-[10px] leading-snug text-[#91a7c5]">{rows.length} registros disponibles. Las propagaciones pertenecen al proyecto abierto.</p></div>
                <StatusBadge value={pbit.status || "warning"} label={pbit.result || "PBIT"} />
            </header>
            <div className="orbit-scrollbar max-h-[min(46dvh,470px)] overflow-auto [scrollbar-color:#426589_transparent] [scrollbar-width:thin]">
                <table className="min-w-[690px] w-full border-collapse text-left text-[10px]" aria-label="Tabla de auditoría BIT">
                    <thead className="sticky top-0 z-10 border-b border-[#2b4869] bg-[#0d1d33] text-[9px] font-bold tracking-[.06em] text-[#86a4ca] uppercase">
                        <tr><th className="w-[110px] px-3 py-2">Tipo</th><th className="w-[108px] px-3 py-2">Estado</th><th className="px-3 py-2">Evento</th><th className="w-[168px] px-3 py-2">UTC</th></tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => {
                            const presentation = auditStatusPresentation(row.status);
                            return <tr className="border-b border-[#1d354f] align-top last:border-b-0 hover:bg-[#10213a]/70" key={row.id}>
                                <td className="px-3 py-2.5 text-[9px] font-bold tracking-[.05em] text-[#89a6cd]">{row.kind}</td>
                                <td className="px-3 py-2.5"><StatusBadge value={presentation.status} label={presentation.label} /></td>
                                <td className="min-w-0 px-3 py-2.5"><strong className="block truncate text-[11px] font-semibold text-[#dce9fa]" title={row.title}>{row.title}</strong><span className="mt-0.5 block text-[10px] leading-snug text-[#94a9c7]">{row.detail}</span>{row.kind === "PROPAGACIÓN" && <span className="mt-1 block text-[9px] text-[#7792b5]">{[row.source, row.propagator, row.sampling !== "" ? `Paso ${row.sampling} s` : "", row.sampleCount !== "" ? `${row.sampleCount} muestras` : ""].filter(Boolean).join(" · ") || "Metadatos no publicados"}</span>}</td>
                                <td className="px-3 py-2.5 text-[9px] leading-snug text-[#9eb4d1]" title={row.timestamp || ""}>{utcTimestamp(row.timestamp, "No publicado")}</td>
                            </tr>;
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    </section>;
}

/**
 * Read-only, sectioned operational dashboard. It keeps PBIT, liveness,
 * time-data quality and runtime probes distinct so a time warning does not
 * make a healthy service look unavailable.
 */
export default function BuiltInTestPanel({ onClose, diagnosticsState = null, propagationHistory = [] }) {
    const panelRef = useRef(null);
    const priorFocusRef = useRef(null);
    const [activeTab, setActiveTab] = useState("overview");
    const [exportFeedback, setExportFeedback] = useState("");
    const {
        availability = "loading",
        endpoint = "",
        diagnostics = null,
        runtimeHealth = null,
        local = null,
        checkedAt = "",
        error = "",
        refreshing = false,
        refresh = null
    } = diagnosticsState || {};
    const dashboard = useMemo(() => buildBitDashboard({ availability, diagnostics, local, runtimeHealth }), [availability, diagnostics, local, runtimeHealth]);
    const audit = useMemo(() => buildBitAuditSnapshot({
        dashboard,
        availability,
        endpoint,
        checkedAt,
        propagationHistory
    }), [availability, checkedAt, dashboard, endpoint, propagationHistory]);
    const sectionById = useMemo(() => new Map(dashboard.sections.map((section) => [section.id, section])), [dashboard.sections]);
    const auditCount = Array.isArray(propagationHistory) ? propagationHistory.length : 0;

    useEffect(() => {
        priorFocusRef.current = document.activeElement;
        const closeOnEscape = (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onClose();
        };
        document.addEventListener("keydown", closeOnEscape);
        window.requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
        return () => {
            document.removeEventListener("keydown", closeOnEscape);
            priorFocusRef.current?.focus?.({ preventScroll: true });
        };
    }, [onClose]);

    const diagnosticsUnavailable = availability !== "available";
    const exportAudit = (format) => {
        const downloaded = downloadAuditSnapshot(audit, format);
        setExportFeedback(downloaded
            ? `Se exportó la auditoría BIT en ${format.toUpperCase()}.`
            : "No se pudo exportar la auditoría desde este navegador.");
    };
    const activateTab = (tab) => {
        setExportFeedback("");
        setActiveTab(BIT_TABS.some((candidate) => candidate.id === tab) ? tab : "overview");
    };
    return <section className="fixed inset-0 z-[10520] flex items-start justify-end bg-[#020811]/[.7] p-[clamp(10px,1.7vw,28px)] pt-[calc(max(64px,calc(76px*var(--orbit-ui-scale)))+12px)] backdrop-blur-[3px]" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <article ref={panelRef} tabIndex="-1" className="grid max-h-full w-[min(920px,100%)] min-h-0 overflow-hidden rounded-[14px] border border-[#36557c] bg-[#0b1526] font-[var(--orbit-font-sans)] text-[#dbe7fa] shadow-[0_28px_80px_rgba(0,0,0,.62)] outline-none [grid-template-rows:auto_auto_minmax(0,1fr)]" role="dialog" aria-modal="true" aria-labelledby="builtInTestTitle" aria-describedby="builtInTestDescription">
            <header className="flex min-h-[58px] items-center justify-between gap-3 border-b border-[#294667] bg-[linear-gradient(105deg,rgba(14,30,52,.98),rgba(8,18,33,.98))] px-[clamp(12px,1.4vw,20px)] py-2.5">
                <div className="min-w-0"><span className="block text-[10px] leading-none font-bold tracking-[.14em] text-[#7298dc]">ORBIT · ESTADO DEL SISTEMA</span><div className="mt-1 flex min-w-0 items-center gap-2"><h2 id="builtInTestTitle" className="m-0 truncate text-[16px] leading-none font-semibold text-[#edf4ff]">BIT continuo</h2><StatusBadge value={dashboard.status} /></div><p id="builtInTestDescription" className="mt-1 mb-0 text-[11px] leading-snug text-[#a1b2cb]">Monitor operativo de servicios, inicio, tiempo y validaciones.</p></div>
                <div className="flex shrink-0 items-center gap-1"><button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[7px] border border-[#36577f] bg-[#102039] px-2.5 text-[10px] leading-none font-semibold text-[#cfe0f8] transition-colors hover:border-[#628bd0] hover:bg-[#173054] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7198ff] disabled:cursor-wait disabled:opacity-60" type="button" onClick={() => typeof refresh === "function" && void refresh({ forceRuntimeHealth: true })} disabled={refreshing || typeof refresh !== "function"} aria-label="Actualizar diagnóstico"><RefreshIcon />{refreshing ? "Actualizando…" : "Actualizar"}</button><PanelCloseButton label="Cerrar Built-In Test" onClick={onClose} /></div>
            </header>
            <nav className="flex overflow-x-auto border-b border-[#294667] bg-[#09182b] px-[clamp(12px,1.4vw,20px)]" aria-label="Secciones del BIT" role="tablist">
                {BIT_TABS.map((tab) => {
                    const selected = activeTab === tab.id;
                    const count = tab.id === "audit" ? auditCount : null;
                    return <button className={`relative inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-3 text-[11px] font-semibold transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#7198ff] ${selected ? "text-[#edf4ff]" : "text-[#91a7c5] hover:text-[#d9e7fb]"}`} type="button" role="tab" id={`bit-tab-${tab.id}`} aria-selected={selected} aria-controls={`bit-panel-${tab.id}`} key={tab.id} onClick={() => activateTab(tab.id)}>{tab.label}{count !== null && <span className={`rounded-full border px-1.5 py-0.5 text-[9px] leading-none ${selected ? "border-[#537ee5] bg-[#213c71] text-[#d6e6ff]" : "border-[#36516f] bg-[#102039] text-[#9ab5d8]"}`}>{count}</span>}<span className={`absolute right-2 bottom-0 left-2 h-0.5 rounded-full transition-opacity ${selected ? "bg-[#6e94ff] opacity-100 shadow-[0_0_8px_rgba(94,132,255,.85)]" : "opacity-0"}`} aria-hidden="true" /></button>;
                })}
            </nav>
            <div className="orbit-scrollbar min-h-0 overflow-y-auto px-[clamp(12px,1.4vw,20px)] py-3 [scrollbar-color:#426589_transparent] [scrollbar-width:thin]">
                <p className="mt-0 mb-3 text-[10px] leading-snug text-[#8da4c3]">Actualizado: <strong className="font-semibold text-[#cfe0f8]">{utcTimestamp(checkedAt, "Pendiente")}</strong>{availability === "available" && endpoint ? <> · Diagnóstico: <code className="text-[#a9c8ff]">{endpoint}</code></> : null}</p>
                {diagnosticsUnavailable && <aside className="mb-3 rounded-[8px] border border-[#85642d] bg-[rgba(86,57,18,.42)] px-3 py-2.5 text-[11px] leading-snug text-[#ffdaa1]" role="status"><strong className="font-semibold">Diagnóstico remoto no disponible.</strong> {error || "Se muestran solo las comprobaciones locales que Orbit conserva."}</aside>}
                {activeTab === "overview" && <div id="bit-panel-overview" role="tabpanel" aria-labelledby="bit-tab-overview" className="grid gap-3">
                    <section className="grid grid-cols-2 rounded-[8px] border border-[#294866] bg-[#0a192c] px-3 py-2.5 sm:grid-cols-4" aria-label="Resumen de salud operativo"><OverviewMetric label="Servicios" value={summaryCopy(dashboard.summaries.services)} summary={dashboard.summaries.services} /><OverviewMetric label="PBIT" value={dashboard.pbit.result} summary={dashboard.summaries.pbit} /><OverviewMetric label="Runtime" value={summaryCopy(dashboard.summaries.runtime)} summary={dashboard.summaries.runtime} /><OverviewMetric label="Tiempo" value={summaryCopy(dashboard.summaries.time)} summary={dashboard.summaries.time} /></section>
                    <AttentionSummary issues={dashboard.issues} onNavigate={activateTab} />
                    <section className="rounded-[8px] border border-[#294866] bg-[linear-gradient(145deg,rgba(12,28,49,.94),rgba(7,18,32,.96))] px-3 py-3" aria-labelledby="bit-overview-title"><h3 id="bit-overview-title" className="m-0 text-[13px] font-semibold text-[#e7effb]">Estado operacional</h3><p className="mt-1 mb-0 text-[11px] leading-snug text-[#9aafcc]">El estado global resume solo las comprobaciones visibles y operativas. Los avisos de tiempo o de una fuente de escena no se confunden con la disponibilidad del gateway.</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-[6px] border border-[#233f5f] bg-[#09182b] px-2.5 py-2"><span className="text-[9px] font-bold tracking-[.08em] text-[#86a6d6] uppercase">Readiness de proyecto</span><strong className={`mt-1 block text-[11px] ${dashboard.summaries.pbit.projectReady ? "text-[#8aebbb]" : "text-[#ffd184]"}`}>{dashboard.summaries.pbit.projectReady ? "Proyecto habilitado por el PBIT" : "Proyecto pendiente o bloqueado por el PBIT"}</strong></div><div className="rounded-[6px] border border-[#233f5f] bg-[#09182b] px-2.5 py-2"><span className="text-[9px] font-bold tracking-[.08em] text-[#86a6d6] uppercase">Uso recomendado</span><strong className="mt-1 block text-[11px] text-[#cfe0f8]">Revisa Servicios antes de reiniciar; revisa Validación para datos y tiempo.</strong></div></div></section>
                </div>}
                {activeTab === "services" && <div id="bit-panel-services" role="tabpanel" aria-labelledby="bit-tab-services" className="grid gap-3">{sectionById.get("services") ? <BitSection section={sectionById.get("services")} local={local} checkedAt={checkedAt} /> : <section className="rounded-[8px] border border-[#294866] bg-[#0b1a2d] px-3 py-3 text-[11px] leading-snug text-[#9aafcc]" role="status">Esperando la primera comprobación de servicios.</section>}</div>}
                {activeTab === "validation" && <div id="bit-panel-validation" role="tabpanel" aria-labelledby="bit-tab-validation" className="grid gap-3"><PbitSection pbit={dashboard.pbit} />{dashboard.sections.filter((section) => section.id !== "services").map((section) => <BitSection key={section.id} section={section} local={local} checkedAt={checkedAt} />)}</div>}
                {activeTab === "audit" && <div id="bit-panel-audit" role="tabpanel" aria-labelledby="bit-tab-audit"><AuditTab audit={audit} exportFeedback={exportFeedback} onExport={exportAudit} /></div>}
            </div>
        </article>
    </section>;
}
