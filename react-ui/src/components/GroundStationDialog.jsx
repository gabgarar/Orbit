import { useEffect, useState } from "react";

const tabs = {
    general: [["name", "Nombre de capa", "text"], ["latitude_deg", "Latitud (deg)", "number"], ["longitude_deg", "Longitud (deg)", "number"], ["altitude_m", "Altitud (m)", "number"], ["min_elevation_deg", "Máscara elevación", "number"], ["coverage_radius_km", "Radio cobertura (km)", "number"]],
    radio: [["frequency_mhz", "Frecuencia (MHz)", "number"], ["tx_power_dbm", "Potencia TX (dBm)", "number"], ["tx_gain_dbi", "Ganancia TX (dBi)", "number"], ["rx_gain_dbi", "Ganancia RX (dBi)", "number"]],
    visual: [["point_size_px", "Tamaño símbolo (px)", "number"], ["point_color", "Color símbolo", "color"]],
    heatmap: []
};

const classNames = (...classes) => classes.filter(Boolean).join(" ");
const fieldClass = "grid min-w-0 gap-[5px] font-sans text-[11px] font-semibold text-[var(--orbit-text-secondary)]";
const controlClass = "box-border min-h-[34px] w-full min-w-0 rounded-lg border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-input)] px-2 py-[7px] font-sans text-[12px] text-[var(--orbit-text-primary)]";

export default function GroundStationDialog() {
    const [data, setData] = useState(null);
    const [tab, setTab] = useState("general");

    useEffect(() => {
        const open = (event) => { setData(event.detail); setTab("general"); };
        const close = () => setData(null);
        window.addEventListener("orbit:ground-station-open", open);
        window.addEventListener("orbit:ground-station-close", close);
        return () => {
            window.removeEventListener("orbit:ground-station-open", open);
            window.removeEventListener("orbit:ground-station-close", close);
        };
    }, []);

    if (!data) return null;

    const update = (key, value) => setData((current) => ({ ...current, values: { ...current.values, [key]: value } }));
    const values = data.values || {};

    return <div
        id="groundStationModal"
        className="open fixed inset-0 z-[10145] flex box-border items-center justify-center bg-[var(--orbit-bg-overlay)] p-4"
        onMouseDown={(event) => event.target === event.currentTarget && setData(null)}
    >
        <section className="grid w-[min(640px,calc(100vw-32px))] max-h-[calc(100dvh-32px)] gap-[14px] overflow-hidden rounded-[calc(12px*var(--orbit-ui-scale))] border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-secondary)] p-4 text-[var(--orbit-text-primary)] shadow-[0_20px_60px_rgba(0,0,0,.4)] [container-type:inline-size]" role="dialog" aria-modal="true">
            <header className="flex cursor-move items-center justify-between">
                <h3 className="m-0 font-sans text-[14px] font-bold">{data.editing ? "Editar estación terrestre" : "Nueva estación terrestre"}</h3>
                <button className="inline-flex size-10 min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--orbit-border-accent)] bg-[var(--orbit-bg-tertiary)] p-0 font-sans text-[14px] leading-none font-bold text-[var(--orbit-text-primary)] hover:bg-[var(--orbit-bg-hover)]" type="button" onClick={() => setData(null)} aria-label="Cerrar">×</button>
            </header>

            <nav className="my-[10px] grid grid-cols-4 gap-[6px]" aria-label="Secciones de estación terrestre">
                {Object.keys(tabs).map((key) => <button
                    className={classNames(
                        "cursor-pointer rounded-lg border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-input)] px-[6px] py-2 font-sans text-[11px] leading-none font-bold text-[var(--orbit-text-secondary)]",
                        tab === key && "active border-[var(--orbit-border-focus)] bg-[var(--orbit-bg-tertiary)] text-[var(--orbit-text-primary)]"
                    )}
                    type="button"
                    key={key}
                    onClick={() => setTab(key)}
                >
                    {key === "heatmap" ? "Heat map" : key[0].toUpperCase() + key.slice(1)}
                </button>)}
            </nav>

            <div className="grid min-w-0 w-full grid-cols-2 gap-3 max-[780px]:grid-cols-1 [@container(max-width:520px)]:grid-cols-1">
                {tabs[tab].map(([key, label, type]) => <label className={fieldClass} key={key}>
                    <span>{label}</span>
                    <input className={controlClass} type={type} value={values[key] ?? ""} onChange={(event) => update(key, event.target.value)} />
                </label>)}
                {tab === "visual" && <>
                    <label className={fieldClass}>
                        <span>Símbolo</span>
                        <select className={controlClass} value={values.point_symbol || "circle"} onChange={(event) => update("point_symbol", event.target.value)}>{["circle", "square", "triangle", "diamond", "star"].map((value) => <option key={value}>{value}</option>)}</select>
                    </label>
                    <label className="flex min-w-0 items-center justify-between gap-2.5 font-sans text-[11px] font-semibold text-[var(--orbit-text-secondary)]">
                        <span>Mostrar cobertura</span>
                        <input className="size-6 min-h-6 min-w-6 cursor-pointer p-0 accent-[var(--orbit-text-accent)]" type="checkbox" checked={values.coverage_visible !== false} onChange={(event) => update("coverage_visible", event.target.checked)} />
                    </label>
                </>}
                {tab === "heatmap" && <>
                    <label className="flex min-w-0 items-center justify-between gap-2.5 font-sans text-[11px] font-semibold text-[var(--orbit-text-secondary)]">
                        <span>Heat map acumulado</span>
                        <input className="size-6 min-h-6 min-w-6 cursor-pointer p-0 accent-[var(--orbit-text-accent)]" type="checkbox" checked={values.heatmap_enabled === true} onChange={(event) => update("heatmap_enabled", event.target.checked)} />
                    </label>
                    <label className={fieldClass}>
                        <span>Densidad</span>
                        <select className={controlClass} value={values.heatmap_density || "medium"} onChange={(event) => update("heatmap_density", event.target.value)}>{["low", "medium", "high"].map((value) => <option key={value}>{value}</option>)}</select>
                    </label>
                </>}
            </div>

            <div className="flex justify-end pt-0.5">
                <button className="cursor-pointer rounded-lg border border-[var(--orbit-border-accent)] bg-[var(--orbit-bg-tertiary)] px-2 py-[7px] font-sans text-[11px] font-semibold text-[var(--orbit-text-primary)] hover:bg-[var(--orbit-bg-hover)]" type="button" onClick={() => window.dispatchEvent(new CustomEvent("orbit:ground-station-submit", { detail: values }))}>{data.editing ? "Guardar cambios" : "Crear estación"}</button>
            </div>
        </section>
    </div>;
}
