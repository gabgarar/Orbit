import { useEffect, useState } from "react";
import { CalendarIcon, EyeIcon, EyeOffIcon, ManualOrbitIcon, PlusIcon, PropagatedParametersIcon, SatelliteIcon, SearchIcon, SlidersIcon, TrashIcon } from "./icons.jsx";
import CameraControls from "../features/camera/CameraControls.jsx";
import { getLayerActionsState, LAYER_ACTIONS_STATE_EVENT } from "../../../front/js/runtime/layerActionsState.js";
import { emitPropagatedParametersClose, emitPropagatedParametersOpen } from "../../../front/js/runtime/propagatedParametersEvents.js";

function publishLayersPanelState(open) {
    window.dispatchEvent(new CustomEvent("orbit:layers-panel-state", { detail: { open } }));
}

function ProjectTimeFooter() {
    const [context, setContext] = useState({ date: new Date(), mode: "realtime" });
    const [designMode, setDesignMode] = useState(false);
    useEffect(() => {
        const onTimeContext = (event) => {
            const nextDate = new Date(event.detail?.date || Date.now());
            setContext({ date: Number.isNaN(nextDate.getTime()) ? new Date() : nextDate, mode: event.detail?.mode || "realtime", isPlaying: event.detail?.isPlaying !== false, oemDomainActive: event.detail?.oemDomainActive === true });
        };
        window.addEventListener("orbit:time-context", onTimeContext);
        return () => window.removeEventListener("orbit:time-context", onTimeContext);
    }, []);
    useEffect(() => {
        const onDesignMode = (event) => setDesignMode(event.detail?.active === true);
        window.addEventListener("orbit:manual-orbit-design-state", onDesignMode);
        return () => window.removeEventListener("orbit:manual-orbit-design-state", onDesignMode);
    }, []);
    const isRealtime = context.mode === "realtime";
    const isRealtimePaused = isRealtime && context.isPlaying === false;
    // The design panel owns its two explicit epochs. Keeping the project
    // clock visible here would make the isolated scene look like realtime is
    // still active, and it consumes useful space in the Layers panel.
    if (designMode) return null;
    return <footer id="projectTimeFooter" className="grid min-h-[74px] grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-[#17283d] px-1 pt-[11px] pb-[13px] mx-[14px] font-[system-ui,sans-serif] text-[#dbe6f8]">
        <span className="grid size-[30px] place-items-center border-r border-[#203148] text-[#b9c9df] [&>svg]:size-[19px] [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.7]" aria-hidden="true"><CalendarIcon /></span>
        <div className="grid gap-1">
            <small className="text-[11px] leading-none font-semibold text-[#aab8cf]">{context.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</small>
            <strong className="text-[16px] leading-none font-medium tracking-[.02em] text-[#f2f6ff]">{context.date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} UTC</strong>
        </div>
        <span className="inline-flex items-center gap-[7px] whitespace-nowrap text-[11px] leading-none font-semibold text-[#bed0e8]" aria-live="polite"><i className={`size-[7px] rounded-full ${isRealtimePaused ? "bg-[#f0ae45] shadow-[0_0_8px_rgba(240,174,69,.65)]" : (isRealtime ? "bg-[#46d481] shadow-[0_0_8px_rgba(70,212,129,.65)]" : "bg-[#f0ae45] shadow-[0_0_8px_rgba(240,174,69,.65)]")}`} />{isRealtimePaused ? "Paused" : (isRealtime ? "Real time" : `Simulated (${context.oemDomainActive ? "OEM" : "Manual range"})`)}</span>
    </footer>;
}

export default function WorkspaceSidebar() {
    const [openPanel, setOpenPanel] = useState(true);
    const [projectName, setProjectName] = useState("MY PROJECT");
    const [searchMenuOpen, setSearchMenuOpen] = useState(false);
    const [searchOptions, setSearchOptions] = useState({ matchCase: false, wholeWord: false, regex: false });
    const [allLayersVisible, setAllLayersVisible] = useState(true);
    const [hasActiveLayers, setHasActiveLayers] = useState(() => getLayerActionsState().hasActiveLayers);
    const [manualOrbitOpen, setManualOrbitOpen] = useState(false);
    const [designMode, setDesignMode] = useState(false);
    const [selectedInspectableLayer, setSelectedInspectableLayer] = useState(null);
    const [propagatedParametersOpen, setPropagatedParametersOpen] = useState(false);
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
    useEffect(() => {
        const onVisibilityState = (event) => {
            if (typeof event.detail === "boolean") setAllLayersVisible(event.detail);
        };
        window.addEventListener("orbit:layers-visibility-state", onVisibilityState);
        return () => window.removeEventListener("orbit:layers-visibility-state", onVisibilityState);
    }, []);
    useEffect(() => {
        const onLayerActionsState = (event) => {
            const next = event.detail?.hasActiveLayers === true;
            setHasActiveLayers((current) => current === next ? current : next);
        };
        window.addEventListener(LAYER_ACTIONS_STATE_EVENT, onLayerActionsState);
        // The legacy runtime may render the tree between React's first render
        // and this effect. Re-read the cached state after subscribing.
        onLayerActionsState({ detail: getLayerActionsState() });
        return () => window.removeEventListener(LAYER_ACTIONS_STATE_EVENT, onLayerActionsState);
    }, []);
    useEffect(() => {
        const onManualOrbitPanelState = (event) => {
            if (typeof event.detail?.open === "boolean") setManualOrbitOpen(event.detail.open);
        };
        window.addEventListener("orbit:manual-orbit-panel-state", onManualOrbitPanelState);
        return () => window.removeEventListener("orbit:manual-orbit-panel-state", onManualOrbitPanelState);
    }, []);
    useEffect(() => {
        const onDesignMode = (event) => setDesignMode(event.detail?.active === true);
        window.addEventListener("orbit:manual-orbit-design-state", onDesignMode);
        return () => window.removeEventListener("orbit:manual-orbit-design-state", onDesignMode);
    }, []);
    useEffect(() => {
        const onSelection = (event) => {
            const detail = event.detail || {};
            const id = String(detail.id || "").trim();
            const isOrbitalLayer = String(detail.layerType || "SATELLITE").toUpperCase() === "SATELLITE";
            setSelectedInspectableLayer(detail.active === true && isOrbitalLayer && id ? { id } : null);
        };
        window.addEventListener("orbit:selected-layer-state", onSelection);
        window.dispatchEvent(new Event("orbit:selected-layer-state-request"));
        return () => window.removeEventListener("orbit:selected-layer-state", onSelection);
    }, []);
    useEffect(() => {
        const onPanelState = (event) => {
            if (typeof event.detail?.open === "boolean") setPropagatedParametersOpen(event.detail.open);
        };
        window.addEventListener("orbit:propagated-parameters-panel-state", onPanelState);
        return () => window.removeEventListener("orbit:propagated-parameters-panel-state", onPanelState);
    }, []);
    useEffect(() => {
        if (designMode) setSearchMenuOpen(false);
    }, [designMode]);
    const togglePanel = () => {
        const next = !openPanel;
        setOpenPanel(next);
        publishLayersPanelState(next);
    };
    const visibilityTitle = allLayersVisible ? "Ocultar todas las capas" : "Mostrar todas las capas";
    // The manual designer is a valid orbital target even though it does not
    // appear in the layer tree while it is being authored.
    const propagatedParametersAvailable = designMode || Boolean(selectedInspectableLayer?.id);
    const propagatedParametersTitle = propagatedParametersAvailable
        ? (propagatedParametersOpen ? "Ocultar parÃ¡metros orbitales propagados" : "Ver parÃ¡metros orbitales propagados")
        : "Selecciona una capa orbital activa para ver sus parÃ¡metros propagados";
    const togglePropagatedParameters = () => {
        if (!propagatedParametersAvailable) return;
        if (designMode) {
            window.dispatchEvent(new Event("orbit:manual-orbit-propagated-parameters-request"));
            return;
        }
        if (propagatedParametersOpen) {
            emitPropagatedParametersClose({ source: "sidebar" });
            return;
        }
        emitPropagatedParametersOpen({ id: selectedInspectableLayer.id, source: "sidebar" });
    };
    const toggleSearchOption = (option) => {
        setSearchOptions((current) => {
            const next = { ...current, [option]: !current[option] };
            window.dispatchEvent(new CustomEvent("orbit:layer-search-options", { detail: next }));
            return next;
        });
    };
    return <>
        <aside id="leftSidebar" aria-label="Paneles del visor">
            <button id="leftSatellitesBtn" className={`sidebar-btn${openPanel ? " active" : ""}`} type="button" title="Capas y satelites" aria-label="Capas y satelites" onClick={togglePanel}><SatelliteIcon /></button>
            <button id="leftManualOrbitBtn" className={`sidebar-btn${manualOrbitOpen ? " active" : ""}`} type="button" title={"Crear \u00f3rbita manual"} aria-label={"Crear \u00f3rbita manual"} aria-expanded={manualOrbitOpen} onClick={() => window.dispatchEvent(new CustomEvent("orbit:manual-orbit-toggle", { detail: { open: !manualOrbitOpen } }))}><ManualOrbitIcon /></button>
            <button id="leftPropagatedParametersBtn" className={`sidebar-btn${propagatedParametersOpen ? " active" : ""} disabled:!cursor-not-allowed disabled:!opacity-40`} type="button" title={propagatedParametersTitle} aria-label={propagatedParametersTitle} aria-expanded={propagatedParametersOpen} disabled={!propagatedParametersAvailable} onClick={togglePropagatedParameters}><PropagatedParametersIcon /></button>
            <div className="sidebar-spacer" />
            <CameraControls />
        </aside>
        <aside id="leftSatellitesPanel" className={`sidebar-panel${openPanel ? " open" : ""}`}>
            <div className="sidebar-panel-header orbit-layers-panel-header after:!hidden max-[620px]:!min-h-[62px] max-[620px]:!p-[14px]">
                <div className="orbit-layers-heading">LAYERS</div>
            </div>
            <div className="orbit-project-header mx-[14px] mb-2 flex min-h-[41px] items-center justify-between gap-2 border-t border-[#172334] pt-[7px]">
                <div className="orbit-project-title min-w-0 -translate-y-px truncate font-[system-ui,sans-serif] text-[11px] leading-none font-bold tracking-[.1em] text-[#c3d0e5]" data-project-title title={projectName}>{projectName}</div>
                <div className="sidebar-panel-actions orbit-project-actions shrink-0 !gap-[6px]">
                    <button className="object-global-eye-btn inline-flex !size-[33px] !cursor-pointer !items-center !justify-center !rounded-[7px] !border !border-[#17263c] !bg-[#0c1522] !text-[#c9d6ec] hover:!border-[#4168a3] hover:!bg-[#14243d] hover:!text-[#edf4ff] disabled:!cursor-not-allowed disabled:!opacity-45 [&>svg]:size-4 [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.8]" id="toggleAllVisibilityBtn" data-react-visibility-toggle="true" type="button" title={designMode ? "Las capas se restaurarán al salir del diseño orbital" : visibilityTitle} aria-label={visibilityTitle} aria-pressed={allLayersVisible} disabled={designMode} hidden={!hasActiveLayers}>
                        {allLayersVisible ? <EyeIcon /> : <EyeOffIcon />}
                    </button>
                    <button className="object-global-remove-btn inline-flex !size-[33px] !cursor-pointer !items-center !justify-center !rounded-[7px] !border !border-[#542637] !bg-[#1c111a] !p-0 !text-[#f1a8b6] hover:!border-[#d15c74] hover:!bg-[#371421] hover:!text-[#ffe3e8] disabled:!cursor-not-allowed disabled:!opacity-45 [&>svg]:size-4 [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.8]" id="removeAllLayersHeaderBtn" type="button" title={designMode ? "Las capas no se pueden eliminar durante el diseño orbital" : "Quitar todas las capas"} aria-label="Quitar todas las capas" disabled={designMode} hidden={!hasActiveLayers}><TrashIcon /></button>
                    <button className="object-add-btn !inline-flex !size-[33px] !cursor-pointer !items-center !justify-center !rounded-[7px] !border !border-[#4167ff] !bg-[#3d5cf4] !text-[25px] !text-white !shadow-[0_6px_14px_rgba(54,84,238,.3)] disabled:!cursor-not-allowed disabled:!opacity-45 [&>svg]:size-4 [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.8]" id="openCatalogBtn" type="button" title={designMode ? "El catálogo se bloquea durante el diseño orbital" : "Anadir capa"} disabled={designMode}><PlusIcon /></button>
                </div>
            </div>
            <div className="mt-[8px] grid h-[38px] grid-cols-[36px_minmax(0,1fr)_42px] items-center rounded-lg border border-[#1a2a47] bg-[#0a1221] mx-[14px] mb-[12px] font-[system-ui,sans-serif] text-sm leading-none font-medium text-[#a5b2c9] [&>svg]:m-auto [&>svg]:size-[18px] [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-width:1.8]" role="search">
                <SearchIcon />
                <input id="objectSearch" className="!box-border !h-full !w-full !min-w-0 !appearance-none !rounded-none !border-0 !bg-transparent !p-0 !font-[system-ui,sans-serif] !text-sm !leading-none !font-medium !text-[#dce8fa] !shadow-none !outline-none placeholder:!text-[#8a98ad] disabled:!cursor-not-allowed disabled:!opacity-45" type="search" placeholder="Search layers..." aria-label="Buscar capas" disabled={designMode} />
                <div className="relative h-full">
                    <button className={`!size-full !cursor-pointer !border-0 !border-l !border-[#1a2a47] !bg-transparent !p-0 !text-[#b9c8df] hover:!bg-[#13213a] hover:!text-[#e2ebfa] disabled:!cursor-not-allowed disabled:!opacity-45 [&>svg]:size-4 [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.8]${searchMenuOpen ? " !bg-[#13213a] !text-[#e2ebfa]" : ""}`} type="button" aria-label="Opciones de busqueda" aria-expanded={searchMenuOpen} disabled={designMode} onClick={() => setSearchMenuOpen((open) => !open)}><SlidersIcon /></button>
                    {searchMenuOpen && <div className="absolute top-[calc(100%+6px)] right-0 z-[10220] grid w-[190px] gap-[3px] rounded-lg border border-[#315178] bg-[#0c1728] p-[5px] shadow-[0_12px_28px_rgba(0,0,0,.45)]" role="menu">
                        <button className={`flex w-full cursor-pointer items-center gap-[9px] rounded-[5px] border-0 bg-transparent p-2 text-left font-[system-ui,sans-serif] text-[11px] leading-none font-semibold text-[#bdcbe0] hover:bg-[#193057] hover:text-[#eaf1ff]${searchOptions.matchCase ? " bg-[#193057] text-[#eaf1ff]" : ""}`} type="button" role="menuitemcheckbox" aria-checked={searchOptions.matchCase} onClick={() => toggleSearchOption("matchCase")}><b className="grid min-w-[22px] place-items-center text-[11px] text-[#8cadff]">Aa</b> Match case</button>
                        <button className={`flex w-full cursor-pointer items-center gap-[9px] rounded-[5px] border-0 bg-transparent p-2 text-left font-[system-ui,sans-serif] text-[11px] leading-none font-semibold text-[#bdcbe0] hover:bg-[#193057] hover:text-[#eaf1ff]${searchOptions.wholeWord ? " bg-[#193057] text-[#eaf1ff]" : ""}`} type="button" role="menuitemcheckbox" aria-checked={searchOptions.wholeWord} onClick={() => toggleSearchOption("wholeWord")}><b className="grid min-w-[22px] place-items-center text-[11px] text-[#8cadff]">ab</b> Whole word</button>
                        <button className={`flex w-full cursor-pointer items-center gap-[9px] rounded-[5px] border-0 bg-transparent p-2 text-left font-[system-ui,sans-serif] text-[11px] leading-none font-semibold text-[#bdcbe0] hover:bg-[#193057] hover:text-[#eaf1ff]${searchOptions.regex ? " bg-[#193057] text-[#eaf1ff]" : ""}`} type="button" role="menuitemcheckbox" aria-checked={searchOptions.regex} onClick={() => toggleSearchOption("regex")}><b className="grid min-w-[22px] place-items-center text-[11px] text-[#8cadff]">.*</b> Use regular expression</button>
                    </div>}
                </div>
            </div>
            <div id="leftSatellitesPanelContent" className={`sidebar-panel-content${designMode ? " pointer-events-none select-none opacity-50" : ""}`} aria-disabled={designMode} />
            <ProjectTimeFooter />
            <div className="sidebar-panel-resize-handle" role="separator" aria-orientation="vertical" aria-label="Redimensionar panel de capas" />
        </aside>
        <div id="legacyHiddenInfo" hidden />
    </>;
}
