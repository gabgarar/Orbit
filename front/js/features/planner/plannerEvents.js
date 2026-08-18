/**
 * Planner event contract and UTC layout helpers.
 *
 * This module is intentionally renderer- and DOM-free.  The scene runtime
 * produces facts (passes, validated resource horizons and authored entries),
 * while React can render the normalized output in a day, week or month view.
 * Invalid facts are discarded rather than guessed: in particular, a coverage
 * end is never treated as an expiry unless the caller explicitly maps it to
 * `validityEnd`, and no timestamp is filled with `Date.now()`.
 */

export const PLANNER_STATE_EVENT = "orbit:planner-state";
export const PLANNER_MANUAL_EVENT_UPSERT_EVENT = "orbit:planner-manual-event-upsert";
export const PLANNER_MANUAL_EVENT_REMOVE_EVENT = "orbit:planner-manual-event-remove";

export const PLANNER_EVENT_KINDS = Object.freeze({
    PASS_AOS: "pass-aos",
    PASS_MAXIMUM: "pass-maximum",
    PASS_LOS: "pass-los",
    ERP_EXPIRY: "erp-expiry",
    ERP_VALIDITY_END: "erp-validity-end",
    SP3_EXPIRY: "sp3-expiry",
    SP3_VALIDITY_END: "sp3-validity-end",
    OEM_EXPIRY: "oem-expiry",
    OEM_VALIDITY_END: "oem-validity-end",
    LAYER_EXPIRY: "layer-expiry",
    LAYER_VALIDITY_END: "layer-validity-end",
    MANUAL: "manual"
});

/** Stable semantic colour tokens; renderers own the concrete CSS palette. */
export const PLANNER_COLOR_TOKENS = Object.freeze({
    EMERALD: "emerald",
    PURPLE: "purple",
    AMBER: "amber",
    ROSE: "rose",
    BLUE: "blue",
    CYAN: "cyan",
    SLATE: "slate"
});

