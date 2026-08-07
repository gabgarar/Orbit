import { useState } from "react";
import ConfigField from "../features/config/ConfigField.jsx";
import { sections, tabs, titles } from "../features/config/configSchema.js";
import useConfigPanelState from "../hooks/useConfigPanelState.js";
import PanelCloseButton from "./PanelCloseButton.jsx";

const classNames = (...classes) => classes.filter(Boolean).join(" ");
const statusColors = {
    idle: "bg-[#2b7a55]",
    saved: "bg-[#62d690]",
    saving: "bg-[#f2bd58]",
    error: "bg-[#ee6e7d]"
};

function SettingsGlyph() {
    return <svg className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 17h16M8 4v6M16 14v6" /></svg>;
}

function statusText(status) {
    if (status?.message) return status.message;
    if (status?.state === "saving") return "Guardando cambios";
    if (status?.state === "error") return "No se pudieron guardar los cambios";
    return "Estado sincronizado";
}

/**
 * Runtime settings use the same right-side, persistent-card language as the
 * selected-object details. The runtime still owns validation and persistence;
 * this component only dispatches its existing config events.
 */
export default function ConfigPanel() {
    const [tab, setTab] = useState("orbital");
    const { open, setOpen, config, setConfig, status } = useConfigPanelState();
    const change = (section, key, value) => {
        setConfig((current) => ({ ...current, [section]: { ...current[section], [key]: value } }));
        window.dispatchEvent(new CustomEvent("orbit:config-panel-action", { detail: { type: "change", section, key, value } }));
    };
    const action = (type) => window.dispatchEvent(new CustomEvent("orbit:config-panel-action", { detail: { type } }));
    const activeSections = tabs.find(([id]) => id === tab)?.[2] || [];

    if (!open) return null;

    return <div id="configModal" className="open pointer-events-none fixed inset-0 z-[10160]">
        <aside
            id="configPanel"
            className="pointer-events-auto fixed top-[86px] right-[14px] bottom-[132px] z-[1] flex min-h-[300px] w-[min(344px,calc(100vw-28px))] flex-col overflow-hidden rounded-[10px] border border-[rgba(65,99,147,.58)] bg-[linear-gradient(145deg,rgba(12,25,42,.985),rgba(5,14,25,.985))] font-[system-ui] text-[#dbe7fa] shadow-[0_22px_60px_rgba(0,0,0,.46),inset_0_1px_rgba(255,255,255,.045)] max-[760px]:top-20 max-[760px]:right-2.5 max-[760px]:bottom-[74px] max-[760px]:w-[min(350px,calc(100vw-20px))]"
            aria-label="Ajustes de la aplicación"
        >
            <header id="configPanelHeader" className="relative shrink-0 border-b border-[#1c2c43] px-4 pt-4">
                <PanelCloseButton className="absolute top-[14px] right-[15px]" onClick={() => setOpen(false)} />
                <div className="max-w-[calc(100%_-_32px)]">
                    <div className="flex items-center gap-2">
                        <h2 className="m-0 text-[17px] leading-[1.2] font-medium text-[#f1f6ff]">AJUSTES</h2>
                        <span className="inline-flex items-center gap-1 rounded-[5px] bg-[rgba(68,118,255,.16)] px-1.5 py-1 text-[9px] leading-none font-bold tracking-[.06em] text-[#a9c4ff]"><SettingsGlyph />TIEMPO REAL</span>
                    </div>
                    <p className="mt-1.5 mb-0 text-[11px] leading-[1.4] text-[#8fa1ba]">Los cambios se aplican al instante y se guardan automáticamente.</p>
                    <div className="mt-2.5 mb-3 flex items-center gap-1.5 text-[10px] leading-none font-semibold tracking-[.015em] text-[#aebed5]" aria-live="polite">
                        <span className={classNames("size-1.5 shrink-0 rounded-full", statusColors[status?.state] || statusColors.idle)} />
                        <span className="truncate">{statusText(status)}</span>
                    </div>
                </div>

                <nav className="-mx-1 grid grid-cols-4" aria-label="Secciones de ajustes" role="tablist">
                    {tabs.map(([id, label]) => <button
                        className={classNames(
                            "relative min-h-[38px] cursor-pointer border-0 bg-transparent px-1 pt-2 pb-2.5 text-[9px] leading-[1.05] font-bold tracking-[.025em] text-[#8d9bb1] hover:text-[#cddcf2] focus-visible:z-[1] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#5c83ff]",
                            tab === id && "text-[#eaf1ff] after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-0.5 after:bg-[#4476ff] after:shadow-[0_0_8px_#4476ff] after:content-['']"
                        )}
                        type="button"
                        key={id}
                        role="tab"
                        aria-selected={tab === id}
                        aria-controls={`config-panel-${id}`}
                        onClick={() => setTab(id)}
                    >
                        {String(label).toUpperCase()}
                    </button>)}
                </nav>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [scrollbar-color:#304461_#08111e] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-[#08111e] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#304461]">
                <div id={`config-panel-${tab}`} role="tabpanel" className="grid gap-3">
                    {activeSections.map((section) => <section className="rounded-[8px] border border-[#203653] bg-[rgba(11,24,41,.78)] p-2.5 shadow-[inset_0_1px_rgba(255,255,255,.025)]" key={section}>
                        <h3 className="mt-0 mr-0 mb-2.5 ml-0 text-[10px] leading-none font-bold tracking-[.055em] text-[#a9c4ff] uppercase">{titles[section]}</h3>
                        <div className="grid grid-cols-1 gap-2.5">
                            {sections[section].map((field) => <ConfigField key={field} section={section} field={field} value={config[section]?.[field]} onChange={change} />)}
                        </div>
                    </section>)}
                </div>
            </div>

            <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-[#1c2c43] px-4 py-3">
                <button className="min-h-9 min-w-0 cursor-pointer rounded-[7px] border border-[rgba(139,78,105,.56)] bg-[rgba(59,24,40,.42)] px-2 py-2 text-[10px] leading-none font-bold text-[#f0c2d5] hover:border-[rgba(204,111,153,.76)] hover:bg-[rgba(85,35,58,.52)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#e980a7]" type="button" onClick={() => action("reset")}>Restaurar</button>
                <button className="min-h-9 min-w-0 cursor-pointer rounded-[7px] border border-[#3552d4] bg-[#4057dc] px-2 py-2 text-[10px] leading-none font-bold text-white shadow-[0_7px_16px_rgba(58,84,220,.26)] hover:bg-[#5067e9] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#8da7ff]" type="button" onClick={() => action("apply-global")}>Aplicar globalmente</button>
            </footer>
        </aside>
    </div>;
}
