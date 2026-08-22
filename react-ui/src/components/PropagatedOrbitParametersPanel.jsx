import { useEffect, useMemo, useRef, useState } from "react";
import { downloadChartPng } from "../../../front/js/runtime/chartPngExport.js";
import { formatReferenceFrame } from "../../../front/js/features/frames/referenceFrame.js";
import { resolvePreciseProductFrameStatus } from "../../../front/js/features/preciseProducts/frameStatus.js";
import { describeEarthOrientationCoverageDetail } from "../../../front/js/features/timekeeping/eopCoveragePolicy.js";
import PanelCloseButton from "./PanelCloseButton.jsx";

/*
 * Floating propagated-orbit inspector.
 *
 * The runtime owns orbital propagation and global simulation state. This
 * component remains a presentation boundary and communicates through DOM
 * events so it can be opened from the layer tree, object details, toolbar or
 * manual-orbit designer without duplicating any propagation logic.
 */

const EMPTY_PANEL_STATE = {
    open: false,
    status: "idle",
    target: null,
    range: null,
    result: null,
    earthOrientationPreflight: null,
    earthOrientationProvenance: null,
    error: ""
};

const TABLE_COLUMNS = [
    ["Time (UTC)", ["time", "timestamp", "utc", "date"], "time"],
    ["a (km)", ["semi_major_axis_km", "semiMajorAxisKm", "a"], "distance"],
    ["e", ["eccentricity", "e"], "eccentricity"],
    ["i (deg)", ["inclination_deg", "inclinationDeg", "i"], "angle"],
    ["RAAN (deg)", ["raan_deg", "raanDeg", "raan"], "angle"],
    ["ω (deg)", ["argument_of_periapsis_deg", "argumentOfPeriapsisDeg", "argumentOfPerigeeDeg", "aop"], "angle"],
    ["ν (deg)", ["true_anomaly_deg", "trueAnomalyDeg", "trueAnomaly", "nu"], "angle"],
    ["M (deg)", ["mean_anomaly_deg", "meanAnomalyDeg", "meanAnomaly", "m"], "angle"],
    ["Period (min)", ["orbital_period_seconds", "orbitalPeriodSeconds", "periodSeconds", "period"], "period"],
    ["Perigee (km)", ["perigee_altitude_km", "perigeeAltitudeKm", "perigee"], "distance"],
    ["Apogee (km)", ["apogee_altitude_km", "apogeeAltitudeKm", "apogee"], "distance"],
    ["Radius (km)", ["radius_km", "radiusKm", "radius"], "distance"],
    ["Speed (km/s)", ["speed_km_s", "speedKmS", "speed"], "speed"]
];

const CHART_OPTIONS = [
    { id: "semi-major-axis", label: "Semimajor axis", unit: "km", digits: 3, keys: ["semi_major_axis_km", "semiMajorAxisKm", "a"] },
    { id: "eccentricity", label: "Eccentricity", unit: "", digits: 7, keys: ["eccentricity", "e"] },
    { id: "inclination", label: "Inclination", unit: "deg", digits: 4, keys: ["inclination_deg", "inclinationDeg", "i"] },
    { id: "raan", label: "RAAN", unit: "deg", digits: 4, keys: ["raan_deg", "raanDeg", "raan"] },
    { id: "argument-of-periapsis", label: "Argument of periapsis", unit: "deg", digits: 4, keys: ["argument_of_periapsis_deg", "argumentOfPeriapsisDeg", "argumentOfPerigeeDeg", "aop"] },
    { id: "true-anomaly", label: "True anomaly", unit: "deg", digits: 4, keys: ["true_anomaly_deg", "trueAnomalyDeg", "trueAnomaly", "nu"] },
    { id: "mean-anomaly", label: "Mean anomaly", unit: "deg", digits: 4, keys: ["mean_anomaly_deg", "meanAnomalyDeg", "meanAnomaly", "m"] },
    { id: "period", label: "Orbital period", unit: "min", digits: 4, keys: ["orbital_period_seconds", "orbitalPeriodSeconds", "periodSeconds", "period"], multiplier: 1 / 60 },
    { id: "perigee", label: "Perigee altitude", unit: "km", digits: 3, keys: ["perigee_altitude_km", "perigeeAltitudeKm", "perigee"] },
    { id: "apogee", label: "Apogee altitude", unit: "km", digits: 3, keys: ["apogee_altitude_km", "apogeeAltitudeKm", "apogee"] },
    { id: "radius", label: "Geocentric radius", unit: "km", digits: 3, keys: ["radius_km", "radiusKm", "radius"] },
    { id: "speed", label: "Speed", unit: "km/s", digits: 6, keys: ["speed_km_s", "speedKmS", "speed"] }
];

const ROW_HEIGHT = 34;
const TABLE_BUFFER = 12;
const FLOAT_MARGIN = 12;
const MIN_WINDOW_WIDTH = 450;
const MIN_WINDOW_HEIGHT = 410;
const DEFAULT_WINDOW_RECT = { x: 72, y: 88, width: 720, height: 660 };

function emit(name, detail) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

function hasOwn(source, key) {
    return Boolean(source && Object.prototype.hasOwnProperty.call(source, key));
}

function firstDefined(source, keys) {
    if (!source || typeof source !== "object") return undefined;
    for (const key of keys) {
        const value = source[key];
        if (value !== undefined && value !== null && value !== "") return value;
    }
    return undefined;
}

function sampleValue(sample, keys) {
    return firstDefined(sample, keys)
        ?? firstDefined(sample?.elements, keys)
        ?? firstDefined(sample?.state, keys)
        ?? firstDefined(sample?.osculatingElements, keys)
        ?? firstDefined(sample?.osculating_elements, keys);
}

function stateValue(sample, group, key) {
    const state = sample?.state && typeof sample.state === "object" ? sample.state : sample || {};
    const nested = state?.[group];
    return nested && typeof nested === "object" ? nested[key] : undefined;
}

function samplesFrom(result) {
    if (Array.isArray(result)) return result;
    const samples = firstDefined(result, ["samples", "rows", "timeSeries", "time_series", "data"]);
    return Array.isArray(samples) ? samples : [];
}

function resultFromDetail(detail) {
    if (Array.isArray(detail)) return detail;
    if (!detail || typeof detail !== "object") return null;
    if (detail.result && typeof detail.result === "object") return detail.result;
    if (Array.isArray(detail.samples) || Array.isArray(detail.rows) || detail.satellite || detail.start_time || detail.startTime) return detail;
    return null;
}

function labelForTarget(target, result) {
    const resolved = target || result?.satellite || result?.target;
    if (typeof resolved === "string" || typeof resolved === "number") return String(resolved);
    const value = firstDefined(resolved, ["name", "title", "displayName", "id", "noradId", "norad_id"]);
    return value === undefined ? "" : String(value);
}

function idForTarget(target, result) {
    const resolved = target || result?.satellite || result?.target;
    if (typeof resolved === "string" || typeof resolved === "number") return String(resolved);
    const value = firstDefined(resolved, ["id", "objectId", "object_id", "noradId", "norad_id"]);
    return value === undefined ? "" : String(value);
}

function targetFromContext(detail, fallback) {
    if (detail?.target || detail?.satellite) return detail.target ?? detail.satellite;
    const manualName = detail?.manualOrbit?.name;
    if (!detail?.id && !detail?.sourceId && !detail?.name && !manualName) return fallback;
    return {
        id: detail.id ?? detail.sourceId,
        name: detail.name ?? manualName,
        source: detail.source,
        propagator: detail.propagator ?? detail.manualOrbit?.propagator,
        displayReferenceFrame: detail.displayReferenceFrame
            ?? detail.display_reference_frame
            ?? detail.previewReferenceFrame
            ?? detail.preview_reference_frame
            ?? detail.referenceFrame
            ?? detail.reference_frame,
        referenceFrame: detail.referenceFrame ?? detail.reference_frame
    };
}

function rangeValue(range, result, kind) {
    const start = kind === "start";
    return firstDefined(range, start
        ? ["startUtc", "startTime", "start_time", "startDate", "start_date", "start", "from"]
        : ["endUtc", "endTime", "end_time", "endDate", "end_date", "end", "to"])
        ?? firstDefined(result, start
            ? ["startUtc", "startTime", "start_time", "startDate", "start_date", "start", "from"]
            : ["endUtc", "endTime", "end_time", "endDate", "end_date", "end", "to"]);
}

function parseDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value !== "string" && typeof value !== "number") return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateTimeInput(value) {
    const date = parseDate(value);
    if (!date) return "";
    // The inspector labels these fields as UTC. A datetime-local control has
    // no timezone semantics, so feed it UTC clock components and interpret
    // the edited value as UTC again below.
    return date.toISOString().slice(0, 16);
}

function inputDateToIso(value) {
    const text = String(value || "").trim();
    const date = new Date(text && !/[zZ]$|[+-]\d\d:\d\d$/.test(text) ? text + "Z" : text);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatTime(value, compact = false) {
    const date = parseDate(value);
    if (!date) return value ? String(value) : "--";
    const options = compact
        ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }
        : { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false };
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(date) + " UTC";
}

function formatChartTime(value) {
    const date = parseDate(value);
    if (!date) return "--";
    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC"
    }).format(date);
}

