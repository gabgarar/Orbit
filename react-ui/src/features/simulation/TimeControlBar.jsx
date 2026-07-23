import { useEffect, useState } from "react";
import { CalendarIcon } from "../../components/icons.jsx";

const initialSimulation = { mode: "realtime", isPlaying: true, speed: 1, timelineStep: 0, timelineSteps: 1000, currentDate: new Date().toISOString(), startDate: new Date().toISOString(), endDate: new Date().toISOString() };
const toDateTimeInput = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const timelineDateLabel = (value) => new Date(value).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
const timelineTimeLabel = (value) => new Date(value).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false });
const classNames = (...classes) => classes.filter(Boolean).join(" ");

const buttonClass = "h-[31px] cursor-pointer rounded-[7px] border border-[#213653] bg-[#0c1728] px-[10px] font-[inherit] text-[#b9c9df] hover:border-[#4168a3] hover:bg-[#14243d] hover:text-[#edf4ff] disabled:cursor-not-allowed disabled:opacity-[.42]";
const activeButtonClass = "active border-[#4774ff] bg-[#17357b] text-[#dfe8ff] shadow-[inset_0_0_0_1px_rgba(114,145,255,.18)] hover:border-[#4774ff] hover:bg-[#17357b] hover:text-[#dfe8ff]";
const popoverClass = "absolute bottom-[calc(100%+7px)] z-[3] grid gap-1 rounded-[8px] border border-[#315178] bg-[#0c1728] p-[5px] shadow-[0_12px_28px_rgba(0,0,0,.45)]";

function buildTimelineMarks(startValue, endValue, count = 6) {
    const start = new Date(startValue).getTime(); const end = new Date(endValue).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return Array.from({ length: count }, (_, index) => ({ position: (index / (count - 1)) * 100, value: new Date(start + ((end - start) * index) / (count - 1)) }));
}

