import { useEffect, useMemo, useRef, useState } from "react";
import PanelCloseButton from "../../components/PanelCloseButton.jsx";
import { CalendarIcon, ChevronDownIcon } from "../../components/icons.jsx";
import {
    ORBIT_PLANNER_EVENT_ACTIVATE_EVENT,
    ORBIT_PLANNER_EVENTS_COMPAT_EVENT,
    ORBIT_PLANNER_LAYER_FILTER_EVENT,
    ORBIT_PLANNER_MANUAL_EVENT_REMOVE_EVENT,
    ORBIT_PLANNER_MANUAL_EVENT_UPSERT_EVENT,
    ORBIT_PLANNER_STATE_REQUEST_EVENT,
    ORBIT_PLANNER_STATE_EVENT,
    ORBIT_PLANNER_VIEW_RANGE_EVENT,
    MANUAL_PLANNER_ICS_MIME_TYPE,
    PLANNER_COLOR_TOKENS,
    PLANNER_EVENT_COLORS,
    PLANNER_EVENT_KINDS,
    cursorForUtcMonth,
    filterPlannerEventsByLayerVisibility,
    formatUtcMonth,
    formatUtcInput,
    isPlannerEopRangeEvent,
    layoutPlannerEventLanes,
    makeManualEventPayload,
    normalizePlannerUiState,
    parseManualPlannerEventsIcs,
    plannerEventActivation,
    plannerEventDescription,
    plannerViewRangePayload,
    serializeManualPlannerEventsToIcs
} from "./plannerUiModel.js";
import {
    initialPlannerWindowRect,
    isPlannerWindowCompactViewport,
    movePlannerWindowRect,
    normalizePlannerWindowRect,
    plannerWindowViewport,
    resizePlannerWindowRect
} from "./plannerWindowLayout.js";
import {
    buildPlannerCoverageSegments,
    plannerAdjacentVisibleEvent,
    plannerCursorForEvent,
    plannerEventIsInView
} from "./plannerCoverageLayout.js";
import "./PlannerPanel.css";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const HOUR_HEIGHT = 52;
// Point facts such as AOS, maximum elevation and LOS still need a readable
// card. The collision layout receives this same footprint so close facts use
// parallel columns instead of painting one card on top of another.
const TIMED_EVENT_MIN_DURATION_MS = 30 * 60 * 1000;
export const PLANNER_REQUEST_MESSAGE_TIMEOUT_MS = 4_500;
const ORBIT_PLANNER_VIEW_RANGE_REBASE_EVENT = "orbit:planner-view-range-rebase";
const PLANNER_RESIZE_DIRECTIONS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const formatter = new Intl.DateTimeFormat("es-ES", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
});
const dayFormatter = new Intl.DateTimeFormat("es-ES", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
});
const monthFormatter = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", month: "long", year: "numeric" });

function utcDay(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(day, amount) {
    const result = utcDay(day);
    result.setUTCDate(result.getUTCDate() + amount);
    return result;
}

function startOfUtcWeek(day) {
    const value = utcDay(day);
    const mondayOffset = (value.getUTCDay() + 6) % 7;
    return addUtcDays(value, -mondayOffset);
}

function startOfUtcMonth(day) {
    return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

function sameUtcDay(left, right) {
    return left.getUTCFullYear() === right.getUTCFullYear()
        && left.getUTCMonth() === right.getUTCMonth()
        && left.getUTCDate() === right.getUTCDate();
}

function dayRange(day) {
    const start = utcDay(day).getTime();
    return { start, end: start + 24 * 60 * 60 * 1000 };
}

function eventInDay(event, day) {
    const { start, end } = dayRange(day);
    const eventStart = Date.parse(event.start);
    const eventEnd = Math.max(eventStart + 1, Date.parse(event.end || event.start));
    return eventStart < end && eventEnd > start;
}

function eventsForDay(events, day) {
    return events.filter((event) => eventInDay(event, day));
}

function eventTimeLabel(event) {
    if (event.allDay) return "Todo el día";
    const start = formatter.format(new Date(event.start));
    const end = Date.parse(event.end) > Date.parse(event.start) ? formatter.format(new Date(event.end)) : null;
    return end ? `${start} — ${end} UTC` : `${start} UTC`;
}

function eventColorStyle(event) {
    return { "--planner-event-color": PLANNER_EVENT_COLORS[event.colorToken] || PLANNER_EVENT_COLORS[PLANNER_COLOR_TOKENS.BLUE] };
}

const EOP_VISUAL_STATE_COLOR_TOKENS = Object.freeze({
    normal: PLANNER_COLOR_TOKENS.EMERALD,
    ok: PLANNER_COLOR_TOKENS.AMBER,
    predicted: PLANNER_COLOR_TOKENS.ROSE,
    degraded: PLANNER_COLOR_TOKENS.ROSE
});
const IERS_ERP_TIME_LAYER_NAME = "IERS ERP Time";

function knownPlannerColorToken(value) {
    const token = String(value || "").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PLANNER_EVENT_COLORS, token) ? token : "";
}

function ChevronLeftIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5-6 6 6 6" /></svg>;
}

function ChevronRightIcon() {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5.5 6 6-6 6" /></svg>;
}

function plannerRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * The runtime publishes a semantic EOP visual state alongside its canonical
 * colour token. Prefer that explicit contract, but retain a safe palette for
 * an older cached planner snapshot which only carries the semantic state.
 */
function eopCoverageColorToken(event) {
    const metadata = plannerRecord(event?.metadata);
    return knownPlannerColorToken(metadata.eopColorToken)
        || knownPlannerColorToken(event?.colorToken)
        || EOP_VISUAL_STATE_COLOR_TOKENS[String(metadata.eopVisualState || "").trim().toLowerCase()]
        || PLANNER_COLOR_TOKENS.BLUE;
}