export const PLANNER_MANUAL_COLOR_TOKENS = Object.freeze([
    PLANNER_COLOR_TOKENS.BLUE,
    PLANNER_COLOR_TOKENS.CYAN,
    PLANNER_COLOR_TOKENS.EMERALD,
    PLANNER_COLOR_TOKENS.PURPLE,
    PLANNER_COLOR_TOKENS.AMBER,
    PLANNER_COLOR_TOKENS.ROSE,
    PLANNER_COLOR_TOKENS.SLATE
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const knownStatuses = new Set(["loading", "ready", "error"]);
const knownKinds = new Set(Object.values(PLANNER_EVENT_KINDS));
const manualColours = new Set(PLANNER_MANUAL_COLOR_TOKENS);
const resourceTypes = new Set(["erp", "sp3", "oem", "layer"]);

export const PLANNER_EVENT_PRESENTATION = Object.freeze({
    [PLANNER_EVENT_KINDS.PASS_AOS]: Object.freeze({
        source: "ground-station",
        label: "AOS",
        colorToken: PLANNER_COLOR_TOKENS.PURPLE
    }),
    [PLANNER_EVENT_KINDS.PASS_MAXIMUM]: Object.freeze({
        source: "ground-station",
        label: "Máxima elevación",
        colorToken: PLANNER_COLOR_TOKENS.EMERALD
    }),
    [PLANNER_EVENT_KINDS.PASS_LOS]: Object.freeze({
        source: "ground-station",
        label: "LOS",
        colorToken: PLANNER_COLOR_TOKENS.PURPLE
    }),
    [PLANNER_EVENT_KINDS.ERP_EXPIRY]: Object.freeze({
        source: "resource",
        label: "Caducidad ERP",
        colorToken: PLANNER_COLOR_TOKENS.ROSE
    }),
    [PLANNER_EVENT_KINDS.ERP_VALIDITY_END]: Object.freeze({
        source: "resource",
        label: "Fin de validez ERP",
        colorToken: PLANNER_COLOR_TOKENS.AMBER
    }),
    [PLANNER_EVENT_KINDS.SP3_EXPIRY]: Object.freeze({
        source: "resource",
        label: "Caducidad SP3",
        colorToken: PLANNER_COLOR_TOKENS.ROSE
    }),
    [PLANNER_EVENT_KINDS.SP3_VALIDITY_END]: Object.freeze({
        source: "resource",
        label: "Fin de validez SP3",
        colorToken: PLANNER_COLOR_TOKENS.AMBER
    }),
    [PLANNER_EVENT_KINDS.OEM_EXPIRY]: Object.freeze({
        source: "resource",
        label: "Caducidad OEM",
        colorToken: PLANNER_COLOR_TOKENS.ROSE
    }),
    [PLANNER_EVENT_KINDS.OEM_VALIDITY_END]: Object.freeze({
        source: "resource",
        label: "Fin de validez OEM",
        colorToken: PLANNER_COLOR_TOKENS.AMBER
    }),
    [PLANNER_EVENT_KINDS.LAYER_EXPIRY]: Object.freeze({
        source: "resource",
        label: "Caducidad de capa",
        colorToken: PLANNER_COLOR_TOKENS.ROSE
    }),
    [PLANNER_EVENT_KINDS.LAYER_VALIDITY_END]: Object.freeze({
        source: "resource",
        label: "Fin de validez de capa",
        colorToken: PLANNER_COLOR_TOKENS.AMBER
    }),
    [PLANNER_EVENT_KINDS.MANUAL]: Object.freeze({
        source: "manual",
        label: "Evento manual",
        colorToken: PLANNER_COLOR_TOKENS.BLUE
    })
});

function text(value) {
    return value === undefined || value === null ? "" : String(value).trim();
}

function firstPresent(object, keys) {
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(object || {}, key)) {
            return { present: true, value: object[key] };
        }
    }
    return { present: false, value: undefined };
}

function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validIsoTimestamp(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) return null;
    const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", , zone] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    if (zone !== "Z") {
        const [offsetHour, offsetMinute] = zone.slice(1).split(":").map(Number);
        if (offsetHour > 23 || offsetMinute > 59) return null;
    }
    const epoch = Date.parse(value);
    return Number.isFinite(epoch) && Number.isFinite(new Date(epoch).getTime()) ? epoch : null;
}

/**
 * Parse an unambiguous timestamp without relying on the browser's local zone.
 * Strings must be ISO-8601 datetimes with `Z` or a numeric offset; `Date`
 * objects and finite epoch milliseconds are accepted for runtime bridges.
 */
export function toPlannerEpochMs(value) {
    if (value instanceof Date) {
        const epoch = value.getTime();
        return Number.isFinite(epoch) ? epoch : null;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? value : null;
    }
    if (typeof value !== "string") return null;
    const candidate = value.trim();
    return candidate ? validIsoTimestamp(candidate) : null;
}

export function plannerIsoTimestamp(value) {
    const epoch = toPlannerEpochMs(value);
    return epoch === null ? null : new Date(epoch).toISOString();
}

function normalizeKind(value) {
    const kind = text(value).toLowerCase();
    return knownKinds.has(kind) ? kind : null;
}

function normalizeColorToken(value, fallback, strict) {
    if (value === undefined || value === null || text(value) === "") return fallback;
    const color = text(value).toLowerCase();
    if (manualColours.has(color)) return color;
    return strict ? null : fallback;
}

function stableHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function generatedId({ source, kind, title, start, end, colorToken }) {
    return `planner:${source}:${kind}:${stableHash([title, start, end, colorToken].join("\u001f"))}`;
}

function normalizeMetadata(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return { ...value };
}

/**
 * Normalize one planner record. Unknown kinds, malformed timestamps and an
 * end before its start all return `null`. A point event intentionally has an
 * equal start/end, while a manual event must be a real interval.
 */
