import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
    simulationRange: null,
    sampling: null,
    samplingIntervalSeconds: null,
    requestedOutputFrame: null,
    inspector: null,
    exportMetadata: null,
    result: null,
    earthOrientationPreflight: null,
    earthOrientationProvenance: null,
    history: [],
    error: ""
};

// Keep a stable first choice where the source exposes osculating elements,
// but construct the picker from the actual normalized value columns. This
// keeps a new backend-provided numeric field automatically graphable.
const DEFAULT_CHART_COLUMN_ID = "osc-a";
const SAMPLING_INTERVAL_OPTIONS = [
    { value: "auto", label: "Auto" },
    { value: "60", label: "1 min" },
    { value: "300", label: "5 min" },
    { value: "900", label: "15 min" },
    { value: "1800", label: "30 min" },
    { value: "3600", label: "1 h" },
    { value: "10800", label: "3 h" },
    { value: "21600", label: "6 h" },
    { value: "86400", label: "1 d" }
];

const ROW_HEIGHT = 34;
const TABLE_BUFFER = 12;
const FLOAT_MARGIN = 12;
const MIN_WINDOW_WIDTH = 450;
const MIN_WINDOW_HEIGHT = 410;
const DEFAULT_WINDOW_RECT = { x: 72, y: 88, width: 720, height: 660 };
const INSPECTOR_MODAL_Z_INDEX = 2147483000;

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

function formatSamplingInterval(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return "--";
    if (seconds < 60) return `${numeric(seconds, 2)} s`;
    if (seconds < 3600) return `${numeric(seconds / 60, 2)} min`;
    if (seconds < 86400) return `${numeric(seconds / 3600, 2)} h`;
    return `${numeric(seconds / 86400, 2)} d`;
}

function finiteTimeRange(range) {
    const start = rangeValue(range, null, "start");
    const end = rangeValue(range, null, "end");
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()) return null;
    return {
        start: startDate.toISOString(),
        end: endDate.toISOString()
    };
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
    // The backend's transport kind is usually `catalog`; the declared input
    // format is the useful provenance for operators and exports.
    return firstDefined(value, ["sourceFormat", "source_format", "format", "type", "kind", "id"]);
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