function eopCoverageStyle(event) {
    const colorToken = eopCoverageColorToken(event);
    return {
        "--planner-event-color": PLANNER_EVENT_COLORS[colorToken],
        "--planner-eop-tone": colorToken
    };
}

function eopCoverageStateLabel(event) {
    const state = String(plannerRecord(event?.metadata).eopVisualState || "").trim().toLowerCase();
    if (state === "normal") return "Cobertura de referencia";
    if (state === "ok") return "Cobertura válida; confirme la calidad publicada";
    if (state === "predicted") return "Predicción; requiere atención";
    if (state === "degraded") return "Cobertura degradada; requiere atención";
    return "Cobertura de orientación terrestre";
}

function isIersErpTimeLayer(layer) {
    const source = plannerRecord(layer);
    const id = String(source.id || "").trim().toLowerCase();
    const sourceId = String(source.sourceId || "").trim().toLowerCase();
    const format = String(source.sourceFormat || "").trim().toUpperCase();
    const origin = String(source.sourceOrigin || "").trim().toUpperCase();
    return id === "planner:iers-eop"
        || sourceId === "planner:iers-eop"
        || (source.type === "SYSTEM" && format === "EOP" && origin === "IERS");
}

function plannerLayerDisplayName(layer) {
    return isIersErpTimeLayer(layer) ? IERS_ERP_TIME_LAYER_NAME : layer.name;
}

function plannerMode(context) {
    const mode = String(plannerRecord(context).simulation?.mode || "").trim().toLowerCase();
    if (mode === "range" || mode === "simulated") return "simulated";
    if (mode === "realtime" || mode === "real-time") return "realtime";
    if (mode === "static") return "static";
    return "unknown";
}

function plannerCursorFromState(state) {
    const context = plannerRecord(state?.context);
    const simulation = plannerRecord(context.simulation);
    const passes = plannerRecord(context.passes);
    for (const candidate of [simulation.currentTime, simulation.startTime, passes.startTime]) {
        const day = utcDay(candidate);
        if (day && !Number.isNaN(day.getTime())) return day;
    }
    return null;
}

function isModeBoundaryMessage(message, mode) {
    if (mode === "simulated") return false;
    return /pases del planificador.*(?:simulated|rango utc)|(?:simulated|rango utc).*pases del planificador/i.test(String(message || ""));
}

function PlannerLayerSidebar({ layers, hiddenLayerIds, onVisibilityChange, onShowAll }) {
    const sortedLayers = useMemo(() => [...layers].sort((left, right) => (
        Number(right.active) - Number(left.active)
        || Number(right.visible) - Number(left.visible)
        || left.name.localeCompare(right.name, "es")
    )), [layers]);
    const hidden = new Set(hiddenLayerIds);
    return <aside className="orbit-planner-layers" aria-label="Capas de la agenda">
        <header className="orbit-planner-layers-header">
            <h3>Capas de la agenda</h3>
            {hidden.size ? <button type="button" onClick={onShowAll}>Mostrar todas</button> : null}
        </header>
        <div className="orbit-planner-layer-list">
            {!sortedLayers.length ? <p className="orbit-planner-layers-empty">No hay capas publicadas por la escena.</p> : sortedLayers.map((layer) => {
                const enabled = !hidden.has(layer.id);
                const plannerOnly = layer.type === "SYSTEM";
                const sceneState = plannerOnly ? "Capa disponible solo en la agenda" : layer.visible ? "Escena visible" : "Escena oculta";
                const layerTypeLabel = plannerOnly ? "Agenda" : layer.type;
                const layerName = plannerLayerDisplayName(layer);
                return <label className={`orbit-planner-layer${enabled ? "" : " is-hidden"}`} key={layer.id}>
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => onVisibilityChange(layer.id, event.target.checked)}
                        aria-label={`${enabled ? "Mostrar" : "Ocultar"} ${layerName} en el planificador`}
                    />
                    <span className="orbit-planner-layer-copy"><b>{layerName}</b><small>{layerTypeLabel} · {layer.active ? "Activa" : "Inactiva"}</small></span>
                    <span className={`orbit-planner-layer-scene-state${layer.visible && !plannerOnly ? " is-visible" : ""}${plannerOnly ? " is-planner-only" : ""}`} title={sceneState}>{plannerOnly ? "—" : layer.visible ? "●" : "○"}</span>
                </label>;
            })}
        </div>
    </aside>;
}

function createEditorFields(event) {
    return {
        title: event?.title || "",
        start: formatUtcInput(event?.start || new Date()),
        end: formatUtcInput(event?.end || new Date(Date.now() + 60 * 60 * 1000)),
        color: event?.colorToken || PLANNER_COLOR_TOKENS.BLUE,
        description: plannerEventDescription(event)
    };
}

function EopCoverageBand({ event, labelled, onSelect, segment, gridColumnOffset = 1 }) {
    const stateLabel = eopCoverageStateLabel(event);
    const label = `${event.title} · ${stateLabel} · ${eventTimeLabel(event)}`;
    const accessibleLabel = labelled ? label : `Continuación de ${label}`;
    const startInset = segment ? Math.max(0, Math.min(100, (Number(segment.startFraction) || 0) * 100 / segment.span)) : 0;
    const endInset = segment ? Math.max(0, Math.min(100, (Number(segment.endInsetFraction) || 0) * 100 / segment.span)) : 0;
    const segmentStyle = segment ? {
        gridRow: String(segment.row + 1),
        gridColumn: `${segment.column + gridColumnOffset} / span ${segment.span}`,
        "--orbit-planner-eop-start-inset": `${startInset}%`,
        "--orbit-planner-eop-end-inset": `${endInset}%`
    } : {};
    return <button
        type="button"
        className={`orbit-planner-eop-range${labelled ? " has-label" : ""}`}
        style={{ ...eopCoverageStyle(event), ...segmentStyle }}
        onClick={() => onSelect(event)}
        title={label}
        aria-label={accessibleLabel}
        data-planner-eop-range="true"
        data-eop-tone={eopCoverageColorToken(event)}
        data-eop-state={String(plannerRecord(event?.metadata).eopVisualState || "").trim().toLowerCase() || "unknown"}
    >
        <span className="orbit-planner-eop-range-line" aria-hidden="true" />
        {labelled ? <span className="orbit-planner-eop-range-label"><span className="orbit-planner-eop-range-label-text">{event.title}</span></span> : null}
    </button>;
}

