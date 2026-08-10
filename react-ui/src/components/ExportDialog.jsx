import { useEffect, useMemo, useState } from "react";
import {
    getDefaultOrbitExportFormat,
    getOrbitExportFormat,
    getOrbitExportFormats,
    isSourceOnlyOrbitExport
} from "../../../front/js/features/exports/orbitExportFormats.js";
import PanelCloseButton from "./PanelCloseButton.jsx";
import { OrbitalSatelliteIcon } from "./icons.jsx";

const localValue = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const fieldControlClass = "min-h-10 rounded-[var(--orbit-radius-control)] border border-[var(--orbit-frame-color)] bg-[var(--orbit-bg-input)] px-2.5 text-[var(--orbit-font-size-body)] font-medium text-[var(--orbit-text-primary)] outline-none focus:border-[#648eff]";
const secondaryButtonClass = "cursor-pointer rounded-[var(--orbit-radius-control)] border border-[var(--orbit-frame-color)] bg-transparent px-3 py-2 text-[11px] font-semibold text-[var(--orbit-text-secondary)] transition-colors hover:border-[#5d82b7] hover:text-[var(--orbit-text-primary)]";
const actionButtonClass = "cursor-pointer rounded-[var(--orbit-radius-control)] border border-[#6b8cff] bg-[#304dbd] px-3 py-2 text-[11px] font-semibold text-white shadow-[0_0_18px_rgba(66,97,215,.18)] transition-colors hover:bg-[#3b5bd1] disabled:cursor-not-allowed disabled:border-[#755f35] disabled:bg-[#3d3426] disabled:text-[#d4b975] disabled:shadow-none";

function sourceLabel(sourceFormat) {
    const source = String(sourceFormat || "TLE").trim().toUpperCase();
    return source === "MANUAL" ? "Órbita manual" : source;
}

