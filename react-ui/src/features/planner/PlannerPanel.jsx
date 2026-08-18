import { useEffect, useMemo, useState } from "react";
import PanelCloseButton from "../../components/PanelCloseButton.jsx";
import { CalendarIcon } from "../../components/icons.jsx";
import {
    ORBIT_PLANNER_EVENT_ACTIVATE_EVENT,
    ORBIT_PLANNER_EVENTS_COMPAT_EVENT,
    ORBIT_PLANNER_MANUAL_EVENT_REMOVE_EVENT,
    ORBIT_PLANNER_MANUAL_EVENT_UPSERT_EVENT,
    ORBIT_PLANNER_STATE_REQUEST_EVENT,
    ORBIT_PLANNER_STATE_EVENT,
    PLANNER_COLOR_TOKENS,
    PLANNER_EVENT_COLORS,
    PLANNER_EVENT_KINDS,
    formatUtcInput,
    layoutPlannerEventLanes,
    makeManualEventPayload,
    normalizePlannerState
} from "./plannerUiModel.js";
import "./PlannerPanel.css";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const HOUR_HEIGHT = 52;
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

function rangeTitle(view, cursor) {
    if (view === "day") return dayFormatter.format(cursor);
    if (view === "month") return monthFormatter.format(cursor);
    const start = startOfUtcWeek(cursor);
    const end = addUtcDays(start, 6);
    const startLabel = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "short" }).format(start);
    const endLabel = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(end);
    return `${startLabel} — ${endLabel}`;
}

function createEditorFields(event) {
    return {
        title: event?.title || "",
        start: formatUtcInput(event?.start || new Date()),
        end: formatUtcInput(event?.end || new Date(Date.now() + 60 * 60 * 1000)),
        color: event?.colorToken || PLANNER_COLOR_TOKENS.BLUE
    };
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
    return <section className="orbit-planner-month" aria-label="Vista mensual">
        <div className="orbit-planner-weekdays" aria-hidden="true">{WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}</div>
        <div className="orbit-planner-month-grid">
            {cells.map((day) => {
                const dayEvents = eventsForDay(events, day);
                const inCurrentMonth = day.getUTCMonth() === cursor.getUTCMonth();
                return <article className={`orbit-planner-month-day${inCurrentMonth ? "" : " is-outside"}${sameUtcDay(day, today) ? " is-today" : ""}`} key={day.toISOString()}>
                    <button type="button" className="orbit-planner-day-number" onClick={() => onOpenDay(day)} aria-label={`Ver el día ${dayFormatter.format(day)}`}>{day.getUTCDate()}</button>
                    <div className="orbit-planner-month-events">
                        {dayEvents.slice(0, 3).map((event) => <EventButton event={event} key={`${event.id}:${day.toISOString()}`} compact onSelect={onSelect} />)}
                        {dayEvents.length > 3 ? <button type="button" className="orbit-planner-more-events" onClick={() => onOpenDay(day)}>+{dayEvents.length - 3} más</button> : null}
                    </div>
                </article>;
            })}
        </div>
    </section>;
}

function TimedEvent({ layout, day, onSelect }) {
    const { event, lane = 0, laneCount = 1 } = layout;
    const { start, end } = dayRange(day);
    const startTime = Math.max(start, Date.parse(event.start));
    const rawEnd = Date.parse(event.end || event.start);
    const endTime = Math.min(end, Math.max(rawEnd, startTime + 30 * 60 * 1000));
    const minutes = (startTime - start) / 60_000;
    const duration = Math.max(24, ((endTime - startTime) / 60_000) * (HOUR_HEIGHT / 60));
    const laneWidth = 100 / Math.max(1, laneCount);
    return <button
        type="button"
        className="orbit-planner-timed-event"
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
    const today = utcDay();
    return <section className={`orbit-planner-time-grid is-${view}`} aria-label={view === "week" ? "Vista semanal" : "Vista diaria"}>
        <div className="orbit-planner-time-scroll">
            <div className="orbit-planner-time-header" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(130px, 1fr))` }}>
                <span aria-hidden="true" />
                {days.map((day, index) => <span className={sameUtcDay(day, today) ? "is-today" : ""} key={day.toISOString()}>{WEEKDAY_LABELS[index + (view === "day" ? (day.getUTCDay() + 6) % 7 : 0)]}<b>{day.getUTCDate()}</b></span>)}
            </div>
            <div className="orbit-planner-hours" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(130px, 1fr))` }}>
                <div className="orbit-planner-hour-labels" aria-hidden="true">{Array.from({ length: 24 }, (_, hour) => <span key={hour}>{String(hour).padStart(2, "0")}:00</span>)}</div>
                {days.map((day) => {
                    const timedLayouts = layoutPlannerEventLanes(eventsForDay(events.filter((event) => !event.allDay), day));
                    return <div className="orbit-planner-time-day" key={day.toISOString()}>
                    {Array.from({ length: 24 }, (_, hour) => <div className="orbit-planner-hour-line" key={hour} />)}
                    {timedLayouts.map((layout) => <TimedEvent layout={layout} day={day} key={`${layout.event.id}:${day.toISOString()}`} onSelect={onSelect} />)}
                    {eventsForDay(events.filter((event) => event.allDay), day).map((event) => <EventButton event={event} key={`${event.id}:all-day:${day.toISOString()}`} compact onSelect={onSelect} />)}
                </div>;
                })}
            </div>
        </div>
    </section>;
}

