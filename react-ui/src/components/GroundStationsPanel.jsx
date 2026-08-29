import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadChartPng } from "../../../front/js/runtime/chartPngExport.js";
import PanelCloseButton from "./PanelCloseButton.jsx";
import { openGroundStationExportMenu } from "./GroundStationExportMenu.jsx";
import { resolvePreciseProductFrameStatus } from "../../../front/js/features/preciseProducts/frameStatus.js";
import { describeEarthOrientationCoverageDetail } from "../../../front/js/features/timekeeping/eopCoveragePolicy.js";
import { publishGroundStationsPanelState } from "../hooks/useGroundStationsPanelVisibility.js";
import { CalendarIcon, GroundStationIcon, OrbitalSatelliteIcon, PassTableIcon } from "./icons.jsx";

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

function exportMenuAnchor(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { left: rect.left, top: rect.bottom + 6 };
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

function resolveStationTimeZone(...values) {
    for (const value of values) {
        const candidate = typeof value === "string" ? value.trim() : "";
        if (!candidate) continue;
        try {
            return new Intl.DateTimeFormat("en-GB", { timeZone: candidate }).resolvedOptions().timeZone || "UTC";
        } catch {
            // Imported station metadata can contain an obsolete or invalid
            // IANA identifier. Keep looking before falling back to UTC.
        }
    }
    return "UTC";
}

function formatStationTime(value, timeZone, { includeZone = true } = {}) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const resolvedTimeZone = resolveStationTimeZone(timeZone);
    return new Intl.DateTimeFormat("es-ES", {
        timeZone: resolvedTimeZone,
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        ...(includeZone ? { timeZoneName: "short" } : {})
    }).format(date).replace(",", "");
}

function formatStationAxisTime(value, timeZone) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("es-ES", {
        timeZone: resolveStationTimeZone(timeZone),
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    }).format(date).replace(",", "");
}

function formatPassDuration(startValue, endValue) {
    const start = Date.parse(startValue);
    const end = Date.parse(endValue);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
    const totalSeconds = Math.round((end - start) / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
    }
    return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}

function stationAnalysisFingerprint(station) {
    if (!station) return "";
    // Runtime publishes this exact signature from the same RF/geometry
    // contract used to invalidate a running pass request. It means a change
    // to any operational station parameter causes one reliable refresh,
    // without making the panel react to clock ticks or cosmetic changes.
    if (typeof station.analysis_signature === "string" && station.analysis_signature) {
        return `${station.id}|${station.analysis_signature}`;
    }
    const rf = station.rf || {};
    // Keep automatic recalculation tied to the inputs that change the access
    // solution, rather than to every state publication (for example a clock
    // tick or a cosmetic layer-name refresh).
    return [
        station.id,
        station.latitude_deg,
        station.longitude_deg,
        station.altitude_m,
        station.min_elevation_deg,
        station.radio_range_km,
        station.frequency_mhz,
        rf.operation_mode,
        rf.mechanical_elevation_min_deg,
        rf.mechanical_elevation_max_deg,
        rf.mechanical_azimuth_min_deg,
        rf.mechanical_azimuth_max_deg,
        rf.boresight_azimuth_deg,
        rf.boresight_elevation_deg,
        rf.hpbw_azimuth_deg,
        rf.hpbw_elevation_deg,
        rf.pattern_type,
        rf.side_lobe_level_db
    ].map((value) => value ?? "").join("|");
}

function ContextGlyph({ children, tone = "blue" }) {
    const tones = {
        blue: "border-[#315982] bg-[rgba(35,76,124,.2)] text-[#99bdff]",
        green: "border-[#316c51] bg-[rgba(24,80,54,.2)] text-[#92efba]",
        violet: "border-[#6652a3] bg-[rgba(78,53,128,.2)] text-[#c5b4ff]",
        amber: "border-[#765d31] bg-[rgba(91,65,22,.24)] text-[#f2cf7b]"
    };
    return <span className={`grid size-7 shrink-0 place-items-center rounded-md border ${tones[tone] || tones.blue} [&>svg]:size-3.5 [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.8]`}>{children}</span>;
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

function resultFrameStatus(result) {
    const rendererReference = result?.rendererReference ?? result?.renderer_reference;
    const sourceFormat = String(result?.sourceFormat ?? result?.source_format ?? "").toUpperCase();
    if (!rendererReference && sourceFormat !== "SP3") return null;
    return resolvePreciseProductFrameStatus({
        sp3: result?.sp3 ?? result?.preciseProduct ?? result?.precise_product ?? null,
        renderer_reference: rendererReference,
        earth_orientation: result?.earthOrientation ?? result?.earth_orientation ?? null
    }, { runtimeFrame: result?.referenceFrame ?? result?.reference_frame ?? "" });
}

function resultFrameLabel(result, frameStatus = resultFrameStatus(result)) {
    if (frameStatus) return frameStatus.displayFrame;
    const label = result?.referenceFrameLabel ?? result?.reference_frame_label
        ?? result?.referenceFrame ?? result?.reference_frame;
    const normalized = String(label || "").trim();
    return normalized || "Marco no declarado";
}

function earthOrientationResultNotice(result) {
    const actual = result?.earthOrientationProvenance;
    const preflight = result?.earthOrientationPreflight;
    const detail = actual || preflight;
    if (!detail || detail.requiresNotice !== true || !Array.isArray(detail.segments) || !detail.segments.length) {
        return null;
    }
    return {
        actual: Boolean(actual),
        warning: detail.requiresWarning === true,
        message: describeEarthOrientationCoverageDetail(detail, {
            operation: actual ? "Proveniencia de orientación terrestre" : "Preflight de orientación terrestre"
        })
    };
}

function PassesTable({ passes, timeZone, selectedPassIndex, onSelectPass }) {
    const rows = Array.isArray(passes) ? passes : [];
    const displayTimeZone = resolveStationTimeZone(timeZone);
    return <div className="orbit-scrollbar mt-2 max-h-[300px] overflow-auto rounded-[8px] border border-[#294967] bg-[rgba(5,16,29,.7)]" data-testid="ground-station-pass-table">
        <table className="w-full min-w-[520px] border-collapse text-left text-[10px]">
            <caption className="sr-only">Pases calculados. Selecciona una fila para consultar su perfil de elevación.</caption>
            <thead className="sticky top-0 z-[1] bg-[rgba(16,39,63,.98)] text-[9px] font-bold uppercase tracking-[.06em] text-[#9fbbe0] shadow-[0_1px_0_#33516f]">
                <tr>
                    <th scope="col" className="w-12 px-2 py-1.5">Pase</th>
                    <th scope="col" className="px-2 py-1.5">AOS ({displayTimeZone})</th>
                    <th scope="col" className="px-2 py-1.5">LOS ({displayTimeZone})</th>
                    <th scope="col" className="px-2 py-1.5 text-right">Máx.</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#203a55] text-[#d1def0]">
                {rows.map((pass, index) => {
                    const maxElevation = Number(pass.max_elevation_deg);
                    const selected = index === selectedPassIndex;
                    const label = `Pase ${index + 1}. AOS ${formatStationTime(pass.aos, displayTimeZone)}. LOS ${formatStationTime(pass.los, displayTimeZone)}.`;
                    const select = () => onSelectPass?.(index);
                    return <tr
                        key={`${pass.aos}-${pass.los}-${index}`}
                        data-testid="ground-station-pass-row"
                        aria-selected={selected}
                        tabIndex={0}
                        title="Ver perfil de elevación de este pase"
                        className={`cursor-pointer outline-none transition-colors hover:bg-[rgba(45,79,118,.28)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#79b7ff] ${selected ? "bg-[linear-gradient(90deg,rgba(45,116,76,.38),rgba(30,74,63,.16))] shadow-[inset_3px_0_0_#77e5a3]" : ""}`}
                        onClick={select}
                        onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            select();
                        }}
                        aria-label={label}
                    >
                        <th scope="row" className="px-2 py-2 font-semibold text-[#e7f1ff]">{String(index + 1).padStart(2, "0")}</th>
                        <td className="whitespace-nowrap px-2 py-2">{formatStationTime(pass.aos, displayTimeZone)}</td>
                        <td className="whitespace-nowrap px-2 py-2">{formatStationTime(pass.los, displayTimeZone)}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-right font-semibold text-[#9ee8bf]">{Number.isFinite(maxElevation) ? `${maxElevation.toFixed(1)}°` : "—"}</td>
                    </tr>;
                })}
            </tbody>
        </table>
    </div>;
}