function centeredWindowRect(rect = DEFAULT_WINDOW_RECT) {
    const viewport = viewportBounds();
    const normalized = clampWindowRect(rect);
    return {
        ...normalized,
        x: Math.round((viewport.width - normalized.width) / 2),
        y: Math.round((viewport.height - normalized.height) / 2)
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
                : "Pulsa Refresh para calcular la serie orbital.";
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

function isPresentValue(value) {
    return value !== undefined
        && value !== null
        && value !== ""
        && !(typeof value === "number" && !Number.isFinite(value));
}

function readPath(source, path) {
    let value = source;
    for (const key of String(path || "").split(".")) {
        if (!value || typeof value !== "object" || !hasOwn(value, key)) return undefined;
        value = value[key];
    }
    return value;
}

function sampleField(sample, keys) {
    const sources = [
        sample,
        sample?.state,
        sample?.elements,
        sample?.osculatingElements,
        sample?.osculating_elements,
        sample?.quality,
        sample?.metadata
    ];
    for (const key of keys) {
        for (const source of sources) {
            const value = String(key).includes(".")
                ? readPath(source, key)
                : source?.[key];
            if (isPresentValue(value)) return value;
        }
    }
    return undefined;
}

function positionComponent(sample, axis) {
    return sampleField(sample, [
        `position_${axis}_km`, `position${axis.toUpperCase()}Km`, `${axis}_km`, axis,
        `position.${axis}`, `position.${axis}_km`, `r.${axis}`
    ]);
}

function velocityComponent(sample, axis) {
    return sampleField(sample, [
        `velocity_${axis}_km_s`, `velocity${axis.toUpperCase()}KmS`, `v${axis}_km_s`, `v${axis}`,
        `velocity.${axis}`, `velocity.${axis}_km_s`, `v.${axis}`
    ]);
}

function vectorMagnitude(sample, vector) {
    const explicit = vector === "position"
        ? sampleField(sample, ["radius_km", "radiusKm", "geocentric_radius_km"])
        : sampleField(sample, ["speed_km_s", "speedKmS", "velocity_magnitude_km_s"]);
    const component = vector === "position" ? positionComponent : velocityComponent;
    const coordinates = ["x", "y", "z"].map((axis) => Number(component(sample, axis)));
    if (coordinates.every(Number.isFinite)) {
        return Math.hypot(...coordinates);
    }
    return Number.isFinite(Number(explicit)) ? Number(explicit) : undefined;
}

function formatTableValue(value, type) {
    if (!isPresentValue(value)) return "--";
    if (type === "time") return formatTime(value);
    if (type === "frame") return formatReferenceFrame(value);
    if (type === "text" || type === "flag") {
        if (typeof value === "boolean") return value ? "Sí" : "No";
        return String(value);
    }
    if (type === "acceleration") return numeric(value, 7);
    if (type === "quality") return String(value);
    return formatCell(value, type);
}

function columnDisplayLabel(column) {
    const label = String(column?.label || "");
    const unit = String(column?.unit || "").trim();
    if (!unit || label.includes(`(${unit})`)) return label;
    return `${label} (${unit})`;
}

const BASE_VALUE_COLUMNS = [
    { id: "epoch", label: "Epoch UTC", type: "time", provenance: "direct", get: (sample) => sampleField(sample, ["time", "timestamp", "utc", "date", "epoch", "epochUtc", "epoch_utc"]) },
    { id: "frame", label: "Frame", type: "frame", provenance: "direct", get: (sample) => sampleField(sample, ["reference_frame", "referenceFrame", "frame", "position_frame", "positionFrame"]) },
    { id: "time-scale", label: "Escala temporal", type: "text", provenance: "direct", get: (sample) => sampleField(sample, ["time_scale", "timeScale"]) },
    { id: "x", label: "X (km)", type: "distance", provenance: "direct", get: (sample) => positionComponent(sample, "x") },
    { id: "y", label: "Y (km)", type: "distance", provenance: "direct", get: (sample) => positionComponent(sample, "y") },
    { id: "z", label: "Z (km)", type: "distance", provenance: "direct", get: (sample) => positionComponent(sample, "z") },
    { id: "vx", label: "Vx (km/s)", type: "speed", provenance: "direct", get: (sample) => velocityComponent(sample, "x") },
    { id: "vy", label: "Vy (km/s)", type: "speed", provenance: "direct", get: (sample) => velocityComponent(sample, "y") },
    { id: "vz", label: "Vz (km/s)", type: "speed", provenance: "direct", get: (sample) => velocityComponent(sample, "z") },
    { id: "radius", label: "|r| (km)", type: "distance", provenance: "derived", get: (sample) => vectorMagnitude(sample, "position") },
    { id: "speed", label: "|v| (km/s)", type: "speed", provenance: "derived", get: (sample) => vectorMagnitude(sample, "velocity") }
];

const OSCULATING_VALUE_COLUMNS = [
    { id: "osc-a", label: "a osc. (km)", type: "distance", provenance: "derived", get: (sample) => sampleField(sample, ["semi_major_axis_km", "semiMajorAxisKm", "a"]) },
    { id: "osc-e", label: "e osc.", type: "eccentricity", provenance: "derived", get: (sample) => sampleField(sample, ["eccentricity", "e"]) },
    { id: "osc-i", label: "i osc. (deg)", type: "angle", provenance: "derived", get: (sample) => sampleField(sample, ["inclination_deg", "inclinationDeg", "i"]) },
    { id: "osc-raan", label: "RAAN osc. (deg)", type: "angle", provenance: "derived", get: (sample) => sampleField(sample, ["raan_deg", "raanDeg", "raan"]) },
    { id: "osc-arg-peri", label: "Arg. periapsis osc. (deg)", type: "angle", provenance: "derived", get: (sample) => sampleField(sample, ["argument_of_periapsis_deg", "argumentOfPeriapsisDeg", "argumentOfPerigeeDeg", "aop"]) },
    { id: "osc-true-anomaly", label: "Anomalía verdadera osc. (deg)", type: "angle", provenance: "derived", get: (sample) => sampleField(sample, ["true_anomaly_deg", "trueAnomalyDeg", "trueAnomaly", "nu"]) },
    { id: "osc-mean-anomaly", label: "Anomalía media osc. (deg)", type: "angle", provenance: "derived", get: (sample) => sampleField(sample, ["mean_anomaly_deg", "meanAnomalyDeg", "meanAnomaly", "m"]) },
    { id: "osc-period", label: "Periodo osc. (min)", type: "period", provenance: "derived", get: (sample) => sampleField(sample, ["orbital_period_seconds", "orbitalPeriodSeconds", "periodSeconds", "period"]) },
    { id: "osc-perigee", label: "Perigeo osc. (km)", type: "distance", provenance: "derived", get: (sample) => sampleField(sample, ["perigee_altitude_km", "perigeeAltitudeKm", "perigee"]) },
    { id: "osc-apogee", label: "Apogeo osc. (km)", type: "distance", provenance: "derived", get: (sample) => sampleField(sample, ["apogee_altitude_km", "apogeeAltitudeKm", "apogee"]) }
];

const OMM_MEAN_VALUE_COLUMNS = [
    { id: "mean-a", label: "a medio (km)", type: "distance", provenance: "direct", get: (sample) => sampleField(sample, ["mean_semi_major_axis_km", "meanSemiMajorAxisKm", "mean_a", "meanA"]) },
    { id: "mean-e", label: "e medio", type: "eccentricity", provenance: "direct", get: (sample) => sampleField(sample, ["mean_eccentricity", "meanEccentricity"]) },
    { id: "mean-i", label: "i medio (deg)", type: "angle", provenance: "direct", get: (sample) => sampleField(sample, ["mean_inclination_deg", "meanInclinationDeg"]) },
    { id: "mean-raan", label: "RAAN medio (deg)", type: "angle", provenance: "direct", get: (sample) => sampleField(sample, ["mean_raan_deg", "meanRaanDeg"]) },
    { id: "mean-arg-peri", label: "Arg. periapsis medio (deg)", type: "angle", provenance: "direct", get: (sample) => sampleField(sample, ["mean_argument_of_periapsis_deg", "meanArgumentOfPeriapsisDeg", "mean_aop"]) },
    { id: "mean-anomaly", label: "M medio (deg)", type: "angle", provenance: "direct", get: (sample) => sampleField(sample, ["mean_anomaly_deg_input", "meanAnomalyDegInput", "mean_anomaly_mean_deg", "meanAnomalyMeanDeg"]) },
    { id: "mean-motion", label: "Movimiento medio (rev/d)", type: "number", provenance: "direct", get: (sample) => sampleField(sample, ["mean_motion_rev_day", "meanMotionRevDay"]) }
];

function hasColumnValues(samples, column) {
    return samples.some((sample) => isPresentValue(column.get(sample)));
}

function inspectorColumns(inspector, samples) {
    const declared = [
        ...(Array.isArray(inspector?.columns) ? inspector.columns : []),
        ...(Array.isArray(inspector?.cartesianColumns) ? inspector.cartesianColumns : [])
    ];
    const standardFields = new Set([
        "time", "epoch", "utc", "referenceFrame", "reference_frame", "frame", "timeScale", "time_scale",
        "x", "y", "z", "vx", "vy", "vz",
        "semiMajorAxisKm", "semi_major_axis_km", "eccentricity", "inclinationDeg", "inclination_deg",
        "raanDeg", "raan_deg", "argumentOfPerigeeDeg", "argument_of_periapsis_deg", "trueAnomalyDeg", "true_anomaly_deg",
        "meanAnomalyDeg", "mean_anomaly_deg", "perigeeAltitudeKm", "perigee_altitude_km", "apogeeAltitudeKm", "apogee_altitude_km",
        "orbitalPeriodSeconds", "orbital_period_seconds", "radiusKm", "radius_km", "speedKmS", "speed_km_s",
        "meanSemiMajorAxisKm", "mean_semi_major_axis_km", "meanEccentricity", "mean_eccentricity",
        "meanInclinationDeg", "mean_inclination_deg", "meanRaanDeg", "mean_raan_deg",
        "meanArgumentOfPeriapsisDeg", "mean_argument_of_periapsis_deg",
        "meanAnomalyDegInput", "mean_anomaly_deg_input", "meanMotionRevDay", "mean_motion_rev_day"
    ]);
    const seen = new Set();
    return declared.map((column, index) => {
        const descriptor = typeof column === "string" ? { key: column } : column;
        const key = String(descriptor?.key ?? descriptor?.id ?? descriptor?.field ?? "").trim();
        if (!key || standardFields.has(key) || seen.has(key)) return null;
        seen.add(key);
        const derived = descriptor?.derived === true
            || descriptor?.group === "derived"
            || String(descriptor?.provenance || "").toLowerCase().includes("derived");
        return {
            id: `runtime-${key}`,
            label: descriptor?.label || titleCase(key),
            type: descriptor?.type || "number",
            unit: descriptor?.unit || null,
            unitVaries: descriptor?.unitVaries === true,
            direct: !derived,
            derived,
            provenance: derived ? "derived" : "direct",
            get: (sample) => sampleField(sample, [key, ...(Array.isArray(descriptor?.aliases) ? descriptor.aliases : [])]),
            index
        };
    }).filter((column) => column && hasColumnValues(samples, column));
}

const CARTESIAN_VALUE_FIELD_IDS = {
    x: ["x"],
    y: ["y"],
    z: ["z"],
    vx: ["vx"],
    vy: ["vy"],
    vz: ["vz"],
    radius: ["radiusKm", "radius_km"],
    speed: ["speedKmS", "speed_km_s"]
};

function applyInspectorCartesianColumnMetadata(column, inspector) {
    const fieldIds = CARTESIAN_VALUE_FIELD_IDS[column?.id];
    if (!fieldIds) return column;
    const declared = [
        ...(Array.isArray(inspector?.columns) ? inspector.columns : []),
        ...(Array.isArray(inspector?.cartesianColumns) ? inspector.cartesianColumns : [])
    ];
    const metadata = declared.find((candidate) => fieldIds.includes(String(candidate?.id ?? candidate?.key ?? candidate?.field ?? "")));
    if (!metadata) return column;
    const derived = metadata?.derived === true
        || metadata?.group === "derived"
        || String(metadata?.provenance || "").toLowerCase().includes("derived");
    return {
        ...column,
        label: metadata?.label || column.label,
        unit: metadata?.unit ?? column.unit ?? null,
        unitVaries: metadata?.unitVaries === true || column.unitVaries === true,
        provenance: derived ? "derived" : metadata?.direct === true ? "direct" : column.provenance
    };
}

function valueColumnsForProfile(profile, samples, referenceFrame, inspector) {
    const columns = BASE_VALUE_COLUMNS.map((column) => {
        const resolved = column.id === "frame"
            ? { ...column, get: (sample) => column.get(sample) ?? referenceFrame }
            : column;
        return applyInspectorCartesianColumnMetadata(resolved, inspector);
    });
    const appendAvailable = (candidates) => columns.push(...candidates.filter((column) => hasColumnValues(samples, column)));
    if (profile?.kind === "omm") {
        appendAvailable(OMM_MEAN_VALUE_COLUMNS);
    }
    // OMM keeps its declared mean elements distinct, but an SGP4/analytical
    // runtime can also return a separately labelled osculating state. Show
    // both only when they actually arrived; never relabel mean values as
    // osculating ones or manufacture a duplicate column.
    appendAvailable(OSCULATING_VALUE_COLUMNS);
    for (const column of inspectorColumns(inspector, samples)) {
        if (!columns.some((candidate) => candidate.id === column.id || candidate.label === column.label)) columns.push(column);
    }
    return columns;
}

const NON_CHARTABLE_COLUMN_TYPES = new Set(["time", "frame", "text", "flag"]);

function chartProvenance(column) {
    const declared = String(column?.provenance || "").toLowerCase();
    return column?.derived === true
        || column?.direct === false
        || column?.group === "derived"
        || declared.includes("derived")
        || declared.startsWith("cartesian-")
        ? "derived"
        : "direct";
}

function provenanceDescription(provenance) {
    return provenance === "derived"
        ? "Derivado: calculado o declarado por el runtime a partir de la fuente o de la propagación."
        : "Directo: recibido de la fuente o del estado propagado sin derivarlo en esta vista.";
}

function ProvenanceBadge({ provenance, className = "" }) {
    const derived = provenance === "derived";
    return <span className={"inline-flex shrink-0 rounded px-1.5 py-0.5 text-[7px] font-bold tracking-[.04em] " + (derived ? "bg-[rgba(128,100,47,.25)] text-[#f2ce8d]" : "bg-[rgba(43,97,155,.28)] text-[#a9d4ff]") + (className ? " " + className : "")} title={provenanceDescription(provenance)}>{derived ? "DERIVADO" : "DIRECTO"}</span>;
}

function finiteNumericColumnValue(column, sample) {
    const raw = column?.get?.(sample);
    if (typeof raw === "boolean" || raw === null || raw === undefined || raw === "") return Number.NaN;
    const value = Number(raw);
    return Number.isFinite(value) ? value : Number.NaN;
}

function chartLabelAndUnit(column) {
    const rawLabel = String(column?.label || column?.id || "Valor").trim();
    const labelWithUnit = rawLabel.match(/^(.*?)\s*\(([^()]+)\)$/);
    let label = labelWithUnit ? labelWithUnit[1].trim() : rawLabel;
    let unit = String(column?.unit || "").trim() || (labelWithUnit ? labelWithUnit[2].trim() : "");
    // The Values table renders period values in minutes, so the chart must
    // use the same visible unit rather than plotting seconds under a min tag.
    if (column?.type === "period") unit = "min";
    if (!label) label = rawLabel || "Valor";
    return {
        label,
        unit,
        displayLabel: unit ? `${label} (${unit})` : label
    };
}

function chartDigitsForColumn(column) {
    if (Number.isInteger(column?.digits) && column.digits >= 0) return column.digits;
    switch (column?.type) {
    case "acceleration": return 7;
    case "eccentricity": return 7;
    case "speed": return 6;
    case "angle": return 4;
    case "period": return 4;
    case "distance": return 3;
    default: return 6;
    }
}

function chartOptionsForProfile(profile, samples, referenceFrame, inspector) {
    return valueColumnsForProfile(profile, samples, referenceFrame, inspector)
        .filter((column) => !NON_CHARTABLE_COLUMN_TYPES.has(String(column?.type || "number").toLowerCase()))
        .filter((column) => samples.filter((sample) => Number.isFinite(finiteNumericColumnValue(column, sample))).length >= 2)
        .map((column) => {
            const label = chartLabelAndUnit(column);
            return {
                id: column.id,
                ...label,
                type: column.type || "number",
                unitVaries: column.unitVaries === true,
                provenance: chartProvenance(column),
                digits: chartDigitsForColumn(column),
                multiplier: column.type === "period" ? 1 / 60 : 1,
                getValue: (sample) => finiteNumericColumnValue(column, sample)
            };
        });
}

function exportColumnId(column) {
    const ids = {
        epoch: "time",
        frame: "referenceFrame",
        "time-scale": "timeScale",
        radius: "radiusKm",
        speed: "speedKmS",
        "osc-a": "semiMajorAxisKm",
        "osc-e": "eccentricity",
        "osc-i": "inclinationDeg",
        "osc-raan": "raanDeg",
        "osc-arg-peri": "argumentOfPerigeeDeg",
        "osc-true-anomaly": "trueAnomalyDeg",
        "osc-mean-anomaly": "meanAnomalyDeg",
        "osc-period": "orbitalPeriodSeconds",
        "osc-perigee": "perigeeAltitudeKm",
        "osc-apogee": "apogeeAltitudeKm",
        "mean-a": "meanSemiMajorAxisKm",
        "mean-e": "meanEccentricity",
        "mean-i": "meanInclinationDeg",
        "mean-raan": "meanRaanDeg",
        "mean-arg-peri": "meanArgumentOfPeriapsisDeg",
        "mean-anomaly": "meanAnomalyDegInput",
        "mean-motion": "meanMotionRevDay"
    };
    return ids[column?.id] || String(column?.id || "").replace(/^runtime-/, "");
}

function inputTimeToMs(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const date = new Date(/[zZ]$|[+-]\d\d:\d\d$/.test(text) ? text : text + "Z");
    return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function rowsForTimeFilter(samples, filter) {
    const start = inputTimeToMs(filter?.start);
    const end = inputTimeToMs(filter?.end);
    if (start === null && end === null) return samples.map((sample, index) => ({ sample, index }));
    return samples.map((sample, index) => ({ sample, index })).filter(({ sample }) => {
        const epoch = parseDate(sampleField(sample, ["time", "timestamp", "utc", "date", "epoch", "epochUtc", "epoch_utc"]));
        if (!epoch) return false;
        const timestamp = epoch.getTime();
        return (start === null || timestamp >= start) && (end === null || timestamp <= end);
    });
}

function sortValueRows(rows, column, direction) {
    if (!column) return rows;
    const factor = direction === "desc" ? -1 : 1;
    return [...rows].sort((left, right) => {
        const leftValue = column.get(left.sample);
        const rightValue = column.get(right.sample);
        const leftPresent = isPresentValue(leftValue);
        const rightPresent = isPresentValue(rightValue);
        if (!leftPresent || !rightPresent) {
            if (leftPresent === rightPresent) return left.index - right.index;
            return leftPresent ? -1 : 1;
        }
        const leftDate = column.type === "time" ? parseDate(leftValue)?.getTime() : null;
        const rightDate = column.type === "time" ? parseDate(rightValue)?.getTime() : null;
        const leftNumber = column.type !== "text" && column.type !== "frame" && column.type !== "flag" && column.type !== "quality" ? Number(leftValue) : Number.NaN;
        const rightNumber = column.type !== "text" && column.type !== "frame" && column.type !== "flag" && column.type !== "quality" ? Number(rightValue) : Number.NaN;
        if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return factor * (leftDate - rightDate);
        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return factor * (leftNumber - rightNumber);
        return factor * String(leftValue).localeCompare(String(rightValue), "es");
    });
}

function ValueColumnPicker({ columns, visibleColumnIds, onToggle }) {
    const [open, setOpen] = useState(false);
    return <div className="relative shrink-0">
        <button className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[6px] border border-[#31537b] bg-[#10223b] px-2.5 text-[10px] font-bold text-[#c0d8ff] hover:border-[#5683bc] hover:bg-[#163155] hover:text-white" type="button" data-testid="propagated-parameters-column-picker-trigger" aria-haspopup="menu" aria-expanded={open} aria-controls="propagated-parameters-column-picker" onClick={() => setOpen((current) => !current)}>Columnas</button>
        {open && <div id="propagated-parameters-column-picker" data-testid="propagated-parameters-column-picker" className="orbit-scrollbar absolute top-[calc(100%+6px)] right-0 z-30 grid max-h-[300px] w-[240px] overflow-y-auto rounded-[8px] border border-[#355272] bg-[#0b182a] p-1.5 shadow-[0_14px_30px_rgba(0,0,0,.5)]" role="menu" aria-label="Mostrar u ocultar columnas">
            {columns.map((column) => <label className="flex cursor-pointer items-center gap-2 rounded-[5px] px-2 py-1.5 text-[10px] text-[#c6d6eb] hover:bg-[#162d4c]" key={column.id}>
                <input type="checkbox" checked={visibleColumnIds.includes(column.id)} onChange={() => onToggle(column.id)} />
                <span className="min-w-0 flex-1 truncate">{columnDisplayLabel(column)}</span>
                <span className={"rounded px-1 py-0.5 text-[7px] font-bold tracking-[.04em] " + (column.provenance === "derived" ? "bg-[rgba(128,100,47,.25)] text-[#f2ce8d]" : "bg-[rgba(43,97,155,.28)] text-[#a9d4ff]")}>{column.provenance === "derived" ? "DERIVADO" : "DIRECTO"}</span>
            </label>)}
        </div>}
    </div>;
}

function VirtualizedValueTable({ rows, columns, sort, onSort, referenceFrame }) {
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
    }, [rows, columns]);

    const windowedRows = useMemo(() => {
        const visibleStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - TABLE_BUFFER);
        const visibleEnd = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + TABLE_BUFFER);
        return {
            first: visibleStart,
            before: visibleStart * ROW_HEIGHT,
            after: Math.max(0, rows.length - visibleEnd) * ROW_HEIGHT,
            rows: rows.slice(visibleStart, visibleEnd)
        };
    }, [rows, scrollTop, viewportHeight]);

    const frameLabel = referenceFrame ? formatReferenceFrame(referenceFrame) : "";
    const requestSort = (column) => onSort({
        id: column.id,
        direction: sort.id === column.id && sort.direction === "asc" ? "desc" : "asc"
    });

    return <div ref={viewportRef} data-testid="propagated-parameters-cartesian-table" className="orbit-scrollbar min-h-0 flex-1 overflow-auto rounded-[8px] border border-[#1e3451] bg-[rgba(4,12,23,.56)]" aria-label={frameLabel ? `Tabla cartesiana de efemérides en ${frameLabel}` : "Tabla cartesiana de efemérides"} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        <table className="min-w-[1100px] w-full border-separate border-spacing-0 text-left font-[system-ui,sans-serif] text-[10px] tabular-nums">
            <thead className="sticky top-0 z-[2] bg-[#101e33] text-[#aec2df] shadow-[0_1px_0_#294362]">
                <tr>{columns.map((column) => <th className="h-[42px] whitespace-nowrap border-b border-[#294362] px-2.5 text-[9px] font-bold tracking-[.025em]" key={column.id} data-provenance={column.provenance} aria-sort={sort.id === column.id ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
                    <button className="grid cursor-pointer appearance-none gap-0.5 border-0 bg-transparent p-0 text-left text-inherit hover:text-white" type="button" aria-label={`Ordenar por ${columnDisplayLabel(column)}`} onClick={() => requestSort(column)}>
                        <span>{columnDisplayLabel(column)}{sort.id === column.id ? <span className="ml-1 text-[#7eb4ff]">{sort.direction === "asc" ? "↑" : "↓"}</span> : null}</span>
                        <span className={"w-max rounded px-1 py-px text-[7px] leading-none " + (column.provenance === "derived" ? "bg-[rgba(128,100,47,.25)] text-[#f2ce8d]" : "bg-[rgba(43,97,155,.28)] text-[#a9d4ff]")}>{column.provenance === "derived" ? "DERIVADO" : "DIRECTO"}</span>
                    </button>
                </th>)}</tr>
            </thead>
            <tbody className="text-[#cfdbec]">
                {windowedRows.before > 0 && <tr aria-hidden="true" style={{ height: windowedRows.before }}><td className="p-0" colSpan={columns.length} /></tr>}
                {windowedRows.rows.map(({ sample, index }) => <tr className="h-[34px] hover:bg-[rgba(69,115,190,.12)]" key={String(sampleField(sample, ["time", "timestamp", "utc", "date"]) || "sample") + "-" + index}>
                    {columns.map((column) => {
                        const value = column.get(sample);
                        const rendered = formatTableValue(value, column.type);
                        return <td className="max-w-[210px] truncate whitespace-nowrap border-b border-[rgba(30,52,81,.64)] px-2.5" key={column.id} title={isPresentValue(value) ? String(value) : "No disponible en esta fuente"}>{rendered}</td>;
                    })}
                </tr>)}
                {windowedRows.after > 0 && <tr aria-hidden="true" style={{ height: windowedRows.after }}><td className="p-0" colSpan={columns.length} /></tr>}
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

function inspectorFrom(panel, result) {
    const inspector = panel?.inspector
        ?? panel?.inspectorMetadata
        ?? panel?.inspector_metadata
        ?? result?.inspector
        ?? result?.inspector_metadata
        ?? result?.inspectorMetadata
        ?? null;
    return inspector && typeof inspector === "object" ? inspector : {};
}

function profileKind(value) {
    const normalized = String(value || "").trim().toLowerCase().replace(/[ _-]+/g, "");
    if (normalized.includes("tle") || normalized.includes("sgp4")) return "tle";
    if (normalized.includes("sp3") || normalized.includes("igs")) return "sp3";
    if (normalized.includes("oem")) return "oem";
    if (normalized.includes("omm")) return "omm";
    if (normalized.includes("statevector") || normalized.includes("cartesian") || normalized === "rv") return "state-vector";
    if (normalized.includes("numeric") || normalized.includes("cowell") || normalized.includes("rk4") || normalized.includes("rk45")) return "numeric";
    if (normalized.includes("manual")) return "manual";
    return "unknown";
}

function sourceProfileFrom(panel, result, source, propagator, inspector) {
    const profile = inspector?.sourceProfile
        ?? inspector?.source_profile
        ?? inspector?.source
        ?? result?.sourceProfile
        ?? result?.source_profile
        ?? panel?.sourceProfile
        ?? panel?.source_profile
        ?? result?.input
        ?? null;
    const profileRecord = profile && typeof profile === "object" ? profile : {};
    const candidate = typeof profile === "string"
        ? profile
        : firstDefined(profileRecord, ["type", "format", "sourceFormat", "source_format", "inputType", "input_type", "kind", "source"])
            ?? firstDefined(result, ["source_format", "sourceFormat", "input_type", "inputType"])
            ?? firstDefined(panel?.target, ["source_format", "sourceFormat", "input_type", "inputType"])
            ?? source
            ?? propagator;
    let kind = profileKind(candidate);
    // A manually authored orbit may still execute a numerical propagator.
    // The input profile must describe that actual method so force and
    // acceleration columns are available when the runtime supplied them.
    if (inspector?.method?.family === "numerical") kind = "numeric";
    if (kind === "unknown" && String(panel?.range?.mode || "").toLowerCase().includes("manual-design")) kind = "manual";
    const labels = {
        tle: "TLE / SGP4",
        sp3: "SP3 / IGS",
        oem: "OEM",
        omm: "OMM",
        "state-vector": "Vectores de estado r/v",
        numeric: "Propagación numérica",
        manual: "Diseño manual",
        unknown: "Fuente de entrada"
    };
    return {
        kind,
        // `inspector.source.name` identifies the spacecraft, not the input
        // profile. Keeping it out of the label avoids badges such as “ISS”
        // where the user needs to read “TLE / SGP4”.
        label: firstDefined(profileRecord, ["label", "displayName", "display_name"]) || labels[kind],
        record: profileRecord,
        raw: candidate
    };
}

function metadataSources(panel, result, inspector, profile) {
    return [
        inspector?.method,
        inspector?.source?.metadata,
        inspector?.metadata,
        inspector,
        profile?.record,
        profile?.record?.metadata,
        result?.model,
        result?.metadata,
        result?.inputMetadata,
        result?.input_metadata,
        result,
        panel?.target?.inputMetadata,
        panel?.target?.input_metadata,
        panel?.target?.catalogMeta?.inputMetadata,
        panel?.target?.catalogMeta?.input_metadata,
        panel?.target
    ].filter((source) => source && typeof source === "object");
}

function metadataValue(sources, keys) {
    for (const source of sources) {
        for (const key of keys) {
            const value = String(key).includes(".") ? readPath(source, key) : source?.[key];
            if (isPresentValue(value)) return value;
        }
    }
    return undefined;
}

function methodValue(value) {
    if (!isPresentValue(value)) return "No disponible en esta fuente";
    if (Array.isArray(value)) return value.length ? value.map((item) => methodValue(item)).join(" · ") : "No disponible en esta fuente";
    if (typeof value === "boolean") return value ? "Sí" : "No";
    if (typeof value === "object") {
        if (value.available === false) return "No disponible en esta fuente";
        if (Array.isArray(value.terms)) return value.terms.length
            ? value.terms.map((item) => methodValue(item)).join(" · ")
            : value.available === true ? "Sin términos declarados" : "No disponible en esta fuente";
        if (isPresentValue(value.value)) {
            return String(value.value) + (isPresentValue(value.unit) ? ` ${value.unit}` : "");
        }
        const label = firstDefined(value, ["label", "name", "id", "value", "description"]);
        return isPresentValue(label) ? String(label) : value.available === true ? "Disponible" : "No disponible en esta fuente";
    }
    return String(value);
}

function sourceMethodNarrative(profile) {
    const narratives = {
        tle: "La entrada conserva elementos medios TLE; los elementos osculantes, cuando aparecen, se derivan del estado propagado.",
        sp3: "El producto SP3 se presenta como estados y calidad publicados; los elementos osculantes solo se muestran si el runtime los derivó.",
        oem: "La fuente OEM conserva sus vectores de estado y marco nativo; cualquier elemento orbital adicional se etiqueta como derivado.",
        omm: "Los campos OMM son elementos medios de entrada, no elementos osculantes. La tabla no los sustituye por valores derivados sin declararlo.",
        "state-vector": "La fuente aporta vectores cartesianos r/v; las cantidades orbitales adicionales solo se muestran cuando fueron derivadas por el runtime.",
        numeric: "La propagación numérica usa la configuración declarada por el runtime; fuerzas, paso y tolerancias se muestran solo cuando se recibieron.",
        manual: "La ventana y el modelo del diseño manual son autoritativos para esta inspección.",
        unknown: "La información mostrada procede exclusivamente de los metadatos recibidos por el runtime."
    };
    return narratives[profile?.kind] || narratives.unknown;
}

function methodFieldsForProfile(profile, sources, referenceFrame, inspector) {
    const frame = inspector?.frame && typeof inspector.frame === "object" ? inspector.frame : {};
    const nativeFrame = frame.native || referenceFrame;
    const outputFrame = frame.current || referenceFrame;
    const calculationFrame = frame.calculation || frame.dynamics || nativeFrame;
    const value = (keys) => {
        const declared = metadataValue(sources, keys);
        if (isPresentValue(declared)) return declared;
        // The normalized contract exposes model identity under `method`,
        // while legacy responses may use method_name/propagator. Both are
        // equally factual and should produce a visible method label.
        if (Array.isArray(keys) && keys.some((key) => ["method_name", "methodName", "method", "propagator", "integrator"].includes(key))) {
            return inspector?.method?.label ?? inspector?.method?.applied ?? inspector?.method?.id;
        }
        return declared;
    };
    const directRowValue = (key) => {
        const row = Array.isArray(inspector?.rows)
            ? inspector.rows.find((candidate) => isPresentValue(candidate?.[key]))
            : null;
        if (!row) return undefined;
        const unit = row?.fieldUnits?.[key];
        return unit ? { value: row[key], unit } : row[key];
    };
    const common = [
        ["Marco de salida", outputFrame],
        ["Marco de elementos", calculationFrame],
        ["Interpolación", value(["interpolation.method", "interpolation.declared_method", "interpolationMethod"])],
        ["Cadencia publicada", value(["interpolation.mean_sample_cadence_seconds", "interpolation.sample_cadence_seconds", "sample_cadence_seconds"])],
        ["Perfil de entrada", profile?.label],
        ["Método", value(["method_name", "methodName", "method", "propagator", "integrator"])],
        ["Paso interno", value(["internal_step", "internalStep", "step_size", "stepSize", "step", "integrator.step"])],
        ["Fuerzas", inspector?.forces ?? value(["force_models", "forceModels", "forces", "dynamics.force_models", "dynamics.forces"])],
        ["Tolerancias", inspector?.precision ?? value(["tolerances", "tolerance", "absolute_tolerance", "absoluteTolerance", "relative_tolerance", "relativeTolerance", "precision"])]
    ];
    const specific = {
        tle: [
            ["Elementos de entrada", "Medios TLE (no osculantes)"],
            ["Época media TLE", value(["tle_epoch", "tleEpoch", "epoch", "epochUtc", "epoch_utc"])],
            ["B* drag", value(["bstar", "b_star", "bStar"]) ]
        ],
        sp3: [
            ["Centro", value(["center", "analysis_center", "analysisCenter", "agency", "provider", "provider_label", "providerLabel", "provider_id", "providerId"])],
            ["Producto", value(["product", "product_class", "productClass", "product_type", "productType", "productId", "product_id"])],
            ["Cobertura publicada", value(["coverageStart", "coverage_start", "start_time", "startTime"])],
            ["CLK RINEX asociado", value(["clock.rinex_clk.present", "clock.rinex_clk.file_present", "sp3.clock.rinex_clk.present", "sp3.clock.rinex_clk.file_present"])],
            ["Clock publicado", directRowValue("clock") ?? value(["clock_ns", "clockNs", "clock_offset_ns", "clockOffsetNs"])],
            ["Sigma de reloj", directRowValue("clockSigma") ?? value(["clock_sigma_ns", "clockSigmaNs", "clock_sigma_seconds", "clockSigmaSeconds"])],
            ["Sigma orbital SP3", directRowValue("sp3HeaderOrbitSigma") ?? value(["sp3_header_orbit_sigma_mm", "sp3HeaderOrbitSigmaMm"])],
            ["Sigma de posición", directRowValue("sigma") ?? value(["sigma", "position_sigma", "positionSigma", "quality.sigma"])],
            ["RMS del producto", directRowValue("rms") ?? value(["rms", "position_rms", "positionRms", "quality.rms"])],
            ["Calidad", inspector?.quality ?? directRowValue("quality")]
        ],
        oem: [
            ["Frame nativo", nativeFrame],
            ["Proveedor", value(["source.oem.originator", "model.oem.originator", "provider", "originator", "agency", "producer"])],
            ["Segmento", value(["source.oem.segment_index", "model.oem.segment_index", "source.segment_index", "segment_index"])],
            ["Covarianza", directRowValue("covariance") ?? value(["model.oem.covariance", "source.oem.covariance", "covariance", "has_covariance", "hasCovariance"])],
            ["Flags de maniobra", directRowValue("maneuver") ?? value(["maneuver_flags", "maneuverFlags", "maneuvers", "has_maneuvers", "hasManeuvers"]) ]
        ],
        omm: [
            ["Elementos de entrada", "Medios OMM (no osculantes)"],
            ["a medio (km)", value(["semi_major_axis_km", "semiMajorAxisKm", "mean_semi_major_axis_km", "meanSemiMajorAxisKm"])],
            ["e medio", value(["mean_eccentricity", "meanEccentricity", "eccentricity"])],
            ["i medio (deg)", value(["mean_inclination_deg", "meanInclinationDeg", "inclination_deg", "inclinationDeg"])],
            ["RAAN medio (deg)", value(["mean_raan_deg", "meanRaanDeg", "raan_deg", "raanDeg"])],
            ["Arg. periapsis medio (deg)", value(["mean_argument_of_periapsis_deg", "meanArgumentOfPeriapsisDeg", "argument_of_periapsis_deg", "argumentOfPeriapsisDeg"])],
            ["M medio (deg)", value(["mean_anomaly_deg_input", "meanAnomalyDegInput", "mean_anomaly_deg", "meanAnomalyDeg", "mean_anomaly", "meanAnomaly"])],
            ["Movimiento medio (rev/d)", value(["mean_motion_rev_day", "meanMotionRevDay", "mean_motion", "meanMotion"])],
            ["B* drag", value(["bstar", "b_star", "bStar"])],
            ["SRP", value(["srp", "solar_radiation_pressure", "solarRadiationPressure"])],
            ["Coeficiente de drag", value(["drag_coefficient", "dragCoefficient", "cd_area_over_mass", "cdAreaOverMass"]) ]
        ],
        "state-vector": [
            ["Estado de entrada", "Vectores cartesianos r/v"],
            ["Frame nativo", nativeFrame]
        ],
        numeric: [
            ["Integrador", value(["integrator", "integrator_name", "integratorName", "method", "method_name", "methodName"])],
            ["Eventos", value(["events", "event_flags", "eventFlags"]) ]
        ],
        manual: [
            ["Modelo", value(["propagator", "method", "method_name", "methodName"])],
            ["Frame", referenceFrame]
        ],
        unknown: []
    };
    return [...common, ...(specific[profile?.kind] || [])];
}

function SourceMethodSection({ panel, result, profile, inspector, referenceFrame }) {
    const sources = metadataSources(panel, result, inspector, profile);
    const fields = methodFieldsForProfile(profile, sources, referenceFrame, inspector);
    const availability = inspector?.availability;
    return <section className="shrink-0 rounded-[8px] border border-[#25405f] bg-[rgba(8,21,38,.74)] p-3" aria-label="Método y fuente" data-testid="propagated-parameters-method">
        <div className="flex items-start justify-between gap-2">
            <div>
                <h3 className="m-0 text-[11px] font-semibold text-[#e7effd]">Método y fuente</h3>
                <p className="mt-1 mb-0 text-[10px] leading-[1.4] text-[#8fa2be]">{sourceMethodNarrative(profile)}</p>
            </div>
            <span className="shrink-0 rounded-[4px] border border-[#365d91] bg-[rgba(34,65,111,.38)] px-1.5 py-0.5 text-[8px] font-bold tracking-[.055em] text-[#bad7ff]">{profile?.label || "Fuente"}</span>
        </div>
        {availability?.available === false && <p className="mt-2 mb-0 rounded-[5px] border border-[rgba(183,137,57,.52)] bg-[rgba(89,62,17,.2)] px-2 py-1.5 text-[9px] leading-[1.4] text-[#f2d192]" role="status"><strong>Datos no disponibles.</strong> {availability.reason || "El runtime no declaró esta información para la fuente actual."}</p>}
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
            {fields.map(([label, value]) => <div className="min-w-0" key={label}>
                <dt className="text-[8px] font-bold tracking-[.055em] text-[#7188a8]">{label}</dt>
                <dd className={"mt-0.5 truncate text-[10px] font-medium " + (isPresentValue(value) ? "text-[#d7e5f7]" : "text-[#8395ad]")} title={methodValue(value)}>{methodValue(value)}</dd>
            </div>)}
        </dl>
    </section>;
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
    profile,
    inspector,
    referenceFrame,
    displayFrame,
    rendererReference,
    statusLabel,
    statusClass,
    statusText,
    onRefresh,
    onSamplingChange,
    onOutputFrameChange
}) {
    const manualDesign = String(panel?.range?.mode || "").toLowerCase().includes("manual-design");
    const busy = ["busy", "loading", "pending", "propagating"].includes(String(panel?.status).toLowerCase());
    const simulationRange = finiteTimeRange(panel?.simulationRange ?? panel?.simulation_range);
    // A manual-design session owns its epochs outside the global simulation
    // timeline. Its received design window is the one supported read-only
    // exception when there is no active finite simulation range.
    const designRange = manualDesign ? finiteTimeRange(panel?.range) : null;
    const analysisRange = simulationRange ?? designRange;
    const duration = analysisRange ? formatDuration(analysisRange.start, analysisRange.end) : "";
    const samplingPlan = panel?.sampling && typeof panel.sampling === "object" ? panel.sampling : null;
    const sampling = samplingPlan?.effectiveIntervalSeconds ?? metadataValue([panel?.range, inspector?.range, inspector, result], [
        "sample_interval_seconds", "sampleIntervalSeconds", "sampling_interval_seconds", "samplingIntervalSeconds",
        "step_seconds", "stepSeconds", "cadence_seconds", "cadenceSeconds", "cadence"
    ]);
    const selectedSamplingValue = Number.isFinite(Number(panel?.samplingIntervalSeconds))
        ? String(panel.samplingIntervalSeconds)
        : "auto";
    const frame = inspector?.frame && typeof inspector.frame === "object" ? inspector.frame : {};
    const nativeFrame = frame.native || null;
    const outputFrame = frame.current || referenceFrame || nativeFrame;
    const calculationFrame = frame.calculation || frame.dynamics || nativeFrame || outputFrame;
    const selectableOutputFrames = [...new Set(
        (Array.isArray(frame.availableFrames) ? frame.availableFrames : [])
            .map((value) => String(value || "").trim())
            .filter(Boolean)
    )].filter((value) => value !== nativeFrame);
    const requestedOutputFrame = String(panel?.requestedOutputFrame ?? frame.requested ?? "").trim() || null;
    const selectedOutputFrame = requestedOutputFrame || "native";
    const canSelectOutputFrame = frame.selectable === true;
    const frameSelectionProblem = panel?.error && requestedOutputFrame
        ? errorMessage(panel.error)
        : null;
    const framesDiffer = Boolean(
        displayFrame
        && referenceFrame
        && formatReferenceFrame(displayFrame) !== formatReferenceFrame(referenceFrame)
        && inspector?.availability?.osculatingElements?.available !== false
    );
    const metadataCards = framesDiffer
        ? [["MODEL", propagator], ["SCENE FRAME", displayFrame], ["TABLE FRAME", outputFrame], ["SOURCE", source]]
        : [["MODEL", propagator], ["TABLE FRAME", outputFrame || displayFrame], ["SOURCE", source]];
    const rendererUnavailable = rendererReference?.available === false
        || String(rendererReference?.status || "").toLowerCase() === "unavailable";
    const rendererApproximate = rendererReference?.approximate === true
        || String(rendererReference?.status || "").toLowerCase() === "approximate_earth_fixed";
    const rendererNativeFrame = rendererReference?.nativeFrame
        || rendererReference?.native_reference_frame
        || rendererReference?.nativeReferenceFrame
        || "el marco nativo";

    // The information view is intentionally the sole vertical scroll owner.
    // Keep it on Orbit's themed scrollbar as well: without the class Chromium
    // falls back to a bright native track along the edge of the inspector.
    return <div data-testid="propagated-parameters-information-scroll-region" className="orbit-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5" tabIndex={0}>
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

        <section className="shrink-0 rounded-[8px] border border-[#25405f] bg-[rgba(8,21,38,.74)] p-3" aria-label="Rango de simulación" data-testid="propagated-parameters-simulation-range">
            <div>
                <h3 className="m-0 text-[11px] font-semibold text-[#e7effd]">Rango de simulación</h3>
                <p className="mt-1 mb-0 text-[10px] leading-[1.4] text-[#8fa2be]">{designRange && !simulationRange
                    ? "La ventana del diseño manual determina estas efemérides. Refresh recalcula la serie."
                    : "Las efemérides usan el rango activo de simulación. Refresh recalcula la serie."}</p>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="grid min-w-0 gap-1 text-[8px] font-bold tracking-[.045em] text-[#7f94b2]">PASO DE MUESTREO
                    <select className="h-7 w-full cursor-pointer rounded-[5px] border border-[#294361] bg-[#0b1728] px-2 text-[10px] font-medium text-[#eaf2ff]" value={selectedSamplingValue} onChange={(event) => onSamplingChange?.(event.target.value === "auto" ? null : Number(event.target.value))} aria-label="Paso de muestreo de efemérides">
                        {SAMPLING_INTERVAL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                </label>
                <label className="grid min-w-0 gap-1 text-[8px] font-bold tracking-[.045em] text-[#7f94b2]">MARCO DE SALIDA
                    <select className="h-7 w-full cursor-pointer rounded-[5px] border border-[#294361] bg-[#0b1728] px-2 text-[10px] font-medium text-[#eaf2ff] disabled:cursor-not-allowed disabled:opacity-45" value={selectedOutputFrame} disabled={busy || !canSelectOutputFrame} onChange={(event) => onOutputFrameChange?.(event.target.value === "native" ? null : event.target.value)} aria-label="Marco de salida de efemérides" aria-describedby="propagated-parameters-output-frame-help">
                        <option value="native">Nativo{nativeFrame ? ` (${formatReferenceFrame(nativeFrame)})` : ""}</option>
                        {selectableOutputFrames.map((value) => <option key={value} value={value}>{formatReferenceFrame(value)}</option>)}
                    </select>
                </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] leading-[1.4]" id="propagated-parameters-output-frame-help">
                <span className="rounded bg-[#172943] px-2 py-1.5 font-semibold text-[#aac1e0]" title="La vista y la exportación usan UTC; la escala nativa de la muestra aparece en la tabla.">UTC</span>
                {nativeFrame && <span className="rounded bg-[#172943] px-2 py-1.5 font-semibold text-[#aac1e0]">Nativo: {formatReferenceFrame(nativeFrame)}</span>}
                {outputFrame && <span className="rounded bg-[#172943] px-2 py-1.5 font-semibold text-[#aac1e0]">Tabla: {formatReferenceFrame(outputFrame)}</span>}
                {calculationFrame && <span className="rounded bg-[#172943] px-2 py-1.5 font-semibold text-[#aac1e0]">Elementos: {formatReferenceFrame(calculationFrame)}</span>}
            </div>
            {frameSelectionProblem
                ? <p className="mt-2 mb-0 rounded-md border border-[rgba(210,75,91,.52)] bg-[rgba(123,35,49,.2)] px-2.5 py-2 text-[9px] leading-[1.45] text-[#ffc3cb]" role="alert"><strong>El marco solicitado no se aplicó.</strong> {frameSelectionProblem}</p>
                : frame.selectionRequiresRuntimeValidation === true
                    ? <p className="mt-2 mb-0 text-[9px] leading-[1.4] text-[#8fa2be]">Cada conversión se valida para todo el rango activo con la ruta de marcos y EOP/ERP disponible; la tabla solo muestra el marco realmente devuelto.</p>
                    : frame.reason
                        ? <p className="mt-2 mb-0 text-[9px] leading-[1.4] text-[#8fa2be]">{frame.reason}</p>
                        : null}
            {samplingPlan?.fullResolution === true && samplingPlan?.expensive === true && busy && <p className="mt-2 mb-0 rounded-md border border-[rgba(210,163,68,.58)] bg-[rgba(93,68,21,.24)] px-2.5 py-2 text-[9px] leading-[1.45] text-[#f3d7a2]" role="status" data-testid="propagated-parameters-detailed-sampling-notice"><strong>Cálculo detallado en curso.</strong> {samplingPlan.taskMessage || `Se están calculando ${samplingPlan.sampleCount || "todas las"} muestras solicitadas. Puede tardar unos momentos; la tarea está disponible arriba a la derecha.`}</p>}
            {analysisRange
                ? <>
                    <dl className="mt-3 grid grid-cols-2 gap-2">
                        <div className="min-w-0 rounded-md border border-[#294361] bg-[#0b1728] px-2 py-2">
                            <dt className="text-[9px] font-semibold text-[#b9c9df]">Inicio UTC</dt>
                            <dd className="mt-1 truncate text-[11px] font-medium text-[#eaf2ff]" title={analysisRange.start}>{formatTime(analysisRange.start)}</dd>
                        </div>
                        <div className="min-w-0 rounded-md border border-[#294361] bg-[#0b1728] px-2 py-2">
                            <dt className="text-[9px] font-semibold text-[#b9c9df]">Fin UTC</dt>
                            <dd className="mt-1 truncate text-[11px] font-medium text-[#eaf2ff]" title={analysisRange.end}>{formatTime(analysisRange.end)}</dd>
                        </div>
                    </dl>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {duration && <span className="inline-flex rounded bg-[#172943] px-2 py-1.5 text-[9px] font-semibold text-[#aac1e0]">Duración: {duration}</span>}
                        {isPresentValue(sampling) && <span className="inline-flex rounded bg-[#172943] px-2 py-1.5 text-[9px] font-semibold text-[#aac1e0]">Paso efectivo: {Number.isFinite(Number(sampling)) ? formatSamplingInterval(sampling) : methodValue(sampling)}</span>}
                        {samplingPlan?.limited === true && <span className="inline-flex rounded bg-[rgba(104,75,18,.34)] px-2 py-1.5 text-[9px] font-semibold text-[#f1d08e]" title="El límite de muestras protege el servicio de propagación.">Cadencia limitada a {samplingPlan.sampleCount} muestras</span>}
                    </div>
                </>
                : <div className="mt-3 rounded-md border border-[#294361] bg-[#0b1728] px-2.5 py-2 text-[10px] leading-[1.45] text-[#9db0ca]" role="status">
                    <strong className="font-semibold text-[#d8e5f7]">Sin rango de simulación finito.</strong> En los modos Real time o Static, el intervalo de efemérides se gestiona automáticamente.
                </div>}
        </section>

        <SourceMethodSection panel={panel} result={result} profile={profile} inspector={inspector} referenceFrame={referenceFrame} />

        <section className={"grid shrink-0 gap-2 " + (framesDiffer ? "grid-cols-4" : "grid-cols-3")} aria-label="Metadatos del modelo">
            {metadataCards.map(([label, value]) => <div className="min-w-0 rounded-[7px] border border-[#203854] bg-[rgba(6,17,31,.53)] px-2.5 py-2" key={label}>
                <span className="block text-[8px] font-bold tracking-[.06em] text-[#7288a7]">{label}</span>
                <strong className="mt-0.5 block truncate text-[10px] font-semibold text-[#d0ddec]" title={value ? (label.includes("FRAME") ? formatReferenceFrame(value) : titleCase(value)) : "--"}>{value ? (label.includes("FRAME") ? formatReferenceFrame(value) : titleCase(value)) : "--"}</strong>
            </div>)}
        </section>

        {framesDiffer && <p className="m-0 shrink-0 text-[9px] leading-[1.4] text-[#8297b5]">La escena usa {formatReferenceFrame(displayFrame)}; la tabla usa {formatReferenceFrame(outputFrame)} y los elementos se derivan en {formatReferenceFrame(calculationFrame)}.</p>}

        {rendererUnavailable && <div className="shrink-0 rounded-[7px] border border-[rgba(218,154,51,.62)] bg-[rgba(96,62,16,.2)] px-3 py-2 text-[10px] leading-[1.45] text-[#ffdca0]" role="status">
            <strong>Representación terrestre no disponible.</strong> El producto conserva su marco nativo {formatReferenceFrame(rendererNativeFrame)} y no se calculan elementos ni una visualización terrestre hasta configurar la transformación requerida{rendererReference.reason ? `: ${rendererReference.reason}` : "."}
        </div>}
        {rendererApproximate && !rendererUnavailable && <div className="shrink-0 rounded-[7px] border border-[rgba(84,142,201,.58)] bg-[rgba(25,69,111,.2)] px-3 py-2 text-[10px] leading-[1.45] text-[#c9e4ff]" role="status">
            <strong>{displayFrame || "Marco terrestre aproximado (sin ERP)"}.</strong> La escena puede mostrar el producto en coordenadas terrestres, pero la conversión o comparación en ECI queda bloqueada hasta disponer de un ERP aplicable y la ruta de realización terrestre necesaria.
        </div>}
        {rendererReference?.unverifiedTerrestrialTransform === true && !rendererUnavailable && !rendererApproximate && <div className="shrink-0 rounded-[7px] border border-[rgba(218,154,51,.62)] bg-[rgba(96,62,16,.2)] px-3 py-2 text-[10px] leading-[1.45] text-[#ffdca0]" role="status">
            <strong>Transformación terrestre sin procedencia.</strong> Se conserva el marco nativo {formatReferenceFrame(rendererNativeFrame)}; la referencia terrestre recibida no declara EOP/ERP ni una operación de realización verificable.
        </div>}

        {samples.length > 0
            && inspector?.availability?.available !== false
            && inspector?.availability?.osculatingElements?.available !== false
            && <DeltaStrip samples={samples} />}
        {panel?.error && <div className="shrink-0 rounded-[7px] border border-[rgba(210,75,91,.52)] bg-[rgba(123,35,49,.2)] px-3 py-2 text-[10px] leading-[1.45] text-[#ffc3cb]" role="alert">{errorMessage(panel.error)}</div>}
        {!hasTarget && <EmptyState hasTarget={false} status={panel?.status} error={errorMessage(panel?.error)} compact />}
        {result?.model?.atmospheric_drag_model && <p className="m-0 shrink-0 text-[9px] leading-[1.4] text-[#7e94b5]">Drag model: {String(result.model.atmospheric_drag_model)}</p>}
    </div>;
}

function ChartParameterPicker({ option, options, onChange }) {
    const [open, setOpen] = useState(false);
    const directOptions = options.filter((candidate) => candidate.provenance === "direct");
    const derivedOptions = options.filter((candidate) => candidate.provenance === "derived");
    const optionButton = (candidate) => <button className={"appearance-none cursor-pointer rounded-[5px] border border-transparent bg-[#0b182a] px-2.5 py-2 text-left text-[10px] font-semibold " + (candidate.id === option.id ? "!border-[#557eaf] !bg-[#234574] text-white shadow-[inset_0_1px_rgba(230,242,255,.12)]" : "text-[#b9c9df] hover:border-[#31516f] hover:bg-[#162d4c] hover:text-white")} type="button" key={candidate.id} role="menuitemradio" aria-checked={candidate.id === option.id} onClick={() => { onChange(candidate.id); setOpen(false); }}>
        <span className="flex min-w-0 items-center gap-1.5"><span className="min-w-0 flex-1 truncate">{candidate.displayLabel}</span><ProvenanceBadge provenance={candidate.provenance} /></span>
        {candidate.unitVaries && <span className="mt-0.5 block text-[8px] font-medium text-[#d9ba74]">Unidad variable según la fuente</span>}
    </button>;
    return <div className="relative shrink-0">
        <button className="inline-flex h-8 max-w-[252px] cursor-pointer items-center gap-1.5 rounded-[6px] border border-[#31537b] bg-[#10223b] px-2.5 text-[10px] font-bold text-[#c0d8ff] hover:border-[#5683bc] hover:bg-[#163155] hover:text-white" type="button" aria-haspopup="menu" aria-expanded={open} title="Elegir columna numérica para la gráfica" onClick={() => setOpen((current) => !current)}><ChartGlyph /><span className="min-w-0 flex-1 truncate">{option.displayLabel}</span><ProvenanceBadge provenance={option.provenance} /><span className="text-[#7e9ac1]">⌄</span></button>
        {open && <div className="orbit-scrollbar absolute top-[calc(100%+6px)] right-0 z-30 grid max-h-[300px] w-[276px] overflow-y-auto rounded-[8px] border border-[#355272] bg-[#0b182a] p-1 shadow-[0_14px_30px_rgba(0,0,0,.5)]" role="menu">
            {directOptions.length > 0 && <span className="px-2.5 pt-1.5 pb-1 text-[8px] font-bold tracking-[.06em] text-[#7796be]">DATOS DIRECTOS</span>}
            {directOptions.map(optionButton)}
            {derivedOptions.length > 0 && <span className="mt-1 border-t border-[#203854] px-2.5 pt-2 pb-1 text-[8px] font-bold tracking-[.06em] text-[#a78d60]">VALORES DERIVADOS</span>}
            {derivedOptions.map(optionButton)}
        </div>}
    </div>;
}

function interpolationContractForSample(sample) {
    const candidates = [
        sample?.sampling,
        sample?.interpolation,
        sample?.state?.sampling,
        sample?.state?.interpolation,
        sample?.state?.provenance?.tabular_interpolation,
        sample?.provenance?.tabular_interpolation,
        sample?.metadata?.interpolation
    ];
    return candidates.find((candidate) => candidate && typeof candidate === "object") || null;
}

function describeSourceInterpolation(sample) {
    const contract = interpolationContractForSample(sample);
    if (!contract) {
        return {
            key: "evaluated",
            short: "Origen · muestra evaluada",
            detail: "El estado se evaluó para esta época por el propagador. No se declara una interpolación adicional en el origen."
        };
    }

    const method = String(firstDefined(contract, ["method", "declared_method", "declaredMethod", "interpolation_method", "interpolationMethod"]) || "").trim().toUpperCase();
    const degreeValue = Number(firstDefined(contract, ["degree", "declared_degree", "declaredDegree", "interpolation_degree", "interpolationDegree"]));
    const degree = Number.isInteger(degreeValue) && degreeValue >= 0 ? degreeValue : null;
    const sourceFormat = String(firstDefined(contract, ["source_format", "sourceFormat", "format"]) || "").trim().toUpperCase();
    const sourceSuffix = sourceFormat ? ` de ${sourceFormat}` : "";
    const degreeSuffix = degree === null ? "" : ` · grado ${degree}`;

    if (["EXACT", "NONE", "NOT_PERFORMED", "NOT_INTERPOLATED"].includes(method)) {
        return {
            key: `exact:${sourceFormat || "source"}`,
            short: `Origen · nodo exacto${sourceSuffix}`,
            detail: `El estado de origen coincide con una época publicada${sourceSuffix}; no se interpoló en el origen.`
        };
    }

    const methodLabel = {
        LINEAR: "lineal",
        LAGRANGE: "Lagrange",
        HERMITE: "Hermite"
    }[method] || method || "declarada";
    return {
        key: `source:${method || "declared"}:${degree ?? ""}:${sourceFormat || "source"}`,
        short: `Origen · ${methodLabel}${degreeSuffix}${sourceSuffix}`,
        detail: `El estado de origen usa interpolación ${methodLabel}${degreeSuffix}${sourceSuffix}.`
    };
}

function describeSeriesInterpolation(samples) {
    const descriptions = samples.map(describeSourceInterpolation);
    const unique = [...new Map(descriptions.map((description) => [description.key, description])).values()];
    if (unique.length === 1) return unique[0];
    return {
        key: "mixed",
        short: "Origen · método por muestra",
        detail: "La serie contiene más de una procedencia de muestreo. Pasa el cursor por una muestra para consultar su método de origen."
    };
}

function chartTickStep(span, targetCount = 5) {
    const raw = Math.abs(Number(span)) / Math.max(1, targetCount - 1);
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const fraction = raw / magnitude;
    const multiplier = fraction <= 1 ? 1
        : fraction <= 2 ? 2
            : fraction <= 2.5 ? 2.5
                : fraction <= 5 ? 5
                    : 10;
    return multiplier * magnitude;
}

function chartTickPrecision(step) {
    const absolute = Math.abs(Number(step));
    if (!Number.isFinite(absolute) || absolute === 0) return 0;
    for (let digits = 0; digits <= 9; digits += 1) {
        const scaled = absolute * (10 ** digits);
        if (Math.abs(scaled - Math.round(scaled)) <= 1e-8 * Math.max(1, Math.abs(scaled))) return digits;
    }
    return 9;
}

function chartYAxis(minimum, maximum) {
    const span = Math.max(Number.EPSILON, Number(maximum) - Number(minimum));
    const step = chartTickStep(span);
    const epsilon = step * 1e-8;
    const first = Math.ceil((minimum - epsilon) / step) * step;
    const last = Math.floor((maximum + epsilon) / step) * step;
    const ticks = [];
    for (let value = first; value <= last + epsilon && ticks.length < 8; value += step) {
        ticks.push(Number(value.toFixed(chartTickPrecision(step))));
    }
    if (ticks.length >= 2) return { ticks, step };
    return {
        ticks: [minimum, maximum].map((value) => Number(value.toFixed(chartTickPrecision(span)))).filter((value, index, values) => index === 0 || value !== values[index - 1]),
        step: span
    };
}

function formatChartAxisValue(value, step) {
    const digits = chartTickPrecision(step);
    const rounded = Number(Number(value).toFixed(digits));
    const absolute = Math.abs(rounded);
    if (absolute && (absolute >= 1e8 || (absolute < 1e-4 && digits >= 4))) {
        return rounded.toExponential(Math.min(4, Math.max(1, digits - 1)));
    }
    return rounded.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: Math.min(9, digits)
    });
}