function EventButton({ event, onSelect, compact = false }) {
    return <button
        type="button"
        className={`orbit-planner-event${compact ? " is-compact" : ""}`}
        style={eventColorStyle(event)}
        onClick={() => onSelect(event)}
        title={`${event.title} · ${eventTimeLabel(event)}`}
        aria-label={`${event.title}, ${eventTimeLabel(event)}`}
    >
        <span className="orbit-planner-event-dot" aria-hidden="true" />
        <span className="orbit-planner-event-title">{event.title}</span>
        {!compact ? <span className="orbit-planner-event-time">{eventTimeLabel(event)}</span> : null}
    </button>;
}

function MonthView({ cursor, events, onSelect, onOpenDay }) {
    const first = startOfUtcMonth(cursor);
    const gridStart = startOfUtcWeek(first);
    const today = utcDay();
    const cells = Array.from({ length: 42 }, (_, index) => addUtcDays(gridStart, index));
    const gridEnd = addUtcDays(gridStart, cells.length);
    const eopRangeEvents = events.filter(isPlannerEopRangeEvent);
    const ordinaryEvents = events.filter((event) => !isPlannerEopRangeEvent(event));
    const eopRangeSegments = buildPlannerCoverageSegments(eopRangeEvents, {
        start: gridStart.toISOString(),
        end: gridEnd.toISOString(),
        columns: 7
    });
    return <section className="orbit-planner-month" aria-label="Vista mensual">
        <div className="orbit-planner-weekdays" aria-hidden="true">{WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
        <div className="orbit-planner-month-grid">
            {cells.map((day) => {
                const dayEvents = eventsForDay(ordinaryEvents, day);
                const hasEopCoverage = eventsForDay(eopRangeEvents, day).length > 0;
                const inCurrentMonth = day.getUTCMonth() === cursor.getUTCMonth();
                return <article className={`orbit-planner-month-day${inCurrentMonth ? "" : " is-outside"}${sameUtcDay(day, today) ? " is-today" : ""}${hasEopCoverage ? " has-eop-coverage" : ""}`} key={day.toISOString()}>
                    <button type="button" className="orbit-planner-day-number" onClick={() => onOpenDay(day)} aria-label={`Ver el día ${dayFormatter.format(day)}`}>{day.getUTCDate()}</button>
                    <div
                        className="orbit-planner-month-events"
                        aria-label={`Eventos del ${dayFormatter.format(day)}${dayEvents.length ? ". Desplázate para verlos todos." : ""}`}
                        tabIndex={dayEvents.length ? 0 : -1}
                    >
                        {dayEvents.map((event) => <EventButton event={event} key={`${event.id}:${day.toISOString()}`} compact onSelect={onSelect} />)}
                    </div>
                </article>;
            })}
            {eopRangeSegments.length ? <div className="orbit-planner-month-eop-ranges" aria-label="Cobertura de orientación terrestre">
                {eopRangeSegments.map((segment) => <EopCoverageBand event={segment.event} key={`${segment.event.id}:${segment.row}:${segment.column}:${segment.span}`} segment={segment} labelled={segment.labelled} onSelect={onSelect} />)}
            </div> : null}
        </div>
    </section>;
}

function TimedEvent({ layout, day, onSelect }) {
    const { event, lane = 0, laneCount = 1, layoutStartMs, layoutEndMs } = layout;
    const { start, end } = dayRange(day);
    const startTime = Math.max(start, Number.isFinite(layoutStartMs) ? layoutStartMs : Date.parse(event.start));
    const rawEnd = Number.isFinite(layoutEndMs) ? layoutEndMs : Date.parse(event.end || event.start);
    const endTime = Math.min(end, Math.max(rawEnd, startTime + TIMED_EVENT_MIN_DURATION_MS));
    const minutes = (startTime - start) / 60_000;
    const duration = Math.max(24, ((endTime - startTime) / 60_000) * (HOUR_HEIGHT / 60));
    const laneWidth = 100 / Math.max(1, laneCount);
    return <button
        type="button"
        className="orbit-planner-timed-event"
        data-lane-count={laneCount}
        style={{
            ...eventColorStyle(event),
            top: `${minutes * (HOUR_HEIGHT / 60)}px`,
            height: `${duration}px`,
            left: `calc(${lane * laneWidth}% + 4px)`,
            width: `calc(${laneWidth}% - 8px)`,
            right: "auto"
        }}
        onClick={() => onSelect(event)}
        title={`${event.title} · ${eventTimeLabel(event)}`}
        aria-label={`${event.title}, ${eventTimeLabel(event)}`}
    ><span>{event.title}</span><small>{eventTimeLabel(event)}</small></button>;
}

function TimeGrid({ view, cursor, events, onSelect }) {
    const start = view === "week" ? startOfUtcWeek(cursor) : utcDay(cursor);
    const days = view === "week" ? Array.from({ length: 7 }, (_, index) => addUtcDays(start, index)) : [start];
    const end = addUtcDays(start, days.length);
    const today = utcDay();
    const eopRangeEvents = events.filter(isPlannerEopRangeEvent);
    const ordinaryEvents = events.filter((event) => !isPlannerEopRangeEvent(event));
    const timedEvents = ordinaryEvents.filter((event) => !event.allDay);
    const allDayEvents = ordinaryEvents.filter((event) => event.allDay);
    const eopRangeSegments = buildPlannerCoverageSegments(eopRangeEvents, {
        start: start.toISOString(),
        end: end.toISOString(),
        columns: days.length
    });
    return <section className={`orbit-planner-time-grid is-${view}`} aria-label={view === "week" ? "Vista semanal" : "Vista diaria"}>
        <div className="orbit-planner-time-scroll">
            <div className="orbit-planner-time-header" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
                <span aria-hidden="true" />
                {days.map((day, index) => <span className={sameUtcDay(day, today) ? "is-today" : ""} key={day.toISOString()}>{WEEKDAY_LABELS[index + (view === "day" ? (day.getUTCDay() + 6) % 7 : 0)]}<b>{day.getUTCDate()}</b></span>)}
            </div>
            {eopRangeSegments.length ? <div className="orbit-planner-time-eop-ranges" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }} aria-label="Cobertura de orientación terrestre">
                <span aria-hidden="true" />
                {eopRangeSegments.map((segment) => <EopCoverageBand event={segment.event} key={`${segment.event.id}:${segment.row}:${segment.column}:${segment.span}`} segment={segment} gridColumnOffset={2} labelled={segment.labelled} onSelect={onSelect} />)}
            </div> : null}
            <div className="orbit-planner-hours" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
                <div className="orbit-planner-hour-labels" aria-hidden="true">{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{String(hour).padStart(2, "0")}:00</span>)}</div>
                {days.map((day) => {
                    const visibleDay = dayRange(day);
                    const timedLayouts = layoutPlannerEventLanes(eventsForDay(timedEvents, day), {
                        minimumDurationMs: TIMED_EVENT_MIN_DURATION_MS,
                        range: visibleDay
                    });
                    return <div className="orbit-planner-time-day" key={day.toISOString()}>
                    {Array.from({ length: 24 }, (_, hour) => <div className="orbit-planner-hour-line" key={hour} />)}
                    {timedLayouts.map((layout) => <TimedEvent layout={layout} day={day} key={`${layout.event.id}:${day.toISOString()}`} onSelect={onSelect} />)}
                    {eventsForDay(allDayEvents, day).map((event) => <EventButton event={event} key={`${event.id}:all-day:${day.toISOString()}`} compact onSelect={onSelect} />)}
                </div>;
                })}
            </div>
        </div>
    </section>;
}

