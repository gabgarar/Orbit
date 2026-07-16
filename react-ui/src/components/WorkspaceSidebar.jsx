import { useEffect, useState } from "react";
import { EyeIcon, HomeIcon, PlusIcon, SatelliteIcon, SearchIcon, SlidersIcon, TelemetryIcon } from "./icons.jsx";

function ProjectTimeFooter() {
    const [context, setContext] = useState({ date: new Date(), mode: "realtime" });
    useEffect(() => {
        const onTimeContext = (event) => {
            const nextDate = new Date(event.detail?.date || Date.now());
            setContext({ date: Number.isNaN(nextDate.getTime()) ? new Date() : nextDate, mode: event.detail?.mode || "realtime" });
        };
        window.addEventListener("orbit:time-context", onTimeContext);
        return () => window.removeEventListener("orbit:time-context", onTimeContext);
    }, []);
    const isRealtime = context.mode === "realtime";
    return <footer className="react-project-time"><span className="react-project-time-icon" aria-hidden="true">▣</span><div><small>{context.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</small><strong>{context.date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} UTC</strong></div><span className={`react-project-time-status${isRealtime ? "" : " is-simulated"}`}><i />{isRealtime ? "Real-time" : "Simulated"}</span></footer>;
}

export default function WorkspaceSidebar() {
    const [openPanel, setOpenPanel] = useState(null);
    const togglePanel = (panel) => setOpenPanel((current) => current === panel ? null : panel);

    return <>
        <aside id="leftSidebar" className="react-sidebar" aria-label="Paneles del visor">
            <button id="leftSatellitesBtn" className={`sidebar-btn${openPanel === "layers" ? " active" : ""}`} type="button" title="Satélites" onClick={() => togglePanel("layers")}><SatelliteIcon /></button>
            <button id="leftInfoBtn" className={`sidebar-btn${openPanel === "telemetry" ? " active" : ""}`} type="button" title="Telemetría" onClick={() => togglePanel("telemetry")}><TelemetryIcon /></button>
            <div className="sidebar-spacer" />
            <button className="sidebar-btn" type="button" title="Vista inicial" onClick={() => document.querySelector(".cesium-home-button")?.click()}><HomeIcon /></button>
        </aside>
        <aside id="leftSatellitesPanel" className={`sidebar-panel${openPanel === "layers" ? " open" : ""}`}>
            <div className="sidebar-panel-header react-layers-header"><div className="react-layers-heading">LAYERS</div><div className="sidebar-panel-actions"><button className="object-global-eye-btn react-vector-action" id="toggleAllVisibilityBtn" type="button" title="Ocultar todas las capas"><EyeIcon /></button><button className="object-global-remove-btn" id="removeAllLayersHeaderBtn" type="button" title="Quitar todas las capas">×</button><button className="object-add-btn react-vector-action" id="openCatalogBtn" type="button" title="Añadir capa"><PlusIcon /></button></div></div>
            <div className="react-layers-search" role="search"><SearchIcon /><span>Search layers...</span><button className="react-vector-action" type="button" aria-label="Filtros de capas"><SlidersIcon /></button></div>
            <div className="react-project-section">MY PROJECT</div>
            <div id="leftSatellitesPanelContent" className="sidebar-panel-content" />
            <ProjectTimeFooter />
            <div className="sidebar-panel-resize-handle" role="separator" aria-orientation="vertical" aria-label="Redimensionar panel de capas" />
        </aside>
        <aside id="leftInfoPanel" className={`sidebar-panel${openPanel === "telemetry" ? " open" : ""}`}>
            <div className="sidebar-panel-header telemetry-panel-header"><div><div className="sidebar-panel-title">TELEMETRÍA</div><div className="telemetry-panel-subtitle"><span aria-hidden="true" />DATOS EN TIEMPO REAL</div></div></div>
            <div id="leftInfoPanelContent" className="sidebar-panel-content" />
            <div className="sidebar-panel-resize-handle" role="separator" aria-orientation="vertical" aria-label="Redimensionar panel de telemetría" />
        </aside>
    </>;
}