export default function TimeControlBar() {
    const [collapsed, setCollapsed] = useState(false); const [simulation, setSimulation] = useState(initialSimulation); const [dockLeft, setDockLeft] = useState(null); const [dockHeight, setDockHeight] = useState(null); const [dockBottom, setDockBottom] = useState(null);
    const [speedMenuOpen, setSpeedMenuOpen] = useState(false); const [dateMenuOpen, setDateMenuOpen] = useState(false); const [modeMenuOpen, setModeMenuOpen] = useState(false); const [recording, setRecording] = useState(false);
    const [designMode, setDesignMode] = useState(false);
    const sendAction = (type, value) => window.dispatchEvent(new CustomEvent("orbit:simulation-action", { detail: { type, value } }));
    useEffect(() => { const sync = (event) => setSimulation((current) => ({ ...current, ...(event.detail || {}) })); window.addEventListener("orbit:simulation-state", sync); return () => window.removeEventListener("orbit:simulation-state", sync); }, []);
    useEffect(() => { const sync = (event) => setRecording(event.detail === true || event.detail?.active === true); window.addEventListener("orbit:recording-state", sync); return () => window.removeEventListener("orbit:recording-state", sync); }, []);
    useEffect(() => { const sync = (event) => setDesignMode(event.detail?.active === true); window.addEventListener("orbit:manual-orbit-design-state", sync); return () => window.removeEventListener("orbit:manual-orbit-design-state", sync); }, []);
    useEffect(() => {
        const panel = document.getElementById("leftSatellitesPanel"); const infoPanel = document.getElementById("leftInfoPanel"); const rail = document.getElementById("leftSidebar"); const projectTimeFooter = document.getElementById("projectTimeFooter");
        const update = () => {
            const active = panel?.classList.contains("open") ? panel : (infoPanel?.classList.contains("open") ? infoPanel : null);
            setDockLeft(String(Math.round(active ? active.getBoundingClientRect().right + 12 : (rail?.getBoundingClientRect().right || 54) + 12)) + "px");
            const footerBounds = projectTimeFooter?.getBoundingClientRect();
            const footerHeight = footerBounds?.height || 0;
            setDockHeight(footerHeight > 0 ? `${footerHeight}px` : null);
            setDockBottom(footerHeight > 0 ? `${Math.max(0, window.innerHeight - footerBounds.bottom)}px` : null);
        };
        const afterTransition = () => window.setTimeout(update, 230); update(); const observer = new MutationObserver(afterTransition); if (panel) observer.observe(panel, { attributes: true, attributeFilter: ["class", "style"] }); if (infoPanel) observer.observe(infoPanel, { attributes: true, attributeFilter: ["class", "style"] }); const resizeObserver = new ResizeObserver(update); [panel, infoPanel, rail, projectTimeFooter].filter(Boolean).forEach((element) => resizeObserver.observe(element)); panel?.addEventListener("transitionend", update); infoPanel?.addEventListener("transitionend", update); window.addEventListener("resize", update);
        return () => { observer.disconnect(); resizeObserver.disconnect(); panel?.removeEventListener("transitionend", update); infoPanel?.removeEventListener("transitionend", update); window.removeEventListener("resize", update); };
    }, []);

    const isRealtime = simulation.mode === "realtime";
    const realtimePaused = isRealtime && simulation.isPlaying === false;
    const marks = buildTimelineMarks(simulation.startDate, simulation.endDate);
    const progress = Math.max(0, Math.min(100, ((simulation.timelineStep || 0) / (simulation.timelineSteps || 1000)) * 100));
    const markerPositionClass = progress <= 3
        ? "is-start translate-x-0 after:left-[6px]"
        : progress >= 97
            ? "is-end -translate-x-full after:left-auto after:right-[6px]"
            : "-translate-x-1/2 after:left-1/2 after:-translate-x-1/2";
    const updateRange = (field, value) => { if (!value) return; const next = { ...simulation, [field]: new Date(value).toISOString() }; setSimulation(next); sendAction("range", { startDate: next.startDate, endDate: next.endDate }); };

    // Orbit design has its own start/end epochs in the right-hand editor.  A
    // second time controller here would suggest it can alter the preview, so
    // leave the globe unobstructed until the design session is completed.
    if (designMode) return null;

    return <>
        <section
            className={classNames(
                "react-simulation-dock fixed right-[14px] bottom-[6px] z-[10110] grid box-border h-[74px] items-center gap-x-[18px] gap-y-[9px] overflow-visible rounded-[10px] border border-[rgba(72,103,151,.45)] bg-[linear-gradient(120deg,rgba(10,22,39,.97),rgba(5,13,24,.97))] px-[14px] py-[7px] font-sans text-[11px] leading-none font-semibold shadow-[0_16px_38px_rgba(0,0,0,.38),inset_0_1px_rgba(255,255,255,.035)] backdrop-blur-[10px] transition-[opacity,transform] duration-[180ms] ease-out [grid-template-rows:minmax(0,1fr)]",
                isRealtime ? "is-realtime grid-cols-[minmax(0,1fr)]" : "grid-cols-[max-content_minmax(260px,1fr)] max-[1100px]:grid-cols-1",
                collapsed && "is-collapsed pointer-events-none translate-y-[14px] opacity-0"
            )}
            style={{ ...(dockLeft ? { left: dockLeft } : {}), ...(dockHeight ? { height: dockHeight } : {}), ...(dockBottom ? { bottom: dockBottom } : {}) }}
            aria-label="Control de simulacion"
        >
            <div className="col-[1] flex min-h-[53px] min-w-0 flex-wrap items-center self-stretch gap-[7px] max-[1100px]:col-[1]">
                <div className="relative" aria-label="Modo temporal">
                    <button
                        className={classNames(buttonClass, "min-w-[92px]", modeMenuOpen && activeButtonClass)}
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={modeMenuOpen}
                        onClick={() => setModeMenuOpen((open) => !open)}
                    >
                        {isRealtime ? "Real time" : "Simulated"}
                    </button>
                    {modeMenuOpen && <div className={classNames(popoverClass, "left-0 min-w-[108px]")} role="menu">
                        <button className={classNames(buttonClass, "w-full text-left", isRealtime && activeButtonClass)} type="button" role="menuitem" onClick={() => { sendAction("mode", "realtime"); setModeMenuOpen(false); }}>Real time</button>
                        <button className={classNames(buttonClass, "w-full text-left", !isRealtime && activeButtonClass)} type="button" role="menuitem" onClick={() => { sendAction("mode", "range"); setModeMenuOpen(false); }}>Simulated</button>
                    </div>}
                </div>

                {isRealtime && <button
                    className={classNames(
                        buttonClass,
                        "inline-flex min-w-[76px] items-center justify-center gap-1.5",
                        realtimePaused && "!border-[#b8823d] !bg-[#2d2114] !text-[#ffe0a5] hover:!border-[#d8a658] hover:!bg-[#392916] hover:!text-[#ffebc6]"
                    )}
                    type="button"
                    title={realtimePaused ? "Resume real time" : "Pause real time"}
                    aria-label={realtimePaused ? "Resume real time" : "Pause real time"}
                    aria-pressed={realtimePaused}
                    onClick={() => sendAction("play-toggle")}
                >
                    <span aria-hidden="true">{realtimePaused ? "\u25B6" : "\u23F8"}</span>
                    <span>{realtimePaused ? "Paused" : "Pause"}</span>
                </button>}

                <button
                    className={classNames(
                        buttonClass,
                        "inline-flex min-w-[66px] items-center justify-center gap-1.5",
                        recording && "is-recording w-[34px] min-w-[34px] gap-[5px] !border-[#d2556b] !bg-[#351724] !p-0 !text-[#ffd9df]"
                    )}
                    type="button"
                    title={recording ? "Detener grabacion" : "Grabar sesion"}
                    aria-label={recording ? "Detener grabacion" : "Grabar sesion"}
                    onClick={() => sendAction("record-toggle")}
                >
                    <i className="size-[7px] rounded-full bg-[#ff576d] shadow-[0_0_7px_rgba(255,87,109,.55)]" />
                    {recording ? <span className="inline-flex items-center gap-[3px]" aria-hidden="true"><b className="block h-[10px] w-[2px] rounded-[1px] bg-[#f5d6dd]" /><b className="block h-[10px] w-[2px] rounded-[1px] bg-[#f5d6dd]" /></span> : "Record"}
                </button>

                {!isRealtime && <>
                    <div className="order-2 inline-flex items-center gap-[5px]">
                        <button className={classNames(buttonClass, "w-[31px] min-w-[31px] !p-0 text-[14px]")} type="button" title="Reiniciar" aria-label="Reiniciar" onClick={() => sendAction("rewind")}>{"\u23EE"}</button>
                        <button className={classNames(buttonClass, "w-[31px] min-w-[31px] !border-[#4167f4] !bg-[#3158da] !p-0 text-[14px] !text-white hover:!bg-[#426bf1]")} type="button" title={simulation.isPlaying ? "Pausar" : "Reproducir"} aria-label={simulation.isPlaying ? "Pausar" : "Reproducir"} onClick={() => sendAction("play-toggle")}>{simulation.isPlaying ? "\u23F8" : "\u25B6"}</button>

                        <div className="relative">
                            <button className={buttonClass} type="button" aria-haspopup="menu" aria-expanded={speedMenuOpen} onClick={() => setSpeedMenuOpen((open) => !open)}>x{simulation.speed}</button>
                            {speedMenuOpen && <div className={classNames(popoverClass, "right-0 z-[2] min-w-[78px]")} role="menu">
                                {[1, 10, 60, 600].map((speed) => <button className={classNames(buttonClass, "w-full text-left", simulation.speed === speed && activeButtonClass)} type="button" role="menuitem" key={speed} onClick={() => { sendAction("speed", speed); setSpeedMenuOpen(false); }}>x{speed}</button>)}
                            </div>}
                        </div>

                        <div className="relative">
                            <button
                                className={classNames(buttonClass, "w-[31px] min-w-[31px] !p-0 [&>svg]:size-[15px] [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.8]", dateMenuOpen && activeButtonClass)}
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
                                <label className="grid gap-[5px] text-[10px] leading-none font-bold text-[#aebed5]">Inicio<input className="h-[30px] w-full box-border rounded-[6px] border border-[#233957] bg-[#091321] px-[6px] font-[inherit] text-[#dce8fb] [color-scheme:dark]" type="datetime-local" value={toDateTimeInput(simulation.startDate)} onChange={(event) => updateRange("startDate", event.target.value)} /></label>
                                <label className="grid gap-[5px] text-[10px] leading-none font-bold text-[#aebed5]">Fin<input className="h-[30px] w-full box-border rounded-[6px] border border-[#233957] bg-[#091321] px-[6px] font-[inherit] text-[#dce8fb] [color-scheme:dark]" type="datetime-local" value={toDateTimeInput(simulation.endDate)} onChange={(event) => updateRange("endDate", event.target.value)} /></label>
                            </div>}
                        </div>
                    </div>
                </>}
            </div>

            {!isRealtime && <div className="col-[2] grid min-w-0 grid-cols-[minmax(160px,1fr)] items-center max-[1100px]:col-[1] max-[1100px]:grid-cols-1 max-[1100px]:gap-2">
                <div className="relative min-w-0 py-[18px] pb-[31px]" style={{ "--timeline-progress": progress + "%" }}>
                    <output
                        className={classNames(
                            "pointer-events-none absolute z-[3] top-[-5px] rounded-[5px] border border-[#3d70f4] bg-[#2459d9] px-[7px] py-[5px] font-sans text-[10px] leading-none font-bold whitespace-nowrap text-white shadow-[0_6px_15px_rgba(21,71,198,.4)] after:absolute after:bottom-[-5px] after:size-2 after:rotate-45 after:border-r after:border-b after:border-[#3d70f4] after:bg-[#2459d9] after:content-['']",
                            markerPositionClass
                        )}
                        style={{ left: progress + "%" }}
                    >
                        {timelineTimeLabel(simulation.currentDate)}
                    </output>
                    <input
                        className="relative z-[3] my-[-4px] h-3 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-[4px] [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,#4779ff_0_var(--timeline-progress),#253a57_var(--timeline-progress)_100%)] [&::-webkit-slider-runnable-track]:shadow-[inset_0_0_0_1px_rgba(113,141,181,.18)] [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#6f98ff] [&::-webkit-slider-thumb]:bg-[#2860ed] [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(54,99,239,.2)] [&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-[4px] [&::-moz-range-track]:bg-[#253a57] [&::-moz-range-track]:shadow-[inset_0_0_0_1px_rgba(113,141,181,.18)] [&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded-[4px] [&::-moz-range-progress]:bg-[#4779ff] [&::-moz-range-thumb]:size-[9px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#6f98ff] [&::-moz-range-thumb]:bg-[#2860ed] [&::-moz-range-thumb]:shadow-[0_0_0_3px_rgba(54,99,239,.2)]"
                        aria-label="Linea temporal de simulacion"
                        type="range"
                        min="0"
                        max={simulation.timelineSteps || 1000}
                        step="1"
                        value={simulation.timelineStep || 0}
                        onChange={(event) => sendAction("timeline", Number(event.target.value))}
                    />
                    <div className="pointer-events-none absolute top-3 right-0 left-0 z-[2] h-[42px]" aria-hidden="true">
                        {Array.from({ length: 21 }, (_, index) => {
                            const mark = Number.isInteger(index / 4) ? marks[index / 4] : null;
                            const labelPositionClass = index === 0 ? "translate-x-0 text-left" : index === 20 ? "-translate-x-full text-right" : "-translate-x-1/2 text-center";
                            return <span className={classNames("absolute top-0 h-full w-px -translate-x-1/2", index === 0 && "translate-x-0", index === 20 && "-translate-x-full", mark && "is-major")} key={index} style={{ left: index * 5 + "%" }}>
                                <i className={classNames("absolute top-[2px] left-0 h-3 w-px bg-[#64738a] opacity-[.72]", mark && "top-[-1px] h-[18px] bg-[#9aa8ba] opacity-90")} />
                                {mark && <time className={classNames("absolute top-[22px] left-0 grid gap-px whitespace-nowrap text-[9px] leading-[1.15] font-semibold text-[#8497b3]", labelPositionClass)}>{timelineDateLabel(mark.value)}<b className="font-bold text-[#b8c8df]">{timelineTimeLabel(mark.value)}</b></time>}
                            </span>;
                        })}
                    </div>
                </div>
            </div>}
        </section>

        <button
            className={classNames(
                "fixed z-[10111] h-[22px] w-[29px] cursor-pointer border border-[#294465] bg-[#0d192a] font-sans text-[10px] text-[#b8cbe5]",
                collapsed ? "is-collapsed right-[22px] bottom-[8px] rounded-[6px]" : "right-[26px] bottom-[72px] rounded-t-[6px]"
            )}
            style={!collapsed && dockHeight ? { bottom: `calc(${dockHeight}${dockBottom ? ` + ${dockBottom}` : ""} - 2px)` } : undefined}
            type="button"
            aria-label={collapsed ? "Mostrar control de simulacion" : "Ocultar control de simulacion"}
            onClick={() => setCollapsed((value) => !value)}
        >
            {collapsed ? "\u25B2" : "\u25BC"}
        </button>
    </>;
}
