import { useEffect, useRef, useState } from "react";
import { CalendarIcon, ChevronDownIcon, EyeIcon, EyeOffIcon, FolderIcon, GroundStationIcon, ManualOrbitIcon, PassTableIcon, PlusIcon, PropagatedParametersIcon, SatelliteIcon, SearchIcon, SlidersIcon, TrashIcon } from "./icons.jsx";
import CameraControls from "../features/camera/CameraControls.jsx";
import { getLayerActionsState, LAYER_ACTIONS_STATE_EVENT } from "../../../front/js/runtime/layerActionsState.js";
import { emitPropagatedParametersClose, emitPropagatedParametersOpen } from "../../../front/js/runtime/propagatedParametersEvents.js";
import { openGroundStationExportMenu } from "./GroundStationExportMenu.jsx";

function publishLayersPanelState(open) {
    window.dispatchEvent(new CustomEvent("orbit:layers-panel-state", { detail: { open } }));
}

function isManualOrbitDesignActive() {
    return window.__orbitManualOrbitDesignActive === true
        || document.documentElement.dataset.manualOrbitDesign === "true";
}

function isManualOrbitPanelOpen() {
    return window.__orbitManualOrbitState?.open === true;
}

const PROJECT_ACTIONS = [
    { action: "new", label: "Nuevo proyecto", description: "Crea un espacio de trabajo vacío" },
    { action: "open", label: "Importar proyecto", description: "Abre un archivo .json de Orbit" },
    { action: "import-ground-stations", label: "Importar estaciones", description: "Añade GeoJSON, Orbit JSON o CSV" },
    { action: "save", label: "Guardar proyecto", description: "Guarda los cambios del proyecto" },
    { action: "export", label: "Exportar proyecto", description: "Descarga una copia .json" },
    { action: "export-ground-stations", label: "Exportar estaciones", description: "Elige GeoJSON, Orbit JSON o CSV" }
];

function ProjectActionsMenu({ source, left, top, onSelect }) {
    const isContextMenu = source === "context";
    return <div
        id="projectActionsMenu"
        data-project-actions-menu="true"
        data-project-actions-source={source}
        className={`${isContextMenu ? "fixed" : "absolute right-0 top-[calc(100%+7px)]"} z-[10260] grid w-[228px] gap-[3px] rounded-[9px] border border-[#35557e] bg-[linear-gradient(145deg,rgba(13,26,45,.98),rgba(7,15,28,.98))] p-[5px] font-[system-ui,sans-serif] shadow-[0_16px_32px_rgba(0,0,0,.46)] backdrop-blur-md`}
        style={isContextMenu ? { left: `${left}px`, top: `${top}px` } : undefined}
        role="menu"
        aria-label="Acciones de proyecto"
        onPointerDown={(event) => event.stopPropagation()}
    >
        <div className="flex items-center gap-[7px] border-b border-[#233b5b] px-[7px] py-[6px] text-[#a9bfdd]">
            <span className="grid size-[17px] place-items-center text-[#83a6ff] [&>svg]:size-[15px] [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.8]" aria-hidden="true"><FolderIcon /></span>
            <span className="text-[9px] leading-none font-bold tracking-[.14em]">PROYECTO</span>
        </div>
        {PROJECT_ACTIONS.map(({ action, label, description }) => <button
            className={`grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_14px] items-center gap-2 rounded-[6px] border-0 bg-transparent px-[8px] py-[7px] text-left font-[system-ui,sans-serif] transition-colors hover:bg-[#173157] focus-visible:bg-[#173157] focus-visible:outline-none${action === "export" ? " mt-[2px] border-t border-[#233b5b] pt-[9px]" : ""}`}
            data-project-action={action}
            type="button"
            role="menuitem"
            key={action}
            onClick={(event) => onSelect(action, event)}
        >
            <span className="grid min-w-0 gap-[3px]">
                <span className="text-[11px] leading-none font-semibold text-[#e0eafe]">{label}</span>
                <span className="truncate text-[9px] leading-none font-medium text-[#8fa7c8]">{description}</span>
            </span>
            <span className="text-right text-[14px] leading-none text-[#7295c9]" aria-hidden="true">&#8250;</span>
        </button>)}
    </div>;
}

