import { useEffect, useRef, useState } from "react";

/**
 * UI/event boundary for manually authored orbits.
 *
 * Commands accepted by this component:
 * - `orbit:manual-orbit-open` / `orbit:manual-orbit-close` /
 *   `orbit:manual-orbit-cancel`
 * - `orbit:manual-orbit-toggle` (`detail.open` is optional)
 * - `orbit:manual-orbit-state` ({ open?, tab?, keplerian?, stateVector?,
 *   epochUtc?, epochStartUtc?, epochEndUtc?, groundTrackPreview?,
 *   previewReferenceFrame?, propagator? })
 *   to hydrate or synchronize the form. `epochUtc` remains the compatibility
 *   alias for the initial epoch. State
 *   vectors use `{ positionEciKm: { x, y, z }, velocityEciKmS: { x, y, z } }`.
 * - `orbit:manual-orbit-status` ({ kind: "error" | "busy" | "success",
 *   message }) for non-blocking runtime feedback.
 *
 * Events emitted by this component:
 * - `orbit:manual-orbit-panel-state` ({ open, mode: "design" })
 * - `orbit:manual-orbit-change` ({ source, field?, value?, ...payload })
 * - `orbit:manual-orbit-tab-change` ({ tab, ...payload })
 * - `orbit:manual-orbit-sync-request` ({ source, target, ...payload })
 * - `orbit:manual-orbit-create` (full payload)
 * - `orbit:manual-orbit-reset` (the restored payload)
 * - `orbit:manual-orbit-cancel` (full payload when the draft is cancelled)
 * - `orbit:manual-orbit-close` (full payload when this panel requests close)
 *
 * The runtime owns conversion and propagation. In particular, it must answer
 * a change/sync request with `orbit:manual-orbit-state` after converting the
 * other representation; this keeps the React form free of orbital math.
 */

const KEPLERIAN_FIELDS = [
    { key: "semiMajorAxisKm", label: "Semieje mayor", unit: "km", min: 6578, max: 50000, inputMin: 6378.138, inputMax: 500000, step: 1, digits: 0 },
    { key: "eccentricity", label: "Excentricidad", unit: "", min: 0, max: 0.95, inputMin: 0, inputMax: 0.999999, step: 0.0001, digits: 4 },
    { key: "inclinationDeg", label: "Inclinaci\u00f3n", unit: "deg", min: 0, max: 180, step: 0.1, digits: 1 },
    { key: "raanDeg", label: "RAAN", unit: "deg", min: 0, max: 360, step: 0.1, digits: 1 },
    { key: "argumentOfPeriapsisDeg", label: "Argumento de periapsis", unit: "deg", min: 0, max: 360, step: 0.1, digits: 1 },
    { key: "trueAnomalyDeg", label: "Anomal\u00eda verdadera", unit: "deg", min: 0, max: 360, step: 0.1, digits: 1 }
];

const STATE_VECTOR_FIELDS = [
    { key: "positionXKm", label: "Posici\u00f3n X", unit: "km", min: -50000, max: 50000, inputMin: -500000, inputMax: 500000, step: 1, digits: 0 },
    { key: "positionYKm", label: "Posici\u00f3n Y", unit: "km", min: -50000, max: 50000, inputMin: -500000, inputMax: 500000, step: 1, digits: 0 },
    { key: "positionZKm", label: "Posici\u00f3n Z", unit: "km", min: -50000, max: 50000, inputMin: -500000, inputMax: 500000, step: 1, digits: 0 },
    { key: "velocityXKmS", label: "Velocidad X", unit: "km/s", min: -20, max: 20, inputMin: -100, inputMax: 100, step: 0.001, digits: 3 },
    { key: "velocityYKmS", label: "Velocidad Y", unit: "km/s", min: -20, max: 20, inputMin: -100, inputMax: 100, step: 0.001, digits: 3 },
    { key: "velocityZKmS", label: "Velocidad Z", unit: "km/s", min: -20, max: 20, inputMin: -100, inputMax: 100, step: 0.001, digits: 3 }
];

function datetimeInputFor(date) {
    return date.toISOString().slice(0, 16);
}

function nowForDatetimeInput() {
    return datetimeInputFor(new Date());
}

function addHoursToDatetimeInput(value, hours) {
    const date = new Date(toUtcEpoch(value));
    if (Number.isNaN(date.getTime())) return value;
    date.setUTCHours(date.getUTCHours() + hours);
    return datetimeInputFor(date);
}