function formatDuration(start, end) {
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    if (!startDate || !endDate) return "";
    const seconds = Math.max(0, (endDate.getTime() - startDate.getTime()) / 1000);
    if (seconds < 60) return Math.round(seconds) + " s";
    if (seconds < 3600) return Math.round(seconds / 60) + " min";
    if (seconds < 86400) return Number((seconds / 3600).toFixed(1)) + " h";
    return Number((seconds / 86400).toFixed(2)) + " d";
}

function numeric(value, digits) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return "--";
    return parsed.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits
    });
}

function formatCell(value, type) {
    if (type === "time") return formatTime(value, true);
    if (type === "eccentricity") return numeric(value, 6);
    if (type === "angle") return numeric(value, 3);
    if (type === "speed") return numeric(value, 5);
    if (type === "period") return numeric(Number(value) / 60, 3);
    return numeric(value, 2);
}

function titleCase(value) {
    if (!value) return "--";
    if (typeof value === "object") value = firstDefined(value, ["label", "name", "id", "kind", "value"]);
    if (!value) return "--";
    return String(value)
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

function errorMessage(value) {
    if (!value) return "";
    if (typeof value === "object") value = firstDefined(value, ["message", "detail", "error", "title"]);
    return value ? String(value) : "No se pudo completar la propagación.";
}

function sourceKind(value) {
    if (!value) return undefined;
    if (typeof value !== "object") return value;
    return firstDefined(value, ["kind", "type", "sourceFormat", "source_format", "id"]);
}

function signedNumber(value, digits) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return "--";
    const formatted = numeric(Math.abs(parsed), digits);
    return (parsed > 0 ? "+" : parsed < 0 ? "−" : "±") + formatted;
}

function sampleDelta(first, last, keys, angular = false) {
    const initial = Number(sampleValue(first, keys));
    const final = Number(sampleValue(last, keys));
    if (!Number.isFinite(initial) || !Number.isFinite(final)) return null;
    const delta = final - initial;
    return angular ? ((delta + 540) % 360) - 180 : delta;
}

function statusDescriptor(status, error, hasTarget, count) {
    if (error || String(status).toLowerCase() === "error") return ["ERROR", "bg-[rgba(214,75,91,.16)] text-[#ff9ca8]", error || "No se pudo completar la propagación."];
    if (!hasTarget) return ["SELECCIÓN REQUERIDA", "bg-[rgba(144,162,187,.12)] text-[#a8b7cc]", "Selecciona una capa orbital para inspeccionarla."];
    if (["busy", "loading", "pending", "propagating"].includes(String(status).toLowerCase())) return ["PROPAGANDO", "bg-[rgba(67,118,255,.16)] text-[#9fc1ff]", "Calculando la serie temporal solicitada."];
    if (count > 0) return ["LISTO", "bg-[rgba(55,197,126,.14)] text-[#76e7a1]", count.toLocaleString("en-US") + " muestras propagadas disponibles."];
    return ["LISTO", "bg-[rgba(144,162,187,.12)] text-[#a8b7cc]", "No hay muestras propagadas para este intervalo."];
}

