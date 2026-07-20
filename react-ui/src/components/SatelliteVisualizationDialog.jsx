import { useEffect, useState } from "react";

const fields = [["orbit_future_color", "Color órbita futura", "color"], ["orbit_future_line_width", "Grosor futuro", "number"], ["propagation_hours", "Propagación (h)", "number"], ["satellite_label_size_px", "Tamaño etiqueta", "number"], ["satellite_model_scale", "Escala modelo", "number"]];
const checks = [["satellite_use_3d_model", "Usar modelo 3D"], ["orbit_future_show", "Mostrar futuro"], ["orbit_ground_track_show", "Mostrar ground track"]];
const fieldClass = "flex flex-col gap-1 font-sans [font-size:calc(12px*var(--orbit-ui-scale))]";
const controlClass = "rounded-lg border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-input)] px-[calc(8px*var(--orbit-ui-scale))] py-[calc(7px*var(--orbit-ui-scale))] font-[inherit] text-[var(--orbit-text-primary)]";

export default function SatelliteVisualizationDialog() {
    const [data, setData] = useState(null);

    useEffect(() => {
        const open = (event) => setData(event.detail);
        const close = () => setData(null);
        window.addEventListener("orbit:satellite-viz-open", open);
        window.addEventListener("orbit:satellite-viz-close", close);
        return () => {
            window.removeEventListener("orbit:satellite-viz-open", open);
            window.removeEventListener("orbit:satellite-viz-close", close);
        };
    }, []);

    if (!data) return null;

    const update = (key, value) => setData((current) => ({ ...current, values: { ...current.values, [key]: value } }));
    const hiddenWhenPropagationLocked = new Set(["propagation_hours"]);

    return <div
        id="satelliteVizModal"
        className="open fixed inset-0 z-[10040] flex box-border items-center justify-center bg-[var(--orbit-bg-overlay)] p-3"
        onMouseDown={(event) => event.target === event.currentTarget && setData(null)}
    >
        <section
            id="satelliteVizPanel"
            className="w-[min(760px,96vw)] max-h-[92vh] overflow-auto rounded-xl border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-secondary)] p-3 text-[var(--orbit-text-primary)]"
            role="dialog"
            aria-modal="true"
        >
            <header className="mb-2 flex items-center justify-between">
                <h3 className="m-0 font-sans text-[length:calc(15px*var(--orbit-ui-scale))] font-bold">Opciones de visualización</h3>
                <button className="inline-flex size-[calc(30px*var(--orbit-ui-scale))] cursor-pointer items-center justify-center rounded-full border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-tertiary)] p-0 font-sans text-[length:calc(16px*var(--orbit-ui-scale))] leading-none text-[var(--orbit-text-primary)] hover:bg-[var(--orbit-bg-hover)]" type="button" onClick={() => setData(null)} aria-label="Cerrar">×</button>
            </header>

            <p className="mx-0.5 mt-1 mb-2.5 font-sans text-[length:calc(12px*var(--orbit-ui-scale))] font-semibold text-[var(--orbit-text-accent)]">Satélite: {data.id}</p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
                {fields.filter(([key]) => !data.hidePropagation || !hiddenWhenPropagationLocked.has(key)).map(([key, label, type]) => <label className={fieldClass} key={key}>
                    <span className="text-[var(--orbit-text-secondary)]">{label}</span>
                    <input className={controlClass} type={type} step="any" value={data.values[key] ?? ""} onChange={(event) => update(key, event.target.value)} />
                </label>)}
                <label className={fieldClass}>
                    <span className="text-[var(--orbit-text-secondary)]">Modo de tamaño</span>
                    <select className={controlClass} value={data.values.satellite_size_mode || "visual"} onChange={(event) => update("satellite_size_mode", event.target.value)}>
                        <option value="visual">visual</option>
                        <option value="physical">physical</option>
                    </select>
                </label>
                {checks.map(([key, label]) => <label className="mt-[18px] flex items-center gap-2 font-sans [font-size:calc(12px*var(--orbit-ui-scale))]" key={key}>
                    <input type="checkbox" checked={data.values[key] === true} onChange={(event) => update(key, event.target.checked)} />
                    <span className="text-[var(--orbit-text-secondary)]">{label}</span>
                </label>)}
            </div>

            <footer id="satelliteVizActions" className="mt-3 flex justify-between gap-2">
                <button className="h-[calc(34px*var(--orbit-ui-scale))] cursor-pointer rounded-[9px] border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-tertiary)] px-3 font-sans text-[length:calc(12px*var(--orbit-ui-scale))] leading-none font-bold text-[var(--orbit-text-primary)]" type="button" onClick={() => window.dispatchEvent(new CustomEvent("orbit:satellite-viz-action", { detail: { type: "reset", id: data.id } }))}>Restablecer</button>
                <button className="h-[calc(34px*var(--orbit-ui-scale))] cursor-pointer rounded-[9px] border border-[var(--orbit-border-success)] bg-[var(--orbit-bg-success-soft)] px-3 font-sans text-[length:calc(12px*var(--orbit-ui-scale))] leading-none font-bold text-[var(--orbit-text-primary)] hover:bg-[var(--orbit-bg-success-soft-hover)]" type="button" onClick={() => window.dispatchEvent(new CustomEvent("orbit:satellite-viz-action", { detail: { type: "apply", id: data.id, patch: data.values } }))}>Aplicar</button>
            </footer>
        </section>
    </div>;
}
