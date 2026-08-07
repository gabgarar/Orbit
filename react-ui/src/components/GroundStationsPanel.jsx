import { useEffect, useMemo, useRef, useState } from "react";
import { downloadChartPng } from "../../../front/js/runtime/chartPngExport.js";
import PanelCloseButton from "./PanelCloseButton.jsx";

const initialState = { stations: [], satellites: [], activeStationId: "", activeSatelliteId: "", now: null };
const inputClass = "min-h-8 w-full rounded-md border border-[#284465] bg-[#091323] px-2 text-[11px] font-semibold text-[#d9e6fa] outline-none focus:border-[#5d86ff]";
const FLOAT_MARGIN = 12;
const MIN_FLOATING_WIDTH = 520;
const MIN_FLOATING_HEIGHT = 360;
const FLOATING_RESIZE_HANDLES = [
    ["n", "top-0 right-2 left-2 h-2 cursor-n-resize"],
    ["s", "right-2 bottom-0 left-2 h-2 cursor-s-resize"],
    ["e", "top-2 right-0 bottom-2 w-2 cursor-e-resize"],
    ["w", "top-2 bottom-2 left-0 w-2 cursor-w-resize"],
    ["ne", "top-0 right-0 size-3 cursor-ne-resize"],
    ["nw", "top-0 left-0 size-3 cursor-nw-resize"],
    ["se", "right-0 bottom-0 size-3 cursor-se-resize"],
    ["sw", "bottom-0 left-0 size-3 cursor-sw-resize"]
];

function viewportBounds() {
    if (typeof window === "undefined") return { width: 1440, height: 900 };
    return { width: Math.max(320, window.innerWidth), height: Math.max(320, window.innerHeight) };
}

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

function floatingTopMargin(viewport) {
    // Keep the draggable header below Orbit's top toolbar. On very short
    // viewports, retain as much usable space as possible without clipping it.
    return Math.min(72, Math.max(FLOAT_MARGIN, viewport.height - 260 - FLOAT_MARGIN));
}

function clampFloatingRect(rect) {
    const viewport = viewportBounds();
    const topMargin = floatingTopMargin(viewport);
    const minimumWidth = Math.min(MIN_FLOATING_WIDTH, Math.max(320, viewport.width - (FLOAT_MARGIN * 2)));
    const maximumHeight = Math.max(260, viewport.height - topMargin - FLOAT_MARGIN);
    const minimumHeight = Math.min(MIN_FLOATING_HEIGHT, maximumHeight);
    const width = clamp(Number(rect?.width) || 960, minimumWidth, Math.max(minimumWidth, viewport.width - (FLOAT_MARGIN * 2)));
    const height = clamp(Number(rect?.height) || 760, minimumHeight, maximumHeight);
    return {
        x: clamp(Number(rect?.x) || FLOAT_MARGIN, FLOAT_MARGIN, Math.max(FLOAT_MARGIN, viewport.width - width - FLOAT_MARGIN)),
        y: clamp(Number(rect?.y) || 76, topMargin, Math.max(topMargin, viewport.height - height - FLOAT_MARGIN)),
        width,
        height
    };
}

function initialFloatingRect() {
    const viewport = viewportBounds();
    return clampFloatingRect({
        x: Math.max(FLOAT_MARGIN, Math.round((viewport.width - 960) / 2)),
        y: 76,
        width: 960,
        height: Math.min(760, viewport.height - 88)
    });
}