function ProjectTimeFooter() {
    const [context, setContext] = useState({ date: new Date(), mode: "realtime", isPlaying: true });
    const [designMode, setDesignMode] = useState(isManualOrbitDesignActive);
    const [modeMenuOpen, setModeMenuOpen] = useState(false);
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

    const isStatic = context.mode === "static";
    const isPausedRealtime = context.mode === "realtime" && context.isPlaying === false;
    const selectedMode = context.mode === "range" ? "range" : (isStatic ? "static" : "realtime");
    const modePresentation = isPausedRealtime
        ? { label: "Paused", dot: "bg-[#f0ae45] shadow-[0_0_8px_rgba(240,174,69,.65)]" }
        : {
        static: { label: "Static", dot: "bg-[#f0ae45] shadow-[0_0_8px_rgba(240,174,69,.65)]" },
        realtime: { label: "Real time", dot: "bg-[#46d481] shadow-[0_0_8px_rgba(70,212,129,.65)]" },
        range: { label: "Simulated", dot: "bg-[#8e78ff] shadow-[0_0_8px_rgba(142,120,255,.62)]" }
    }[selectedMode];
    const selectMode = (mode) => {
        window.dispatchEvent(new CustomEvent("orbit:simulation-action", { detail: { type: "mode", value: mode } }));
        setModeMenuOpen(false);
    };

    // The design panel owns its two explicit epochs. Keeping the project
    // clock visible here would make the isolated scene look like realtime is
    // still active, and it consumes useful space in the Layers panel.
    if (designMode) return null;
    return <footer id="projectTimeFooter" className="project-time-footer relative flex min-h-[48px] items-center gap-[10px] border-t border-[#294467] px-[12px] py-[7px] mx-[14px] mb-0 font-[system-ui,sans-serif] text-[#dbe6f8]">
        <span className="project-time-footer__calendar grid size-[21px] shrink-0 place-items-center text-[#c5d6ef] [&>svg]:size-[15px] [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.7]" aria-hidden="true"><CalendarIcon /></span>
        <div className="project-time-footer__clock grid min-w-0 gap-[3px]">
            <small className="truncate text-[10px] leading-none font-semibold uppercase tracking-[.035em] text-[#9eafc8]">{context.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</small>
            <strong className="truncate font-mono text-[13px] leading-none font-semibold tracking-[.02em] text-[#f2f6ff] tabular-nums">{context.date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })} <span className="text-[#9db0cd]">UTC</span></strong>
        </div>
        <div className="relative ml-auto shrink-0">
            <button id="projectTimeModeBtn" className={`project-time-footer__mode inline-flex h-[28px] cursor-pointer items-center gap-[6px] rounded-[6px] border px-[7px] font-[system-ui,sans-serif] text-[10px] leading-none font-semibold whitespace-nowrap transition-colors focus-visible:outline-none ${modeMenuOpen ? "text-[#f2f6ff]" : "text-[#c8d8ed] hover:text-[#f2f6ff] focus-visible:text-[#f2f6ff]"}`} type="button" aria-label={modePresentation.label} aria-haspopup="menu" aria-expanded={modeMenuOpen} onClick={() => setModeMenuOpen((open) => !open)}>
                <i className={`size-[7px] shrink-0 rounded-full ${modePresentation.dot}`} aria-hidden="true" />
                <span aria-live="polite">{modePresentation.label}</span>
                <span className={`ml-px grid size-[13px] shrink-0 place-items-center text-[#a9beda] transition-transform ${modeMenuOpen ? "rotate-180" : ""}`} aria-hidden="true"><ChevronDownIcon /></span>
            </button>
            {modeMenuOpen && <div id="projectTimeModeMenu" className="absolute right-0 bottom-[calc(100%+6px)] z-[10230] grid min-w-[120px] gap-1 rounded-[7px] border border-[#315178] bg-[#0c1728] p-[4px] shadow-[0_12px_28px_rgba(0,0,0,.45)]" role="menu" aria-label="Modo temporal">
                {[{ value: "static", label: "Static" }, { value: "realtime", label: "Real time" }, { value: "range", label: "Simulated" }].map((option) => <button className={`orbit-time-mode-option cursor-pointer appearance-none rounded-[5px] border-0 bg-transparent px-[8px] py-[7px] text-left font-[system-ui,sans-serif] text-[10px] leading-none font-semibold text-[#c7d5e9]${selectedMode === option.value ? " is-selected" : ""}`} type="button" role="menuitemradio" aria-checked={selectedMode === option.value} key={option.value} onClick={() => selectMode(option.value)}>{option.label}</button>)}
            </div>}
        </div>
    </footer>;
}

