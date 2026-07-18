import { useEffect, useState } from "react";
import { CalendarIcon, EyeIcon, HomeIcon, PlusIcon, SatelliteIcon, SearchIcon, SlidersIcon } from "./icons.jsx";
import LayerTree from "./LayerTree.jsx";

function publishLayersPanelState(open) {
    window.dispatchEvent(new CustomEvent("orbit:layers-panel-state", { detail: { open } }));
}

function ProjectTimeFooter() {
    const [context, setContext] = useState({ date: new Date(), mode: "realtime" });
    useEffect(() => {
        const onTimeContext = (event) => {
            const nextDate = new Date(event.detail?.date || Date.now());
            setContext({ date: Number.isNaN(nextDate.getTime()) ? new Date() : nextDate, mode: event.detail?.mode || "realtime", oemDomainActive: event.detail?.oemDomainActive === true });
        };
        window.addEventListener("orbit:time-context", onTimeContext);
        return () => window.removeEventListener("orbit:time-context", onTimeContext);
    }, []);
    const isRealtime = context.mode === "realtime";
    return <footer className="react-project-time"><span className="react-project-time-icon" aria-hidden="true"><CalendarIcon /></span><div><small>{context.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</small><strong>{context.date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} UTC</strong></div><span className={`react-project-time-status${isRealtime ? "" : " is-simulated"}`}><i />{isRealtime ? "Real time" : `Simulated (${context.oemDomainActive ? "OEM" : "Manual range"})`}</span></footer>;
}

export default function WorkspaceSidebar() {
    const [openPanel, setOpenPanel] = useState(true);
    const [projectName, setProjectName] = useState("MY PROJECT");
    const [searchMenuOpen, setSearchMenuOpen] = useState(false);
    const [searchOptions, setSearchOptions] = useState({ matchCase: false, wholeWord: false, regex: false });
    useEffect(() => {
        const onProjectTitle = (event) => setProjectName(String(event.detail || "MY PROJECT").toUpperCase());
        window.addEventListener("orbit:project-title", onProjectTitle);
        return () => window.removeEventListener("orbit:project-title", onProjectTitle);
    }, []);
    useEffect(() => {
        const onLayersPanelCollapse = () => setOpenPanel(false);
        window.addEventListener("orbit:layers-panel-collapse", onLayersPanelCollapse);
        return () => window.removeEventListener("orbit:layers-panel-collapse", onLayersPanelCollapse);
    }, []);
    useEffect(() => {
        const onLayersPanelState = (event) => {
            if (typeof event.detail?.open === "boolean") setOpenPanel(event.detail.open);
        };
        window.addEventListener("orbit:layers-panel-state", onLayersPanelState);
        return () => window.removeEventListener("orbit:layers-panel-state", onLayersPanelState);
    }, []);
    const togglePanel = () => {
        const next = !openPanel;
        setOpenPanel(next);
        publishLayersPanelState(next);
    };
    const toggleSearchOption = (option) => {
        setSearchOptions((current) => {
            const next = { ...current, [option]: !current[option] };
            window.dispatchEvent(new CustomEvent("orbit:layer-search-options", { detail: next }));
            return next;
        });
    };
    return <>
        <aside id="leftSidebar" className="react-sidebar" aria-label="Paneles del visor">
            <button id="leftSatellitesBtn" className={`sidebar-btn${openPanel ? " active" : ""}`} type="button" title="Satelites" onClick={togglePanel}><SatelliteIcon /></button>
            <div className="sidebar-spacer" />
            <button className="sidebar-btn" type="button" title="Vista inicial" onClick={() => document.querySelector(".cesium-home-button")?.click()}><HomeIcon /></button>
        </aside>
        <aside id="leftSatellitesPanel" className={`sidebar-panel${openPanel ? " open" : ""}`}>
            <div className="sidebar-panel-header react-layers-header"><div className="react-layers-heading">LAYERS</div><div className="sidebar-panel-actions"><button className="object-global-eye-btn react-vector-action" id="toggleAllVisibilityBtn" type="button" title="Ocultar todas las capas"><EyeIcon /></button><button className="object-global-remove-btn" id="removeAllLayersHeaderBtn" type="button" title="Quitar todas las capas">&#215;</button><button className="object-add-btn react-vector-action" id="openCatalogBtn" type="button" title="Anadir capa"><PlusIcon /></button></div></div>
            <div className="react-layers-search" role="search"><SearchIcon /><input id="objectSearch" type="search" placeholder="Search layers..." aria-label="Buscar capas" /><div className="react-layer-search-options"><button className={`react-vector-action${searchMenuOpen ? " active" : ""}`} type="button" aria-label="Opciones de busqueda" aria-expanded={searchMenuOpen} onClick={() => setSearchMenuOpen((open) => !open)}><SlidersIcon /></button>{searchMenuOpen && <div className="react-layer-search-menu" role="menu"><button className={searchOptions.matchCase ? "active" : ""} type="button" role="menuitemcheckbox" aria-checked={searchOptions.matchCase} onClick={() => toggleSearchOption("matchCase")}><b>Aa</b> Match case</button><button className={searchOptions.wholeWord ? "active" : ""} type="button" role="menuitemcheckbox" aria-checked={searchOptions.wholeWord} onClick={() => toggleSearchOption("wholeWord")}><b>ab</b> Whole word</button><button className={searchOptions.regex ? "active" : ""} type="button" role="menuitemcheckbox" aria-checked={searchOptions.regex} onClick={() => toggleSearchOption("regex")}><b>.*</b> Use regular expression</button></div>}</div></div>
            <div className="react-project-section" data-project-title>{projectName}</div>
            <LayerTree />
            <div id="leftSatellitesPanelContent" className="sidebar-panel-content" />
            <ProjectTimeFooter />
            <div className="sidebar-panel-resize-handle" role="separator" aria-orientation="vertical" aria-label="Redimensionar panel de capas" />
        </aside>
        <div id="legacyHiddenInfo" hidden />
    </>;
}
