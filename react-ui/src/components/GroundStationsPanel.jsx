import { useEffect, useMemo, useState } from "react";

const initialState = { stations: [], satellites: [], activeStationId: "", activeSatelliteId: "", now: null };
const inputClass = "min-h-8 w-full rounded-md border border-[#284465] bg-[#091323] px-2 text-[11px] font-semibold text-[#d9e6fa] outline-none focus:border-[#5d86ff]";

function utc(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function exportPasses(result) {
    const rows = ["station,satellite,aos_utc,los_utc,max_elevation_deg", ...(result.passes || []).map((pass) => [result.station?.name || "", result.satellite || "", pass.aos || "", pass.los || "", pass.max_elevation_deg ?? ""].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "orbit-ground-station-passes.csv"; anchor.click(); URL.revokeObjectURL(url);
}

function PassElevationChart({ result }) {
    const allSamples = Array.isArray(result?.samples) ? result.samples : [];
    const passes = Array.isArray(result?.passes) ? result.passes : [];
    const focusedPass = passes.reduce((best, pass) => !best || Number(pass.max_elevation_deg) > Number(best.max_elevation_deg) ? pass : best, null);
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
    const width = 340; const height = 154; const pad = { left: 29, right: 9, top: 12, bottom: 39 };
    const plotWidth = width - pad.left - pad.right; const plotHeight = height - pad.top - pad.bottom;
    const mask = Number(result?.station?.min_elevation_deg ?? 0);
    const x = (time) => pad.left + ((Date.parse(time) - start) / (end - start)) * plotWidth;
    const y = (elevation) => pad.top + ((90 - Math.max(-10, Math.min(90, Number(elevation)))) / 100) * plotHeight;
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
    const timeZone = String(result?.stationTimeZone || "UTC").trim() || "UTC";
    let formatter;
    try {
        formatter = new Intl.DateTimeFormat(undefined, { timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "shortOffset" });
    } catch {
        formatter = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "shortOffset" });
    }
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => new Date(start + ((end - start) * fraction)));
    return <div className="mt-3 rounded-md border border-[#285345] bg-[#061611] px-1.5 py-1.5">
        <div className="mb-1 flex items-center justify-between px-1 text-[9px] font-bold tracking-wide text-[#a9d8bf]"><span>PERFIL DEL MEJOR PASE</span><span>{timeZone} · muestras 30 s</span></div>
        <svg className="block h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Elevación del satélite sobre la estación durante las próximas 24 horas">
            <rect x={pad.left} y={pad.top} width={plotWidth} height={plotHeight} fill="#071b16" rx="3" />
            {passes.map((pass, index) => <rect key={`${pass.aos}-${index}`} x={x(pass.aos)} y={pad.top} width={Math.max(1, x(pass.los) - x(pass.aos))} height={plotHeight} fill="#40c978" opacity=".12" />)}
            {[0, 30, 60, 90].map((level) => <g key={level}><line x1={pad.left} x2={width - pad.right} y1={y(level)} y2={y(level)} stroke="#224536" strokeWidth=".7" /><text x="2" y={y(level) + 3} fill="#8aab9c" fontSize="8">{level}°</text></g>)}
            <line x1={pad.left} x2={width - pad.right} y1={y(mask)} y2={y(mask)} stroke="#e4af48" strokeDasharray="3 3" strokeWidth="1" />
            <text x={width - pad.right - 2} y={y(mask) - 3} textAnchor="end" fill="#e4af48" fontSize="8">máscara {mask}°</text>
            <path d={path} fill="none" stroke="#79d8ff" strokeWidth="1.35" vectorEffect="non-scaling-stroke" />
            {samples.filter((sample) => sample.visible).map((sample, index, visible) => index ? <line key={`${sample.time}-${index}`} x1={x(visible[index - 1].time)} y1={y(visible[index - 1].elevation_deg)} x2={x(sample.time)} y2={y(sample.elevation_deg)} stroke="#6ff0a1" strokeWidth="2.25" vectorEffect="non-scaling-stroke" /> : null)}
            {ticks.map((tick, index) => <g key={tick.toISOString()}><line x1={pad.left + index * plotWidth / 4} x2={pad.left + index * plotWidth / 4} y1={pad.top} y2={pad.top + plotHeight} stroke="#1a382c" strokeWidth=".65" /><text x={pad.left + index * plotWidth / 4} y={height - 19} textAnchor={index === 0 ? "start" : index === 4 ? "end" : "middle"} fill="#b5cbbc" fontSize="7.6">{formatter.format(tick).replace(",", "")}</text></g>)}
            <text x={pad.left + plotWidth / 2} y={height - 5} textAnchor="middle" fill="#8aab9c" fontSize="8">Hora local de la estación ({timeZone})</text>
        </svg>
        <p className="m-0 px-1 pb-0.5 text-[9px] leading-snug text-[#86a999]">Azul: elevación calculada. Verde: por encima de la máscara de la estación.</p>
    </div>;
}