function SessionRecordButton() {
    const [recording, setRecording] = useState(false);
    const [processing, setProcessing] = useState(false);
    useEffect(() => {
        const onRecordingState = (event) => {
            setRecording(event.detail === true || event.detail?.active === true);
            setProcessing(event.detail?.processing === true);
        };
        window.addEventListener("orbit:recording-state", onRecordingState);
        return () => window.removeEventListener("orbit:recording-state", onRecordingState);
    }, []);
    const label = processing ? "Procesando grabacion" : (recording ? "Detener grabacion" : "Grabar sesion");
    return <button id="leftRecordBtn" className={`sidebar-btn ${recording ? "!border !border-[#d2556b] !bg-[#351724]" : ""} ${processing ? "!border !border-[#5d7194] !bg-[#152238]" : ""}`} type="button" title={label} aria-label={label} aria-pressed={recording} disabled={processing} onClick={() => window.dispatchEvent(new CustomEvent("orbit:simulation-action", { detail: { type: "record-toggle" } }))}>
        <span className="sidebar-btn-icon" aria-hidden="true">{recording ? <span className="block size-[11px] rounded-[2px] bg-[#ff7185] shadow-[0_0_8px_rgba(255,87,109,.6)]" /> : <span className={`block size-[11px] rounded-full ${processing ? "bg-[#9dafc9] animate-pulse" : "bg-[#ff576d] shadow-[0_0_8px_rgba(255,87,109,.6)]"}`} />}</span>
        <span className="sidebar-btn-label" aria-hidden="true">{recording ? "Stop" : (processing ? "Saving" : "Record")}</span>
    </button>;
}

