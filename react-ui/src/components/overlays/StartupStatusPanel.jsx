import { useMemo } from "react";
import {
    getStartupProjectReadiness
} from "../../../../front/js/features/diagnostics/startupStatus.js";

const STATUS_COPY = Object.freeze({
    pending: { label: "En curso", dot: "bg-[#77a7ff]", badge: "border-[#385f9b] bg-[#132b4a] text-[#b9d3ff]" },
    healthy: { label: "Listo", dot: "bg-[#48d99b]", badge: "border-[#247958] bg-[#0e382d] text-[#8aebbb]" },
    warning: { label: "Aviso", dot: "bg-[#f1ba58]", badge: "border-[#86612b] bg-[#3d2c14] text-[#ffd184]" },
    error: { label: "Error", dot: "bg-[#f17878]", badge: "border-[#8d3b42] bg-[#401d25] text-[#ffabb1]" }
});

function text(value) {
    if (value === undefined || value === null) return "";
    return String(value).trim();
}

function startupStatus(value) {
    return STATUS_COPY[value] ? value : "pending";
}

function Icon({ status }) {
    if (status === "healthy") return <span className="grid size-4 place-items-center rounded-full border border-[#378666] bg-[#123d30] text-[10px] font-bold text-[#8ef0bd]" aria-hidden="true">✓</span>;
    if (status === "warning") return <span className="grid size-4 place-items-center rounded-full border border-[#9b7030] bg-[#432f17] text-[10px] font-bold text-[#ffd184]" aria-hidden="true">!</span>;
    if (status === "error") return <span className="grid size-4 place-items-center rounded-full border border-[#a84a54] bg-[#491e26] text-[10px] font-bold text-[#ffb3b9]" aria-hidden="true">×</span>;
    return <span className="size-3.5 animate-spin rounded-full border-2 border-[#6f9cff] border-t-transparent" aria-hidden="true" />;
}

function statusMessage(startup) {
    if (startup?.errors?.length) return startup.errors[0];
    if (startup?.warnings?.length) return startup.warnings[0];
    return text(startup?.message);
}

function boundedPercent(value) {
    const candidate = Number(value);
    return Number.isFinite(candidate) ? Math.round(Math.min(100, Math.max(0, candidate))) : null;
}

