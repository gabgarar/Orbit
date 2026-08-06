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
    const samples = Array.isArray(result?.samples) ? result.samples : [];
    if (samples.length < 2) return null;
    const start = Date.parse(samples[0].time);
    const end = Date.parse(samples[samples.length - 1].time);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const width = 340; const height = 154; const pad = { left: 29, right: 9, top: 12, bottom: 39 };
    const plotWidth = width - pad.left - pad.right; const plotHeight = height - pad.top - pad.bottom;
    const mask = Number(result?.station?.min_elevation_deg ?? 0);
    const x = (time) => pad.left + ((Date.parse(time) - start) / (end - start)) * plotWidth;
    const y = (elevation) => pad.top + ((90 - Math.max(-10, Math.min(90, Number(elevation)))) / 100) * plotHeight;
    const path = samples.map((sample, index) => `${index ? "L" : "M"}${x(sample.time).toFixed(1)},${y(sample.elevation_deg).toFixed(1)}`).join(" ");
    const passes = Array.isArray(result?.passes) ? result.passes : [];
    const timeZone = String(result?.stationTimeZone || "UTC").trim() || "UTC";
    let formatter;
    try {
        formatter = new Intl.DateTimeFormat(undefined, { timeZone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "shortOffset" });
    } catch {
        formatter = new Intl.DateTimeFormat(undefined, { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "shortOffset" });
    }
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => new Date(start + ((end - start) * fraction)));
    return <div className="mt-3 rounded-md border border-[#285345] bg-[#061611] px-1.5 py-1.5">
        <div className="mb-1 flex items-center justify-between px-1 text-[9px] font-bold tracking-wide text-[#a9d8bf]"><span>PERFIL DE ELEVACIÓN</span><span>{timeZone} · muestras 30 s</span></div>
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
    const [monitoringStationId, setMonitoringStationId] = useState("");
    const [monitoredIds, setMonitoredIds] = useState([]);
    const [monitoringSatellite, setMonitoringSatellite] = useState(null);
    const [selectedStationIds, setSelectedStationIds] = useState([]);
    const [floating, setFloating] = useState(false);
    const [position, setPosition] = useState({ x: 120, y: 100 });
    const [drag, setDrag] = useState(null);

    useEffect(() => {
        const refresh = () => window.dispatchEvent(new Event("orbit:ground-stations-request-state"));
        const show = () => { setFloating(false); setOpen(true); refresh(); };
        const hide = () => setOpen(false);
        const receive = (event) => setState(event.detail || initialState);
        const receiveResult = (event) => { setLoading(false); setResult(event.detail || null); };
        const openMonitoring = (event) => {
            const nextStationId = String(event.detail?.stationId || "");
            setMonitoringStationId(nextStationId);
            setOpen(true); refresh();
        };
        const openPasses = (event) => { setStationId(String(event.detail?.stationId || "")); setPosition({ x: Math.max(16, Math.round((window.innerWidth - 620) / 2)), y: 96 }); setFloating(true); setOpen(true); refresh(); };
        const openSatelliteMonitoring = (event) => { setMonitoringSatellite(event.detail || null); setOpen(true); refresh(); };
        window.addEventListener("orbit:ground-stations-open", show);
        window.addEventListener("orbit:ground-stations-close", hide);
        window.addEventListener("orbit:ground-stations-state", receive);
        window.addEventListener("orbit:ground-stations-analysis-result", receiveResult);
        window.addEventListener("orbit:ground-stations-monitoring-open", openMonitoring);
        window.addEventListener("orbit:ground-station-passes-open", openPasses);
        window.addEventListener("orbit:ground-stations-satellite-monitoring-open", openSatelliteMonitoring);
        return () => {
            window.removeEventListener("orbit:ground-stations-open", show);
            window.removeEventListener("orbit:ground-stations-close", hide);
            window.removeEventListener("orbit:ground-stations-state", receive);
            window.removeEventListener("orbit:ground-stations-analysis-result", receiveResult);
            window.removeEventListener("orbit:ground-stations-monitoring-open", openMonitoring);
            window.removeEventListener("orbit:ground-station-passes-open", openPasses);
            window.removeEventListener("orbit:ground-stations-satellite-monitoring-open", openSatelliteMonitoring);
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
    useEffect(() => { if (monitoringStationId) setMonitoredIds(state.stations.find((item) => item.id === monitoringStationId)?.monitor_satellite_ids || []); }, [monitoringStationId, state.stations]);
    useEffect(() => { if (monitoringSatellite?.satelliteId) setSelectedStationIds(state.stations.filter((item) => item.monitor_satellite_ids?.includes(monitoringSatellite.satelliteId)).map((item) => item.id)); }, [monitoringSatellite, state.stations]);
    const station = useMemo(() => state.stations.find((item) => item.id === stationId), [state.stations, stationId]);
    const monitoringStation = useMemo(() => state.stations.find((item) => item.id === monitoringStationId), [state.stations, monitoringStationId]);
    const liveLinkBudgetDbm = Number.isFinite(Number(result?.rangeKm)) && station
        ? Number(station.tx_power_dbm) + Number(station.tx_gain_dbi || 0) + Number(station.rx_gain_dbi || 0) - (32.44 + (20 * Math.log10(Number(station.frequency_mhz))) + (20 * Math.log10(Number(result.rangeKm))))
        : Number.NaN;

    if (!open) return null;
    const toggleMonitored = (id) => setMonitoredIds((current) => current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]);
    const updateStation = (patch) => {
        if (!stationId) return;
        window.dispatchEvent(new CustomEvent("orbit:ground-stations-update", { detail: { stationId, patch } }));
    };
    const analyze = () => {
        if (!stationId || !satelliteId) return;
        setLoading(true);
        window.dispatchEvent(new CustomEvent("orbit:ground-stations-analyze", { detail: { stationId, satelliteId, minElevationDeg: Number(station?.min_elevation_deg) } }));
    };
    return <aside className={`${floating ? "fixed z-[10140] flex max-h-[calc(100dvh-112px)] w-[min(620px,calc(100vw-24px))]" : "fixed top-[82px] right-3 z-[10140] flex max-h-[calc(100dvh-102px)] w-[min(390px,calc(100vw-24px))]"} flex-col overflow-hidden rounded-[12px] border border-[#2b4e7b] bg-[rgba(7,16,31,.96)] font-[system-ui,sans-serif] text-[#e7f0ff] shadow-[0_18px_48px_rgba(0,0,0,.48)]`} style={floating ? { left: position.x, top: position.y } : undefined} aria-label="Operaciones de estaciones terrestres">
        <header onPointerDown={floating ? (event) => setDrag({ x: event.clientX - position.x, y: event.clientY - position.y }) : undefined} className={`flex items-center justify-between border-b border-[#203956] px-3 py-2.5${floating ? " cursor-move" : ""}`}><div><h2 className="m-0 text-[13px] font-bold tracking-wide">{floating ? "TABLAS AOS / LOS" : "GROUND STATIONS"}</h2><p className="mt-0.5 mb-0 text-[10px] text-[#8ea4c4]">{floating ? "Arrastra esta barra para mover el análisis" : "Operación de pases y visibilidad"}</p></div><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => floating ? setOpen(false) : window.dispatchEvent(new Event("orbit:ground-stations-close"))} className="grid size-7 place-items-center rounded-md border border-[#294565] bg-transparent text-[#b9c9df] hover:bg-[#13233a]" aria-label="Cerrar">×</button></header>
        <div className="grid gap-3 overflow-y-auto p-3">
            <section className="rounded-lg border border-[#203956] bg-[rgba(13,29,51,.7)] p-2.5"><div className="mb-2 flex items-center justify-between"><strong className="text-[11px]">Estación activa</strong><button type="button" onClick={() => { setOpen(false); window.dispatchEvent(new Event("orbit:ground-stations-create-request")); }} className="rounded-md border border-[#466cff] bg-[#263f96] px-2 py-1 text-[10px] font-bold text-white">+ Añadir</button></div>{state.stations.length ? <select className={inputClass} value={stationId} onChange={(event) => { setStationId(event.target.value); setResult(null); }}>{state.stations.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.latitude_deg.toFixed(3)}°, {item.longitude_deg.toFixed(3)}°</option>)}</select> : <p className="m-0 text-[11px] text-[#aabbd2]">Crea una estación para iniciar un análisis.</p>}{station && <><p className="mb-0 text-[10px] text-[#8ea4c4]">Máscara aplicada: {station.min_elevation_deg}° · ITRF/WGS‑84</p><div className="mt-2 flex gap-2"><button type="button" onClick={() => { setMonitoringStationId(station.id); setMonitoredIds(station.monitor_satellite_ids || []); }} className="rounded border border-[#315d92] bg-transparent px-2 py-1 text-[10px] font-bold text-[#a8c7ff]">Satélites monitorizados ({station.monitor_satellite_ids?.length || 0})</button><button type="button" onClick={() => { setPosition({ x: Math.max(16, Math.round((window.innerWidth - 620) / 2)), y: 96 }); setFloating(true); }} className="rounded border border-[#3f785e] bg-transparent px-2 py-1 text-[10px] font-bold text-[#a8ebc5]">Tablas AOS / LOS</button></div></>}</section>
            {station && <section className="rounded-lg border border-[#294a70] bg-[rgba(12,27,49,.86)] p-2.5"><div className="mb-2 flex items-center justify-between"><strong className="text-[11px]">Estación en directo</strong><span className="text-[9px] font-bold text-[#78b8ff]">CAMBIOS EN CALIENTE</span></div><label className="grid gap-1 text-[10px] text-[#a9bdd7]">Máscara de elevación <span className="text-[#e8efff]">{Number(station.min_elevation_deg).toFixed(1)}°</span><input className="accent-[#5379ff]" type="range" min="0" max="45" step="0.5" value={station.min_elevation_deg} onChange={(event) => updateStation({ min_elevation_deg: Number(event.target.value) })} /></label><div className="mt-2 grid grid-cols-2 gap-2"><label className="grid gap-1 text-[10px] text-[#a9bdd7]">Potencia TX (dBm)<input className={inputClass} type="number" value={station.tx_power_dbm} onChange={(event) => Number.isFinite(Number(event.target.value)) && updateStation({ tx_power_dbm: Number(event.target.value) })} /></label><label className="grid gap-1 text-[10px] text-[#a9bdd7]">Frecuencia (MHz)<input className={inputClass} type="number" value={station.frequency_mhz} onChange={(event) => Number.isFinite(Number(event.target.value)) && updateStation({ frequency_mhz: Number(event.target.value) })} /></label></div></section>}
            {station && <section className="rounded-lg border border-[#285345] bg-[rgba(7,31,26,.62)] p-2.5"><div className="flex items-center justify-between gap-3"><strong className="text-[11px]">Envolvente RF</strong><strong className="shrink-0 text-[10px] text-[#8cebb1]">{Number(station.radio_range_km || 0).toFixed(1)} km</strong></div><p className="my-1 text-[9px] leading-snug text-[#96bba7]">Círculo calculado por Friis. La distancia geométrica al satélite no cambia.</p><div className="mt-2 grid grid-cols-2 gap-2"><label className="grid min-w-0 gap-1 text-[9px] text-[#a9cbb9]">Ganancia TX (dBi)<input className={`${inputClass} min-w-0`} type="number" value={station.tx_gain_dbi} onChange={(event) => Number.isFinite(Number(event.target.value)) && updateStation({ tx_gain_dbi: Number(event.target.value) })} /></label><label className="grid min-w-0 gap-1 text-[9px] text-[#a9cbb9]">Ganancia RX (dBi)<input className={`${inputClass} min-w-0`} type="number" value={station.rx_gain_dbi} onChange={(event) => Number.isFinite(Number(event.target.value)) && updateStation({ rx_gain_dbi: Number(event.target.value) })} /></label><label className="col-span-2 grid min-w-0 gap-1 text-[9px] text-[#a9cbb9]">Potencia mínima recibida (dBm)<input className={`${inputClass} min-w-0`} type="number" value={station.min_link_power_dbm ?? -80} onChange={(event) => Number.isFinite(Number(event.target.value)) && updateStation({ min_link_power_dbm: Number(event.target.value) })} /></label></div></section>}
            <section className="rounded-lg border border-[#203956] bg-[rgba(13,29,51,.7)] p-2.5"><strong className="text-[11px]">Analizar pases</strong><label className="mt-2 grid gap-1 text-[10px] text-[#9fb3d0]">Satélite<select className={inputClass} value={satelliteId} onChange={(event) => { setSatelliteId(event.target.value); setResult(null); }} disabled={!state.satellites.length}><option value="">Selecciona una capa</option>{state.satellites.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{!state.satellites.length && <p className="mb-0 text-[10px] text-[#d8aa67]">El análisis operativo actual usa capas con TLE/SGP4.</p>}{station && <p className="mb-0 text-[10px] text-[#8ea4c4]">Usa la máscara de {station.name}: {station.min_elevation_deg}°.</p>}<button type="button" disabled={!stationId || !satelliteId || loading} onClick={analyze} className="mt-3 w-full rounded-md border border-[#597dff] bg-[#304dc0] py-2 text-[11px] font-bold text-white disabled:opacity-45">{loading ? "Calculando…" : "Analizar pases"}</button></section>
            {result && <section className="rounded-lg border border-[#2b5b4a] bg-[rgba(11,46,37,.5)] p-2.5"><div className="flex justify-between"><strong className="text-[11px]">Resultado</strong><span className="text-[10px] text-[#8fe7b7]">{result.visibleNow ? "IN VIEW" : "OUT OF VIEW"}</span></div><p className="my-1 text-[10px] text-[#b8d6c7]">{result.error || `${result.satellite} · ${result.referenceFrame || "ITRF"} · ${result.passes?.length || 0} pases`}</p>{Number.isFinite(result.rangeKm) && <div className="mb-2 grid grid-cols-2 gap-1 rounded border border-[#285143] bg-[rgba(4,22,17,.46)] p-1.5 text-[10px]"><span className="text-[#9fc7b1]">Distancia actual</span><strong className="text-right text-[#e1faea]">{Number(result.rangeKm).toFixed(1)} km</strong><span className="text-[#9fc7b1]">Presupuesto enlace</span><strong className="text-right text-[#a7edc1]">{Number.isFinite(liveLinkBudgetDbm) ? `${liveLinkBudgetDbm.toFixed(1)} dBm` : "-"}</strong></div>}<PassElevationChart result={result} /><div className="mt-2 grid gap-1">{(result.passes || []).slice(0, 6).map((pass, index) => <div className="rounded border border-[#265143] bg-[rgba(5,20,17,.42)] px-2 py-1.5 text-[10px]" key={`${pass.aos}-${index}`}><strong>Pase {index + 1}</strong><span className="float-right text-[#9ee8bf]">máx. {Number(pass.max_elevation_deg).toFixed(1)}°</span><div className="mt-1 text-[#b4cbbf]">AOS {utc(pass.aos)} · LOS {utc(pass.los)}</div></div>)}</div>{result.passes?.length ? <button className="mt-2 rounded border border-[#3f785e] bg-transparent px-2 py-1 text-[10px] font-bold text-[#a8ebc5]" type="button" onClick={() => exportPasses(result)}>Exportar CSV</button> : <p className="mb-0 text-[10px] text-[#b4cbbf]">No hay pases en la ventana de 24 horas.</p>}</section>}
            {monitoringStation && <section className="rounded-lg border border-[#36547c] bg-[rgba(12,29,54,.88)] p-2.5"><div className="flex items-center justify-between"><strong className="text-[11px]">Monitorizar desde {monitoringStation.name}</strong><button type="button" onClick={() => setMonitoringStationId("")} className="border-0 bg-transparent text-[#a8bdd8]">×</button></div><p className="my-1 text-[10px] text-[#91a9c8]">Selecciona las capas TLE/SGP4 que esta estación debe seguir.</p><div className="grid max-h-36 gap-1 overflow-y-auto">{state.satellites.map((item) => <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[10px] hover:bg-[#162945]" key={item.id}><input type="checkbox" checked={monitoredIds.includes(item.id)} onChange={() => toggleMonitored(item.id)} />{item.name}</label>)}</div><button type="button" onClick={() => { window.dispatchEvent(new CustomEvent("orbit:ground-stations-monitoring-save", { detail: { stationId: monitoringStation.id, satelliteIds: monitoredIds } })); setMonitoringStationId(""); }} className="mt-2 rounded border border-[#5279f8] bg-[#223b91] px-2 py-1.5 text-[10px] font-bold text-white">Guardar monitorización</button></section>}
            {monitoringSatellite && <section className="rounded-lg border border-[#36547c] bg-[rgba(12,29,54,.94)] p-2.5"><div className="flex items-center justify-between"><strong className="text-[11px]">Monitorizar {monitoringSatellite.satelliteName}</strong><button type="button" onClick={() => setMonitoringSatellite(null)} className="border-0 bg-transparent text-[#a8bdd8]">×</button></div><p className="my-1 text-[10px] text-[#91a9c8]">Elige qué estaciones deben seguir esta nueva capa.</p><div className="grid max-h-36 gap-1 overflow-y-auto">{state.stations.map((item) => <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-[10px] hover:bg-[#162945]" key={item.id}><input type="checkbox" checked={selectedStationIds.includes(item.id)} onChange={() => setSelectedStationIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />{item.name}</label>)}</div><button type="button" onClick={() => { window.dispatchEvent(new CustomEvent("orbit:ground-stations-satellite-monitoring-save", { detail: { satelliteId: monitoringSatellite.satelliteId, stationIds: selectedStationIds } })); setMonitoringSatellite(null); }} className="mt-2 rounded border border-[#5279f8] bg-[#223b91] px-2 py-1.5 text-[10px] font-bold text-white">Guardar monitorización</button></section>}
        </div>
    </aside>;
}