function PassElevationChart({ result, timeZone: stationTimeZone, selectedPassIndex }) {
    const svgRef = useRef(null);
    const allSamples = Array.isArray(result?.samples) ? result.samples : [];
    const sampleStepSeconds = Number(result?.step_seconds);
    const sampleStepLabel = Number.isFinite(sampleStepSeconds) && sampleStepSeconds > 0
        ? `${Math.round(sampleStepSeconds)} s`
        : "10 s";
    const passes = Array.isArray(result?.passes) ? result.passes : [];
    const orderedPasses = [...passes].sort((left, right) => Date.parse(left.aos) - Date.parse(right.aos));
    const focusedPass = Number.isInteger(selectedPassIndex) ? orderedPasses[selectedPassIndex] || null : null;
    if (!focusedPass) return null;
    const focusedMaxElevation = Number(focusedPass.max_elevation_deg);
    const focusedMaxElevationLabel = Number.isFinite(focusedMaxElevation) ? `${focusedMaxElevation.toFixed(1)}°` : "—";
    const focusStart = focusedPass ? Date.parse(focusedPass.aos) - (120 * 1000) : Date.parse(allSamples[0]?.time);
    const focusEnd = focusedPass ? Date.parse(focusedPass.los) + (120 * 1000) : Date.parse(allSamples.at(-1)?.time);
    const samples = allSamples.filter((sample) => {
        const timestamp = Date.parse(sample.time);
        return Number.isFinite(timestamp) && timestamp >= focusStart && timestamp <= focusEnd;
    });
    if (samples.length < 2) return <section className="mt-3 rounded-[8px] border border-[#294866] bg-[rgba(8,19,35,.76)] px-3 py-2.5" data-testid="ground-station-pass-profile-empty">
        <strong className="block text-[11px] text-[#e4eefc]">Perfil de elevación</strong>
        <p className="mt-1 mb-0 text-[10px] leading-snug text-[#91a8c8]">El pase seleccionado no incluye suficientes muestras para dibujar el perfil. AOS y LOS siguen siendo los instantes refinados publicados por el análisis.</p>
    </section>;
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
    // API samples and AOS/LOS instants remain UTC. Only their presentation is
    // localized to the station so table, graph and operator view agree.
    const timeZone = resolveStationTimeZone(stationTimeZone, result?.stationTimeZone, result?.station?.time_zone);
    const frameLabel = resultFrameLabel(result);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => new Date(start + ((end - start) * fraction)));
    const passDuration = formatPassDuration(focusedPass.aos, focusedPass.los);
    return <section className="mt-4 rounded-[10px] border border-[#294967] bg-[linear-gradient(150deg,rgba(10,25,45,.98),rgba(5,15,30,.98))] p-3 shadow-[0_10px_28px_rgba(0,0,0,.18)]" data-testid="ground-station-pass-profile">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_11.5rem]">
            <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2 px-1"><div><strong className="block text-[11px] text-[#e4eefc]">Perfil de elevación</strong><span className="text-[9px] text-[#879bb8]">Pase {selectedPassIndex + 1} · {result.satellite} · máxima {focusedMaxElevationLabel}</span><span className="mt-0.5 block text-[9px] text-[#7189aa]">{formatStationTime(focusedPass.aos, timeZone)} → {formatStationTime(focusedPass.los, timeZone)} · {frameLabel} · cálculo {result.timeScale || "UTC"}</span></div><div className="flex items-center gap-2"><span className="hidden text-[9px] font-medium text-[#7189aa] lg:inline">Muestras ≤ {sampleStepLabel}</span><button className="inline-flex h-6 items-center rounded-[5px] border border-[#31506f] bg-[#0e2037] px-2 text-[9px] font-bold text-[#a9c7ed] hover:bg-[#173554]" type="button" onClick={() => downloadChartPng(svgRef.current, `passes-${result.satellite}`)}>Exportar PNG</button></div></div>
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
            {ticks.map((tick, index) => <g key={tick.toISOString()}><line x1={pad.left + index * plotWidth / 4} x2={pad.left + index * plotWidth / 4} y1={pad.top} y2={pad.top + plotHeight} stroke="#8090a3" strokeOpacity=".18" strokeWidth=".7" /><text x={pad.left + index * plotWidth / 4} y={height - 20} textAnchor={index === 0 ? "start" : index === 4 ? "end" : "middle"} fill="#8ea2bd" fontSize="9.5">{formatStationAxisTime(tick, timeZone)}</text></g>)}
            <text x={pad.left} y="17" fill="#d9eaff" fontSize="11.5" fontWeight="700">Elevación de {result.satellite} (deg)</text><text x={width - pad.right} y="17" fill="#89a6cb" fontSize="9.5" fontWeight="600" textAnchor="end">{frameLabel} · cálculo {result.timeScale || "UTC"}</text><text x={width - pad.right} y={height - 4} fill="#8197b5" fontSize="9.5" fontWeight="600" textAnchor="end">HORA LOCAL ({timeZone})</text>
        </svg>
        <p className="m-0 px-1 pt-1 text-[9px] leading-snug text-[#86a999]">Azul: elevación calculada. Verde: tramo operativo; usa el enlace de bajada si existe perfil RF satelital y, si no, la envolvente recíproca de planificación.</p>
            </div>
            <aside className="grid content-start gap-2" data-testid="ground-station-pass-kpis" aria-label="Indicadores del pase seleccionado">
                <div className="rounded-md border border-[#315f47] bg-[rgba(22,70,47,.2)] p-2.5">
                    <span className="block text-[10px] font-semibold uppercase tracking-[.06em] text-[#8cc9a2]">M&aacute;x. elevaci&oacute;n</span>
                    <strong className="mt-1 block text-[18px] leading-none text-[#a7efc2]">{focusedMaxElevationLabel}</strong>
                    <span className="mt-1 block text-[10px] text-[#82a692]">Pase {selectedPassIndex + 1}</span>
                </div>
                <div className="rounded-md border border-[#31506f] bg-[rgba(23,50,79,.24)] p-2.5">
                    <span className="block text-[10px] font-semibold uppercase tracking-[.06em] text-[#9dbde4]">Duraci&oacute;n del pase</span>
                    <strong className="mt-1 block text-[14px] leading-none text-[#e2edff]">{passDuration}</strong>
                    <span className="mt-1 block text-[10px] text-[#8198b8]">Ventana operativa</span>
                </div>
                <div className="rounded-md border border-[#396a54] bg-[rgba(16,61,44,.18)] p-2.5">
                    <span className="block text-[10px] font-semibold uppercase tracking-[.06em] text-[#8ecfac]">AOS</span>
                    <strong className="mt-1 block text-[11px] leading-snug text-[#dfeefa]">{formatStationTime(focusedPass.aos, timeZone)}</strong>
                </div>
                <div className="rounded-md border border-[#6652a3] bg-[rgba(69,43,117,.2)] p-2.5">
                    <span className="block text-[10px] font-semibold uppercase tracking-[.06em] text-[#b9a9f7]">LOS</span>
                    <strong className="mt-1 block text-[11px] leading-snug text-[#e7e2ff]">{formatStationTime(focusedPass.los, timeZone)}</strong>
                </div>
            </aside>
        </div>
    </section>;
}