function utc(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function isSameAnalysisRange(analysisWindow, simulation) {
    if (analysisWindow?.source !== "simulation-range" || simulation?.mode !== "range") return false;
    const analysisStart = Date.parse(analysisWindow.startTime);
    const analysisEnd = Date.parse(analysisWindow.endTime);
    const simulationStart = Date.parse(simulation.startDate);
    const simulationEnd = Date.parse(simulation.endDate);
    return [analysisStart, analysisEnd, simulationStart, simulationEnd].every(Number.isFinite)
        && Math.abs(analysisStart - simulationStart) < 1_000
        && Math.abs(analysisEnd - simulationEnd) < 1_000;
}

function exportPasses(result) {
    const rows = ["station,satellite,aos_utc,los_utc,max_elevation_deg", ...(result.passes || []).map((pass) => [result.station?.name || "", result.satellite || "", pass.aos || "", pass.los || "", pass.max_elevation_deg ?? ""].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "orbit-ground-station-passes.csv"; anchor.click(); URL.revokeObjectURL(url);
}

function PassesTable({ passes }) {
    const rows = Array.isArray(passes) ? passes : [];
    return <div className="orbit-scrollbar mt-2 overflow-x-auto rounded-[7px] border border-[#265143] bg-[rgba(5,20,17,.42)]">
        <table className="w-full min-w-[460px] border-collapse text-left text-[10px]">
            <thead className="bg-[rgba(19,57,46,.72)] text-[9px] font-bold uppercase tracking-wide text-[#9fc7b1]">
                <tr>
                    <th scope="col" className="px-2 py-1.5">Pase</th>
                    <th scope="col" className="px-2 py-1.5">AOS (UTC)</th>
                    <th scope="col" className="px-2 py-1.5">LOS (UTC)</th>
                    <th scope="col" className="px-2 py-1.5 text-right">Máx.</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#24483d] text-[#c8ddd3]">
                {rows.map((pass, index) => {
                    const maxElevation = Number(pass.max_elevation_deg);
                    return <tr key={`${pass.aos}-${index}`} className="transition-colors hover:bg-[rgba(37,92,72,.22)]">
                        <th scope="row" className="px-2 py-1.5 font-semibold text-[#e1faea]">{index + 1}</th>
                        <td className="whitespace-nowrap px-2 py-1.5">{utc(pass.aos)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">{utc(pass.los)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold text-[#9ee8bf]">{Number.isFinite(maxElevation) ? `${maxElevation.toFixed(1)}°` : "—"}</td>
                    </tr>;
                })}
            </tbody>
        </table>
    </div>;
}

function PassElevationChart({ result }) {
    const svgRef = useRef(null);
    const [selectedPass, setSelectedPass] = useState(0);
    useEffect(() => setSelectedPass(0), [result?.satellite, result?.analysisWindow?.startTime, result?.analysisWindow?.endTime]);
    const allSamples = Array.isArray(result?.samples) ? result.samples : [];
    const passes = Array.isArray(result?.passes) ? result.passes : [];
    const orderedPasses = [...passes].sort((left, right) => Date.parse(left.aos) - Date.parse(right.aos));
    const focusedPass = orderedPasses[selectedPass] || orderedPasses[0] || null;
    const focusStart = focusedPass ? Date.parse(focusedPass.aos) - (120 * 1000) : Date.parse(allSamples[0]?.time);
    const focusEnd = focusedPass ? Date.parse(focusedPass.los) + (120 * 1000) : Date.parse(allSamples.at(-1)?.time);
    const samples = allSamples.filter((sample) => {
        const timestamp = Date.parse(sample.time);
        return Number.isFinite(timestamp) && timestamp >= focusStart && timestamp <= focusEnd;
    });
    if (samples.length < 2) return null;
    const start = focusStart;
    const end = focusEnd;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const width = 860; const height = 320; const pad = { left: 56, right: 20, top: 30, bottom: 51 };
    const plotWidth = width - pad.left - pad.right; const plotHeight = height - pad.top - pad.bottom;
    const mask = Number(result?.station?.min_elevation_deg ?? 0);
    const x = (time) => pad.left + ((Date.parse(time) - start) / (end - start)) * plotWidth;
    const y = (elevation) => pad.top + ((90 - Math.max(-10, Math.min(90, Number(elevation)))) / 100) * plotHeight;
    // AOS/LOS are refined by the API. Use their exact UTC instants for the
    // color transition instead of deriving a second, coarser one from samples.
    const aosTime = Date.parse(focusedPass?.aos);
    const losTime = Date.parse(focusedPass?.los);
    const hasPassWindow = Number.isFinite(aosTime) && Number.isFinite(losTime) && losTime >= aosTime;
    const clampOffset = (value) => Math.min(1, Math.max(0, value));
    const passOffset = (time) => clampOffset((time - start) / (end - start));
    const aosOffset = hasPassWindow ? passOffset(aosTime) : 0;
    const losOffset = hasPassWindow ? passOffset(losTime) : 0;
    const aosX = pad.left + (aosOffset * plotWidth);
    const losX = pad.left + (losOffset * plotWidth);
    const points = samples.map((sample) => ({ x: x(sample.time), y: y(sample.elevation_deg) }));
    const path = points.reduce((value, point, index) => {
        if (!index) return `M${point.x.toFixed(1)},${point.y.toFixed(1)}`;
        const previous = points[index - 1];
        const before = points[index - 2] || previous;
        const next = points[index + 1] || point;
        const control1 = { x: previous.x + ((point.x - before.x) / 6), y: previous.y + ((point.y - before.y) / 6) };
        const control2 = { x: point.x - ((next.x - previous.x) / 6), y: point.y - ((next.y - previous.y) / 6) };
        return `${value} C${control1.x.toFixed(1)},${control1.y.toFixed(1)} ${control2.x.toFixed(1)},${control2.y.toFixed(1)} ${point.x.toFixed(1)},${point.y.toFixed(1)}`;
    }, "");
    // The pass table and the global timeline use UTC. Keep the chart in that
    // same operational time scale instead of mixing an IANA display zone into
    // one of the three pass views.
    const timeZone = "UTC";
    const formatter = new Intl.DateTimeFormat(undefined, { timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" });
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => new Date(start + ((end - start) * fraction)));
    return <section className="mt-3 rounded-[9px] border border-[#203b59] bg-[linear-gradient(155deg,rgba(8,19,35,.96),rgba(5,13,25,.96))] p-2.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1"><div><strong className="block text-[11px] text-[#e4eefc]">Perfil de elevación</strong><span className="text-[9px] text-[#879bb8]">Pase de {result.satellite} · {result.referenceFrame || "ITRF"} · {result.timeScale || "UTC"}</span></div><label className="text-[9px] text-[#91a8c8]">Pase <select value={selectedPass} onChange={(event) => setSelectedPass(Number(event.target.value))} className="ml-1 rounded-[5px] border border-[#31506f] bg-[#0e2037] px-1.5 py-1 text-[9px] font-bold text-[#d8e7fc]">{orderedPasses.map((pass, index) => <option key={`${pass.aos}-${index}`} value={index}>Pase {index + 1} · {Number(pass.max_elevation_deg).toFixed(1)}°</option>)}</select></label></div>
        <div className="mb-1 flex items-center justify-end gap-2 px-1"><span className="hidden text-[9px] font-medium text-[#7189aa] lg:inline">Vista detallada · muestras 30 s</span><button className="inline-flex h-6 items-center rounded-[5px] border border-[#31506f] bg-[#0e2037] px-2 text-[9px] font-bold text-[#a9c7ed] hover:bg-[#173554]" type="button" onClick={() => downloadChartPng(svgRef.current, `passes-${result.satellite}`)}>Export PNG</button></div>
        <svg ref={svgRef} className="block min-h-[250px] w-full select-none" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Elevación del satélite durante el pase seleccionado">
            <defs><linearGradient id="pass-elevation-line" gradientUnits="userSpaceOnUse" x1={pad.left} y1="0" x2={width - pad.right} y2="0"><stop offset="0%" stopColor="#6cb8ff" />{hasPassWindow && <><stop offset={`${(aosOffset * 100).toFixed(4)}%`} stopColor="#6cb8ff" /><stop offset={`${(aosOffset * 100).toFixed(4)}%`} stopColor="#6ff0a1" /><stop offset={`${(losOffset * 100).toFixed(4)}%`} stopColor="#6ff0a1" /><stop offset={`${(losOffset * 100).toFixed(4)}%`} stopColor="#a58aff" /></>}<stop offset="100%" stopColor="#a58aff" /></linearGradient><clipPath id="pass-elevation-clip"><rect x={pad.left} y={pad.top} width={plotWidth} height={plotHeight} rx="4" /></clipPath></defs>
            <rect x={pad.left} y={pad.top} width={plotWidth} height={plotHeight} fill="#09172a" stroke="#29425f" strokeWidth=".9" rx="4" />
            {[0, 30, 60, 90].map((level) => <g key={level}><line x1={pad.left} x2={width - pad.right} y1={y(level)} y2={y(level)} stroke="#8090a3" strokeOpacity=".24" strokeWidth=".7" /><text x={pad.left - 10} y={y(level) + 3.5} fill="#8ea2bd" fontSize="10" textAnchor="end">{level}°</text></g>)}
            <line x1={pad.left} x2={width - pad.right} y1={y(mask)} y2={y(mask)} stroke="#e4af48" strokeDasharray="5 4" strokeWidth="1.2" /><text x={width - pad.right - 4} y={y(mask) - 5} textAnchor="end" fill="#efbd60" fontSize="10">máscara {mask}°</text>
            <g clipPath="url(#pass-elevation-clip)">
                {hasPassWindow && <><line x1={aosX} x2={aosX} y1={pad.top} y2={pad.top + plotHeight} stroke="#74e3a0" strokeOpacity=".78" strokeWidth="1" strokeDasharray="4 4" /><line x1={losX} x2={losX} y1={pad.top} y2={pad.top + plotHeight} stroke="#74e3a0" strokeOpacity=".78" strokeWidth="1" strokeDasharray="4 4" /></>}
                <path d={path} fill="none" stroke="url(#pass-elevation-line)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </g>
            {hasPassWindow && <><text x={aosX + 4} y={pad.top + 13} fill="#82e8aa" fontSize="9" fontWeight="700">AOS</text><text x={losX - 4} y={pad.top + 13} fill="#82e8aa" fontSize="9" fontWeight="700" textAnchor="end">LOS</text></>}
            {ticks.map((tick, index) => <g key={tick.toISOString()}><line x1={pad.left + index * plotWidth / 4} x2={pad.left + index * plotWidth / 4} y1={pad.top} y2={pad.top + plotHeight} stroke="#8090a3" strokeOpacity=".18" strokeWidth=".7" /><text x={pad.left + index * plotWidth / 4} y={height - 20} textAnchor={index === 0 ? "start" : index === 4 ? "end" : "middle"} fill="#8ea2bd" fontSize="9.5">{formatter.format(tick).replace(",", "")}</text></g>)}
            <text x={pad.left} y="17" fill="#d9eaff" fontSize="11.5" fontWeight="700">Elevación de {result.satellite} (deg)</text><text x={width - pad.right} y="17" fill="#89a6cb" fontSize="9.5" fontWeight="600" textAnchor="end">{result.referenceFrame || "ITRF"} · {result.timeScale || "UTC"}</text><text x={width - pad.right} y={height - 4} fill="#8197b5" fontSize="9.5" fontWeight="600" textAnchor="end">HORA ({result.timeScale || "UTC"})</text>
        </svg>
        <p className="m-0 px-1 pt-1 text-[9px] leading-snug text-[#86a999]">Azul: elevación calculada. Verde: tramo que cumple máscara y envolvente RF.</p>
    </section>;
}

export default function GroundStationsPanel() {
    const [open, setOpen] = useState(false);
    const [state, setState] = useState(initialState);
    const [stationId, setStationId] = useState("");
    const [satelliteId, setSatelliteId] = useState("");
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [floating, setFloating] = useState(false);
    const [floatingRect, setFloatingRect] = useState(initialFloatingRect);
    const [drag, setDrag] = useState(null);
    const [resize, setResize] = useState(null);
    const selectedAnalysisTargetRef = useRef({ stationId: "", satelliteId: "" });
    selectedAnalysisTargetRef.current = { stationId, satelliteId };

    useEffect(() => {
        const refresh = () => window.dispatchEvent(new Event("orbit:ground-stations-request-state"));
        const show = () => { setFloating(false); setOpen(true); refresh(); };
        const hide = () => setOpen(false);
        const receive = (event) => setState(event.detail || initialState);
        const receiveResult = (event) => {
            const detail = event.detail || null;
            const selection = detail?.analysisSelection;
            const selected = selectedAnalysisTargetRef.current;
            if (selection && (selection.stationId !== selected.stationId || selection.satelliteLayerId !== selected.satelliteId)) return;
            setLoading(false);
            setResult(detail);
        };
        const invalidateChangedSimulationRange = (event) => setResult((current) => {
            if (!current?.analysisWindow || current.analysisWindow.source !== "simulation-range") return current;
            if (isSameAnalysisRange(current.analysisWindow, event.detail)) return current;
            return {
                ...current,
                error: "El intervalo de simulación ha cambiado. Vuelve a analizar los pases.",
                passes: [],
                samples: [],
                visibleNow: false
            };
        });
        const hideForDesign = (event) => { if (event.detail?.active === true) setOpen(false); };
        const openPasses = (event) => { setStationId(String(event.detail?.stationId || "")); setFloatingRect((current) => clampFloatingRect(current)); setFloating(true); setOpen(true); refresh(); };
        window.addEventListener("orbit:ground-stations-open", show);
        window.addEventListener("orbit:ground-stations-close", hide);
        window.addEventListener("orbit:ground-stations-state", receive);
        window.addEventListener("orbit:ground-stations-analysis-result", receiveResult);
        window.addEventListener("orbit:simulation-state", invalidateChangedSimulationRange);
        window.addEventListener("orbit:ground-station-passes-open", openPasses);
        window.addEventListener("orbit:ground-station-design-state", hideForDesign);
        return () => {
            window.removeEventListener("orbit:ground-stations-open", show);
            window.removeEventListener("orbit:ground-stations-close", hide);
            window.removeEventListener("orbit:ground-stations-state", receive);
            window.removeEventListener("orbit:ground-stations-analysis-result", receiveResult);
            window.removeEventListener("orbit:simulation-state", invalidateChangedSimulationRange);
            window.removeEventListener("orbit:ground-station-passes-open", openPasses);
            window.removeEventListener("orbit:ground-station-design-state", hideForDesign);
        };
    }, []);

    useEffect(() => {
        if (!drag) return undefined;
        const move = (event) => setFloatingRect((current) => clampFloatingRect({ ...current, x: event.clientX - drag.x, y: event.clientY - drag.y }));
        const stop = () => setDrag(null);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
        };
    }, [drag]);

    useEffect(() => {
        if (!resize) return undefined;
        const move = (event) => {
            const viewport = viewportBounds();
            const topMargin = floatingTopMargin(viewport);
            const minimumWidth = Math.min(MIN_FLOATING_WIDTH, Math.max(320, viewport.width - (FLOAT_MARGIN * 2)));
            const minimumHeight = Math.min(MIN_FLOATING_HEIGHT, Math.max(260, viewport.height - topMargin - FLOAT_MARGIN));
            const initial = resize.rect;
            const right = initial.x + initial.width;
            const bottom = initial.y + initial.height;
            const deltaX = event.clientX - resize.pointerX;
            const deltaY = event.clientY - resize.pointerY;
            let { x, y, width, height } = initial;
            if (resize.direction.includes("e")) width = clamp(initial.width + deltaX, minimumWidth, Math.max(minimumWidth, viewport.width - initial.x - FLOAT_MARGIN));
            if (resize.direction.includes("w")) {
                width = clamp(initial.width - deltaX, minimumWidth, Math.max(minimumWidth, right - FLOAT_MARGIN));
                x = right - width;
            }
            if (resize.direction.includes("s")) height = clamp(initial.height + deltaY, minimumHeight, Math.max(minimumHeight, viewport.height - initial.y - FLOAT_MARGIN));
            if (resize.direction.includes("n")) {
                height = clamp(initial.height - deltaY, minimumHeight, Math.max(minimumHeight, bottom - topMargin));
                y = bottom - height;
            }
            setFloatingRect(clampFloatingRect({ x, y, width, height }));
        };
        const stop = () => setResize(null);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
        };
    }, [resize]);

    useEffect(() => {
        const constrain = () => setFloatingRect((current) => clampFloatingRect(current));
        window.addEventListener("resize", constrain);
        return () => window.removeEventListener("resize", constrain);
    }, []);

    useEffect(() => { if (!stationId && state.stations[0]) setStationId(state.stations[0].id); }, [state.stations, stationId]);
    useEffect(() => { if (!satelliteId && state.satellites[0]) setSatelliteId(state.satellites[0].id); }, [state.satellites, satelliteId]);
    const station = useMemo(() => state.stations.find((item) => item.id === stationId), [state.stations, stationId]);
    const liveLinkBudgetDbm = Number.isFinite(Number(result?.rangeKm)) && station
        ? Number(station.tx_power_dbm) + Number(station.tx_gain_dbi || 0) + Number(station.rx_gain_dbi || 0) - (32.44 + (20 * Math.log10(Number(station.frequency_mhz))) + (20 * Math.log10(Number(result.rangeKm))))
        : Number.NaN;

    if (!open) return null;
    const cancelPendingAnalysis = () => window.dispatchEvent(new Event("orbit:ground-stations-analysis-cancel"));
    const beginDrag = (event) => {
        if (event.button !== 0 || event.target.closest("button, input, select, label")) return;
        setDrag({ x: event.clientX - floatingRect.x, y: event.clientY - floatingRect.y });
        event.preventDefault();
    };
    const beginResize = (direction, event) => {
        if (event.button !== 0) return;
        setResize({ direction, pointerX: event.clientX, pointerY: event.clientY, rect: floatingRect });
        event.preventDefault();
        event.stopPropagation();
    };
    const analyze = () => {
        if (!stationId || !satelliteId) return;
        setLoading(true);
        window.dispatchEvent(new CustomEvent("orbit:ground-stations-analyze", { detail: { stationId, satelliteId } }));
    };
    const floatingStyle = floating ? { left: floatingRect.x, top: floatingRect.y, width: floatingRect.width, height: floatingRect.height } : undefined;
    return <aside className={`${floating ? "fixed z-[10140] flex min-h-0 min-w-0" : "fixed top-[82px] right-3 z-[10140] flex max-h-[calc(100dvh-102px)] w-[min(390px,calc(100vw-24px))]"} flex-col overflow-hidden rounded-[12px] border border-[#2b4e7b] bg-[rgba(7,16,31,.96)] font-[system-ui,sans-serif] text-[#e7f0ff] shadow-[0_18px_48px_rgba(0,0,0,.48)]`} style={floatingStyle} aria-label="Operaciones de estaciones terrestres">
        <header onPointerDown={floating ? beginDrag : undefined} className={`flex shrink-0 items-center justify-between border-b border-[#203956] px-3 py-2.5${floating ? " cursor-move select-none" : ""}`}><div><h2 className="m-0 text-[13px] font-bold tracking-wide">{floating ? "TABLAS AOS / LOS" : "GROUND STATIONS"}</h2><p className="mt-0.5 mb-0 text-[10px] text-[#8ea4c4]">{floating ? "Arrastra esta barra para mover el análisis" : "Operación de pases y visibilidad"}</p></div><PanelCloseButton label={floating ? "Cerrar tablas AOS / LOS" : "Cerrar estaciones terrestres"} onPointerDown={(event) => event.stopPropagation()} onClick={() => floating ? setOpen(false) : window.dispatchEvent(new Event("orbit:ground-stations-close"))} /></header>
        <div className="orbit-scrollbar grid min-h-0 flex-1 gap-3 overflow-x-hidden overflow-y-auto overscroll-contain p-3 pr-2.5">
            <section className="rounded-lg border border-[#203956] bg-[rgba(13,29,51,.7)] p-2.5"><div className="mb-2 flex items-center justify-between"><strong className="text-[11px]">Estación activa</strong>{!floating && <button type="button" onClick={() => { cancelPendingAnalysis(); setOpen(false); window.dispatchEvent(new Event("orbit:ground-stations-create-request")); }} className="rounded-md border border-[#466cff] bg-[#263f96] px-2 py-1 text-[10px] font-bold text-white">+ Añadir</button>}</div>{state.stations.length ? <select className={inputClass} value={stationId} onChange={(event) => { cancelPendingAnalysis(); setStationId(event.target.value); setResult(null); }}>{state.stations.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.latitude_deg.toFixed(3)}°, {item.longitude_deg.toFixed(3)}°</option>)}</select> : <p className="m-0 text-[11px] text-[#aabbd2]">Crea una estación para iniciar un análisis.</p>}{station && <><p className="mb-0 text-[10px] text-[#8ea4c4]">Máscara aplicada: {station.min_elevation_deg}° · ITRF/WGS‑84</p>{!floating && <div className="mt-2"><button type="button" onClick={() => { setFloatingRect((current) => clampFloatingRect(current)); setFloating(true); }} className="rounded border border-[#3f785e] bg-transparent px-2 py-1 text-[10px] font-bold text-[#a8ebc5]">Tablas AOS / LOS</button></div>}</>}</section>
            {station && <section className="rounded-lg border border-[#285345] bg-[rgba(7,31,26,.62)] p-2.5"><div className="flex items-center justify-between gap-3"><strong className="text-[11px]">Configuración aplicada</strong><strong className="shrink-0 text-[10px] text-[#8cebb1]">RF {Number(station.radio_range_km || 0).toFixed(1)} km</strong></div><p className="my-1 text-[9px] leading-snug text-[#96bba7]">Parámetros de solo lectura. Edítalos al crear la estación o desde sus datos.</p><div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]"><span className="text-[#9fc7b1]">Máscara</span><strong className="text-right">{Number(station.min_elevation_deg).toFixed(1)}°</strong><span className="text-[#9fc7b1]">Frecuencia</span><strong className="text-right">{Number(station.frequency_mhz).toFixed(1)} MHz</strong><span className="text-[#9fc7b1]">Potencia TX</span><strong className="text-right">{Number(station.tx_power_dbm).toFixed(1)} dBm</strong><span className="text-[#9fc7b1]">G TX / G RX</span><strong className="text-right">{Number(station.tx_gain_dbi).toFixed(1)} / {Number(station.rx_gain_dbi).toFixed(1)} dBi</strong><span className="text-[#9fc7b1]">RX mínima</span><strong className="text-right">{Number(station.min_link_power_dbm ?? -80).toFixed(1)} dBm</strong></div></section>}
            <section className="rounded-lg border border-[#203956] bg-[rgba(13,29,51,.7)] p-2.5"><strong className="text-[11px]">Analizar pases</strong><label className="mt-2 grid gap-1 text-[10px] text-[#9fb3d0]">Satélite<select className={inputClass} value={satelliteId} onChange={(event) => { cancelPendingAnalysis(); setSatelliteId(event.target.value); setResult(null); }} disabled={!state.satellites.length}><option value="">Selecciona una capa</option>{state.satellites.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{!state.satellites.length && <p className="mb-0 text-[10px] text-[#d8aa67]">No hay satélites disponibles en Layers.</p>}{station && <p className="mb-0 text-[10px] text-[#8ea4c4]">Usa la máscara de {station.name}: {station.min_elevation_deg}°.</p>}<button type="button" disabled={!stationId || !satelliteId || loading} onClick={analyze} className="mt-3 w-full rounded-md border border-[#597dff] bg-[#304dc0] py-2 text-[11px] font-bold text-white disabled:opacity-45">{loading ? "Calculando…" : "Analizar pases"}</button></section>
            {result && <section className="rounded-lg border border-[#2b5b4a] bg-[rgba(11,46,37,.5)] p-2.5"><div className="flex justify-between"><strong className="text-[11px]">Resultado</strong><span className="text-[10px] text-[#8fe7b7]">{result.visibleNow ? "IN VIEW" : "OUT OF VIEW"}</span></div><p className="my-1 text-[10px] text-[#b8d6c7]">{result.error || `${result.satellite} · ${result.referenceFrame || "ITRF"} · ${result.timeScale || "UTC"} · ${result.passes?.length || 0} pases`}</p>{result.analysisWindow?.startTime && !result.error ? <p className="mb-2 text-[9px] leading-snug text-[#90b9a4]">Ventana analizada: {utc(result.analysisWindow.startTime)} → {utc(result.analysisWindow.endTime)}{result.analysisWindow.source === "simulation-range" ? " · rango de simulación" : " · próximas 24 h"}</p> : null}{Number.isFinite(result.rangeKm) && <div className="mb-2 grid grid-cols-2 gap-1 rounded border border-[#285143] bg-[rgba(4,22,17,.46)] p-1.5 text-[10px]"><span className="text-[#9fc7b1]">Distancia actual</span><strong className="text-right text-[#e1faea]">{Number(result.rangeKm).toFixed(1)} km</strong><span className="text-[#9fc7b1]">Presupuesto enlace</span><strong className="text-right text-[#a7edc1]">{Number.isFinite(liveLinkBudgetDbm) ? `${liveLinkBudgetDbm.toFixed(1)} dBm` : "-"}</strong></div>}{result.passes?.length ? <PassesTable passes={result.passes} /> : <p className="mb-0 text-[10px] text-[#b4cbbf]">No hay pases en la ventana temporal seleccionada.</p>}<PassElevationChart result={result} />{result.passes?.length ? <button className="mt-2 rounded border border-[#3f785e] bg-transparent px-2 py-1 text-[10px] font-bold text-[#a8ebc5]" type="button" onClick={() => exportPasses(result)}>Exportar CSV</button> : null}</section>}
        </div>
        {floating && <><span className="pointer-events-none absolute right-1 bottom-1 size-3 border-r border-b border-[#6389bc] opacity-75" aria-hidden="true" />{FLOATING_RESIZE_HANDLES.map(([direction, className]) => <div key={direction} className={`absolute z-40 touch-none ${className}`} aria-hidden="true" onPointerDown={(event) => beginResize(direction, event)} />)}</>}
    </aside>;
}
