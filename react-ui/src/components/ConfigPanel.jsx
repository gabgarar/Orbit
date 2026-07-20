import { useState } from "react";
import ConfigField from "../features/config/ConfigField.jsx";
import { sections, tabs, titles } from "../features/config/configSchema.js";
import useConfigPanelState from "../hooks/useConfigPanelState.js";

const classNames = (...classes) => classes.filter(Boolean).join(" ");
const headerButtonClass = "h-[calc(34px*var(--orbit-ui-scale))] cursor-pointer rounded-[calc(9px*var(--orbit-ui-scale))] px-[calc(10px*var(--orbit-ui-scale))] font-sans text-[length:calc(11px*var(--orbit-ui-scale))] leading-none font-bold";
const statusColors = {
    idle: "text-[var(--orbit-text-success)]",
    saved: "text-[var(--orbit-text-success)]",
    saving: "text-[var(--orbit-text-warning)]",
    error: "text-[var(--orbit-text-error)]"
};

export default function ConfigPanel() {
    const [tab, setTab] = useState("orbital");
    const { open, setOpen, config, setConfig, status } = useConfigPanelState();
    const change = (section, key, value) => { setConfig((current) => ({ ...current, [section]: { ...current[section], [key]: value } })); window.dispatchEvent(new CustomEvent("orbit:config-panel-action", { detail: { type: "change", section, key, value } })); };
    const action = (type) => window.dispatchEvent(new CustomEvent("orbit:config-panel-action", { detail: { type } }));
    const activeSections = tabs.find(([id]) => id === tab)?.[2] || [];
    if (!open) return null;

    return <div
        id="configModal"
        className="open fixed inset-0 z-[10160] flex box-border items-center justify-center bg-[var(--orbit-bg-overlay)] p-4"
        onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
    >
        <section
            id="configPanel"
            className="w-[min(calc(860px*var(--orbit-ui-scale)),96vw)] max-h-[88vh] overflow-auto rounded-[calc(12px*var(--orbit-ui-scale))] border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-secondary)] p-[calc(14px*var(--orbit-ui-scale))] text-[var(--orbit-text-primary)] shadow-[0_20px_60px_rgba(0,0,0,.4)] [scrollbar-color:var(--orbit-scrollbar-thumb)_var(--orbit-bg-primary)] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar-track]:rounded-lg [&::-webkit-scrollbar-track]:bg-[var(--orbit-bg-primary)] [&::-webkit-scrollbar-thumb]:rounded-lg [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-[var(--orbit-bg-secondary)] [&::-webkit-scrollbar-thumb]:bg-[linear-gradient(180deg,var(--orbit-scrollbar-thumb)_0%,var(--orbit-scrollbar-thumb-end)_100%)]"
            role="dialog"
            aria-modal="true"
            aria-label="Configuración"
        >
            <header id="configPanelHeader" className="mb-2 flex cursor-move items-center justify-between select-none">
                <h3 className="m-0 font-sans text-[length:calc(16px*var(--orbit-ui-scale))] font-bold">Configuración en tiempo real</h3>
                <div className="inline-flex items-center gap-2">
                    <button className={classNames(headerButtonClass, "border border-[var(--orbit-border-success)] bg-[var(--orbit-bg-success-soft)] text-[var(--orbit-text-success)] hover:bg-[var(--orbit-bg-success-soft-hover)]")} type="button" onClick={() => action("apply-global")}>Aplicar globalmente</button>
                    <button className={classNames(headerButtonClass, "border border-[var(--orbit-border-danger)] bg-[var(--orbit-bg-danger-soft)] text-[var(--orbit-text-danger-soft)] hover:bg-[var(--orbit-bg-danger-soft-hover)]")} type="button" onClick={() => action("reset")}>Restaurar valores</button>
                    <button className="inline-flex size-[calc(34px*var(--orbit-ui-scale))] cursor-pointer items-center justify-center rounded-full border border-[var(--orbit-border-accent)] bg-[var(--orbit-bg-tertiary)] p-0 font-sans text-[length:calc(16px*var(--orbit-ui-scale))] leading-none font-bold text-[var(--orbit-text-primary)] hover:bg-[var(--orbit-bg-hover)]" type="button" onClick={() => setOpen(false)} aria-label="Cerrar">&#215;</button>
                </div>
            </header>

            <p id="configHint" className="mx-0.5 mt-[6px] mb-1 font-sans text-[length:calc(12px*var(--orbit-ui-scale))] text-[var(--orbit-text-muted)]">Los cambios se aplican al instante y se guardan automáticamente.</p>
            <p id="configSaveStatus" className={classNames("mx-0.5 mt-0 mb-2.5 font-sans text-[length:calc(11px*var(--orbit-ui-scale))] font-semibold tracking-[.01em]", status.state, statusColors[status.state] || "text-[var(--orbit-text-success)]")}>{status.message}</p>

            <nav className="mx-0.5 mb-2.5 flex flex-wrap gap-2" aria-label="Secciones de configuración">
                {tabs.map(([id, label]) => <button
                    className={classNames(
                        "h-[calc(30px*var(--orbit-ui-scale))] cursor-pointer rounded-full border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-tertiary)] px-[calc(12px*var(--orbit-ui-scale))] font-sans text-[length:calc(11px*var(--orbit-ui-scale))] leading-none font-bold tracking-[.02em] text-[var(--orbit-text-secondary)] hover:bg-[var(--orbit-bg-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--orbit-border-focus)]",
                        tab === id && "active border-[var(--orbit-border-focus)] bg-[var(--orbit-bg-accent-soft)] text-[var(--orbit-text-primary)]"
                    )}
                    type="button"
                    key={id}
                    onClick={() => setTab(id)}
                >
                    {label}
                </button>)}
            </nav>

            <div className="grid">
                {activeSections.map((section) => <section className="my-[10px] mb-4 rounded-[10px] border border-[var(--orbit-border-primary)] bg-[var(--orbit-bg-elevated)] p-[10px]" key={section}>
                    <h4 className="mt-0 mr-0 mb-[10px] ml-0 font-sans text-[length:calc(13px*var(--orbit-ui-scale))] font-bold tracking-[.04em] text-[var(--orbit-text-accent)] uppercase">{titles[section]}</h4>
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
                        {sections[section].map((field) => <ConfigField key={field} section={section} field={field} value={config[section]?.[field]} onChange={change} />)}
                    </div>
                </section>)}
            </div>
        </section>
    </div>;
}