function tooltipNarrative(tooltip) {
    if (tooltip?.exact) {
        const source = describeSourceInterpolation(tooltip.sample);
        return {
            title: "MUESTRA DE LA SERIE",
            detail: `Valor calculado o recibido para esta época. ${source.detail}`
        };
    }
    return {
        title: "LECTURA DEL TRAZO",
        detail: "Lectura lineal entre dos muestras consecutivas solo para posicionar el cursor. No crea una muestra ni ejecuta una nueva propagación."
    };
}

function OrbitParameterChart({ samples, option, referenceFrame, seriesInterpolation }) {
    const svgRef = useRef(null);
    const dragRef = useRef(null);
    const [viewDomain, setViewDomain] = useState(null);
    const [tooltip, setTooltip] = useState(null);
    const [isPanning, setIsPanning] = useState(false);
    const points = useMemo(() => samples.map((sample, index) => {
        const time = parseDate(firstDefined(sample, ["time", "timestamp", "utc", "date"]))?.getTime();
        const raw = option.getValue?.(sample);
        const value = Number.isFinite(raw) ? raw * (option.multiplier || 1) : Number.NaN;
        return { index, time: Number.isFinite(time) ? time : index, value, sample };
    }).filter((point) => Number.isFinite(point.value)), [samples, option]);

    const baseDomain = useMemo(() => {
        if (points.length < 2) return null;
        const values = points.map((point) => point.value);
        const times = points.map((point) => point.time);
        let minValue = Math.min(...values);
        let maxValue = Math.max(...values);
        if (Math.abs(maxValue - minValue) < Math.max(1e-12, Math.abs(maxValue) * 1e-10)) {
            const pad = Math.max(Math.abs(maxValue) * 0.01, option.type === "eccentricity" ? 1e-5 : 1);
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

    const width = 920;
    const height = 260;
    const padding = { top: 22, right: 20, bottom: 38, left: 68 };
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
    const yAxis = chartYAxis(domain.minValue, domain.maxValue);
    const yTicks = yAxis.ticks;
    const xTicks = Array.from({ length: 4 }, (_, index) => domain.minTime + (timeSpan * index / 3));
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
        const consider = (x, y, time, value, exact, details = {}) => {
            const distanceSquared = ((x - pointer.x) ** 2) + ((y - pointer.y) ** 2);
            if (!nearest || distanceSquared < nearest.distanceSquared) nearest = { x, y, time, value, exact, distanceSquared, ...details };
        };
        points.forEach((point, index) => {
            const x = xFor(point.time);
            const y = yFor(point.value);
            consider(x, y, point.time, point.value, true, { sample: point.sample });
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
                false,
                { leftSample: previous.sample, rightSample: point.sample }
            );
        });
        return nearest && nearest.distanceSquared <= threshold ** 2 ? nearest : null;
    };
    const updateTooltip = (event) => {
        if (dragRef.current) return;
        const pointer = pointFromClient(event.clientX, event.clientY);
        const nearest = isInPlot(pointer) ? nearestCurvePoint(pointer) : null;
        if (!nearest) {
            setTooltip(null);
            return;
        }
        const svg = svgRef.current;
        const host = svg?.parentElement;
        const matrix = svg?.getScreenCTM?.();
        const hostBounds = host?.getBoundingClientRect?.();
        let placement = null;
        if (matrix && hostBounds?.width && hostBounds?.height && typeof svg.createSVGPoint === "function") {
            const point = svg.createSVGPoint();
            point.x = nearest.x;
            point.y = nearest.y;
            const screenPoint = point.matrixTransform(matrix);
            placement = {
                x: ((screenPoint.x - hostBounds.left) / hostBounds.width) * 100,
                y: ((screenPoint.y - hostBounds.top) / hostBounds.height) * 100
            };
        }
        setTooltip({ ...nearest, placement });
    };
    const resetView = () => {
        dragRef.current = null;
        setIsPanning(false);
        setTooltip(null);
        setViewDomain({ ...baseDomain });
    };
    const chartTitle = option.displayLabel || (option.label + (option.unit ? " (" + option.unit + ")" : ""));
    const calculationFrame = referenceFrame ? formatReferenceFrame(referenceFrame) : null;
    const provenanceLabel = option.provenance === "derived" ? "DERIVADO" : "DIRECTO";
    const seriesDescriptor = [provenanceLabel, calculationFrame].filter(Boolean).join(" Â· ");
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
    const activeTooltipNarrative = tooltip ? tooltipNarrative(tooltip) : null;

    return <section className="shrink-0 rounded-[9px] border border-[#203b59] bg-[linear-gradient(155deg,rgba(8,19,35,.96),rgba(5,13,25,.96))] p-3" aria-label={`Gráfica de ${chartTitle}`} data-testid="propagated-parameters-chart">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="min-w-0">
                <span className="flex min-w-0 items-center gap-1.5"><span className="truncate text-[10px] font-semibold text-[#e2edff]">{chartTitle}</span><ProvenanceBadge provenance={option.provenance} /></span>
                <span className="mt-0.5 block text-[8px] font-medium text-[#8099bb]" title={seriesInterpolation?.detail}>Muestreo: {seriesInterpolation?.short || "Origen · muestra evaluada"}</span>
                {option.unitVaries && <span className="mt-0.5 block text-[8px] font-medium text-[#d9ba74]">La fuente declaró una unidad variable para esta serie.</span>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <span className="hidden text-[8px] font-medium text-[#7189aa] lg:inline">Rueda: zoom · arrastra: desplaza</span>
                <button className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-[5px] border border-[#31506f] bg-[#0e2037] px-2 text-[9px] font-bold text-[#a9c7ed] hover:border-[#5684ba] hover:bg-[#173554] hover:text-white" type="button" onClick={exportPng} title="Exportar gráfica como PNG" aria-label="Exportar gráfica como PNG"><ExportGlyph />PNG</button>
                <button className="h-6 cursor-pointer rounded-[5px] border border-[#31506f] bg-[#0e2037] px-2 text-[9px] font-bold text-[#a9c7ed] hover:border-[#5684ba] hover:bg-[#173554] hover:text-white disabled:cursor-default disabled:opacity-45" type="button" disabled={!zoomed} onClick={resetView} title="Restablecer zoom y desplazamiento">Restablecer</button>
                <span className="text-[9px] font-medium text-[#7f95b6]">{points.length.toLocaleString("en-US")} muestras</span>
            </div>
        </div>
        <div className="relative mt-2" style={{ height: "clamp(220px, 34vh, 310px)" }}>
            <svg ref={svgRef} className={"block h-full w-full touch-none select-none " + (isPanning ? "cursor-grabbing" : "cursor-crosshair")} viewBox={"0 0 " + width + " " + height} role="img" aria-label={`${chartTitle}, parámetro ${provenanceLabel.toLowerCase()} a lo largo de la serie propagada. Rueda para acercar y arrastra para desplazar.`} onWheel={handleWheel} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onPointerLeave={() => { if (!dragRef.current) setTooltip(null); }}>
                <defs>
                    <linearGradient id="orbit-parameter-line" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#6fb6ff" /><stop offset="1" stopColor="#aa8bff" /></linearGradient>
                    <linearGradient id="orbit-parameter-area" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#75b5ff" stopOpacity=".16" /><stop offset="1" stopColor="#75b5ff" stopOpacity="0" /></linearGradient>
                    <clipPath id="orbit-parameter-clip"><rect x={padding.left} y={padding.top} width={innerWidth} height={innerHeight} rx="4" /></clipPath>
                </defs>
                <rect x={padding.left} y={padding.top} width={innerWidth} height={innerHeight} rx="4" fill="#09172a" stroke="#29425f" strokeWidth=".9" />
                {yTicks.map((value, index) => <g key={"y-" + index}><line x1={padding.left} x2={padding.left + innerWidth} y1={yFor(value)} y2={yFor(value)} stroke="#96abc5" strokeOpacity=".2" strokeWidth=".7" /><text x={padding.left - 10} y={yFor(value) + 3} fill="#9db2cc" fontSize="8.6" textAnchor="end">{formatChartAxisValue(value, yAxis.step)}</text></g>)}
                {xTicks.map((time, index) => <g key={"x-" + index}><line x1={xFor(time)} x2={xFor(time)} y1={padding.top} y2={padding.top + innerHeight} stroke="#8090a3" strokeOpacity=".13" strokeWidth=".7" /><text x={xFor(time)} y={height - 16} fill="#93a8c1" fontSize="8.4" textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}>{formatChartTime(time)}</text></g>)}
                <g clipPath="url(#orbit-parameter-clip)">
                    <path d={path + " L " + xFor(points[points.length - 1].time).toFixed(2) + " " + (padding.top + innerHeight) + " L " + xFor(points[0].time).toFixed(2) + " " + (padding.top + innerHeight) + " Z"} fill="url(#orbit-parameter-area)" />
                    <path d={path} fill="none" stroke="url(#orbit-parameter-line)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    {points.length <= 160 && points.map((point, index) => <circle cx={xFor(point.time)} cy={yFor(point.value)} r="1.55" fill="#e3f0ff" stroke="#71abec" strokeWidth=".75" key={"point-" + index}><title>{formatTime(point.time) + " · " + numeric(point.value, option.digits) + (option.unit ? " " + option.unit : "")}</title></circle>)}
                    {tooltip && <g pointerEvents="none"><line x1={tooltip.x} x2={tooltip.x} y1={padding.top} y2={padding.top + innerHeight} stroke="#b5d7ff" strokeOpacity=".5" strokeDasharray="3 3" /><line x1={padding.left} x2={padding.left + innerWidth} y1={tooltip.y} y2={tooltip.y} stroke="#b5d7ff" strokeOpacity=".28" strokeDasharray="3 3" /><circle cx={tooltip.x} cy={tooltip.y} r="4" fill="#0d2038" stroke="#dceeff" strokeWidth="1.6" /></g>}
                </g>
                {/* Keep the plot title inside the SVG. The HTML toolbar is not
                    part of the PNG export, while this title is. */}
                <text x={padding.left} y="15" fill="#d9eaff" fontSize="11.5" fontWeight="700">{chartTitle}</text>
                {seriesDescriptor && <text x={padding.left + innerWidth} y="15" fill="#89a6cb" fontSize="9.5" fontWeight="600" textAnchor="end">{seriesDescriptor}</text>}
                <text x={padding.left + innerWidth} y={height - 4} fill="#8197b5" fontSize="9.5" fontWeight="600" textAnchor="end">TIEMPO UTC</text>
            </svg>
            {tooltip && <div className="pointer-events-none absolute z-10 min-w-[180px] max-w-[248px] rounded-[6px] border border-[#4e749d] bg-[rgba(7,19,34,.96)] px-2.5 py-2 shadow-[0_8px_22px_rgba(0,0,0,.42)]" style={{ left: clamp(tooltip.placement?.x ?? ((tooltip.x / width) * 100), 4, 73) + "%", top: clamp(tooltip.placement?.y ?? ((tooltip.y / height) * 100), 7, 82) + "%", transform: "translate(10px, -105%)" }}>
                <span className="block text-[8px] font-bold tracking-[.045em] text-[#88a9cf]">{activeTooltipNarrative?.title || "MUESTRA DE LA SERIE"}</span>
                <strong className="mt-0.5 block whitespace-nowrap text-[10px] font-semibold text-[#ebf4ff]">{numeric(tooltip.value, option.digits)}{option.unit ? " " + option.unit : ""}</strong>
                <span className="mt-0.5 block whitespace-nowrap text-[9px] text-[#a4b6ce]">{formatTime(tooltip.time)}</span>
                <span className="mt-1 block text-[8px] leading-[1.4] text-[#91a6c2]">{activeTooltipNarrative?.detail}</span>
            </div>}
        </div>
    </section>;
}

function GraphTab({ samples, profile, chartColumnId, onChartColumnChange, hasTarget, status, error, referenceFrame, inspector: sourceInspector }) {
    const sampleReferenceFrame = firstDefined(samples[0], ["reference_frame", "referenceFrame", "frame"])
        ?? firstDefined(samples[0]?.state, ["reference_frame", "referenceFrame", "frame"]);
    const calculationFrame = referenceFrame ?? sampleReferenceFrame;
    const calculationFrameLabel = calculationFrame ? formatReferenceFrame(calculationFrame) : null;
    const seriesInterpolation = useMemo(() => describeSeriesInterpolation(samples), [samples]);
    const chartOptions = useMemo(
        () => chartOptionsForProfile(profile, samples, calculationFrame, sourceInspector),
        [profile, samples, calculationFrame, sourceInspector]
    );
    const option = chartOptions.find((candidate) => candidate.id === chartColumnId)
        ?? chartOptions.find((candidate) => candidate.id === DEFAULT_CHART_COLUMN_ID)
        ?? chartOptions[0]
        ?? null;
    const osculatingUnavailable = sourceInspector?.availability?.osculatingElements?.available === false;
    const osculatingReason = sourceInspector?.availability?.osculatingElements?.reason;

    if (sourceInspector?.availability?.available === false) {
        return <div className="flex min-h-0 flex-1 flex-col justify-center rounded-[8px] border border-[rgba(183,137,57,.52)] bg-[rgba(89,62,17,.2)] px-6 text-center" role="status">
            <h3 className="m-0 text-[12px] font-semibold text-[#ffe0a5]">Gráfica no disponible para esta fuente</h3>
            <p className="mt-2 mb-0 text-[10px] leading-[1.55] text-[#e9c989]"><strong>No disponible en esta fuente.</strong> {sourceInspector.availability.reason || "El runtime no declaró una serie numérica trazable para esta gráfica."}</p>
        </div>;
    }

    if (!option) {
        return samples.length
            ? <div className="flex min-h-0 flex-1 flex-col justify-center rounded-[8px] border border-[rgba(183,137,57,.52)] bg-[rgba(89,62,17,.2)] px-6 text-center" role="status">
                <h3 className="m-0 text-[12px] font-semibold text-[#ffe0a5]">No hay columnas numéricas trazables</h3>
                <p className="mt-2 mb-0 max-w-[430px] self-center text-[10px] leading-[1.55] text-[#e9c989]">La fuente no publicó una columna numérica con al menos dos muestras finitas. Tiempo, marcos, texto, calidad y banderas permanecen disponibles en Valores, pero no se representan como una serie.</p>
            </div>
            : <EmptyState hasTarget={hasTarget} status={status} error={error} />;
    }

    return <div className="orbit-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
        <div className="flex shrink-0 items-center justify-between gap-3">
            <div className="min-w-0">
                <h3 className="m-0 text-[11px] font-semibold text-[#e4eefc]">Serie temporal</h3>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                    <p className="m-0 text-[10px] text-[#879bb8]">Elige cualquier columna numérica publicada por la órbita.</p>
                    {calculationFrameLabel && <span className="shrink-0 rounded-[4px] border border-[#315376] bg-[#0d2139] px-1.5 py-0.5 text-[8px] font-bold tracking-[.045em] text-[#a9cbef]" title="Marco de referencia real de la serie seleccionada">MARCO DE LA SERIE · {calculationFrameLabel}</span>}
                </div>
            </div>
            <ChartParameterPicker option={option} options={chartOptions} onChange={onChartColumnChange} />
        </div>
        {osculatingUnavailable && <p className="m-0 shrink-0 rounded-[6px] border border-[rgba(183,137,57,.52)] bg-[rgba(89,62,17,.2)] px-2.5 py-2 text-[9px] leading-[1.4] text-[#f2d192]" role="status"><strong>Elementos osculantes no disponibles.</strong> La gráfica conserva las columnas directas y los valores derivados que sí publicó esta fuente{osculatingReason ? ": " + osculatingReason : "."}</p>}
        <OrbitParameterChart samples={samples} option={option} referenceFrame={calculationFrame} seriesInterpolation={seriesInterpolation} />
    </div>;
}


function ValuesTab({ samples, hasTarget, status, error, referenceFrame, profile, inspector, onExport, exportFeedback }) {
    const [timeFilter, setTimeFilter] = useState({ start: "", end: "" });
    const [sort, setSort] = useState({ id: "epoch", direction: "asc" });
    const [visibleColumnIds, setVisibleColumnIds] = useState(null);
    const [exportOpen, setExportOpen] = useState(false);
    const sampleReferenceFrame = firstDefined(samples[0], ["reference_frame", "referenceFrame", "frame"])
        ?? firstDefined(samples[0]?.state, ["reference_frame", "referenceFrame", "frame"]);
    const calculationFrame = referenceFrame ?? sampleReferenceFrame;
    const frameLabel = calculationFrame ? formatReferenceFrame(calculationFrame) : "";
    const columns = useMemo(
        () => valueColumnsForProfile(profile, samples, calculationFrame, inspector),
        [profile, samples, calculationFrame, inspector]
    );
    const columnIds = useMemo(() => columns.map((column) => column.id), [columns]);

    useEffect(() => {
        setVisibleColumnIds((current) => current === null ? null : current.filter((id) => columnIds.includes(id)));
        setSort((current) => columnIds.includes(current.id) ? current : { id: "epoch", direction: "asc" });
    }, [columnIds]);

    const activeColumnIds = visibleColumnIds === null ? columnIds : visibleColumnIds;
    const visibleColumns = columns.filter((column) => activeColumnIds.includes(column.id));
    const safeVisibleColumns = visibleColumns.length ? visibleColumns : columns.slice(0, 1);
    const filteredRows = useMemo(() => rowsForTimeFilter(samples, timeFilter), [samples, timeFilter]);
    const sortColumn = columns.find((column) => column.id === sort.id) ?? columns[0];
    const sortedRows = useMemo(() => sortValueRows(filteredRows, sortColumn, sort.direction), [filteredRows, sortColumn, sort.direction]);
    const cartesianAvailable = samples.some((sample) => ["x", "y", "z"].some((axis) => isPresentValue(positionComponent(sample, axis)))
        || ["x", "y", "z"].some((axis) => isPresentValue(velocityComponent(sample, axis))));

    const toggleColumn = (id) => {
        setVisibleColumnIds((current) => {
            const active = current === null ? [...columnIds] : current;
            if (active.includes(id)) {
                return active.length > 1 ? active.filter((candidate) => candidate !== id) : active;
            }
            return [...active, id];
        });
    };

    const requestExport = (format, scope) => {
        const rows = scope === "visible" ? sortedRows.map((row) => row.sample) : samples;
        onExport({
            format,
            scope,
            rows,
            columns: safeVisibleColumns.map(({ id, label, type, provenance }) => ({ id, label, type, provenance })),
            metadata: {
                sourceProfile: profile?.kind || "unknown",
                sourceLabel: profile?.label || "",
                referenceFrame: calculationFrame || null,
                timeFilter: { ...timeFilter },
                sort: { ...sort },
                rowCount: rows.length
            }
        });
        setExportOpen(false);
    };

    if (inspector?.availability?.available === false) {
        return <div className="flex min-h-0 flex-1 flex-col justify-center rounded-[8px] border border-[rgba(183,137,57,.52)] bg-[rgba(89,62,17,.2)] px-6 text-center" role="status" data-testid="propagated-parameters-values-unavailable">
            <h3 className="m-0 text-[12px] font-semibold text-[#ffe0a5]">Valores no disponibles para esta fuente</h3>
            <p className="mt-2 mb-0 text-[10px] leading-[1.55] text-[#e9c989]"><strong>No disponible en esta fuente.</strong> {inspector.availability.reason || "El runtime no declaró una inspección cartesiana para el producto seleccionado. No se muestran datos de otra fuente ni elementos inferidos."}</p>
        </div>;
    }

    if (!samples.length) {
        return <EmptyState hasTarget={hasTarget} status={status} error={error} />;
    }

    return <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="propagated-parameters-values-tab">
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="m-0 text-[11px] font-semibold text-[#e4eefc]">Valores cartesianos</h3>
                    {frameLabel && <span className="rounded-[4px] border border-[#365d91] bg-[rgba(34,65,111,.38)] px-1.5 py-0.5 text-[8px] font-bold tracking-[.055em] text-[#bad7ff]" title="Marco recibido para los estados cartesianos">MARCO · {frameLabel}</span>}
                </div>
                <p className="mt-1 mb-0 text-[10px] text-[#879bb8]">Estados r/v recibidos, con métricas y elementos etiquetados según su procedencia.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                <ValueColumnPicker columns={columns} visibleColumnIds={activeColumnIds} onToggle={toggleColumn} />
                <div className="relative">
                    <button className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[6px] border border-[#376e9c] bg-[#102a3f] px-2.5 text-[10px] font-bold text-[#b9dcff] hover:border-[#62a1d8] hover:bg-[#173b58] hover:text-white disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={!samples.length} aria-haspopup="menu" aria-expanded={exportOpen} aria-controls="propagated-parameters-export-menu" onClick={() => setExportOpen((current) => !current)} title="Exportar valores y metadatos"><ExportGlyph />Exportar<span className="text-[#8ab2df]">⌄</span></button>
                    {exportOpen && <div id="propagated-parameters-export-menu" data-testid="propagated-parameters-export-menu" className="absolute top-[calc(100%+6px)] right-0 z-30 grid w-[244px] overflow-hidden rounded-[8px] border border-[#355272] bg-[#0b182a] p-1 shadow-[0_14px_30px_rgba(0,0,0,.5)]" role="menu" aria-label="Opciones de exportación">
                        <button className="cursor-pointer rounded-[5px] px-2.5 py-2 text-left text-[10px] font-semibold text-[#c6d6eb] hover:bg-[#162d4c] hover:text-white disabled:cursor-not-allowed disabled:opacity-40" type="button" role="menuitem" disabled={!sortedRows.length} onClick={() => requestExport("csv", "visible")}>CSV · filas filtradas ({sortedRows.length})</button>
                        <button className="cursor-pointer rounded-[5px] px-2.5 py-2 text-left text-[10px] font-semibold text-[#c6d6eb] hover:bg-[#162d4c] hover:text-white disabled:cursor-not-allowed disabled:opacity-40" type="button" role="menuitem" disabled={!samples.length} onClick={() => requestExport("csv", "all")}>CSV · todas las filas ({samples.length})</button>
                        <button className="cursor-pointer rounded-[5px] px-2.5 py-2 text-left text-[10px] font-semibold text-[#c6d6eb] hover:bg-[#162d4c] hover:text-white disabled:cursor-not-allowed disabled:opacity-40" type="button" role="menuitem" disabled={!sortedRows.length} onClick={() => requestExport("json", "visible")}>JSON · metadatos + filtradas</button>
                        <button className="cursor-pointer rounded-[5px] px-2.5 py-2 text-left text-[10px] font-semibold text-[#c6d6eb] hover:bg-[#162d4c] hover:text-white disabled:cursor-not-allowed disabled:opacity-40" type="button" role="menuitem" disabled={!samples.length} onClick={() => requestExport("json", "all")}>JSON · metadatos + todas</button>
                    </div>}
                </div>
            </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-end gap-2 rounded-[7px] border border-[#203854] bg-[rgba(6,17,31,.53)] p-2" aria-label="Filtros de la tabla" data-testid="propagated-parameters-value-filters">
            <label className="grid gap-1 text-[8px] font-bold tracking-[.045em] text-[#7f94b2]">DESDE UTC
                <input className="h-7 rounded-[5px] border border-[#294361] bg-[#0b1728] px-2 text-[10px] font-medium text-[#eaf2ff] [color-scheme:dark]" type="datetime-local" value={timeFilter.start} onChange={(event) => setTimeFilter((current) => ({ ...current, start: event.target.value }))} />
            </label>
            <label className="grid gap-1 text-[8px] font-bold tracking-[.045em] text-[#7f94b2]">HASTA UTC
                <input className="h-7 rounded-[5px] border border-[#294361] bg-[#0b1728] px-2 text-[10px] font-medium text-[#eaf2ff] [color-scheme:dark]" type="datetime-local" value={timeFilter.end} onChange={(event) => setTimeFilter((current) => ({ ...current, end: event.target.value }))} />
            </label>
            {(timeFilter.start || timeFilter.end) && <button className="h-7 cursor-pointer rounded-[5px] border border-[#345878] bg-[#11253f] px-2 text-[9px] font-bold text-[#bed8fa] hover:bg-[#173354]" type="button" onClick={() => setTimeFilter({ start: "", end: "" })}>Limpiar filtro</button>}
            <span className="ml-auto text-[9px] text-[#91a6c2]">{sortedRows.length} de {samples.length} filas</span>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[8px] text-[#8197b5]" aria-label="Leyenda de procedencia">
            <span className="rounded bg-[rgba(43,97,155,.28)] px-1.5 py-0.5 font-bold tracking-[.04em] text-[#a9d4ff]">DIRECTO</span><span>recibido de la fuente</span>
            <span className="ml-1 rounded bg-[rgba(128,100,47,.25)] px-1.5 py-0.5 font-bold tracking-[.04em] text-[#f2ce8d]">DERIVADO</span><span>calculado o declarado por el runtime</span>
        </div>
        {!cartesianAvailable && <p className="m-0 shrink-0 rounded-[6px] border border-[rgba(183,137,57,.52)] bg-[rgba(89,62,17,.2)] px-2.5 py-2 text-[9px] leading-[1.4] text-[#f2d192]" role="status"><strong>Vectores cartesianos no disponibles en esta fuente.</strong> Las celdas permanecen como <em>--</em>; no se inventan estados ni elementos.</p>}
        {exportFeedback?.message && <p className={"m-0 shrink-0 rounded-[6px] border px-2.5 py-2 text-[9px] leading-[1.4] " + (exportFeedback.ok === false ? "border-[rgba(210,75,91,.52)] bg-[rgba(123,35,49,.2)] text-[#ffc3cb]" : "border-[rgba(67,129,91,.56)] bg-[rgba(24,79,51,.24)] text-[#b9f0cf]")} role="status">{exportFeedback.message}</p>}
        {sortedRows.length ? <VirtualizedValueTable rows={sortedRows} columns={safeVisibleColumns} sort={sort} onSort={setSort} referenceFrame={calculationFrame} /> : <div className="flex min-h-[180px] flex-1 items-center justify-center rounded-[8px] border border-[#1e3451] bg-[rgba(4,12,23,.56)] px-5 text-center text-[10px] leading-[1.5] text-[#94a8c3]">No hay filas dentro del filtro temporal actual.</div>}
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
    const [windowRect, setWindowRect] = useState(() => centeredWindowRect(DEFAULT_WINDOW_RECT));
    const [activeTab, setActiveTab] = useState("info");
    const [chartColumnId, setChartColumnId] = useState(DEFAULT_CHART_COLUMN_ID);
    const [exportFeedback, setExportFeedback] = useState(null);
    const panelRef = useRef(null);
    const interactionCleanupRef = useRef(null);
    const panelWasOpenRef = useRef(false);

    useEffect(() => {
        const applyState = (event) => {
            const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
            setPanel((current) => ({
                ...current,
                ...detail,
                error: hasOwn(detail, "error") ? detail.error || "" : current.error,
                result: hasOwn(detail, "result") ? detail.result : current.result,
                simulationRange: hasOwn(detail, "simulationRange")
                    ? detail.simulationRange
                    : hasOwn(detail, "simulation_range")
                        ? detail.simulation_range
                        : current.simulationRange,
                inspector: hasOwn(detail, "inspector") ? detail.inspector : (hasOwn(detail, "result") && !detail.result ? null : current.inspector),
                exportMetadata: hasOwn(detail, "exportMetadata") ? detail.exportMetadata : (hasOwn(detail, "result") && !detail.result ? null : current.exportMetadata)
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
                simulationRange: hasOwn(envelope, "simulationRange")
                    ? envelope.simulationRange
                    : hasOwn(envelope, "simulation_range")
                        ? envelope.simulation_range
                        : current.simulationRange,
                inspector: hasOwn(envelope, "inspector") ? envelope.inspector : current.inspector,
                exportMetadata: hasOwn(envelope, "exportMetadata") ? envelope.exportMetadata : current.exportMetadata,
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
            if (replacesRequest) {
                setActiveTab("info");
                setExportFeedback(null);
            }
            setPanel((current) => ({
                ...current,
                ...detail,
                open: detail.open ?? true,
                target: targetFromContext(detail, current.target),
                range: contextRange ?? current.range,
                simulationRange: hasOwn(detail, "simulationRange")
                    ? detail.simulationRange
                    : hasOwn(detail, "simulation_range")
                        ? detail.simulation_range
                        : (replacesRequest ? null : current.simulationRange),
                status: detail.status ?? (detail.error ? "error" : (replacesRequest ? "idle" : current.status)),
                error: hasOwn(detail, "error") ? detail.error || "" : (replacesRequest ? "" : current.error),
                result: hasOwn(detail, "result") ? detail.result : (detail.target || detail.satellite || detail.id || contextRange ? null : current.result),
                inspector: hasOwn(detail, "inspector") ? detail.inspector : (replacesRequest ? null : current.inspector),
                exportMetadata: hasOwn(detail, "exportMetadata") ? detail.exportMetadata : (replacesRequest ? null : current.exportMetadata)
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
        const close = () => {
            setPanel((current) => ({ ...current, open: false, simulationRange: null }));
            setExportFeedback(null);
        };
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
        const receiveExportResult = (event) => {
            const detail = event.detail && typeof event.detail === "object" ? event.detail : {};
            if (!hasOwn(detail, "ok") && !detail.reason && !detail.message) return;
            const count = Number(detail.count);
            const message = detail.message
                || detail.reason
                || (detail.ok === false
                    ? "No se pudo preparar la exportación."
                    : `${String(detail.format || "Exportación").toUpperCase()} preparada${Number.isFinite(count) ? ` (${count} filas).` : "."}`);
            setExportFeedback({ ok: detail.ok !== false, message });
        };
        window.addEventListener("orbit:propagated-parameters-export-result", receiveExportResult);
        return () => window.removeEventListener("orbit:propagated-parameters-export-result", receiveExportResult);
    }, []);

    useEffect(() => {
        const constrain = () => setWindowRect((current) => clampWindowRect(current));
        constrain();
        window.addEventListener("resize", constrain);
        return () => window.removeEventListener("resize", constrain);
    }, []);

    useEffect(() => {
        if (panel.open && !panelWasOpenRef.current) {
            setWindowRect((current) => centeredWindowRect(current));
        }
        panelWasOpenRef.current = panel.open;
    }, [panel.open]);

    useEffect(() => {
        if (!panel.open) return undefined;
        const previousFocus = typeof document !== "undefined" ? document.activeElement : null;
        panelRef.current?.focus?.({ preventScroll: true });
        const closeOnEscape = (event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setPanel((current) => ({ ...current, open: false, simulationRange: null }));
            setExportFeedback(null);
            emit("orbit:propagated-parameters-close", { source: "propagated-parameters-panel" });
        };
        window.addEventListener("keydown", closeOnEscape);
        return () => {
            window.removeEventListener("keydown", closeOnEscape);
            previousFocus?.focus?.({ preventScroll: true });
        };
    }, [panel.open]);

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
    const inspector = inspectorFrom(panel, result);
    const profile = sourceProfileFrom(panel, result, source, propagator, inspector);
    const valueSamples = Array.isArray(inspector?.rows) ? inspector.rows : samples;
    const referenceFrame = inspector?.frame?.current
        ?? firstDefined(result, ["reference_frame", "referenceFrame", "frame"])
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
        ?? result?.source?.source_format
        ?? result?.source?.sourceFormat
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
    // The table and graph always follow the real output state returned by the
    // inspector. The Cesium display frame remains scene-only provenance: it
    // must never relabel Cartesian values or osculating elements.
    const visibleReferenceFrame = referenceFrame || displayFrame;
    const errorText = errorMessage(panel.error);
    const [statusLabel, statusClass, statusText] = statusDescriptor(panel.status, errorText, hasTarget, samples.length);
    const earthOrientationNotice = earthOrientationPanelNotice(panel);

    const requestRefresh = () => {
        if (!hasTarget) return;
        setPanel((current) => ({ ...current, status: "propagating", error: "" }));
        emit("orbit:propagated-parameters-refresh", {
            source: "propagated-parameters-panel",
            target: panel.target,
            range: panel.range
        });
    };

    const requestSamplingChange = (sampleIntervalSeconds) => {
        if (!hasTarget) return;
        emit("orbit:propagated-parameters-sampling-change", {
            source: "propagated-parameters-panel",
            sampleIntervalSeconds
        });
    };

    const requestOutputFrameChange = (requestedOutputFrame) => {
        if (!hasTarget) return;
        setPanel((current) => ({
            ...current,
            requestedOutputFrame: requestedOutputFrame || null,
            error: ""
        }));
        emit("orbit:propagated-parameters-frame-change", {
            source: "propagated-parameters-panel",
            requestedOutputFrame: requestedOutputFrame || null
        });
    };

    const close = () => {
        setPanel((current) => ({ ...current, open: false, simulationRange: null }));
        setExportFeedback(null);
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

    const requestExport = (payload) => {
        setExportFeedback({ ok: true, message: "Preparando exportación…" });
        const requestedColumns = Array.isArray(payload?.columns) ? payload.columns : [];
        const exportColumns = [...new Map(requestedColumns.map((column) => {
            const id = exportColumnId(column);
            return [id, { ...column, id }];
        })).values()];
        const declaredColumnIds = new Set((Array.isArray(inspector?.columns) ? inspector.columns : [])
            .map((column) => String(column?.id ?? column?.key ?? "").trim())
            .filter(Boolean));
        emit("orbit:propagated-parameters-export", {
            ...payload,
            columns: declaredColumnIds.size
                ? exportColumns.filter((column) => declaredColumnIds.has(column.id))
                : exportColumns,
            source: "propagated-parameters-panel",
            metadata: {
                target: targetLabel || targetId || null,
                targetId: targetId || null,
                source: source || null,
                propagator: propagator || null,
                analysisFrame: referenceFrame || null,
                nativeFrame: inspector?.frame?.native || null,
                outputFrame: inspector?.frame?.current || referenceFrame || null,
                calculationFrame: inspector?.frame?.calculation || inspector?.frame?.dynamics || null,
                analysisStartUtc: start || null,
                analysisEndUtc: end || null,
                ...(panel.exportMetadata && typeof panel.exportMetadata === "object" ? panel.exportMetadata : {}),
                ...(result?.exportMetadata && typeof result.exportMetadata === "object" ? result.exportMetadata : {}),
                ...(payload.metadata || {})
            }
        });
    };

    if (!panel.open) return null;
    const portalTarget = typeof document === "undefined" ? null : document.body;
    if (!portalTarget) return null;

    const panelStyle = {
        left: String(windowRect.x) + "px",
        top: String(windowRect.y) + "px",
        width: String(windowRect.width) + "px",
        height: String(windowRect.height) + "px",
        zIndex: INSPECTOR_MODAL_Z_INDEX
    };
    const tabs = [["info", "Información"], ["chart", "Gráfica"], ["values", "Valores"]];
    const panelTitle = targetLabel
        ? `Efemérides de ${targetLabel}`
        : "Efemérides";

    return createPortal(<aside ref={panelRef} className="propagated-orbit-parameters-panel pointer-events-auto fixed z-[2147483000] flex min-h-[300px] min-w-[280px] flex-col overflow-hidden rounded-[11px] border border-[rgba(65,99,147,.7)] bg-[linear-gradient(145deg,rgba(12,26,45,.985),rgba(5,14,26,.985))] font-[system-ui,sans-serif] text-[#dbe7fa] shadow-[0_22px_60px_rgba(0,0,0,.48),inset_0_1px_rgba(255,255,255,.055)]" style={panelStyle} role="dialog" aria-modal="false" aria-label="Efemérides" tabIndex={-1}>
        <header className="flex shrink-0 cursor-move select-none items-start gap-3 border-b border-[#213550] px-4 py-3.5" onPointerDown={beginDrag}>
            <div className="min-w-0 flex-1">
                <h2 className="truncate text-[16px] leading-tight font-semibold text-[#f0f5ff]" title={panelTitle}>{panelTitle}</h2>
                <p className="mt-1 text-[10px] leading-[1.35] text-[#8ea1bd]">Estados cartesianos y datos orbitales recibidos a lo largo del tiempo.</p>
            </div>
            <PanelCloseButton label="Cerrar efemérides" onPointerDown={(event) => event.stopPropagation()} onClick={close} />
        </header>

        <nav className="grid shrink-0 grid-cols-3 border-b border-[#203550] px-3" role="tablist" aria-label="Secciones del inspector">
            {tabs.map(([id, label]) => <button className={"relative cursor-pointer border-0 bg-transparent px-2 py-3 text-[10px] font-bold " + (activeTab === id ? "text-[#eaf1ff] after:absolute after:right-1 after:bottom-0 after:left-1 after:h-0.5 after:bg-[#5481ff] after:shadow-[0_0_8px_#5481ff] after:content-['']" : "text-[#8495ae] hover:text-[#cbd9ed]")} type="button" key={id} role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)}>{label}</button>)}
        </nav>

        {earthOrientationNotice && <p className={`mx-3.5 mt-3 mb-0 shrink-0 rounded-[7px] border px-2.5 py-2 text-[9px] leading-[1.35] ${earthOrientationNotice.warning ? "border-[#874252] bg-[rgba(82,28,42,.36)] text-[#ffd0d9]" : "border-[#776035] bg-[rgba(78,59,20,.3)] text-[#f5d38e]"}`} role={earthOrientationNotice.warning ? "alert" : "status"} data-testid="propagated-parameters-eop-coverage-notice"><strong>{earthOrientationNotice.actual ? "Proveniencia usada. " : "Preflight de la ventana. "}</strong>{earthOrientationNotice.message}{earthOrientationNotice.actual ? "" : " El servicio no ha devuelto aún la procedencia de ejecución."}</p>}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3.5">
            {activeTab === "info" && <InformationTab panel={panel} result={result} samples={samples} targetLabel={targetLabel} targetId={targetId} hasTarget={hasTarget} source={source} propagator={propagator} profile={profile} inspector={inspector} referenceFrame={referenceFrame} displayFrame={displayFrame} rendererReference={rendererReference} statusLabel={statusLabel} statusClass={statusClass} statusText={statusText} onRefresh={requestRefresh} onSamplingChange={requestSamplingChange} onOutputFrameChange={requestOutputFrameChange} />}
            {activeTab === "chart" && <GraphTab samples={valueSamples} profile={profile} chartColumnId={chartColumnId} onChartColumnChange={setChartColumnId} hasTarget={hasTarget} status={panel.status} error={errorText} referenceFrame={visibleReferenceFrame} inspector={inspector} />}
            {activeTab === "values" && <ValuesTab samples={valueSamples} hasTarget={hasTarget} status={panel.status} error={errorText} referenceFrame={visibleReferenceFrame} profile={profile} inspector={inspector} onExport={requestExport} exportFeedback={exportFeedback} />}
        </div>

        {RESIZE_HANDLES.map(([direction, className]) => <div key={direction} className={"absolute z-40 touch-none " + className} aria-hidden="true" onPointerDown={(event) => beginResize(direction, event)} />)}
    </aside>, portalTarget);
}