function EventDetails({ event, onEdit, onRemove, activation, onActivate, eventIndex, eventCount, onPrevious, onNext }) {
    if (!event) return <aside className="orbit-planner-detail orbit-planner-detail-empty" aria-live="polite"><CalendarIcon /><p>Selecciona un evento para ver sus detalles.</p></aside>;
    const isManual = event.kind === PLANNER_EVENT_KINDS.MANUAL;
    const description = plannerEventDescription(event);
    const metadata = plannerRecord(event.metadata);
    const metadataEntries = Object.entries(metadata)
        .filter(([key, value]) => !["description", "details", "detail"].includes(key) && ["string", "number", "boolean"].includes(typeof value))
        .slice(0, 5);
    const safeIndex = Number.isInteger(eventIndex) && eventIndex >= 0 ? eventIndex : 0;
    const safeCount = Number.isInteger(eventCount) && eventCount > 0 ? eventCount : 1;
    return <aside className="orbit-planner-detail" aria-label="Detalle del evento">
        <div className="orbit-planner-detail-body">
            <span className="orbit-planner-detail-color" style={eventColorStyle(event)} aria-hidden="true" />
            <span className="orbit-planner-detail-kicker">{isManual ? "Evento manual" : "Evento de Orbit"}</span>
            <h3>{event.title}</h3>
            <p className="orbit-planner-detail-time">{eventTimeLabel(event)}</p>
            {description ? <p className="orbit-planner-detail-description">{description}</p> : null}
            {metadataEntries.length ? <dl className="orbit-planner-detail-meta">{metadataEntries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl> : null}
            {!activation.enabled ? <p className="orbit-planner-detail-activation-note" role="status">{activation.reason}</p> : null}
            <button type="button" className="orbit-planner-detail-action" disabled={!activation.enabled} title={activation.enabled ? "Abrir el día del evento y mover la simulación al instante válido" : activation.reason} onClick={() => onActivate(event, activation)}>Ir al evento</button>
            {isManual ? <div className="orbit-planner-detail-actions"><button type="button" className="orbit-planner-detail-action" onClick={() => onEdit(event)}>Editar</button><button type="button" className="orbit-planner-detail-remove" onClick={() => onRemove(event)}>Eliminar</button></div> : null}
        </div>
        <nav className="orbit-planner-detail-pager" aria-label="Navegación entre todos los eventos visibles">
            <button type="button" className="orbit-planner-detail-pager-button" aria-label="Evento anterior" disabled={safeIndex <= 0} onClick={onPrevious}><ChevronLeftIcon /></button>
            <span aria-live="polite">{safeIndex + 1}/{safeCount}</span>
            <button type="button" className="orbit-planner-detail-pager-button" aria-label="Evento siguiente" disabled={safeIndex >= safeCount - 1} onClick={onNext}><ChevronRightIcon /></button>
        </nav>
    </aside>;
}

function ManualEventEditor({ event, onClose, onSubmit, error }) {
    const [fields, setFields] = useState(() => createEditorFields(event));
    const editMode = Boolean(event);
    const update = (key) => (next) => setFields((current) => ({ ...current, [key]: next.target.value }));
    return <section className="orbit-planner-editor-backdrop" role="presentation">
        <form className="orbit-planner-editor" aria-label={editMode ? "Editar evento manual" : "Crear evento manual"} onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            onSubmit(fields, event?.id);
        }}>
            <header><div><span>PLANIFICADOR · EVENTO MANUAL</span><h3>{editMode ? "Editar evento" : "Nuevo evento"}</h3></div><PanelCloseButton label="Cerrar editor de evento" onClick={onClose} /></header>
            <label>Título<input autoFocus value={fields.title} onChange={update("title")} maxLength="160" required /></label>
            <label>Inicio (UTC)<input type="datetime-local" value={fields.start} onChange={update("start")} required /></label>
            <label>Fin (UTC)<input type="datetime-local" value={fields.end} onChange={update("end")} required /></label>
            <label>Detalles (opcional)<textarea value={fields.description} onChange={update("description")} maxLength="2000" rows="4" placeholder="Notas para el equipo operativo" /></label>
            <label>Color<select value={fields.color} onChange={update("color")}><option value={PLANNER_COLOR_TOKENS.BLUE}>Azul</option><option value={PLANNER_COLOR_TOKENS.CYAN}>Cian</option><option value={PLANNER_COLOR_TOKENS.EMERALD}>Verde</option><option value={PLANNER_COLOR_TOKENS.PURPLE}>Morado</option><option value={PLANNER_COLOR_TOKENS.AMBER}>Ámbar</option><option value={PLANNER_COLOR_TOKENS.ROSE}>Rojo</option><option value={PLANNER_COLOR_TOKENS.SLATE}>Gris</option></select></label>
            {error ? <p className="orbit-planner-editor-error" role="alert">{error}</p> : null}
            <p className="orbit-planner-editor-note">Se guarda únicamente dentro de este proyecto.</p>
            <footer><button type="button" className="orbit-planner-editor-cancel" onClick={onClose}>Cancelar</button><button type="submit" className="orbit-planner-editor-save">{editMode ? "Guardar cambios" : "Crear evento"}</button></footer>
        </form>
    </section>;
}