export function normalizePlannerEvent(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const kind = normalizeKind(input.kind || input.eventKind);
    if (!kind) return null;
    const presentation = PLANNER_EVENT_PRESENTATION[kind];
    const startCandidate = firstPresent(input, ["start", "startTime", "time"]);
    const startMs = startCandidate.present ? toPlannerEpochMs(startCandidate.value) : null;
    if (startMs === null) return null;

    const endCandidate = firstPresent(input, ["end", "endTime"]);
    const endMs = endCandidate.present ? toPlannerEpochMs(endCandidate.value) : startMs;
    if (endMs === null || endMs < startMs) return null;
    if (kind === PLANNER_EVENT_KINDS.MANUAL && (!endCandidate.present || endMs <= startMs)) return null;

    const configuredColor = normalizeColorToken(
        input.colorToken ?? input.color,
        presentation.colorToken,
        kind === PLANNER_EVENT_KINDS.MANUAL
    );
    if (!configuredColor) return null;

    const source = kind === PLANNER_EVENT_KINDS.MANUAL
        ? "manual"
        : text(input.source) || presentation.source;
    const title = text(input.title || input.name || input.label) || presentation.label;
    const start = new Date(startMs).toISOString();
    const end = new Date(endMs).toISOString();
    const id = text(input.id) || generatedId({ source, kind, title, start, end, colorToken: configuredColor });
    if (!id) return null;

    return {
        id,
        source,
        kind,
        title,
        start,
        end,
        startMs,
        endMs,
        durationMs: endMs - startMs,
        isPoint: startMs === endMs,
        allDay: input.allDay === true,
        colorToken: configuredColor,
        metadata: normalizeMetadata(input.metadata)
    };
}

export function normalizeManualPlannerEvent(input = {}) {
    return normalizePlannerEvent({ ...input, kind: PLANNER_EVENT_KINDS.MANUAL, source: "manual" });
}

export function comparePlannerEvents(left, right) {
    return left.startMs - right.startMs
        || left.endMs - right.endMs
        || left.id.localeCompare(right.id);
}

/** Normalise, de-duplicate and chronologically sort a collection. */
export function normalizePlannerEvents(events) {
    if (!Array.isArray(events)) return [];
    const seen = new Set();
    return events
        .map((event) => normalizePlannerEvent(event))
        .filter((event) => {
            if (!event || seen.has(event.id)) return false;
            seen.add(event.id);
            return true;
        })
        .sort(comparePlannerEvents);
}

function passKind(eventType) {
    switch (text(eventType).toLowerCase()) {
    case "aos": return PLANNER_EVENT_KINDS.PASS_AOS;
    case "max": return PLANNER_EVENT_KINDS.PASS_MAXIMUM;
    case "los": return PLANNER_EVENT_KINDS.PASS_LOS;
    default: return null;
    }
}

/**
 * Adapt the ground-station timeline contract. Hidden or incomplete source
 * records cannot escape into the planner even if an old runtime publishes one.
 */
export function buildPlannerPassEvents(passEvents) {
    if (!Array.isArray(passEvents)) return [];
    return normalizePlannerEvents(passEvents.flatMap((raw) => {
        const kind = passKind(raw?.eventType);
        const stationId = text(raw?.stationId);
        const satelliteId = text(raw?.satelliteId || raw?.satelliteLayerId);
        if (!kind || !stationId || !satelliteId) return [];
        if (raw?.visible === false || raw?.stationVisible === false || raw?.satelliteVisible === false) return [];
        const stationName = text(raw?.stationName) || stationId;
        const satelliteName = text(raw?.satelliteName) || satelliteId;
        const label = PLANNER_EVENT_PRESENTATION[kind].label;
        const rawId = text(raw?.id) || [stationId, satelliteId, text(raw?.passId), raw?.eventType, raw?.time].join(":");
        const event = normalizePlannerEvent({
            id: `pass:${rawId}`,
            source: "ground-station",
            kind,
            title: `${label} · ${stationName} — ${satelliteName}`,
            time: raw?.time,
            metadata: {
                stationId,
                stationName,
                satelliteId,
                satelliteLayerId: satelliteId,
                sourceSatelliteId: text(raw?.sourceSatelliteId),
                satelliteName,
                passId: text(raw?.passId),
                elevationDeg: Number.isFinite(Number(raw?.elevationDeg)) ? Number(raw.elevationDeg) : undefined
            }
        });
        return event ? [event] : [];
    }));
}