function EventDetails({ event, onEdit, onRemove }) {
    if (!event) return <aside className="orbit-planner-detail orbit-planner-detail-empty" aria-live="polite"><CalendarIcon /><p>Selecciona un evento para ver sus detalles.</p></aside>;
    const isManual = event.kind === PLANNER_EVENT_KINDS.MANUAL;
    const description = typeof event.metadata?.description === "string" ? event.metadata.description : "";
    return <aside className="orbit-planner-detail" aria-label="Detalle del evento">
        <span className="orbit-planner-detail-color" style={eventColorStyle(event)} aria-hidden="true" />
        <span className="orbit-planner-detail-kicker">{isManual ? "Evento manual" : "Evento de Orbit"}</span>
        <h3>{event.title}</h3>
        <p className="orbit-planner-detail-time">{eventTimeLabel(event)}</p>
        {description ? <p className="orbit-planner-detail-description">{description}</p> : null}
        {event.metadata ? <dl className="orbit-planner-detail-meta">{Object.entries(event.metadata).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value)).slice(0, 5).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl> : null}
        <button type="button" className="orbit-planner-detail-action" onClick={() => window.dispatchEvent(new CustomEvent(ORBIT_PLANNER_EVENT_ACTIVATE_EVENT, { detail: event }))}>Ir al evento</button>
        {isManual ? <div className="orbit-planner-detail-actions"><button type="button" className="orbit-planner-detail-action" onClick={() => onEdit(event)}>Editar</button><button type="button" className="orbit-planner-detail-remove" onClick={() => onRemove(event)}>Eliminar</button></div> : null}
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
            <label>Color<select value={fields.color} onChange={update("color")}><option value={PLANNER_COLOR_TOKENS.BLUE}>Azul</option><option value={PLANNER_COLOR_TOKENS.CYAN}>Cian</option><option value={PLANNER_COLOR_TOKENS.EMERALD}>Verde</option><option value={PLANNER_COLOR_TOKENS.PURPLE}>Morado</option><option value={PLANNER_COLOR_TOKENS.AMBER}>Ámbar</option><option value={PLANNER_COLOR_TOKENS.ROSE}>Rojo</option><option value={PLANNER_COLOR_TOKENS.SLATE}>Gris</option></select></label>
            {error ? <p className="orbit-planner-editor-error" role="alert">{error}</p> : null}
            <footer><button type="button" className="orbit-planner-editor-cancel" onClick={onClose}>Cancelar</button><button type="submit" className="orbit-planner-editor-save">{editMode ? "Guardar cambios" : "Crear evento"}</button></footer>
        </form>
    </section>;
}

/**
 * Full planner surface.  It renders exactly the stream supplied by the
 * runtime and emits manual mutations, so it remains usable for event sources
 * that will be added later (calendar export is intentionally out of scope).
 */