/**
 * Full planner surface.  It renders exactly the stream supplied by the
 * runtime and emits manual mutations. ICS import/export deliberately covers
 * those authored mutations only; derived passes and source coverage remain
 * runtime facts and never become editable calendar data.
 */
export default function PlannerPanel({ onClose }) {
    const [plannerState, setPlannerState] = useState(() => normalizePlannerUiState(
        typeof window !== "undefined" && window.__orbitPlannerState
            ? window.__orbitPlannerState
            : { status: "loading" }
    ));
    const [view, setView] = useState("week");
    const initialPlannerCursor = plannerCursorFromState(plannerState);
    const [cursor, setCursor] = useState(() => initialPlannerCursor || utcDay());
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [editorEvent, setEditorEvent] = useState(undefined);
    const [editorError, setEditorError] = useState("");
    const [requestMessage, setRequestMessage] = useState("");
    const [layerVisibilityOverrides, setLayerVisibilityOverrides] = useState(() => new Map());
    const [windowRect, setWindowRect] = useState(() => initialPlannerWindowRect());
    const [windowInteraction, setWindowInteraction] = useState(null);
    const icsImportInputRef = useRef(null);
    const lastViewRangeKey = useRef("");
    const cursorSeededFromScene = useRef(Boolean(initialPlannerCursor));
    const cursorWasNavigatedByUser = useRef(false);
    const [viewportCursorReady, setViewportCursorReady] = useState(Boolean(initialPlannerCursor));

    useEffect(() => {
        const sync = (event) => setPlannerState(normalizePlannerUiState(event.detail));
        const syncLegacy = (event) => setPlannerState(normalizePlannerUiState(Array.isArray(event.detail) ? { status: "ready", events: event.detail } : event.detail));
        window.addEventListener(ORBIT_PLANNER_STATE_EVENT, sync);
        window.addEventListener(ORBIT_PLANNER_EVENTS_COMPAT_EVENT, syncLegacy);
        window.dispatchEvent(new Event(ORBIT_PLANNER_STATE_REQUEST_EVENT));
        return () => {
            window.removeEventListener(ORBIT_PLANNER_STATE_EVENT, sync);
            window.removeEventListener(ORBIT_PLANNER_EVENTS_COMPAT_EVENT, syncLegacy);
        };
    }, []);

    useEffect(() => {
        const rebaseViewRange = (event) => {
            const startTime = event?.detail?.startTime;
            if (!startTime) return;
            const nextCursor = utcDay(startTime);
            if (!nextCursor || Number.isNaN(nextCursor.getTime())) return;
            cursorWasNavigatedByUser.current = true;
            setViewportCursorReady(true);
            setCursor(nextCursor);
            setRequestMessage("La agenda se ha centrado en el intervalo operativo de la escena.");
        };
        window.addEventListener(ORBIT_PLANNER_VIEW_RANGE_REBASE_EVENT, rebaseViewRange);
        return () => window.removeEventListener(ORBIT_PLANNER_VIEW_RANGE_REBASE_EVENT, rebaseViewRange);
    }, []);

    useEffect(() => {
        const closeOnEscape = (event) => {
            if (event.key !== "Escape") return;
            if (editorEvent !== undefined) {
                setEditorEvent(undefined);
                setEditorError("");
            } else onClose();
        };
        document.addEventListener("keydown", closeOnEscape);
        return () => document.removeEventListener("keydown", closeOnEscape);
    }, [editorEvent, onClose]);

    useEffect(() => {
        if (!requestMessage) return undefined;
        const timeout = window.setTimeout(() => setRequestMessage(""), PLANNER_REQUEST_MESSAGE_TIMEOUT_MS);
        return () => window.clearTimeout(timeout);
    }, [requestMessage]);

    useEffect(() => {
        const constrain = () => setWindowRect((current) => normalizePlannerWindowRect(current, plannerWindowViewport()));
        window.addEventListener("resize", constrain);
        return () => window.removeEventListener("resize", constrain);
    }, []);

    useEffect(() => {
        if (!windowInteraction) return undefined;
        const move = (event) => {
            if (event.pointerId !== undefined && event.pointerId !== windowInteraction.pointerId) return;
            const deltaX = event.clientX - windowInteraction.pointerX;
            const deltaY = event.clientY - windowInteraction.pointerY;
            setWindowRect(windowInteraction.kind === "drag"
                ? movePlannerWindowRect(windowInteraction.rect, deltaX, deltaY)
                : resizePlannerWindowRect(windowInteraction.rect, windowInteraction.direction, deltaX, deltaY));
        };
        const stop = (event) => {
            if (event.pointerId !== undefined && event.pointerId !== windowInteraction.pointerId) return;
            setWindowInteraction(null);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
        };
    }, [windowInteraction]);

    useEffect(() => {
        if (cursorSeededFromScene.current || cursorWasNavigatedByUser.current) return;
        const sceneCursor = plannerCursorFromState(plannerState);
        if (sceneCursor) {
            cursorSeededFromScene.current = true;
            setCursor(sceneCursor);
            setViewportCursorReady(true);
            return;
        }
        if (plannerState.status !== "loading") {
            cursorSeededFromScene.current = true;
            setViewportCursorReady(true);
        }
    }, [plannerState]);

    useEffect(() => {
        // A panel that mounted before the runtime had an authoritative scene
        // snapshot must not accidentally request today's wall-clock window
        // for a historical simulated project. It publishes as soon as the
        // first UTC context anchors the cursor instead.
        if (!viewportCursorReady) return;
        const payload = plannerViewRangePayload(view, cursor);
        if (!payload) return;
        const key = `${payload.view}:${payload.startTime}:${payload.endTime}`;
        if (key === lastViewRangeKey.current) return;
        lastViewRangeKey.current = key;
        window.dispatchEvent(new CustomEvent(ORBIT_PLANNER_VIEW_RANGE_EVENT, { detail: payload }));
    }, [view, cursor, viewportCursorReady]);

    const events = plannerState.events;
    const manualEvents = useMemo(() => events.filter((event) => event.kind === PLANNER_EVENT_KINDS.MANUAL), [events]);
    const layers = plannerState.layers;
    const stateHiddenLayerIds = plannerState.plannerHiddenLayerIds;
    const hiddenLayerIds = useMemo(() => {
        const hidden = new Set(stateHiddenLayerIds);
        for (const [layerId, visible] of layerVisibilityOverrides) {
            if (visible) hidden.delete(layerId);
            else hidden.add(layerId);
        }
        return [...hidden];
    }, [stateHiddenLayerIds, layerVisibilityOverrides]);
    const visibleEvents = useMemo(() => filterPlannerEventsByLayerVisibility(events, layers, hiddenLayerIds), [events, layers, hiddenLayerIds]);
    const viewRange = useMemo(() => plannerViewRangePayload(view, cursor), [view, cursor]);
    const eventsInView = useMemo(() => {
        if (!viewRange) return visibleEvents;
        return visibleEvents.filter((event) => plannerEventIsInView(event, {
            start: viewRange.startTime,
            end: viewRange.endTime
        }));
    }, [visibleEvents, viewRange]);
    const mode = plannerMode(plannerState.context);
    const visibleErrors = useMemo(() => plannerState.errors.filter((message) => !isModeBoundaryMessage(message, mode)), [plannerState.errors, mode]);
    const presentationStatus = plannerState.status === "loading"
        ? "loading"
        : visibleErrors.length
            ? "error"
            : "ready";
    // Detail navigation follows the complete currently visible-filtered event
    // stream. When the adjacent event lies outside this period, its cursor is
    // brought into the existing day/week/month view without closing the panel
    // or losing the selected detail.
    const selectedEventIndex = useMemo(() => visibleEvents.findIndex((event) => event.id === selectedEvent?.id), [visibleEvents, selectedEvent]);
    const selected = selectedEventIndex >= 0 ? visibleEvents[selectedEventIndex] : null;
    const selectedActivation = useMemo(() => plannerEventActivation(selected, plannerState.context), [selected, plannerState.context]);

    useEffect(() => {
        const actualHidden = new Set(plannerState.plannerHiddenLayerIds);
        setLayerVisibilityOverrides((current) => {
            let changed = false;
            const next = new Map(current);
            for (const [layerId, visible] of current) {
                if (actualHidden.has(layerId) === !visible) {
                    next.delete(layerId);
                    changed = true;
                }
            }
            return changed ? next : current;
        });
    }, [plannerState.plannerHiddenLayerIds]);

    useEffect(() => {
        if (selectedEvent && !visibleEvents.some((event) => event.id === selectedEvent.id)) setSelectedEvent(null);
    }, [selectedEvent, visibleEvents]);

    const shiftRange = (direction) => {
        cursorWasNavigatedByUser.current = true;
        setViewportCursorReady(true);
        setCursor((current) => {
            if (view === "month") return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + direction, 1));
            return addUtcDays(current, direction * (view === "week" ? 7 : 1));
        });
    };
    const selectEvent = (event) => {
        setSelectedEvent(event);
    };
    const selectAdjacentEvent = (direction) => {
        const next = plannerAdjacentVisibleEvent(visibleEvents, selectedEvent?.id, direction);
        if (!next) return;
        setSelectedEvent(next);
        if (viewRange && !plannerEventIsInView(next, { start: viewRange.startTime, end: viewRange.endTime })) {
            const nextCursor = plannerCursorForEvent(next);
            if (nextCursor) {
                cursorWasNavigatedByUser.current = true;
                setViewportCursorReady(true);
                setCursor(nextCursor);
            }
        }
    };
    const openDay = (day) => {
        cursorWasNavigatedByUser.current = true;
        setViewportCursorReady(true);
        setCursor(utcDay(day));
        setView("day");
    };
    const goToToday = () => {
        cursorWasNavigatedByUser.current = true;
        setViewportCursorReady(true);
        setCursor(utcDay());
        setView("day");
    };
    const activateEvent = (event, activation) => {
        if (!activation?.enabled || !activation.targetTime) return;
        const targetDay = utcDay(activation.targetTime);
        if (targetDay) {
            cursorWasNavigatedByUser.current = true;
            setViewportCursorReady(true);
            setCursor(targetDay);
            setView("day");
        }
        window.dispatchEvent(new CustomEvent(ORBIT_PLANNER_EVENT_ACTIVATE_EVENT, {
            detail: { ...event, time: activation.targetTime }
        }));
        setRequestMessage("La escena se ha situado en el instante del evento.");
    };
    const selectUtcMonth = (event) => {
        const next = cursorForUtcMonth(event.target.value, cursor);
        if (next) {
            cursorWasNavigatedByUser.current = true;
            setViewportCursorReady(true);
            setCursor(next);
        }
    };
    const setPlannerLayerVisibility = (layerId, visible) => {
        setLayerVisibilityOverrides((current) => {
            const next = new Map(current);
            next.set(layerId, visible);
            return next;
        });
        window.dispatchEvent(new CustomEvent(ORBIT_PLANNER_LAYER_FILTER_EVENT, { detail: { layerId, visible } }));
        setRequestMessage(visible ? "La capa vuelve a mostrarse en la agenda." : "La capa se ha ocultado solo en la agenda.");
    };
    const showAllPlannerLayers = () => {
        const hidden = new Set(hiddenLayerIds);
        if (!hidden.size) return;
        setLayerVisibilityOverrides((current) => {
            const next = new Map(current);
            for (const layerId of hidden) next.set(layerId, true);
            return next;
        });
        for (const layerId of hidden) {
            window.dispatchEvent(new CustomEvent(ORBIT_PLANNER_LAYER_FILTER_EVENT, { detail: { layerId, visible: true } }));
        }
        setRequestMessage("Todas las capas vuelven a mostrarse en la agenda.");
    };
    const submitManualEvent = (fields, eventId) => {
        const result = makeManualEventPayload(fields, eventId);
        if (!result.ok) {
            setEditorError(result.error);
            return;
        }
        window.dispatchEvent(new CustomEvent(ORBIT_PLANNER_MANUAL_EVENT_UPSERT_EVENT, { detail: result.event }));
        setRequestMessage("La solicitud se ha enviado. El planificador se actualizará tras validarla.");
        setEditorError("");
        setEditorEvent(undefined);
    };
    const removeManualEvent = (event) => {
        window.dispatchEvent(new CustomEvent(ORBIT_PLANNER_MANUAL_EVENT_REMOVE_EVENT, { detail: { id: event.id } }));
        setRequestMessage("La solicitud de eliminación se ha enviado.");
        setSelectedEvent(null);
    };
    const exportManualEventsIcs = () => {
        if (!manualEvents.length) {
            setRequestMessage("No hay eventos manuales que exportar.");
            return;
        }
        if (typeof Blob === "undefined" || !globalThis.URL?.createObjectURL) {
            setRequestMessage("Este navegador no permite exportar calendarios ICS.");
            return;
        }
        try {
            const calendar = serializeManualPlannerEventsToIcs(manualEvents, { calendarName: "Orbit Planner" });
            const blob = new Blob([calendar], { type: MANUAL_PLANNER_ICS_MIME_TYPE });
            const url = globalThis.URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "orbit-planner-manual.ics";
            anchor.style.display = "none";
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(() => globalThis.URL.revokeObjectURL(url), 0);
            setRequestMessage(`Se han exportado ${manualEvents.length} eventos manuales en ICS.`);
        } catch {
            setRequestMessage("No se ha podido exportar el calendario ICS local.");
        }
    };
    const importManualEventsIcs = async (event) => {
        const file = event.target.files?.[0];
        // Clear first so selecting the same corrected file later still emits a
        // change event. The file object remains available for this handler.
        event.target.value = "";
        if (!file) return;
        try {
            const result = parseManualPlannerEventsIcs(await file.text());
            if (!result.ok) {
                setRequestMessage(result.errors[0] || "El calendario ICS no contiene eventos manuales válidos.");
                return;
            }
            for (const manualEvent of result.events) {
                window.dispatchEvent(new CustomEvent(ORBIT_PLANNER_MANUAL_EVENT_UPSERT_EVENT, { detail: manualEvent }));
            }
            const rejected = result.rejected ? ` Se descartaron ${result.rejected} entradas no válidas.` : "";
            setRequestMessage(`Se han importado ${result.events.length} eventos manuales.${rejected}`);
        } catch {
            setRequestMessage("No se ha podido leer el calendario ICS seleccionado.");
        }
    };

    const beginWindowDrag = (event) => {
        if (isPlannerWindowCompactViewport() || event.button !== 0 || event.target.closest("button, input, select, label, a")) return;
        setWindowInteraction({
            kind: "drag",
            pointerId: event.pointerId,
            pointerX: event.clientX,
            pointerY: event.clientY,
            rect: windowRect
        });
        event.preventDefault();
    };
    const beginWindowResize = (direction, event) => {
        if (isPlannerWindowCompactViewport() || event.button !== 0) return;
        setWindowInteraction({
            kind: "resize",
            direction,
            pointerId: event.pointerId,
            pointerX: event.clientX,
            pointerY: event.clientY,
            rect: windowRect
        });
        event.preventDefault();
        event.stopPropagation();
    };
    const panelStyle = isPlannerWindowCompactViewport() ? undefined : {
        left: `${windowRect.x}px`,
        top: `${windowRect.y}px`,
        width: `${windowRect.width}px`,
        height: `${windowRect.height}px`
    };

    return <section className="orbit-planner-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
    }}>
        <section id="orbitPlannerPanel" className={`orbit-planner-panel${windowInteraction ? " is-resizing" : ""}`} style={panelStyle} role="dialog" aria-modal="true" aria-labelledby="orbitPlannerTitle">
            <header className="orbit-planner-header orbit-planner-drag-handle" onPointerDown={beginWindowDrag}>
                <div className="orbit-planner-heading"><CalendarIcon /><div><span>ORBIT · PLANIFICADOR</span><h2 id="orbitPlannerTitle">Agenda de la escena</h2></div></div>
                <div className="orbit-planner-header-actions"><span className={`orbit-planner-status is-${presentationStatus}`} aria-live="polite" title={presentationStatus === "loading" ? (plannerState.message || "Actualizando eventos de la agenda") : presentationStatus === "error" ? "Hay errores operativos que requieren atención" : "Agenda sincronizada"}>{presentationStatus === "loading" ? "Actualizando" : presentationStatus === "error" ? "Con errores" : "Sincronizado"}</span><PanelCloseButton label="Cerrar planificador" onPointerDown={(event) => event.stopPropagation()} onClick={onClose} /></div>
            </header>
            <div className="orbit-planner-toolbar">
                <div className="orbit-planner-navigation" aria-label="Navegación temporal">
                    <button type="button" className="orbit-planner-today" title="Ir al día actual en UTC" onClick={goToToday}><CalendarIcon /><span>Hoy</span></button>
                    <div className="orbit-planner-range-stepper">
                        <button type="button" className="orbit-planner-icon-button" onClick={() => shiftRange(-1)} aria-label="Periodo anterior"><ChevronLeftIcon /></button>
                        <button type="button" className="orbit-planner-icon-button" onClick={() => shiftRange(1)} aria-label="Periodo siguiente"><ChevronRightIcon /></button>
                    </div>
                    <label className="orbit-planner-period-picker" title="Seleccionar mes y año UTC">
                        <span className="orbit-planner-period-value" aria-hidden="true">{monthFormatter.format(cursor)}</span>
                        <ChevronDownIcon />
                        <input type="month" value={formatUtcMonth(cursor)} onChange={selectUtcMonth} aria-label="Seleccionar mes y año en UTC" />
                    </label>
                </div>
                <div className="orbit-planner-view-buttons" aria-label="Vista del planificador"><button type="button" className={view === "day" ? "is-active" : ""} aria-pressed={view === "day"} onClick={() => setView("day")}>Día</button><button type="button" className={view === "week" ? "is-active" : ""} aria-pressed={view === "week"} onClick={() => setView("week")}>Semana</button><button type="button" className={view === "month" ? "is-active" : ""} aria-pressed={view === "month"} onClick={() => setView("month")}>Mes</button></div>
                <div className="orbit-planner-ics-actions" aria-label="Intercambio local de eventos manuales">
                    <input ref={icsImportInputRef} type="file" accept=".ics,text/calendar" onChange={importManualEventsIcs} tabIndex={-1} aria-hidden="true" />
                    <button type="button" className="orbit-planner-ics-button" onClick={() => icsImportInputRef.current?.click()} title="Importar eventos manuales desde un calendario ICS UTC">Importar ICS</button>
                    <button type="button" className="orbit-planner-ics-button" onClick={exportManualEventsIcs} disabled={!manualEvents.length} title="Exportar únicamente los eventos manuales de este proyecto">Exportar ICS</button>
                </div>
                <button type="button" className="orbit-planner-new-event" onClick={() => { setEditorError(""); setEditorEvent(null); }}>Nuevo evento</button>
            </div>
            {visibleErrors.length ? <div className="orbit-planner-state-error" role="alert"><strong>No se ha podido actualizar todo el planificador.</strong>{visibleErrors.map((error, index) => <span key={`${error}:${index}`}>{error}</span>)}</div> : null}
            <div className="orbit-planner-content">
                <PlannerLayerSidebar layers={layers} hiddenLayerIds={hiddenLayerIds} onVisibilityChange={setPlannerLayerVisibility} onShowAll={showAllPlannerLayers} />
                <main className="orbit-planner-calendar">{view === "month" ? <MonthView cursor={cursor} events={visibleEvents} onSelect={selectEvent} onOpenDay={openDay} /> : <TimeGrid view={view} cursor={cursor} events={visibleEvents} onSelect={selectEvent} />}{plannerState.status === "loading" && !events.length ? <div className="orbit-planner-empty" role="status">Cargando los eventos de Orbit…</div> : null}{plannerState.status !== "loading" && !eventsInView.length ? <div className="orbit-planner-empty">{events.length && !visibleEvents.length ? "No hay eventos visibles con los filtros actuales." : "No hay eventos en este periodo."}</div> : null}</main>
                <EventDetails event={selected} activation={selectedActivation} onActivate={activateEvent} eventIndex={selectedEventIndex} eventCount={visibleEvents.length} onPrevious={() => selectAdjacentEvent(-1)} onNext={() => selectAdjacentEvent(1)} onEdit={(event) => { setEditorError(""); setEditorEvent(event); }} onRemove={removeManualEvent} />
            </div>
            <footer className="orbit-planner-footer">Todos los horarios se muestran en UTC.{plannerState.updatedAt ? ` Actualizado: ${formatter.format(new Date(plannerState.updatedAt))} UTC.` : ""}</footer>
            {requestMessage ? <p className="orbit-planner-request-toast" role="status" aria-live="polite">{requestMessage}</p> : null}
            {PLANNER_RESIZE_DIRECTIONS.map((direction) => <span key={direction} className="orbit-planner-resize-handle" data-direction={direction} aria-hidden="true" onPointerDown={(event) => beginWindowResize(direction, event)} />)}
        </section>
        {editorEvent !== undefined ? <ManualEventEditor event={editorEvent || null} error={editorError} onClose={() => { setEditorEvent(undefined); setEditorError(""); }} onSubmit={submitManualEvent} /> : null}
    </section>;
}
