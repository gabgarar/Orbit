import { useEffect, useLayoutEffect, useState } from "react";
import { CalendarIcon, ChevronDownIcon } from "../../components/icons.jsx";
import { getPassTimelineMarker, getTimelinePosition } from "../../../../front/js/features/groundStations/passTimeline.js";

const initialSimulation = { mode: "realtime", isPlaying: true, speed: 1, timelineStep: 0, timelineSteps: 1000, currentDate: new Date().toISOString(), startDate: new Date().toISOString(), endDate: new Date().toISOString() };
// ``datetime-local`` deliberately carries no offset. Treat its displayed
// value as UTC so the editor, timeline, AOS/LOS table and chart all describe
// the same instant, regardless of the operator's browser timezone.
const toUtcDateTimeInput = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16); };
const fromUtcDateTimeInput = (value) => {
    const text = String(value || "").trim();
    if (!text) return null;
    const date = new Date(`${text.length === 16 ? `${text}:00` : text}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
};
const timelineDateLabel = (value) => new Date(value).toLocaleDateString("es-ES", { day: "2-digit", month: "short", timeZone: "UTC" });
const timelineTimeLabel = (value) => new Date(value).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
const passTimeLabel = (value) => `${timelineDateLabel(value)} ${timelineTimeLabel(value)} UTC`;
const classNames = (...classes) => classes.filter(Boolean).join(" ");
const isManualOrbitDesignActive = () => window.__orbitManualOrbitDesignActive === true
    || document.documentElement.dataset.manualOrbitDesign === "true";

const buttonClass = "h-[31px] cursor-pointer rounded-[7px] border border-[#213653] bg-[#0c1728] px-[10px] font-[inherit] text-[#b9c9df] hover:border-[#4168a3] hover:bg-[#14243d] hover:text-[#edf4ff] disabled:cursor-not-allowed disabled:opacity-[.42]";
const activeButtonClass = "active border-[#4774ff] bg-[#17357b] text-[#dfe8ff] shadow-[inset_0_0_0_1px_rgba(114,145,255,.18)] hover:border-[#4774ff] hover:bg-[#17357b] hover:text-[#dfe8ff]";
// The dock uses the same quiet outlined interaction as the Simulated mode
// button: no permanent blue tile, with a dark fill only on hover or open.
const controlButtonClass = "!h-[30px] !w-[30px] !min-w-[30px] !rounded-[6px] !border-transparent !bg-transparent !p-0 font-[system-ui,sans-serif] text-[12px] leading-none font-semibold !text-[#bed0e8] !shadow-none transition-colors hover:!border-[#35547e] hover:!bg-[#101f35] hover:!text-[#edf4ff] focus-visible:!border-[#5378b6] focus-visible:!bg-[#14253f] focus-visible:!text-[#edf4ff] focus-visible:!outline-none";
const activeControlButtonClass = "active !border-[#5378b6] !bg-[#14253f] !text-[#edf4ff] !shadow-none hover:!border-[#5378b6] hover:!bg-[#14253f] hover:!text-[#edf4ff]";
const iconControlClass = "[&>svg]:size-[16px] [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.8]";
const popoverClass = "absolute bottom-[calc(100%+7px)] z-[3] grid gap-1 rounded-[8px] border border-[#315178] bg-[#0c1728] p-[5px] shadow-[0_12px_28px_rgba(0,0,0,.45)]";

function RewindIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 5v14M18 6.5 9.5 12l8.5 5.5v-11Z" /></svg>;
}

function PlayIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z" /></svg>;
}

function PauseIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5v14M15.5 5v14" /></svg>;
}

function buildTimelineMarks(startValue, endValue, count = 6) {
    const start = new Date(startValue).getTime(); const end = new Date(endValue).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return Array.from({ length: count }, (_, index) => ({ position: (index / (count - 1)) * 100, value: new Date(start + ((end - start) * index) / (count - 1)) }));
}

export default function TimeControlBar() {
    const [collapsed, setCollapsed] = useState(false); const [simulation, setSimulation] = useState(initialSimulation); const [dockLeft, setDockLeft] = useState(null); const [dockHeight, setDockHeight] = useState(null); const [dockBottom, setDockBottom] = useState(null);
    const [speedMenuOpen, setSpeedMenuOpen] = useState(false); const [dateMenuOpen, setDateMenuOpen] = useState(false); const [designMode, setDesignMode] = useState(isManualOrbitDesignActive);
    const [accessMarks, setAccessMarks] = useState([]);
    const [accessWindow, setAccessWindow] = useState(null);
    const [accessContext, setAccessContext] = useState({ stationName: "", satelliteName: "", referenceFrame: "ITRF", timeScale: "UTC" });
    const [hoveredPassMarker, setHoveredPassMarker] = useState(null);
    const sendAction = (type, value) => window.dispatchEvent(new CustomEvent("orbit:simulation-action", { detail: { type, value } }));

    useEffect(() => { const sync = (event) => setSimulation((current) => ({ ...current, ...(event.detail || {}) })); window.addEventListener("orbit:simulation-state", sync); return () => window.removeEventListener("orbit:simulation-state", sync); }, []);
    useEffect(() => { const sync = (event) => setDesignMode(event.detail?.active === true); window.addEventListener("orbit:manual-orbit-design-state", sync); return () => window.removeEventListener("orbit:manual-orbit-design-state", sync); }, []);
    useEffect(() => {
        const sync = (event) => {
            const detail = event.detail || {};
            setAccessMarks(Array.isArray(detail.passes) ? detail.passes : []);
            setAccessWindow(detail.analysisWindow || null);
            setAccessContext({
                stationName: String(detail.stationName || detail.station?.name || "").trim(),
                satelliteName: String(detail.satelliteName || detail.satellite || "").trim(),
                referenceFrame: String(detail.referenceFrame || detail.reference_frame || "ITRF"),
                timeScale: String(detail.timeScale || detail.time_scale || "UTC")
            });
            setHoveredPassMarker(null);
        };
        window.addEventListener("orbit:ground-stations-analysis-result", sync);
        return () => window.removeEventListener("orbit:ground-stations-analysis-result", sync);
    }, []);
    useEffect(() => {
        const panel = document.getElementById("leftSatellitesPanel"); const infoPanel = document.getElementById("leftInfoPanel"); const rail = document.getElementById("leftSidebar"); const projectTimeFooter = document.getElementById("projectTimeFooter");
        const update = () => {
            const active = panel?.classList.contains("open") ? panel : (infoPanel?.classList.contains("open") ? infoPanel : null);
            setDockLeft(String(Math.round(active ? active.getBoundingClientRect().right + 12 : (rail?.getBoundingClientRect().right || 54) + 12)) + "px");

            // Match the compact project clock height and anchor the dock to the
            // footer's actual lower edge, so both surfaces move together.
            // Keep the Layers edge as a fallback while the footer is unavailable.
            const footerBounds = projectTimeFooter?.getBoundingClientRect();
            const footerHeight = footerBounds?.height || 0;
            const panelBounds = panel?.getBoundingClientRect();
            const panelBottom = panelBounds?.bottom;
            const footerBottom = footerBounds?.bottom;
            const anchorBottom = Number.isFinite(footerBottom) && footerHeight > 0 && footerBottom > 0
                ? footerBottom
                : panelBottom;
            setDockHeight(footerHeight > 0 ? `${footerHeight}px` : null);
            setDockBottom(Number.isFinite(anchorBottom) && anchorBottom > 0 ? `${Math.max(0, window.innerHeight - anchorBottom)}px` : null);
        };
        const afterTransition = () => window.setTimeout(update, 230); update(); const observer = new MutationObserver(afterTransition); if (panel) observer.observe(panel, { attributes: true, attributeFilter: ["class", "style"] }); if (infoPanel) observer.observe(infoPanel, { attributes: true, attributeFilter: ["class", "style"] }); const resizeObserver = new ResizeObserver(update); [panel, infoPanel, rail, projectTimeFooter].filter(Boolean).forEach((element) => resizeObserver.observe(element)); panel?.addEventListener("transitionend", update); infoPanel?.addEventListener("transitionend", update); window.addEventListener("resize", update);
        return () => { observer.disconnect(); resizeObserver.disconnect(); panel?.removeEventListener("transitionend", update); infoPanel?.removeEventListener("transitionend", update); window.removeEventListener("resize", update); };
    }, []);

    const isSimulated = simulation.mode === "range";
    useEffect(() => { if (!isSimulated) setCollapsed(false); }, [isSimulated]);

    // All fixed right-side panels share this lower inset.  Leave them flush
    // with Layers normally, then reserve the real measured dock height plus a
    // small visual gap only while the full simulated timeline is visible.
    const timelineDockVisible = isSimulated && !designMode && !collapsed;
    const rightPanelBottom = timelineDockVisible
        ? `calc(${dockHeight || "65px"} + ${dockBottom || "6px"} + 14px)`
        : "var(--orbit-right-panel-base-bottom)";
    useLayoutEffect(() => {
        const root = document.documentElement;
        root.style.setProperty("--orbit-right-panel-bottom", rightPanelBottom);
        root.dataset.orbitTimelineDock = timelineDockVisible ? "visible" : "hidden";
        return () => {
            root.style.removeProperty("--orbit-right-panel-bottom");
            delete root.dataset.orbitTimelineDock;
        };
    }, [rightPanelBottom, timelineDockVisible]);

    const marks = buildTimelineMarks(simulation.startDate, simulation.endDate);
    const analysisRangeMatchesTimeline = (() => {
        if (accessWindow?.source !== "simulation-range") return false;
        const analysisStart = Date.parse(accessWindow.startTime); const analysisEnd = Date.parse(accessWindow.endTime);
        const timelineStart = Date.parse(simulation.startDate); const timelineEnd = Date.parse(simulation.endDate);
        return [analysisStart, analysisEnd, timelineStart, timelineEnd].every(Number.isFinite)
            && Math.abs(analysisStart - timelineStart) < 1_000
            && Math.abs(analysisEnd - timelineEnd) < 1_000;
    })();
    const timelinePassMarks = analysisRangeMatchesTimeline ? accessMarks : [];
    const passTimelineMarkers = timelinePassMarks.flatMap((pass, index) => {
        const marker = getPassTimelineMarker(pass);
        const position = marker ? getTimelinePosition(marker.time, simulation.startDate, simulation.endDate) : null;
        if (!marker || position === null || position < 0 || position > 100) return [];
        return [{
            id: `${index}-${marker.time}-${String(pass?.aos || "")}`,
            index,
            pass,
            marker,
            position,
            maxElevation: Number(pass?.max_elevation_deg)
        }];
    });
    useEffect(() => { setHoveredPassMarker(null); }, [simulation.startDate, simulation.endDate, analysisRangeMatchesTimeline]);
    const progress = Math.max(0, Math.min(100, ((simulation.timelineStep || 0) / (simulation.timelineSteps || 1000)) * 100));
    const markerPositionClass = progress <= 3
        ? "is-start translate-x-0 after:left-[6px]"
        : progress >= 97
            ? "is-end -translate-x-full after:left-auto after:right-[6px]"
            : "-translate-x-1/2 after:left-1/2 after:-translate-x-1/2";
    const updateRange = (field, value) => { const nextDate = fromUtcDateTimeInput(value); if (!nextDate) return; const next = { ...simulation, [field]: nextDate.toISOString() }; setSimulation(next); sendAction("range", { startDate: next.startDate, endDate: next.endDate }); };

    // Real time and Static deliberately leave only the compact time selector
    // visible. The full timeline is reserved for an active simulation range.
    if (designMode || !isSimulated) return null;

    return <>
        <section
            className={classNames(
                "react-simulation-dock fixed right-[14px] bottom-[6px] grid box-border h-[65px] grid-cols-[max-content_minmax(300px,1fr)] items-stretch gap-x-[14px] overflow-visible rounded-[10px] border border-[rgba(72,103,151,.45)] bg-[linear-gradient(120deg,rgba(10,22,39,.97),rgba(5,13,24,.97))] px-[12px] py-[5px] font-sans text-[11px] leading-none font-semibold shadow-[0_16px_38px_rgba(0,0,0,.38),inset_0_1px_rgba(255,255,255,.035)] backdrop-blur-[10px] transition-[opacity,transform] duration-[180ms] ease-out [grid-template-rows:minmax(0,1fr)] max-[1100px]:grid-cols-1",
                dateMenuOpen ? "z-[10131]" : "z-[10110]",
                collapsed && "is-collapsed pointer-events-none translate-y-[14px] opacity-0"
            )}
            style={{ ...(dockLeft ? { left: dockLeft } : {}), ...(dockHeight ? { height: dockHeight } : {}), ...(dockBottom ? { bottom: dockBottom } : {}) }}
            aria-label="Control de simulacion"
        >
            <div className="col-[1] flex h-full min-w-0 flex-nowrap items-center self-stretch gap-[3px] border-r border-[rgba(94,125,168,.28)] pr-[11px] max-[1100px]:col-[1]">
                <button className={classNames(buttonClass, controlButtonClass, iconControlClass)} type="button" title="Reiniciar" aria-label="Reiniciar" onClick={() => sendAction("rewind")}><RewindIcon /></button>
                <button className={classNames(buttonClass, controlButtonClass, iconControlClass)} type="button" title={simulation.isPlaying ? "Pausar" : "Reproducir"} aria-label={simulation.isPlaying ? "Pausar" : "Reproducir"} onClick={() => sendAction("play-toggle")}>{simulation.isPlaying ? <PauseIcon /> : <PlayIcon />}</button>

                <div className="relative">
                    <button className={classNames(buttonClass, controlButtonClass, "!text-[12px] !font-bold tracking-[-.02em]")} type="button" aria-haspopup="menu" aria-expanded={speedMenuOpen} onClick={() => setSpeedMenuOpen((open) => !open)}>x{simulation.speed}</button>
                    {speedMenuOpen && <div className={classNames(popoverClass, "right-0 z-[2] min-w-[78px]")} role="menu">
                        {[1, 10, 60, 600].map((speed) => <button className={classNames(buttonClass, "w-full text-left", simulation.speed === speed && activeButtonClass)} type="button" role="menuitem" key={speed} onClick={() => { sendAction("speed", speed); setSpeedMenuOpen(false); }}>x{speed}</button>)}
                    </div>}
                </div>

                <div className="relative">
                    <button
                        className={classNames(buttonClass, controlButtonClass, iconControlClass, dateMenuOpen && activeControlButtonClass)}
                        type="button"
                        disabled={simulation.oemDomainActive}
                        aria-label={simulation.oemDomainActive ? "El rango OEM no se puede editar" : "Elegir rango de fechas"}
                        aria-haspopup="dialog"
                        aria-expanded={dateMenuOpen}
                        onClick={() => setDateMenuOpen((open) => !open)}
                    >
                        <CalendarIcon />
                    </button>
                    {dateMenuOpen && !simulation.oemDomainActive && <div className="absolute right-0 bottom-[calc(100%+7px)] z-[3] grid w-[238px] gap-2 rounded-[8px] border border-[#315178] bg-[#0c1728] p-[10px] shadow-[0_12px_28px_rgba(0,0,0,.45)]" role="dialog" aria-label="Seleccionar rango temporal">
                        <label className="grid gap-[5px] text-[10px] leading-none font-bold text-[#aebed5]">Inicio (UTC)<input className="h-[30px] w-full box-border rounded-[6px] border border-[#233957] bg-[#091321] px-[6px] font-[inherit] text-[#dce8fb] [color-scheme:dark]" type="datetime-local" value={toUtcDateTimeInput(simulation.startDate)} onChange={(event) => updateRange("startDate", event.target.value)} /></label>
                        <label className="grid gap-[5px] text-[10px] leading-none font-bold text-[#aebed5]">Fin (UTC)<input className="h-[30px] w-full box-border rounded-[6px] border border-[#233957] bg-[#091321] px-[6px] font-[inherit] text-[#dce8fb] [color-scheme:dark]" type="datetime-local" value={toUtcDateTimeInput(simulation.endDate)} onChange={(event) => updateRange("endDate", event.target.value)} /></label>
                    </div>}
                </div>
            </div>

            <div className="col-[2] grid min-w-0 grid-cols-[minmax(160px,1fr)] items-center self-stretch max-[1100px]:col-[1] max-[1100px]:grid-cols-1 max-[1100px]:gap-2">
                <div className="relative h-full min-w-0" style={{ "--timeline-progress": progress + "%" }}>
                    <output
                        className={classNames(
                            "pointer-events-none absolute z-[3] top-[5px] rounded-[5px] border border-[#4777e9] bg-[#2459d9] px-[6px] py-[4px] font-sans text-[9px] leading-none font-bold whitespace-nowrap text-white shadow-[0_5px_12px_rgba(21,71,198,.34)] after:absolute after:bottom-[-5px] after:size-2 after:rotate-45 after:border-r after:border-b after:border-[#4777e9] after:bg-[#2459d9] after:content-['']",
                            markerPositionClass
                        )}
                        style={{ left: progress + "%" }}
                    >
                        {timelineTimeLabel(simulation.currentDate)} UTC
                    </output>
                    <input
                        className="absolute top-[20px] left-0 z-[3] h-3 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-[3px] [&::-webkit-slider-runnable-track]:rounded-[4px] [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,#4779ff_0_var(--timeline-progress),#253a57_var(--timeline-progress)_100%)] [&::-webkit-slider-runnable-track]:shadow-[inset_0_0_0_1px_rgba(113,141,181,.18)] [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:size-[13px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#6f98ff] [&::-webkit-slider-thumb]:bg-[#2860ed] [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(54,99,239,.2)] [&::-moz-range-track]:h-[3px] [&::-moz-range-track]:rounded-[4px] [&::-moz-range-track]:bg-[#253a57] [&::-moz-range-track]:shadow-[inset_0_0_0_1px_rgba(113,141,181,.18)] [&::-moz-range-progress]:h-[3px] [&::-moz-range-progress]:rounded-[4px] [&::-moz-range-progress]:bg-[#4779ff] [&::-moz-range-thumb]:size-[10px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#6f98ff] [&::-moz-range-thumb]:bg-[#2860ed] [&::-moz-range-thumb]:shadow-[0_0_0_3px_rgba(54,99,239,.2)]"
                        aria-label="Linea temporal de simulacion"
                        type="range"
                        min="0"
                        max={simulation.timelineSteps || 1000}
                        step="1"
                        value={simulation.timelineStep || 0}
                        onChange={(event) => sendAction("timeline", Number(event.target.value))}
                    />
                    {hoveredPassMarker && <aside
                        id="ground-station-pass-tooltip"
                        role="tooltip"
                        className={classNames(
                            "pointer-events-none absolute bottom-[calc(100%+9px)] z-20 w-[min(270px,calc(100vw-40px))] rounded-[8px] border border-[#35634f] bg-[linear-gradient(145deg,rgba(8,30,26,.98),rgba(5,16,27,.985))] px-3 py-2.5 font-[system-ui,sans-serif] text-[10px] leading-[1.35] text-[#d8eee2] shadow-[0_14px_34px_rgba(0,0,0,.48)]",
                            hoveredPassMarker.position <= 10 ? "translate-x-0" : hoveredPassMarker.position >= 90 ? "-translate-x-full" : "-translate-x-1/2"
                        )}
                        style={{ left: `${hoveredPassMarker.position}%` }}
                    >
                        <div className="flex items-center justify-between gap-3"><strong className="text-[11px] text-[#effff4]">Pase {hoveredPassMarker.index + 1}</strong><span className="shrink-0 text-[#89e7ae]">{hoveredPassMarker.marker.label}</span></div>
                        <p className="mt-1 mb-2 truncate text-[#a8cabb]">{accessContext.satelliteName || "Satélite"} <span className="text-[#608879]">·</span> {accessContext.stationName || "Estación terrestre"} <span className="text-[#608879]">·</span> {accessContext.referenceFrame} / {accessContext.timeScale}</p>
                        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-y border-[#285041] py-1.5"><dt className="text-[#8fb7a3]">AOS</dt><dd className="m-0 text-right font-semibold text-[#e0f4e7]">{passTimeLabel(hoveredPassMarker.pass.aos)}</dd><dt className="text-[#8fb7a3]">LOS</dt><dd className="m-0 text-right font-semibold text-[#e0f4e7]">{passTimeLabel(hoveredPassMarker.pass.los)}</dd><dt className="text-[#8fb7a3]">Máx.</dt><dd className="m-0 text-right font-semibold text-[#8fe8b2]">{Number.isFinite(hoveredPassMarker.maxElevation) ? `${hoveredPassMarker.maxElevation.toFixed(1)}°` : "—"} · {passTimeLabel(hoveredPassMarker.marker.time)}</dd></dl>
                        <p className="mt-2 mb-0 text-[#9dc7af]">Pulsa para situar la simulación en este instante.</p>
                    </aside>}
                    <div className="pointer-events-none absolute top-[20px] right-0 left-0 z-[4] h-[18px]" aria-label="Pases calculados de la estación terrestre">
                        {passTimelineMarkers.map((timelineMarker) => {
                            const satellite = accessContext.satelliteName || "satélite";
                            const station = accessContext.stationName || "estación terrestre";
                            const maximumElevation = Number.isFinite(timelineMarker.maxElevation) ? `, máxima elevación ${timelineMarker.maxElevation.toFixed(1)} grados` : "";
                            const markerLabel = `Pase ${timelineMarker.index + 1} de ${satellite} desde ${station}: AOS ${passTimeLabel(timelineMarker.pass.aos)}, LOS ${passTimeLabel(timelineMarker.pass.los)}${maximumElevation}. Ir a ${timelineMarker.marker.label}.`;
                            return <button
                                key={timelineMarker.id}
                                className="pointer-events-auto absolute top-[-7px] h-[18px] w-[18px] -translate-x-1/2 cursor-pointer border-0 bg-transparent p-0 before:absolute before:top-[2px] before:left-1/2 before:h-[13px] before:w-[2px] before:-translate-x-1/2 before:rounded before:bg-[#67ed9d] before:shadow-[0_0_7px_rgba(103,237,157,.8)] before:transition-colors hover:before:bg-[#a7ffc5] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#9bf8ba]"
                                type="button"
                                aria-label={markerLabel}
                                aria-describedby={hoveredPassMarker?.id === timelineMarker.id ? "ground-station-pass-tooltip" : undefined}
                                onPointerEnter={() => setHoveredPassMarker(timelineMarker)}
                                onPointerLeave={() => setHoveredPassMarker((current) => current?.id === timelineMarker.id ? null : current)}
                                onFocus={() => setHoveredPassMarker(timelineMarker)}
                                onBlur={() => setHoveredPassMarker((current) => current?.id === timelineMarker.id ? null : current)}
                                onClick={() => sendAction("timeline-jump", { time: new Date(timelineMarker.marker.time).toISOString(), source: "ground-station-pass", passIndex: timelineMarker.index })}
                                style={{ left: `${timelineMarker.position}%` }}
                            />;
                        })}
                    </div>
                    <div className="pointer-events-none absolute top-[20px] right-0 left-0 z-[2] h-[33px]" aria-hidden="true">
                        {Array.from({ length: 21 }, (_, index) => {
                            const mark = Number.isInteger(index / 4) ? marks[index / 4] : null;
                            const labelPositionClass = index === 0 ? "translate-x-0 text-left" : index === 20 ? "-translate-x-full text-right" : "-translate-x-1/2 text-center";
                            return <span className={classNames("absolute top-0 h-full w-px -translate-x-1/2", index === 0 && "translate-x-0", index === 20 && "-translate-x-full", mark && "is-major")} key={index} style={{ left: index * 5 + "%" }}>
                                <i className={classNames("absolute top-[1px] left-0 h-[7px] w-px bg-[#64738a] opacity-[.56]", mark && "top-[-2px] h-[12px] bg-[#9aa8ba] opacity-[.88]")} />
                                {mark && <time className={classNames("absolute top-[13px] left-0 grid gap-0 whitespace-nowrap text-[8px] leading-[1.1] font-medium tracking-[.01em] text-[#7890ad]", labelPositionClass)}>{timelineDateLabel(mark.value)}<b className="font-semibold text-[9px] leading-[1.1] tabular-nums text-[#c7d7eb]">{timelineTimeLabel(mark.value)}</b></time>}
                            </span>;
                        })}
                    </div>
                </div>
            </div>
        </section>

        <button
            className={classNames(
                "fixed z-[10111] grid h-[23px] w-[32px] cursor-pointer place-items-center rounded-t-[7px] border border-[#35547e] bg-[#101f35] font-[system-ui,sans-serif] text-[#bed0e8] shadow-[0_-5px_14px_rgba(0,0,0,.2)] backdrop-blur-[8px] transition-colors hover:border-[#5378b6] hover:bg-[#14253f] hover:text-[#edf4ff] focus-visible:border-[#5378b6] focus-visible:bg-[#14253f] focus-visible:text-[#edf4ff] focus-visible:outline-none [&_svg]:size-[14px] [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:2]",
                collapsed ? "is-collapsed left-[66px] bottom-[6px] rounded-[7px]" : "right-[22px] bottom-[72px] rounded-t-[7px] border-b-0"
            )}
            style={collapsed
                ? { ...(dockLeft ? { left: dockLeft } : {}), ...(dockBottom ? { bottom: dockBottom } : {}) }
                : dockHeight
                    ? { bottom: `calc(${dockHeight}${dockBottom ? ` + ${dockBottom}` : ""} - 5px)` }
                    : undefined}
            type="button"
            title={collapsed ? "Mostrar control de simulacion" : "Ocultar control de simulacion"}
            aria-label={collapsed ? "Mostrar control de simulacion" : "Ocultar control de simulacion"}
            onClick={() => setCollapsed((value) => !value)}
        >
            <span className={classNames("grid transition-transform duration-150", collapsed && "rotate-180")}><ChevronDownIcon /></span>
        </button>
    </>;
}