function samplesForPass(result, pass) {
    const start = Date.parse(pass?.aos);
    const end = Date.parse(pass?.los);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
    return (Array.isArray(result?.samples) ? result.samples : []).filter((sample) => {
        const timestamp = Date.parse(sample?.time);
        return Number.isFinite(timestamp) && timestamp >= start && timestamp <= end;
    });
}

function PassTechnicalDetails({ result, selectedPass, selectedPassIndex, station, timeZone }) {
    const frameLabel = resultFrameLabel(result);
    const passSamples = samplesForPass(result, selectedPass);
    const ranges = passSamples
        .map((sample) => Number(sample?.range_km))
        .filter(Number.isFinite);
    const minimumRange = ranges.length ? Math.min(...ranges) : null;
    const maximumRange = ranges.length ? Math.max(...ranges) : null;
    const maxElevation = Number(selectedPass?.max_elevation_deg);
    const sampleStepSeconds = Number(result?.step_seconds);
    const sampleCadence = Number.isFinite(sampleStepSeconds) && sampleStepSeconds > 0
        ? `${Math.round(sampleStepSeconds)} s`
        : "no declarada";
    const source = result?.analysisWindow?.source === "simulation-range"
        ? "rango de simulación"
        : result?.analysisWindow?.source === "manual-design"
            ? "diseño manual"
            : "próximas 24 h";

    return <details open data-testid="ground-station-pass-technical-details" className="mt-3 rounded-[8px] border border-[#294967] bg-[rgba(7,19,34,.56)] px-3 py-2.5 text-[11px]">
        <summary className="cursor-pointer list-none font-semibold text-[#bdd2ec] [&::-webkit-details-marker]:hidden">Datos técnicos del análisis</summary>
        {selectedPass ? <div className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <div className="flex justify-between gap-3"><span className="text-[#8ca4c4]">Pase seleccionado</span><strong className="text-right text-[#dceaff]">{selectedPassIndex + 1}</strong></div>
            <div className="flex justify-between gap-3"><span className="text-[#8ca4c4]">Duración del pase</span><strong className="text-right text-[#acecc7]">{formatPassDuration(selectedPass.aos, selectedPass.los)}</strong></div>
            <div className="flex justify-between gap-3"><span className="text-[#8ca4c4]">AOS</span><strong className="text-right text-[#dceaff]">{formatStationTime(selectedPass.aos, timeZone)}</strong></div>
            <div className="flex justify-between gap-3"><span className="text-[#8ca4c4]">LOS</span><strong className="text-right text-[#dceaff]">{formatStationTime(selectedPass.los, timeZone)}</strong></div>
            <div className="flex justify-between gap-3"><span className="text-[#8ca4c4]">Máxima elevación</span><strong className="text-right text-[#acecc7]">{Number.isFinite(maxElevation) ? `${maxElevation.toFixed(1)}°` : "—"}</strong></div>
            <div className="flex justify-between gap-3"><span className="text-[#8ca4c4]">Época del máximo</span><strong className="text-right text-[#dceaff]">{formatStationTime(selectedPass.max_elevation_time, timeZone)}</strong></div>
            <div className="flex justify-between gap-3"><span className="text-[#8ca4c4]">Rango durante el pase</span><strong className="text-right text-[#dceaff]">{minimumRange === null || maximumRange === null ? "No publicado" : `${minimumRange.toFixed(1)}–${maximumRange.toFixed(1)} km`}</strong></div>
            <div className="flex justify-between gap-3"><span className="text-[#8ca4c4]">Muestras del perfil</span><strong className="text-right text-[#dceaff]">{passSamples.length ? `${passSamples.length} · ${sampleCadence}` : "No publicadas"}</strong></div>
            <div className="flex justify-between gap-3"><span className="text-[#8ca4c4]">Máscara aplicada</span><strong className="text-right text-[#dceaff]">{Number.isFinite(Number(station?.min_elevation_deg)) ? `${Number(station.min_elevation_deg).toFixed(1)}°` : "—"}</strong></div>
            <div className="flex justify-between gap-3"><span className="text-[#8ca4c4]">Marco / escala</span><strong className="text-right text-[#dceaff]">{frameLabel} · {result?.timeScale || "UTC"}</strong></div>
        </div> : <p className="mb-0 mt-2 text-[10px] leading-snug text-[#8ca4c4]">Selecciona un pase para mostrar sus instantes, máxima elevación, rango y muestras asociadas.</p>}
        <p className="mb-0 mt-2 text-[10px] leading-snug text-[#8ca4c4]">Ventana de cálculo: {result?.analysisWindow?.startTime ? `${utc(result.analysisWindow.startTime)} → ${utc(result.analysisWindow.endTime)}` : "no disponible"} · origen: {source}.</p>
    </details>;
}