function normalizeResourceType(value) {
    const type = text(value).toLowerCase().replaceAll("_", "-");
    if (type === "imported-layer" || type === "import-layer") return "layer";
    return resourceTypes.has(type) ? type : null;
}

function resourceKind(type, suffix) {
    const key = `${type}-${suffix}`.toUpperCase().replaceAll("-", "_");
    return PLANNER_EVENT_KINDS[key] || null;
}

/**
 * Turn explicit resource facts into planner notices.  Accepted input is
 * `{id, resourceType, name?, expiresAt?, validityEnd?, metadata?}`. A raw
 * `coverageEnd` is deliberately not inspected: callers must explicitly say
 * it represents a validity boundary by mapping it to `validityEnd`.
 */
export function buildPlannerResourceEvents(resources) {
    if (!Array.isArray(resources)) return [];
    return normalizePlannerEvents(resources.flatMap((resource) => {
        const resourceId = text(resource?.id);
        const type = normalizeResourceType(resource?.resourceType || resource?.type);
        if (!resourceId || !type) return [];
        const name = text(resource?.name || resource?.title || resource?.label) || resourceId;
        const commonMetadata = {
            resourceId,
            resourceType: type,
            ...normalizeMetadata(resource?.metadata)
        };
        const candidates = [
            { field: "expiresAt", suffix: "expiry" },
            { field: "validityEnd", suffix: "validity-end" }
        ];
        return candidates.flatMap(({ field, suffix }) => {
            if (!Object.prototype.hasOwnProperty.call(resource, field)) return [];
            const kind = resourceKind(type, suffix);
            const event = normalizePlannerEvent({
                id: `resource:${type}:${resourceId}:${suffix}`,
                source: "resource",
                kind,
                time: resource[field],
                title: `${PLANNER_EVENT_PRESENTATION[kind]?.label || suffix} · ${name}`,
                metadata: commonMetadata
            });
            return event ? [event] : [];
        });
    }));
}

/**
 * A valid planner range is half-open `[start, end)`. This makes adjacent
 * events deterministic and prevents a midnight event appearing in two cells.
 */
export function normalizePlannerRange(rangeOrStart, maybeEnd) {
    const range = rangeOrStart && typeof rangeOrStart === "object" && !(rangeOrStart instanceof Date)
        ? rangeOrStart
        : { start: rangeOrStart, end: maybeEnd };
    const startCandidate = firstPresent(range, ["start", "startTime"]);
    const endCandidate = firstPresent(range, ["end", "endTime"]);
    const startMs = startCandidate.present ? toPlannerEpochMs(startCandidate.value) : null;
    const endMs = endCandidate.present ? toPlannerEpochMs(endCandidate.value) : null;
    if (startMs === null || endMs === null || endMs <= startMs) return null;
    return {
        start: new Date(startMs).toISOString(),
        end: new Date(endMs).toISOString(),
        startMs,
        endMs
    };
}

export function plannerEventIntersectsRange(event, rangeOrStart, maybeEnd) {
    const normalized = normalizePlannerEvent(event);
    const range = normalizePlannerRange(rangeOrStart, maybeEnd);
    if (!normalized || !range) return false;
    if (normalized.isPoint) return normalized.startMs >= range.startMs && normalized.startMs < range.endMs;
    return normalized.startMs < range.endMs && normalized.endMs > range.startMs;
}

