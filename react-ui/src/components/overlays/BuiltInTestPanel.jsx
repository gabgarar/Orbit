import { useEffect, useMemo, useRef } from "react";
import PanelCloseButton from "../PanelCloseButton.jsx";
import {
    findDiagnosticComponent,
    normalizeDiagnosticStatus
} from "../../../../front/js/features/diagnostics/diagnosticsContract.js";
import { startupStatusFromDiagnosticComponent } from "../../../../front/js/features/diagnostics/startupStatus.js";
import {
    continuousBitStatus,
    initialBitSummary,
    visibleBitComponents
} from "../../../../front/js/features/diagnostics/bitPresentation.js";

const statusStyle = {
    healthy: {
        label: "Healthy",
        dot: "bg-[#48d99b]",
        badge: "border-[#247958] bg-[#0e382d] text-[#8aebbb]"
    },
    warning: {
        label: "Warning",
        dot: "bg-[#f1ba58]",
        badge: "border-[#86612b] bg-[#3d2c14] text-[#ffd184]"
    },
    error: {
        label: "Error",
        dot: "bg-[#f17878]",
        badge: "border-[#8d3b42] bg-[#401d25] text-[#ffabb1]"
    }
};

function text(value) {
    if (value === undefined || value === null) return "";
    return String(value).trim();
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

function nestedValue(component, containerAliases, aliases) {
    const container = componentValue(component, containerAliases);
    return readValue(container, aliases);
}

function displayBoolean(value, unavailable = "No publicado") {
    const nested = record(value);
    if (nested?.status !== undefined) return displayBoolean(nested.status, unavailable);
    if (value === true) return "Sí";
    if (value === false) return "No";
    const normalized = text(value).toLowerCase();
    if (["true", "yes", "ok", "ready", "loaded", "healthy", "applied", "available"].includes(normalized)) return "Sí";
    if (["false", "no", "missing", "unavailable", "not_loaded", "not loaded"].includes(normalized)) return "No";
    return normalized ? text(value) : unavailable;
}

function list(value) {
    if (Array.isArray(value)) return value;
    const source = record(value);
    return source ? Object.values(source) : [];
}

function gravityModelRecord(models, name) {
    const normalizedName = normalizedKey(name);
    if (Array.isArray(models)) {
        return models.find((candidate) => normalizedKey(readValue(candidate, ["id", "name", "model", "key", "model_name", "modelName"])) === normalizedName) || null;
    }
    const source = record(models);
    if (!source) return null;
    const matchingKey = Object.keys(source).find((key) => normalizedKey(key) === normalizedName);
    return matchingKey ? record(source[matchingKey]) : null;
}

function gravityModelState(model) {
    if (!model) return "No publicado";
    const explicit = text(readValue(model, ["status", "health", "state", "result"])).toLowerCase();
    const valid = readValue(model, ["valid", "validated", "is_valid", "isValid"]);
    const loaded = readValue(model, ["loaded", "available", "ready", "present"]);
    if (["invalid", "error", "failed", "failure"].includes(explicit) || valid === false) return "Inválido";
    if (["missing", "unavailable", "not_loaded", "not loaded"].includes(explicit) || loaded === false) return "No disponible";
    if (["loaded", "ready", "healthy", "ok", "valid", "available"].includes(explicit) || loaded === true || valid === true) return "Cargado";
    return explicit ? text(readValue(model, ["status", "health", "state", "result"])) : "Publicado sin estado";
}

function gravityModelLimit(model) {
    if (!model) return "Límites no publicados";
    const degree = readValue(model, ["max_degree", "maxDegree", "degree_max", "degreeMax"]);
    const order = readValue(model, ["max_order", "maxOrder", "order_max", "orderMax"]);
    if (degree === undefined && order === undefined) return "Límites no publicados";
    return `máx. ${degree ?? "?"} × ${order ?? "?"}`;
}

function gravityModelPresentation(models, name) {
    const model = gravityModelRecord(models, name);
    return <span className="inline-grid gap-0.5"><span>{gravityModelState(model)}</span><small className="text-[9px] font-normal text-[#8fa6c6]">{gravityModelLimit(model)}</small></span>;
}

function activeGravityModel(value) {
    const source = record(value);
    if (source) return text(readValue(source, ["id", "name", "model", "key", "model_name", "modelName"])) || "Publicado sin identificador";
    return text(value) || "No publicado";
}

function startupStepCount(value) {
    const steps = list(value);
    if (!steps.length) return "No publicado";
    const complete = steps.filter((step) => {
        const status = text(readValue(step, ["status", "health", "state", "result"])).toLowerCase();
        return ["healthy", "ok", "ready", "passed", "success", "warning", "error", "failed"].includes(status);
    }).length;
    return `${complete}/${steps.length} con estado publicado`;
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
    const start = readValue(source, ["start", "start_time", "startTime", "from", "begin", "startDate"]);
    const end = readValue(source, ["end", "end_time", "endTime", "to", "stop", "endDate"]);
    if (!start || !end) return unavailable;
    return `${utcTimestamp(start, text(start))} — ${utcTimestamp(end, text(end))}`;
}

function formatSource(value) {
    const source = text(value);
    if (!source) return "No publicado";
    if (!/^https?:\/\//i.test(source)) return source;
    return <a className="break-all text-[#97bbff] underline decoration-[#4e79bb] underline-offset-2 hover:text-white" href={source} target="_blank" rel="noreferrer">{source}</a>;
}

function worstStatus(...values) {
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

function publishedNestedStatus(id, component) {
    if (!component) return "";
    if (id === "gravity") {
        const models = componentValue(component, ["models", "gravity_models", "gravityModels", "registry", "model_registry", "modelRegistry"]);
        const states = ["EGM96", "EGM2008"].map((name) => gravityModelState(gravityModelRecord(models, name)));
        if (states.includes("Inválido")) return "error";
        if (states.includes("No disponible")) return "warning";
    }
    if (id === "startup") {
        const startup = startupStatusFromDiagnosticComponent(component);
        if (startup?.errors?.length) return "error";
        if (startup?.warnings?.length) return "warning";
    }
    return "";
}

function localSp3EopLabel(sp3) {
    if (!sp3 || sp3.activeCount === 0) return "No hay SP3 activo en la escena";
    if (sp3.usingEop === true) return "Sí (metadatos locales del producto)";
    if (sp3.usingEop === false) return "No confirmado por los metadatos locales";
    return "No declarado por los metadatos locales";
}

function LocalFields({ id, local }) {
    if (id === "sp3" && local?.sp3) {
        return <>
            <DiagnosticField label="SP3 activos en escena" value={String(local.sp3.activeCount ?? 0)} />
            <DiagnosticField label="Cobertura SP3 local" value={rangeText(local.sp3.coverage, "No hay cobertura SP3 activa")} />
            <DiagnosticField label="EOP usado (escena)" value={localSp3EopLabel(local.sp3)} />
        </>;
    }
    if (id === "oem" && local?.oem) {
        return <>
            <DiagnosticField label="OEM activos en escena" value={String(local.oem.activeCount ?? 0)} />
            <DiagnosticField label="Cobertura OEM local" value={rangeText(local.oem.coverage, "No hay cobertura OEM activa")} />
        </>;
    }
    if (id === "mtr" && local?.mtr) {
        return <>
            <DiagnosticField label="Rango MTR actual" value={rangeText(local.mtr.range, "Sin MTR establecido")} />
            <DiagnosticField label="Timeline clamp" value={local.mtr.active ? (local.mtr.timelineClamped ? "Activo: epoch dentro del MTR" : "Fuera de rango: requiere revisión") : "No aplica: no hay efeméride finita activa"} />
        </>;
    }
    return null;
}

function RemoteFields({ id, component }) {
    if (!component) return null;
    if (id === "startup") {
        const startup = startupStatusFromDiagnosticComponent(component);
        const rawSteps = componentValue(component, ["steps", "startup_steps", "startupSteps", "log", "events", "entries"]);
        const warnings = startup?.warnings?.length ? startup.warnings.join(" · ") : "Ninguno publicado";
        const errors = startup?.errors?.length ? startup.errors.join(" · ") : "Ninguno publicado";
        return <>
            <DiagnosticField label="Último arranque" value={utcTimestamp(componentValue(component, ["started_at", "startedAt", "last_startup", "lastStartup", "last_run", "lastRun"]))} />
            <DiagnosticField label="Finalizado" value={utcTimestamp(componentValue(component, ["completed_at", "completedAt", "finished_at", "finishedAt"]) ?? startup?.completedAt)} />
            <DiagnosticField label="Pasos publicados" value={startupStepCount(rawSteps ?? startup?.steps)} />
            <DiagnosticField label="Avisos" value={warnings} />
            <DiagnosticField label="Errores" value={errors} />
        </>;
    }
    if (id === "erp") {
        const coverage = componentValue(component, ["coverage", "coverage_range", "coverageRange", "validity"]);
        return <>
            <DiagnosticField label="EOP loaded" value={displayBoolean(componentValue(component, ["loaded", "eop_loaded", "eopLoaded", "erp_loaded", "erpLoaded"]))} />
            <DiagnosticField label="Last update" value={utcTimestamp(componentValue(component, ["last_update", "lastUpdate", "updated_at", "updatedAt"]))} />
            <DiagnosticField label="Source URL" value={formatSource(componentValue(component, ["source_url", "sourceUrl", "url", "source"]))} />
            <DiagnosticField label="Coverage" value={rangeText(coverage)} />
        </>;
    }
    if (id === "sp3") {
        const overlap = componentValue(component, ["eop_overlap", "eopOverlap", "erp_overlap", "erpOverlap", "coverage_overlap", "coverageOverlap"])
            ?? nestedValue(component, ["coverage", "eop_coverage", "eopCoverage"], ["overlap", "overlaps", "overlaps_product", "overlapsProduct"]);
        return <>
            <DiagnosticField label="Using EOP" value={displayBoolean(componentValue(component, ["using_eop", "usingEop", "eop_used", "eopUsed", "erp_applied", "erpApplied"]))} />
            <DiagnosticField label="SP3 / ERP overlap" value={displayBoolean(overlap)} />
        </>;
    }
    if (id === "gravity") {
        const models = componentValue(component, ["models", "gravity_models", "gravityModels", "registry", "model_registry", "modelRegistry"]);
        const active = componentValue(component, ["active_model", "activeModel", "selected_model", "selectedModel", "model"]);
        return <>
            <DiagnosticField label="Modelo activo" value={activeGravityModel(active)} />
            <DiagnosticField label="EGM96" value={gravityModelPresentation(models, "EGM96")} />
            <DiagnosticField label="EGM2008" value={gravityModelPresentation(models, "EGM2008")} />
            <DiagnosticField label="Última actualización" value={utcTimestamp(componentValue(component, ["last_update", "lastUpdate", "updated_at", "updatedAt"]))} />
            <DiagnosticField label="Origen" value={formatSource(componentValue(component, ["source_url", "sourceUrl", "url", "source"]))} />
        </>;
    }
    if (id === "oem") {
        return <DiagnosticField label="Parser validation" value={component.summary || component.message || "No publicado"} />;
    }
    if (id === "propagators") {
        const twoBody = componentValue(component, ["two_body", "twoBody", "kepler"]);
        const cowell = componentValue(component, ["cowell_rk4", "cowellRk4", "stability"]);
        return <>
            <DiagnosticField label="Energy conservation" value={displayBoolean(componentValue(component, ["energy_conservation", "energyConservation", "energy_test", "energyTest", "energy_ok", "energyOk"]) ?? twoBody)} />
            <DiagnosticField label="Stability test" value={displayBoolean(componentValue(component, ["stability", "stability_test", "stabilityTest", "stable"]) ?? cowell)} />
        </>;
    }
    if (id === "forces") {
        return <DiagnosticField label="Force-model validation" value={component.summary || component.message || "No publicado"} />;
    }
    if (id === "mtr") {
        return <DiagnosticField label="Service validation" value={component.summary || component.message || "No publicado"} />;
    }
    if (id === "monitor") {
        return <DiagnosticField label="Monitor del servicio" value={displayBoolean(componentValue(component, ["running", "active", "available"]))} />;
    }
    if (id === "frames") {
        return <DiagnosticField label="ITRF / ECI route" value={componentValue(component, ["route", "eci_route", "eciRoute", "transform", "frame_route", "frameRoute"]) || component.summary || component.message || "No publicado"} />;
    }
    return null;
}

function DiagnosticField({ label, value }) {
    return <div className="grid grid-cols-[minmax(110px,.88fr)_minmax(0,1.35fr)] gap-x-2 border-t border-[#203650] py-1.5 first:border-t-0 first:pt-0">
        <dt className="text-[10px] leading-snug text-[#91a4c0]">{label}</dt>
        <dd className="m-0 min-w-0 break-words text-right text-[10px] leading-snug font-medium text-[#d9e5f6]">{value}</dd>
    </div>;
}

function DiagnosticCard({ definition, diagnostics, local }) {
    const component = findDiagnosticComponent(diagnostics, definition.id);
    const localStatus = localStatusFor(definition.id, local);
    const status = worstStatus(component?.status, localStatus, publishedNestedStatus(definition.id, component));
    const style = statusStyle[status];
    const hasRemote = Boolean(component);
    const message = component?.message || component?.summary || (!hasRemote
        ? "El servicio aún no ha publicado esta validación."
        : "Sin detalles adicionales.");

    return <section className="min-w-0 rounded-[9px] border border-[#2c496c] bg-[linear-gradient(145deg,rgba(13,29,50,.94),rgba(7,18,33,.94))] px-3 py-2.5 shadow-[inset_0_1px_rgba(255,255,255,.025)]" aria-label={`${definition.label}: ${style.label}`}>
        <header className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
                <h3 className="m-0 text-[12px] leading-tight font-semibold text-[#e4edfb]">{definition.label}</h3>
                <p className="mt-1 mb-0 text-[10px] leading-snug text-[#9db0ca]">{message}</p>
            </div>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] leading-none font-bold ${style.badge}`}><span className={`size-1.5 rounded-full ${style.dot}`} aria-hidden="true" />{style.label}</span>
        </header>
        <dl className="mt-2.5 mb-0">
            <DiagnosticField label="Last validation" value={utcTimestamp(component?.lastValidatedAt, hasRemote ? "No publicado" : "Pendiente de endpoint")} />
            <RemoteFields id={definition.id} component={component} />
            <LocalFields id={definition.id} local={local} />
        </dl>
    </section>;
}

function OverallStatus({ status }) {
    const normalized = normalizeDiagnosticStatus(status);
    const style = statusStyle[normalized];
    return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] leading-none font-bold ${style.badge}`}><span className={`size-1.5 rounded-full ${style.dot}`} aria-hidden="true" />{style.label}</span>;
}

function InitialBitCard({ summary }) {
    const style = statusStyle[summary.status];
    const startup = summary.startup;
    const steps = Array.isArray(startup?.steps) ? startup.steps : [];
    return <section className="mb-3 rounded-[9px] border border-[#3d5f8d] bg-[linear-gradient(145deg,rgba(18,39,68,.96),rgba(9,24,43,.96))] px-3 py-2.5 shadow-[inset_0_1px_rgba(255,255,255,.035)]" aria-label={`IBIT inicial: ${summary.result}`}>
        <header className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
                <span className="block text-[9px] leading-none font-bold tracking-[.13em] text-[#84a8e9]">IBIT · INICIAL</span>
                <h3 className="mt-1 mb-0 text-[12px] leading-tight font-semibold text-[#edf4ff]">Resultado del arranque: {summary.result}</h3>
                <p className="mt-1 mb-0 text-[10px] leading-snug text-[#a9bbd3]">{summary.message}</p>
            </div>
            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] leading-none font-bold ${style.badge}`}><span className={`size-1.5 rounded-full ${style.dot}`} aria-hidden="true" />{style.label}</span>
        </header>
        {startup && <dl className="mt-2.5 mb-0">
            <DiagnosticField label="Inicio" value={utcTimestamp(startup.startedAt, "No publicado")} />
            <DiagnosticField label="Finalizado" value={utcTimestamp(startup.completedAt, summary.terminal ? "No publicado" : "Aún en curso")} />
            <DiagnosticField label="Pasos" value={steps.length ? `${steps.length} publicados` : "No publicados"} />
        </dl>}
        {steps.length > 0 && <ol className="mt-2 mb-0 grid list-none gap-1.5 p-0" aria-label="Historial del IBIT inicial">
            {steps.map((step) => {
                const stepStyle = statusStyle[normalizeDiagnosticStatus(step.status)];
                return <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 rounded-[6px] border border-[#274466] bg-[#09192c]/70 px-2 py-1.5" key={`${step.id}-${step.timestamp || "current"}`}>
                    <span className={`mt-0.5 size-1.5 rounded-full ${stepStyle.dot}`} aria-hidden="true" />
                    <span className="min-w-0"><strong className="block text-[10px] leading-snug font-semibold text-[#dce8f8]">{step.label}</strong>{step.message && <small className="mt-0.5 block text-[9px] leading-snug text-[#9cafc8]">{step.message}</small>}</span>
                    <time className="whitespace-nowrap text-[9px] leading-snug text-[#91a8c7]" dateTime={step.timestamp || undefined}>{utcTimestamp(step.timestamp, "—")}</time>
                </li>;
            })}
        </ol>}
    </section>;
}

function RefreshIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.9]"><path d="M20 11a8 8 0 0 0-14.9-3.9L3 9.2M3 4.8v4.4h4.4M4 13a8 8 0 0 0 14.9 3.9l2.1-2.1M21 19.2v-4.4h-4.4" /></svg>;
}

/** Compact, read-only health view driven by the app-level continuous BIT stream. */
export default function BuiltInTestPanel({ onClose, diagnosticsState = null }) {
    const panelRef = useRef(null);
    const priorFocusRef = useRef(null);
    const {
        availability = "loading",
        endpoint = "",
        diagnostics = null,
        local = null,
        checkedAt = "",
        error = "",
        refreshing = false,
        refresh = null
    } = diagnosticsState || {};
    const cards = useMemo(() => visibleBitComponents({ diagnostics, local }).map((definition) => (
        <DiagnosticCard definition={definition} diagnostics={diagnostics} local={local} key={definition.id} />
    )), [diagnostics, local]);
    const initial = useMemo(() => initialBitSummary(diagnostics), [diagnostics]);
    const status = useMemo(() => continuousBitStatus({ availability, diagnostics, local }), [availability, diagnostics, local]);

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

    const remoteUnavailable = availability !== "available";
    return <section className="fixed inset-0 z-[10520] flex items-start justify-end bg-[#020811]/[.7] p-[clamp(10px,1.7vw,28px)] pt-[calc(max(64px,calc(76px*var(--orbit-ui-scale)))+12px)] backdrop-blur-[3px]" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <article ref={panelRef} tabIndex="-1" className="grid max-h-full w-[min(760px,100%)] min-h-0 overflow-hidden rounded-[14px] border border-[#36557c] bg-[#0b1526] shadow-[0_28px_80px_rgba(0,0,0,.62)] outline-none [grid-template-rows:auto_minmax(0,1fr)]" role="dialog" aria-modal="true" aria-labelledby="builtInTestTitle" aria-describedby="builtInTestDescription">
            <header className="flex min-h-[58px] items-center justify-between gap-3 border-b border-[#294667] bg-[linear-gradient(105deg,rgba(14,30,52,.98),rgba(8,18,33,.98))] px-[clamp(12px,1.4vw,20px)] py-2.5">
                <div className="min-w-0 font-[system-ui,sans-serif]">
                    <span className="block text-[9px] leading-none font-bold tracking-[.16em] text-[#7298dc]">ORBIT · BUILT-IN TEST</span>
                    <div className="mt-1 flex min-w-0 items-center gap-2"><h2 id="builtInTestTitle" className="m-0 truncate text-[15px] leading-none font-semibold text-[#edf4ff]">BIT continuo</h2><OverallStatus status={status} /></div>
                    <p id="builtInTestDescription" className="mt-1 mb-0 text-[10px] leading-snug text-[#a1b2cb]">IBIT inicial, comprobaciones continuas y solo los componentes presentes en esta escena.</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <button className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[7px] border border-[#36577f] bg-[#102039] px-2.5 text-[10px] leading-none font-semibold text-[#cfe0f8] transition-colors hover:border-[#628bd0] hover:bg-[#173054] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7198ff] disabled:cursor-wait disabled:opacity-60" type="button" onClick={() => typeof refresh === "function" && void refresh()} disabled={refreshing || typeof refresh !== "function"} aria-label="Actualizar diagnóstico"><RefreshIcon />{refreshing ? "Actualizando…" : "Actualizar"}</button>
                    <PanelCloseButton label="Cerrar Built-In Test" onClick={onClose} />
                </div>
            </header>
            <div className="min-h-0 overflow-y-auto px-[clamp(12px,1.4vw,20px)] py-3 [scrollbar-color:#426589_transparent] [scrollbar-width:thin]">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[8px] border border-[#294866] bg-[#0a192c] px-2.5 py-2 text-[10px] leading-snug text-[#a8bad1]" role="status" aria-live="polite">
                    <span>BIT continuo · última consulta: <strong className="font-semibold text-[#dbe7f8]">{utcTimestamp(checkedAt, "Pendiente")}</strong></span>
                    {availability === "available" && <span>Endpoint: <code className="text-[#a9c8ff]">{endpoint || "disponible"}</code></span>}
                </div>
                {remoteUnavailable && <aside className="mb-3 rounded-[8px] border border-[#85642d] bg-[rgba(86,57,18,.42)] px-3 py-2.5 text-[11px] leading-snug text-[#ffdaa1]" role="status"><strong className="font-semibold">Diagnóstico remoto no disponible.</strong> {error || "Inicia o actualiza Orbit para exponer /api/system/diagnostics (o /api/diagnostics)."} Se muestran únicamente los datos que la escena conoce localmente.</aside>}
                <InitialBitCard summary={initial} />
                <div className="grid gap-2.5 md:grid-cols-2">{cards}</div>
            </div>
        </article>
    </section>;
}
