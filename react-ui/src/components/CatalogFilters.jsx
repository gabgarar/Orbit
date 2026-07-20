import { useEffect, useState } from "react";

const orbitKinds = new Set(["leo", "meo", "geo", "heo"]);
const emptyFilters = Object.freeze({ orbitKind: "", decayOnly: false });
const controlClass = "rounded-lg border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-input)] px-2 py-[7px] font-[system-ui,sans-serif] text-xs text-[var(--orbit-text-primary)]";
const headerButtonClass = "cursor-pointer rounded-lg border border-[var(--orbit-border-accent)] bg-[var(--orbit-bg-tertiary)] px-2.5 py-1.5 font-[system-ui,sans-serif] text-xs font-semibold text-[var(--orbit-text-primary)] hover:bg-[var(--orbit-bg-hover)]";
const actionButtonClass = "cursor-pointer rounded-lg border border-[var(--orbit-border-accent)] bg-[var(--orbit-bg-tertiary)] px-2 py-[7px] font-[system-ui,sans-serif] text-[11px] font-semibold text-[var(--orbit-text-primary)] hover:bg-[var(--orbit-bg-hover)]";

function normalizeFilters(value = {}) {
    const orbitKind = String(value?.orbitKind || "").trim().toLowerCase();
    return {
        orbitKind: orbitKinds.has(orbitKind) ? orbitKind : "",
        decayOnly: value?.decayOnly === true
    };
}

export default function CatalogFilters() {
    const [open, setOpen] = useState(false);
    const [filters, setFilters] = useState(emptyFilters);

    useEffect(() => {
        const show = (event) => {
            // The catalogue search remains in its own field.  This dialog
            // deliberately owns only the two actual catalogue filters.
            setFilters(normalizeFilters(event.detail));
            setOpen(true);
        };
        window.addEventListener("orbit:catalog-filters-open", show);
        return () => window.removeEventListener("orbit:catalog-filters-open", show);
    }, []);

    if (!open) return null;

    const update = (key, value) => setFilters((current) => normalizeFilters({ ...current, [key]: value }));
    const apply = () => {
        window.dispatchEvent(new CustomEvent("orbit:catalog-action", { detail: { type: "filters-apply", filters: normalizeFilters(filters) } }));
        setOpen(false);
    };

    return <div id="catalogFilterModal" className="fixed inset-0 z-[10130] !flex items-center justify-center bg-[var(--orbit-bg-overlay)] p-4" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
        <section className="grid w-[min(calc(360px*var(--orbit-ui-scale)),94vw)] gap-3 rounded-[calc(12px*var(--orbit-ui-scale))] border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-secondary)] p-[calc(12px*var(--orbit-ui-scale))] text-[var(--orbit-text-primary)] shadow-[0_20px_60px_rgba(0,0,0,.4)]" role="dialog" aria-modal="true" aria-label="Filtros de catálogo">
            <header className="flex items-center justify-between">
                <h3 className="m-0 font-[system-ui,sans-serif] text-sm font-bold">Filtros de catálogo</h3>
                <button className="inline-flex size-[30px] flex-none cursor-pointer items-center justify-center rounded-lg border border-[var(--orbit-border-accent)] bg-[var(--orbit-bg-tertiary)] p-0 text-[var(--orbit-text-primary)] hover:bg-[var(--orbit-bg-hover)]" type="button" onClick={() => setOpen(false)} aria-label="Cerrar">
                    <svg className="size-[15px] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
                </button>
            </header>
            <div className="grid gap-2.5">
                <label className="grid gap-1.5 font-[system-ui,sans-serif] text-xs font-semibold text-[var(--orbit-text-secondary)]"><span>Órbita</span><select className={controlClass} value={filters.orbitKind || ""} onChange={(event) => update("orbitKind", event.target.value)}>{[["", "Todas"], ["leo", "LEO"], ["meo", "MEO"], ["geo", "GEO"], ["heo", "HEO"]].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <label className="flex items-center justify-between gap-2.5 font-[system-ui,sans-serif] text-xs font-semibold text-[var(--orbit-text-secondary)]"><span>Solo decay</span><input className="m-0 size-4 cursor-pointer accent-[var(--orbit-text-accent)]" type="checkbox" checked={filters.decayOnly === true} onChange={(event) => update("decayOnly", event.target.checked)} /></label>
            </div>
            <div className="flex justify-end gap-2">
                <button className={headerButtonClass} type="button" onClick={() => setFilters(emptyFilters)}>Limpiar</button>
                <button className={actionButtonClass} type="button" onClick={apply}>Aplicar filtros</button>
            </div>
        </section>
    </div>;
}