export function filterPlannerEventsByRange(events, rangeOrStart, maybeEnd) {
    const range = normalizePlannerRange(rangeOrStart, maybeEnd);
    if (!range) return [];
    return normalizePlannerEvents(events).filter((event) => plannerEventIntersectsRange(event, range));
}

/** Whether two events visually conflict in a day/week time column. */
export function plannerEventsOverlap(left, right) {
    const first = normalizePlannerEvent(left);
    const second = normalizePlannerEvent(right);
    if (!first || !second) return false;
    if (first.isPoint && second.isPoint) return first.startMs === second.startMs;
    if (first.isPoint) return first.startMs >= second.startMs && first.startMs <= second.endMs;
    if (second.isPoint) return second.startMs >= first.startMs && second.startMs <= first.endMs;
    return first.startMs < second.endMs && second.startMs < first.endMs;
}

/** Group events by transitive overlap, preserving chronological order. */
export function getPlannerOverlapGroups(events) {
    const groups = [];
    for (const event of normalizePlannerEvents(events)) {
        const active = groups.at(-1);
        if (active && active.some((candidate) => plannerEventsOverlap(candidate, event))) {
            active.push(event);
        } else {
            groups.push([event]);
        }
    }
    return groups;
}

function layoutOverlapGroup(group, groupIndex) {
    const lanes = [];
    const assigned = [];
    const ordered = [...group].sort((left, right) => (
        left.startMs - right.startMs
        || right.durationMs - left.durationMs
        || left.id.localeCompare(right.id)
    ));
    for (const event of ordered) {
        let lane = lanes.findIndex((laneEvents) => laneEvents.every((candidate) => !plannerEventsOverlap(candidate, event)));
        if (lane < 0) {
            lane = lanes.length;
            lanes.push([]);
        }
        lanes[lane].push(event);
        assigned.push({ event, lane, overlapGroup: groupIndex });
    }
    return assigned.map((entry) => ({ ...entry, laneCount: lanes.length }));
}

/**
 * Return a stable lane/column assignment for overlapping timed events. The
 * widest concurrent group gets a common `laneCount`, which gives a renderer
 * safe, non-overlapping columns without embedding any CSS assumptions.
 */
export function layoutPlannerEventLanes(events) {
    return getPlannerOverlapGroups(events)
        .flatMap((group, index) => layoutOverlapGroup(group, index))
        .sort((left, right) => comparePlannerEvents(left.event, right.event));
}

function utcDayRange(value) {
    const epoch = toPlannerEpochMs(value);
    if (epoch === null) return null;
    const date = new Date(epoch);
    const startMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const endMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    return normalizePlannerRange(startMs, endMs);
}

function validWeekStart(value) {
    return Number.isInteger(value) && value >= 0 && value <= 6 ? value : 1;
}

function layoutEventsForRange(events, range) {
    const duration = range.endMs - range.startMs;
    const visible = filterPlannerEventsByRange(events, range);
    return layoutPlannerEventLanes(visible).map(({ event, lane, laneCount, overlapGroup }) => {
        const layoutStartMs = Math.max(event.startMs, range.startMs);
        const layoutEndMs = event.isPoint
            ? layoutStartMs
            : Math.min(event.endMs, range.endMs);
        return {
            event,
            lane,
            laneCount,
            overlapGroup,
            layoutStartMs,
            layoutEndMs,
            topPercent: ((layoutStartMs - range.startMs) / duration) * 100,
            heightPercent: ((layoutEndMs - layoutStartMs) / duration) * 100,
            leftPercent: (lane / laneCount) * 100,
            widthPercent: 100 / laneCount
        };
    });
}