function toUtcEpoch(value) {
    if (typeof value !== "string" || !value) return "";
    const normalized = /(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}${value.length === 16 ? ":00" : ""}Z`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function toDatetimeInput(value, fallback) {
    const utcEpoch = toUtcEpoch(value);
    const date = new Date(utcEpoch);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString().slice(0, 16);
}

function normalizePreviewReferenceFrame(value, fallback = "eci") {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "ecef") return "ecef";
    if (normalized === "eci") return "eci";
    return fallback;
}

function createDefaultForm() {
    const epochStartUtc = nowForDatetimeInput();
    return {
        name: "Manual Orbit",
        // `epochUtc` remains in local form state only as an adapter for the
        // original runtime contract. The explicit design range is canonical.
        epochUtc: epochStartUtc,
        epochStartUtc,
        epochEndUtc: addHoursToDatetimeInput(epochStartUtc, 24),
        // This is an immediate design-preview aid and is kept when the
        // resulting manual satellite is confirmed.
        groundTrackPreview: false,
        // This affects only the transient design preview. The input state
        // vector and the confirmed orbit always retain their ECI contract.
        previewReferenceFrame: "eci",
        propagator: "sgp4",
        keplerian: {
            semiMajorAxisKm: 6878,
            eccentricity: 0.001,
            inclinationDeg: 51.6,
            raanDeg: 0,
            argumentOfPeriapsisDeg: 0,
            trueAnomalyDeg: 0
        },
        stateVector: {
            positionXKm: 6878,
            positionYKm: 0,
            positionZKm: 0,
            velocityXKmS: 0,
            velocityYKmS: 7.613,
            velocityZKmS: 0
        }
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function asNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function formatNumber(value, digits) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(Number(numeric.toFixed(digits))) : "";
}

function formatDistanceKm(value) {
    if (!Number.isFinite(value)) return "--";
    const digits = Math.abs(value) < 100 ? 1 : 0;
    return `${Number(value.toFixed(digits)).toLocaleString("en-US")} km`;
}

function getKeplerianDerived(keplerian = {}) {
    const semiMajorAxisKm = Number(keplerian.semiMajorAxisKm);
    const eccentricity = Number(keplerian.eccentricity);
    if (!Number.isFinite(semiMajorAxisKm) || !Number.isFinite(eccentricity) || semiMajorAxisKm <= 0 || eccentricity < 0 || eccentricity >= 1) {
        return { perigeeAltitudeKm: Number.NaN, apogeeAltitudeKm: Number.NaN };
    }
    const earthRadiusKm = 6378.137;
    return {
        perigeeAltitudeKm: (semiMajorAxisKm * (1 - eccentricity)) - earthRadiusKm,
        apogeeAltitudeKm: (semiMajorAxisKm * (1 + eccentricity)) - earthRadiusKm
    };
}

function isValidEpochRange(form) {
    const start = new Date(toUtcEpoch(form.epochStartUtc || form.epochUtc));
    const end = new Date(toUtcEpoch(form.epochEndUtc));
    return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end.getTime() > start.getTime();
}

function dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
}

function stateVectorPayload(stateVector) {
    return {
        positionEciKm: {
            x: stateVector.positionXKm,
            y: stateVector.positionYKm,
            z: stateVector.positionZKm
        },
        velocityEciKmS: {
            x: stateVector.velocityXKmS,
            y: stateVector.velocityYKmS,
            z: stateVector.velocityZKmS
        }
    };
}

function flattenStateVector(stateVector = {}) {
    return {
        positionXKm: stateVector.positionXKm ?? stateVector.positionEciKm?.x,
        positionYKm: stateVector.positionYKm ?? stateVector.positionEciKm?.y,
        positionZKm: stateVector.positionZKm ?? stateVector.positionEciKm?.z,
        velocityXKmS: stateVector.velocityXKmS ?? stateVector.velocityEciKmS?.x,
        velocityYKmS: stateVector.velocityYKmS ?? stateVector.velocityEciKmS?.y,
        velocityZKmS: stateVector.velocityZKmS ?? stateVector.velocityEciKmS?.z
    };
}

function payloadFor(form) {
    const epochStartUtc = toUtcEpoch(form.epochStartUtc || form.epochUtc);
    return {
        name: form.name,
        // Kept for the existing editor/runtime bridge. New code should use
        // the explicit range below, which represents the design window.
        epochUtc: epochStartUtc,
        epochStartUtc,
        epochEndUtc: toUtcEpoch(form.epochEndUtc),
        groundTrackPreview: form.groundTrackPreview === true,
        previewReferenceFrame: normalizePreviewReferenceFrame(form.previewReferenceFrame),
        designMode: true,
        propagator: form.propagator,
        keplerian: { ...form.keplerian },
        stateVector: stateVectorPayload(form.stateVector)
    };
}

function mergeIncomingForm(current, detail = {}) {
    const source = detail.form && typeof detail.form === "object" ? detail.form : detail;
    const mergeGroup = (group, fields) => {
        const incoming = source[group];
        if (!incoming || typeof incoming !== "object") return current[group];
        const values = group === "stateVector" ? flattenStateVector(incoming) : incoming;
        return fields.reduce((next, field) => {
            if (Object.hasOwn(values, field.key) && values[field.key] !== undefined) {
                next[field.key] = clamp(
                    asNumber(values[field.key], current[group][field.key]),
                    field.inputMin ?? field.min,
                    field.inputMax ?? field.max
                );
            }
            return next;
        }, { ...current[group] });
    };
    const initialEpoch = typeof source.epochStartUtc === "string"
        ? source.epochStartUtc
        : typeof source.epochUtc === "string"
            ? source.epochUtc
            : current.epochStartUtc;
    const epochStartUtc = toDatetimeInput(initialEpoch, current.epochStartUtc);
    const epochEndUtc = typeof source.epochEndUtc === "string"
        ? toDatetimeInput(source.epochEndUtc, current.epochEndUtc)
        : current.epochEndUtc;
    return {
        name: typeof source.name === "string" ? source.name : current.name,
        epochUtc: epochStartUtc,
        epochStartUtc,
        epochEndUtc,
        groundTrackPreview: typeof source.groundTrackPreview === "boolean" ? source.groundTrackPreview : current.groundTrackPreview,
        previewReferenceFrame: normalizePreviewReferenceFrame(
            source.previewReferenceFrame ?? source.preview_reference_frame,
            current.previewReferenceFrame
        ),
        propagator: typeof source.propagator === "string" ? source.propagator : current.propagator,
        keplerian: mergeGroup("keplerian", KEPLERIAN_FIELDS),
        stateVector: mergeGroup("stateVector", STATE_VECTOR_FIELDS)
    };
}

function NumericRangeField({ field, value, onChange }) {
    const inputRef = useRef(null);
    const [draft, setDraft] = useState(() => formatNumber(value, field.digits));
    const inputMin = field.inputMin ?? field.min;
    const inputMax = field.inputMax ?? field.max;

    useEffect(() => {
        if (document.activeElement !== inputRef.current) setDraft(formatNumber(value, field.digits));
    }, [field.digits, value]);

    const commit = (rawValue) => {
        const numeric = Number(rawValue);
        if (!Number.isFinite(numeric)) {
            setDraft(formatNumber(value, field.digits));
            return;
        }
        const next = clamp(numeric, inputMin, inputMax);
        onChange(next);
        setDraft(formatNumber(next, field.digits));
    };
    const rangeValue = clamp(asNumber(value, field.min), field.min, field.max);

    return <label className="grid min-w-0 gap-1.5 rounded-lg border border-[#1c2e49] bg-[#091322] px-2.5 py-2 font-[system-ui,sans-serif]">
        <span className="flex min-w-0 items-center justify-between gap-2 text-[11px] leading-none font-semibold text-[#c7d5ea]">
            <span className="truncate">{field.label}</span>
            {field.unit && <small className="shrink-0 text-[10px] font-medium text-[#7f94b4]">{field.unit}</small>}
        </span>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
            <input ref={inputRef} className="!h-[29px] !min-w-0 !rounded-md !border !border-[#2d486d] !bg-[#0d1a2d] !px-2 !font-[system-ui,sans-serif] !text-[12px] !leading-none !font-semibold !text-[#edf4ff] !outline-none focus:!border-[#5d8fff] focus:!shadow-[0_0_0_2px_rgba(75,122,255,.16)]" type="number" min={inputMin} max={inputMax} step={field.step} inputMode="decimal" value={draft} aria-label={`${field.label}${field.unit ? ` (${field.unit})` : ""}`} onChange={(event) => {
                const nextDraft = event.target.value;
                setDraft(nextDraft);
                if (Number.isFinite(Number(nextDraft))) onChange(clamp(Number(nextDraft), inputMin, inputMax));
            }} onBlur={(event) => commit(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
            <span className="min-w-[30px] text-right text-[9px] font-medium tabular-nums text-[#7890b2]">{formatNumber(rangeValue, field.digits)}</span>
        </div>
        <input className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#223858] accent-[#5b83ff]" type="range" min={field.min} max={field.max} step={field.step} value={rangeValue} aria-label={`Ajustar ${field.label}`} onChange={(event) => onChange(Number(event.target.value))} />
        <span className="flex justify-between text-[9px] leading-none tabular-nums text-[#5f7598]"><span>{formatNumber(field.min, field.digits)}</span><span>{formatNumber(field.max, field.digits)}</span></span>
    </label>;
}

export default function ManualOrbitPanel() {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState("keplerian");
    const [form, setForm] = useState(createDefaultForm);
    const [status, setStatus] = useState(null);
    // The runtime owns the replacement target.  Keeping only its id in the
    // UI lets the same form distinguish a new authored orbit from an edit
    // without ever making catalogue objects editable in React.
    const [editingManualOrbitId, setEditingManualOrbitId] = useState(null);
    const openRef = useRef(open);

    const publishPanelState = (nextOpen) => dispatch("orbit:manual-orbit-panel-state", {
        open: nextOpen,
        mode: "design",
        designMode: true
    });
    const setPanelOpen = (nextOpen) => {
        const resolved = Boolean(nextOpen);
        if (openRef.current === resolved) return;
        openRef.current = resolved;
        setOpen(resolved);
        publishPanelState(resolved);
    };

    useEffect(() => {
        const onOpen = (event) => {
            if (event.detail && typeof event.detail === "object") setForm((current) => mergeIncomingForm(current, event.detail));
            setStatus(null);
            setPanelOpen(true);
        };
        const onClose = () => {
            setEditingManualOrbitId(null);
            setPanelOpen(false);
        };
        const onCancel = () => {
            setEditingManualOrbitId(null);
            setPanelOpen(false);
        };
        const onToggle = (event) => {
            const nextOpen = typeof event.detail?.open === "boolean" ? event.detail.open : !openRef.current;
            setPanelOpen(nextOpen);
        };
        const onState = (event) => {
            const detail = event.detail || {};
            setForm((current) => mergeIncomingForm(current, detail));
            if (Object.hasOwn(detail, "editingManualOrbitId")) {
                const id = String(detail.editingManualOrbitId || "").trim();
                setEditingManualOrbitId(id || null);
            }
            if (typeof detail.open === "boolean") setPanelOpen(detail.open);
            if (detail.tab === "keplerian" || detail.tab === "state-vector") setTab(detail.tab);
        };
        const onStatus = (event) => {
            const detail = event.detail || {};
            const kind = ["error", "busy", "success"].includes(detail.kind) ? detail.kind : null;
            if (!kind) {
                setStatus(null);
                return;
            }
            const fallback = kind === "busy" ? "Creating manual orbit…" : kind === "success" ? "Manual orbit created." : "Unable to create the manual orbit.";
            setStatus({ kind, message: String(detail.message || fallback) });
        };
        window.addEventListener("orbit:manual-orbit-open", onOpen);
        window.addEventListener("orbit:manual-orbit-close", onClose);
        window.addEventListener("orbit:manual-orbit-cancel", onCancel);
        window.addEventListener("orbit:manual-orbit-toggle", onToggle);
        window.addEventListener("orbit:manual-orbit-state", onState);
        window.addEventListener("orbit:manual-orbit-status", onStatus);
        return () => {
            window.removeEventListener("orbit:manual-orbit-open", onOpen);
            window.removeEventListener("orbit:manual-orbit-close", onClose);
            window.removeEventListener("orbit:manual-orbit-cancel", onCancel);
            window.removeEventListener("orbit:manual-orbit-toggle", onToggle);
            window.removeEventListener("orbit:manual-orbit-state", onState);
            window.removeEventListener("orbit:manual-orbit-status", onStatus);
        };
    }, []);

    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
            if (event.key !== "Escape") return;
            dispatch("orbit:manual-orbit-close", { ...payloadFor(form), reason: "escape" });
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [form, open]);

    const emitChange = (source, nextForm, field, value) => dispatch("orbit:manual-orbit-change", {
        source,
        ...(field ? { field, value } : {}),
        ...payloadFor(nextForm)
    });
    const updateField = (group, key, value) => {
        const next = { ...form, [group]: { ...form[group], [key]: value } };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        emitChange(group, next, key, value);
    };
    const updateEpochStart = (epochStartUtc) => {
        const next = { ...form, epochUtc: epochStartUtc, epochStartUtc };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        emitChange("epoch-range", next, "epochStartUtc", toUtcEpoch(epochStartUtc));
    };
    const updateEpochEnd = (epochEndUtc) => {
        const next = { ...form, epochEndUtc };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        emitChange("epoch-range", next, "epochEndUtc", toUtcEpoch(epochEndUtc));
    };
    const updateGroundTrackPreview = (groundTrackPreview) => {
        const next = { ...form, groundTrackPreview };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        emitChange("ground-track", next, "groundTrackPreview", groundTrackPreview);
    };
    const updatePreviewReferenceFrame = (previewReferenceFrame) => {
        const next = {
            ...form,
            previewReferenceFrame: normalizePreviewReferenceFrame(previewReferenceFrame, form.previewReferenceFrame)
        };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        // This is deliberately a geometry-refreshing source. It changes only
        // the transient preview representation, never the authored orbit.
        emitChange("preview-reference-frame", next, "previewReferenceFrame", next.previewReferenceFrame);
    };
    const updateName = (name) => {
        const next = { ...form, name };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        // Keep an empty draft locally so a user can replace the whole name
        // with the keyboard. The runtime is only updated once it is valid.
        if (name.trim()) {
            emitChange("name", next, "name", name);
        }
    };
    const updatePropagator = (propagator) => {
        const next = { ...form, propagator };
        setForm(next);
        setStatus((current) => current?.kind === "busy" ? current : null);
        emitChange("propagator", next, "propagator", propagator);
    };
    const switchTab = (nextTab) => {
        if (nextTab === tab) return;
        setTab(nextTab);
        const source = nextTab === "state-vector" ? "keplerian" : "state-vector";
        dispatch("orbit:manual-orbit-tab-change", { tab: nextTab, ...payloadFor(form) });
        dispatch("orbit:manual-orbit-sync-request", { source, target: nextTab, ...payloadFor(form) });
    };
    const reset = () => {
        const next = createDefaultForm();
        setForm(next);
        dispatch("orbit:manual-orbit-reset", payloadFor(next));
    };
    const requestClose = (reason = "close") => {
        const detail = { ...payloadFor(form), reason };
        dispatch(reason === "cancel" ? "orbit:manual-orbit-cancel" : "orbit:manual-orbit-close", detail);
    };

    if (!open) return null;

    const fields = tab === "keplerian" ? KEPLERIAN_FIELDS : STATE_VECTOR_FIELDS;
    const group = tab === "keplerian" ? "keplerian" : "stateVector";
    const title = tab === "keplerian" ? "Elementos keplerianos" : "Vector de estado";
    const derived = getKeplerianDerived(form.keplerian);
    const epochRangeValid = isValidEpochRange(form);
    const statusTone = status?.kind === "error"
        ? "border-[#874252] bg-[#291821] text-[#ffd0d9]"
        : status?.kind === "success"
            ? "border-[#2d7252] bg-[#102a22] text-[#b8f1d0]"
            : "border-[#776035] bg-[#2d2617] text-[#f5d38e]";
    const isEditingManualOrbit = Boolean(editingManualOrbitId);

    return <aside id="manualOrbitPanel" className="pointer-events-auto fixed top-[86px] right-[14px] bottom-[132px] z-[10126] flex min-h-[360px] w-[min(380px,calc(100vw-28px))] flex-col overflow-hidden rounded-[10px] border border-[rgba(65,99,147,.66)] bg-[linear-gradient(145deg,rgba(12,25,42,.98),rgba(5,14,25,.98))] font-[system-ui,sans-serif] text-[#dbe7fa] shadow-[0_22px_60px_rgba(0,0,0,.5),inset_0_1px_rgba(255,255,255,.045)] max-[760px]:top-20 max-[760px]:right-2.5 max-[760px]:bottom-[74px] max-[760px]:w-[min(360px,calc(100vw-20px))]" role="dialog" aria-modal="false" aria-labelledby="manualOrbitTitle">
        <header className="flex items-center justify-between border-b border-[#1e3049] px-4 pt-3.5 pb-3">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <h2 id="manualOrbitTitle" className="m-0 text-[16px] leading-none font-bold tracking-[.015em] text-[#f1f6ff]">{isEditingManualOrbit ? "Edit manual orbit" : "Manual orbit"}</h2>
                    <span className={`rounded-full border px-1.5 py-1 text-[8px] leading-none font-bold uppercase tracking-[.09em] ${isEditingManualOrbit ? "border-[#5584dc] bg-[#17325d] text-[#d3e4ff]" : "border-[#356dc2] bg-[#102747] text-[#b7d4ff]"}`}>{isEditingManualOrbit ? "Editing existing orbit" : "Orbit design mode"}</span>
                </div>
                <p className="mt-1.5 mb-0 text-[10px] leading-[1.3] font-medium text-[#91a5c1]">{isEditingManualOrbit ? "Modifica la definici\u00f3n; al actualizar se sustituir\u00e1 esta misma \u00f3rbita." : "Escena aislada para dise\u00f1ar y previsualizar una \u00f3rbita."}</p>
            </div>
            <button className="inline-flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-[#294361] bg-[#0c192b] p-0 text-[18px] leading-none text-[#bdcbe0] hover:border-[#5075a6] hover:bg-[#14243d] hover:text-[#f4f8ff]" type="button" aria-label={"Cerrar creador de \u00f3rbita manual"} onClick={() => requestClose("close")}>&times;</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4 [scrollbar-color:#355179_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#355179]">
            <nav className="grid grid-cols-2 gap-1 rounded-lg border border-[#1d304b] bg-[#08111f] p-1" aria-label={"M\u00e9todo de definici\u00f3n orbital"} role="tablist">
                <button className={`relative cursor-pointer rounded-[5px] border-0 px-2 py-2 text-[10px] leading-none font-bold ${tab === "keplerian" ? "bg-[#233b69] text-[#f3f7ff] shadow-[inset_0_0_0_1px_rgba(122,161,255,.42)]" : "bg-transparent text-[#93a4bd] hover:bg-[#13223a] hover:text-[#dce7f8]"}`} type="button" role="tab" aria-selected={tab === "keplerian"} aria-controls="manual-orbit-keplerian" onClick={() => switchTab("keplerian")}>Keplerian</button>
                <button className={`relative cursor-pointer rounded-[5px] border-0 px-2 py-2 text-[10px] leading-none font-bold ${tab === "state-vector" ? "bg-[#233b69] text-[#f3f7ff] shadow-[inset_0_0_0_1px_rgba(122,161,255,.42)]" : "bg-transparent text-[#93a4bd] hover:bg-[#13223a] hover:text-[#dce7f8]"}`} type="button" role="tab" aria-selected={tab === "state-vector"} aria-controls="manual-orbit-state-vector" onClick={() => switchTab("state-vector")}>State vector</button>
            </nav>

            {status && <div className={`mt-3 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[10px] leading-[1.35] font-semibold ${statusTone}`} role="status" aria-live="polite">
                <i className={`mt-[3px] size-1.5 shrink-0 rounded-full ${status.kind === "error" ? "bg-[#ff7890]" : status.kind === "success" ? "bg-[#64d997]" : "bg-[#f4bb4e]"}`} aria-hidden="true" />
                <span>{status.message}</span>
            </div>}

            <label className="mt-3 grid gap-1.5 font-[system-ui,sans-serif] text-[11px] font-semibold text-[#c7d5ea]">
                <span>Nombre</span>
                <input className="!h-[33px] !rounded-lg !border !border-[#294361] !bg-[#0b1728] !px-2 !font-[system-ui,sans-serif] !text-[12px] !font-medium !text-[#eaf2ff] !outline-none focus:!border-[#5d8fff] focus:!shadow-[0_0_0_2px_rgba(75,122,255,.16)]" type="text" value={form.name} maxLength={80} placeholder="Manual Orbit" onChange={(event) => updateName(event.target.value)} />
            </label>

            <section className="mt-3 rounded-lg border border-[#1f3655] bg-[#091526] p-2.5" aria-label="Ventana temporal de diseno">
                <div className="flex items-baseline justify-between gap-2">
                    <h3 className="m-0 text-[11px] leading-none font-bold text-[#dbe9ff]">Design window</h3>
                    <span className="text-[9px] leading-none font-bold tracking-[.06em] text-[#87a4d1]">UTC</span>
                </div>
                <p className="mt-1 mb-2 text-[10px] leading-[1.35] text-[#8498b5]">La órbita creada se propaga exactamente entre estos instantes; la vista previa muestra una revolución inercial en el epoch inicial.</p>
                <div className="grid grid-cols-2 gap-2">
                    <label className="grid min-w-0 gap-1 font-[system-ui,sans-serif] text-[10px] font-semibold text-[#c7d5ea]">
                        <span>Epoch initial</span>
                        <input className="!h-[33px] !min-w-0 !rounded-lg !border !border-[#294361] !bg-[#0b1728] !px-1.5 !font-[system-ui,sans-serif] !text-[11px] !font-medium !text-[#eaf2ff] !outline-none focus:!border-[#5d8fff] focus:!shadow-[0_0_0_2px_rgba(75,122,255,.16)]" type="datetime-local" value={form.epochStartUtc} onChange={(event) => updateEpochStart(event.target.value)} />
                    </label>
                    <label className="grid min-w-0 gap-1 font-[system-ui,sans-serif] text-[10px] font-semibold text-[#c7d5ea]">
                        <span>Epoch final</span>
                        <input className="!h-[33px] !min-w-0 !rounded-lg !border !border-[#294361] !bg-[#0b1728] !px-1.5 !font-[system-ui,sans-serif] !text-[11px] !font-medium !text-[#eaf2ff] !outline-none focus:!border-[#5d8fff] focus:!shadow-[0_0_0_2px_rgba(75,122,255,.16)]" type="datetime-local" min={form.epochStartUtc} value={form.epochEndUtc} onChange={(event) => updateEpochEnd(event.target.value)} />
                    </label>
                </div>
                {!epochRangeValid && <p className="mt-2 mb-0 text-[10px] leading-[1.35] font-semibold text-[#ff9cab]" role="alert">El epoch final debe ser posterior al inicial.</p>}
            </section>

            <section className="mt-3 rounded-lg border border-[#1f3655] bg-[#091526] p-2.5" aria-labelledby="manualOrbitPreviewFrameTitle">
                <div className="flex items-baseline justify-between gap-2">
                    <h3 id="manualOrbitPreviewFrameTitle" className="m-0 text-[11px] leading-none font-bold text-[#dbe9ff]">Orbit preview frame</h3>
                    <span className="text-[9px] leading-none font-bold tracking-[.06em] text-[#87a4d1]">DISPLAY ONLY</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1 rounded-md border border-[#1b304d] bg-[#08111f] p-1" role="radiogroup" aria-label="Orbit preview reference frame">
                    <button className={`cursor-pointer rounded-[5px] border-0 px-2 py-2 text-left text-[10px] leading-none font-bold ${form.previewReferenceFrame === "eci" ? "bg-[#233b69] text-[#f3f7ff] shadow-[inset_0_0_0_1px_rgba(122,161,255,.42)]" : "bg-transparent text-[#93a4bd] hover:bg-[#13223a] hover:text-[#dce7f8]"}`} type="button" role="radio" aria-checked={form.previewReferenceFrame === "eci"} onClick={() => updatePreviewReferenceFrame("eci")}>
                        <span className="block">ECI</span>
                        <small className="mt-1 block text-[9px] font-medium opacity-75">Inertial ellipse</small>
                    </button>
                    <button className={`cursor-pointer rounded-[5px] border-0 px-2 py-2 text-left text-[10px] leading-none font-bold ${form.previewReferenceFrame === "ecef" ? "bg-[#233b69] text-[#f3f7ff] shadow-[inset_0_0_0_1px_rgba(122,161,255,.42)]" : "bg-transparent text-[#93a4bd] hover:bg-[#13223a] hover:text-[#dce7f8]"}`} type="button" role="radio" aria-checked={form.previewReferenceFrame === "ecef"} onClick={() => updatePreviewReferenceFrame("ecef")}>
                        <span className="block">ECEF</span>
                        <small className="mt-1 block text-[9px] font-medium opacity-75">Earth-fixed path</small>
                    </button>
                </div>
                <p className="mt-2 mb-0 text-[10px] leading-[1.35] text-[#8498b5]">ECI shows one osculating inertial ellipse at the initial epoch. ECEF shows the full selected propagation relative to Earth. This does not change the ECI state-vector input or orbital definition.</p>
            </section>

            <section id={`manual-orbit-${tab}`} className="mt-3" role="tabpanel">
                <div className="mb-2 flex items-end justify-between gap-3">
                    <div>
                        <h3 className="m-0 text-[12px] leading-none font-bold text-[#e7effd]">{title}</h3>
                        <p className="mt-1 mb-0 text-[10px] leading-[1.35] text-[#8498b5]">{"Desliza para un ajuste r\u00e1pido o escribe un valor exacto."}</p>
                    </div>
                    <span className="shrink-0 rounded-full border border-[#2d4770] bg-[#10213a] px-2 py-1 text-[9px] leading-none font-bold tracking-[.045em] text-[#9fc0ff]">{tab === "keplerian" ? "CLASSICAL" : "ECI"}</span>
                </div>
                <div className="grid gap-2">
                    {fields.map((field) => <NumericRangeField key={field.key} field={field} value={form[group][field.key]} onChange={(value) => updateField(group, field.key, value)} />)}
                </div>
            </section>

            <section className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-[#1d3655] bg-[#091526] p-2.5" aria-label="Derivados orbitales">
                <div className="col-span-2 flex items-center justify-between">
                    <h3 className="m-0 text-[11px] leading-none font-bold text-[#dbe9ff]">Derived geometry</h3>
                    <span className="text-[9px] leading-none font-medium text-[#7f94b4]">Keplerian</span>
                </div>
                <div className="rounded-md border border-[#1b304d] bg-[#0c1a2d] px-2 py-1.5">
                    <span className="block text-[9px] leading-none font-semibold text-[#8fa4c4]">Perigee</span>
                    <strong className="mt-1 block text-[12px] leading-none font-bold tabular-nums text-[#eef5ff]">{formatDistanceKm(derived.perigeeAltitudeKm)}</strong>
                </div>
                <div className="rounded-md border border-[#1b304d] bg-[#0c1a2d] px-2 py-1.5">
                    <span className="block text-[9px] leading-none font-semibold text-[#8fa4c4]">Apogee</span>
                    <strong className="mt-1 block text-[12px] leading-none font-bold tabular-nums text-[#eef5ff]">{formatDistanceKm(derived.apogeeAltitudeKm)}</strong>
                </div>
            </section>

            <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#1f3655] bg-[#091526] px-2.5 py-2.5 font-[system-ui,sans-serif]">
                <span className="min-w-0">
                    <strong className="block text-[11px] leading-none text-[#dbe9ff]">Ground track</strong>
                    <small className="mt-1 block text-[10px] leading-[1.3] font-medium text-[#7f94b4]">Mostrar u ocultar durante el diseño; se conserva al confirmar.</small>
                </span>
                <input className="peer sr-only" type="checkbox" checked={form.groundTrackPreview} onChange={(event) => updateGroundTrackPreview(event.target.checked)} />
                <span className="relative h-5 w-9 shrink-0 rounded-full border border-[#3b5579] bg-[#15243a] transition-colors peer-checked:border-[#527cf6] peer-checked:bg-[#3157d5] after:absolute after:top-[3px] after:left-[3px] after:size-3 after:rounded-full after:bg-[#c8d5e9] after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-white" aria-hidden="true" />
            </label>

            <label className="mt-3 grid gap-1.5 border-t border-[#1b2d45] pt-3 font-[system-ui,sans-serif] text-[11px] font-semibold text-[#c7d5ea]">
                <span>Propagator</span>
                <select className="!h-[33px] !cursor-pointer !rounded-lg !border !border-[#294361] !bg-[#0b1728] !px-2 !font-[system-ui,sans-serif] !text-[12px] !font-semibold !text-[#eaf2ff] !outline-none focus:!border-[#5d8fff] focus:!shadow-[0_0_0_2px_rgba(75,122,255,.16)]" value={form.propagator} onChange={(event) => updatePropagator(event.target.value)}>
                    <option value="sgp4">SGP4</option>
                </select>
                <small className="text-[10px] leading-[1.3] font-medium text-[#7f94b4]">{"Preparado para incorporar m\u00e1s propagadores."}</small>
            </label>
            <button className="mt-3 w-full cursor-pointer rounded-lg border border-[#39445a] bg-[#111a29] px-3 py-2 text-[10px] leading-none font-bold text-[#b7c5da] hover:border-[#637c9f] hover:bg-[#17253a] hover:text-[#ecf3ff]" type="button" onClick={reset}>Restablecer valores</button>
        </div>

        <footer className="grid grid-cols-2 gap-2 border-t border-[#1e3049] bg-[rgba(6,14,25,.72)] px-4 py-3">
            <button className="min-h-[34px] cursor-pointer rounded-lg border border-[#3c3145] bg-[#1b1320] px-3 text-[11px] leading-none font-bold text-[#e1b5c1] hover:border-[#885166] hover:bg-[#2a1721] hover:text-[#ffe2e9]" type="button" onClick={() => requestClose("cancel")}>Cancel</button>
            <button className="min-h-[34px] cursor-pointer rounded-lg border border-[#476dce] bg-[#3657dc] px-3 text-[11px] leading-none font-bold text-white shadow-[0_6px_16px_rgba(41,76,220,.3)] hover:border-[#6e91ff] hover:bg-[#4668ee] disabled:cursor-wait disabled:opacity-55" type="button" disabled={status?.kind === "busy" || !epochRangeValid} onClick={() => dispatch("orbit:manual-orbit-create", payloadFor(form))}>{status?.kind === "busy" ? (isEditingManualOrbit ? "Updating..." : "Creating...") : (isEditingManualOrbit ? "Actualizar \u00f3rbita" : "Crear \u00f3rbita")}</button>
        </footer>
    </aside>;
}