export default function ExportDialog() {
    const [data, setData] = useState(null);
    const [ephemeris, setEphemeris] = useState(null);

    useEffect(() => {
        const open = (event) => {
            const detail = event.detail || {};
            const now = new Date();
            setData(detail);
            setEphemeris({
                start: localValue(now),
                end: localValue(new Date(now.getTime() + 86400000)),
                step: 10,
                format: getDefaultOrbitExportFormat(detail.sourceFormat),
                propagator: detail.propagator || (String(detail.sourceFormat || "").toUpperCase() === "MANUAL" ? "two-body" : "sgp4")
            });
        };
        const close = () => setData(null);
        window.addEventListener("orbit:export-open", open);
        window.addEventListener("orbit:export-close", close);
        return () => {
            window.removeEventListener("orbit:export-open", open);
            window.removeEventListener("orbit:export-close", close);
        };
    }, []);

    const sourceFormat = String(data?.sourceFormat || "TLE").trim().toUpperCase();
    const formats = useMemo(() => getOrbitExportFormats(sourceFormat), [sourceFormat]);
    const selectedFormat = useMemo(
        () => getOrbitExportFormat(sourceFormat, ephemeris?.format),
        [sourceFormat, ephemeris?.format]
    );

    if (!data || !ephemeris) return null;

    const run = (type, detail = {}) => window.dispatchEvent(new CustomEvent("orbit:export-action", { detail: { type, ...detail } }));
    const update = (key, value) => setEphemeris((current) => ({ ...current, [key]: value }));
    const sourceOnly = isSourceOnlyOrbitExport(selectedFormat.id);
    const unavailable = selectedFormat.disabled === true;
    const exportProduct = () => {
        if (unavailable) return;
        run("export", {
            id: data.id,
            sourceFormat,
            manual: sourceFormat === "MANUAL",
            format: selectedFormat.id,
            start: ephemeris.start,
            end: ephemeris.end,
            step: ephemeris.step,
            propagator: ephemeris.propagator
        });
    };

    return <div id="catalogExportModal" className="fixed inset-0 z-[10140] !flex items-center justify-center bg-[var(--orbit-bg-overlay)] p-4" onMouseDown={(event) => event.target === event.currentTarget && run("close")}>
        <section className="grid w-[min(calc(620px*var(--orbit-ui-scale,1)),96vw)] max-h-[min(760px,calc(100vh-32px))] gap-3 overflow-auto rounded-[var(--orbit-radius-window)] border border-[var(--orbit-frame-color)] bg-[var(--orbit-surface-window)] p-4 text-[var(--orbit-text-primary)] shadow-[0_24px_60px_rgba(0,0,0,.50)] [font-family:var(--orbit-font-ui)]" role="dialog" aria-modal="true" aria-labelledby="orbitExportDialogTitle">
            <header className="flex items-start justify-between gap-4 border-b border-[var(--orbit-frame-color)] pb-3">
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-[var(--orbit-radius-control)] border border-[#315477] bg-[rgba(31,63,104,.25)] text-[#9cc5ff]" aria-hidden="true"><OrbitalSatelliteIcon /></span>
                    <div className="min-w-0">
                        <h3 id="orbitExportDialogTitle" className="m-0 truncate text-[var(--orbit-font-size-panel-title)] font-semibold tracking-[.01em]">Exportar {data.id}</h3>
                        <p className="mt-1 mb-0 text-[var(--orbit-font-size-meta)] leading-snug text-[var(--orbit-text-secondary)]">Fuente: {sourceLabel(sourceFormat)}</p>
                    </div>
                </div>
                <PanelCloseButton onClick={() => run("close")} label="Cerrar exportación orbital" />
            </header>

            <section className="grid gap-3 rounded-[var(--orbit-radius-control)] border border-[var(--orbit-frame-color)] bg-[var(--orbit-bg-elevated)] p-3">
                <label className="grid gap-1.5 text-[var(--orbit-font-size-body)] font-semibold text-[var(--orbit-text-secondary)]">
                    Formato
                    <select className={fieldControlClass} value={selectedFormat.id} onChange={(event) => update("format", event.target.value)}>
                        {formats.map((format) => <option key={format.id} value={format.id} disabled={format.disabled === true}>{format.label} ({format.extension}){format.disabled ? " — no disponible" : ""}</option>)}
                    </select>
                </label>

                <section className="grid gap-1.5 rounded-[var(--orbit-radius-control)] border border-[#a87820] bg-[rgba(115,73,13,.18)] px-3 py-2.5 text-[#f5ddb0]" aria-live="polite">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <strong className="text-[11px]">{selectedFormat.title}</strong>
                        <span className="rounded border border-[#bd8525] bg-[rgba(147,94,17,.18)] px-1.5 py-0.5 text-[9px] font-semibold tracking-[.05em]">{selectedFormat.extension}</span>
                    </div>
                    <p className="m-0 text-[11px] leading-relaxed text-[#f1d9a5]">{selectedFormat.description}</p>
                    <p className="m-0 text-[10px] leading-relaxed text-[#d7bd88]">{selectedFormat.note}</p>
                </section>

                {!sourceOnly && <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2">
                    <label className="grid gap-1.5 text-[var(--orbit-font-size-body)] font-semibold text-[var(--orbit-text-secondary)]">Fecha inicio<input className={fieldControlClass} type="datetime-local" value={ephemeris.start} onChange={(event) => update("start", event.target.value)} /></label>
                    <label className="grid gap-1.5 text-[var(--orbit-font-size-body)] font-semibold text-[var(--orbit-text-secondary)]">Fecha fin<input className={fieldControlClass} type="datetime-local" value={ephemeris.end} onChange={(event) => update("end", event.target.value)} /></label>
                    <label className="grid gap-1.5 text-[var(--orbit-font-size-body)] font-semibold text-[var(--orbit-text-secondary)]">Intervalo (s)<input className={fieldControlClass} type="number" min="1" max="3600" value={ephemeris.step} onChange={(event) => update("step", event.target.value)} /></label>
                </div>}
                {sourceOnly && !unavailable && <p className="m-0 text-[10px] leading-relaxed text-[var(--orbit-text-secondary)]">Este formato conserva la entrada disponible. No necesita intervalo ni muestreo de efemérides.</p>}
                {unavailable && <p className="m-0 text-[10px] leading-relaxed text-[#e2c277]">La exportación queda deshabilitada hasta que Orbit incorpore un ajuste SGP4 con residuos y criterios de calidad verificables.</p>}
            </section>

            <footer className="flex flex-wrap justify-end gap-2 border-t border-[var(--orbit-frame-color)] pt-3">
                <button className={secondaryButtonClass} type="button" onClick={() => run("close")}>Cancelar</button>
                <button className={actionButtonClass} type="button" disabled={unavailable} title={unavailable ? selectedFormat.note : undefined} onClick={exportProduct}>{unavailable ? "No disponible" : `Exportar ${selectedFormat.label}`}</button>
            </footer>
        </section>
    </div>;
}
