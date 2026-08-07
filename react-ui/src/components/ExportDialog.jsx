import { useEffect, useState } from "react";
import PanelCloseButton from "./PanelCloseButton.jsx";

const localValue = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const headerButtonClass = "cursor-pointer rounded-lg border border-[var(--orbit-border-accent)] bg-[var(--orbit-bg-tertiary)] px-2.5 py-1.5 font-[system-ui,sans-serif] text-xs font-semibold text-[var(--orbit-text-primary)] hover:bg-[var(--orbit-bg-hover)]";
const actionButtonClass = "cursor-pointer rounded-lg border border-[var(--orbit-border-accent)] bg-[var(--orbit-bg-tertiary)] px-2 py-[7px] font-[system-ui,sans-serif] text-[11px] font-semibold text-[var(--orbit-text-primary)] hover:bg-[var(--orbit-bg-hover)]";
const fieldControlClass = "rounded-lg border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-input)] px-2 py-[7px] font-[system-ui,sans-serif] text-xs text-[var(--orbit-text-primary)]";

export default function ExportDialog() {
    const [data, setData] = useState(null);
    const [ephemeris, setEphemeris] = useState(null);

    useEffect(() => {
        const open = (event) => {
            setData(event.detail);
            const now = new Date();
            setEphemeris({ start: localValue(now), end: localValue(new Date(now.getTime() + 86400000)), step: 10, format: "oem", propagator: "sgp4" });
        };
        const close = () => setData(null);
        window.addEventListener("orbit:export-open", open);
        window.addEventListener("orbit:export-close", close);
        return () => {
            window.removeEventListener("orbit:export-open", open);
            window.removeEventListener("orbit:export-close", close);
        };
    }, []);

    if (!data || !ephemeris) return null;

    const run = (type, detail = {}) => window.dispatchEvent(new CustomEvent("orbit:export-action", { detail: { type, ...detail } }));
    const update = (key, value) => setEphemeris((current) => ({ ...current, [key]: value }));

    return <div id="catalogExportModal" className="fixed inset-0 z-[10140] !flex items-center justify-center bg-[var(--orbit-bg-overlay)] p-4" onMouseDown={(event) => event.target === event.currentTarget && run("close")}>
        <section className="grid w-[min(calc(700px*var(--orbit-ui-scale)),96vw)] max-h-[88vh] gap-3 overflow-auto rounded-[calc(14px*var(--orbit-ui-scale))] border border-[var(--orbit-border-accent)] bg-[linear-gradient(180deg,var(--orbit-bg-modal)_0%,var(--orbit-bg-secondary)_100%)] p-[calc(14px*var(--orbit-ui-scale))] text-[var(--orbit-text-primary)] shadow-[0_24px_60px_rgba(0,0,0,.45)]" role="dialog" aria-modal="true">
            <header className="flex items-center justify-between">
                <h3 className="m-0 font-[system-ui,sans-serif] text-[15px] font-bold">Exportar {data.id}</h3>
                <PanelCloseButton onClick={() => run("close")} />
            </header>
            <p className="m-0 font-[system-ui,sans-serif] text-[11px] leading-[1.4] font-semibold tracking-[.03em] text-[var(--orbit-text-secondary)] uppercase">Fuente: {data.sourceFormat}</p>
            <div className="flex justify-end gap-2">{data.sourceFormat === "TLE" && <button className={headerButtonClass} type="button" onClick={() => run("tle")}>Exportar TLE</button>}{data.sourceFormat === "OMM" && <><button className={headerButtonClass} type="button" onClick={() => run("omm-json")}>OMM JSON</button><button className={headerButtonClass} type="button" onClick={() => run("omm-xml")}>OMM XML</button></>}{data.sourceFormat === "OEM" && <button className={headerButtonClass} type="button" onClick={() => run("oem")}>Exportar OEM</button>}</div>
            <section className="grid gap-2.5 rounded-[10px] border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-elevated)] p-2.5">
                <h4 className="m-0 font-[system-ui,sans-serif] text-xs font-bold text-[var(--orbit-text-secondary)]">Exportar efemérides</h4>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2">
                    <label className="grid gap-1.5 font-[system-ui,sans-serif] text-xs font-semibold text-[var(--orbit-text-secondary)]">Fecha inicio<input className={fieldControlClass} type="datetime-local" value={ephemeris.start} onChange={(event) => update("start", event.target.value)} /></label>
                    <label className="grid gap-1.5 font-[system-ui,sans-serif] text-xs font-semibold text-[var(--orbit-text-secondary)]">Fecha fin<input className={fieldControlClass} type="datetime-local" value={ephemeris.end} onChange={(event) => update("end", event.target.value)} /></label>
                    <label className="grid gap-1.5 font-[system-ui,sans-serif] text-xs font-semibold text-[var(--orbit-text-secondary)]">Intervalo (s)<input className={fieldControlClass} type="number" min="1" value={ephemeris.step} onChange={(event) => update("step", event.target.value)} /></label>
                    <label className="grid gap-1.5 font-[system-ui,sans-serif] text-xs font-semibold text-[var(--orbit-text-secondary)]">Formato<select className={fieldControlClass} value={ephemeris.format} onChange={(event) => update("format", event.target.value)}>{["csv", "json", "oem"].map((value) => <option key={value}>{value}</option>)}</select></label>
                </div>
                <button className={actionButtonClass} type="button" onClick={() => run("ephemeris", ephemeris)}>Exportar efemérides</button>
            </section>
        </section>
    </div>;
}