function FloatingPassesWindow({
    floatingRect,
    station,
    stations,
    stationId,
    satellites,
    satelliteId,
    result,
    loading,
    stationTimeZone,
    passFrameStatus,
    earthOrientationNotice,
    orderedPasses,
    selectedPass,
    selectedPassIndex,
    onStationChange,
    onSatelliteChange,
    onAnalyze,
    onSelectPass,
    onClose,
    onBeginDrag,
    onBeginResize
}) {
    const selectedSatellite = satellites.find((item) => item.id === satelliteId);
    const latitude = Number(station?.latitude_deg);
    const longitude = Number(station?.longitude_deg);
    const stationLocation = Number.isFinite(latitude) && Number.isFinite(longitude)
        ? `${latitude.toFixed(3)}°, ${longitude.toFixed(3)}°`
        : "Posición no declarada";
    const analysisSource = result?.analysisWindow?.source === "simulation-range"
        ? "rango de simulación"
        : result?.analysisWindow?.source === "manual-design"
            ? "diseño manual"
            : "próximas 24 h";
    const floatingStyle = { left: floatingRect.x, top: floatingRect.y, width: floatingRect.width, height: floatingRect.height };
    return <aside className="fixed z-[10140] flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[10px] border border-[#2b4e7b] bg-[rgba(7,16,31,.98)] text-[#e7f0ff] shadow-[0_18px_48px_rgba(0,0,0,.48)] [font-family:var(--orbit-font-ui)]" style={floatingStyle} aria-label="Tablas AOS y LOS" aria-labelledby="ground-station-pass-dialog-title" role="dialog">
        <header data-testid="ground-station-pass-operational-header" onPointerDown={onBeginDrag} className="flex shrink-0 cursor-move select-none items-center justify-between gap-4 border-b border-[#203956] bg-[linear-gradient(90deg,rgba(14,31,54,.92),rgba(8,18,34,.84))] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
                <ContextGlyph tone="violet"><PassTableIcon /></ContextGlyph>
                <div className="min-w-0">
                    <h2 id="ground-station-pass-dialog-title" className="m-0 text-[14px] font-bold tracking-[.025em] text-[#edf4ff]">TABLAS AOS / LOS</h2>
                    <p className="mt-0.5 mb-0 text-[11px] text-[#93a9ca]">Análisis de pases de satélite</p>
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <span className={`hidden rounded-full border px-2 py-1 text-[10px] font-semibold sm:inline ${result?.visibleNow ? "border-[#407e5d] bg-[rgba(28,93,60,.32)] text-[#9ee8bf]" : "border-[#49657f] bg-[rgba(30,54,79,.36)] text-[#a8c8e9]"}`}>{result?.visibleNow ? "EN VISTA" : "ANÁLISIS"}</span>
                <PanelCloseButton label="Cerrar tablas AOS / LOS" onPointerDown={(event) => event.stopPropagation()} onClick={onClose} />
            </div>
        </header>
        <div className="orbit-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3.5">
            <section className="overflow-hidden rounded-[8px] border border-[#294967] bg-[linear-gradient(120deg,rgba(13,32,56,.9),rgba(8,21,38,.82))]" data-testid="ground-station-pass-context-summary" aria-label="Contexto operativo del análisis">
                <div className="grid min-w-0 md:grid-cols-3">
                    <div className="min-w-0 border-b border-[#294967] p-3 md:border-r md:border-b-0" data-testid="ground-station-pass-station-summary">
                        <div className="flex items-center gap-2">
                            <ContextGlyph tone="green"><GroundStationIcon /></ContextGlyph>
                            <div className="min-w-0"><span className="block text-[10px] font-semibold uppercase tracking-[.08em] text-[#8eac9c]">Estación activa</span><strong className="block truncate text-[12px] text-[#e1f5e8]">{station?.name || "Sin estación"}</strong></div>
                        </div>
                        <select className="mt-2 min-h-8 w-full rounded-md border border-[#31516d] bg-[#0a1728] px-2 text-[11px] font-semibold text-[#dceaff] outline-none focus:border-[#638dff] disabled:opacity-45" value={stationId} onChange={(event) => onStationChange(event.target.value)} disabled={!stations.length} aria-label="Estación activa">
                            {!stations.length && <option value="">Sin estaciones disponibles</option>}
                            {stations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                        </select>
                        <p className="mt-2 mb-0 text-[10px] leading-snug text-[#94a9c5]">{stationLocation} · Máscara {Number(station?.min_elevation_deg || 0).toFixed(1)}° · ITRF/WGS-84</p>
                    </div>
                    <div className="min-w-0 border-b border-[#294967] p-3 md:border-r md:border-b-0" data-testid="ground-station-pass-rf-summary">
                        <div className="flex items-center gap-2"><ContextGlyph tone="green"><GroundStationIcon /></ContextGlyph><div><span className="block text-[10px] font-semibold uppercase tracking-[.08em] text-[#8eac9c]">Configuración RF</span><strong className="block text-[12px] text-[#e1f5e8]">RF {Number(station?.radio_range_km || 0).toFixed(1)} km</strong></div></div>
                        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                            <div><dt className="text-[#8fa79c]">Frecuencia</dt><dd className="m-0 font-semibold text-[#d7eadd]">{Number(station?.frequency_mhz || 0).toFixed(1)} MHz</dd></div>
                            <div><dt className="text-[#8fa79c]">Modo</dt><dd className="m-0 font-semibold capitalize text-[#d7eadd]">{station?.rf?.operation_mode || "tracking"}</dd></div>
                        </dl>
                    </div>
                    <div className="min-w-0 p-3" data-testid="ground-station-pass-satellite-summary">
                        <div className="flex items-center gap-2"><ContextGlyph tone="violet"><OrbitalSatelliteIcon /></ContextGlyph><div className="min-w-0"><span className="block text-[10px] font-semibold uppercase tracking-[.08em] text-[#ad9ee5]">Satélite</span><strong className="block truncate text-[12px] text-[#eeeaff]">{selectedSatellite?.name || "Selecciona una capa"}</strong></div></div>
                        <div className="mt-2 flex gap-2"><select className="min-h-8 min-w-0 flex-1 rounded-md border border-[#415582] bg-[#0a1728] px-2 text-[11px] font-semibold text-[#dceaff] outline-none focus:border-[#8473e6] disabled:opacity-45" value={satelliteId} onChange={(event) => onSatelliteChange(event.target.value)} disabled={!satellites.length} aria-label="Satélite analizado"><option value="">Selecciona una capa</option>{satellites.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><button type="button" disabled={!stationId || !satelliteId || loading} onClick={onAnalyze} className="min-h-8 shrink-0 rounded-md border border-[#5d76d7] bg-[#334eb8] px-3 text-[10px] font-bold text-white transition-colors hover:bg-[#405fcf] disabled:cursor-not-allowed disabled:opacity-45">{loading ? "Calculando…" : "Actualizar"}</button></div>
                    </div>
                </div>
            </section>
            {!satellites.length && <p className="mb-0 mt-2 rounded-md border border-[#7d6232] bg-[rgba(94,68,24,.2)] px-3 py-2 text-[11px] text-[#edcc81]">No hay satélites disponibles en Layers.</p>}
            {result && <section className="mt-3" data-testid="ground-station-pass-results">
                {result.error ? <div className="rounded-[8px] border border-[#8b4655] bg-[rgba(82,28,42,.32)] px-3 py-2.5 text-[11px] leading-snug text-[#ffd0d9]" role="alert">{result.error}</div> : <>
                    <div className="grid gap-3 xl:grid-cols-[minmax(0,.88fr)_minmax(22rem,1.12fr)]">
                        <section className="rounded-[8px] border border-[#294967] bg-[rgba(9,24,43,.76)] p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex items-center gap-2"><strong className="text-[12px] text-[#e9f2ff]">Resultado de pases</strong><span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${result.visibleNow ? "border-[#407e5d] bg-[rgba(28,93,60,.32)] text-[#9ee8bf]" : "border-[#49657f] bg-[rgba(30,54,79,.36)] text-[#a8c8e9]"}`}>{result.visibleNow ? "EN VISTA" : "FUERA DE VISTA"}</span></div><p className="mt-1 mb-0 text-[11px] text-[#a9bfdb]">{result.satellite} · {resultFrameLabel(result, passFrameStatus)} · {orderedPasses.length} pases</p></div>{orderedPasses.length ? <button className="inline-flex min-h-7 items-center rounded-md border border-[#3f785e] bg-[rgba(17,55,40,.22)] px-2.5 text-[10px] font-bold text-[#acecc7] hover:bg-[rgba(27,81,57,.3)]" type="button" onClick={() => exportPasses(result)}>Exportar CSV</button> : null}</div>
                            {result.analysisWindow?.startTime && <div className="mt-3 flex gap-2 rounded-md border border-[#294967] bg-[rgba(7,17,31,.5)] p-2"><ContextGlyph tone="blue"><CalendarIcon /></ContextGlyph><p className="m-0 min-w-0 text-[10px] leading-snug text-[#a8bdd9]">Ventana: <strong className="font-semibold text-[#d9e8fb]">{formatStationTime(result.analysisWindow.startTime, stationTimeZone)} → {formatStationTime(result.analysisWindow.endTime, stationTimeZone)}</strong><span className="block text-[#7f98ba]">Origen: {analysisSource}</span></p></div>}
                            {passFrameStatus?.available === false && <p className="mt-2 mb-0 rounded-md border border-[#8b642a] bg-[rgba(101,66,21,.22)] px-2.5 py-2 text-[10px] leading-snug text-[#f0ca78]">Marco nativo: {passFrameStatus.nativeFrame || result.referenceFrame || "no declarado"}. AOS/LOS y la representación terrestre quedan bloqueados hasta disponer de la operación de realización/EOP. {passFrameStatus.reason || ""}</p>}
                            {passFrameStatus?.approximate === true && passFrameStatus?.available !== false && <p className="mt-2 mb-0 rounded-md border border-[#61779b] bg-[rgba(39,63,97,.28)] px-2.5 py-2 text-[10px] leading-snug text-[#bed4f5]"><strong>{passFrameStatus.displayFrame}.</strong> AOS/LOS se evalúa en el marco terrestre disponible; la comparación o conversión a ECI requiere un ERP aplicable y una ruta de realización terrestre registrada.</p>}
                            {passFrameStatus?.erpApplied === true && <p className="mt-2 mb-0 rounded-md border border-[#426f91] bg-[rgba(24,59,92,.22)] px-2.5 py-2 text-[10px] leading-snug text-[#c5e3ff]"><strong>ITRF (con ERP aplicado).</strong> Los parámetros de rotación terrestre del producto están activos para la conversión a ECI.</p>}
                            {earthOrientationNotice && <p className={`mt-2 mb-0 rounded-md border px-2.5 py-2 text-[10px] leading-snug ${earthOrientationNotice.warning ? "border-[#874252] bg-[rgba(82,28,42,.36)] text-[#ffd0d9]" : "border-[#776035] bg-[rgba(78,59,20,.3)] text-[#f5d38e]"}`} role={earthOrientationNotice.warning ? "alert" : "status"} data-testid="ground-station-eop-coverage-notice"><strong>{earthOrientationNotice.actual ? "Proveniencia usada. " : "Preflight de la ventana. "}</strong>{earthOrientationNotice.message}{earthOrientationNotice.actual ? "" : " El servicio no ha devuelto aún la procedencia de ejecución."}</p>}
                        </section>
                        <section className="rounded-[8px] border border-[#294967] bg-[rgba(9,24,43,.76)] p-3" aria-labelledby="ground-station-passes-title"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong id="ground-station-passes-title" className="block text-[12px] text-[#e9f2ff]">Pases disponibles</strong><span className="text-[10px] text-[#8ea6c5]">{selectedPass ? `Pase ${selectedPassIndex + 1} seleccionado` : "Selecciona un pase para ver su perfil"}</span></div><span className="rounded-full border border-[#365878] bg-[rgba(27,59,95,.26)] px-2 py-1 text-[10px] font-semibold text-[#b7d0ee]">{orderedPasses.length} pases</span></div>{orderedPasses.length ? <PassesTable passes={orderedPasses} timeZone={stationTimeZone} selectedPassIndex={selectedPassIndex} onSelectPass={onSelectPass} /> : <p className="mb-0 mt-3 rounded-md border border-dashed border-[#31536a] px-3 py-2.5 text-[10px] text-[#91a8c8]">No hay pases en la ventana temporal seleccionada.</p>}</section>
                    </div>
                    {selectedPass ? <PassElevationChart result={result} timeZone={stationTimeZone} selectedPassIndex={selectedPassIndex} /> : orderedPasses.length ? <div className="mt-3 rounded-[8px] border border-dashed border-[#31536a] bg-[rgba(8,19,35,.58)] px-3 py-3 text-[11px] leading-snug text-[#91a8c8]" data-testid="ground-station-pass-profile-prompt">Selecciona una fila de la tabla para abrir el perfil de elevación, los marcadores AOS/LOS y la exportación de la gráfica.</div> : null}
                    <PassTechnicalDetails result={result} selectedPass={selectedPass} selectedPassIndex={selectedPassIndex} station={station} timeZone={stationTimeZone} />
                </>}
            </section>}
        </div>
        <span className="pointer-events-none absolute right-1 bottom-1 size-3 border-r border-b border-[#6389bc] opacity-75" aria-hidden="true" />
        {FLOATING_RESIZE_HANDLES.map(([direction, className]) => <div key={direction} className={`absolute z-40 touch-none ${className}`} aria-hidden="true" onPointerDown={(event) => onBeginResize(direction, event)} />)}
    </aside>;
}

export default function GroundStationsPanel() {
    const [open, setOpen] = useState(false);
    const [state, setState] = useState(initialState);
    const [stationId, setStationId] = useState("");
    const [satelliteId, setSatelliteId] = useState("");
    const [result, setResult] = useState(null);
    const [selectedPassIndex, setSelectedPassIndex] = useState(null);
    const [loading, setLoading] = useState(false);
    const [floating, setFloating] = useState(false);
    const [floatingRect, setFloatingRect] = useState(initialFloatingRect);
    const [drag, setDrag] = useState(null);
    const [resize, setResize] = useState(null);
    const selectedAnalysisTargetRef = useRef({ stationId: "", satelliteId: "" });
    const automaticAnalysisKeyRef = useRef("");
    const openRef = useRef(open);
    selectedAnalysisTargetRef.current = { stationId, satelliteId };
    openRef.current = open;

    const cancelPendingAnalysis = useCallback(() => {
        automaticAnalysisKeyRef.current = "";
        window.dispatchEvent(new Event("orbit:ground-stations-analysis-cancel"));
    }, []);
    const requestPassAnalysis = useCallback((nextStationId, nextSatelliteId) => {
        if (!nextStationId || !nextSatelliteId) return;
        setLoading(true);
        window.dispatchEvent(new CustomEvent("orbit:ground-stations-analyze", {
            detail: { stationId: nextStationId, satelliteId: nextSatelliteId }
        }));
    }, []);

    useEffect(() => {
        const refresh = () => window.dispatchEvent(new Event("orbit:ground-stations-request-state"));
        const show = () => {
            // State publication is synchronous. Mark the panel as open before
            // requesting it so a layer selected in the scene is adopted on
            // this first refresh rather than falling back to the first item.
            openRef.current = true;
            setFloating(false);
            setOpen(true);
            refresh();
        };
        const hide = () => {
            openRef.current = false;
            setOpen(false);
        };
        const receive = (event) => {
            const nextState = event.detail || initialState;
            setState(nextState);
            // Scene selection remains authoritative while this workspace is
            // open. Keep the corresponding select in sync, but do not steal
            // a saved pair merely because another workspace refreshed state.
            if (!openRef.current) return;
            const selected = selectedAnalysisTargetRef.current;
            const nextStationId = String(nextState.activeStationId || "").trim();
            const nextSatelliteId = String(nextState.activeSatelliteId || "").trim();
            const stationChanged = nextStationId
                && nextStationId !== selected.stationId
                && (nextState.stations || []).some((item) => item.id === nextStationId);
            const satelliteChanged = nextSatelliteId
                && nextSatelliteId !== selected.satelliteId
                && (nextState.satellites || []).some((item) => item.id === nextSatelliteId);
            if (!stationChanged && !satelliteChanged) return;
            cancelPendingAnalysis();
            if (stationChanged) setStationId(nextStationId);
            if (satelliteChanged) setSatelliteId(nextSatelliteId);
            setResult(null);
            setSelectedPassIndex(null);
        };
        const receiveResult = (event) => {
            const detail = event.detail || null;
            const selection = detail?.analysisSelection;
            const selected = selectedAnalysisTargetRef.current;
            // The runtime always tags a real request with the pair it belongs
            // to. Ignore legacy/unscoped messages and old cancellations: a
            // cancellation for the same pair can otherwise turn off the busy
            // state of the immediately following refresh.
            if (!selection || selection.stationId !== selected.stationId || selection.satelliteLayerId !== selected.satelliteId) return;
            if (detail?.cancelled === true) return;
            setLoading(false);
            setResult(detail);
            setSelectedPassIndex(detail?.passes?.length ? 0 : null);
        };
        const invalidateChangedSimulationRange = (event) => {
            setResult((current) => {
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
        };
        const hideForDesign = (event) => {
            if (event.detail?.active !== true) return;
            openRef.current = false;
            setOpen(false);
        };
        const openPasses = (event) => {
            cancelPendingAnalysis();
            openRef.current = true;
            setStationId(String(event.detail?.stationId || ""));
            setResult(null);
            setSelectedPassIndex(null);
            setFloatingRect((current) => clampFloatingRect(current));
            setFloating(true);
            setOpen(true);
            refresh();
        };
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
    }, [cancelPendingAnalysis]);

    // Ground Stations is a workspace section, not a second inspector stacked
    // above the current one.  Publish only presentation visibility: hidden
    // panels retain their selections, drafts and results and reappear when
    // the station workspace closes.
    useEffect(() => {
        publishGroundStationsPanelState(open, { floating });
    }, [open, floating]);

    useEffect(() => () => {
        publishGroundStationsPanelState(false);
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

    useEffect(() => {
        const hasCurrentStation = state.stations.some((item) => item.id === stationId);
        if (hasCurrentStation || (!stationId && !state.stations.length)) return;
        cancelPendingAnalysis();
        setStationId(state.stations[0]?.id || "");
        setResult(null);
        setSelectedPassIndex(null);
    }, [cancelPendingAnalysis, state.stations, stationId]);
    useEffect(() => {
        const hasCurrentSatellite = state.satellites.some((item) => item.id === satelliteId);
        if (hasCurrentSatellite || (!satelliteId && !state.satellites.length)) return;
        cancelPendingAnalysis();
        setSatelliteId(state.satellites[0]?.id || "");
        setResult(null);
        setSelectedPassIndex(null);
    }, [cancelPendingAnalysis, satelliteId, state.satellites]);
    const station = useMemo(() => state.stations.find((item) => item.id === stationId), [state.stations, stationId]);
    const stationTimeZone = resolveStationTimeZone(result?.stationTimeZone, result?.station?.time_zone, station?.time_zone);
    const passFrameStatus = resultFrameStatus(result);
    const earthOrientationNotice = earthOrientationResultNotice(result);
    const orderedPasses = useMemo(() => [...(Array.isArray(result?.passes) ? result.passes : [])]
        .sort((left, right) => Date.parse(left.aos) - Date.parse(right.aos)), [result?.passes]);
    const selectedPass = Number.isInteger(selectedPassIndex) ? orderedPasses[selectedPassIndex] || null : null;
    const automaticAnalysisKey = stationId && satelliteId && stationAnalysisFingerprint(station)
        ? `${stationId}|${satelliteId}|${stationAnalysisFingerprint(station)}`
        : "";

    useEffect(() => {
        if (!open || !automaticAnalysisKey) {
            automaticAnalysisKeyRef.current = "";
            return undefined;
        }
        if (automaticAnalysisKeyRef.current === automaticAnalysisKey) return undefined;
        automaticAnalysisKeyRef.current = automaticAnalysisKey;
        setResult(null);
        setSelectedPassIndex(null);
        requestPassAnalysis(stationId, satelliteId);
        return () => {
            if (automaticAnalysisKeyRef.current !== automaticAnalysisKey) return;
            automaticAnalysisKeyRef.current = "";
            window.dispatchEvent(new Event("orbit:ground-stations-analysis-cancel"));
        };
    }, [automaticAnalysisKey, open, requestPassAnalysis, satelliteId, stationId]);

    const selectStation = useCallback((nextStationId) => {
        const normalized = String(nextStationId || "");
        if (!normalized || normalized === stationId) return;
        cancelPendingAnalysis();
        setStationId(normalized);
        setResult(null);
        setSelectedPassIndex(null);
    }, [cancelPendingAnalysis, stationId]);
    const selectSatellite = useCallback((nextSatelliteId) => {
        const normalized = String(nextSatelliteId || "");
        if (!normalized || normalized === satelliteId) return;
        cancelPendingAnalysis();
        setSatelliteId(normalized);
        setResult(null);
        setSelectedPassIndex(null);
    }, [cancelPendingAnalysis, satelliteId]);
    const analyze = useCallback(() => {
        if (!stationId || !satelliteId) return;
        cancelPendingAnalysis();
        setResult(null);
        setSelectedPassIndex(null);
        automaticAnalysisKeyRef.current = automaticAnalysisKey;
        requestPassAnalysis(stationId, satelliteId);
    }, [automaticAnalysisKey, cancelPendingAnalysis, requestPassAnalysis, satelliteId, stationId]);

    if (!open) return null;
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
    if (floating) return <FloatingPassesWindow
        floatingRect={floatingRect}
        station={station}
        stations={state.stations}
        stationId={stationId}
        satellites={state.satellites}
        satelliteId={satelliteId}
        result={result}
        loading={loading}
        stationTimeZone={stationTimeZone}
        passFrameStatus={passFrameStatus}
        earthOrientationNotice={earthOrientationNotice}
        orderedPasses={orderedPasses}
        selectedPass={selectedPass}
        selectedPassIndex={selectedPassIndex}
        onStationChange={selectStation}
        onSatelliteChange={selectSatellite}
        onAnalyze={analyze}
        onSelectPass={setSelectedPassIndex}
        onClose={() => setOpen(false)}
        onBeginDrag={beginDrag}
        onBeginResize={beginResize}
    />;
    const floatingStyle = floating ? { left: floatingRect.x, top: floatingRect.y, width: floatingRect.width, height: floatingRect.height } : undefined;
    return <aside className="orbit-right-panel fixed z-[10140] flex flex-col overflow-hidden border text-[#e7f0ff] [font-family:var(--orbit-font-ui)]" style={floatingStyle} aria-label="Operaciones de estaciones terrestres">
        <header onPointerDown={floating ? beginDrag : undefined} className={`flex shrink-0 items-center justify-between border-b border-[#203956] px-3 py-2.5${floating ? " cursor-move select-none" : ""}`}><div><h2 className="m-0 text-[13px] font-bold tracking-wide">{floating ? "TABLAS AOS / LOS" : "GROUND STATIONS"}</h2><p className="mt-0.5 mb-0 text-[10px] text-[#8ea4c4]">{floating ? "Arrastra esta barra para mover el análisis" : "Operación de pases y visibilidad"}</p></div><PanelCloseButton label={floating ? "Cerrar tablas AOS / LOS" : "Cerrar estaciones terrestres"} onPointerDown={(event) => event.stopPropagation()} onClick={() => floating ? setOpen(false) : window.dispatchEvent(new Event("orbit:ground-stations-close"))} /></header>
        <div className="orbit-scrollbar grid min-h-0 flex-1 gap-3 overflow-x-hidden overflow-y-auto overscroll-contain p-3 pr-2.5">
            <section className="rounded-lg border border-[#203956] bg-[rgba(13,29,51,.7)] p-2.5">
                <div className="mb-2 flex items-center justify-between">
                    <strong className="text-[11px]">Estación activa</strong>
                    {!floating && <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => window.dispatchEvent(new Event("orbit:ground-stations-import-request"))} className="rounded-md border border-[#31506f] bg-transparent px-2 py-1 text-[10px] font-bold text-[#a9c7ed]">Importar</button>
                        <button type="button" onClick={() => { cancelPendingAnalysis(); setOpen(false); window.dispatchEvent(new Event("orbit:ground-stations-create-request")); }} className="rounded-md border border-[#466cff] bg-[#263f96] px-2 py-1 text-[10px] font-bold text-white">+ Añadir</button>
                    </div>}
                </div>
                {state.stations.length
                    ? <select className={inputClass} value={stationId} onChange={(event) => selectStation(event.target.value)}>{state.stations.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.latitude_deg.toFixed(3)}°, {item.longitude_deg.toFixed(3)}°</option>)}</select>
                    : <p className="m-0 text-[11px] text-[#aabbd2]">Crea una estación para iniciar un análisis.</p>}
                {station && <>
                    <p className="mb-0 text-[10px] text-[#8ea4c4]">Máscara aplicada: {station.min_elevation_deg}° · ITRF/WGS‑84</p>
                    {!floating && <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={() => { setFloatingRect((current) => clampFloatingRect(current)); setFloating(true); }} className="rounded border border-[#3f785e] bg-transparent px-2 py-1 text-[10px] font-bold text-[#a8ebc5]">Tablas AOS / LOS</button>
                        <button type="button" data-ground-station-export-control="true" onClick={(event) => openGroundStationExportMenu({ stationId, stationName: station.name, source: "ground-stations-panel", anchor: exportMenuAnchor(event) })} className="rounded border border-[#31506f] bg-transparent px-2 py-1 text-[10px] font-bold text-[#a9c7ed]">Exportar</button>
                        {state.stations.length > 1 && <button type="button" data-ground-station-export-control="true" onClick={(event) => openGroundStationExportMenu({ source: "ground-stations-panel", anchor: exportMenuAnchor(event) })} className="rounded border border-[#31506f] bg-transparent px-2 py-1 text-[10px] font-bold text-[#a9c7ed]">Exportar todas</button>}
                    </div>}
                </>}
            </section>
            {station && <details className="rounded-lg border border-[#285345] bg-[rgba(7,31,26,.5)] px-2.5 py-2 text-[10px]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-[#d9efe2] [&::-webkit-details-marker]:hidden"><span>Configuración RF</span><span className="text-[#8cebb1]">RF {Number(station.radio_range_km || 0).toFixed(1)} km</span></summary>
                <p className="my-2 text-[9px] leading-snug text-[#96bba7]">La envolvente sirve para planificación recíproca. El enlace real de bajada y su SNR solo se calculan cuando el satélite aporta su perfil RF.</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[10px]">
                    <span className="text-[#9fc7b1]">Máscara / modo</span><strong className="text-right">{Number(station.min_elevation_deg).toFixed(1)}° · {station.rf?.operation_mode || "tracking"}</strong>
                    <span className="text-[#9fc7b1]">Plato / eficiencia</span><strong className="text-right">{Number(station.rf?.antenna_diameter_m || 0).toFixed(2)} m · {Number(station.rf?.antenna_efficiency || 0).toFixed(2)}</strong>
                    <span className="text-[#9fc7b1]">Frecuencia</span><strong className="text-right">{Number(station.frequency_mhz).toFixed(1)} MHz</strong>
                    <span className="text-[#9fc7b1]">Gmáx / HPBW</span><strong className="text-right">{Number(station.rf?.gain_max_dbi ?? station.tx_gain_dbi).toFixed(1)} dBi · {Number(station.rf?.hpbw_azimuth_deg ?? 0).toFixed(2)}°</strong>
                    <span className="text-[#9fc7b1]">G/T / pérdidas</span><strong className="text-right">{Number(station.rf?.system_gt_db_per_k ?? 0).toFixed(1)} dB/K · {Number(station.rf?.total_system_loss_db ?? 0).toFixed(1)} dB</strong>
                    <span className="text-[#9fc7b1]">Huella en suelo</span><strong className="text-right">{Number(station.ground_footprint_radius_km ?? 0).toFixed(1)} km</strong>
                </div>
                {station.rf?.operation_mode === "scan" ? <p className="mb-0 mt-2 text-[9px] leading-snug text-[#efc56f]">Barrido: la envolvente muestra cobertura potencial. Sin una agenda de apuntado y permanencia, Orbit no publicará pases ni enlaces operativos.</p> : null}
            </details>}
            <section className="rounded-lg border border-[#203956] bg-[rgba(13,29,51,.7)] p-2.5">
                <div className="flex items-center justify-between gap-3"><strong className="text-[11px]">Pases automáticos</strong>{station && <span className="text-[9px] text-[#8ea4c4]">Máscara {station.min_elevation_deg}°</span>}</div>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end"><label className="grid min-w-0 flex-1 gap-1 text-[10px] text-[#9fb3d0]">Satélite<select className={inputClass} value={satelliteId} onChange={(event) => selectSatellite(event.target.value)} disabled={!state.satellites.length}><option value="">Selecciona una capa</option>{state.satellites.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><button type="button" disabled={!stationId || !satelliteId || loading} onClick={analyze} className="min-h-8 shrink-0 rounded-md border border-[#597dff] bg-[#304dc0] px-3 text-[10px] font-bold text-white disabled:opacity-45">{loading ? "Calculando…" : "Actualizar"}</button></div>
                {!state.satellites.length && <p className="mb-0 text-[10px] text-[#d8aa67]">No hay satélites disponibles en Layers.</p>}
            </section>
            {result && <section className="rounded-lg border border-[#2b5b4a] bg-[rgba(11,46,37,.5)] p-2.5" data-testid="ground-station-pass-analysis">
                <header className="flex flex-wrap items-start justify-between gap-2 border-b border-[#285143] pb-2">
                    <div><div className="flex items-center gap-2"><strong className="text-[11px]">Resultado de pases</strong><span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold tracking-wide ${result.visibleNow ? "border-[#407e5d] bg-[rgba(28,93,60,.32)] text-[#9ee8bf]" : "border-[#49657f] bg-[rgba(30,54,79,.36)] text-[#a8c8e9]"}`}>{result.visibleNow ? "EN VISTA" : "FUERA DE VISTA"}</span></div><p className="mt-1 mb-0 text-[10px] text-[#b8d6c7]">{result.error || `${result.satellite} · ${resultFrameLabel(result, passFrameStatus)} · ${orderedPasses.length} pases`}</p></div>
                    {!result.error && orderedPasses.length ? <button className="rounded border border-[#3f785e] bg-transparent px-2 py-1 text-[10px] font-bold text-[#a8ebc5]" type="button" onClick={() => exportPasses(result)}>Exportar CSV</button> : null}
                </header>
                {result.error ? <p className="mb-0 mt-2 rounded border border-[#8b4655] bg-[rgba(82,28,42,.32)] px-2 py-1.5 text-[10px] leading-snug text-[#ffd0d9]" role="alert">{result.error}</p> : <>
                    {result.analysisWindow?.startTime && <p className="mt-2 mb-0 text-[9px] leading-snug text-[#90b9a4]">Ventana: {formatStationTime(result.analysisWindow.startTime, stationTimeZone)} → {formatStationTime(result.analysisWindow.endTime, stationTimeZone)}{result.analysisWindow.source === "simulation-range" ? " · simulación" : result.analysisWindow.source === "manual-design" ? " · diseño manual" : " · próximas 24 h"}.</p>}
                    {passFrameStatus?.available === false && <p className="mt-2 mb-0 rounded border border-[#8b642a] bg-[rgba(101,66,21,.22)] px-2 py-1.5 text-[9px] leading-snug text-[#f0ca78]">Marco nativo: {passFrameStatus.nativeFrame || result.referenceFrame || "no declarado"}. AOS/LOS y la representación terrestre quedan bloqueados hasta disponer de la operación de realización/EOP. {passFrameStatus.reason || ""}</p>}
                    {passFrameStatus?.approximate === true && passFrameStatus?.available !== false && <p className="mt-2 mb-0 rounded border border-[#61779b] bg-[rgba(39,63,97,.28)] px-2 py-1.5 text-[9px] leading-snug text-[#bed4f5]"><strong>{passFrameStatus.displayFrame}.</strong> AOS/LOS se evalúa en el marco terrestre disponible; la comparación o conversión a ECI requiere un ERP aplicable y una ruta de realización terrestre registrada.</p>}
                    {passFrameStatus?.erpApplied === true && <p className="mt-2 mb-0 rounded border border-[#426f91] bg-[rgba(24,59,92,.22)] px-2 py-1.5 text-[9px] leading-snug text-[#c5e3ff]"><strong>ITRF (con ERP aplicado).</strong> Los parámetros de rotación terrestre del producto están activos para la conversión a ECI.</p>}
                    {earthOrientationNotice && <p className={`mt-2 mb-0 rounded border px-2 py-1.5 text-[9px] leading-snug ${earthOrientationNotice.warning ? "border-[#874252] bg-[rgba(82,28,42,.36)] text-[#ffd0d9]" : "border-[#776035] bg-[rgba(78,59,20,.3)] text-[#f5d38e]"}`} role={earthOrientationNotice.warning ? "alert" : "status"} data-testid="ground-station-eop-coverage-notice"><strong>{earthOrientationNotice.actual ? "Proveniencia usada. " : "Preflight de la ventana. "}</strong>{earthOrientationNotice.message}{earthOrientationNotice.actual ? "" : " El servicio no ha devuelto aún la procedencia de ejecución."}</p>}
                    {orderedPasses.length ? <section className="mt-3" aria-labelledby="ground-station-passes-title"><div className="flex flex-wrap items-center justify-between gap-1"><strong id="ground-station-passes-title" className="text-[11px] text-[#dff4e7]">Pases disponibles</strong><span className="text-[9px] text-[#90b9a4]">{selectedPass ? `Pase ${selectedPassIndex + 1} seleccionado` : "Selecciona un pase para ver su perfil"}</span></div><PassesTable passes={orderedPasses} timeZone={stationTimeZone} selectedPassIndex={selectedPassIndex} onSelectPass={setSelectedPassIndex} />{selectedPass ? <PassElevationChart result={result} timeZone={stationTimeZone} selectedPassIndex={selectedPassIndex} /> : <div className="mt-3 rounded-[8px] border border-dashed border-[#31536a] bg-[rgba(8,19,35,.58)] px-3 py-2.5 text-[10px] leading-snug text-[#91a8c8]" data-testid="ground-station-pass-profile-prompt">Selecciona una fila de la tabla para abrir el perfil de elevación, los marcadores AOS/LOS y la exportación de la gráfica.</div>}</section> : <p className="mb-0 mt-3 text-[10px] text-[#b4cbbf]">No hay pases en la ventana temporal seleccionada.</p>}
                    <PassTechnicalDetails result={result} selectedPass={selectedPass} selectedPassIndex={selectedPassIndex} station={station} timeZone={stationTimeZone} />
                </>}
            </section>}
        </div>
        {floating && <><span className="pointer-events-none absolute right-1 bottom-1 size-3 border-r border-b border-[#6389bc] opacity-75" aria-hidden="true" />{FLOATING_RESIZE_HANDLES.map(([direction, className]) => <div key={direction} className={`absolute z-40 touch-none ${className}`} aria-hidden="true" onPointerDown={(event) => beginResize(direction, event)} />)}</>}
    </aside>;
}