function earthOrientationPanelNotice(panel) {
    const actual = panel?.earthOrientationProvenance;
    const preflight = panel?.earthOrientationPreflight;
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

function viewportBounds() {
    if (typeof window === "undefined") return { width: 1440, height: 900 };
    return { width: Math.max(320, window.innerWidth), height: Math.max(320, window.innerHeight) };
}

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

function clampWindowRect(rect) {
    const viewport = viewportBounds();
    const minimumWidth = Math.min(MIN_WINDOW_WIDTH, Math.max(280, viewport.width - (FLOAT_MARGIN * 2)));
    const minimumHeight = Math.min(MIN_WINDOW_HEIGHT, Math.max(300, viewport.height - (FLOAT_MARGIN * 2)));
    const width = clamp(Number(rect?.width) || DEFAULT_WINDOW_RECT.width, minimumWidth, Math.max(minimumWidth, viewport.width - (FLOAT_MARGIN * 2)));
    const height = clamp(Number(rect?.height) || DEFAULT_WINDOW_RECT.height, minimumHeight, Math.max(minimumHeight, viewport.height - (FLOAT_MARGIN * 2)));
    return {
        x: clamp(Number(rect?.x) || DEFAULT_WINDOW_RECT.x, FLOAT_MARGIN, Math.max(FLOAT_MARGIN, viewport.width - width - FLOAT_MARGIN)),
        y: clamp(Number(rect?.y) || DEFAULT_WINDOW_RECT.y, FLOAT_MARGIN, Math.max(FLOAT_MARGIN, viewport.height - height - FLOAT_MARGIN)),
        width,
        height
    };
}

function RefreshGlyph() {
    return <svg className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.8-4.2L3 9" /><path d="M3 4v5h5M4 13a8 8 0 0 0 14.8 4.2L21 15" /><path d="M21 20v-5h-5" /></svg>;
}

function ExportGlyph() {
    return <svg className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11" /><path d="m8 10 4 4 4-4" /><path d="M4 15.5v4A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-4" /></svg>;
}

function ChartGlyph() {
    return <svg className="size-3.5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5V4.5M4 19.5h16" /><path d="m6.5 15.5 4-4 3 2.25 4-6.25" /></svg>;
}

function EmptyState({ hasTarget, status, error, compact = false }) {
    const loading = ["busy", "loading", "pending", "propagating"].includes(String(status).toLowerCase());
    const message = !hasTarget
        ? "Selecciona una capa y abre este inspector desde la barra lateral, el árbol, los detalles o el diseño manual."
        : error
            ? error
            : loading
                ? "Las efemérides aparecerán al terminar el cálculo."
                : "Actualiza el análisis para calcular la serie orbital.";
    return <div className={"flex flex-1 flex-col items-center justify-center px-8 text-center " + (compact ? "min-h-[180px] py-6" : "min-h-[250px] py-10")}>
        <div className={"mb-3 grid size-10 place-items-center rounded-xl border " + (!hasTarget ? "border-[#31445f] bg-[#122035] text-[#92acd0]" : error ? "border-[rgba(216,81,96,.45)] bg-[rgba(178,50,70,.14)] text-[#ffacb6]" : "border-[#355281] bg-[#142947] text-[#95baff]")}>
            {!hasTarget
                ? <svg className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.7]" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4z" /><path d="m8 8 8 8M16 8l-8 8" /></svg>
                : <svg className={"size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.7] " + (loading ? "animate-spin" : "")} viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.8-4.2L3 9" /><path d="M3 4v5h5M4 13a8 8 0 0 0 14.8 4.2L21 15" /><path d="M21 20v-5h-5" /></svg>}
        </div>
        <h3 className="mb-1 text-[13px] font-semibold text-[#e6effd]">{!hasTarget ? "No hay una capa seleccionada" : error ? "Propagación no disponible" : loading ? "Propagando estado orbital" : "No hay muestras todavía"}</h3>
        <p className="max-w-[420px] text-[11px] leading-[1.55] text-[#93a4bd]">{message}</p>
    </div>;
}

function VirtualizedSamplesTable({ samples, referenceFrame }) {
    const viewportRef = useRef(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(330);

    useEffect(() => {
        const element = viewportRef.current;
        if (!element || typeof ResizeObserver === "undefined") return undefined;
        const observer = new ResizeObserver(([entry]) => setViewportHeight(entry.contentRect.height || 330));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        setScrollTop(0);
        if (viewportRef.current) viewportRef.current.scrollTop = 0;
    }, [samples]);

    const windowedSamples = useMemo(() => {
        const visibleStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - TABLE_BUFFER);
        const visibleEnd = Math.min(samples.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + TABLE_BUFFER);
        return {
            first: visibleStart,
            before: visibleStart * ROW_HEIGHT,
            after: Math.max(0, samples.length - visibleEnd) * ROW_HEIGHT,
            rows: samples.slice(visibleStart, visibleEnd)
        };
    }, [samples, scrollTop, viewportHeight]);

    const frameLabel = referenceFrame ? formatReferenceFrame(referenceFrame) : "";

    return <div ref={viewportRef} className="orbit-scrollbar min-h-0 flex-1 overflow-auto rounded-[8px] border border-[#1e3451] bg-[rgba(4,12,23,.56)]" aria-label={frameLabel ? `Tabla de efemérides calculadas en ${frameLabel}` : "Tabla de efemérides"} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <table className="min-w-[1150px] w-full border-separate border-spacing-0 text-left font-[system-ui,sans-serif] text-[10px] tabular-nums">
            <thead className="sticky top-0 z-[2] bg-[#101e33] text-[#aec2df] shadow-[0_1px_0_#294362]">
                <tr>{TABLE_COLUMNS.map(([label]) => <th className="h-[34px] whitespace-nowrap border-b border-[#294362] px-2.5 text-[9px] font-bold tracking-[.025em]" key={label}>{label}</th>)}</tr>
            </thead>
            <tbody className="text-[#cfdbec]">
                {windowedSamples.before > 0 && <tr aria-hidden="true" style={{ height: windowedSamples.before }}><td className="p-0" colSpan={TABLE_COLUMNS.length} /></tr>}
                {windowedSamples.rows.map((sample, localIndex) => {
                    const index = windowedSamples.first + localIndex;
                    const key = String(firstDefined(sample, ["time", "timestamp", "utc"]) || "sample") + "-" + index;
                    return <tr className="h-[34px] hover:bg-[rgba(69,115,190,.12)]" key={key}>
                        {TABLE_COLUMNS.map(([label, keys, type]) => <td className="whitespace-nowrap border-b border-[rgba(30,52,81,.64)] px-2.5" key={label}>{formatCell(sampleValue(sample, keys), type)}</td>)}
                    </tr>;
                })}
                {windowedSamples.after > 0 && <tr aria-hidden="true" style={{ height: windowedSamples.after }}><td className="p-0" colSpan={TABLE_COLUMNS.length} /></tr>}
            </tbody>
        </table>
    </div>;
}

function DeltaStrip({ samples }) {
    if (samples.length < 2) return null;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const groups = [
        [
            ["Δa", sampleDelta(first, last, ["semi_major_axis_km", "semiMajorAxisKm", "a"]), "km", 3],
            ["Δe", sampleDelta(first, last, ["eccentricity", "e"]), "", 7]
        ],
        [["ΔRAAN", sampleDelta(first, last, ["raan_deg", "raanDeg", "raan"], true), "deg", 4]],
        [
            ["Δperigee", sampleDelta(first, last, ["perigee_altitude_km", "perigeeAltitudeKm", "perigee"]), "km", 3],
            ["Δapogee", sampleDelta(first, last, ["apogee_altitude_km", "apogeeAltitudeKm", "apogee"]), "km", 3]
        ]
    ];
    return <section className="grid shrink-0 grid-cols-3 overflow-hidden rounded-[7px] border border-[#25405f] bg-[rgba(7,19,34,.66)]" aria-label="Variación entre la primera y la última muestra">
        {groups.map((group, index) => <div className={"grid min-w-0 " + (group.length === 1 ? "grid-cols-1" : "grid-cols-2") + " gap-x-2 px-2.5 py-2 " + (index ? "border-l border-[#213852]" : "")} key={group[0][0]}>
            {group.map(([label, value, unit, digits]) => <div className="min-w-0" key={label}>
                <span className="block truncate text-[8px] font-bold tracking-[.045em] text-[#778dad]" title={label + " from first to last sample"}>{label}</span>
                <strong className={"mt-0.5 block truncate text-[10px] font-semibold " + (Number(value) < 0 ? "text-[#ffb2bd]" : Number(value) > 0 ? "text-[#87d9ff]" : "text-[#d3deed]")} title={value === null ? "Not available" : signedNumber(value, digits) + " " + unit}>{value === null ? "--" : signedNumber(value, digits)}{value !== null && unit ? <small className="ml-0.5 text-[8px] font-medium text-[#8fa3c1]">{unit}</small> : null}</strong>
            </div>)}
        </div>)}
    </section>;
}

function modeLabel(mode) {
    const normalized = String(mode || "").toLowerCase();
    if (normalized.includes("manual")) return "MANUAL DESIGN";
    if (normalized === "simulated" || normalized === "range") return "SIMULATED";
    if (normalized === "custom") return "CUSTOM RANGE";
    return "REAL TIME";
}

function modeTone(mode) {
    const normalized = String(mode || "").toLowerCase();
    if (normalized.includes("manual")) return "border-[#7552b8] bg-[rgba(114,77,186,.14)] text-[#d3bbff]";
    if (normalized === "simulated" || normalized === "range") return "border-[#8a6631] bg-[rgba(154,105,28,.14)] text-[#f4cd8d]";
    if (normalized === "custom") return "border-[#3d6a9c] bg-[rgba(53,113,182,.14)] text-[#a8d5ff]";
    return "border-[#317257] bg-[rgba(42,140,95,.13)] text-[#8fe2b4]";
}

function InformationTab({
    panel,
    result,
    samples,
    targetLabel,
    targetId,
    hasTarget,
    source,
    propagator,
    referenceFrame,
    displayFrame,
    rendererReference,
    start,
    end,
    statusLabel,
    statusClass,
    statusText,
    draftRange,
    setDraftRange,
    onUpdateRange,
    onApplySimulation,
    onRefresh
}) {
    const draftStart = inputDateToIso(draftRange.start);
    const draftEnd = inputDateToIso(draftRange.end);
    const rangeValid = Boolean(draftStart && draftEnd && Date.parse(draftEnd) > Date.parse(draftStart));
    const manualDesign = String(panel?.range?.mode || "").toLowerCase().includes("manual-design");
    const busy = ["busy", "loading", "pending", "propagating"].includes(String(panel?.status).toLowerCase());
    const duration = formatDuration(start, end);
    const framesDiffer = Boolean(
        displayFrame
        && referenceFrame
        && formatReferenceFrame(displayFrame) !== formatReferenceFrame(referenceFrame)
    );
    const metadataCards = framesDiffer
        ? [["MODEL", propagator], ["DISPLAY FRAME", displayFrame], ["DYNAMICS FRAME", referenceFrame], ["SOURCE", source]]
        : [["MODEL", propagator], ["FRAME", referenceFrame || displayFrame], ["SOURCE", source]];
    const rendererUnavailable = rendererReference?.available === false
        || String(rendererReference?.status || "").toLowerCase() === "unavailable";
    const rendererApproximate = rendererReference?.approximate === true
        || String(rendererReference?.status || "").toLowerCase() === "approximate_earth_fixed";
    const rendererNativeFrame = rendererReference?.nativeFrame
        || rendererReference?.native_reference_frame
        || rendererReference?.nativeReferenceFrame
        || "el marco nativo";

    return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
        <section className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2.5 rounded-[8px] border border-[#25405f] bg-[rgba(12,27,48,.68)] px-3 py-2.5" aria-label="Resumen de propagación">
            <div className="min-w-0">
                <div className="mb-1 text-[9px] font-bold tracking-[.06em] text-[#8297b5]">TARGET</div>
                <div className="truncate text-[12px] font-semibold text-[#e5eefc]">{hasTarget ? targetLabel : "No layer selected"}{targetId && targetId !== targetLabel ? <span className="ml-1.5 text-[10px] font-medium text-[#90a3bf]">{targetId}</span> : null}</div>
            </div>
            <span className={"self-start rounded-[5px] px-2 py-1 text-[9px] leading-none font-bold tracking-[.045em] " + statusClass}>{statusLabel}</span>
            <div className="col-span-2 flex min-w-0 items-center justify-between gap-2 border-t border-[#203752] pt-2.5 text-[10px]">
                <span className="min-w-0 truncate text-[#91a3bd]">{statusText}</span>
                <button className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] border border-[#31537b] bg-[#10223b] px-2.5 py-1.5 text-[10px] font-bold text-[#b8d2ff] hover:border-[#5683bc] hover:bg-[#163155] hover:text-white disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={!hasTarget || busy} onClick={onRefresh}><RefreshGlyph />Refresh</button>
            </div>
        </section>

        <section className="shrink-0 rounded-[8px] border border-[#25405f] bg-[rgba(8,21,38,.74)] p-3" aria-label="Rango temporal">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="m-0 text-[11px] font-semibold text-[#e7effd]">Analysis range</h3>
                    <p className="mt-1 mb-0 text-[10px] leading-[1.4] text-[#8fa2be]">Edita el intervalo y aplícalo antes de recalcular la serie propagada.</p>
                </div>
                <span className={"shrink-0 rounded-full border px-2 py-1 text-[8px] font-bold tracking-[.06em] " + modeTone(panel?.range?.mode)}>{modeLabel(panel?.range?.mode)}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="grid min-w-0 gap-1 text-[9px] font-semibold text-[#b9c9df]">
                    <span>Start UTC</span>
                    <input className="h-[34px] min-w-0 rounded-md border border-[#294361] bg-[#0b1728] px-2 text-[11px] font-medium text-[#eaf2ff] outline-none focus:border-[#5d8fff] focus:shadow-[0_0_0_2px_rgba(75,122,255,.16)]" type="datetime-local" value={draftRange.start} onChange={(event) => setDraftRange((current) => ({ ...current, start: event.target.value }))} />
                </label>
                <label className="grid min-w-0 gap-1 text-[9px] font-semibold text-[#b9c9df]">
                    <span>End UTC</span>
                    <input className="h-[34px] min-w-0 rounded-md border border-[#294361] bg-[#0b1728] px-2 text-[11px] font-medium text-[#eaf2ff] outline-none focus:border-[#5d8fff] focus:shadow-[0_0_0_2px_rgba(75,122,255,.16)]" type="datetime-local" value={draftRange.end} onChange={(event) => setDraftRange((current) => ({ ...current, end: event.target.value }))} />
                </label>
            </div>
            {!rangeValid && <p className="mt-2 mb-0 text-[10px] font-semibold text-[#ff9cab]" role="alert">La fecha final debe ser posterior a la inicial.</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <button className="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-[6px] border border-[#345c93] bg-[#11294a] px-3 text-[10px] font-bold text-[#c8dcff] hover:border-[#5f91d3] hover:bg-[#17385f] hover:text-white disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={!hasTarget || !rangeValid || busy} onClick={() => onUpdateRange({ startTime: draftStart, endTime: draftEnd })}>Actualizar análisis</button>
                <button className="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-[6px] border border-[#806236] bg-[#251e14] px-3 text-[10px] font-bold text-[#f1ce92] hover:border-[#b99051] hover:bg-[#352a18] hover:text-[#ffe3b2] disabled:cursor-not-allowed disabled:opacity-40" type="button" title={manualDesign ? "El diseño manual ya usa sus propios epochs." : "Usar estas fechas como rango global de simulación."} disabled={!hasTarget || !rangeValid || busy || manualDesign} onClick={() => onApplySimulation({ startTime: draftStart, endTime: draftEnd })}>Aplicar simulación</button>
                {duration && <span className="rounded bg-[#172943] px-2 py-1.5 text-[9px] font-semibold text-[#aac1e0]">{duration}</span>}
            </div>
            <p className="mt-2 mb-0 text-[9px] leading-[1.4] text-[#7185a3]">{manualDesign ? "El diseño manual mantiene la escena sincronizada con sus epochs; aquí el rango es sólo de inspección." : "Aplicar simulación actualiza la escena y la barra temporal, y la deja pausada al inicio del intervalo."}</p>
        </section>

        <section className={"grid shrink-0 gap-2 " + (framesDiffer ? "grid-cols-4" : "grid-cols-3")} aria-label="Metadatos del modelo">
            {metadataCards.map(([label, value]) => <div className="min-w-0 rounded-[7px] border border-[#203854] bg-[rgba(6,17,31,.53)] px-2.5 py-2" key={label}>
                <span className="block text-[8px] font-bold tracking-[.06em] text-[#7288a7]">{label}</span>
                <strong className="mt-0.5 block truncate text-[10px] font-semibold text-[#d0ddec]" title={value ? (label.includes("FRAME") ? formatReferenceFrame(value) : titleCase(value)) : "--"}>{value ? (label.includes("FRAME") ? formatReferenceFrame(value) : titleCase(value)) : "--"}</strong>
            </div>)}
        </section>

        {framesDiffer && <p className="m-0 shrink-0 text-[9px] leading-[1.4] text-[#8297b5]">La vista usa {formatReferenceFrame(displayFrame)}; los elementos osculantes se derivan del estado dinámico nativo en {formatReferenceFrame(referenceFrame)}.</p>}

        {rendererUnavailable && <div className="shrink-0 rounded-[7px] border border-[rgba(218,154,51,.62)] bg-[rgba(96,62,16,.2)] px-3 py-2 text-[10px] leading-[1.45] text-[#ffdca0]" role="status">
            <strong>Representación terrestre no disponible.</strong> El producto conserva su marco nativo {formatReferenceFrame(rendererNativeFrame)} y no se calculan elementos ni una visualización terrestre hasta configurar la transformación requerida{rendererReference.reason ? `: ${rendererReference.reason}` : "."}
        </div>}
        {rendererApproximate && !rendererUnavailable && <div className="shrink-0 rounded-[7px] border border-[rgba(84,142,201,.58)] bg-[rgba(25,69,111,.2)] px-3 py-2 text-[10px] leading-[1.45] text-[#c9e4ff]" role="status">
            <strong>{displayFrame || "Marco terrestre aproximado (sin ERP)"}.</strong> La escena puede mostrar el producto en coordenadas terrestres, pero la conversión o comparación en ECI queda bloqueada hasta disponer de un ERP aplicable y la ruta de realización terrestre necesaria.
        </div>}
        {rendererReference?.unverifiedTerrestrialTransform === true && !rendererUnavailable && !rendererApproximate && <div className="shrink-0 rounded-[7px] border border-[rgba(218,154,51,.62)] bg-[rgba(96,62,16,.2)] px-3 py-2 text-[10px] leading-[1.45] text-[#ffdca0]" role="status">
            <strong>Transformación terrestre sin procedencia.</strong> Se conserva el marco nativo {formatReferenceFrame(rendererNativeFrame)}; la referencia terrestre recibida no declara EOP/ERP ni una operación de realización verificable.
        </div>}

        {samples.length > 0 && <DeltaStrip samples={samples} />}
        {panel?.error && <div className="shrink-0 rounded-[7px] border border-[rgba(210,75,91,.52)] bg-[rgba(123,35,49,.2)] px-3 py-2 text-[10px] leading-[1.45] text-[#ffc3cb]" role="alert">{errorMessage(panel.error)}</div>}
        {!hasTarget && <EmptyState hasTarget={false} status={panel?.status} error={errorMessage(panel?.error)} compact />}
        {result?.model?.atmospheric_drag_model && <p className="m-0 shrink-0 text-[9px] leading-[1.4] text-[#7e94b5]">Drag model: {String(result.model.atmospheric_drag_model)}</p>}
    </div>;
}

function ChartParameterPicker({ option, onChange }) {
    const [open, setOpen] = useState(false);
    return <div className="relative shrink-0">
        <button className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[6px] border border-[#31537b] bg-[#10223b] px-2.5 text-[10px] font-bold text-[#c0d8ff] hover:border-[#5683bc] hover:bg-[#163155] hover:text-white" type="button" aria-haspopup="menu" aria-expanded={open} title="Choose chart parameter" onClick={() => setOpen((current) => !current)}><ChartGlyph /><span className="max-w-[156px] truncate">{option.label}</span><span className="text-[#7e9ac1]">⌄</span></button>
        {open && <div className="orbit-scrollbar absolute top-[calc(100%+6px)] right-0 z-30 grid max-h-[300px] w-[220px] overflow-y-auto rounded-[8px] border border-[#355272] bg-[#0b182a] p-1 shadow-[0_14px_30px_rgba(0,0,0,.5)]" role="menu">
            {CHART_OPTIONS.map((candidate) => <button className={"appearance-none cursor-pointer rounded-[5px] border border-transparent bg-[#0b182a] px-2.5 py-2 text-left text-[10px] font-semibold " + (candidate.id === option.id ? "!border-[#557eaf] !bg-[#234574] text-white shadow-[inset_0_1px_rgba(230,242,255,.12)]" : "text-[#b9c9df] hover:border-[#31516f] hover:bg-[#162d4c] hover:text-white")} type="button" key={candidate.id} role="menuitemradio" aria-checked={candidate.id === option.id} onClick={() => { onChange(candidate); setOpen(false); }}>{candidate.label}{candidate.unit ? <small className="ml-1 text-[9px] font-medium text-[#87a4ce]">({candidate.unit})</small> : null}</button>)}
        </div>}
    </div>;
}

function OrbitParameterChart({ samples, option, referenceFrame }) {
    const svgRef = useRef(null);
    const dragRef = useRef(null);
    const [viewDomain, setViewDomain] = useState(null);
    const [tooltip, setTooltip] = useState(null);
    const [isPanning, setIsPanning] = useState(false);
    const points = useMemo(() => samples.map((sample, index) => {
        const time = parseDate(firstDefined(sample, ["time", "timestamp", "utc", "date"]))?.getTime();
        const raw = Number(sampleValue(sample, option.keys));
        const value = Number.isFinite(raw) ? raw * (option.multiplier || 1) : Number.NaN;
        return { index, time: Number.isFinite(time) ? time : index, value };
    }).filter((point) => Number.isFinite(point.value)), [samples, option]);

    const baseDomain = useMemo(() => {
        if (points.length < 2) return null;
        const values = points.map((point) => point.value);
        const times = points.map((point) => point.time);
        let minValue = Math.min(...values);
        let maxValue = Math.max(...values);
        if (Math.abs(maxValue - minValue) < Math.max(1e-12, Math.abs(maxValue) * 1e-10)) {
            const pad = Math.max(Math.abs(maxValue) * 0.01, option.id === "eccentricity" ? 1e-5 : 1);
            minValue -= pad;
            maxValue += pad;
        } else {
            const pad = (maxValue - minValue) * 0.07;
            minValue -= pad;
            maxValue += pad;
        }
        return {
            minTime: Math.min(...times),
            maxTime: Math.max(...times),
            minValue,
            maxValue
        };
    }, [points, option.id]);

    // Each parameter or propagation result starts fitted to its full extent;
    // while it is being explored, the extent stays independent of rerenders.
    useEffect(() => {
        setViewDomain(baseDomain ? { ...baseDomain } : null);
        setTooltip(null);
        dragRef.current = null;
        setIsPanning(false);
    }, [option.id, baseDomain?.minTime, baseDomain?.maxTime, baseDomain?.minValue, baseDomain?.maxValue]);

    if (!baseDomain || points.length < 2) {
        return <EmptyState hasTarget status="ready" error="" compact />;
    }

    const width = 820;
    const height = 350;
    const padding = { top: 26, right: 22, bottom: 48, left: 72 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const constrainAxis = (minimum, maximum, baseMinimum, baseMaximum) => {
        const baseSpan = Math.max(Number.EPSILON, baseMaximum - baseMinimum);
        const requestedSpan = Math.max(Number.EPSILON, maximum - minimum);
        const span = clamp(requestedSpan, baseSpan * 0.0005, baseSpan);
        let nextMinimum = ((minimum + maximum) / 2) - (span / 2);
        let nextMaximum = nextMinimum + span;
        if (nextMinimum < baseMinimum) {
            nextMaximum += baseMinimum - nextMinimum;
            nextMinimum = baseMinimum;
        }
        if (nextMaximum > baseMaximum) {
            nextMinimum -= nextMaximum - baseMaximum;
            nextMaximum = baseMaximum;
        }
        return [nextMinimum, nextMaximum];
    };
    const constrainDomain = (candidate) => {
        const [minTime, maxTime] = constrainAxis(candidate.minTime, candidate.maxTime, baseDomain.minTime, baseDomain.maxTime);
        const [minValue, maxValue] = constrainAxis(candidate.minValue, candidate.maxValue, baseDomain.minValue, baseDomain.maxValue);
        return { minTime, maxTime, minValue, maxValue };
    };
    const domain = constrainDomain(viewDomain || baseDomain);
    const timeSpan = Math.max(1, domain.maxTime - domain.minTime);
    const valueSpan = Math.max(Number.EPSILON, domain.maxValue - domain.minValue);
    const xFor = (time) => padding.left + (((time - domain.minTime) / timeSpan) * innerWidth);
    const yFor = (value) => padding.top + innerHeight - (((value - domain.minValue) / valueSpan) * innerHeight);
    const path = points.map((point, index) => (index ? "L" : "M") + xFor(point.time).toFixed(2) + " " + yFor(point.value).toFixed(2)).join(" ");
    const yTicks = Array.from({ length: 5 }, (_, index) => domain.minValue + ((domain.maxValue - domain.minValue) * index / 4));
    const xTicks = Array.from({ length: 5 }, (_, index) => domain.minTime + (timeSpan * index / 4));
    const zoomed = Math.abs(domain.minTime - baseDomain.minTime) > 0.5
        || Math.abs(domain.maxTime - baseDomain.maxTime) > 0.5
        || Math.abs(domain.minValue - baseDomain.minValue) > Math.max(1e-12, Math.abs(baseDomain.maxValue - baseDomain.minValue) * 1e-9)
        || Math.abs(domain.maxValue - baseDomain.maxValue) > Math.max(1e-12, Math.abs(baseDomain.maxValue - baseDomain.minValue) * 1e-9);

    const pointFromClient = (clientX, clientY) => {
        const svg = svgRef.current;
        if (!svg) return null;
        const matrix = svg.getScreenCTM?.();
        if (matrix && typeof svg.createSVGPoint === "function") {
            const point = svg.createSVGPoint();
            point.x = clientX;
            point.y = clientY;
            return point.matrixTransform(matrix.inverse());
        }
        const bounds = svg.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return null;
        return {
            x: ((clientX - bounds.left) / bounds.width) * width,
            y: ((clientY - bounds.top) / bounds.height) * height
        };
    };
    const isInPlot = (point) => point
        && point.x >= padding.left
        && point.x <= padding.left + innerWidth
        && point.y >= padding.top
        && point.y <= padding.top + innerHeight;
    const nearestCurvePoint = (pointer) => {
        const bounds = svgRef.current?.getBoundingClientRect();
        const scale = bounds ? Math.max(0.12, Math.min(bounds.width / width, bounds.height / height)) : 1;
        const threshold = 14 / scale;
        let nearest = null;
        const consider = (x, y, time, value, exact) => {
            const distanceSquared = ((x - pointer.x) ** 2) + ((y - pointer.y) ** 2);
            if (!nearest || distanceSquared < nearest.distanceSquared) nearest = { x, y, time, value, exact, distanceSquared };
        };
        points.forEach((point, index) => {
            const x = xFor(point.time);
            const y = yFor(point.value);
            consider(x, y, point.time, point.value, true);
            const previous = points[index - 1];
            if (!previous) return;
            const x0 = xFor(previous.time);
            const y0 = yFor(previous.value);
            const segmentX = x - x0;
            const segmentY = y - y0;
            const segmentLengthSquared = (segmentX ** 2) + (segmentY ** 2);
            if (segmentLengthSquared < Number.EPSILON) return;
            const ratio = clamp((((pointer.x - x0) * segmentX) + ((pointer.y - y0) * segmentY)) / segmentLengthSquared, 0, 1);
            consider(
                x0 + (segmentX * ratio),
                y0 + (segmentY * ratio),
                previous.time + ((point.time - previous.time) * ratio),
                previous.value + ((point.value - previous.value) * ratio),
                false
            );
        });
        return nearest && nearest.distanceSquared <= threshold ** 2 ? nearest : null;
    };
    const updateTooltip = (event) => {
        if (dragRef.current) return;
        const pointer = pointFromClient(event.clientX, event.clientY);
        setTooltip(isInPlot(pointer) ? nearestCurvePoint(pointer) : null);
    };
    const resetView = () => {
        dragRef.current = null;
        setIsPanning(false);
        setTooltip(null);
        setViewDomain({ ...baseDomain });
    };
    const chartTitle = option.label + (option.unit ? " (" + option.unit + ")" : "");
    const calculationFrame = referenceFrame ? formatReferenceFrame(referenceFrame) : null;
    const exportPng = () => downloadChartPng(svgRef.current, option.id);
    const handleWheel = (event) => {
        const pointer = pointFromClient(event.clientX, event.clientY);
        if (!isInPlot(pointer)) return;
        event.preventDefault();
        event.stopPropagation();
        const delta = event.deltaY || event.deltaX;
        if (!delta) return;
        const normalizedDelta = event.deltaMode === 1 ? delta * 16 : event.deltaMode === 2 ? delta * 160 : delta;
        const factor = Math.exp(clamp(normalizedDelta, -180, 180) * 0.0022);
        const timePivot = domain.minTime + (((pointer.x - padding.left) / innerWidth) * timeSpan);
        const valuePivot = domain.maxValue - (((pointer.y - padding.top) / innerHeight) * valueSpan);
        const nextTimeSpan = timeSpan * factor;
        const nextValueSpan = valueSpan * factor;
        setTooltip(null);
        setViewDomain(constrainDomain({
            minTime: timePivot - (((timePivot - domain.minTime) / timeSpan) * nextTimeSpan),
            maxTime: timePivot + (((domain.maxTime - timePivot) / timeSpan) * nextTimeSpan),
            minValue: valuePivot - (((valuePivot - domain.minValue) / valueSpan) * nextValueSpan),
            maxValue: valuePivot + (((domain.maxValue - valuePivot) / valueSpan) * nextValueSpan)
        }));
    };
    const beginPan = (event) => {
        if (event.button !== 0) return;
        const pointer = pointFromClient(event.clientX, event.clientY);
        if (!isInPlot(pointer)) return;
        event.preventDefault();
        event.stopPropagation();
        dragRef.current = { pointerId: event.pointerId, pointer, domain: { ...domain } };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setTooltip(null);
        setIsPanning(true);
    };
    const movePan = (event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
            updateTooltip(event);
            return;
        }
        const pointer = pointFromClient(event.clientX, event.clientY);
        if (!pointer) return;
        event.preventDefault();
        const deltaX = pointer.x - drag.pointer.x;
        const deltaY = pointer.y - drag.pointer.y;
        const dragTimeSpan = drag.domain.maxTime - drag.domain.minTime;
        const dragValueSpan = drag.domain.maxValue - drag.domain.minValue;
        setViewDomain(constrainDomain({
            minTime: drag.domain.minTime - ((deltaX / innerWidth) * dragTimeSpan),
            maxTime: drag.domain.maxTime - ((deltaX / innerWidth) * dragTimeSpan),
            minValue: drag.domain.minValue + ((deltaY / innerHeight) * dragValueSpan),
            maxValue: drag.domain.maxValue + ((deltaY / innerHeight) * dragValueSpan)
        }));
    };
    const endPan = (event) => {
        if (!dragRef.current || (event && dragRef.current.pointerId !== event.pointerId)) return;
        dragRef.current = null;
        setIsPanning(false);
        if (event) updateTooltip(event);
    };

    return <div className="min-h-0 flex flex-1 flex-col rounded-[9px] border border-[#203b59] bg-[linear-gradient(155deg,rgba(8,19,35,.96),rgba(5,13,25,.96))] p-2.5">
        <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <span className="min-w-0 truncate text-[10px] font-semibold text-[#d8e7fc]">{option.label}{option.unit ? <small className="ml-1.5 font-medium text-[#91a8c8]">({option.unit})</small> : null}</span>
            <div className="flex shrink-0 items-center gap-2">
                <span className="hidden text-[9px] font-medium text-[#7189aa] lg:inline">Wheel: zoom · Drag: pan</span>
                <button className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-[5px] border border-[#31506f] bg-[#0e2037] px-2 text-[9px] font-bold text-[#a9c7ed] hover:border-[#5684ba] hover:bg-[#173554] hover:text-white" type="button" onClick={exportPng} title="Export chart as PNG" aria-label="Exportar gráfica como PNG"><ExportGlyph />Export PNG</button>
                <button className="h-6 cursor-pointer rounded-[5px] border border-[#31506f] bg-[#0e2037] px-2 text-[9px] font-bold text-[#a9c7ed] hover:border-[#5684ba] hover:bg-[#173554] hover:text-white disabled:cursor-default disabled:opacity-45" type="button" disabled={!zoomed} onClick={resetView} title="Reset chart zoom and pan">Reset view</button>
                <span className="text-[9px] font-medium text-[#7f95b6]">{points.length.toLocaleString("en-US")} samples</span>
            </div>
        </div>
        <div className="relative min-h-0 flex-1">
            <svg ref={svgRef} className={"block h-full min-h-[260px] w-full touch-none select-none " + (isPanning ? "cursor-grabbing" : "cursor-crosshair")} viewBox={"0 0 " + width + " " + height} role="img" aria-label={option.label + " propagated over time. Use the wheel to zoom and drag to pan."} onWheel={handleWheel} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onPointerLeave={() => { if (!dragRef.current) setTooltip(null); }}>
                <defs>
                    <linearGradient id="orbit-parameter-line" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#6cb8ff" /><stop offset="1" stopColor="#a58aff" /></linearGradient>
                    <linearGradient id="orbit-parameter-area" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#6cb8ff" stopOpacity=".22" /><stop offset="1" stopColor="#6cb8ff" stopOpacity="0" /></linearGradient>
                    <clipPath id="orbit-parameter-clip"><rect x={padding.left} y={padding.top} width={innerWidth} height={innerHeight} rx="4" /></clipPath>
                </defs>
                <rect x={padding.left} y={padding.top} width={innerWidth} height={innerHeight} rx="4" fill="#09172a" stroke="#29425f" strokeWidth=".9" />
                {yTicks.map((value, index) => <g key={"y-" + index}><line x1={padding.left} x2={padding.left + innerWidth} y1={yFor(value)} y2={yFor(value)} stroke="#8090a3" strokeOpacity=".24" strokeWidth=".7" /><text x={padding.left - 10} y={yFor(value) + 3.5} fill="#8ea2bd" fontSize="10" textAnchor="end">{numeric(value, option.digits)}</text></g>)}
                {xTicks.map((time, index) => <g key={"x-" + index}><line x1={xFor(time)} x2={xFor(time)} y1={padding.top} y2={padding.top + innerHeight} stroke="#8090a3" strokeOpacity=".18" strokeWidth=".7" /><text x={xFor(time)} y={height - 18} fill="#8ea2bd" fontSize="9.5" textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}>{formatChartTime(time)}</text></g>)}
                <g clipPath="url(#orbit-parameter-clip)">
                    <path d={path + " L " + xFor(points[points.length - 1].time).toFixed(2) + " " + (padding.top + innerHeight) + " L " + xFor(points[0].time).toFixed(2) + " " + (padding.top + innerHeight) + " Z"} fill="url(#orbit-parameter-area)" />
                    <path d={path} fill="none" stroke="url(#orbit-parameter-line)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.25" vectorEffect="non-scaling-stroke" />
                    {points.length <= 160 && points.map((point, index) => <circle cx={xFor(point.time)} cy={yFor(point.value)} r="1.8" fill="#e0f0ff" stroke="#6daeff" strokeWidth=".8" key={"point-" + index}><title>{formatTime(point.time) + " · " + numeric(point.value, option.digits) + (option.unit ? " " + option.unit : "")}</title></circle>)}
                    {tooltip && <g pointerEvents="none"><line x1={tooltip.x} x2={tooltip.x} y1={padding.top} y2={padding.top + innerHeight} stroke="#b5d7ff" strokeOpacity=".5" strokeDasharray="3 3" /><line x1={padding.left} x2={padding.left + innerWidth} y1={tooltip.y} y2={tooltip.y} stroke="#b5d7ff" strokeOpacity=".28" strokeDasharray="3 3" /><circle cx={tooltip.x} cy={tooltip.y} r="4" fill="#0d2038" stroke="#dceeff" strokeWidth="1.6" /></g>}
                </g>
                {/* Keep the plot title inside the SVG. The HTML toolbar is not
                    part of the PNG export, while this title is. */}
                <text x={padding.left} y="15" fill="#d9eaff" fontSize="11.5" fontWeight="700">{chartTitle}</text>
                {calculationFrame && <text x={padding.left + innerWidth} y="15" fill="#89a6cb" fontSize="9.5" fontWeight="600" textAnchor="end">OSC. ELEMENTS · {calculationFrame}</text>}
                <text x={padding.left + innerWidth} y={height - 4} fill="#8197b5" fontSize="9.5" fontWeight="600" textAnchor="end">UTC TIME</text>
            </svg>
            {tooltip && <div className="pointer-events-none absolute z-10 min-w-[156px] rounded-[6px] border border-[#4e749d] bg-[rgba(7,19,34,.96)] px-2.5 py-2 shadow-[0_8px_22px_rgba(0,0,0,.42)]" style={{ left: clamp((tooltip.x / width) * 100, 4, 76) + "%", top: clamp((tooltip.y / height) * 100, 4, 77) + "%", transform: "translate(10px, -105%)" }}>
                <span className="block text-[9px] font-bold tracking-[.045em] text-[#88a9cf]">{tooltip.exact ? "SAMPLE" : "INTERPOLATED"}</span>
                <strong className="mt-0.5 block whitespace-nowrap text-[10px] font-semibold text-[#ebf4ff]">{numeric(tooltip.value, option.digits)}{option.unit ? " " + option.unit : ""}</strong>
                <span className="mt-0.5 block whitespace-nowrap text-[9px] text-[#a4b6ce]">{formatTime(tooltip.time)}</span>
            </div>}
        </div>
    </div>;
}

function GraphTab({ samples, option, onOptionChange, hasTarget, status, error, referenceFrame }) {
    const sampleReferenceFrame = firstDefined(samples[0], ["reference_frame", "referenceFrame", "frame"])
        ?? firstDefined(samples[0]?.state, ["reference_frame", "referenceFrame", "frame"]);
    const calculationFrame = referenceFrame ?? sampleReferenceFrame;
    const calculationFrameLabel = calculationFrame ? formatReferenceFrame(calculationFrame) : null;
    return <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between gap-3">
            <div className="min-w-0">
                <h3 className="m-0 text-[11px] font-semibold text-[#e4eefc]">Time plot</h3>
                <div className="mt-1 flex min-w-0 items-center gap-1.5">
                    <p className="m-0 truncate text-[10px] text-[#879bb8]">Valores osculantes derivados de la propagación seleccionada.</p>
                    {calculationFrameLabel && <span className="shrink-0 rounded-[4px] border border-[#315376] bg-[#0d2139] px-1.5 py-0.5 text-[8px] font-bold tracking-[.045em] text-[#a9cbef]" title="Reference frame used to derive the plotted osculating elements">MARCO DE CÁLCULO · {calculationFrameLabel}</span>}
                </div>
            </div>
            <ChartParameterPicker option={option} onChange={onOptionChange} />
        </div>
        {samples.length > 0 ? <OrbitParameterChart samples={samples} option={option} referenceFrame={calculationFrame} /> : <EmptyState hasTarget={hasTarget} status={status} error={error} />}
    </div>;
}

function csvEscape(value) {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\r\n]/.test(text) ? "\"" + text.replaceAll("\"", "\"\"") + "\"" : text;
}

function exportSamplesCsv({ samples, targetLabel, source, propagator, referenceFrame, start, end }) {
    const headers = [
        "target", "source", "propagator", "analysis_frame", "analysis_start_utc", "analysis_end_utc",
        "time_utc", "sample_frame", "element_type",
        "semi_major_axis_km", "eccentricity", "inclination_deg", "raan_deg", "argument_of_periapsis_deg",
        "true_anomaly_deg", "mean_anomaly_deg", "orbital_period_seconds", "mean_motion_rev_day",
        "perigee_altitude_km", "apogee_altitude_km", "radius_km", "speed_km_s",
        "position_x_km", "position_y_km", "position_z_km", "velocity_x_km_s", "velocity_y_km_s", "velocity_z_km_s"
    ];
    const rows = samples.map((sample) => [
        targetLabel, source, titleCase(propagator), formatReferenceFrame(referenceFrame), start, end,
        firstDefined(sample, ["time", "timestamp", "utc", "date"]),
        firstDefined(sample, ["reference_frame", "referenceFrame", "frame"]),
        firstDefined(sample, ["element_type", "elementType"]),
        sampleValue(sample, ["semi_major_axis_km", "semiMajorAxisKm", "a"]),
        sampleValue(sample, ["eccentricity", "e"]),
        sampleValue(sample, ["inclination_deg", "inclinationDeg", "i"]),
        sampleValue(sample, ["raan_deg", "raanDeg", "raan"]),
        sampleValue(sample, ["argument_of_periapsis_deg", "argumentOfPeriapsisDeg", "argumentOfPerigeeDeg", "aop"]),
        sampleValue(sample, ["true_anomaly_deg", "trueAnomalyDeg", "trueAnomaly", "nu"]),
        sampleValue(sample, ["mean_anomaly_deg", "meanAnomalyDeg", "meanAnomaly", "m"]),
        sampleValue(sample, ["orbital_period_seconds", "orbitalPeriodSeconds", "periodSeconds", "period"]),
        sampleValue(sample, ["mean_motion_rev_day", "meanMotionRevDay"]),
        sampleValue(sample, ["perigee_altitude_km", "perigeeAltitudeKm", "perigee"]),
        sampleValue(sample, ["apogee_altitude_km", "apogeeAltitudeKm", "apogee"]),
        sampleValue(sample, ["radius_km", "radiusKm", "radius"]),
        sampleValue(sample, ["speed_km_s", "speedKmS", "speed"]),
        stateValue(sample, "position", "x"),
        stateValue(sample, "position", "y"),
        stateValue(sample, "position", "z"),
        stateValue(sample, "velocity", "x"),
        stateValue(sample, "velocity", "y"),
        stateValue(sample, "velocity", "z")
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeName = String(targetLabel || "orbit").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "orbit";
    anchor.href = url;
    anchor.download = safeName + "-propagated-parameters.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ValuesTab({ samples, hasTarget, status, error, referenceFrame, onExport }) {
    const sampleReferenceFrame = firstDefined(samples[0], ["reference_frame", "referenceFrame", "frame"])
        ?? firstDefined(samples[0]?.state, ["reference_frame", "referenceFrame", "frame"]);
    const calculationFrame = referenceFrame ?? sampleReferenceFrame;
    const frameLabel = calculationFrame ? formatReferenceFrame(calculationFrame) : "";

    return <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between gap-3">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="m-0 text-[11px] font-semibold text-[#e4eefc]">Valores de efemérides</h3>
                    {frameLabel && <span className="rounded-[4px] border border-[#365d91] bg-[rgba(34,65,111,.38)] px-1.5 py-0.5 text-[8px] font-bold tracking-[.055em] text-[#bad7ff]" title="Marco del estado nativo desde el que se calculan los elementos osculantes">MARCO DE CÁLCULO · {frameLabel}</span>}
                </div>
                <p className="mt-1 mb-0 text-[10px] text-[#879bb8]">Tabla completa de elementos osculantes y estado propagado{frameLabel ? ` calculados en ${frameLabel}` : ""}.</p>
            </div>
            <button className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-[6px] border border-[#376e9c] bg-[#102a3f] px-2.5 text-[10px] font-bold text-[#b9dcff] hover:border-[#62a1d8] hover:bg-[#173b58] hover:text-white disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={!samples.length} onClick={onExport} title="Export propagated values as CSV"><ExportGlyph />Export CSV</button>
        </div>
        {samples.length > 0 ? <VirtualizedSamplesTable samples={samples} referenceFrame={calculationFrame} /> : <EmptyState hasTarget={hasTarget} status={status} error={error} />}
    </div>;
}

const RESIZE_HANDLES = [
    ["n", "top-0 right-2 left-2 h-2 cursor-n-resize"],
    ["s", "right-2 bottom-0 left-2 h-2 cursor-s-resize"],
    ["e", "top-2 right-0 bottom-2 w-2 cursor-e-resize"],
    ["w", "top-2 bottom-2 left-0 w-2 cursor-w-resize"],
    ["ne", "top-0 right-0 size-3 cursor-ne-resize"],
    ["nw", "top-0 left-0 size-3 cursor-nw-resize"],
    ["se", "right-0 bottom-0 size-3 cursor-se-resize"],
    ["sw", "bottom-0 left-0 size-3 cursor-sw-resize"]
];

export default function PropagatedOrbitParametersPanel() {
    const [panel, setPanel] = useState(EMPTY_PANEL_STATE);
    const [windowRect, setWindowRect] = useState(DEFAULT_WINDOW_RECT);
    const [activeTab, setActiveTab] = useState("info");
    const [chartOption, setChartOption] = useState(CHART_OPTIONS[0]);
    const [draftRange, setDraftRange] = useState({ start: "", end: "" });
    const panelRef = useRef(null);
    const interactionCleanupRef = useRef(null);

    useEffect(() => {
        const applyState = (event) => {
            const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
            setPanel((current) => ({
                ...current,
                ...detail,
                error: hasOwn(detail, "error") ? detail.error || "" : current.error,
                result: hasOwn(detail, "result") ? detail.result : current.result
            }));
        };
        const applyResult = (event) => {
            const detail = event.detail;
            const result = resultFromDetail(detail);
            if (!result) return;
            const envelope = detail && !Array.isArray(detail) && typeof detail === "object" ? detail : {};
            setPanel((current) => ({
                ...current,
                open: envelope.open ?? current.open,
                status: envelope.status ?? (envelope.error ? "error" : "ready"),
                target: envelope.target ?? result.satellite ?? result.target ?? current.target ?? null,
                range: envelope.range ?? current.range,
                error: envelope.error ?? "",
                result,
                earthOrientationPreflight: envelope.earthOrientationPreflight ?? current.earthOrientationPreflight,
                earthOrientationProvenance: envelope.earthOrientationProvenance ?? current.earthOrientationProvenance
            }));
        };
        const applyContext = (event) => {
            const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
            const contextRange = detail.range || detail.timeRange || (detail.startTime || detail.endTime || detail.start_time || detail.end_time
                ? {
                    startTime: detail.startTime ?? detail.start_time,
                    endTime: detail.endTime ?? detail.end_time,
                    referenceFrame: detail.referenceFrame ?? detail.reference_frame
                }
                : null);
            const replacesRequest = Boolean(detail.target || detail.satellite || detail.id || detail.manualOrbit || contextRange);
            if (replacesRequest) setActiveTab("info");
            setPanel((current) => ({
                ...current,
                ...detail,
                open: detail.open ?? true,
                target: targetFromContext(detail, current.target),
                range: contextRange ?? current.range,
                status: detail.status ?? (detail.error ? "error" : (replacesRequest ? "idle" : current.status)),
                error: hasOwn(detail, "error") ? detail.error || "" : (replacesRequest ? "" : current.error),
                result: hasOwn(detail, "result") ? detail.result : (detail.target || detail.satellite || detail.id || contextRange ? null : current.result)
            }));
        };
        const openFallback = (event) => {
            const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
            setPanel((current) => ({
                ...current,
                open: true,
                target: targetFromContext(detail, current.target),
                range: detail.range ?? detail.timeRange ?? current.range
            }));
        };
        const close = () => setPanel((current) => ({ ...current, open: false }));
        window.addEventListener("orbit:propagated-parameters-state", applyState);
        window.addEventListener("orbit:propagated-parameters-context", applyContext);
        window.addEventListener("orbit:propagated-parameters-open", openFallback);
        window.addEventListener("orbit:propagated-parameters-result", applyResult);
        window.addEventListener("orbit:propagated-parameters-close", close);
        window.addEventListener("orbit:propagated-parameters-cancel", close);
        return () => {
            window.removeEventListener("orbit:propagated-parameters-state", applyState);
            window.removeEventListener("orbit:propagated-parameters-context", applyContext);
            window.removeEventListener("orbit:propagated-parameters-open", openFallback);
            window.removeEventListener("orbit:propagated-parameters-result", applyResult);
            window.removeEventListener("orbit:propagated-parameters-close", close);
            window.removeEventListener("orbit:propagated-parameters-cancel", close);
        };
    }, []);

    useEffect(() => {
        emit("orbit:propagated-parameters-panel-state", {
            open: panel.open,
            source: "propagated-parameters-panel"
        });
    }, [panel.open]);

    useEffect(() => {
        const constrain = () => setWindowRect((current) => clampWindowRect(current));
        constrain();
        window.addEventListener("resize", constrain);
        return () => window.removeEventListener("resize", constrain);
    }, []);

    useEffect(() => () => interactionCleanupRef.current?.(), []);

    const result = panel.result;
    const samples = useMemo(() => samplesFrom(result), [result]);
    const targetLabel = labelForTarget(panel.target, result);
    const targetId = idForTarget(panel.target, result);
    const hasTarget = Boolean(targetLabel || targetId);
    const start = rangeValue(panel.range, result, "start");
    const end = rangeValue(panel.range, result, "end");
    const source = sourceKind(result?.source)
        ?? firstDefined(result, ["origin", "sourceFormat", "source_format"])
        ?? sourceKind(panel.target?.source)
        ?? firstDefined(panel.target, ["origin", "sourceFormat", "source_format"]);
    const propagator = firstDefined(result, ["propagator", "propagationModel", "propagation_model", "model"])
        ?? firstDefined(panel.target, ["propagator", "propagationModel", "propagation_model", "model"]);
    const referenceFrame = firstDefined(result, ["reference_frame", "referenceFrame", "frame"])
        ?? firstDefined(panel.range, ["referenceFrame", "reference_frame", "frame"])
        ?? firstDefined(panel.target, ["referenceFrame", "reference_frame", "frame"]);
    const rawRendererReference = firstDefined(result, ["renderer_reference", "rendererReference", "rendering"])
        ?? firstDefined(panel.target, ["rendererReference", "renderer_reference", "rendering"]);
    const targetInputMetadata = panel.target?.catalogMeta?.inputMetadata
        ?? panel.target?.catalogMeta?.input_metadata
        ?? panel.target?.inputMetadata
        ?? panel.target?.input_metadata
        ?? null;
    const isPreciseProduct = String(
        result?.source_format
        ?? result?.sourceFormat
        ?? panel.target?.sourceFormat
        ?? panel.target?.source_format
        ?? ""
    ).toUpperCase() === "SP3" || Boolean(rawRendererReference);
    const rendererReference = isPreciseProduct
        ? resolvePreciseProductFrameStatus({
            sp3: result?.sp3 ?? targetInputMetadata,
            renderer_reference: rawRendererReference,
            earth_orientation: result?.earth_orientation ?? result?.earthOrientation ?? null
        }, { runtimeFrame: referenceFrame || "" })
        : rawRendererReference;
    const displayFrame = (isPreciseProduct ? rendererReference?.displayFrame : null)
        ?? firstDefined(result, [
            "position_frame_display", "positionFrameDisplay", "reference_frame_display", "referenceFrameDisplay", "display_frame", "displayFrame"
        ]) ?? firstDefined(panel.target, [
            "displayReferenceFrame",
            "display_reference_frame",
            "previewReferenceFrame",
            "preview_reference_frame"
        ]) ?? firstDefined(panel.target, ["referenceFrame", "reference_frame", "frame"]);
    // Keep the raw result frame for numerical provenance and CSV data, but
    // every visible Ephemerides label must carry the product's qualified
    // display frame (for example "Marco terrestre aproximado (sin ERP)").
    const visibleReferenceFrame = displayFrame || referenceFrame;
    const errorText = errorMessage(panel.error);
    const [statusLabel, statusClass, statusText] = statusDescriptor(panel.status, errorText, hasTarget, samples.length);
    const earthOrientationNotice = earthOrientationPanelNotice(panel);

    useEffect(() => {
        const next = { start: toDateTimeInput(start), end: toDateTimeInput(end) };
        setDraftRange((current) => current.start === next.start && current.end === next.end ? current : next);
    }, [start, end, panel.open]);

    const requestRefresh = () => {
        if (!hasTarget) return;
        setPanel((current) => ({ ...current, status: "propagating", error: "" }));
        emit("orbit:propagated-parameters-refresh", {
            source: "propagated-parameters-panel",
            target: panel.target,
            range: panel.range
        });
    };

    const close = () => {
        setPanel((current) => ({ ...current, open: false }));
        emit("orbit:propagated-parameters-close", { source: "propagated-parameters-panel" });
    };

    const beginInteraction = (onMove) => {
        const end = () => {
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", end);
            document.removeEventListener("pointercancel", end);
            interactionCleanupRef.current = null;
        };
        interactionCleanupRef.current?.();
        interactionCleanupRef.current = end;
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", end, { once: true });
        document.addEventListener("pointercancel", end, { once: true });
    };

    const beginDrag = (event) => {
        if (event.button !== 0 || event.target.closest("button, input, select, label")) return;
        const initial = { ...windowRect };
        const pointer = { x: event.clientX, y: event.clientY };
        beginInteraction((moveEvent) => {
            setWindowRect(clampWindowRect({
                ...initial,
                x: initial.x + moveEvent.clientX - pointer.x,
                y: initial.y + moveEvent.clientY - pointer.y
            }));
        });
        event.preventDefault();
    };

    const beginResize = (direction, event) => {
        if (event.button !== 0) return;
        const initial = { ...windowRect };
        const pointer = { x: event.clientX, y: event.clientY };
        beginInteraction((moveEvent) => {
            const viewport = viewportBounds();
            const minimumWidth = Math.min(MIN_WINDOW_WIDTH, Math.max(280, viewport.width - (FLOAT_MARGIN * 2)));
            const minimumHeight = Math.min(MIN_WINDOW_HEIGHT, Math.max(300, viewport.height - (FLOAT_MARGIN * 2)));
            const right = initial.x + initial.width;
            const bottom = initial.y + initial.height;
            let x = initial.x;
            let y = initial.y;
            let width = initial.width;
            let height = initial.height;
            const deltaX = moveEvent.clientX - pointer.x;
            const deltaY = moveEvent.clientY - pointer.y;
            if (direction.includes("e")) width = clamp(initial.width + deltaX, minimumWidth, Math.max(minimumWidth, viewport.width - initial.x - FLOAT_MARGIN));
            if (direction.includes("w")) {
                width = clamp(initial.width - deltaX, minimumWidth, Math.max(minimumWidth, right - FLOAT_MARGIN));
                x = right - width;
            }
            if (direction.includes("s")) height = clamp(initial.height + deltaY, minimumHeight, Math.max(minimumHeight, viewport.height - initial.y - FLOAT_MARGIN));
            if (direction.includes("n")) {
                height = clamp(initial.height - deltaY, minimumHeight, Math.max(minimumHeight, bottom - FLOAT_MARGIN));
                y = bottom - height;
            }
            setWindowRect(clampWindowRect({ x, y, width, height }));
        });
        event.preventDefault();
        event.stopPropagation();
    };

    const updateRange = (range) => {
        if (!range?.startTime || !range?.endTime) return;
        setPanel((current) => ({ ...current, status: "propagating", error: "" }));
        emit("orbit:propagated-parameters-range-change", {
            ...range,
            source: "propagated-parameters-panel"
        });
    };

    const applySimulation = (range) => {
        if (!range?.startTime || !range?.endTime) return;
        setPanel((current) => ({ ...current, status: "propagating", error: "" }));
        emit("orbit:propagated-parameters-apply-simulation", {
            ...range,
            source: "propagated-parameters-panel"
        });
    };

    const exportCsv = () => exportSamplesCsv({
        samples,
        targetLabel,
        source: titleCase(source),
        propagator,
        referenceFrame,
        start,
        end
    });

    if (!panel.open) return null;

    const panelStyle = {
        left: String(windowRect.x) + "px",
        top: String(windowRect.y) + "px",
        width: String(windowRect.width) + "px",
        height: String(windowRect.height) + "px"
    };
    const tabs = [["info", "Información"], ["chart", "Gráfica"], ["values", "Valores"]];
    const panelTitle = targetLabel
        ? `Efemérides de ${targetLabel}`
        : "Efemérides";

    return <aside ref={panelRef} className="propagated-orbit-parameters-panel pointer-events-auto fixed z-[10126] flex min-h-[300px] min-w-[280px] flex-col overflow-hidden rounded-[11px] border border-[rgba(65,99,147,.7)] bg-[linear-gradient(145deg,rgba(12,26,45,.985),rgba(5,14,26,.985))] font-[system-ui,sans-serif] text-[#dbe7fa] shadow-[0_22px_60px_rgba(0,0,0,.48),inset_0_1px_rgba(255,255,255,.055)]" style={panelStyle} aria-label="Efemérides">
        <header className="flex shrink-0 cursor-move select-none items-start gap-3 border-b border-[#213550] px-4 py-3.5" onPointerDown={beginDrag}>
            <div className="min-w-0 flex-1">
                <h2 className="truncate text-[16px] leading-tight font-semibold text-[#f0f5ff]" title={panelTitle}>{panelTitle}</h2>
                <p className="mt-1 text-[10px] leading-[1.35] text-[#8ea1bd]">Elementos osculantes y estado propagado a lo largo del tiempo.</p>
            </div>
            <PanelCloseButton label="Cerrar efemérides" onPointerDown={(event) => event.stopPropagation()} onClick={close} />
        </header>

        <nav className="grid shrink-0 grid-cols-3 border-b border-[#203550] px-3" role="tablist" aria-label="Secciones del inspector">
            {tabs.map(([id, label]) => <button className={"relative cursor-pointer border-0 bg-transparent px-2 py-3 text-[10px] font-bold " + (activeTab === id ? "text-[#eaf1ff] after:absolute after:right-1 after:bottom-0 after:left-1 after:h-0.5 after:bg-[#5481ff] after:shadow-[0_0_8px_#5481ff] after:content-['']" : "text-[#8495ae] hover:text-[#cbd9ed]")} type="button" key={id} role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)}>{label}</button>)}
        </nav>

        {earthOrientationNotice && <p className={`mx-3.5 mt-3 mb-0 shrink-0 rounded-[7px] border px-2.5 py-2 text-[9px] leading-[1.35] ${earthOrientationNotice.warning ? "border-[#874252] bg-[rgba(82,28,42,.36)] text-[#ffd0d9]" : "border-[#776035] bg-[rgba(78,59,20,.3)] text-[#f5d38e]"}`} role={earthOrientationNotice.warning ? "alert" : "status"} data-testid="propagated-parameters-eop-coverage-notice"><strong>{earthOrientationNotice.actual ? "Proveniencia usada. " : "Preflight de la ventana. "}</strong>{earthOrientationNotice.message}{earthOrientationNotice.actual ? "" : " El servicio no ha devuelto aún la procedencia de ejecución."}</p>}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3.5">
            {activeTab === "info" && <InformationTab panel={panel} result={result} samples={samples} targetLabel={targetLabel} targetId={targetId} hasTarget={hasTarget} source={source} propagator={propagator} referenceFrame={referenceFrame} displayFrame={displayFrame} rendererReference={rendererReference} start={start} end={end} statusLabel={statusLabel} statusClass={statusClass} statusText={statusText} draftRange={draftRange} setDraftRange={setDraftRange} onUpdateRange={updateRange} onApplySimulation={applySimulation} onRefresh={requestRefresh} />}
            {activeTab === "chart" && <GraphTab samples={samples} option={chartOption} onOptionChange={setChartOption} hasTarget={hasTarget} status={panel.status} error={errorText} referenceFrame={visibleReferenceFrame} />}
            {activeTab === "values" && <ValuesTab samples={samples} hasTarget={hasTarget} status={panel.status} error={errorText} referenceFrame={visibleReferenceFrame} onExport={exportCsv} />}
        </div>

        {RESIZE_HANDLES.map(([direction, className]) => <div key={direction} className={"absolute z-40 touch-none " + className} aria-hidden="true" onPointerDown={(event) => beginResize(direction, event)} />)}
    </aside>;
}
