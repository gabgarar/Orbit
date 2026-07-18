import { useState } from "react";
import ConfigField from "../features/config/ConfigField.jsx";
import { sections, tabs, titles } from "../features/config/configSchema.js";
import useConfigPanelState from "../hooks/useConfigPanelState.js";

export default function ConfigPanel() {
    const [tab, setTab] = useState("orbital");
    const { open, setOpen, config, setConfig, status } = useConfigPanelState();
    const change = (section, key, value) => { setConfig((current) => ({ ...current, [section]: { ...current[section], [key]: value } })); window.dispatchEvent(new CustomEvent("orbit:config-panel-action", { detail: { type: "change", section, key, value } })); };
    const action = (type) => window.dispatchEvent(new CustomEvent("orbit:config-panel-action", { detail: { type } }));
    const activeSections = tabs.find(([id]) => id === tab)?.[2] || [];
    if (!open) return null;
    return <div id="configModal" className="open" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}><section id="configPanel" role="dialog" aria-modal="true" aria-label="Configuración"><header id="configPanelHeader"><h3>Configuración en tiempo real</h3><div className="config-header-actions"><button className="config-apply-global-btn" type="button" onClick={() => action("apply-global")}>Aplicar globalmente</button><button className="config-reset-btn" type="button" onClick={() => action("reset")}>Restaurar valores</button><button className="config-close-btn" type="button" onClick={() => setOpen(false)} aria-label="Cerrar">&#215;</button></div></header><p id="configHint">Los cambios se aplican al instante y se guardan automáticamente.</p><p id="configSaveStatus" className={`config-save-status ${status.state}`}>{status.message}</p><nav className="config-tabs" aria-label="Secciones de configuración">{tabs.map(([id, label]) => <button className={`config-tab-btn${tab === id ? " active" : ""}`} type="button" key={id} onClick={() => setTab(id)}>{label}</button>)}</nav><div className="config-tab-panels">{activeSections.map((section) => <section className="config-section" key={section}><h4 className="config-section-title">{titles[section]}</h4><div className="config-grid">{sections[section].map((field) => <ConfigField key={field} section={section} field={field} value={config[section]?.[field]} onChange={change} />)}</div></section>)}</div></section></div>;
}