export default function GroundStationsPanel() {
    const [open, setOpen] = useState(false);
    const [state, setState] = useState(initialState);
    const [stationId, setStationId] = useState("");
    const [satelliteId, setSatelliteId] = useState("");
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [floating, setFloating] = useState(false);
    const [position, setPosition] = useState({ x: 120, y: 100 });
    const [drag, setDrag] = useState(null);

    useEffect(() => {
        const refresh = () => window.dispatchEvent(new Event("orbit:ground-stations-request-state"));
        const show = () => { setFloating(false); setOpen(true); refresh(); };
        const hide = () => setOpen(false);
        const receive = (event) => setState(event.detail || initialState);
        const receiveResult = (event) => { setLoading(false); setResult(event.detail || null); };
        const openPasses = (event) => { setStationId(String(event.detail?.stationId || "")); setPosition({ x: Math.max(16, Math.round((window.innerWidth - 620) / 2)), y: 96 }); setFloating(true); setOpen(true); refresh(); };
        window.addEventListener("orbit:ground-stations-open", show);
        window.addEventListener("orbit:ground-stations-close", hide);
        window.addEventListener("orbit:ground-stations-state", receive);
        window.addEventListener("orbit:ground-stations-analysis-result", receiveResult);
        window.addEventListener("orbit:ground-station-passes-open", openPasses);
        return () => {
            window.removeEventListener("orbit:ground-stations-open", show);
            window.removeEventListener("orbit:ground-stations-close", hide);
            window.removeEventListener("orbit:ground-stations-state", receive);
            window.removeEventListener("orbit:ground-stations-analysis-result", receiveResult);
            window.removeEventListener("orbit:ground-station-passes-open", openPasses);
        };
    }, []);

    useEffect(() => {
        if (!drag) return undefined;
        const move = (event) => setPosition({ x: Math.max(8, Math.min(window.innerWidth - 330, event.clientX - drag.x)), y: Math.max(72, Math.min(window.innerHeight - 160, event.clientY - drag.y)) });
        const stop = () => setDrag(null);
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    }, [drag]);

    useEffect(() => { if (!stationId && state.stations[0]) setStationId(state.stations[0].id); }, [state.stations, stationId]);
    useEffect(() => { if (!satelliteId && state.satellites[0]) setSatelliteId(state.satellites[0].id); }, [state.satellites, satelliteId]);
    const station = useMemo(() => state.stations.find((item) => item.id === stationId), [state.stations, stationId]);
    const liveLinkBudgetDbm = Number.isFinite(Number(result?.rangeKm)) && station
        ? Number(station.tx_power_dbm) + Number(station.tx_gain_dbi || 0) + Number(station.rx_gain_dbi || 0) - (32.44 + (20 * Math.log10(Number(station.frequency_mhz))) + (20 * Math.log10(Number(result.rangeKm))))
        : Number.NaN;

    if (!open) return null;
    const analyze = () => {
        if (!stationId || !satelliteId) return;
        setLoading(true);
        window.dispatchEvent(new CustomEvent("orbit:ground-stations-analyze", { detail: { stationId, satelliteId } }));
    };
    return <aside className={`${floating ? "fixed z-[10140] flex max-h-[calc(100dvh-112px)] w-[min(620px,calc(100vw-24px))]" : "fixed top-[82px] right-3 z-[10140] flex max-h-[calc(100dvh-102px)] w-[min(390px,calc(100vw-24px))]"} flex-col overflow-hidden rounded-[12px] border border-[#2b4e7b] bg-[rgba(7,16,31,.96)] font-[system-ui,sans-serif] text-[#e7f0ff] shadow-[0_18px_48px_rgba(0,0,0,.48)]`} style={floating ? { left: position.x, top: position.y } : undefined} aria-label="Operaciones de estaciones terrestres">
        <header onPointerDown={floating ? (event) => setDrag({ x: event.clientX - position.x, y: event.clientY - position.y }) : undefined} className={`flex items-center justify-between border-b border-[#203956] px-3 py-2.5${floating ? " cursor-move" : ""}`}><div><h2 className="m-0 text-[13px] font-bold tracking-wide">{floating ? "TABLAS AOS / LOS" : "GROUND STATIONS"}</h2><p className="mt-0.5 mb-0 text-[10px] text-[#8ea4c4]">{floating ? "Arrastra esta barra para mover el análisis" : "Operación de pases y visibilidad"}</p></div><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => floating ? setOpen(false) : window.dispatchEvent(new Event("orbit:ground-stations-close"))} className="grid size-7 place-items-center rounded-md border border-[#294565] bg-transparent text-[#b9c9df] hover:bg-[#13233a]" aria-label="Cerrar">×</button></header>
        <div className="grid gap-3 overflow-y-auto p-3">
            <section className="rounded-lg border border-[#203956] bg-[rgba(13,29,51,.7)] p-2.5"><div className="mb-2 flex items-center justify-between"><strong className="text-[11px]">Estación activa</strong>{!floating && <button type="button" onClick={() => { setOpen(false); window.dispatchEvent(new Event("orbit:ground-stations-create-request")); }} className="rounded-md border border-[#466cff] bg-[#263f96] px-2 py-1 text-[10px] font-bold text-white">+ Añadir</button>}</div>{state.stations.length ? <select className={inputClass} value={stationId} onChange={(event) => { setStationId(event.target.value); setResult(null); }}>{state.stations.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.latitude_deg.toFixed(3)}°, {item.longitude_deg.toFixed(3)}°</option>)}</select> : <p className="m-0 text-[11px] text-[#aabbd2]">Crea una estación para iniciar un análisis.</p>}{station && <><p className="mb-0 text-[10px] text-[#8ea4c4]">Máscara aplicada: {station.min_elevation_deg}° · ITRF/WGS‑84</p>{!floating && <div className="mt-2"><button type="button" onClick={() => { setPosition({ x: Math.max(16, Math.round((window.innerWidth - 620) / 2)), y: 96 }); setFloating(true); }} className="rounded border border-[#3f785e] bg-transparent px-2 py-1 text-[10px] font-bold text-[#a8ebc5]">Tablas AOS / LOS</button></div>}</>}</section>
            {station && <section className="rounded-lg border border-[#285345] bg-[rgba(7,31,26,.62)] p-2.5"><div className="flex items-center justify-between gap-3"><strong className="text-[11px]">Configuración aplicada</strong><strong className="shrink-0 text-[10px] text-[#8cebb1]">RF {Number(station.radio_range_km || 0).toFixed(1)} km</strong></div><p className="my-1 text-[9px] leading-snug text-[#96bba7]">Parámetros de solo lectura. Edítalos al crear la estación o desde sus datos.</p><div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]"><span className="text-[#9fc7b1]">Máscara</span><strong className="text-right">{Number(station.min_elevation_deg).toFixed(1)}°</strong><span className="text-[#9fc7b1]">Frecuencia</span><strong className="text-right">{Number(station.frequency_mhz).toFixed(1)} MHz</strong><span className="text-[#9fc7b1]">Potencia TX</span><strong className="text-right">{Number(station.tx_power_dbm).toFixed(1)} dBm</strong><span className="text-[#9fc7b1]">G TX / G RX</span><strong className="text-right">{Number(station.tx_gain_dbi).toFixed(1)} / {Number(station.rx_gain_dbi).toFixed(1)} dBi</strong><span className="text-[#9fc7b1]">RX mínima</span><strong className="text-right">{Number(station.min_link_power_dbm ?? -80).toFixed(1)} dBm</strong></div></section>}
            <section className="rounded-lg border border-[#203956] bg-[rgba(13,29,51,.7)] p-2.5"><strong className="text-[11px]">Analizar pases</strong><label className="mt-2 grid gap-1 text-[10px] text-[#9fb3d0]">Satélite<select className={inputClass} value={satelliteId} onChange={(event) => { setSatelliteId(event.target.value); setResult(null); }} disabled={!state.satellites.length}><option value="">Selecciona una capa</option>{state.satellites.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{!state.satellites.length && <p className="mb-0 text-[10px] text-[#d8aa67]">No hay satélites disponibles en Layers.</p>}{station && <p className="mb-0 text-[10px] text-[#8ea4c4]">Usa la máscara de {station.name}: {station.min_elevation_deg}°.</p>}<button type="button" disabled={!stationId || !satelliteId || loading} onClick={analyze} className="mt-3 w-full rounded-md border border-[#597dff] bg-[#304dc0] py-2 text-[11px] font-bold text-white disabled:opacity-45">{loading ? "Calculando…" : "Analizar pases"}</button></section>
            {result && <section className="rounded-lg border border-[#2b5b4a] bg-[rgba(11,46,37,.5)] p-2.5"><div className="flex justify-between"><strong className="text-[11px]">Resultado</strong><span className="text-[10px] text-[#8fe7b7]">{result.visibleNow ? "IN VIEW" : "OUT OF VIEW"}</span></div><p className="my-1 text-[10px] text-[#b8d6c7]">{result.error || `${result.satellite} · ${result.referenceFrame || "ITRF"} · ${result.passes?.length || 0} pases`}</p>{Number.isFinite(result.rangeKm) && <div className="mb-2 grid grid-cols-2 gap-1 rounded border border-[#285143] bg-[rgba(4,22,17,.46)] p-1.5 text-[10px]"><span className="text-[#9fc7b1]">Distancia actual</span><strong className="text-right text-[#e1faea]">{Number(result.rangeKm).toFixed(1)} km</strong><span className="text-[#9fc7b1]">Presupuesto enlace</span><strong className="text-right text-[#a7edc1]">{Number.isFinite(liveLinkBudgetDbm) ? `${liveLinkBudgetDbm.toFixed(1)} dBm` : "-"}</strong></div>}<PassElevationChart result={result} /><div className="mt-2 grid gap-1">{(result.passes || []).slice(0, 6).map((pass, index) => <div className="rounded border border-[#265143] bg-[rgba(5,20,17,.42)] px-2 py-1.5 text-[10px]" key={`${pass.aos}-${index}`}><strong>Pase {index + 1}</strong><span className="float-right text-[#9ee8bf]">máx. {Number(pass.max_elevation_deg).toFixed(1)}°</span><div className="mt-1 text-[#b4cbbf]">AOS {utc(pass.aos)} · LOS {utc(pass.los)}</div></div>)}</div>{result.passes?.length ? <button className="mt-2 rounded border border-[#3f785e] bg-transparent px-2 py-1 text-[10px] font-bold text-[#a8ebc5]" type="button" onClick={() => exportPasses(result)}>Exportar CSV</button> : <p className="mb-0 text-[10px] text-[#b4cbbf]">No hay pases en la ventana de 24 horas.</p>}</section>}
        </div>
    </aside>;
}