/** UTC day layout; no browser-local day boundaries are used. */
export function getPlannerDayLayout(events, day) {
    const range = utcDayRange(day);
    if (!range) return null;
    return {
        view: "day",
        range,
        events: layoutEventsForRange(events, range)
    };
}

/** UTC week layout with Monday as the default first day (`weekStartsOn: 1`). */
export function getPlannerWeekLayout(events, anchor, { weekStartsOn = 1 } = {}) {
    const day = utcDayRange(anchor);
    if (!day) return null;
    const weekStart = validWeekStart(weekStartsOn);
    const anchorDay = new Date(day.startMs).getUTCDay();
    const offset = (anchorDay - weekStart + 7) % 7;
    const startMs = day.startMs - offset * DAY_MS;
    const range = normalizePlannerRange(startMs, startMs + 7 * DAY_MS);
    return {
        view: "week",
        range,
        weekStartsOn: weekStart,
        days: Array.from({ length: 7 }, (_, index) => getPlannerDayLayout(events, startMs + index * DAY_MS))
    };
}

/**
 * UTC month grid. Each returned week is complete, so consumers can render a
 * Teams/Google-like fixed-cell grid without calculating local daylight-saving
 * transitions themselves. The grid is at least five and at most six full UTC
 * weeks.
 */
export function getPlannerMonthLayout(events, anchor, { weekStartsOn = 1 } = {}) {
    const epoch = toPlannerEpochMs(anchor);
    if (epoch === null) return null;
    const date = new Date(epoch);
    const monthStartMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const monthEndMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    const weekStart = validWeekStart(weekStartsOn);
    const firstWeekday = new Date(monthStartMs).getUTCDay();
    const leadingDays = (firstWeekday - weekStart + 7) % 7;
    const gridStartMs = monthStartMs - leadingDays * DAY_MS;
    const weekCount = Math.max(5, Math.ceil((monthEndMs - gridStartMs) / (7 * DAY_MS)));
    const range = normalizePlannerRange(gridStartMs, gridStartMs + weekCount * 7 * DAY_MS);
    return {
        view: "month",
        range,
        month: {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            start: new Date(monthStartMs).toISOString(),
            end: new Date(monthEndMs).toISOString()
        },
        weekStartsOn: weekStart,
        weeks: Array.from({ length: weekCount }, (_, weekIndex) => ({
            index: weekIndex,
            days: Array.from({ length: 7 }, (_, dayIndex) => {
                const layout = getPlannerDayLayout(events, gridStartMs + (weekIndex * 7 + dayIndex) * DAY_MS);
                const dayDate = new Date(layout.range.startMs);
                return {
                    ...layout,
                    isCurrentMonth: dayDate.getUTCMonth() === date.getUTCMonth()
                        && dayDate.getUTCFullYear() === date.getUTCFullYear()
                };
            })
        }))
    };
}

/**
 * Validate the public DOM payload before a renderer consumes it. Unknown state
 * values become a safe error state; no missing `updatedAt` is replaced with
 * the current time. Valid event facts may still be displayed alongside source
 * errors, allowing the UI to explain a partial refresh.
 */
export function normalizePlannerState(detail = {}) {
    const requestedStatus = text(detail?.status).toLowerCase();
    const status = knownStatuses.has(requestedStatus) ? requestedStatus : "error";
    const statusValid = status === requestedStatus;
    const updatedAt = plannerIsoTimestamp(detail?.updatedAt);
    const suppliedErrors = Array.isArray(detail?.errors)
        ? detail.errors
        : detail?.errors === undefined || detail?.errors === null ? [] : [detail.errors];
    const errors = suppliedErrors.map(text).filter(Boolean);
    if (!statusValid) errors.unshift("Estado del planificador no válido.");
    return {
        status,
        events: statusValid ? normalizePlannerEvents(detail?.events) : [],
        updatedAt,
        updatedAtMs: updatedAt ? Date.parse(updatedAt) : null,
        errors
    };
}