export default function WorkspaceSidebar() {
    const [openPanel, setOpenPanel] = useState(true);
    const [projectName, setProjectName] = useState("MY PROJECT");
    const [projectTreeExpanded, setProjectTreeExpanded] = useState(true);
    const [projectLayerCount, setProjectLayerCount] = useState(0);
    const [projectActionsMenu, setProjectActionsMenu] = useState(null);
    const [searchMenuOpen, setSearchMenuOpen] = useState(false);
    const [searchOptions, setSearchOptions] = useState({ matchCase: false, wholeWord: false, regex: false });
    const [allLayersVisible, setAllLayersVisible] = useState(true);
    const [hasActiveLayers, setHasActiveLayers] = useState(() => getLayerActionsState().hasActiveLayers);
    const [manualOrbitOpen, setManualOrbitOpen] = useState(isManualOrbitPanelOpen);
    const [designMode, setDesignMode] = useState(isManualOrbitDesignActive);
    const [selectedInspectableLayer, setSelectedInspectableLayer] = useState(null);
    const [propagatedParametersOpen, setPropagatedParametersOpen] = useState(false);
    const [groundStationsOpen, setGroundStationsOpen] = useState(false);
    const [groundStationDesignMode, setGroundStationDesignMode] = useState(false);
    const pendingManualOrbitConfirmationRef = useRef(null);
    const openPanelRef = useRef(openPanel);
    const panelOpenBeforeGroundStationDesignRef = useRef(null);
    useEffect(() => {
        openPanelRef.current = openPanel;
    }, [openPanel]);
    useEffect(() => {
        const open = () => setGroundStationsOpen(true);
        const close = () => setGroundStationsOpen(false);
        window.addEventListener("orbit:ground-stations-open", open);
        window.addEventListener("orbit:ground-stations-close", close);
        return () => {
            window.removeEventListener("orbit:ground-stations-open", open);
            window.removeEventListener("orbit:ground-stations-close", close);
        };
    }, []);
    useEffect(() => {
        const onProjectTitle = (event) => setProjectName(String(event.detail || "MY PROJECT").toUpperCase());
        window.addEventListener("orbit:project-title", onProjectTitle);
        return () => window.removeEventListener("orbit:project-title", onProjectTitle);
    }, []);
    useEffect(() => {
        const onProjectLayerCount = (event) => {
            const next = Number(event.detail);
            setProjectLayerCount(Number.isFinite(next) && next >= 0 ? next : 0);
        };
        window.addEventListener("orbit:project-layer-count", onProjectLayerCount);
        return () => window.removeEventListener("orbit:project-layer-count", onProjectLayerCount);
    }, []);
    useEffect(() => {
        const onLayersPanelCollapse = () => setOpenPanel(false);
        window.addEventListener("orbit:layers-panel-collapse", onLayersPanelCollapse);
        return () => window.removeEventListener("orbit:layers-panel-collapse", onLayersPanelCollapse);
    }, []);
    useEffect(() => {
        const onLayersPanelState = (event) => {
            if (isManualOrbitDesignActive()) {
                setOpenPanel(false);
                return;
            }
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
        // Preserve the user's Layers open/closed preference while a station
        // draft owns the workspace, then restore it when that session ends.
        // Setting `openPanel` false also keeps the rail active state and its
        // aria-expanded value truthful while the panel is unavailable.
        const onGroundStationDesign = (event) => {
            const active = event.detail?.active === true;
            setGroundStationDesignMode(active);
            if (active) {
                if (panelOpenBeforeGroundStationDesignRef.current === null) {
                    panelOpenBeforeGroundStationDesignRef.current = openPanelRef.current;
                }
                setOpenPanel(false);
                return;
            }
            if (panelOpenBeforeGroundStationDesignRef.current !== null) {
                setOpenPanel(panelOpenBeforeGroundStationDesignRef.current);
                panelOpenBeforeGroundStationDesignRef.current = null;
            }
        };
        window.addEventListener("orbit:ground-station-design-state", onGroundStationDesign);
        return () => window.removeEventListener("orbit:ground-station-design-state", onGroundStationDesign);
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
        if (designMode || groundStationDesignMode) setSearchMenuOpen(false);
    }, [designMode, groundStationDesignMode]);
    useEffect(() => {
        if (designMode || groundStationDesignMode) setProjectActionsMenu(null);
    }, [designMode, groundStationDesignMode]);
    useEffect(() => {
        if (!projectActionsMenu) return undefined;
        const close = (event) => {
            if (event.target?.closest?.("[data-project-actions-control='true'], [data-project-actions-menu='true']")) return;
            setProjectActionsMenu(null);
        };
        const closeOnEscape = (event) => {
            if (event.key === "Escape") setProjectActionsMenu(null);
        };
        document.addEventListener("pointerdown", close);
        document.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", close);
            document.removeEventListener("keydown", closeOnEscape);
        };
    }, [projectActionsMenu]);
    const togglePanel = () => {
        if (designMode || groundStationDesignMode) return;
        const next = !openPanel;
        setOpenPanel(next);
        publishLayersPanelState(next);
    };
    const requestManualOrbitDesign = () => {
        const open = !manualOrbitOpen;

        // Closing an already-open designer is not a transition away from the
        // Layers workspace, so retain the existing close behavior unchanged.
        if (!open || designMode || !openPanel) {
            window.dispatchEvent(new CustomEvent("orbit:manual-orbit-toggle", { detail: { open } }));
            return;
        }

        // ConfirmDialog is the shared confirmation surface used by the
        // workspace.  Do not allow a second rail click to stack dialogs while
        // the first decision is still pending.
        if (pendingManualOrbitConfirmationRef.current) return;

        const id = `manual-orbit-layers-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const onResponse = (event) => {
            if (event.detail?.id !== id) return;
            window.removeEventListener("orbit:confirm-response", onResponse);
            pendingManualOrbitConfirmationRef.current = null;
            if (event.detail?.accepted !== true) return;
            window.dispatchEvent(new CustomEvent("orbit:manual-orbit-toggle", {
                detail: { open: true, source: "layers", layersDesignConfirmed: true }
            }));
        };
        pendingManualOrbitConfirmationRef.current = { id, onResponse };
        window.addEventListener("orbit:confirm-response", onResponse);
        window.dispatchEvent(new CustomEvent("orbit:confirm-request", {
            detail: {
                id,
                title: "Cambiar a dise\u00f1o de \u00f3rbita manual",
                message: "La vista de Layers y la escena actual se ocultar\u00e1n temporalmente y seguir\u00e1n en segundo plano. Se abrir\u00e1 una vista exclusiva para generar una \u00f3rbita manual. Al crearla, la \u00f3rbita se a\u00f1adir\u00e1 al resto de Layers.",
                confirmText: "Continuar",
                cancelText: "Cancelar"
            }
        }));
    };
    useEffect(() => () => {
        const pending = pendingManualOrbitConfirmationRef.current;
        if (pending?.onResponse) {
            window.removeEventListener("orbit:confirm-response", pending.onResponse);
        }
    }, []);
    const visibilityTitle = allLayersVisible ? "Ocultar todas las capas" : "Mostrar todas las capas";
    // The manual designer is a valid orbital target even though it does not
    // appear in the layer tree while it is being authored.
    const propagatedParametersAvailable = designMode || Boolean(selectedInspectableLayer?.id);
    const propagatedParametersTitle = propagatedParametersAvailable
        ? (propagatedParametersOpen ? "Ocultar efem\u00e9rides" : "Ver efem\u00e9rides")
        : "Selecciona una capa orbital activa para ver sus efem\u00e9rides";
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
    const toggleProjectActionsMenu = () => {
        setProjectActionsMenu((current) => current?.source === "toolbar" ? null : { source: "toolbar" });
    };
    const openProjectContextMenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const margin = 8;
        const menuWidth = 228;
        const menuHeight = 326;
        setProjectActionsMenu({
            source: "context",
            left: Math.max(margin, Math.min(event.clientX, window.innerWidth - menuWidth - margin)),
            top: Math.max(margin, Math.min(event.clientY, window.innerHeight - menuHeight - margin))
        });
    };
    const selectProjectAction = (action, event) => {
        setProjectActionsMenu(null);
        if (action === "export-ground-stations") {
            const rect = event?.currentTarget?.getBoundingClientRect?.();
            openGroundStationExportMenu({
                source: "project",
                anchor: rect ? { left: rect.left, top: rect.bottom + 6 } : null
            });
            return;
        }
        window.dispatchEvent(new CustomEvent("orbit:project-action", { detail: action }));
    };
    return <>
        <aside id="leftSidebar" aria-label="Paneles del visor">
            <button id="leftSatellitesBtn" className={`sidebar-btn${openPanel && !designMode && !groundStationDesignMode ? " active" : ""}`} type="button" title={designMode || groundStationDesignMode ? "Capas (no disponibles durante el diseño)" : "Capas y satelites"} aria-label="Capas y satelites" aria-expanded={openPanel && !designMode && !groundStationDesignMode} onClick={togglePanel}><SatelliteIcon /><span className="sidebar-btn-label" aria-hidden="true">Layers</span></button>
            {!groundStationsOpen && <button id="leftManualOrbitBtn" className={`sidebar-btn${manualOrbitOpen ? " active" : ""}`} type="button" title={"Crear \u00f3rbita manual"} aria-label={"Crear \u00f3rbita manual"} aria-expanded={manualOrbitOpen} onClick={requestManualOrbitDesign}><ManualOrbitIcon /><span className="sidebar-btn-label" aria-hidden="true">Orbit</span></button>}
            {groundStationsOpen && <button id="leftGroundStationsBtn" className="sidebar-btn" type="button" title="Crear estación terrestre" aria-label="Crear estación terrestre" onClick={() => window.dispatchEvent(new Event("orbit:ground-stations-create-request"))}><GroundStationIcon /><span className="sidebar-btn-label" aria-hidden="true">Station</span></button>}
            {groundStationsOpen && <button id="leftPassTablesBtn" className="sidebar-btn" type="button" title="Tablas AOS / LOS" aria-label="Tablas AOS / LOS" onClick={() => window.dispatchEvent(new CustomEvent("orbit:ground-station-passes-open", { detail: {} }))}><PassTableIcon /><span className="sidebar-btn-label" aria-hidden="true">Passes</span></button>}
            {!groundStationsOpen && <button id="leftPropagatedParametersBtn" className={`sidebar-btn${propagatedParametersOpen ? " active" : ""} disabled:!cursor-not-allowed disabled:!opacity-40`} type="button" title={propagatedParametersTitle} aria-label={propagatedParametersTitle} aria-expanded={propagatedParametersOpen} disabled={!propagatedParametersAvailable} onClick={togglePropagatedParameters}><PropagatedParametersIcon /><span className="sidebar-btn-label" aria-hidden="true">Efemérides</span></button>}
            <div className="sidebar-spacer" />
            <SessionRecordButton />
            <CameraControls />
        </aside>
        <aside id="leftSatellitesPanel" className={`sidebar-panel${openPanel && !designMode && !groundStationDesignMode ? " open" : ""}`} aria-hidden={designMode || groundStationDesignMode} hidden={designMode}>
            <div className="sidebar-panel-header orbit-layers-panel-header">
                <div className="orbit-layers-heading">Layers</div>
                <div className="relative shrink-0">
                    <button id="projectActionsBtn" className={`orbit-layers-project-menu${projectActionsMenu?.source === "toolbar" ? " is-open" : ""}`} data-project-actions-control="true" type="button" title="Acciones de proyecto" aria-label="Acciones de proyecto" aria-haspopup="menu" aria-expanded={projectActionsMenu?.source === "toolbar"} aria-controls="projectActionsMenu" onClick={toggleProjectActionsMenu}><FolderIcon /></button>
                    {projectActionsMenu?.source === "toolbar" && <ProjectActionsMenu source="toolbar" onSelect={selectProjectAction} />}
                </div>
            </div>
            <div className="orbit-project-header orbit-project-module">
                <button className="orbit-project-root-toggle" data-layer-tree-project-root="true" type="button" title={projectTreeExpanded ? "Plegar proyecto" : "Desplegar proyecto"} aria-label={`${projectTreeExpanded ? "Plegar" : "Desplegar"} proyecto ${projectName}`} aria-expanded={projectTreeExpanded} aria-controls="leftSatellitesPanelContent" onClick={() => setProjectTreeExpanded((expanded) => !expanded)} onContextMenu={openProjectContextMenu}>
                    <span className={`layer-tree-chevron grid place-items-center transition-transform${projectTreeExpanded ? "" : " -rotate-90"}`} aria-hidden="true"><ChevronDownIcon /></span>
                    <span className="orbit-project-title" data-project-title title={projectName}>{projectName}</span>
                    <span className="layer-tree-count orbit-project-layer-count" aria-label={`${projectLayerCount} capas`} title={`${projectLayerCount} capas`}>{projectLayerCount}</span>
                </button>
                <div className="sidebar-panel-actions orbit-project-actions">
                    <button className="object-global-eye-btn orbit-project-action" id="toggleAllVisibilityBtn" data-react-visibility-toggle="true" type="button" title={designMode ? "Las capas se restaurarán al salir del diseño orbital" : visibilityTitle} aria-label={visibilityTitle} aria-pressed={allLayersVisible} disabled={designMode} hidden={!hasActiveLayers}>
                        {allLayersVisible ? <EyeIcon /> : <EyeOffIcon />}
                    </button>
                    <button className="object-global-remove-btn orbit-project-action is-danger" id="removeAllLayersHeaderBtn" type="button" title={designMode ? "Las capas no se pueden eliminar durante el diseño orbital" : "Quitar todas las capas"} aria-label="Quitar todas las capas" disabled={designMode} hidden={!hasActiveLayers}><TrashIcon /></button>
                    <button className="object-add-btn orbit-layers-add-button" id={groundStationsOpen ? "addGroundStationLayerBtn" : "openCatalogBtn"} type="button" title={groundStationsOpen ? "Añadir estación terrestre" : designMode ? "El catálogo se bloquea durante el diseño orbital" : "Añadir capa"} aria-label={groundStationsOpen ? "Añadir estación terrestre" : "Añadir capa"} disabled={designMode} onClick={groundStationsOpen ? () => window.dispatchEvent(new Event("orbit:ground-stations-create-request")) : undefined}><PlusIcon /><span>Añadir</span></button>
                </div>
                <div className="orbit-project-divider" aria-hidden="true" />
            </div>
            <div className="orbit-layers-search" role="search">
                <SearchIcon />
                <input id="objectSearch" className="orbit-layers-search-input" type="search" placeholder="Search layers..." aria-label="Buscar capas" disabled={designMode} />
                <div className="relative h-full">
                    <button className={`orbit-layers-search-options${searchMenuOpen ? " is-open" : ""}`} type="button" aria-label="Opciones de busqueda" aria-expanded={searchMenuOpen} disabled={designMode} onClick={() => setSearchMenuOpen((open) => !open)}><SlidersIcon /></button>
                    {searchMenuOpen && <div className="absolute top-[calc(100%+6px)] right-0 z-[10220] grid w-[190px] gap-[3px] rounded-lg border border-[#315178] bg-[#0c1728] p-[5px] shadow-[0_12px_28px_rgba(0,0,0,.45)]" role="menu">
                        <button className={`flex w-full cursor-pointer items-center gap-[9px] rounded-[5px] border-0 bg-transparent p-2 text-left font-[system-ui,sans-serif] text-[11px] leading-none font-semibold text-[#bdcbe0] hover:bg-[#193057] hover:text-[#eaf1ff]${searchOptions.matchCase ? " bg-[#193057] text-[#eaf1ff]" : ""}`} type="button" role="menuitemcheckbox" aria-checked={searchOptions.matchCase} onClick={() => toggleSearchOption("matchCase")}><b className="grid min-w-[22px] place-items-center text-[11px] text-[#8cadff]">Aa</b> Match case</button>
                        <button className={`flex w-full cursor-pointer items-center gap-[9px] rounded-[5px] border-0 bg-transparent p-2 text-left font-[system-ui,sans-serif] text-[11px] leading-none font-semibold text-[#bdcbe0] hover:bg-[#193057] hover:text-[#eaf1ff]${searchOptions.wholeWord ? " bg-[#193057] text-[#eaf1ff]" : ""}`} type="button" role="menuitemcheckbox" aria-checked={searchOptions.wholeWord} onClick={() => toggleSearchOption("wholeWord")}><b className="grid min-w-[22px] place-items-center text-[11px] text-[#8cadff]">ab</b> Whole word</button>
                        <button className={`flex w-full cursor-pointer items-center gap-[9px] rounded-[5px] border-0 bg-transparent p-2 text-left font-[system-ui,sans-serif] text-[11px] leading-none font-semibold text-[#bdcbe0] hover:bg-[#193057] hover:text-[#eaf1ff]${searchOptions.regex ? " bg-[#193057] text-[#eaf1ff]" : ""}`} type="button" role="menuitemcheckbox" aria-checked={searchOptions.regex} onClick={() => toggleSearchOption("regex")}><b className="grid min-w-[22px] place-items-center text-[11px] text-[#8cadff]">.*</b> Use regular expression</button>
                    </div>}
                </div>
            </div>
            <div id="leftSatellitesPanelContent" data-layer-tree-project-body="true" className={`sidebar-panel-content${designMode ? " pointer-events-none select-none opacity-50" : ""}${projectTreeExpanded ? "" : " !invisible !pointer-events-none"}`} aria-hidden={!projectTreeExpanded} aria-disabled={designMode} />
            <ProjectTimeFooter />
            <div className="sidebar-panel-resize-handle" role="separator" aria-orientation="vertical" aria-label="Redimensionar panel de capas" />
        </aside>
        {projectActionsMenu?.source === "context" && <ProjectActionsMenu source="context" left={projectActionsMenu.left} top={projectActionsMenu.top} onSelect={selectProjectAction} />}
        <div id="legacyHiddenInfo" hidden />
    </>;
}