export default function PlannerPanel({ onClose }) {
    const [plannerState, setPlannerState] = useState(() => normalizePlannerState(
        typeof window !== "undefined" && window.__orbitPlannerState
            ? window.__orbitPlannerState
            : { status: "loading" }
    ));
    const [view, setView] = useState("week");
    const [cursor, setCursor] = useState(() => utcDay());
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [editorEvent, setEditorEvent] = useState(undefined);
    const [editorError, setEditorError] = useState("");
    const [requestMessage, setRequestMessage] = useState("");

    useEffect(() => {
        const sync = (event) => setPlannerState(normalizePlannerState(event.detail));
        const syncLegacy = (event) => setPlannerState(normalizePlannerState(Array.isArray(event.detail) ? { status: "ready", events: event.detail } : event.detail));
        window.addEventListener(ORBIT_PLANNER_STATE_EVENT, sync);
        window.addEventListener(ORBIT_PLANNER_EVENTS_COMPAT_EVENT, syncLegacy);
        window.dispatchEvent(new Event(ORBIT_PLANNER_STATE_REQUEST_EVENT));
        return () => {
            window.removeEventListener(ORBIT_PLANNER_STATE_EVENT, sync);
            window.removeEventListener(ORBIT_PLANNER_EVENTS_COMPAT_EVENT, syncLegacy);
        };
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

    const events = plannerState.events;
    const selected = useMemo(() => events.find((event) => event.id === selectedEvent?.id) || selectedEvent, [events, selectedEvent]);
    const shiftRange = (direction) => setCursor((current) => {
        if (view === "month") return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + direction, 1));
        return addUtcDays(current, direction * (view === "week" ? 7 : 1));
    });
    const selectEvent = (event) => {
        setSelectedEvent(event);
    };
    const openDay = (day) => {
        setCursor(utcDay(day));
        setView("day");
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

    return <section className="orbit-planner-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
    }}>
        <section id="orbitPlannerPanel" className="orbit-planner-panel" role="dialog" aria-modal="true" aria-labelledby="orbitPlannerTitle">
            <header className="orbit-planner-header">
                <div className="orbit-planner-heading"><CalendarIcon /><div><span>ORBIT · PLANIFICADOR</span><h2 id="orbitPlannerTitle">Agenda de la escena</h2></div></div>
                <div className="orbit-planner-header-actions"><span className={`orbit-planner-status is-${plannerState.status}`} aria-live="polite">{plannerState.status === "loading" ? "Actualizando" : plannerState.status === "error" ? "Con errores" : "Sincronizado"}</span><PanelCloseButton label="Cerrar planificador" onClick={onClose} /></div>
            </header>
            <div className="orbit-planner-toolbar">
                <div className="orbit-planner-navigation"><button type="button" onClick={() => shiftRange(-1)} aria-label="Periodo anterior">‹</button><button type="button" onClick={() => setCursor(utcDay())}>Hoy</button><button type="button" onClick={() => shiftRange(1)} aria-label="Periodo siguiente">›</button><strong>{rangeTitle(view, cursor)}</strong></div>
                <div className="orbit-planner-view-buttons" aria-label="Vista del planificador"><button type="button" className={view === "day" ? "is-active" : ""} aria-pressed={view === "day"} onClick={() => setView("day")}>Día</button><button type="button" className={view === "week" ? "is-active" : ""} aria-pressed={view === "week"} onClick={() => setView("week")}>Semana</button><button type="button" className={view === "month" ? "is-active" : ""} aria-pressed={view === "month"} onClick={() => setView("month")}>Mes</button></div>
                <button type="button" className="orbit-planner-new-event" onClick={() => { setEditorError(""); setEditorEvent(null); }}>Nuevo evento</button>
            </div>
            {plannerState.errors.length ? <div className="orbit-planner-state-error" role="alert"><strong>No se ha podido actualizar todo el planificador.</strong>{plannerState.errors.map((error, index) => <span key={`${error}:${index}`}>{error}</span>)}</div> : null}
            {requestMessage ? <p className="orbit-planner-request-message" aria-live="polite">{requestMessage}</p> : null}
            <div className="orbit-planner-content">
                <main className="orbit-planner-calendar">{view === "month" ? <MonthView cursor={cursor} events={events} onSelect={selectEvent} onOpenDay={openDay} /> : <TimeGrid view={view} cursor={cursor} events={events} onSelect={selectEvent} />}{plannerState.status === "loading" && !events.length ? <div className="orbit-planner-empty" role="status">Cargando los eventos de Orbit…</div> : null}{plannerState.status !== "loading" && !events.length ? <div className="orbit-planner-empty">No hay eventos en este periodo.</div> : null}</main>
                <EventDetails event={selected} onEdit={(event) => { setEditorError(""); setEditorEvent(event); }} onRemove={removeManualEvent} />
            </div>
            <footer className="orbit-planner-footer">Todos los horarios se muestran en UTC.{plannerState.updatedAt ? ` Actualizado: ${formatter.format(new Date(plannerState.updatedAt))} UTC.` : ""}</footer>
        </section>
        {editorEvent !== undefined ? <ManualEventEditor event={editorEvent || null} error={editorError} onClose={() => { setEditorEvent(undefined); setEditorError(""); }} onSubmit={submitManualEvent} /> : null}
    </section>;
}