function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return "";
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
    if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1)} MiB`;
    return `${(bytes / (1024 ** 3)).toFixed(2)} GiB`;
}

function progressStageLabel(state) {
    return {
        downloading: "Descargando",
        validating: "Validando",
        ready: "Validado",
        error: "Error",
        pending: "Preparando"
    }[state] || "Preparando";
}

function StartupProgress({ progress, ready }) {
    const percent = boundedPercent(progress?.percent);
    const models = Array.isArray(progress?.models) ? progress.models : [];
    const modelName = String(progress?.currentModel || "").trim();
    const stage = progressStageLabel(progress?.state);
    const completed = Number.isFinite(progress?.completedModels) ? progress.completedModels : null;
    const total = Number.isFinite(progress?.totalModels) ? progress.totalModels : null;
    const summary = ready
        ? "Datos críticos preparados y validados."
        : (progress?.message || `${stage}${modelName ? ` ${modelName}` : " de datos críticos"}…`);
    const valueText = percent === null
        ? `${summary} Progreso en curso.`
        : `${summary} ${percent}% completado.`;

    return <section className="mb-2.5 rounded-[7px] border border-[#31577e] bg-[#091b31] px-2.5 py-2" aria-label="Progreso de preparación">
        <div className="mb-1.5 flex items-start justify-between gap-2 text-[10px] leading-snug">
            <span className="min-w-0 font-semibold text-[#dceaff]">{summary}</span>
            <span className="shrink-0 font-mono text-[#91b9f0]">{percent === null ? (ready ? "100%" : "…") : `${percent}%`}</span>
        </div>
        <div
            className="h-1.5 overflow-hidden rounded-full bg-[#152d49]"
            data-testid="startup-progress-bar"
            role="progressbar"
            aria-label="Progreso de preparación de Orbit"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent === null ? undefined : percent}
            aria-valuetext={valueText}
        >
            <span
                className={`block h-full rounded-full bg-[linear-gradient(90deg,#4586ff,#65d5ff)] shadow-[0_0_9px_rgba(91,178,255,.72)] ${percent === null && !ready ? "w-[42%] animate-pulse" : "transition-[width] duration-500"}`}
                style={percent === null ? undefined : { width: `${percent}%` }}
            />
        </div>
        {(completed !== null || total !== null) && <p className="mt-1.5 mb-0 text-[9px] leading-none text-[#91a9c9]">Modelos preparados: {completed ?? 0}{total !== null ? ` / ${total}` : ""}</p>}
        {models.length > 0 && <ul className="mt-2 mb-0 grid list-none gap-1 border-t border-[#203b59] pt-1.5 pl-0">
            {models.map((model, index) => {
                const modelPercent = boundedPercent(model?.percent);
                const bytes = model?.bytesDownloaded !== null || model?.totalBytes !== null
                    ? `${formatBytes(model?.bytesDownloaded)}${model?.totalBytes !== null ? ` / ${formatBytes(model.totalBytes)}` : ""}`.trim()
                    : "";
                return <li className="flex items-center justify-between gap-2 text-[9px] leading-snug text-[#afc2db]" key={model?.model || `${model?.stage || "model"}-${index}`}>
                    <span className="min-w-0 truncate"><strong className="font-semibold text-[#d7e6fb]">{model?.model || "Modelo"}</strong>{model?.stage || model?.state ? ` · ${progressStageLabel(model?.state || model?.stage)}` : ""}{model?.message ? ` · ${model.message}` : ""}</span>
                    <span className="shrink-0 font-mono text-[#83aee3]">{modelPercent !== null ? `${modelPercent}%` : bytes}</span>
                </li>;
            })}
        </ul>}
    </section>;
}

function StartupStep({ step }) {
    const status = startupStatus(step?.status);
    const copy = STATUS_COPY[status];
    return <li className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-2 py-1.5 first:pt-0 last:pb-0">
        <span className="mt-px"><Icon status={status} /></span>
        <span className="min-w-0 text-[11px] leading-snug text-[#dbe7fa]">{step?.label || "Comprobación de arranque"}{step?.message && <small className="mt-0.5 block text-[10px] leading-snug text-[#9baec8]">{step.message}</small>}</span>
        <span className={`mt-px inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[8px] leading-none font-bold ${copy.badge}`}><span className={`size-1 rounded-full ${copy.dot}`} aria-hidden="true" />{copy.label}</span>
    </li>;
}

/**
 * The central, non-dismissible startup ledger shown in the welcome view. It
 * keeps the service-owned project-readiness gate and every automatic retry
 * visible while the mandatory ERP/gravity assets download and validate.
 */
export default function StartupStatusPanel({ startup }) {
    const status = startupStatus(startup?.status);
    const readiness = getStartupProjectReadiness(startup);
    const message = statusMessage(startup);
    const steps = useMemo(() => Array.isArray(startup?.steps) ? startup.steps : [], [startup?.steps]);

    const copy = STATUS_COPY[status];
    return <section
        className="overflow-hidden rounded-[14px] border border-[#36557c] bg-[linear-gradient(145deg,rgba(12,29,51,.98),rgba(6,16,30,.98))] font-[system-ui,sans-serif] text-[#e8f0fd] shadow-[0_18px_50px_rgba(0,0,0,.48)] backdrop-blur-[12px]"
        data-testid="startup-status-panel"
        aria-labelledby="startup-status-heading"
        aria-live="polite"
        aria-atomic="false"
        role="status"
    >
        <header className="flex min-h-11 items-center justify-between gap-2 border-b border-[#294667] bg-[rgba(15,32,55,.8)] px-3 py-2">
            <div className="min-w-0"><span className="block text-[8px] leading-none font-bold tracking-[.15em] text-[#7298dc]">ORBIT · STARTUP</span><h2 id="startup-status-heading" className="mt-1 mb-0 truncate text-[12px] leading-none font-semibold text-[#edf4ff]">Estado de arranque</h2></div>
            <div className="flex shrink-0 items-center gap-1.5"><span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] leading-none font-bold ${copy.badge}`}><span className={`size-1.5 rounded-full ${copy.dot}`} aria-hidden="true" />{copy.label}</span></div>
        </header>
        <div className="max-h-[min(360px,max(160px,calc(100dvh-330px)))] overflow-y-auto px-3 py-2.5 [scrollbar-color:#426589_transparent] [scrollbar-width:thin]">
            <StartupProgress progress={startup?.progress} ready={readiness.ready} />
            {!readiness.ready && <section className="mb-2 rounded-[6px] border border-[#456d9d] bg-[#102946] px-2 py-1.5 text-[10px] leading-snug text-[#d8e8ff]" data-testid="startup-project-gate" role="status">
                <strong className="block text-[#f0f6ff]">Creación e importación de proyectos temporalmente bloqueadas</strong>
                <span>{readiness.message}</span>
            </section>}
            {message && <p className={`mt-0 mb-2 rounded-[6px] border px-2 py-1.5 text-[10px] leading-snug ${status === "error" ? "border-[#87464f] bg-[#401f27] text-[#ffbec3]" : status === "warning" ? "border-[#85642d] bg-[#3d2c14] text-[#ffdaa1]" : "border-[#294b70] bg-[#0c1c31] text-[#afc3df]"}`}>{message}</p>}
            {steps.length ? <ol className="m-0 list-none divide-y divide-[#203650] p-0">{steps.map((step) => <StartupStep key={step.id || step.label} step={step} />)}</ol> : <p className="m-0 text-[11px] leading-snug text-[#aabbd2]">Esperando los primeros eventos de arranque. La interfaz sigue siendo utilizable.</p>}
            {!readiness.ready && <p className="mt-2 mb-0 text-[9px] leading-snug text-[#8094b2]">Las comprobaciones continúan en segundo plano. Los errores de descarga se reintentan automáticamente cuando el servicio lo permite.</p>}
        </div>
    </section>;
}
